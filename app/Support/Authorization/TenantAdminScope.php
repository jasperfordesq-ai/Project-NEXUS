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
 *   - tenant super admin (is_tenant_super_admin) — own tenant PLUS every
 *     descendant tenant, by materialised-path prefix; never an ancestor, never a
 *     sibling, never a separate root
 *   - tenant admin (role 'admin'/'tenant_admin', or is_admin) — own tenant ONLY
 *   - anyone else, including broker/coordinator via AdminTier — nothing
 *
 * 🔴 OWNER RULE, 12 October 2026 (verbatim): "A tenant super admin can
 * administer all communities below it in the hierarchy, but not above it." and
 * "A tenant super admin should be able to administer all tenants below it, but
 * not above it."
 *
 * "Below" is decided by `tenants.path` ('/1/4/11/'): the target's path must start
 * with the actor's home path, anchored on the trailing slash so '/1/2/' never
 * admits '/1/20/'. A tenant super admin on the master tenant (id 1) is no
 * exception: it reaches tenants whose path is under '/1/', not separate roots
 * such as '/3/'. There is no "master" level for a tenant super admin — reaching
 * everything is the platform tier's alone. A missing or empty path on either
 * side fails closed (an empty prefix would match every tenant), and so does a
 * failed lookup.
 *
 * History, so the record stays honest: until 11 October 2026 this class already
 * gave a tenant super admin its subtree. On 11 October an "own community only"
 * reading removed that (commit dc6acfd0a). The owner corrected it on 12 October
 * with the rule quoted above, and the subtree reach was restored.
 *
 * Deliberately not TenantSubtree::descendantIds(): that helper serves sign-in,
 * so it falls back to a parent_id walk when a path is missing and skips inactive
 * tenants. An authority check must instead fail closed on a missing path.
 *
 * This class takes the actor explicitly. Never swap it for
 * SuperPanelAccess::canAccessTenant(): that reads $_SESSION['user_id'] and
 * memoises the first answer in a static, so inside a policy evaluating several
 * users in one request it returns the wrong actor's access.
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

        // A tenant super admin reaches every community below its own, and
        // nothing above or beside it (owner rule, 12 Oct 2026). A tenant admin
        // stops at its own community.
        if ((bool) data_get($user, 'is_tenant_super_admin', false)) {
            return self::isDescendant($homeTenantId, $tenantId);
        }

        return false;
    }

    /**
     * The platform owner (is_super_admin / is_god, or those role strings): the
     * only account that reaches EVERY community. A tenant super admin also acts
     * outside its home community, but only below it — ask {@see allows()} for
     * that. Callers that look an actor up outside the record's own community
     * should ask allows(), not this.
     *
     * @param object|array<string,mixed>|null $user
     */
    public static function isPlatformOwner(object|array|null $user): bool
    {
        return $user !== null && AdminTier::allows($user) && self::isPlatformAdmin($user);
    }

    /** @param object|array<string,mixed> $user */
    private static function isPlatformAdmin(object|array $user): bool
    {
        return (bool) data_get($user, 'is_super_admin', false)
            || (bool) data_get($user, 'is_god', false)
            || in_array((string) data_get($user, 'role', ''), self::PLATFORM_ROLES, true);
    }

    /**
     * Is $tenantId strictly below $ancestorTenantId in the tenant tree?
     *
     * Uses the materialised `tenants.path` ('/1/2/5/'). Both paths are normalised
     * to end in exactly one '/', so the prefix test is anchored: '/1/20/' does
     * not start with '/1/2/'. Fails closed on a missing, empty or root-only path,
     * because str_starts_with($x, '/') is TRUE for every tenant and an empty
     * prefix would otherwise admit everything. A tenant is never its own
     * descendant.
     *
     * Public so the request-level gate (CrossTenantEntry) uses this exact test
     * rather than a second copy of it.
     */
    public static function isDescendant(int $ancestorTenantId, int $tenantId): bool
    {
        try {
            $rows = DB::table('tenants')
                ->whereIn('id', [$ancestorTenantId, $tenantId])
                ->pluck('path', 'id');

            $prefix = self::normalisedPath($rows[$ancestorTenantId] ?? null);
            $target = self::normalisedPath($rows[$tenantId] ?? null);

            if ($prefix === null || $target === null || $target === $prefix) {
                return false;
            }

            return str_starts_with($target, $prefix);
        } catch (Throwable) {
            // Never widen authority because a lookup failed.
            return false;
        }
    }

    /** '/1/4' or '/1/4/' becomes '/1/4/'; null, '' and '/' become null. */
    private static function normalisedPath(mixed $path): ?string
    {
        $trimmed = trim(is_string($path) ? $path : '', " \t\n\r\0\x0B/");

        return $trimmed === '' ? null : '/' . $trimmed . '/';
    }
}
