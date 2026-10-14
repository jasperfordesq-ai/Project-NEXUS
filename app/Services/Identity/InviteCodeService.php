<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;

/**
 * InviteCodeService — Manages invite codes for invite-only registration mode.
 *
 * Each code is single-use by default, scoped to a tenant, with optional expiry.
 * Admins can generate codes individually or in batches.
 */
class InviteCodeService
{
    /**
     * Generate one or more invite codes for a tenant.
     *
     * @param int      $tenantId
     * @param int      $createdBy  Admin user ID
     * @param int      $count      Number of codes to generate
     * @param int|null $maxUses    Max uses per code (null = 1)
     * @param string|null $expiresAt DateTime string (null = no expiry)
     * @param string|null $note      Admin note
     * @return array Generated codes
     */
    public static function generate(
        int $tenantId,
        int $createdBy,
        int $count = 1,
        ?int $maxUses = 1,
        ?string $expiresAt = null,
        ?string $note = null
    ): array {
        $count = max(1, min($count, 100)); // Cap at 100 per batch
        $maxUses = $maxUses ?? 1;
        $codes = [];

        for ($i = 0; $i < $count; $i++) {
            $code = self::generateUniqueCode($tenantId);
            DB::statement(
                "INSERT INTO tenant_invite_codes
                    (tenant_id, code, created_by, max_uses, uses_count, expires_at, note, is_active)
                 VALUES (?, ?, ?, ?, 0, ?, ?, 1)",
                [$tenantId, $code, $createdBy, $maxUses, $expiresAt, $note]
            );
            $codes[] = $code;
        }

        return $codes;
    }

    /**
     * Validate an invite code for use during registration.
     * Does NOT consume it — call redeem() after successful registration.
     *
     * @param int    $tenantId
     * @param string $code
     * @return array{valid: bool, reason?: string, code_id?: int}
     */
    public static function validate(int $tenantId, string $code): array
    {
        $code = strtoupper(trim($code));
        $codeRow = DB::selectOne(
            "SELECT id, max_uses, uses_count, expires_at, is_active
             FROM tenant_invite_codes
             WHERE tenant_id = ? AND code = ?
             LIMIT 1",
            [$tenantId, $code]
        );
        $row = $codeRow ? (array) $codeRow : null;

        if (!$row) {
            return ['valid' => false, 'reason' => 'invalid_code'];
        }

        if (!$row['is_active']) {
            return ['valid' => false, 'reason' => 'code_deactivated'];
        }

        if ($row['uses_count'] >= $row['max_uses']) {
            return ['valid' => false, 'reason' => 'code_exhausted'];
        }

        if ($row['expires_at'] && strtotime($row['expires_at']) < time()) {
            return ['valid' => false, 'reason' => 'code_expired'];
        }

        return ['valid' => true, 'code_id' => (int) $row['id']];
    }

    /**
     * Redeem an invite code (increment uses_count). Call after registration succeeds.
     *
     * @param int $tenantId
     * @param string $code
     * @param int $userId User who used the code
     * @return bool
     */
    public static function redeem(int $tenantId, string $code, int $userId): bool
    {
        $code = strtoupper(trim($code));

        // Atomic increment with validation
        $affected = DB::affectingStatement(
            "UPDATE tenant_invite_codes
             SET uses_count = uses_count + 1, last_used_at = NOW(), last_used_by = ?
             WHERE tenant_id = ? AND code = ? AND is_active = 1 AND uses_count < max_uses
               AND (expires_at IS NULL OR expires_at > NOW())",
            [$userId, $tenantId, $code]
        );

        if ($affected > 0) {
            // Log the redemption
            DB::statement(
                "INSERT INTO tenant_invite_code_uses (invite_code_id, user_id, used_at)
                 SELECT id, ?, NOW() FROM tenant_invite_codes WHERE tenant_id = ? AND code = ?",
                [$userId, $tenantId, $code]
            );
            return true;
        }

        return false;
    }

    /**
     * List invite codes for a tenant (admin view).
     *
     * @param int $tenantId
     * @param int $limit
     * @param int $offset
     * @return array
     */
    public static function listForTenant(int $tenantId, int $limit = 50, int $offset = 0): array
    {
        $limit = max(1, min($limit, 100));
        $offset = max(0, $offset);

        $rows = array_map(static fn ($row) => (array) $row, DB::select(
            "SELECT ic.*, u.first_name AS creator_name
             FROM tenant_invite_codes ic
             LEFT JOIN users u ON u.id = ic.created_by
             WHERE ic.tenant_id = ?
             ORDER BY ic.created_at DESC
             LIMIT ? OFFSET ?",
            [$tenantId, $limit, $offset]
        ));

        $totalRow = DB::selectOne(
            "SELECT COUNT(*) AS cnt FROM tenant_invite_codes WHERE tenant_id = ?",
            [$tenantId]
        );
        $total = $totalRow->cnt ?? 0;

        return [
            'items' => $rows,
            'total' => (int) $total,
            'limit' => $limit,
            'offset' => $offset,
        ];
    }

    /**
     * Deactivate an invite code.
     */
    public static function deactivate(int $tenantId, int $codeId): bool
    {
        return DB::affectingStatement(
            "UPDATE tenant_invite_codes SET is_active = 0 WHERE id = ? AND tenant_id = ?",
            [$codeId, $tenantId]
        ) > 0;
    }

    /**
     * Generate a unique invite code (8 chars, uppercase alphanumeric).
     */
    private static function generateUniqueCode(int $tenantId): string
    {
        $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
        $maxAttempts = 10;

        for ($attempt = 0; $attempt < $maxAttempts; $attempt++) {
            $code = '';
            for ($i = 0; $i < 8; $i++) {
                $code .= $chars[random_int(0, strlen($chars) - 1)];
            }

            // Ensure uniqueness within tenant
            $exists = DB::selectOne(
                "SELECT 1 FROM tenant_invite_codes WHERE tenant_id = ? AND code = ? LIMIT 1",
                [$tenantId, $code]
            );

            if (!$exists) {
                return $code;
            }
        }

        // Extremely unlikely fallback — extend to 12 chars
        $code = '';
        for ($i = 0; $i < 12; $i++) {
            $code .= $chars[random_int(0, strlen($chars) - 1)];
        }
        return $code;
    }
}
