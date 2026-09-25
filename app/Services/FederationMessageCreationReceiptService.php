<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

final class FederationMessageCreationReceiptService
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

    public static function lockSender(int $tenantId, int $userId): void
    {
        DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->lockForUpdate()
            ->exists();
    }

    public static function find(int $tenantId, int $userId, string $keyHash): ?object
    {
        return DB::table('federation_message_creation_receipts')
            ->where('sender_tenant_id', $tenantId)
            ->where('sender_user_id', $userId)
            ->where('idempotency_key_hash', $keyHash)
            ->first();
    }

    public static function store(
        int $tenantId,
        int $userId,
        array $identity,
        int $outboundMessageId,
        int $inboundMessageId,
    ): void {
        DB::table('federation_message_creation_receipts')->insert([
            'sender_tenant_id' => $tenantId,
            'sender_user_id' => $userId,
            'idempotency_key_hash' => $identity['key_hash'],
            'request_hash' => $identity['request_hash'],
            'outbound_message_id' => $outboundMessageId,
            'inbound_message_id' => $inboundMessageId,
            'created_at' => now(),
        ]);
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
