<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

final class GroupContentCreationReceiptService
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

        return [
            'key_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', json_encode(
                self::canonicalize($intent),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            )),
        ];
    }

    public static function lockActor(int $tenantId, int $userId): void
    {
        DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->lockForUpdate()
            ->exists();
    }

    public static function find(int $tenantId, int $userId, string $operationType, string $keyHash): ?object
    {
        return DB::table('group_content_creation_receipts')
            ->where('tenant_id', $tenantId)
            ->where('actor_user_id', $userId)
            ->where('operation_type', $operationType)
            ->where('idempotency_key_hash', $keyHash)
            ->first();
    }

    public static function matches(object $receipt, string $requestHash): bool
    {
        return hash_equals((string) $receipt->request_hash, $requestHash);
    }

    /** @return array<string,mixed>|null */
    public static function payload(object $receipt): ?array
    {
        $payload = json_decode((string) $receipt->result_payload, true);
        return is_array($payload) ? $payload : null;
    }

    public static function store(
        int $tenantId,
        int $userId,
        int $groupId,
        string $operationType,
        array $identity,
        int $resultId,
        array $resultPayload,
    ): void {
        DB::table('group_content_creation_receipts')->insert([
            'tenant_id' => $tenantId,
            'actor_user_id' => $userId,
            'group_id' => $groupId,
            'operation_type' => $operationType,
            'idempotency_key_hash' => $identity['key_hash'],
            'request_hash' => $identity['request_hash'],
            'result_id' => $resultId,
            'result_payload' => json_encode($resultPayload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'created_at' => now(),
        ]);
    }

    public static function deleteForResult(
        int $tenantId,
        int $groupId,
        string $operationType,
        int $resultId,
    ): int {
        return DB::table('group_content_creation_receipts')
            ->where('tenant_id', $tenantId)
            ->where('group_id', $groupId)
            ->where('operation_type', $operationType)
            ->where('result_id', $resultId)
            ->delete();
    }

    private static function canonicalize(array $value): array
    {
        foreach ($value as $key => $item) {
            if (is_array($item)) {
                $value[$key] = self::canonicalize($item);
            }
        }
        if (! array_is_list($value)) {
            ksort($value);
        }
        return $value;
    }
}
