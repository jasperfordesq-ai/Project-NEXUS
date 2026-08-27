<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Support\UserDisplayName;

/**
 * AG43 — Citizen residency verification for geographically bounded KISS cooperatives.
 */
class ResidencyVerificationService
{
    /**
     * Whether the residency verification table exists and is usable.
     */
    public function isAvailable(): bool
    {
        return Schema::hasTable('member_residency_verifications');
    }

    /**
     * Submit a member's municipality/postcode declaration for coordinator attestation.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function submitDeclaration(int $tenantId, int $userId, array $data): array
    {
        $now = now();

        DB::table('member_residency_verifications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('status', 'pending')
            ->update([
                'status' => 'rejected',
                'rejection_reason' => __('api.residency_superseded'),
                'updated_at' => $now,
            ]);

        $id = (int) DB::table('member_residency_verifications')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'declared_municipality' => $data['declared_municipality'],
            'declared_postcode' => $data['declared_postcode'],
            'declared_address' => $data['declared_address'] ?? null,
            'evidence_note' => $data['evidence_note'] ?? null,
            'status' => 'pending',
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->findForTenant($tenantId, $id) ?? [];
    }

    /**
     * Latest residency status for a member, including the distinct badge payload.
     *
     * @return array<string,mixed>
     */
    public function statusForUser(int $tenantId, int $userId): array
    {
        $row = DB::table('member_residency_verifications')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->first();

        if (! $row) {
            return [
                'status' => 'not_submitted',
                'badge' => $this->badgePayload('not_submitted'),
                'verification' => null,
            ];
        }

        $verification = $this->formatRow($row);

        return [
            'status' => $verification['status'],
            'badge' => $this->badgePayload((string) $verification['status']),
            'verification' => $verification,
        ];
    }

    /**
     * List declarations for coordinator/admin review.
     *
     * @return array<int,array<string,mixed>>
     */
    public function listForAdmin(int $tenantId, ?string $status = null): array
    {
        $query = DB::table('member_residency_verifications as rv')
            ->leftJoin('users as u', function ($join) {
                $join->on('u.id', '=', 'rv.user_id')
                    ->on('u.tenant_id', '=', 'rv.tenant_id');
            })
            ->where('rv.tenant_id', $tenantId)
            ->select([
                'rv.*',
                'u.first_name',
                'u.last_name', 'u.profile_type', 'u.organization_name',
                'u.email',
            ])
            ->orderByRaw("FIELD(rv.status, 'pending', 'approved', 'rejected')")
            ->orderByDesc('rv.created_at')
            ->orderByDesc('rv.id');

        if ($status !== null && $status !== 'all') {
            $query->where('rv.status', $status);
        }

        return $query->get()
            ->map(function ($row) {
                $formatted = $this->formatRow($row);
                $formatted['member'] = [
                    'id' => (int) $row->user_id,
                    'name' => UserDisplayName::resolve($row),
                    'email' => $row->email,
                ];

                return $formatted;
            })
            ->all();
    }

    /**
     * Attest or reject a residency declaration.
     *
     * @return array<string,mixed>
     */
    public function attest(int $tenantId, int $verificationId, int $adminId, string $decision, ?string $reason = null): array
    {
        $status = $decision === 'approved' ? 'approved' : 'rejected';

        DB::table('member_residency_verifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $verificationId)
            ->update([
                'status' => $status,
                'attested_by' => $adminId,
                'attested_at' => now(),
                'rejection_reason' => $status === 'rejected' ? $reason : null,
                'updated_at' => now(),
            ]);

        return $this->findForTenant($tenantId, $verificationId) ?? [];
    }

    /**
     * @return array<string,mixed>|null
     */
    private function findForTenant(int $tenantId, int $id): ?array
    {
        $row = DB::table('member_residency_verifications')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();

        return $row ? $this->formatRow($row) : null;
    }

    /**
     * @return array<string,mixed>
     */
    private function formatRow(object $row): array
    {
        return [
            'id' => (int) $row->id,
            'tenant_id' => (int) $row->tenant_id,
            'user_id' => (int) $row->user_id,
            'declared_municipality' => (string) $row->declared_municipality,
            'declared_postcode' => (string) $row->declared_postcode,
            'declared_address' => $row->declared_address,
            'evidence_note' => $row->evidence_note,
            'status' => (string) $row->status,
            'attested_by' => $row->attested_by !== null ? (int) $row->attested_by : null,
            'attested_at' => $row->attested_at,
            'rejection_reason' => $row->rejection_reason,
            'created_at' => $row->created_at,
            'updated_at' => $row->updated_at,
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function badgePayload(string $status): array
    {
        return [
            'key' => 'verified_residency',
            'label' => __('api.residency_badge_label'),
            'verified' => $status === 'approved',
            'status' => $status,
        ];
    }
}
