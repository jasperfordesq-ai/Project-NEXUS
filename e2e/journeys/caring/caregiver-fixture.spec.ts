// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PHASE 1 — the three-actor browser fixture itself.
 *
 * This spec's only job is to prove the harness is real before any journey
 * assertion is allowed to depend on it:
 *
 *   - the stack under test is the DISPOSABLE one, not the developer's;
 *   - three DISTINCT same-tenant actors genuinely authenticate;
 *   - a fourth actor exists in a DIFFERENT community, so tenant isolation can
 *     be demonstrated rather than assumed;
 *   - each actor's browser lands on the page we intended, NOT a login page;
 *   - the storage state handed to Playwright is populated, so a run cannot
 *     "pass" while signed in as nobody.
 *
 * 🔴 The last two points are the whole reason this file exists. The previous
 * caregiver browser attempt authenticated against `/t/{tenant}/login`, a route
 * that has not existed for some time. It failed before authentication, and
 * nothing downstream noticed, because `page.goto()` follows the redirect to the
 * login page silently and a login page satisfies every generic structural
 * assertion. Swapping `/t/` for `/` would have fixed the URL and left that
 * blindness in place.
 */

import { test, expect } from '@playwright/test';
import {
  CARING_BASE_URL,
  CARING_TENANT,
  assertCaringFixtureEnvironment,
  assertLandedOn,
  assertSignedInAs,
  asActor,
  authenticateCaringActors,
  contextForActor,
  storageStateFor,
  tenantPath,
  unwrap,
  type Actor,
  type ActorKey,
} from '../../helpers/caring-fixture';

let actors: Record<ActorKey, Actor>;
let env: Awaited<ReturnType<typeof assertCaringFixtureEnvironment>>;

test.beforeAll(async () => {
  // Throws with actionable setup instructions if anything is missing. It must
  // never degrade to a skip: a skipped journey and a passing journey look
  // identical in a summary line, which is how a broken feature gets reported
  // as working.
  env = await assertCaringFixtureEnvironment();
  actors = await authenticateCaringActors();
});

test.describe('Caring caregiver journey — three-actor fixture', () => {
  test('the stack under test is the disposable one, with Caring enabled', async () => {
    expect(env.caringEnabled, 'caring_community must be enabled on the synthetic community').toBe(
      true,
    );
    expect(env.tenantName, 'tenant name should identify the synthetic community').toContain('E2E');

    // Prove we are NOT on the developer's stack. 5173/8090 serve `nexus`, a
    // production-derived snapshot; this journey writes consent evidence.
    expect(CARING_BASE_URL).not.toContain(':5173');
  });

  test('three distinct actors exist in one community, plus one in another', async () => {
    const { caregiver, recipient, staff, otherStaff } = actors;

    const ids = [caregiver.userId, recipient.userId, staff.userId];
    expect(new Set(ids).size, `expected 3 distinct accounts, got ${JSON.stringify(ids)}`).toBe(3);

    expect(caregiver.tenantId).toBe(env.tenantId);
    expect(recipient.tenantId).toBe(env.tenantId);
    expect(staff.tenantId).toBe(env.tenantId);

    // The isolation actor must genuinely be elsewhere, or the cross-tenant
    // checks in the journey prove nothing.
    expect(otherStaff.tenantId).not.toBe(env.tenantId);

    // Every account must be synthetic. Belt and braces over the same check in
    // the fixture, because this is the invariant that keeps real member data
    // out of a journey that writes safeguarding decisions.
    for (const actor of [caregiver, recipient, staff, otherStaff]) {
      expect(actor.email, `${actor.key} must be a synthetic account`).toMatch(
        /@project-nexus\.local$|@example\./,
      );
    }
  });

  test('storage state is populated — a run cannot pass signed in as nobody', async () => {
    for (const key of ['caregiver', 'recipient', 'staff'] as ActorKey[]) {
      const state = storageStateFor(actors[key]);
      const entries = state.origins[0]?.localStorage ?? [];
      const token = entries.find((e) => e.name === 'nexus_access_token');

      expect(state.origins.length, `${key}: storage state has no origin`).toBeGreaterThan(0);
      expect(token, `${key}: no nexus_access_token in storage state`).toBeTruthy();
      expect(token!.value.length, `${key}: access token is empty`).toBeGreaterThan(20);
    }
  });

  test('the caregiver candidate lands on the Caring hub, not a login page', async ({ browser }) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await page.goto(tenantPath('/caring-community'));
      await assertLandedOn(page, /\/caring-community\/?$/, 'the Caring Community hub');
      await assertSignedInAs(page, actors.caregiver);

      // The feature gate renders a "coming soon" placeholder when the module is
      // off. Landing on the right URL is not enough — prove the module resolved.
      await expect(
        page.locator('body'),
        'the Caring hub rendered the feature-disabled placeholder',
      ).not.toContainText(/coming soon/i);
    } finally {
      await context.close();
    }
  });

  test('the care recipient signs in independently as a different member', async ({ browser }) => {
    const { context, page } = await contextForActor(browser, actors.recipient);
    try {
      await page.goto(tenantPath('/caring-community'));
      await assertLandedOn(page, /\/caring-community\/?$/, 'the Caring Community hub');
      await assertSignedInAs(page, actors.recipient);

      // Confirm the session really is the recipient's, not a reused caregiver
      // session — the two contexts share nothing but must be proven distinct.
      const me = await asActor<any>(actors.recipient, 'GET', '/v2/users/me');
      const meUser = unwrap<any>(me.json);
      expect(Number(meUser?.id ?? meUser?.user?.id)).toBe(actors.recipient.userId);
      expect(actors.recipient.userId).not.toBe(actors.caregiver.userId);
    } finally {
      await context.close();
    }
  });

  test('staff reach the Caring workflow page through an authorised session', async ({
    browser,
  }) => {
    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring/workflow'));
      await assertLandedOn(page, /\/caring\/workflow\/?$/, 'the staff Caring workflow page');
      await assertSignedInAs(page, actors.staff);
    } finally {
      await context.close();
    }
  });

  test('an ordinary member is refused the staff caregiver queue', async () => {
    const denied = await asActor(
      actors.caregiver,
      'GET',
      '/v2/admin/caring-community/caregiver-links?status=pending',
    );
    expect(
      [401, 403],
      `an ordinary member reached the staff queue (status ${denied.status})`,
    ).toContain(denied.status);
  });

  test('staff in another community cannot read this community queue', async () => {
    const ours = await asActor<any>(
      actors.staff,
      'GET',
      '/v2/admin/caring-community/caregiver-links?status=pending',
    );
    expect(ours.status, 'the tenant staff reviewer should reach their own queue').toBe(200);

    const theirs = await asActor<any>(
      actors.otherStaff,
      'GET',
      '/v2/admin/caring-community/caregiver-links?status=pending',
    );

    // A different community's staff may legitimately have their own (empty)
    // queue. What must never happen is seeing OUR community's rows.
    if (theirs.status === 200) {
      const ourIds = new Set((unwrap<any[]>(ours.json) || []).map((r: any) => r.id));
      const theirIds = (unwrap<any[]>(theirs.json) || []).map((r: any) => r.id);
      for (const id of theirIds) {
        expect(ourIds.has(id), `link ${id} leaked across community boundaries`).toBe(false);
      }
    } else {
      expect(theirs.status).toBeGreaterThanOrEqual(400);
    }
  });

  test('the tenant slug in the URL is the synthetic community', async ({ browser }) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await page.goto(tenantPath('/caring-community'));
      expect(new URL(page.url()).pathname.startsWith(`/${CARING_TENANT}/`)).toBe(true);
    } finally {
      await context.close();
    }
  });
});
