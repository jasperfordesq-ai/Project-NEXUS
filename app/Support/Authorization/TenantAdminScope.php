<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Canonical predicate for "does this actor hold admin authority over THIS tenant".
 *
 * AdminTier answers a different question — "is this account an admin at all" —
 * and is deliberately tenant-unaware. Using it alone to authorise a tenant-scoped
 * resource grants every community's admin authority over every other community's
 * records, which is exactly the regression this class exists to prevent: dropping
 * the acting user's home-tenant comparison from EventPolicy::hasValidContext()
 * handed a tenant 999 admin all nineteen event abilities on a tenant 2 event,
 * including exportPeople, manageFinance and transferOwnership.
 *
 * 🔴 The fix is NOT to compare the actor's home tenant everywhere. Auth is global
 * in this codebase and an ACTOR LOOKUP must never be tenant-scoped — an organiser
 * whose account row lives on another tenant is still the owner of their own event,
 * and re-scoping identity is what made their own draft 404 at them. Ownership is a
 * separate question, decided by the caller (see EventPolicy's owner branch in
 * hasImplicitFullAuthority). This class decides ADMIN authority only, and answers
 * it per tier:
 *
 *   - platform (is_super_admin / is_god, or those role strings) — every tenant
 *   - network  (is_tenant_super_admin) — own tenant plus its subtree, by
 *     materialised-path prefix, matching SuperPanelAccess's `regional` level
 *   - tenant   (role 'admin'/'tenant_admin', or is_admin) — own tenant ONLY
 *   - anyone else, including broker/coordinator via AdminTier — nothing
 *
 * Deliberately does NOT reuse SuperPanelAccess::canAccessTenant() despite the
 * identical subtree rule: that reads $_SESSION['user_id'] and memoises the first
 * answer in a static, so inside a policy evaluating several users in one request
 * it returns the wrong actor's access. This takes the actor explicitly.
 */
final class TenantAdminScope
{
    /** Platform-wide role strings. Flags are checked separately. */
    private const PLATFORM_ROLES = ['super_admin', 'god'];

    /**
     * @param object|array<string,mixed>|null $user Needs role, the admin flags and
     *                                              tenant_id. A partial SELECT that
     *                                              omits tenant_id fails closed for
     *                                              non-platform admins.
     */
    public static function allows(object|array|null $user, int $tenantId): bool
    {
        if ($user === null || $tenantId <= 0) {
            return false;
        }

        // Not an admin at all (and broker/coordinator fail closed here).
        if (! AdminTier::allows($user)) {
            return false;
        }

        if (self::isPlatformAdmin($user)) {
            return true;
        }

        $homeTenantId = (int) data_get($user, 'tenant_id', 0);
        if ($homeTenantId <= 0) {
            // Unknown home tenant and not platform-wide: nothing to scope against.
            return false;
        }

        if ($homeTenantId === $tenantId) {
            return true;
        }

        // A network admin reaches its own subtree, and nothing above or beside it.
        if ((bool) data_get($user, 'is_tenant_super_admin', false)) {
            return self::isDescendant($homeTenantId, $tenantId);
        }

        return false;
    }

    /** @param object|array<string,mixed> $user */
    private static function isPlatformAdmin(object|array $user): bool
    {
        return (bool) data_get($user, 'is_super_admin', false)
            || (bool) data_get($user, 'is_god', false)
            || in_array((string) data_get($user, 'role', ''), self::PLATFORM_ROLES, true);
    }

    /**
     * Is $tenantId at or below $ancestorTenantId in the tenant tree?
     *
     * Uses the materialised `tenants.path` ('/1/2/5/'). The trailing slash is what
     * makes a prefix test safe: '/1/20/' does not start with '/1/2/'. Fails closed
     * on a missing or empty path, because str_starts_with($x, '') is TRUE and an
     * empty prefix would otherwise admit every tenant.
     */
    private static function isDescendant(int $ancestorTenantId, int $tenantId): bool
    {
        try {
            $rows = DB::table('tenants')
                ->whereIn('id', [$ancestorTenantId, $tenantId])
                ->pluck('path', 'id');

            $prefix = trim((string) ($rows[$ancestorTenantId] ?? ''));
            $target = trim((string) ($rows[$tenantId] ?? ''));

            if ($prefix === '' || $target === '') {
                return false;
            }

            return str_starts_with($target, $prefix);
        } catch (Throwable) {
            // Never widen authority because a lookup failed.
            return false;
        }
    }
}
