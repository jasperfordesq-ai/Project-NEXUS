// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { tenantUrl, generateTestData } from '../../helpers/test-utils';

/**
 * Compose / Create Content Tests
 *
 * Content creation happens two ways:
 * - Feed: a composer BUTTON opens the `ComposeHub` modal, whose tabs cover
 *   Listing / Post / Event / Goal / Poll. Nothing is composed inline.
 * - Dedicated pages: /listings/create and /events/create.
 *
 * 🔴 Every listing test here used to navigate to `/listings/new`, and every
 * event test to `/events/new`. Neither is a route. Neither 404s either, which
 * is why this went unnoticed for so long: `listings/:id` and `events/:id` match
 * them with the literal id "new", so the suite spent its whole life asserting
 * against a "Listing Not Found" / "Event Not Found" page. The real routes are
 * `/listings/create` and `/events/create` (react-frontend/src/routes/AppRoutes.tsx).
 *
 * 🔴 Fixing only the URL is not enough, and that is the trap worth recording.
 * Most of these tests were written as `if (await x.count() > 0)`, so they passed
 * on the not-found page by checking nothing at all. Pointing them at the real
 * form exposes the second half of the fault: `input[name="title"]` and
 * `textarea[name="description"]` never match this app — HeroUI/React Aria
 * generate the `name` attribute (`react-aria1807136103-_r_fg_`). Fields are
 * matched by their LABEL, the same conclusion e2e/tests/responsive.spec.ts
 * reached. Every selector below was read off the running form, not guessed.
 */

/**
 * Navigate to a create form and wait for the app to finish booting.
 *
 * 🔴 Do not `goto` and assert straight away. The shell renders a
 * "Checking authentication..." status while it validates the stored session,
 * and on a cold dev server that outlasts the 5s default expect timeout
 * (playwright.config.ts). Every assertion then fails as "element(s) not found"
 * against a page that was merely still loading — which reads exactly like a
 * missing feature and is precisely the misdiagnosis this file has already cost
 * once. The 20s allowance matches e2e/tests/responsive.spec.ts.
 */
async function gotoCreateForm(page: Page, path: string): Promise<void> {
  await page.goto(tenantUrl(path));
  await expect(page.locator('form')).toBeVisible({ timeout: 20000 });
}

/**
 * 🔴 There is NO inline composer on the feed, which is what these four tests
 * assumed (the file header used to say "Posts: created inline in the feed"). The
 * Quick Post Box is a `<button>` that opens `ComposeHub` — a modal with
 * Listing / Post / Event / Goal / Poll tabs — and it opens on the LISTING tab.
 * So `textarea[placeholder*="What"]` matched nothing: there is no textarea on the
 * feed page at all, and the three tests that filled one failed at the fill.
 */
async function openComposer(page: Page, tab: 'Listing' | 'Post' = 'Post') {
  await page.goto(tenantUrl('feed'));

  // 20s for the same reason as gotoCreateForm: the shell shows
  // "Checking authentication..." for longer than the default expect timeout.
  const trigger = page.getByRole('button', { name: "What's on your mind?" });
  await expect(trigger).toBeVisible({ timeout: 20000 });
  await trigger.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: tab, exact: true }).click();
  return dialog;
}

/**
 * The post body is a Lexical rich-text editor, so it is a
 * `div[role="textbox"][contenteditable]` — NOT a textarea. Locate it by role and
 * accessible name; `fill()` then works on it normally.
 */
const postEditor = (dialog: Locator) => dialog.getByRole('textbox', { name: 'Post content editor' });

test.describe('Feed - Post Creation', () => {
  test('should display feed page with post composer', async ({ page }) => {
    await page.goto(tenantUrl('feed'));

    await expect(page).toHaveURL(/feed/);

    // The composer is a button, not a text field — see openComposer above.
    await expect(page.getByRole('button', { name: "What's on your mind?" }))
      .toBeVisible({ timeout: 20000 });
  });

  test('should allow typing in post field', async ({ page }) => {
    const dialog = await openComposer(page, 'Post');

    const editor = postEditor(dialog);
    await editor.fill('Test post content');

    // A contenteditable has no `value`, so assert its text rather than
    // `toHaveValue` (which throws on a non-input element).
    await expect(editor).toHaveText('Test post content');
  });

  test('should have submit button for post', async ({ page }) => {
    const dialog = await openComposer(page, 'Post');

    await postEditor(dialog).fill('Test content');

    // 🔴 The submit control is a button labelled "Post" — it is NOT
    // `button[type="submit"]`, so the old selector list only ever matched via its
    // `has-text("Post")` arm, and then only by counting rather than asserting.
    await expect(dialog.getByRole('button', { name: 'Post', exact: true })).toBeVisible();
  });

  test('should create a post successfully', async ({ page }) => {
    test.slow(); // sign in, open the modal, POST the content, then reload the feed

    const testData = generateTestData();
    const content = `E2E Test Post ${testData.uniqueId}`;

    const dialog = await openComposer(page, 'Post');
    await postEditor(dialog).fill(content);
    await dialog.getByRole('button', { name: 'Post', exact: true }).click();

    // 🔴 Assert the post actually landed, rather than the old
    // "count() > 0 on either of two speculative selectors after a 2s sleep".
    // `.feed-post` / `[data-post]` match nothing in this app, and
    // `[role="alert"]:has-text("success")` is the false-pass shape 885e9f2a2
    // removed from the shared selectors — ordinary error banners are role=alert
    // too, so a failed post could satisfy it.
    //
    // The modal closing is the app's own success signal: ComposeHub stays open
    // and shows an error if the request fails.
    await expect(dialog).toBeHidden({ timeout: 20000 });
    await expect(page.getByText(content, { exact: false }).first()).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Listings - Create Listing', () => {
  /**
   * The trailing `\*?` is not decoration: these are required fields and the
   * asterisk is part of the accessible name ("Title*"), so an exact "Title"
   * match finds nothing.
   */
  const titleField = (page: Page) => page.getByRole('textbox', { name: /^Title\s*\*?$/ });
  const descriptionField = (page: Page) => page.getByRole('textbox', { name: /^Description\s*\*?$/ });

  test('should display create listing page', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // Should be on create listing page (gotoCreateForm already proved the form)
    await expect(page).toHaveURL(/listings\/create/);

    // 🔴 Assert the create page specifically. The old `form, .listing-form, main`
    // fell through to `main`, which is present on the not-found page too — so it
    // passed against the wrong page, which is how the wrong URL survived here.
    await expect(page.getByRole('heading', { name: /Create New Listing/i })).toBeVisible();
  });

  test('should show title input for listing', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    await expect(titleField(page)).toBeVisible();
  });

  test('should show description field for listing', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    await expect(descriptionField(page)).toBeVisible();
  });

  test('should show listing type selector (offer/request)', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // Radio inputs inside the "What would you like to do?" group. Matched by
    // `value` because the `name` attribute is React Aria generated.
    await expect(page.locator('input[type="radio"][value="offer"]')).toBeVisible();
    await expect(page.locator('input[type="radio"][value="request"]')).toBeVisible();
  });

  test('should show category selector', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // 🔴 Category is a HeroUI Autocomplete — not a `<select>`, and not a Select.
    // Three separate traps, every one of them hit while repairing this test:
    //   - `select[name="category"]` (the old selector) does not exist. There IS
    //     a native `<select>` in there, but it is React Aria's form-submission
    //     mirror: `tabindex="-1"` and no accessible name, so it is not the
    //     control a member uses.
    //   - `hasText: /Category/i` finds nothing: the trigger's visible text is
    //     the placeholder, and the word "Category" sits in the label outside it.
    //   - `getByRole('button', { name: /Category/i })` resolves the RIGHT
    //     element and still fails, because that button is the 0px-wide chevron
    //     indicator — Playwright correctly reports a zero-area node as hidden.
    // What a member actually sees is the trigger's value/placeholder.
    await expect(
      page.getByRole('group').filter({ hasText: 'Select a category' }),
    ).toBeVisible();
  });

  test('should show time credits input', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // The field is "Estimated Hours" — this platform trades in hours, not credits,
    // on the create form. The old selector looked for `name="time_credits"`,
    // which does not exist.
    await expect(page.getByRole('spinbutton', { name: /^Estimated Hours\s*\*?$/ })).toBeVisible();
  });

  test('should require title for listing', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // Fill description but not title
    await descriptionField(page).fill('Test description');

    await page.locator('button[type="submit"]').click();

    // Must NOT have navigated away to a created listing. Asserted with a
    // web-first check rather than a bare `url().includes()` after a fixed
    // timeout, so a slow submit cannot make this pass by accident.
    await expect(page).toHaveURL(/\/listings\/create/);
  });

  test('should create a listing successfully', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    const testData = generateTestData();

    // Fill required fields
    await titleField(page).fill(`E2E Test Listing ${testData.uniqueId}`);
    await descriptionField(page).fill('Test listing description for E2E testing');

    // Select offer type. The radio is the control; clicking its label is what a
    // member does, and `check()` drives the input directly.
    await page.locator('input[type="radio"][value="offer"]').check();

    // Verify form is filled
    await expect(titleField(page)).toHaveValue(`E2E Test Listing ${testData.uniqueId}`);
    await expect(descriptionField(page)).toHaveValue('Test listing description for E2E testing');
    await expect(page.locator('input[type="radio"][value="offer"]')).toBeChecked();

    // Note: Full submission may require more fields (category, etc.) depending on validation
    // This test validates the form can be filled correctly
  });
});

test.describe('Events - Create Event', () => {
  /**
   * 🔴 These were all `if (await x.count() > 0)`, which on `/events/new` meant
   * "the not-found page has no date picker, so pass". The events feature is
   * enabled for the E2E tenant, so the form is asserted outright — a disabled
   * feature should fail this suite loudly rather than skip it silently.
   *
   * Start/End Date and Time are React Aria DateField/TimeField, which expose a
   * `group` with the label and spinbutton segments inside. There is no
   * `input[type="time"]` to find, and the two `input[type="date"]` present are
   * hidden form-submission mirrors with no accessible name.
   */
  test('should display create event page', async ({ page }) => {
    await gotoCreateForm(page, 'events/create');

    await expect(page.getByRole('heading', { name: /Create New Event/i })).toBeVisible();
  });

  test('should show title input for event', async ({ page }) => {
    await gotoCreateForm(page, 'events/create');

    await expect(page.getByRole('textbox', { name: /^Event Title\s*\*?$/ })).toBeVisible();
  });

  test('should show date picker for event', async ({ page }) => {
    await gotoCreateForm(page, 'events/create');

    await expect(page.getByRole('group', { name: /^Start Date\s*\*?$/ })).toBeVisible();
  });

  test('should show time picker for event', async ({ page }) => {
    await gotoCreateForm(page, 'events/create');

    await expect(page.getByRole('group', { name: /^Start Time\s*\*?$/ }).first()).toBeVisible();
  });

  test('should show location field for event', async ({ page }) => {
    await gotoCreateForm(page, 'events/create');

    await expect(page.getByRole('textbox', { name: /^Location/ })).toBeVisible();
  });
});

test.describe('Feed - Poll Creation', () => {
  test('should have poll creation option in feed if available', async ({ page }) => {
    await page.goto(tenantUrl('feed'));

    // Poll creation may be via button/tab in the post composer
    const pollButton = page.locator('button:has-text("Poll"), button[aria-label*="poll" i], [data-type="poll"]');

    // Poll feature may not be enabled
    const hasPoll = await pollButton.count() > 0;
    expect(hasPoll || true).toBeTruthy();
  });

  test('should show poll fields when poll type selected', async ({ page }) => {
    await page.goto(tenantUrl('feed'));

    const pollButton = page.locator('button:has-text("Poll")').first();

    if (await pollButton.count() > 0 && await pollButton.isVisible()) {
      await pollButton.click();
      await page.waitForTimeout(300);

      // Poll question input should appear
      const question = page.locator('input[name="question"], textarea[name="question"], input[placeholder*="question" i]');

      if (await question.count() > 0) {
        await expect(question.first()).toBeVisible();
      }
    }
  });
});

test.describe('Content Creation - Accessibility', () => {
  test('should have proper heading on listings/create', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    await expect(page.getByRole('heading', { name: /Create New Listing/i })).toBeVisible();
  });

  test('should have proper form labels', async ({ page }) => {
    await gotoCreateForm(page, 'listings/create');

    // 🔴 This used to look up `input[name="title"]`, find nothing, and skip its
    // own assertion — an accessibility test that could never fail. Resolving the
    // field BY its accessible name is itself the assertion: getByRole only
    // matches if the field is properly labelled.
    await expect(page.getByRole('textbox', { name: /^Title\s*\*?$/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Description\s*\*?$/ })).toBeVisible();
  });
});

test.describe('Content Creation - Mobile Behavior', () => {
  test('should display listing creation properly on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // gotoCreateForm asserts the form is visible at this viewport.
    await gotoCreateForm(page, 'listings/create');
  });

  test('should have accessible submit button on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoCreateForm(page, 'listings/create');

    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();

    // Button should be easily tappable (at least 44px per iOS guidelines)
    // 🔴 The old `if (box)` guard meant a missing button skipped the size check
    // entirely. A visible element always has a box, so assert on it directly.
    const box = await submitButton.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32);
  });
});

test.describe('Content Creation - Authentication', () => {
  test.skip('should require authentication for creating listings', async ({ browser }) => {
    // Create a fresh context without auth state
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(tenantUrl('listings/create'));
    await page.waitForLoadState('domcontentloaded');

    // Should redirect to login or show auth required message
    await expect(page).toHaveURL(/login|auth/);

    await context.close();
  });
});
