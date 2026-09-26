<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

final class GroupJoinRequestDecisionReceiptService
{
    /** @return array{key_hash:string,request_hash:string}|null|false */
    public static function identity(?string $key, array $intent): array|null|false
    {
        $key = trim((string) $key);
        if ($key === '') {
            return null;
        }
        if (strlen($key) < 8 || strlen($key) > 191) {
            return false;
        }

        ksort($intent);

        return [
            'key_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', json_encode(
                $intent,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            )),
        ];
    }

    public static function lockManager(int $tenantId, int $managerUserId): void
    {
        DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $managerUserId)
            ->lockForUpdate()
            ->exists();
    }

    public static function find(int $tenantId, int $managerUserId, string $keyHash): ?object
    {
        return DB::table('group_join_request_decision_receipts')
            ->where('tenant_id', $tenantId)
            ->where('manager_user_id', $managerUserId)
            ->where('idempotency_key_hash', $keyHash)
            ->first();
    }

    public static function matches(object $receipt, string $requestHash): bool
    {
        return hash_equals((string) $receipt->request_hash, $requestHash);
    }

    /** @param array{key_hash:string,request_hash:string} $identity */
    public static function store(
        int $tenantId,
        int $managerUserId,
        int $groupId,
        int $requesterUserId,
        string $action,
        array $identity,
        array $resultPayload,
    ): void {
        DB::table('group_join_request_decision_receipts')->insert([
            'tenant_id' => $tenantId,
            'manager_user_id' => $managerUserId,
            'group_id' => $groupId,
            'requester_user_id' => $requesterUserId,
            'action' => $action,
            'idempotency_key_hash' => $identity['key_hash'],
            'request_hash' => $identity['request_hash'],
            'result_payload' => json_encode(
                $resultPayload,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            ),
            'created_at' => now(),
        ]);
    }
}
