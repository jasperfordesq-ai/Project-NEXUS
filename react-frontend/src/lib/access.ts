// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

type UserLike = {
  role?: unknown;
  is_admin?: unknown;
  is_super_admin?: unknown;
  is_tenant_super_admin?: unknown;
  is_god?: unknown;
  /** Server-resolved super-panel reach — see superPanelLevel() below. */
  super_panel_level?: unknown;
  /** Server-resolved Event-creation capability — see canCreateEvents() below. */
  can_create_events?: unknown;
} | null | undefined;

function userRole(user: UserLike): string {
  return typeof user?.role === 'string' ? user.role : '';
}

export function hasBrokerRole(user: UserLike): boolean {
  return userRole(user) === 'broker';
}

export function hasAdminPanelAccess(user: UserLike): boolean {
  if (hasBrokerRole(user)) return false;

  const role = userRole(user);
  return (
    role === 'admin' ||
    role === 'tenant_admin' ||
    role === 'super_admin' ||
    user?.is_admin === true ||
    user?.is_super_admin === true ||
    user?.is_tenant_super_admin === true ||
    user?.is_god === true
  );
}

export function hasBrokerPanelAccess(user: UserLike): boolean {
  const role = userRole(user);
  return (
    role === 'broker' ||
    role === 'coordinator' ||
    role === 'god' ||
    hasAdminPanelAccess(user)
  );
}

export function isSuperAdminUser(user: UserLike): boolean {
  const role = userRole(user);
  return (
    role === 'super_admin' ||
    role === 'god' ||
    user?.is_super_admin === true ||
    user?.is_tenant_super_admin === true ||
    user?.is_god === true
  );
}

/**
 * Platform super admin — the only role permitted to cross tenants with a
 * single access token. This MUST mirror the server-side cross-tenant rule in
 * `app/Http/Middleware/Authenticate.php` (both the Sanctum and legacy-JWT
 * branches): a token whose user's `tenant_id` differs from the resolved
 * tenant is rejected with 403 `tenant_mismatch` UNLESS the user is
 * `is_super_admin`, `is_god`, or has role `super_admin`/`god`.
 *
 * Deliberately EXCLUDES `is_tenant_super_admin` — a tenant super-admin is
 * scoped to their own tenant and hits the same 403 on any other community,
 * so they must be treated like any other user when switching communities.
 */
export function isPlatformSuperAdminUser(user: UserLike): boolean {
  const role = userRole(user);
  return (
    role === 'super_admin' ||
    role === 'god' ||
    user?.is_super_admin === true ||
    user?.is_god === true
  );
}

/** How far the super panel reaches for this user. Server-resolved. */
export type SuperPanelLevel = 'master' | 'regional' | 'none';

/**
 * The caller's super-panel reach, as decided by the server.
 *
 * 🔴 Never infer this from flags. Whether a super-admin gets the panel — and
 * whether they get the whole installation or only their own branch — depends on
 * more than `is_tenant_super_admin`: their tenant must allow sub-tenants AND have
 * a usable position in the hierarchy, or the backend refuses outright. Guessing
 * from flags would offer a link that 403s, which is worse than no link.
 *
 * Supplied as `super_panel_level` by GET /v2/users/me. Anything unrecognised or
 * absent is treated as 'none' — fail closed, matching the backend.
 */
export function superPanelLevel(user: UserLike): SuperPanelLevel {
  const raw = (user as { super_panel_level?: unknown } | null | undefined)?.super_panel_level;
  if (raw === 'master' || raw === 'regional' || raw === 'none') return raw;

  /*
   * 🔴 Field absent — fall back to the platform flags.
   *
   * `super_panel_level` is new. A client holding a /me payload from before it
   * existed (a cached response, a session spanning the deploy, an older native
   * build) would otherwise have the panel disappear for a genuine platform
   * super-admin. Falling back preserves exactly the previous behaviour.
   *
   * Note the asymmetry, which is deliberate: only the PLATFORM case is inferred.
   * 'regional' is never guessed, because eligibility for it also depends on the
   * community allowing sub-communities and having a usable position in the
   * hierarchy — facts the client does not have. No level, no branch panel.
   */
  return isPlatformSuperAdminUser(user) ? 'master' : 'none';
}

/**
 * True when this user may create an Event in the current community.
 *
 * A community can restrict Event creation to "Brokers and administrators" or
 * "Administrators only" (Admin → Event Settings → Who can create Events). The
 * server enforces that on POST /v2/events; this exists so the UI stops offering
 * a Create button that only refuses after the whole form has been filled in.
 *
 * 🔴 Never infer this from the community's `creation_role` plus the caller's
 * role. The server decision also depends on the account being active and
 * non-deleted, and on broker/coordinator failing closed regardless of any legacy
 * admin flag. Supplied as `can_create_events` by GET /v2/users/me.
 *
 * 🔴 Absent means ALLOWED, deliberately — the opposite of superPanelLevel()'s
 * fail-closed default. The field is new, so a client holding a /me payload from
 * before it existed (cached response, session spanning the deploy, older native
 * build) must keep the button rather than lose it. The overwhelmingly common
 * case is the open default where everyone may create, and the server refuses
 * anyway, so a stale client costs one clear error instead of a missing feature.
 */
export function canCreateEvents(user: UserLike): boolean {
  return (user as { can_create_events?: unknown } | null | undefined)?.can_create_events !== false;
}

/** True when this user should be offered the super panel at all. */
export function canAccessSuperPanel(user: UserLike): boolean {
  return superPanelLevel(user) !== 'none';
}

/**
 * True when the user may only act within their own branch, so the panel must
 * hide its platform-only sections — billing and platform revenue, the federation
 * kill switches, platform capabilities, provisioning, and granting platform
 * super-admin. The API refuses those regardless; this stops the UI showing
 * controls that cannot work.
 */
export function isRegionalSuperPanelUser(user: UserLike): boolean {
  return superPanelLevel(user) === 'regional';
}

/**
 * Partner Timebanks panel — any admin can open the panel (overview,
 * partnerships, directory, activity), like the broker panel entry.
 * The sensitive setup surfaces INSIDE the panel (external protocols,
 * API keys, webhooks, aggregates, data management, network settings,
 * caring peers) are gated on isSuperAdminUser — see PartnersSidebar
 * and partners/routes.tsx (owner decision 2026-07-02).
 */
export function hasPartnerPanelAccess(user: UserLike): boolean {
  return hasAdminPanelAccess(user);
}

/**
 * Security tier, mirroring `AdminUsersController::securityTier()` in PHP.
 *
 * 🔴 Keep the two in step. This exists so the admin UI can predict whether an
 * action against another account will be permitted, and hide it when it will
 * not. It is a MIRROR, never the decision: the server re-evaluates both tiers
 * under a row lock at the moment of the mutation, so a concurrent promotion
 * cannot turn a permitted action into a privileged one.
 *
 *   4  god
 *   3  platform super-admin
 *   2  administrator, or the super-admin of a community
 *   1  broker / coordinator
 *   0  member
 */
export function adminSecurityTier(user: UserLike): number {
  const role = userRole(user);
  const flag = (name: string): boolean =>
    (user as Record<string, unknown> | null | undefined)?.[name] === true;

  if (role === 'god' || flag('is_god')) return 4;
  if (role === 'super_admin' || flag('is_super_admin')) return 3;
  if (
    role === 'admin' ||
    role === 'tenant_admin' ||
    flag('is_admin') ||
    flag('is_tenant_super_admin')
  ) {
    return 2;
  }
  if (role === 'broker' || role === 'coordinator') return 1;
  return 0;
}

/**
 * Will the server let `actor` impersonate `target`?
 *
 * Mirrors `securityActorCanManageTarget()`: god may reach anyone, everyone else
 * needs a STRICTLY higher tier — so the super-admin of a community can view a
 * member as themselves, but not a fellow administrator. Borrowing a peer's
 * authority is exactly what impersonation must not become.
 *
 * The caller must ALSO hold a super-admin capacity (`isSuperAdminUser`), which
 * is what the route's gate checks; this function only answers the tier half.
 */
export function canImpersonateTarget(actor: UserLike, target: UserLike): boolean {
  const actorTier = adminSecurityTier(actor);
  if (actorTier >= 4) return true;
  return actorTier > adminSecurityTier(target);
}
