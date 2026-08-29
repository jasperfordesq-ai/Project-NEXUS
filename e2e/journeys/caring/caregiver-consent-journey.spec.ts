// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PHASE 2 — the caregiver-consent journey, walked in a real browser.
 *
 * Four walkthroughs against ONE record, in order, by three different people:
 *
 *   A  a member proposes to become someone's caregiver
 *   B  the care recipient consents (and, separately, refuses)
 *   C  staff verify consent and approve (and, separately, reject)
 *   D  the approved caregiver exercises the authority that unlocks
 *
 * 🔴 What counts as evidence here, and what does not.
 *
 * A route existing, a component test passing, a fixture rendering, an HTTP 200,
 * or a mocked notification is NOT evidence for this journey. Each step drives
 * the real UI, then reads the result back out of the DISPOSABLE DATABASE in a
 * separate process. That separation matters more than usual in this codebase:
 * method bodies are routinely wrapped in `catch (\Throwable)` returning a falsy
 * default, so a write against a missing column comes back as a plausible
 * response rather than an error. The API answer cannot be its own proof.
 *
 * Runs serially and shares state — B cannot start before A has created the row.
 */

import { test, expect, type Page } from '@playwright/test';
import {
  CARING_TENANT,
  asActor,
  assertCaringFixtureEnvironment,
  assertLandedOn,
  answerCaringOnboardingIfShown,
  assertSignedInAs,
  authenticateCaringActors,
  contextForActor,
  queryDisposableDb,
  readCaregiverLinkRow,
  readNotificationsFor,
  tenantPath,
  unwrap,
  type Actor,
  type ActorKey,
} from '../../helpers/caring-fixture';

let actors: Record<ActorKey, Actor>;

/** The link created in walkthrough A and carried through B, C and D. */
let primaryLinkId = 0;

const today = () => new Date().toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await assertCaringFixtureEnvironment();
  actors = await authenticateCaringActors();

  // Start from a known-clean slate for OUR two actors only. Any leftover link
  // between them would make "the pending link is visible" ambiguous.
  const involved = [
    actors.caregiver.userId,
    actors.recipient.userId,
    actors.staff.userId,
    actors.spare.userId,
  ].join(', ');
  const stale = queryDisposableDb(
    `SELECT id FROM caring_caregiver_links
      WHERE caregiver_id IN (${involved}) OR cared_for_id IN (${involved})`,
  );
  if (stale.length) {
    queryDisposableDb(
      `DELETE FROM caring_caregiver_links WHERE id IN (${stale.map((r) => r.id).join(',')})`,
    );
  }
});

/** Open the Caring hub the way a member actually would: through the navigation. */
async function navigateToCaringHub(page: Page, actor: Actor): Promise<void> {
  await page.goto(tenantPath('/feed'));
  await assertLandedOn(page, /\/feed\/?$/, 'the member feed');
  await assertSignedInAs(page, actor);

  // 🔴 The Caring entry is a <button> inside the "Community" dropdown, not an
  // anchor — there is no `a[href*="caring-community"]` in the navigation to
  // find. (The same shape as the drawer's Dashboard entry, which is a button
  // calling navigate(); a href-based selector there matched zero elements
  // anywhere in the app.) So this drives the menu rather than a link.
  await page
    .locator('nav[data-main-nav]')
    .getByRole('button', { name: 'Community', exact: false })
    .first()
    .click();

  const entry = page.getByText('Caring Community', { exact: true }).first();
  await expect(entry, 'the Community menu did not expose a Caring Community entry').toBeVisible();
  await entry.click();

  await assertLandedOn(page, /\/caring-community\/?$/, 'the Caring Community hub');
  await answerCaringOnboardingIfShown(page);
}

// ---------------------------------------------------------------------------
// Walkthrough A — the proposing caregiver
// ---------------------------------------------------------------------------

test.describe('A — a member proposes to become a caregiver', () => {
  test('reaches Caring by navigation, and "Become a caregiver" opens the Caring link form', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await navigateToCaringHub(page, actors.caregiver);

      // The module must have resolved, not fallen back to the feature-gate
      // placeholder — landing on the right URL alone would not show that.
      await expect(page.locator('body')).not.toContainText(/coming soon/i);
      await testInfo.attach('A1-caring-hub.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      // 🔴 THE CRUX OF THIS CHANGE. "Become a caregiver" used to point at
      // /volunteering, which enrols a volunteer and confers no caregiver
      // authority whatsoever. It must now enter the Caring caregiver-link
      // journey. Selected by href because the label is translated.
      const become = page.locator('a[href$="/caring-community/caregiver/link"]');
      await expect(become, '"Become a caregiver" is missing from the Caring hub').toHaveCount(1);
      await expect(become).toBeVisible();
      await become.click();

      await assertLandedOn(
        page,
        /\/caring-community\/caregiver\/link\/?$/,
        'the Caring caregiver-link form',
      );
      // Explicit, because sending members to volunteering is the exact defect fixed.
      expect(page.url(), '"Become a caregiver" still routes into volunteering').not.toContain(
        '/volunteering',
      );

      await testInfo.attach('A2-link-form.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('submitting the form creates a PENDING link and says consent is still needed', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await page.goto(tenantPath('/caring-community/caregiver/link'));
      await assertLandedOn(page, /\/caregiver\/link\/?$/, 'the caregiver-link form');
      await answerCaringOnboardingIfShown(page);

      // Find the care recipient through the form's own member search.
      const search = page.getByLabel('Find member');
      await search.fill(actors.recipient.displayName.split(' ')[0]);

      const option = page
        .locator('[role="option"]')
        .filter({ hasText: actors.recipient.displayName })
        .first();
      await expect(
        option,
        `the member search did not offer ${actors.recipient.displayName}`,
      ).toBeVisible({ timeout: 20_000 });
      await option.click();

      await page.getByLabel('Care started').fill(today());

      await testInfo.attach('A3-form-completed.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      await page.locator('button[type="submit"]').first().click();

      // Visible success feedback that states the relationship is NOT yet live.
      const toast = page.locator('[data-toast]');
      await expect(toast, 'no visible confirmation after submitting').toBeVisible({
        timeout: 20_000,
      });
      await expect(toast).toContainText(/pending|consent|safeguarding/i);

      // The form navigates to the caregiver dashboard on success.
      await assertLandedOn(page, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await testInfo.attach('A4-dashboard-pending.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }

    // Read the record back out of the database — not out of the response that
    // created it. This is what proves a row exists with the right shape.
    const rows = queryDisposableDb(
      `SELECT id, status, tenant_id, caregiver_id, cared_for_id,
              IFNULL(recipient_confirmed_at,'') recipient_confirmed_at
         FROM caring_caregiver_links
        WHERE caregiver_id = ${actors.caregiver.userId}
          AND cared_for_id = ${actors.recipient.userId}
        ORDER BY id DESC LIMIT 1`,
    );
    expect(rows.length, 'no caregiver link row was persisted').toBe(1);

    const row = rows[0];
    primaryLinkId = Number(row.id);

    expect(row.status, 'a new caregiver link must start pending, never active').toBe('pending');
    expect(row.recipient_confirmed_at, 'the recipient must not be pre-confirmed').toBe('');
    expect(Number(row.tenant_id)).toBe(actors.caregiver.tenantId);
    expect(Number(row.caregiver_id)).toBe(actors.caregiver.userId);
    expect(Number(row.cared_for_id)).toBe(actors.recipient.userId);
  });

  test('the pending link is visible, and exposes NO caregiver authority', async ({ browser }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await page.goto(tenantPath('/caring-community/caregiver'));
      await assertLandedOn(page, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await answerCaringOnboardingIfShown(page);

      // A pending link must stay visible to the person who proposed it, with a
      // state that explains what is being waited on.
      await expect(page.getByText('Waiting for the care recipient').first()).toBeVisible();

      // 🔴 Pending must confer nothing. Schedule, cover-care and the on-behalf
      // entry point are rendered only for an ACTIVE link, so their absence here
      // is the assertion — a pending relationship that exposed them would be a
      // safeguarding failure, not a cosmetic one.
      await expect(
        page.locator(`a[href*="/caring-community/caregiver/schedule"]`),
        'a PENDING link exposed schedule access',
      ).toHaveCount(0);
      await expect(
        page.locator(`a[href*="/caring-community/caregiver/cover"]`),
        'a PENDING link exposed cover-care controls',
      ).toHaveCount(0);

      await testInfo.attach('A5-pending-no-authority.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }

    // And prove it at the API too: a pending link must not unlock the schedule.
    const schedule = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.recipient.userId}`,
    );
    expect(
      schedule.status,
      `a PENDING link unlocked the care schedule (status ${schedule.status})`,
    ).toBeGreaterThanOrEqual(400);
  });

  test('the care recipient was genuinely notified', async () => {
    const notes = readNotificationsFor(actors.recipient.userId);
    const requested = notes.filter((n) => n.type === 'caring_caregiver_link_requested');
    expect(
      requested.length,
      `no caring_caregiver_link_requested notification reached the recipient; got ${JSON.stringify(
        notes.map((n) => n.type),
      )}`,
    ).toBeGreaterThan(0);
    expect(requested[requested.length - 1].message).toContain(actors.caregiver.displayName);
  });
});

// ---------------------------------------------------------------------------
// Walkthrough B — the care recipient consents
// ---------------------------------------------------------------------------

test.describe('B — the care recipient decides', () => {
  test('sees the incoming request, who it is from, and what it means', async ({ browser }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.recipient);
    try {
      await page.goto(tenantPath('/caring-community/caregiver'));
      await assertLandedOn(page, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await answerCaringOnboardingIfShown(page);
      await assertSignedInAs(page, actors.recipient);

      const incoming = page.locator('section[aria-labelledby="incoming-caregiver-links"]');
      await expect(incoming, 'the recipient sees no incoming caregiver request').toBeVisible();

      // The proposing person must be identified, and the ask explained.
      await expect(incoming).toContainText(actors.caregiver.displayName);
      await expect(incoming).toContainText(/asked to support you|Confirm only if/i);

      await testInfo.attach('B1-incoming-request.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('confirming records consent but does NOT grant authority — staff review still required', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.recipient);
    try {
      await page.goto(tenantPath('/caring-community/caregiver'));
      await answerCaringOnboardingIfShown(page);
      const incoming = page.locator('section[aria-labelledby="incoming-caregiver-links"]');
      await expect(incoming).toBeVisible();

      await incoming.getByRole('button', { name: 'Confirm relationship' }).first().click();

      // The request leaves the "needs my decision" list once confirmed.
      await expect(incoming, 'the confirmed request is still shown as awaiting the recipient')
        .toBeHidden({ timeout: 20_000 });

      await testInfo.attach('B2-after-confirm.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }

    const row = readCaregiverLinkRow(primaryLinkId);
    expect(row, 'the caregiver link vanished').not.toBeNull();

    // 🔴 The whole point of the two-step consent model: the recipient agreeing
    // is necessary but NOT sufficient. Authority arrives only after staff
    // safeguarding review.
    expect(row!.status, 'recipient confirmation alone activated the link').toBe('pending');
    expect(row!.recipient_confirmed_at, 'no recipient confirmation was recorded').not.toBe('');
    expect(
      Number(row!.recipient_confirmed_by),
      'the confirmation was not attributed to the recipient',
    ).toBe(actors.recipient.userId);

    // Still no caregiver authority.
    const schedule = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.recipient.userId}`,
    );
    expect(
      schedule.status,
      'a recipient-confirmed but unapproved link unlocked the care schedule',
    ).toBeGreaterThanOrEqual(400);
  });

  test('the proposing caregiver is told the recipient confirmed', async () => {
    const notes = readNotificationsFor(actors.caregiver.userId);
    expect(
      notes.some((n) => n.type === 'caring_caregiver_link_confirmed'),
      `caregiver was not notified of confirmation; got ${JSON.stringify(notes.map((n) => n.type))}`,
    ).toBe(true);
  });

  test('a recipient can REFUSE, and the initiator sees the rejected state', async ({ browser }, testInfo) => {
    // A fresh, disposable link so the primary one keeps flowing to walkthrough C.
    const created = await asActor<any>(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/links',
      {
        cared_for_id: actors.staff.userId,
        relationship_type: 'friend',
        start_date: today(),
        notes: 'E2E — recipient refusal path',
      },
    );
    const refusedId = Number(unwrap<any>(created.json)?.id);
    expect(refusedId, `could not create the refusal-path link: ${created.text}`).toBeGreaterThan(0);

    // The staff account is the recipient of THIS link, so it decides as a member.
    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring-community/caregiver'));
      await answerCaringOnboardingIfShown(page);
      const incoming = page.locator('section[aria-labelledby="incoming-caregiver-links"]');
      await expect(incoming).toBeVisible();
      await incoming.getByRole('button', { name: 'Reject request' }).first().click();
      await expect(incoming).toBeHidden({ timeout: 20_000 });
    } finally {
      await context.close();
    }

    const row = readCaregiverLinkRow(refusedId);
    expect(row!.status, 'a refused request did not end up rejected').toBe('rejected');

    // The person who proposed it must be able to see that it was refused.
    const { context: c2, page: p2 } = await contextForActor(browser, actors.caregiver);
    try {
      await p2.goto(tenantPath('/caring-community/caregiver'));
      await assertLandedOn(p2, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await answerCaringOnboardingIfShown(p2);
      await expect(
        p2.getByText('Not approved').first(),
        'a rejected link is hidden from the caregiver who proposed it',
      ).toBeVisible();
      await testInfo.attach('B3-rejected-visible-to-initiator.png', {
        body: await p2.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await c2.close();
    }

    const notes = readNotificationsFor(actors.caregiver.userId);
    expect(
      notes.some((n) => n.type === 'caring_caregiver_link_rejected'),
      'the caregiver was not notified of the rejection',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Walkthrough C — staff review
// ---------------------------------------------------------------------------

test.describe('C — staff verify consent and decide', () => {
  test('the confirmed request appears in the tenant-scoped queue with its consent state', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring/workflow'));
      await assertLandedOn(page, /\/caring\/workflow\/?$/, 'the staff Caring workflow page');
      await assertSignedInAs(page, actors.staff);

      const row = page.locator(`section[aria-labelledby="caregiver-link-${primaryLinkId}"]`);
      await expect(row, `link ${primaryLinkId} is not in the staff review queue`).toBeVisible({
        timeout: 20_000,
      });

      // Who, for whom, and whether the recipient has consented — all visible
      // before any decision is taken.
      await expect(row).toContainText(actors.caregiver.displayName);
      await expect(row).toContainText(actors.recipient.displayName);
      await expect(
        row.getByText('Recipient confirmed'),
        'the queue does not show that the recipient confirmed',
      ).toBeVisible();

      await testInfo.attach('C1-staff-queue.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('approval is disabled until BOTH evidence and the explicit attestation are given', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring/workflow'));
      const row = page.locator(`section[aria-labelledby="caregiver-link-${primaryLinkId}"]`);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const approve = row.getByRole('button', { name: 'Approve caregiver link' });
      await expect(approve, 'approval was available with no evidence and no attestation')
        .toBeDisabled();

      // Evidence alone is not enough.
      await row.getByLabel('Consent evidence').fill('Phone call with the care recipient.');
      await expect(approve, 'evidence alone enabled approval — attestation was not required')
        .toBeDisabled();

      await testInfo.attach('C2-approve-disabled.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });

      // Attestation as well — now, and only now, may staff approve.
      // 🔴 Click the LABEL, not the input. HeroUI v3 checkboxes are React Aria:
      // the real <input type="checkbox"> sits inside a visually-hidden span
      // (1×1, clipped, absolutely positioned), so `.check()` never satisfies
      // Playwright's actionability check and times out — which looks like a
      // missing control rather than an unclickable one. The label is what a
      // person actually clicks.
      await row.getByText('I confirm consent was explicitly verified').click();
      await expect(approve).toBeEnabled();
    } finally {
      await context.close();
    }
  });

  test('an UNCONFIRMED request cannot be approved, even by direct API call', async () => {
    // 🔴 A DIFFERENT care recipient, on purpose.
    //
    // The primary pair already has a live link, and the duplicate guard rightly
    // refuses a second one — so targeting the primary recipient here made this
    // check impossible to set up. It was first written to `test.skip(...)` in
    // that case, which is precisely the trap this journey exists to avoid: a
    // skipped safeguarding check is indistinguishable from a passing one in the
    // summary line. Using a distinct recipient lets it genuinely run.
    const created = await asActor<any>(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/links',
      {
        cared_for_id: actors.spare.userId,
        relationship_type: 'neighbour',
        start_date: today(),
        notes: 'E2E — unconfirmed approval attempt',
      },
    );

    const unconfirmedId = Number(unwrap<any>(created.json)?.id ?? 0);
    expect(
      unconfirmedId,
      `could not create an unconfirmed link (${created.status}): ${created.text.slice(0, 300)}`,
    ).toBeGreaterThan(0);

    const row = readCaregiverLinkRow(unconfirmedId);
    expect(row!.recipient_confirmed_at, 'fixture error: this link is already confirmed').toBe('');

    // 🔴 The UI disables the button, but a disabled button is a courtesy, not a
    // control. The server must refuse regardless.
    const forced = await asActor(
      actors.staff,
      'POST',
      `/v2/admin/caring-community/caregiver-links/${unconfirmedId}/approve`,
      { consent_verified: true, consent_evidence: 'Bypass attempt via direct API call' },
    );
    expect(
      forced.status,
      `the server APPROVED a link the care recipient never confirmed (status ${forced.status})`,
    ).toBe(422);

    const after = readCaregiverLinkRow(unconfirmedId);
    expect(after!.status, 'an unconfirmed link was activated').toBe('pending');

    // Tidy up so it cannot pollute the queue assertions that follow.
    queryDisposableDb(`DELETE FROM caring_caregiver_links WHERE id = ${unconfirmedId}`);
  });

  test('approving with evidence and attestation activates the link and marks the row Approved', async ({
    browser,
  }, testInfo) => {
    const evidence = `Consent verified by telephone with the care recipient on ${today()}.`;

    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring/workflow'));
      const row = page.locator(`section[aria-labelledby="caregiver-link-${primaryLinkId}"]`);
      await expect(row).toBeVisible({ timeout: 20_000 });

      await row.getByLabel('Consent evidence').fill(evidence);
      // 🔴 Click the LABEL, not the input. HeroUI v3 checkboxes are React Aria:
      // the real <input type="checkbox"> sits inside a visually-hidden span
      // (1×1, clipped, absolutely positioned), so `.check()` never satisfies
      // Playwright's actionability check and times out — which looks like a
      // missing control rather than an unclickable one. The label is what a
      // person actually clicks.
      await row.getByText('I confirm consent was explicitly verified').click();
      await row.getByRole('button', { name: 'Approve caregiver link' }).click();

      // 🔴 A decided row must stay on screen, visibly marked. Vanishing on
      // decision leaves the reviewer unable to confirm what they just did.
      await expect(
        row.getByText('Caregiver link approved'),
        'the approved row is not visibly marked as approved',
      ).toBeVisible({ timeout: 20_000 });

      await testInfo.attach('C3-approved.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }

    const row = readCaregiverLinkRow(primaryLinkId);
    expect(row!.status, 'approval did not activate the link').toBe('active');
    expect(Number(row!.approved_by), 'approval was not attributed to the staff reviewer').toBe(
      actors.staff.userId,
    );
    expect(Number(row!.consent_verified_by)).toBe(actors.staff.userId);
    expect(row!.consent_evidence, 'the consent evidence was not stored').toContain(
      'Consent verified by telephone',
    );
    expect(row!.approved_at).not.toBe('');

    // Both participants must learn the relationship is live.
    for (const who of ['caregiver', 'recipient'] as const) {
      const notes = readNotificationsFor(actors[who].userId);
      expect(
        notes.some((n) => n.type === 'caring_caregiver_link_approved'),
        `${who} was not notified of the approval`,
      ).toBe(true);
    }

    // And an audit record naming the actor.
    const audit = queryDisposableDb(
      `SELECT id, user_id, action, IFNULL(details,'') details FROM activity_log
        WHERE action = 'caring_caregiver_link_approved'
          AND details LIKE '%${primaryLinkId}%' ORDER BY id DESC LIMIT 1`,
    );
    expect(audit.length, 'no audit record was written for the approval').toBe(1);
    expect(Number(audit[0].user_id)).toBe(actors.staff.userId);
  });

  test('rejection requires a reason, and the reason is preserved', async ({ browser }, testInfo) => {
    const created = await asActor<any>(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/links',
      {
        // The spare recipient again — the link created for the unconfirmed
        // check above deletes itself, so this pair is free.
        cared_for_id: actors.spare.userId,
        relationship_type: 'family',
        start_date: today(),
        notes: 'E2E — staff rejection path',
      },
    );
    const rejectId = Number(unwrap<any>(created.json)?.id ?? 0);
    expect(rejectId, `could not create the rejection-path link: ${created.text}`).toBeGreaterThan(0);

    const { context, page } = await contextForActor(browser, actors.staff);
    try {
      await page.goto(tenantPath('/caring/workflow'));
      const row = page.locator(`section[aria-labelledby="caregiver-link-${rejectId}"]`);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const reject = row.getByRole('button', { name: 'Reject caregiver link' });
      await expect(reject, 'a caregiver link could be rejected with no reason given').toBeDisabled();

      const reason = 'Could not reach the care recipient to verify consent.';
      await row.getByLabel('Rejection reason').fill(reason);
      await expect(reject).toBeEnabled();
      await reject.click();

      await expect(
        row.getByText('Caregiver link rejected'),
        'the rejected row is not visibly marked as rejected',
      ).toBeVisible({ timeout: 20_000 });

      await testInfo.attach('C4-rejected.png', {
        body: await page.screenshot(),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }

    const row = readCaregiverLinkRow(rejectId);
    expect(row!.status).toBe('rejected');
    expect(Number(row!.rejected_by)).toBe(actors.staff.userId);
    expect(row!.rejection_reason, 'the rejection reason was not preserved').toContain(
      'Could not reach the care recipient',
    );
  });

  test('an ordinary member is refused the staff route; other-community staff see nothing', async () => {
    const member = await asActor(
      actors.caregiver,
      'GET',
      '/v2/admin/caring-community/caregiver-links?status=pending',
    );
    expect([401, 403], `an ordinary member reached the staff queue (${member.status})`).toContain(
      member.status,
    );

    // Cross-community: no read, and no write.
    const theirQueue = await asActor<any>(
      actors.otherStaff,
      'GET',
      '/v2/admin/caring-community/caregiver-links?status=pending',
    );
    if (theirQueue.status === 200) {
      const ids = (unwrap<any[]>(theirQueue.json) || []).map((r: any) => Number(r.id));
      expect(ids, 'our community link leaked into another community queue').not.toContain(
        primaryLinkId,
      );
    }

    const crossApprove = await asActor(
      actors.otherStaff,
      'POST',
      `/v2/admin/caring-community/caregiver-links/${primaryLinkId}/approve`,
      { consent_verified: true, consent_evidence: 'cross-community attempt' },
    );
    expect(
      crossApprove.status,
      'staff from another community mutated this community record',
    ).toBeGreaterThanOrEqual(400);

    // The record is unchanged by the attempt.
    const row = readCaregiverLinkRow(primaryLinkId);
    expect(Number(row!.approved_by)).toBe(actors.staff.userId);
    expect(Number(row!.tenant_id)).toBe(actors.staff.tenantId);
  });
});

// ---------------------------------------------------------------------------
// Walkthrough D — the authority that an approved link unlocks
// ---------------------------------------------------------------------------

test.describe('D — an active link confers real caregiver authority', () => {
  test('the caregiver dashboard now shows the link as active, with its controls', async ({
    browser,
  }, testInfo) => {
    const { context, page } = await contextForActor(browser, actors.caregiver);
    try {
      await page.goto(tenantPath('/caring-community/caregiver'));
      await assertLandedOn(page, /\/caring-community\/caregiver\/?$/, 'the caregiver dashboard');
      await answerCaringOnboardingIfShown(page);

      await expect(
        page.getByText('Active', { exact: true }).first(),
        'the approved link is not shown as active',
      ).toBeVisible({ timeout: 20_000 });

      // The controls withheld while pending must now be present.
      await expect(
        page.locator('a[href*="/caring-community/caregiver/cover"]'),
        'an ACTIVE link still exposes no cover-care controls',
      ).not.toHaveCount(0);

      await testInfo.attach('D1-active-link.png', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
    } finally {
      await context.close();
    }
  });

  test('the care schedule opens for the linked recipient only', async () => {
    const ok = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.recipient.userId}`,
    );
    expect(ok.status, `an ACTIVE link did not unlock the schedule (${ok.text.slice(0, 200)})`).toBe(
      200,
    );

    // 🔴 The cared-for member must not be substitutable. An active link with
    // ONE person is not authority over anyone else.
    const unrelated = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.otherStaff.userId}`,
    );
    expect(
      unrelated.status,
      'the caregiver read the schedule of a member they have no link with',
    ).toBeGreaterThanOrEqual(400);

    const self = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.caregiver.userId}`,
    );
    expect(self.status, 'the caregiver was treated as their own care recipient').toBeGreaterThanOrEqual(
      400,
    );
  });

  test('an on-behalf help request is attributed to the caregiver and owned by the cared-for member', async () => {
    // 🔴 `/v2/caring-community/request-help` is NOT the on-behalf route. It is
    // the member's own request: it reads `what` / `when` and hard-codes
    // `user_id => $userId`, so it can only ever create a request for the caller.
    // On-behalf is a separate endpoint whose service guard requires an ACTIVE
    // link. Pointing this test at the wrong one would have produced a request
    // owned by the caregiver and called it a pass.
    const created = await asActor<any>(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/request-on-behalf',
      {
        cared_for_id: actors.recipient.userId,
        title: 'E2E journey — on-behalf request',
        description: 'Raised by an approved caregiver for their linked care recipient.',
        when_needed: 'This week',
        contact_preference: 'message',
      },
    );

    expect(
      created.status,
      `on-behalf request was refused for an ACTIVE caregiver link: ${created.status} ${created.text.slice(0, 300)}`,
    ).toBe(201);

    const request = unwrap<any>(created.json);
    const requestId = Number(request?.id ?? 0);
    expect(requestId, `no request id returned: ${created.text.slice(0, 300)}`).toBeGreaterThan(0);

    // Read it back from the database, in a separate process.
    const rows = queryDisposableDb(
      `SELECT id, tenant_id, IFNULL(user_id,'') user_id, IFNULL(requested_by_id,'') requested_by_id,
              is_on_behalf, IFNULL(what,'') what
         FROM caring_help_requests WHERE id = ${requestId}`,
    );
    expect(rows.length, 'the on-behalf request was not persisted').toBe(1);

    expect(Number(rows[0].tenant_id), 'the request was written to the wrong community').toBe(
      actors.caregiver.tenantId,
    );
    // 🔴 The two attributions that matter, and they are different people:
    // the request BELONGS TO the cared-for member, and is ATTRIBUTED TO the
    // caregiver who raised it. Collapsing them would erase who acted.
    expect(Number(rows[0].user_id), 'the request is not owned by the cared-for member').toBe(
      actors.recipient.userId,
    );
    expect(
      Number(rows[0].requested_by_id),
      'the request is not attributed to the acting caregiver',
    ).toBe(actors.caregiver.userId);
    expect(rows[0].is_on_behalf, 'the request is not flagged as made on behalf').toBe('1');
  });

  test('a REJECTED or absent link confers no on-behalf authority', async () => {
    // otherStaff is in a different community and has no link at all.
    const unrelated = await asActor(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/request-on-behalf',
      {
        cared_for_id: actors.otherStaff.userId,
        title: 'E2E journey — must be refused',
        description: 'No link exists, and the member is in another community.',
      },
    );
    expect(
      unrelated.status,
      'a caregiver raised an on-behalf request for a member they have no link with',
    ).toBeGreaterThanOrEqual(400);

    // A self-link is not authority over oneself either.
    const selfBehalf = await asActor(
      actors.caregiver,
      'POST',
      '/v2/caring-community/caregiver/request-on-behalf',
      { cared_for_id: actors.caregiver.userId, title: 'E2E journey — self, must be refused' },
    );
    expect(
      selfBehalf.status,
      'the caregiver raised an on-behalf request for themselves',
    ).toBeGreaterThanOrEqual(400);

    // And once a link is inactive, the authority it carried must end with it.
    queryDisposableDb(
      `UPDATE caring_caregiver_links SET status='inactive' WHERE id=${primaryLinkId}`,
    );
    const afterEnd = await asActor(
      actors.caregiver,
      'GET',
      `/v2/caring-community/caregiver/schedule/${actors.recipient.userId}`,
    );
    queryDisposableDb(
      `UPDATE caring_caregiver_links SET status='active' WHERE id=${primaryLinkId}`,
    );

    expect(
      afterEnd.status,
      'an INACTIVE caregiver link still unlocked the care schedule',
    ).toBeGreaterThanOrEqual(400);
  });
});

test.afterAll(async () => {
  // Report what this run left behind rather than silently tidying it away — the
  // environment is disposable and `bash scripts/webuk-e2e-env.sh reset` is the
  // deterministic wipe. Deleting rows here would also destroy the evidence.
  const rows = queryDisposableDb(
    `SELECT id, status FROM caring_caregiver_links
      WHERE caregiver_id IN (${actors.caregiver.userId}, ${actors.recipient.userId})
      ORDER BY id`,
  );
  console.log(
    `\n[caring journey] records left in ${CARING_TENANT}: ` +
      `${rows.map((r) => `#${r.id}=${r.status}`).join(', ') || 'none'}\n` +
      `[caring journey] wipe with: bash scripts/webuk-e2e-env.sh reset && bash scripts/caring-e2e-provision.sh`,
  );
});
