// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  hasAdminPanelAccess,
  hasBrokerPanelAccess,
  hasBrokerRole,
  hasPartnerPanelAccess,
  canAccessSuperPanel,
  isPlatformSuperAdminUser,
  isRegionalSuperPanelUser,
  adminSecurityTier,
  canImpersonateTarget,
  superPanelLevel,
  isSuperAdminUser,
  canCreateEvents,
} from './access';

describe('hasBrokerRole', () => {
  it('returns true only for the broker role string', () => {
    expect(hasBrokerRole({ role: 'broker' })).toBe(true);
  });

  it('returns false for other roles', () => {
    expect(hasBrokerRole({ role: 'admin' })).toBe(false);
    expect(hasBrokerRole({ role: 'coordinator' })).toBe(false);
  });

  it('is null/undefined safe', () => {
    expect(hasBrokerRole(null)).toBe(false);
    expect(hasBrokerRole(undefined)).toBe(false);
    expect(hasBrokerRole({})).toBe(false);
  });

  it('ignores a non-string role value', () => {
    expect(hasBrokerRole({ role: 123 })).toBe(false);
  });
});

describe('hasAdminPanelAccess', () => {
  it('grants access for admin role strings', () => {
    expect(hasAdminPanelAccess({ role: 'admin' })).toBe(true);
    expect(hasAdminPanelAccess({ role: 'tenant_admin' })).toBe(true);
    expect(hasAdminPanelAccess({ role: 'super_admin' })).toBe(true);
  });

  it('grants access for each boolean admin flag', () => {
    expect(hasAdminPanelAccess({ is_admin: true })).toBe(true);
    expect(hasAdminPanelAccess({ is_super_admin: true })).toBe(true);
    expect(hasAdminPanelAccess({ is_tenant_super_admin: true })).toBe(true);
    expect(hasAdminPanelAccess({ is_god: true })).toBe(true);
  });

  it('denies brokers even if a boolean admin flag is set', () => {
    expect(hasAdminPanelAccess({ role: 'broker', is_admin: true })).toBe(false);
    expect(hasAdminPanelAccess({ role: 'broker', is_god: true })).toBe(false);
  });

  it('requires the boolean flag to be strictly true', () => {
    // truthy-but-not-true must not unlock the panel
    expect(hasAdminPanelAccess({ is_admin: 1 })).toBe(false);
    expect(hasAdminPanelAccess({ is_admin: 'yes' })).toBe(false);
  });

  it('denies ordinary members and null users', () => {
    expect(hasAdminPanelAccess({ role: 'member' })).toBe(false);
    expect(hasAdminPanelAccess(null)).toBe(false);
    expect(hasAdminPanelAccess(undefined)).toBe(false);
  });
});

describe('isSuperAdminUser', () => {
  it('grants for super_admin and god role strings', () => {
    expect(isSuperAdminUser({ role: 'super_admin' })).toBe(true);
    expect(isSuperAdminUser({ role: 'god' })).toBe(true);
  });

  it('grants for each super-admin boolean flag', () => {
    expect(isSuperAdminUser({ is_super_admin: true })).toBe(true);
    expect(isSuperAdminUser({ is_tenant_super_admin: true })).toBe(true);
    expect(isSuperAdminUser({ is_god: true })).toBe(true);
  });

  it('denies regular admins, tenant admins, brokers, members and null users', () => {
    expect(isSuperAdminUser({ role: 'admin' })).toBe(false);
    expect(isSuperAdminUser({ role: 'tenant_admin' })).toBe(false);
    expect(isSuperAdminUser({ role: 'admin', is_admin: true })).toBe(false);
    expect(isSuperAdminUser({ role: 'broker' })).toBe(false);
    expect(isSuperAdminUser({ role: 'member' })).toBe(false);
    expect(isSuperAdminUser(null)).toBe(false);
    expect(isSuperAdminUser(undefined)).toBe(false);
  });

  it('requires boolean flags to be strictly true', () => {
    expect(isSuperAdminUser({ is_super_admin: 1 })).toBe(false);
    expect(isSuperAdminUser({ is_tenant_super_admin: 'yes' })).toBe(false);
  });
});

describe('isPlatformSuperAdminUser', () => {
  it('grants platform access for platform super-admin and god roles or flags', () => {
    expect(isPlatformSuperAdminUser({ role: 'super_admin' })).toBe(true);
    expect(isPlatformSuperAdminUser({ role: 'god' })).toBe(true);
    expect(isPlatformSuperAdminUser({ is_super_admin: true })).toBe(true);
    expect(isPlatformSuperAdminUser({ is_god: true })).toBe(true);
  });

  it('rejects tenant-scoped super admins and ordinary admin tiers', () => {
    expect(isPlatformSuperAdminUser({ is_tenant_super_admin: true })).toBe(false);
    expect(isPlatformSuperAdminUser({ role: 'tenant_admin' })).toBe(false);
    expect(isPlatformSuperAdminUser({ role: 'admin', is_admin: true })).toBe(false);
    expect(isPlatformSuperAdminUser({ role: 'member' })).toBe(false);
    expect(isPlatformSuperAdminUser(null)).toBe(false);
  });

  it('requires platform boolean flags to be strictly true', () => {
    expect(isPlatformSuperAdminUser({ is_super_admin: 1 })).toBe(false);
    expect(isPlatformSuperAdminUser({ is_god: 'yes' })).toBe(false);
  });
});

describe('hasPartnerPanelAccess', () => {
  it('admits every admin tier (panel is read-mostly; plumbing gates on isSuperAdminUser)', () => {
    expect(hasPartnerPanelAccess({ role: 'admin' })).toBe(true);
    expect(hasPartnerPanelAccess({ role: 'tenant_admin' })).toBe(true);
    expect(hasPartnerPanelAccess({ role: 'super_admin' })).toBe(true);
    expect(hasPartnerPanelAccess({ is_tenant_super_admin: true })).toBe(true);
  });

  it('denies brokers, members and null users', () => {
    expect(hasPartnerPanelAccess({ role: 'broker' })).toBe(false);
    expect(hasPartnerPanelAccess({ role: 'member' })).toBe(false);
    expect(hasPartnerPanelAccess(null)).toBe(false);
    expect(hasPartnerPanelAccess(undefined)).toBe(false);
  });
});

describe('hasBrokerPanelAccess', () => {
  it('grants access for broker/coordinator/god roles', () => {
    expect(hasBrokerPanelAccess({ role: 'broker' })).toBe(true);
    expect(hasBrokerPanelAccess({ role: 'coordinator' })).toBe(true);
    expect(hasBrokerPanelAccess({ role: 'god' })).toBe(true);
  });

  it('also grants access to anyone with admin-panel access', () => {
    expect(hasBrokerPanelAccess({ role: 'admin' })).toBe(true);
    expect(hasBrokerPanelAccess({ is_super_admin: true })).toBe(true);
  });

  it('denies ordinary members and null users', () => {
    expect(hasBrokerPanelAccess({ role: 'member' })).toBe(false);
    expect(hasBrokerPanelAccess(null)).toBe(false);
    expect(hasBrokerPanelAccess(undefined)).toBe(false);
  });
});

/**
 * Super-panel reach: 'master' (whole installation), 'regional' (own community plus
 * descendants), or 'none'.
 *
 * 🔴 The level is decided by the SERVER and arrives on the /me payload, because
 * eligibility depends on facts the client does not have — whether the community
 * allows sub-communities, and whether it has a usable position in the hierarchy.
 */
describe('superPanelLevel / canAccessSuperPanel', () => {
  it('uses the server-supplied level when present', () => {
    expect(superPanelLevel({ super_panel_level: 'master' })).toBe('master');
    expect(superPanelLevel({ super_panel_level: 'regional' })).toBe('regional');
    expect(superPanelLevel({ super_panel_level: 'none' })).toBe('none');
  });

  /**
   * 🔴 The field is new. A client holding a /me payload from before it existed —
   * a cached response, a session spanning the deploy, an older native build —
   * must not silently lose the panel.
   */
  it('falls back to the platform flags when the level is absent', () => {
    expect(superPanelLevel({ is_super_admin: true })).toBe('master');
    expect(superPanelLevel({ is_god: true })).toBe('master');
    expect(superPanelLevel({ role: 'super_admin' })).toBe('master');
    expect(superPanelLevel({ role: 'god' })).toBe('master');
  });

  /**
   * 🔴 Asymmetric on purpose. Only the PLATFORM case is inferred. 'regional' is
   * never guessed from flags: a tenant super-admin on a community that has no
   * children, or no position in the hierarchy, is refused by the backend — so
   * guessing would offer a link that 403s.
   */
  it('never infers regional from is_tenant_super_admin alone', () => {
    expect(superPanelLevel({ is_tenant_super_admin: true })).toBe('none');
    expect(canAccessSuperPanel({ is_tenant_super_admin: true })).toBe(false);
  });

  it('treats an unrecognised level as none', () => {
    expect(superPanelLevel({ super_panel_level: 'sideways' })).toBe('none');
    expect(superPanelLevel({ super_panel_level: 42 })).toBe('none');
    expect(superPanelLevel({ super_panel_level: null })).toBe('none');
  });

  it('gives ordinary users and absent users no reach', () => {
    expect(superPanelLevel({ role: 'member' })).toBe('none');
    expect(superPanelLevel({ is_admin: true })).toBe('none');
    expect(superPanelLevel(null)).toBe('none');
    expect(superPanelLevel(undefined)).toBe('none');
  });

  it('canAccessSuperPanel admits both tiers and nobody else', () => {
    expect(canAccessSuperPanel({ super_panel_level: 'master' })).toBe(true);
    expect(canAccessSuperPanel({ super_panel_level: 'regional' })).toBe(true);
    expect(canAccessSuperPanel({ super_panel_level: 'none' })).toBe(false);
    expect(canAccessSuperPanel(null)).toBe(false);
  });

  it('isRegionalSuperPanelUser is true only for an explicit regional level', () => {
    expect(isRegionalSuperPanelUser({ super_panel_level: 'regional' })).toBe(true);
    expect(isRegionalSuperPanelUser({ super_panel_level: 'master' })).toBe(false);
    // Not inferred from flags — see above.
    expect(isRegionalSuperPanelUser({ is_tenant_super_admin: true })).toBe(false);
    expect(isRegionalSuperPanelUser(null)).toBe(false);
  });
});

/*
 * 🔴 These mirror `AdminUsersController::securityTier()` and
 * `securityActorCanManageTarget()` in PHP. If the PHP changes and these do not,
 * the admin UI starts offering actions the server refuses (a button that can
 * only fail) or hiding ones it permits (a power nobody can find). The second is
 * how the super-admin of a community ended up unable to view a member as
 * themselves, reported 2026-08-05.
 */
describe('adminSecurityTier', () => {
  it('ranks the five tiers the way the server does', () => {
    expect(adminSecurityTier({ role: 'god' })).toBe(4);
    expect(adminSecurityTier({ is_god: true })).toBe(4);
    expect(adminSecurityTier({ role: 'super_admin' })).toBe(3);
    expect(adminSecurityTier({ is_super_admin: true })).toBe(3);
    expect(adminSecurityTier({ role: 'admin' })).toBe(2);
    expect(adminSecurityTier({ is_tenant_super_admin: true })).toBe(2);
    expect(adminSecurityTier({ role: 'broker' })).toBe(1);
    expect(adminSecurityTier({ role: 'coordinator' })).toBe(1);
    expect(adminSecurityTier({ role: 'member' })).toBe(0);
    expect(adminSecurityTier(null)).toBe(0);
  });

  it('treats the super-admin of a community as an administrator, not a platform admin', () => {
    // The distinction that matters: tier 2, so they outrank members but are not
    // above a fellow administrator, and are nowhere near platform level.
    expect(adminSecurityTier({ is_tenant_super_admin: true })).toBeLessThan(
      adminSecurityTier({ is_super_admin: true }),
    );
  });
});

describe('canImpersonateTarget', () => {
  const tenantSuper = { is_tenant_super_admin: true, role: 'admin' };

  it('lets the super-admin of a community view one of its members', () => {
    expect(canImpersonateTarget(tenantSuper, { role: 'member' })).toBe(true);
  });

  it('refuses a peer administrator', () => {
    expect(canImpersonateTarget(tenantSuper, { role: 'admin' })).toBe(false);
    expect(canImpersonateTarget(tenantSuper, { is_tenant_super_admin: true })).toBe(false);
  });

  it('refuses anyone above the actor', () => {
    expect(canImpersonateTarget(tenantSuper, { is_super_admin: true })).toBe(false);
    expect(canImpersonateTarget(tenantSuper, { is_god: true })).toBe(false);
    expect(canImpersonateTarget({ is_super_admin: true }, { is_god: true })).toBe(false);
  });

  it('lets a broker be impersonated by an administrator but not by another broker', () => {
    expect(canImpersonateTarget(tenantSuper, { role: 'broker' })).toBe(true);
    expect(canImpersonateTarget({ role: 'broker' }, { role: 'coordinator' })).toBe(false);
  });

  it('gives god a way past every tier, matching the server carve-out', () => {
    expect(canImpersonateTarget({ is_god: true }, { is_god: true })).toBe(true);
    expect(canImpersonateTarget({ is_god: true }, { is_super_admin: true })).toBe(true);
  });

  it('refuses a plain member outright', () => {
    expect(canImpersonateTarget({ role: 'member' }, { role: 'member' })).toBe(false);
  });
});

describe('canCreateEvents', () => {
  it('uses the server-supplied capability when present', () => {
    expect(canCreateEvents({ can_create_events: true })).toBe(true);
    expect(canCreateEvents({ can_create_events: false })).toBe(false);
  });

  /**
   * 🔴 Absent means ALLOWED — deliberately the opposite of superPanelLevel()'s
   * fail-closed default. The field is new, so a client holding a /me payload
   * from before it existed (cached response, session spanning the deploy, older
   * native build) must keep the Create button rather than lose it. The common
   * case by far is the open default, and the server refuses regardless, so a
   * stale client costs one clear error instead of a missing feature.
   */
  it('treats an absent capability as allowed', () => {
    expect(canCreateEvents({})).toBe(true);
    expect(canCreateEvents(null)).toBe(true);
    expect(canCreateEvents(undefined)).toBe(true);
  });

  /**
   * Only an explicit `false` hides the button. Anything else — a truthy string
   * from a loose serializer, a null, a number — must not be read as a refusal,
   * because guessing wrong here removes a feature rather than showing an error.
   */
  it('only an explicit false denies', () => {
    expect(canCreateEvents({ can_create_events: null })).toBe(true);
    expect(canCreateEvents({ can_create_events: 0 })).toBe(true);
    expect(canCreateEvents({ can_create_events: 'false' })).toBe(true);
  });

  it('ignores role and admin flags entirely', () => {
    // The decision is the server's. A plain member may create on the open
    // default; an admin must not be admitted by role alone when told otherwise.
    expect(canCreateEvents({ role: 'member' })).toBe(true);
    expect(canCreateEvents({ role: 'admin', can_create_events: false })).toBe(false);
    expect(canCreateEvents({ is_super_admin: true, can_create_events: false })).toBe(false);
  });
});
