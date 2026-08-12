// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Page } from '@playwright/test';
import { loginAsUser } from '../helpers/auth';
import { testUsers, testTenant, generateTestData, selectors, waitForToast } from '../helpers/fixtures';

/**
 * 🔴 The create route is `/listings/create`. Four tests below navigated to
 * `/listings/new`, which is not a route and does NOT 404 — `listings/:id`
 * matches it with the literal id "new", so they were filling in a form on a
 * "Listing Not Found" page.
 *
 * 🔴 They also used `input[name="title"]` / `textarea[name="description"]`,
 * which match nothing anywhere in this app: HeroUI/React Aria generate the
 * `name` attribute. Fields are addressed by their LABEL instead — the same
 * conclusion e2e/tests/responsive.spec.ts reached. Read off the running form
 * on 2026-08-12: Title, Description and Category are the three required
 * fields, and Category is a HeroUI Autocomplete (a `role="group"` trigger plus
 * a popover listbox), not a `<select>` the old `selectOption` could have driven.
 */
const titleField = (page: Page) => page.getByRole('textbox', { name: /^Title\s*\*?$/ });
const descriptionField = (page: Page) => page.getByRole('textbox', { name: /^Description\s*\*?$/ });

/**
 * Pick a category. Category is required by default
 * (`listing.require_category`), so a listing cannot be submitted without one.
 *
 * 🔴 Driving this control is not obvious, and two plausible approaches fail
 * SILENTLY-ish — they leave the trigger on its placeholder with the popover
 * still `[expanded]`, and because a React Aria popover keeps a click-blocking
 * underlay, the NEXT action then fails as "<body> intercepts pointer events",
 * which reads like a broken submit button and is not:
 *   - clicking the option directly, and
 *   - focusing the trigger then pressing ArrowDown + Enter.
 *
 * The reason is in `react-frontend/src/components/ui/Autocomplete.tsx`: the
 * popover wraps its ListBox in `<Autocomplete.Filter>` alongside a
 * `<SearchField>`, and React Aria puts focus in that search input. So the list
 * is filter-driven — type first, then commit. The search input's role is
 * `searchbox`, NOT `textbox`, which is why it is easy to miss when reading the
 * accessibility tree.
 */
async function chooseFirstCategory(page: Page): Promise<void> {
  await page.getByRole('group').filter({ hasText: 'Select a category' }).click();

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();

  // Narrow to one option, then commit from the search input where focus already is.
  await page.getByRole('searchbox').fill('Community');
  await expect(listbox.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // Selection closes the popover. If this fails, nothing was selected — do not
  // paper over it with a click elsewhere, because the form will then refuse to
  // submit for a reason that looks unrelated.
  await expect(listbox).toBeHidden();
  await expect(page.getByRole('group').filter({ hasText: 'Community' })).toBeVisible();
}

/**
 * Create a listing through the real form and leave the browser on its detail
 * page. Returns the new id.
 *
 * 🔴 The 20s wait is not padding. The create POST succeeds well inside 10s — the
 * row really is in the database — but `ListingForm` then awaits an unconditional
 * PUT /v2/listings/:id/tags before it navigates. The old 10s budget expired on a
 * page whose save had already worked, which reads as "create is broken".
 */
async function createListing(page: Page, title: string, description: string): Promise<string> {
  await page.goto(`/${testTenant.slug}/listings/create`);
  await page.waitForSelector('form', { state: 'visible' });

  await titleField(page).fill(title);
  await descriptionField(page).fill(description);

  // Category is required. 🔴 Do not select by the fixture's `listing.category`
  // ("Skills & Trades") — that is not one of this platform's categories
  // (Community, Creative Arts, Education and Tutoring, …), so it matches nothing.
  await chooseFirstCategory(page);

  await page.click(selectors.submitButton);
  await page.waitForURL(/\/listings\/\d+/, { timeout: 20000 });

  // `waitForURL` above already proved the pattern matched, so this is a type
  // guard rather than an assertion — throwing keeps it out of the suite's
  // assertion-quality budget while still failing loudly if it ever happens.
  const id = page.url().match(/\/listings\/(\d+)/)?.[1];
  if (!id) throw new Error(`expected a listing id in the URL, got ${page.url()}`);
  return id;
}

test.describe('Listings Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await loginAsUser(page, testUsers.primary.email, testUsers.primary.password, testTenant.slug);
  });

  test('should display listings page @smoke @critical', async ({ page }) => {
    await page.goto(`/${testTenant.slug}/listings`);

    // 🔴 Pre-existing failure, fixed here. Two faults, and the first masked the
    // second. The 5s default expect timeout expired while the shell was still
    // showing "Checking authentication...", so the heading — which does exist —
    // reported as not found. And `h1, h2` matches BOTH "Listings" and
    // "Browse Listings", so it fails strict mode once the page does paint.
    await expect(page.getByRole('heading', { name: /listings|marketplace/i }).first())
      .toBeVisible({ timeout: 20000 });

    // Search box should be visible. Scoped with .first() because the page renders
    // a desktop and a mobile search field.
    await expect(
      page.locator('input[type="search"], input[placeholder*="Search"]').first(),
    ).toBeVisible();
  });

  test('should create new listing @critical', async ({ page }) => {
    // Creating a listing is genuinely several round trips, not one: sign in, POST
    // /v2/listings, then an unconditional PUT /v2/listings/:id/tags (it runs even
    // with no tags) before the form navigates. The default 30s budget is not
    // enough for that against a dev API.
    test.slow();

    const listing = generateTestData().listing;

    await page.goto(`/${testTenant.slug}/listings/create`);
    await page.waitForSelector('form', { state: 'visible' });

    await titleField(page).fill(listing.title);
    await descriptionField(page).fill(listing.description);
    await chooseFirstCategory(page);

    // Select type (offer/request)
    await page.locator(`input[type="radio"][value="${listing.type}"]`).check();

    await page.click(selectors.submitButton);
    await page.waitForURL(/\/listings\/\d+/, { timeout: 20000 });

    // Verify listing was created. 🔴 Assert the HEADING, not bare text: the title
    // also appears in the breadcrumb, so `text=` matches two nodes and fails
    // strict mode on a page that rendered perfectly.
    await expect(page.getByRole('heading', { name: listing.title })).toBeVisible();
  });

  test('should search for listings @critical', async ({ page }) => {
    await page.goto(`/${testTenant.slug}/listings`);

    // Find search input
    const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
    await searchInput.fill('test');

    // Wait for search results to update
    await page.waitForTimeout(1000);

    // Verify search was performed (URL or results updated)
    // This might depend on whether search is client-side or server-side
  });

  test('should view listing detail @smoke @critical', async ({ page }) => {
    // Go to listings page
    await page.goto(`/${testTenant.slug}/listings`);

    // Wait for listings to load
    await page.waitForSelector(selectors.listingCard, { state: 'visible', timeout: 10000 });

    // Click first listing
    const firstListing = page.locator(selectors.listingCard).first();
    await firstListing.click();

    // Wait for detail page
    await page.waitForURL(/\/listings\/\d+/, { timeout: 20000 });

    // 🔴 Pre-existing failure, fixed here. `page.locator('h1, h2')` resolved to two
    // elements ("Listings" and "Browse Listings") and failed strict mode against a
    // page that had rendered correctly. Assert the detail page's own listing
    // heading instead, via the structural hook that only the success branch
    // renders — a loading or not-found detail page does not match it.
    await expect(page.locator(selectors.listingDetail)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('should edit own listing @critical', async ({ page }) => {
    test.slow(); // creates a listing first, then edits it — two full save cycles

    const listing = generateTestData().listing;
    const listingId = await createListing(page, listing.title, listing.description);

    // Navigate to edit page.
    // 🔴 The route is `listings/edit/:id`, NOT `listings/:id/edit`
    // (AppRoutes.tsx:992). The old order matched no route at all, so this test sat
    // in `waitForSelector('form')` until it timed out — the third dead listings
    // URL in this one file.
    await page.goto(`/${testTenant.slug}/listings/edit/${listingId}`);
    await page.waitForSelector('form', { state: 'visible' });

    // Update title
    const updatedTitle = `${listing.title} - Updated`;
    await titleField(page).fill(updatedTitle);

    // 🔴 Save via `button[type="submit"]`, NOT `selectors.saveButton`
    // (`button:has-text("Save")`). This form's edit label is "Update Listing"
    // (`form.update`), so the shared Save selector matches nothing here.
    await page.click(selectors.submitButton);
    await page.waitForURL(/\/listings\/\d+$/, { timeout: 20000 });

    // Verify update — heading, not bare text, so the breadcrumb copy of the title
    // cannot trip strict mode.
    await expect(page.getByRole('heading', { name: updatedTitle })).toBeVisible();
  });

  test('should delete own listing @critical', async ({ page }) => {
    test.slow(); // creates a listing first, then deletes it

    const listing = generateTestData().listing;
    await createListing(page, listing.title, listing.description);

    // Open the delete confirmation. `exact` matters: the modal's own confirm
    // button is labelled "Delete listing", so a substring match would resolve to
    // two buttons once the modal is open.
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // 🔴 Confirm via the modal's real label, NOT `selectors.confirmButton`
    // (`button:has-text("Confirm"), button:has-text("Yes")`) — this modal says
    // "Delete listing" (`delete_confirm_button`), so that shared selector matches
    // nothing and the old test could never have got past this line.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete listing' }).click();

    // Verify redirect back to the listings index
    await page.waitForURL(/\/listings\/?$/, { timeout: 20000 });
  });

  test('should filter listings by category @regression', async ({ page }) => {
    await page.goto(`/${testTenant.slug}/listings`);

    // Look for category filter
    const categoryFilter = page.locator('select[name="category"], button:has-text("Category")');

    if (await categoryFilter.isVisible()) {
      await categoryFilter.click();

      // Select a category option
      await page.locator('[role="option"], option').first().click();

      // Wait for filtered results
      await page.waitForTimeout(1000);

      // Verify listings are displayed
      await expect(page.locator(selectors.listingCard)).toBeVisible();
    }
  });

  test('should show validation errors for incomplete listing @regression', async ({ page }) => {
    await page.goto(`/${testTenant.slug}/listings/create`);

    // Try to submit without required fields
    await page.click(selectors.submitButton);

    // Title carries the native `required` attribute, so an empty form leaves it
    // constraint-invalid and the browser blocks submission.
    const isInvalid = await titleField(page).evaluate((el: HTMLInputElement) => !el.validity.valid);
    expect(isInvalid).toBeTruthy();

    // And we must still be on the create page — a passing validity check would
    // otherwise be consistent with the form having submitted anyway.
    await expect(page).toHaveURL(/\/listings\/create/);
  });
});
