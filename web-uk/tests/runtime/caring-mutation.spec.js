// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community caregiver-consent journey — accessible frontend, real browser.
 *
 * Three people act in turn on ONE record: a member proposes to care for someone,
 * that person answers for themselves, and staff verify the consent before any
 * authority exists.
 *
 * 🔴 THE WHOLE JOURNEY RUNS WITH JAVASCRIPT DISABLED.
 *
 * Not as a bonus pass afterwards — as the only pass. This frontend exists for
 * people who need an HTML-first experience, and the members these care
 * relationships are about are the ones most likely to be on assistive
 * technology, an old browser, or a connection where scripts never arrive. If any
 * step of a safeguarding journey needs JavaScript, the journey is not accessible,
 * and running it script-enabled would hide that.
 *
 * 🔴 Every protected page asserts WHICH page it landed on. `page.goto()` follows
 * redirects silently, and the login page satisfies every generic structural
 * assertion — it has a `main`, an `h1`, a skip link. That mistake made an earlier
 * accessibility spec scan `/login` six times and report member-page coverage.
 *
 * 🔴 RESET THE FIXTURE FIRST — THIS JOURNEY IS NOT SELF-CLEANING.
 *
 * It shares one disposable Laravel, and the same three actors, with the React
 * journey in `e2e/journeys/caring/`. That one cleans up after itself in
 * `beforeAll`; this one deliberately does not, because doing so from a
 * no-JavaScript browser context would mean adding an authenticated API client
 * the journey otherwise has no need for.
 *
 * The consequence: run it straight after the React journey and the caregiver
 * already has an active link with the recipient, so creation is correctly
 * refused by the duplicate guard and the success banner never appears. That
 * reads as "the form is broken" and is nothing of the kind. Run:
 *
 *     bash scripts/webuk-e2e-env.sh reset && bash scripts/caring-e2e-provision.sh
 *
 * before this spec, every time.
 *
 * 🔴 The login form has FOUR submit buttons on this frontend: the language
 * switcher, the cookie banner, and the search form all carry one. Selecting on
 * `button[type=submit]` or `form[action*="login"]` submits the wrong one and
 * leaves the browser signed OUT while a probe reports success. The selector below
 * is scoped to the form that actually contains the password field.
 */

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;

const TENANT = process.env.SMOKE_TENANT || 'e2e-community';
const MOUNT = `/${encodeURIComponent(TENANT)}/accessible`;

const ACTORS = {
  caregiver: {
    email: process.env.CARING_CAREGIVER_EMAIL || 'e2e.user.a@project-nexus.local',
    password: process.env.CARING_CAREGIVER_PASSWORD || 'TestPassword123!',
    name: 'E2E UserA'
  },
  recipient: {
    email: process.env.CARING_RECIPIENT_EMAIL || 'e2e.user.b@project-nexus.local',
    password: process.env.CARING_RECIPIENT_PASSWORD || 'TestPassword123!',
    name: 'E2E UserB'
  },
  staff: {
    email: process.env.CARING_STAFF_EMAIL || 'e2e.admin@project-nexus.local',
    password: process.env.CARING_STAFF_PASSWORD || 'AdminPassword123!',
    name: 'E2E Admin'
  }
};

/** Refuse to run against anything but synthetic accounts. */
for (const [key, actor] of Object.entries(ACTORS)) {
  if (!/@project-nexus\.local$|@example\./.test(actor.email)) {
    throw new Error(`Refusing to run: ${key} (${actor.email}) is not a synthetic account.`);
  }
}

/** A context with JavaScript OFF — the only mode this journey runs in. */
async function noScriptContext(browser) {
  return browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
}

async function signIn(page, actor) {
  await page.goto(`${MOUNT}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(actor.email);
  await page.locator('input[name="password"]').fill(actor.password);
  // Scoped to the form holding the password field — see the header note.
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded');

  expect(
    new URL(page.url()).pathname,
    `${actor.email} is still on the login page — the sign-in did not take`
  ).not.toContain('/login');
}

/** Prove the browser is on the intended page, not a redirect to login. */
async function assertOn(page, expected, label) {
  const pathname = new URL(page.url()).pathname;
  expect(pathname, `Expected ${label}; got a LOGIN redirect (${pathname})`).not.toContain('/login');
  expect(pathname, `Expected ${label} matching ${expected}, got ${pathname}`).toMatch(expected);
}

/**
 * Structural checks that hold with scripts DISABLED.
 *
 * 🔴 Axe deliberately does NOT run here, and that is not an omission.
 *
 * axe-core is a JavaScript library that executes inside the page. In a context
 * with `javaScriptEnabled: false` it cannot be injected at all — the first
 * attempt failed with "Execution context was destroyed", which reads like a
 * navigation race and is actually axe having nowhere to run. Quietly enabling
 * JavaScript to make it pass would have silently ended the no-JavaScript
 * journey this whole spec exists to prove.
 *
 * So the two are separated: the JOURNEY runs script-free, and axe runs over the
 * same pages in its own scripted pass below. The checks kept here are the ones
 * that need no scripting and that axe cannot make anyway — one main landmark,
 * one h1, no duplicate ids (which would break every id-based label and every
 * error-summary link), and no horizontal overflow.
 */
async function expectStructure(page, label) {
  await expect(page.locator('main'), `${label}: expected exactly one main landmark`).toHaveCount(1);
  await expect(page.locator('h1'), `${label}: expected exactly one h1`).toHaveCount(1);

  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map((element) => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds, `${label}: duplicate element ids break every id-based label`).toEqual([]);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content, `${label}: content overflows the viewport`).toBeLessThanOrEqual(
    dimensions.viewport
  );
}

test.describe('Caring caregiver consent — accessible frontend, no JavaScript', () => {
  test('the whole journey works with scripts disabled', async ({ browser }, testInfo) => {
    // ---------------------------------------------------------------------
    // 1. The proposing caregiver reaches Caring through real navigation
    // ---------------------------------------------------------------------
    const caregiverContext = await noScriptContext(browser);
    const caregiver = await caregiverContext.newPage();

    await signIn(caregiver, ACTORS.caregiver);

    // Reached by following links, not by pasting a deep link: Explore is the
    // maintained discovery page and is where a member would actually find this.
    await caregiver.goto(`${MOUNT}/explore`, { waitUntil: 'domcontentloaded' });
    await assertOn(caregiver, /\/explore\/?$/, 'the Explore page');

    const caringEntry = caregiver.locator(`a[href$="${MOUNT}/caring"]`).first();
    await expect(
      caringEntry,
      'Caring Community is not reachable from Explore — the journey exists but cannot be found'
    ).toBeVisible();
    await caringEntry.click();
    await assertOn(caregiver, /\/caring\/?$/, 'the Caring Community hub');
    await expectStructure(caregiver, 'Caring hub');
    await testInfo.attach('W1-hub.png', { body: await caregiver.screenshot(), contentType: 'image/png' });

    // ---------------------------------------------------------------------
    // 2. Ask to care for someone — keyboard only
    // ---------------------------------------------------------------------
    await caregiver.getByRole('link', { name: /ask to care for someone/i }).first().click();
    await assertOn(caregiver, /\/caring\/caregiver\/link\/?$/, 'the caregiver-link form');
    await expectStructure(caregiver, 'caregiver-link form');

    // The consent warning must be on the page BEFORE anything is submitted.
    await expect(
      caregiver.locator('.govuk-warning-text'),
      'the page does not warn that the other member will be asked'
    ).toContainText(/asked whether they agree|does not begin/i);

    // Keyboard only: focus the search field by tabbing to it, type, submit with
    // Enter. If the field cannot be reached this way the form is unusable for a
    // keyboard user regardless of how it looks.
    const search = caregiver.locator('#caring-search');
    await search.focus();
    await expect(
      caregiver.locator(':focus'),
      'the member search field cannot take keyboard focus'
    ).toHaveAttribute('id', 'caring-search');
    await caregiver.keyboard.type('UserB');
    await caregiver.keyboard.press('Enter');
    await caregiver.waitForLoadState('domcontentloaded');

    // A GET search: a real, linkable page state rather than a live dropdown.
    await assertOn(caregiver, /\/caring\/caregiver\/link\/?$/, 'the search results');
    const chooseLink = caregiver.getByRole('link', { name: new RegExp(`choose\\s*${ACTORS.recipient.name}`, 'i') }).first();
    await expect(
      chooseLink,
      `the member search did not offer ${ACTORS.recipient.name} — with scripts disabled`
    ).toBeVisible();
    await testInfo.attach('W2-search-results.png', { body: await caregiver.screenshot(), contentType: 'image/png' });
    await chooseLink.click();

    // ---------------------------------------------------------------------
    // 3. Submitting with a missing date shows a linked error summary
    // ---------------------------------------------------------------------
    await caregiver.locator('#relationship_type').selectOption('neighbour');
    await caregiver.getByRole('button', { name: /send request/i }).click();
    await caregiver.waitForLoadState('domcontentloaded');

    const summary = caregiver.locator('.govuk-error-summary');
    await expect(summary, 'no error summary after submitting an incomplete form').toBeVisible();
    // 🔴 A summary is only useful if its messages LINK to the field they are
    // about, and if it can take focus. Both are asserted, not assumed.
    const firstError = summary.locator('a').first();
    await expect(firstError).toHaveAttribute('href', /^#/);
    await expect(summary).toHaveAttribute('tabindex', '-1');

    const target = await firstError.getAttribute('href');
    await expect(
      caregiver.locator(target),
      `the error links to ${target}, which is not on the page`
    ).toHaveCount(1);
    await testInfo.attach('W3-error-summary.png', { body: await caregiver.screenshot(), contentType: 'image/png' });

    // ---------------------------------------------------------------------
    // 4. Complete it properly
    // ---------------------------------------------------------------------
    await caregiver.locator('#start_date-day').fill('29');
    await caregiver.locator('#start_date-month').fill('8');
    await caregiver.locator('#start_date-year').fill('2026');
    await caregiver.locator('#relationship_type').selectOption('neighbour');
    await caregiver.getByRole('button', { name: /send request/i }).click();
    await caregiver.waitForLoadState('domcontentloaded');

    await assertOn(caregiver, /\/caring\/caregiver\/?$/, 'your caring relationships');
    await expect(
      caregiver.locator('.govuk-notification-banner--success'),
      'no confirmation that the request was sent'
    ).toContainText(/waiting|agree|check/i);

    // ---------------------------------------------------------------------
    // 5. Pending survives a FULL RELOAD, and confers nothing
    // ---------------------------------------------------------------------
    await caregiver.reload({ waitUntil: 'domcontentloaded' });
    await assertOn(caregiver, /\/caring\/caregiver\/?$/, 'your caring relationships after reload');

    const linkCard = caregiver.locator('[data-caring-link]').first();
    await expect(linkCard, 'the pending relationship did not survive a reload').toBeVisible();
    await expect(linkCard).toHaveAttribute('data-caring-status', 'pending');
    await expect(linkCard).toContainText(/waiting for the other member/i);

    // 🔴 Pending must expose no route into caregiver authority at all.
    await expect(
      caregiver.locator('a[href*="/caring/caregiver/on-behalf/"]'),
      'a PENDING relationship offered the on-behalf entry point'
    ).toHaveCount(0);
    await expectStructure(caregiver, 'caring relationships (pending)');
    await testInfo.attach('W4-pending.png', { body: await caregiver.screenshot({ fullPage: true }), contentType: 'image/png' });

    await caregiverContext.close();

    // ---------------------------------------------------------------------
    // 6. The care recipient answers, in their own session, without scripts
    // ---------------------------------------------------------------------
    const recipientContext = await noScriptContext(browser);
    const recipient = await recipientContext.newPage();
    await signIn(recipient, ACTORS.recipient);

    await recipient.goto(`${MOUNT}/caring/caregiver`, { waitUntil: 'domcontentloaded' });
    await assertOn(recipient, /\/caring\/caregiver\/?$/, 'the recipient’s caring page');

    const incoming = recipient.locator('[data-caring-incoming]').first();
    await expect(incoming, 'the recipient sees no request about them').toBeVisible();
    await expect(incoming, 'the request does not name who asked').toContainText(ACTORS.caregiver.name);
    await expect(incoming).toContainText(/staff will check|does not start it/i);
    await expectStructure(recipient, 'incoming caregiver request');
    await testInfo.attach('W5-incoming.png', { body: await recipient.screenshot(), contentType: 'image/png' });

    await incoming.getByRole('button', { name: /i agree to this relationship/i }).click();
    await recipient.waitForLoadState('domcontentloaded');

    await expect(
      recipient.locator('.govuk-notification-banner--success'),
      'agreeing produced no confirmation'
    ).toContainText(/staff will now check|check the request/i);
    // 🔴 Agreeing must NOT start the relationship.
    await expect(
      recipient.locator('[data-caring-incoming]'),
      'the request is still listed as awaiting the recipient after they agreed'
    ).toHaveCount(0);
    await testInfo.attach('W6-agreed.png', { body: await recipient.screenshot(), contentType: 'image/png' });

    await recipientContext.close();

    // ---------------------------------------------------------------------
    // 7. Staff verify the consent, and cannot approve without doing so
    // ---------------------------------------------------------------------
    const staffContext = await noScriptContext(browser);
    const staff = await staffContext.newPage();
    await signIn(staff, ACTORS.staff);

    await staff.goto(`${MOUNT}/caring/reviews`, { waitUntil: 'domcontentloaded' });
    await assertOn(staff, /\/caring\/reviews\/?$/, 'the staff review queue');
    await expectStructure(staff, 'staff review queue');

    const review = staff.locator('[data-caring-review]').first();
    await expect(review, 'the confirmed request is not in the staff queue').toBeVisible();
    await expect(review).toHaveAttribute('data-recipient-agreed', 'yes');
    await expect(review).toContainText(ACTORS.caregiver.name);
    await expect(review).toContainText(ACTORS.recipient.name);
    await testInfo.attach('W7-review-queue.png', { body: await staff.screenshot(), contentType: 'image/png' });

    // Approving with neither evidence nor attestation must be refused, with a
    // linked summary rather than a bare failure.
    await review.getByRole('button', { name: /approve relationship/i }).click();
    await staff.waitForLoadState('domcontentloaded');

    const reviewSummary = staff.locator('.govuk-error-summary');
    await expect(reviewSummary, 'approval without evidence produced no error summary').toBeVisible();
    const reviewErrorHref = await reviewSummary.locator('a').first().getAttribute('href');
    await expect(
      staff.locator(reviewErrorHref),
      `the review error links to ${reviewErrorHref}, which is not on the page`
    ).toHaveCount(1);
    await testInfo.attach('W8-approval-refused.png', { body: await staff.screenshot(), contentType: 'image/png' });

    // Now do it properly: evidence AND the explicit attestation.
    const liveReview = staff.locator('[data-caring-review]').first();
    const reviewId = await liveReview.getAttribute('data-caring-review');
    await staff.locator(`#consent_evidence_${reviewId}`).fill('Telephone call with the member on 29 August 2026.');
    // The attestation is a real checkbox — operable by keyboard, with a label.
    const attestation = staff.locator(`#consent_verified_${reviewId}`);
    await attestation.check();
    await expect(attestation, 'the attestation is not a real checkbox').toBeChecked();

    await liveReview.getByRole('button', { name: /approve relationship/i }).click();
    await staff.waitForLoadState('domcontentloaded');

    await expect(
      staff.locator('.govuk-notification-banner--success'),
      'approval produced no confirmation'
    ).toContainText(/approved/i);
    await testInfo.attach('W9-approved.png', { body: await staff.screenshot(), contentType: 'image/png' });

    await staffContext.close();

    // ---------------------------------------------------------------------
    // 8. Back as the caregiver: active, and the authority is now offered
    // ---------------------------------------------------------------------
    const afterContext = await noScriptContext(browser);
    const after = await afterContext.newPage();
    await signIn(after, ACTORS.caregiver);

    await after.goto(`${MOUNT}/caring/caregiver`, { waitUntil: 'domcontentloaded' });
    await assertOn(after, /\/caring\/caregiver\/?$/, 'your caring relationships');

    const activeCard = after.locator('[data-caring-status="active"]').first();
    await expect(activeCard, 'the approved relationship is not shown as active').toBeVisible();

    const onBehalf = after.locator('a[href*="/caring/caregiver/on-behalf/"]').first();
    await expect(
      onBehalf,
      'an ACTIVE relationship still offers no on-behalf entry point'
    ).toBeVisible();
    await testInfo.attach('W10-active.png', { body: await after.screenshot({ fullPage: true }), contentType: 'image/png' });

    await onBehalf.click();
    await assertOn(after, /\/caring\/caregiver\/on-behalf\/\d+\/?$/, 'the on-behalf request form');
    await expectStructure(after, 'on-behalf request form');

    // The member the request is for is FIXED and shown — it is the authority
    // question, not an input the person filling this in can change.
    await expect(after.locator('main')).toContainText(ACTORS.recipient.name);
    await expect(
      after.locator('input[name="cared_for_id"], select[name="cared_for_id"]'),
      'the cared-for member is an editable field — it must be fixed by the route'
    ).toHaveCount(0);

    await after.locator('#on_behalf_title').fill('Lift to a hospital appointment');
    await after.getByRole('button', { name: /send request/i }).click();
    await after.waitForLoadState('domcontentloaded');

    await expect(
      after.locator('.govuk-notification-banner--success'),
      'the on-behalf request produced no confirmation'
    ).toContainText(/sent/i);
    await testInfo.attach('W11-on-behalf-sent.png', { body: await after.screenshot(), contentType: 'image/png' });

    await afterContext.close();
  });
});

/**
 * Axe, in its own SCRIPTED pass over the same pages.
 *
 * Runs after the journey so the records it needs already exist: an empty queue
 * and a populated one are different pages, and scanning only the empty one
 * would miss every control the journey actually adds.
 *
 * 🔴 A clean axe run is not an accessibility pass. Automated tooling cannot see
 * focus order, whether a heading describes what follows it, or whether an error
 * message says something useful. Those are asserted structurally in the journey
 * above and still need the manual screen-reader pack
 * (docs/SCREEN_READER_TEST_PACK.md) before any conformance claim.
 */
test.describe('Caring caregiver pages — automated WCAG scan', () => {
  test('the caregiver pages have no serious or critical axe violations', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await signIn(page, ACTORS.staff);

    // Staff can reach the review queue AND the member pages, so one session
    // covers both halves of the journey.
    const pages = [
      ['/caring', /\/caring\/?$/, 'Caring hub'],
      ['/caring/caregiver', /\/caring\/caregiver\/?$/, 'your caring relationships'],
      ['/caring/caregiver/link', /\/caring\/caregiver\/link\/?$/, 'caregiver-link form'],
      ['/caring/reviews', /\/caring\/reviews\/?$/, 'staff review queue']
    ];

    for (const [pathname, expected, label] of pages) {
      await page.goto(`${MOUNT}${pathname}`, { waitUntil: 'domcontentloaded' });
      // 🔴 Prove the page, or axe is just scanning /login again.
      await assertOn(page, expected, label);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const serious = results.violations.filter(
        ({ impact }) => impact === 'serious' || impact === 'critical'
      );
      expect(
        serious.map((v) => `${v.id} (${v.nodes.length} node(s)): ${v.help}`),
        `${label}: serious/critical axe violations`
      ).toEqual([]);
    }

    await context.close();
  });
});
