<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

class FederationDebitApprovalService
{
    public function request(
        int $tenantId,
        string $protocol,
        string $referenceId,
        int $payerId,
        ?int $payeeId,
        string $payeeLabel,
        float $amount,
        string $description,
        ?int $partnerKeyId = null,
        ?string $partnerRequestId = null,
        ?string $requestHash = null,
    ): bool
    {
        return DB::table('federation_debit_approvals')->insertOrIgnore([
            'tenant_id' => $tenantId,
            'protocol' => $protocol,
            'reference_id' => $referenceId,
            'partner_key_id' => $partnerKeyId,
            'partner_request_id' => $partnerRequestId,
            'request_hash' => $requestHash,
            'payer_user_id' => $payerId,
            'payee_user_id' => $payeeId,
            'payee_label' => $payeeLabel,
            'amount' => $amount,
            'description' => $description,
            'status' => 'pending',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]) === 1;
    }

    public function consume(int $tenantId, string $protocol, string $referenceId, int $payerId, ?int $payeeId, string $payeeLabel, float $amount, string $description): bool
    {
        return DB::table('federation_debit_approvals')
            ->where('tenant_id', $tenantId)
            ->where('protocol', $protocol)
            ->where('reference_id', $referenceId)
            ->where('payer_user_id', $payerId)
            ->where('payee_user_id', $payeeId)
            ->where('payee_label', $payeeLabel)
            ->where('amount', number_format($amount, 4, '.', ''))
            ->where('description', $description)
            ->where('status', 'approved')
            ->where('expires_at', '>', now())
            ->update(['status' => 'consumed', 'consumed_at' => now(), 'updated_at' => now()]) === 1;
    }
}
