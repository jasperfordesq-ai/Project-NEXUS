<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

/**
 * A checked import, held by the server between the check and the last batch.
 * After the check the browser never sends member data again; it only names
 * rows of this session (owner, 8 Oct 2026: "a user must not corrupt our
 * database"). Holds personal data, so it expires after two hours.
 */
final class MemberImportSession
{
    public const TTL_SECONDS = 7200;

    /** @param list<array<string, mixed>> $rows */
    public static function create(int $tenantId, int $adminId, array $rows, string $fileName, string $fileSha256): string
    {
        $id = (string) Str::uuid();
        self::save([
            'id' => $id,
            'tenant_id' => $tenantId,
            'admin_id' => $adminId,
            'rows' => $rows,
            'file_name' => $fileName,
            'file_sha256' => $fileSha256,
            'identity_attested' => false,
            'next_index' => 0,
            'status' => 'ready',
            'stop' => null,
            'totals' => ['created' => 0, 'balance_cents' => 0, 'zeroed' => 0],
            'created_at' => now()->toIso8601String(),
            'finished_at' => null,
        ]);

        return $id;
    }

    /** @return array<string, mixed>|null */
    public static function load(string $id, int $tenantId, int $adminId): ?array
    {
        $session = Cache::get(self::key($id, $tenantId));
        if (!is_array($session) || (int) $session['tenant_id'] !== $tenantId || (int) $session['admin_id'] !== $adminId) {
            return null;
        }

        return $session;
    }

    /** @param array<string, mixed> $session */
    public static function save(array $session): void
    {
        Cache::put(self::key((string) $session['id'], (int) $session['tenant_id']), $session, self::TTL_SECONDS);
    }

    public static function lock(string $id): Lock
    {
        return Cache::lock('member_import_lock:' . $id, 120);
    }

    private static function key(string $id, int $tenantId): string
    {
        return "member_import:{$tenantId}:{$id}";
    }
}
