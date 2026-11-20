<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Billing;

use App\Core\TenantContext;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Is this community locked for non-payment?
 *
 * A community is locked when it, or a community above it in its line, is
 * suspended in `tenant_billing_standing` — unless an exempt community stands
 * between the two (an exemption shields a community and everything below it
 * from a suspension above it).
 *
 * This is NOT `tenants.is_active`. A deactivated community is off for
 * everyone, its own admins included; a locked community keeps its admin panel
 * so its admins can find out why. Nothing here reads or writes `is_active`.
 *
 * Cost. The question is asked on every API request, so the whole platform's
 * suspended and exempt ids are read once and cached under ONE key. With
 * nobody suspended — the normal state — the answer is `false` without looking
 * at the community at all. The lock is computed from each community's line
 * on every call, never copied down the tree, so moving a community needs no
 * cache clearing and a change is visible after forgetting one key.
 */
final class BillingLock
{
    public const CACHE_KEY = 'billing_lock:state';

    /** Seconds. Also the longest a change made outside the service takes to show. */
    public const CACHE_TTL = 60;

    /** A line longer than this is treated as broken data, not walked for ever. */
    private const MAX_DEPTH = 20;

    private static bool $cacheFailureReported = false;

    public static function isLocked(int $tenantId): bool
    {
        return self::reasonFor($tenantId) !== null;
    }

    /**
     * The suspended community that locks this one, or null when it is open.
     *
     * @return array{tenant_id:int, own:bool, suspended_at:string, source:string}|null
     */
    public static function reasonFor(int $tenantId): ?array
    {
        if ($tenantId < 1) {
            return null;
        }

        $state = self::state();
        if ($state['suspended'] === []) {
            return null;
        }

        foreach (self::lineNearestFirst($tenantId) as $id) {
            if (isset($state['exempt'][$id])) {
                return null;
            }

            if (isset($state['suspended'][$id])) {
                return [
                    'tenant_id' => $id,
                    'own' => $id === $tenantId,
                    'suspended_at' => $state['suspended'][$id]['suspended_at'],
                    'source' => $state['suspended'][$id]['source'],
                ];
            }
        }

        return null;
    }

    /**
     * The community itself, then its parent, and so on up to the root.
     *
     * Read from `tenants.path` (`/1/2/101/`). A path that is empty, or does not
     * end at this community, is not trusted — TenantHierarchyService itself
     * treats paths as repairable — and the line is walked by `parent_id`.
     *
     * @return list<int>
     */
    public static function lineNearestFirst(int $tenantId): array
    {
        $row = self::tenantRow($tenantId);
        if ($row === null) {
            return [$tenantId];
        }

        $fromPath = self::parsePath($row['path'], $tenantId);
        if ($fromPath !== null) {
            return $fromPath;
        }

        $line = [$tenantId];
        $parentId = $row['parent_id'];

        while ($parentId !== null && $parentId > 0 && !in_array($parentId, $line, true) && count($line) < self::MAX_DEPTH) {
            $line[] = $parentId;
            $parent = DB::table('tenants')->where('id', $parentId)->first(['parent_id']);
            $parentId = ($parent && $parent->parent_id !== null) ? (int) $parent->parent_id : null;
        }

        return $line;
    }

    /** Forget the cached lists. Call after every change to a standing row. */
    public static function flush(): void
    {
        try {
            Cache::forget(self::CACHE_KEY);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }
    }

    /**
     * @return array{suspended: array<int, array{suspended_at:string, source:string}>, exempt: array<int, true>}
     */
    private static function state(): array
    {
        try {
            $cached = Cache::get(self::CACHE_KEY);
        } catch (\Throwable $e) {
            // The cache being down must neither unlock a suspended community
            // nor fail the request: read the two short lists directly.
            self::reportCacheFailure($e);

            return self::readState();
        }

        if (is_array($cached) && isset($cached['suspended'], $cached['exempt'])) {
            return $cached;
        }

        $state = self::readState();

        try {
            Cache::put(self::CACHE_KEY, $state, self::CACHE_TTL);
        } catch (\Throwable $e) {
            self::reportCacheFailure($e);
        }

        return $state;
    }

    /**
     * @return array{suspended: array<int, array{suspended_at:string, source:string}>, exempt: array<int, true>}
     */
    private static function readState(): array
    {
        $state = ['suspended' => [], 'exempt' => []];

        $rows = DB::table('tenant_billing_standing')
            ->where(static function ($query): void {
                $query->whereNotNull('suspended_at')->orWhere('exempt', 1);
            })
            ->get(['tenant_id', 'suspended_at', 'suspension_source', 'exempt']);

        foreach ($rows as $row) {
            $id = (int) $row->tenant_id;

            if (!empty($row->exempt)) {
                $state['exempt'][$id] = true;
            }

            if ($row->suspended_at !== null) {
                $state['suspended'][$id] = [
                    'suspended_at' => (string) $row->suspended_at,
                    'source' => (string) ($row->suspension_source ?? 'manual'),
                ];
            }
        }

        return $state;
    }

    /**
     * @return array{parent_id: int|null, path: string|null}|null
     */
    private static function tenantRow(int $tenantId): ?array
    {
        // The request's own community is already loaded: do not read it again.
        // currentId() first, because get() resolves a default community when
        // none is set, and a queued job must not acquire one as a side effect.
        $current = TenantContext::currentId() === $tenantId ? TenantContext::get() : null;
        if (
            is_array($current)
            && (int) ($current['id'] ?? 0) === $tenantId
            && array_key_exists('path', $current)
            && array_key_exists('parent_id', $current)
        ) {
            return [
                'parent_id' => $current['parent_id'] !== null ? (int) $current['parent_id'] : null,
                'path' => $current['path'] !== null ? (string) $current['path'] : null,
            ];
        }

        $row = DB::table('tenants')->where('id', $tenantId)->first(['parent_id', 'path']);
        if (!$row) {
            return null;
        }

        return [
            'parent_id' => $row->parent_id !== null ? (int) $row->parent_id : null,
            'path' => $row->path !== null ? (string) $row->path : null,
        ];
    }

    /**
     * @return list<int>|null Nearest first, or null when the path cannot be trusted.
     */
    private static function parsePath(?string $path, int $tenantId): ?array
    {
        $trimmed = trim((string) $path, '/');
        if ($trimmed === '') {
            return null;
        }

        $ids = [];
        foreach (explode('/', $trimmed) as $part) {
            if ($part === '' || !ctype_digit($part) || (int) $part < 1) {
                return null;
            }
            $ids[] = (int) $part;
        }

        if (end($ids) !== $tenantId || count($ids) !== count(array_unique($ids)) || count($ids) > self::MAX_DEPTH) {
            return null;
        }

        return array_reverse($ids);
    }

    private static function reportCacheFailure(\Throwable $e): void
    {
        if (self::$cacheFailureReported) {
            return;
        }

        self::$cacheFailureReported = true;
        Log::error('[BillingLock] cache unavailable; reading payment standing from the database', [
            'error' => $e->getMessage(),
        ]);
    }
}
