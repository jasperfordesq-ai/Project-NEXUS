<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Tenancy;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Resolves the descendant tenants of a hub tenant.
 *
 * This exists for the logged-out entry points (login, forgot-password). A
 * sub-tenant with no domain of its own is only reachable when the URL carries
 * its slug — e.g. `uk.timebank.global/minehead-and-coast-timebank`. Land on the
 * parent domain root and `TenantContext` resolves the PARENT, so a strict
 * `tenant_id = ?` lookup cannot see the member's account at all. Login then
 * fails and the password reset silently sends nothing.
 *
 * Widening those two lookups to the resolved tenant's subtree fixes it for
 * communities with and without their own domain, without letting a request
 * escape the hub it arrived on: the boundary is always a prefix match on the
 * materialised path, never "any tenant".
 */
final class TenantSubtree
{
    /**
     * Descendant tenant IDs of $tenantId, excluding $tenantId itself.
     *
     * The boundary is a prefix match on `tenants.path` (e.g. `/1/4/11/`), which
     * covers grandchildren too — landing on `timebank.global` must still find a
     * member two levels down. `path` is nullable, so fall back to a bounded
     * `parent_id` walk rather than returning everything (a LIKE '%' would).
     *
     * @return list<int>
     */
    public static function descendantIds(?int $tenantId): array
    {
        if ($tenantId === null || $tenantId <= 0) {
            return [];
        }

        try {
            $row = DB::table('tenants')
                ->select('path')
                ->where('id', $tenantId)
                ->first();

            if ($row === null) {
                return [];
            }

            $path = is_string($row->path ?? null) ? trim($row->path) : '';

            if ($path !== '' && $path !== '/') {
                // Anchor on the trailing slash so /1/4/1/ can never match /1/4/11/.
                $prefix = rtrim($path, '/') . '/';

                return DB::table('tenants')
                    ->where('id', '!=', $tenantId)
                    ->where('is_active', 1)
                    ->where('path', 'like', $prefix . '%')
                    ->orderBy('id')
                    ->pluck('id')
                    ->map(static fn ($id): int => (int) $id)
                    ->all();
            }

            return self::walkChildren($tenantId);
        } catch (\Throwable $e) {
            // Never let a hierarchy lookup break signing in. Falling back to an
            // empty subtree restores the old strict-tenant behaviour, which is
            // wrong for sub-tenants but never wrong for anyone else.
            Log::warning('[TenantSubtree] descendant lookup failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);

            return [];
        }
    }

    /**
     * Breadth-first `parent_id` walk, used only when the hub has no
     * materialised path. Depth-capped because a cycle in `parent_id` would
     * otherwise spin forever.
     *
     * @return list<int>
     */
    private static function walkChildren(int $tenantId, int $maxDepth = 6): array
    {
        $found = [];
        $frontier = [$tenantId];

        for ($depth = 0; $depth < $maxDepth && $frontier !== []; $depth++) {
            $children = DB::table('tenants')
                ->whereIn('parent_id', $frontier)
                ->where('is_active', 1)
                ->orderBy('id')
                ->pluck('id')
                ->map(static fn ($id): int => (int) $id)
                ->all();

            // Guard against a parent_id cycle re-presenting a tenant we have
            // already expanded.
            $frontier = array_values(array_diff($children, $found, [$tenantId]));
            foreach ($frontier as $id) {
                $found[] = $id;
            }
        }

        sort($found);

        return array_values(array_unique($found));
    }
}
