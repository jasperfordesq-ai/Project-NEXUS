// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TenantListItem } from '@/lib/api/tenant';
import {
  adoptSignInTenant,
  classifyCrossCommunityAdmin,
  decideSignInTenant,
  isCrossCommunityAdmin,
  type SignInTenantInput,
} from './signInTenant';

/**
 * The shape of the real thing: a hub with a sub-community underneath it. A sub-community
 * has no address of its own and is served beneath its hub, so its members reach the
 * sign-in screen at the hub.
 */
const HUB: TenantListItem = { id: 7, slug: 'uk-timebank', name: 'UK Timebank', logo_url: null };
const SUB: TenantListItem = { id: 42, slug: 'stratford', name: 'Stratford', logo_url: null };
const TENANTS = [HUB, SUB];

function input(overrides: Partial<SignInTenantInput> = {}): SignInTenantInput {
  return {
    userTenantId: SUB.id,
    currentTenantId: HUB.id,
    currentSlug: HUB.slug,
    adminExemption: 'not-exempt',
    tenants: TENANTS,
    ...overrides,
  };
}

describe('which community the app should be in after signing in', () => {
  /**
   * 🔴 The reported failure, 2026-09-09, release 1.4.0+7. A member of a sub-community
   * signed in at the hub — the only place they can — and the server issued a token for
   * their own community while the app carried on asking about the hub. Every request came
   * back 403 `TENANT_MISMATCH`: unread count, notification count and push registration,
   * all inside one second. Signed in, and nothing worked.
   */
  it('moves the app to the community the session was issued for', () => {
    expect(decideSignInTenant(input())).toEqual({ action: 'adopt', slug: 'stratford' });
  });

  it('leaves a member who signed in to their own community alone', () => {
    expect(decideSignInTenant(input({ userTenantId: HUB.id })))
      .toEqual({ action: 'keep', reason: 'already-correct' });
  });

  /**
   * The common case must cost nothing. Every ordinary sign-in reaches this line, and an
   * extra network round-trip on all of them to rescue a rare one is a bad trade.
   */
  it('answers "already correct" without needing the community list', () => {
    expect(decideSignInTenant(input({ userTenantId: HUB.id, tenants: null })))
      .toEqual({ action: 'keep', reason: 'already-correct' });
  });

  it('asks for the community list when it cannot tell from the ids alone', () => {
    expect(decideSignInTenant(input({ tenants: null }))).toEqual({ action: 'lookup' });
  });

  /**
   * A cold start that could not load the community config leaves the app with no id to
   * compare. The slug is still known, and the slug is exactly what the server compares —
   * `TenantContext` resolves `X-Tenant-Slug` to a community and checks that against the
   * token.
   */
  it('decides on the slug when the current community id is not known yet', () => {
    expect(decideSignInTenant(input({ currentTenantId: null })))
      .toEqual({ action: 'adopt', slug: 'stratford' });
    expect(decideSignInTenant(input({ currentTenantId: null, userTenantId: HUB.id })))
      .toEqual({ action: 'keep', reason: 'already-correct' });
  });

  /**
   * 🔴 A platform super admin is exempt from the server's tenant check
   * (`TenantContext::isTokenUserSuperAdmin`), so they get no 403, and they are in another
   * community deliberately. Moving them home on every sign-in would break the one thing
   * they signed in to do.
   */
  it('leaves a platform super admin where they chose to be', () => {
    expect(decideSignInTenant(input({ adminExemption: 'exempt' })))
      .toEqual({ action: 'keep', reason: 'cross-community-admin' });
  });

  /**
   * 🔴 The other half of that, and the half that is easy to get wrong. A hub's network
   * admin is NOT exempt server-side — `isTokenUserSuperAdmin` deliberately omits
   * `is_tenant_super_admin` — so they are refused exactly like any other member and need
   * exactly the same rescue.
   */
  it('still moves a hub network admin, who the server does not exempt', () => {
    const networkAdmin = { role: 'admin', is_admin: true, is_tenant_super_admin: true, is_super_admin: false, is_god: false };
    expect(classifyCrossCommunityAdmin(networkAdmin)).toBe('not-exempt');
    expect(decideSignInTenant(input({
      adminExemption: classifyCrossCommunityAdmin(networkAdmin),
    }))).toEqual({ action: 'adopt', slug: 'stratford' });
  });

  /**
   * 🔴 The launch repair reads a profile CACHED on the device, and a cache written by an
   * older build may predate the super-admin flags — at which point "no flag" and "flag is
   * false" are indistinguishable. Doing nothing is the only safe answer: being wrong here
   * means dragging a platform super admin out of the community they deliberately chose.
   */
  it('does nothing when it cannot tell whether the member is exempt', () => {
    expect(decideSignInTenant(input({ adminExemption: 'unknown' })))
      .toEqual({ action: 'keep', reason: 'admin-status-unknown' });
  });

  it('does nothing when the sign-in response carried no community', () => {
    expect(decideSignInTenant(input({ userTenantId: undefined })))
      .toEqual({ action: 'keep', reason: 'no-user-tenant' });
    expect(decideSignInTenant(input({ userTenantId: null })))
      .toEqual({ action: 'keep', reason: 'no-user-tenant' });
  });

  /**
   * `GET /v2/tenants` excludes only the master community, so this is not the sub-community
   * path — it is a community that has been deactivated, or the master itself. Guessing a
   * slug we were not given would be worse than leaving the community picker to rescue them.
   */
  it('does not guess a slug for a community the public list does not carry', () => {
    expect(decideSignInTenant(input({ tenants: [HUB] })))
      .toEqual({ action: 'keep', reason: 'not-listed' });
    expect(decideSignInTenant(input({ tenants: [] })))
      .toEqual({ action: 'keep', reason: 'not-listed' });
  });

  it('does not switch to the community it is already showing', () => {
    expect(decideSignInTenant(input({ currentTenantId: null, currentSlug: ' stratford ' })))
      .toEqual({ action: 'keep', reason: 'already-correct' });
  });

  it('will not send an empty slug', () => {
    expect(decideSignInTenant(input({ tenants: [HUB, { ...SUB, slug: '  ' }] })))
      .toEqual({ action: 'keep', reason: 'already-correct' });
  });
});

/**
 * Every field the sign-in response can carry that bears on this question. Wider than the
 * predicate's own parameter on purpose: the point of these cases is that the fields it does
 * NOT look at are the ones that must not sway it.
 */
type UserFlags = {
  role?: string;
  is_admin?: boolean;
  is_super_admin?: boolean;
  is_god?: boolean;
  is_tenant_super_admin?: boolean;
};

// Field for field with `App\Core\TenantContext::isTokenUserSuperAdmin()`.
const EXEMPT: [string, UserFlags][] = [
  ['is_super_admin', { is_super_admin: true }],
  ['is_god', { is_god: true }],
  ["role 'super_admin'", { role: 'super_admin' }],
  ["role 'god'", { role: 'god' }],
];

const NOT_EXEMPT: [string, UserFlags][] = [
  ['an ordinary member', { role: 'member' }],
  ['a community admin', { role: 'admin', is_admin: true }],
  ['a hub network admin', { role: 'admin', is_tenant_super_admin: true }],
  ['flags present but false', { role: 'member', is_super_admin: false, is_god: false }],
  ['nothing at all', {}],
];

describe('mirroring the server rule about who may be in another community', () => {
  it.each(EXEMPT)('treats %s as exempt', (_label, user) => {
    expect(isCrossCommunityAdmin(user)).toBe(true);
    expect(classifyCrossCommunityAdmin(user)).toBe('exempt');
  });

  it.each(NOT_EXEMPT)('does not treat %s as exempt', (_label, user) => {
    expect(isCrossCommunityAdmin(user)).toBe(false);
  });
});

/**
 * The three-answer version, which is what the launch repair uses. A sign-in response always
 * carries the flags; a profile cached by an older build may not.
 */
describe('telling exempt from not-exempt from cannot-tell', () => {
  it('reads the flags when the profile carries them', () => {
    expect(classifyCrossCommunityAdmin({ role: 'member', is_super_admin: false, is_god: false }))
      .toBe('not-exempt');
    expect(classifyCrossCommunityAdmin({ role: 'admin', is_admin: true, is_super_admin: false, is_god: false }))
      .toBe('not-exempt');
  });

  /**
   * 🔴 A proof, not a guess. The server computes `is_admin` as
   * `role in (admin, tenant_admin, super_admin) || is_super_admin || is_tenant_super_admin`,
   * so a member it calls not-admin cannot be a platform super admin. This is what lets the
   * overwhelming majority of members — admins of nothing — be rescued from the oldest cache
   * imaginable.
   */
  it('trusts is_admin === false even with no super-admin flags at all', () => {
    expect(classifyCrossCommunityAdmin({ role: 'member', is_admin: false })).toBe('not-exempt');
  });

  it('refuses to guess for an admin whose cached profile predates the flags', () => {
    expect(classifyCrossCommunityAdmin({ role: 'admin', is_admin: true })).toBe('unknown');
  });

  it('refuses to guess when the profile says nothing at all', () => {
    expect(classifyCrossCommunityAdmin({})).toBe('unknown');
  });
});

describe('carrying the decision out', () => {
  function harness(overrides: Partial<SignInTenantInput> = {}) {
    const listTenants = jest.fn<Promise<{ data: TenantListItem[] }>, []>()
      .mockResolvedValue({ data: TENANTS });
    const setTenantSlug = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const full = input(overrides);
    const deps = {
      input: {
        userTenantId: full.userTenantId,
        currentTenantId: full.currentTenantId,
        currentSlug: full.currentSlug,
        adminExemption: full.adminExemption,
      },
      listTenants,
      setTenantSlug,
    };
    return { listTenants, setTenantSlug, deps };
  }

  it('switches the app to the community that issued the session', async () => {
    const { deps, listTenants, setTenantSlug } = harness();

    await expect(adoptSignInTenant(deps)).resolves.toEqual({ action: 'adopt', slug: 'stratford' });

    expect(listTenants).toHaveBeenCalledTimes(1);
    expect(setTenantSlug).toHaveBeenCalledWith('stratford');
  });

  it('does not touch the network when the community is already right', async () => {
    const { deps, listTenants, setTenantSlug } = harness({ userTenantId: HUB.id });

    await expect(adoptSignInTenant(deps))
      .resolves.toEqual({ action: 'keep', reason: 'already-correct' });

    expect(listTenants).not.toHaveBeenCalled();
    expect(setTenantSlug).not.toHaveBeenCalled();
  });

  /**
   * 🔴 The sign-in has already succeeded by the time this runs — the token is stored and
   * installed. A failure here must never turn a completed sign-in into an error, so the
   * next two prove it reports and returns rather than throwing.
   */
  it('leaves the member signed in when the community list cannot be fetched', async () => {
    const { deps, listTenants, setTenantSlug } = harness();
    listTenants.mockRejectedValue(new Error('offline'));

    await expect(adoptSignInTenant(deps))
      .resolves.toEqual({ action: 'keep', reason: 'list-unavailable' });

    expect(setTenantSlug).not.toHaveBeenCalled();
  });

  it('leaves the member signed in when the community will not load', async () => {
    const { deps, setTenantSlug } = harness();
    setTenantSlug.mockRejectedValue(new Error('Unable to load community'));

    await expect(adoptSignInTenant(deps))
      .resolves.toEqual({ action: 'keep', reason: 'switch-failed' });
  });

  it('copes with a community list that comes back empty', async () => {
    const { deps, listTenants, setTenantSlug } = harness();
    listTenants.mockResolvedValue({ data: [] });

    await expect(adoptSignInTenant(deps))
      .resolves.toEqual({ action: 'keep', reason: 'not-listed' });

    expect(setTenantSlug).not.toHaveBeenCalled();
  });
});
