// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { TenantListItem } from '@/lib/api/tenant';

/**
 * After a successful sign-in: is the app showing the community this session was issued
 * for, and if not, which one should it switch to?
 *
 * 🔴 THE PROBLEM THIS EXISTS FOR. A community can have sub-communities, which have no
 * domain of their own and are served underneath their hub. So a member of one arrives at
 * the hub to sign in, and `AuthController::login` deliberately lets them: its third arm
 * matches any user inside `TenantSubtree::descendantIds` of the requested community. That
 * is correct — without it those members could not sign in at all — and it is pinned by a
 * passing test, `SubCommunityEntryPointsTest::test_login_signs_in_a_sub_community_member_from_the_parent_domain`.
 *
 * But the token it issues is bound to the member's OWN community
 * (`generateToken(…, (int) $lockedUser['tenant_id'], …)`), while the app carries on asking
 * about the hub. `App\Core\TenantContext` compares the two on every request and answers
 * **403 `TENANT_MISMATCH` to all of them**. Seen in the wild on 2026-09-09, release
 * 1.4.0+7: one member's unread count, notification count and push registration were all
 * refused inside a single second. They were signed in and nothing worked.
 *
 * Two correct designs with nothing reconciling them. This module is the reconciliation.
 *
 * 🔴 IT SWITCHES SILENTLY, ON PURPOSE. The member did nothing wrong — they signed in where
 * they were told to — and there is no question to ask them: an account belongs to exactly
 * one community, so there is only one right answer and the app already knows it. Asking
 * would be theatre. `lib/navigation/tenantMismatch.ts` still exists and still opens the
 * community picker, but that is the rescue for a state this should now prevent.
 *
 * 🔴 IT IS PURE, and the fetching lives in `adoptSignInTenant` below, because the decision
 * has more edges than the action does — a super admin must be left alone, an unlisted
 * community must be left alone — and each of them is a way to sign a member into the wrong
 * place or out of a working one.
 */

export type SignInTenantKeepReason =
  /** The sign-in response carried no community id, so there is nothing to compare. */
  | 'no-user-tenant'
  /** The token holder is exempt from the server's tenant check — see `isCrossCommunityAdmin`. */
  | 'cross-community-admin'
  /** The app is already showing the community this session belongs to. */
  | 'already-correct'
  /** The community is not in the public list, so its slug cannot be resolved. */
  | 'not-listed'
  /** The public list could not be fetched. */
  | 'list-unavailable'
  /** The switch itself failed — the community would not load. */
  | 'switch-failed';

export type SignInTenantDecision =
  | { action: 'keep'; reason: SignInTenantKeepReason }
  /** Undecidable without the public community list. Fetch it and ask again. */
  | { action: 'lookup' }
  | { action: 'adopt'; slug: string };

export interface SignInTenantInput {
  /** `user.tenant_id` from the sign-in response — the community that issued the token. */
  userTenantId: number | null | undefined;
  /**
   * `tenant.id` of the community the app is showing, when its config has loaded.
   *
   * Only ever used to answer "these already match" without a network call, which is the
   * case on essentially every sign-in. Not knowing it costs one anonymous request, never
   * a wrong answer.
   */
  currentTenantId: number | null | undefined;
  /** The slug the app is putting in `X-Tenant-Slug` — exactly what the server compares. */
  currentSlug: string;
  /** True when the server would not refuse this member for asking about another community. */
  isCrossCommunityAdmin: boolean;
  /** The public community list, or `null` when it has not been fetched. */
  tenants: readonly TenantListItem[] | null;
}

/**
 * Mirrors `App\Core\TenantContext::isTokenUserSuperAdmin()` — deliberately, field for field.
 *
 * 🔴 `is_tenant_super_admin` is NOT in it, and that is not an oversight in either place. A
 * network admin runs a hub and its sub-communities but is still refused when they ask about
 * a community outside their own, so they need this switch exactly like any other member. A
 * platform super admin is genuinely exempt server-side and browses communities on purpose;
 * moving them to their home community every time they sign in would break the one job they
 * are signed in to do.
 *
 * If the server's predicate ever changes, this one has to change with it — the two are
 * answering the same question, and a disagreement means either a member is not rescued or
 * an admin is dragged somewhere they did not ask to go.
 */
export function isCrossCommunityAdmin(user: {
  role?: string | null;
  is_super_admin?: boolean | null;
  is_god?: boolean | null;
}): boolean {
  return Boolean(user.is_super_admin)
    || Boolean(user.is_god)
    || user.role === 'super_admin'
    || user.role === 'god';
}

export function decideSignInTenant(input: SignInTenantInput): SignInTenantDecision {
  const { userTenantId, currentTenantId, currentSlug, isCrossCommunityAdmin: isAdmin, tenants } = input;

  // Nothing to compare against. An older API build, or a response shape that changed
  // under us — either way, guessing would be worse than leaving things alone.
  if (typeof userTenantId !== 'number' || !Number.isFinite(userTenantId)) {
    return { action: 'keep', reason: 'no-user-tenant' };
  }

  if (isAdmin) {
    return { action: 'keep', reason: 'cross-community-admin' };
  }

  // The overwhelmingly common case, and the reason `TenantConfig.id` is declared at all:
  // the member signed in to their own community, so answer without touching the network.
  if (typeof currentTenantId === 'number' && currentTenantId === userTenantId) {
    return { action: 'keep', reason: 'already-correct' };
  }

  if (tenants === null) {
    return { action: 'lookup' };
  }

  const own = tenants.find((entry) => entry.id === userTenantId);
  if (!own) {
    /*
      🔴 `GET /v2/tenants` excludes only the master community (id 1), so a sub-community IS
      listed and this is not the ordinary path. It happens when the member belongs to
      something the list does not show — the master community itself, or one that has been
      deactivated since. Switching to a slug we have not been given would be a guess, and
      the community picker is a better place to be than a community that will refuse you.
    */
    return { action: 'keep', reason: 'not-listed' };
  }

  const wanted = own.slug.trim();
  if (!wanted || wanted === currentSlug.trim()) {
    // Same community under a different id — or an empty slug, which cannot be sent.
    return { action: 'keep', reason: 'already-correct' };
  }

  return { action: 'adopt', slug: wanted };
}

export interface AdoptSignInTenantDeps {
  input: Omit<SignInTenantInput, 'tenants'>;
  /** `listTenants` from lib/api/tenant — anonymous, so it works while everything else 403s. */
  listTenants: () => Promise<{ data: TenantListItem[] }>;
  /** `setTenantSlug` from the tenant context — persists the choice and reloads the config. */
  setTenantSlug: (slug: string) => Promise<void>;
}

/**
 * Run the decision, fetching and switching as needed. Reports what happened; never throws.
 *
 * 🔴 Never throwing is the point. This runs inside a sign-in that has ALREADY succeeded —
 * the token is stored and installed by the time we get here. A failure to tidy up the
 * community must not turn a completed sign-in into an error message, so every failure
 * degrades to `keep` and leaves the member signed in with `tenantMismatch.ts` as the
 * backstop it was written to be.
 */
export async function adoptSignInTenant(deps: AdoptSignInTenantDeps): Promise<SignInTenantDecision> {
  let decision = decideSignInTenant({ ...deps.input, tenants: null });

  if (decision.action === 'lookup') {
    let tenants: TenantListItem[];
    try {
      tenants = (await deps.listTenants()).data;
    } catch {
      return { action: 'keep', reason: 'list-unavailable' };
    }
    decision = decideSignInTenant({ ...deps.input, tenants: tenants ?? [] });
  }

  if (decision.action === 'adopt') {
    try {
      await deps.setTenantSlug(decision.slug);
    } catch {
      // `setTenantSlug` puts the previous community back before it throws, so the app is
      // where it started rather than half-moved.
      return { action: 'keep', reason: 'switch-failed' };
    }
  }

  return decision;
}
