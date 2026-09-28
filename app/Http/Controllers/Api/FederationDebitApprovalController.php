<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\FederationDebitApprovalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Carbon;

class FederationDebitApprovalController extends BaseApiController
{
    public function index(Request $request): JsonResponse
    {
        $approvals = DB::table('federation_debit_approvals as a')
            ->where('a.tenant_id', TenantContext::getId())
            ->where('a.payer_user_id', (int) $request->user()->id)
            ->where('a.status', 'pending')
            ->where('a.expires_at', '>', now())
            ->orderBy('a.created_at')
            ->get(['a.id', 'a.protocol', 'a.amount', 'a.description', 'a.expires_at', 'a.payee_label']);

        return response()->json(['success' => true, 'data' => ['approvals' => $approvals]]);
    }

    public function decide(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate(['decision' => ['required', 'in:approve,reject']]);
        $tenantId = TenantContext::getId();
        $userId = (int) $request->user()->id;

        return DB::transaction(function () use ($id, $tenantId, $userId, $validated): JsonResponse {
            $approval = DB::table('federation_debit_approvals')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->where('payer_user_id', $userId)
                ->lockForUpdate()
                ->first();

            if (!$approval || $approval->status !== 'pending' || Carbon::parse($approval->expires_at)->isPast()) {
                return response()->json(['success' => false, 'error' => __('api.forbidden')], 404);
            }

            if (!$this->proposalMatches($approval)) {
                return response()->json(['success' => false, 'error' => __('api.forbidden')], 409);
            }

            $status = $validated['decision'] === 'approve' ? 'approved' : 'rejected';
            DB::table('federation_debit_approvals')->where('id', $id)->update([
                'status' => $status,
                'decided_at' => now(),
                'updated_at' => now(),
            ]);

            return response()->json(['success' => true, 'data' => ['status' => $status]]);
        });
    }

    private function proposalMatches(object $approval): bool
    {
        if ($approval->protocol === 'credit_commons') {
            $entry = DB::table('federation_cc_entries')
                ->where('id', (int) $approval->reference_id)
                ->where('tenant_id', $approval->tenant_id)
                ->whereIn('state', ['P', 'V'])
                ->first();
            if (!$entry || number_format((float) $entry->quant, 4, '.', '') !== number_format((float) $approval->amount, 4, '.', '')) {
                return false;
            }

            $accounts = json_decode((string) ($entry->metadata ?? ''), true);
            if (!is_array($accounts) || ($accounts['local_settlement'] ?? null) !== false) {
                return false;
            }
            $payer = $accounts['local_payer_id'] ?? null;
            $payee = $accounts['local_payee_id'] ?? null;
            return $payer === (int) $approval->payer_user_id
                && $payee === ($approval->payee_user_id === null ? null : (int) $approval->payee_user_id)
                && (string) $entry->payee === (string) $approval->payee_label
                && (string) $entry->description === (string) $approval->description;
        }

        if ($approval->protocol === 'credit_commons_reversal') {
            $entry = DB::table('federation_cc_entries')
                ->where('id', (int) $approval->reference_id)
                ->where('tenant_id', $approval->tenant_id)
                ->where('state', 'C')->first();
            $accounts = $entry ? json_decode((string) ($entry->metadata ?? ''), true) : null;
            return $entry && is_array($accounts) && ($accounts['local_settlement'] ?? null) === true
                && ($accounts['local_payee_id'] ?? null) === (int) $approval->payer_user_id
                && ($accounts['local_payer_id'] ?? null)
                    === ($approval->payee_user_id === null ? null : (int) $approval->payee_user_id)
                && (string) $entry->payer === (string) $approval->payee_label
                && number_format((float) $entry->quant, 4, '.', '') === number_format((float) $approval->amount, 4, '.', '')
                && (string) $entry->description === (string) $approval->description;
        }

        if ($approval->protocol === 'komunitin') {
            $tx = DB::table('transactions')->where('id', (int) $approval->reference_id)
                ->where('tenant_id', $approval->tenant_id)
                ->where('transaction_type', 'komunitin_external')
                ->where('status', 'pending')->first();
            return $tx
                && (int) $tx->sender_id === (int) $approval->payer_user_id
                && (int) $tx->receiver_id === (int) $approval->payee_user_id
                && number_format((float) $tx->amount, 4, '.', '') === number_format((float) $approval->amount, 4, '.', '')
                && (string) $tx->description === (string) $approval->description;
        }

        return false;
    }
}
