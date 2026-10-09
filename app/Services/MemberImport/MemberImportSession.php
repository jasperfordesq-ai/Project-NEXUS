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
 *
 * Two cache records, on purpose. The normalised rows can be about a megabyte
 * and never change, so they are written ONCE, in create(). The progress record
 * (position, status, totals) is small and the runner saves it after every
 * member; keeping the rows inside it would re-send them to the cache up to
 * 5,000 times per import. The runner discards the rows when the import
 * completes or stops, so personal data is not held after it is needed.
 *
 * Bounded: one held, never-started import per administrator per community.
 * The cache is the shared Redis (128 MB, allkeys-lru — queue and rate-limit
 * counters live there too), and a 5,000-row import is about a megabyte, so
 * repeated checks must not pile up. create() remembers the admin's latest
 * import; a new check deletes the previous one's rows and progress record if
 * it never started ('ready'). A previous import that is running (perhaps in
 * another tab) is left alone and keeps going; one whose batch holds the lock
 * right now is left alone too. Checks are also rate-limited (10 a minute).
 */
final class MemberImportSession
{
    public const TTL_SECONDS = 7200;

    /** @param list<array<string, mixed>> $rows */
    public static function create(int $tenantId, int $adminId, array $rows, string $fileName, string $fileSha256): string
    {
        self::discardPreviousIfNeverStarted($tenantId, $adminId);

        $id = (string) Str::uuid();
        Cache::put(self::rowsKey($id, $tenantId), $rows, self::TTL_SECONDS);
        self::save([
            'id' => $id,
            'tenant_id' => $tenantId,
            'admin_id' => $adminId,
            'total' => count($rows),
            'file_name' => $fileName,
            'file_sha256' => $fileSha256,
            'identity_attested' => false,
            'send_invitations' => false,
            'next_index' => 0,
            'status' => 'ready',
            'stop' => null,
            'totals' => ['created' => 0, 'balance_cents' => 0, 'zeroed' => 0, 'invitations_queued' => 0],
            'created_at' => now()->toIso8601String(),
            'finished_at' => null,
        ]);
        Cache::put(self::latestKey($tenantId, $adminId), $id, self::TTL_SECONDS);

        return $id;
    }

    private static function discardPreviousIfNeverStarted(int $tenantId, int $adminId): void
    {
        $previousId = Cache::get(self::latestKey($tenantId, $adminId));
        if (!is_string($previousId)) {
            return;
        }
        // Under the import's own lock, so a first batch cannot start between the
        // status check and the delete. Busy means a batch is running: leave it.
        $lock = self::lock($previousId);
        if (!$lock->get()) {
            return;
        }
        try {
            $previous = self::load($previousId, $tenantId, $adminId);
            if ($previous !== null && $previous['status'] === 'ready') {
                self::discardRows($previous);
                Cache::forget(self::stateKey($previousId, $tenantId));
            }
        } finally {
            $lock->release();
        }
    }

    /**
     * The progress record only (no rows), or null when it is missing, expired,
     * malformed or belongs to another community or admin.
     *
     * @return array<string, mixed>|null
     */
    public static function load(string $id, int $tenantId, int $adminId): ?array
    {
        if (!Str::isUuid($id)) {
            return null;
        }
        $state = Cache::get(self::stateKey($id, $tenantId));
        if (!is_array($state) || !isset($state['tenant_id'], $state['admin_id'])
            || (int) $state['tenant_id'] !== $tenantId || (int) $state['admin_id'] !== $adminId) {
            return null;
        }

        return $state;
    }

    /**
     * The held rows, or null once they have expired or been discarded.
     *
     * @param array<string, mixed> $state
     * @return list<array<string, mixed>>|null
     */
    public static function rows(array $state): ?array
    {
        $rows = Cache::get(self::rowsKey((string) $state['id'], (int) $state['tenant_id']));

        return is_array($rows) ? array_values($rows) : null;
    }

    /** Writes the progress record only; the rows are never rewritten. @param array<string, mixed> $state */
    public static function save(array $state): void
    {
        unset($state['rows']);
        Cache::put(self::stateKey((string) $state['id'], (int) $state['tenant_id']), $state, self::TTL_SECONDS);
    }

    /** @param array<string, mixed> $state */
    public static function discardRows(array $state): void
    {
        Cache::forget(self::rowsKey((string) $state['id'], (int) $state['tenant_id']));
    }

    public static function lock(string $id): Lock
    {
        return Cache::lock('member_import_lock:' . $id, 120);
    }

    private static function stateKey(string $id, int $tenantId): string
    {
        return "member_import:{$tenantId}:{$id}";
    }

    private static function rowsKey(string $id, int $tenantId): string
    {
        return "member_import_rows:{$tenantId}:{$id}";
    }

    private static function latestKey(int $tenantId, int $adminId): string
    {
        return "member_import_latest:{$tenantId}:{$adminId}";
    }
}
