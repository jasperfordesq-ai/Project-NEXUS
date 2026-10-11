<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

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
 *   - tenant super admin (is_tenant_super_admin) — own tenant ONLY
 *   - tenant admin (role 'admin'/'tenant_admin', or is_admin) — own tenant ONLY
 *   - anyone else, including broker/coordinator via AdminTier — nothing
 *
 * 🔴 OWNER DECISION, 11 October 2026 (verbatim): "I don't want tenant admins to
 * act outside of the home community or tenant super admins, or normal tenant
 * admins." Only the platform owner (is_super_admin / is_god, or the
 * 'super_admin' / 'god' role strings) keeps cross-community reach.
 *
 * Until that date a tenant super admin (a "network admin") also reached every
 * sub-tenant beneath its own, by materialised-path prefix on `tenants.path`,
 * mirroring SuperPanelAccess's `regional` level. That subtree reach is removed:
 * a tenant super admin now holds exactly a tenant admin's authority, over its
 * own community and nothing else. Do not reintroduce a hierarchy rule here — a
 * sub-community's records are acted on by that community's own admins or by the
 * platform owner. SuperPanelAccess (the super-admin panel's own gate) is a
 * separate decision and was deliberately not changed by this one.
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

        // Own community only — for a tenant super admin exactly as for a tenant
        // admin. No reach into sub-communities (owner decision, 11 Oct 2026).
        return $homeTenantId === $tenantId;
    }

    /**
     * The platform owner (is_super_admin / is_god, or those role strings): the
     * only account that may act across communities (owner decision,
     * 11 Oct 2026). For callers that look an actor up outside the record's own
     * community before asking {@see allows()}.
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
}
