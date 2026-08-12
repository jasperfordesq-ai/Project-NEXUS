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
 * 🔴 UNRESOLVED — this is why the three write tests below are `fixme`.
 * The control is a HeroUI Autocomplete and neither of the two obvious ways of
 * driving it works from Playwright:
 *   - Clicking the option leaves the trigger showing its placeholder with the
 *     popover still `[expanded]`, i.e. nothing was selected.
 *   - Focusing the trigger and pressing ArrowDown + Enter does the same.
 * Because the popover stays open, React Aria's click-blocking underlay remains,
 * and the next action fails with "<body> intercepts pointer events" — which
 * looks like a broken submit button and is not.
 *
 * `react-frontend/src/pages/listings/CreateListingPage.test.tsx:207` records the
 * same conclusion for jsdom ("the real Autocomplete can't be driven"), and works
 * around it by turning the category requirement off in the tenant mock. An E2E
 * test cannot do that — it drives the real tenant.
 *
 * Do NOT "fix" these by deleting the category step: submission genuinely
 * requires it, so a test that skips it is asserting against a form that was
 * never submittable.
 */
async function chooseFirstCategory(page: Page): Promise<void> {
  await page.getByRole('group').filter({ hasText: 'Select a category' }).click();

  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(listbox).toBeHidden();
}

test.describe('Listings Marketplace', () => {
  test.beforeEach(async ({ page }) => {
    // Login before each test
    await loginAsUser(page, testUsers.primary.email, testUsers.primary.password, testTenant.slug);
  });

  test('should display listings page @smoke @critical', async ({ page }) => {
    await page.goto(`/${testTenant.slug}/listings`);

    // Verify listings page elements
    await expect(page.locator('h1, h2').filter({ hasText: /listings|marketplace/i })).toBeVisible();

    // Search box should be visible
    await expect(page.locator('input[type="search"], input[placeholder*="Search"]')).toBeVisible();
  });

  // 🔴 fixme, not skip: the URL and field selectors below are REPAIRED and correct
  // (this used to post to /listings/new with `input[name="title"]`). What blocks it is
  // category selection — see chooseFirstCategory above. Unskip when that is solved.
  test.fixme('should create new listing @critical', async ({ page }) => {
    const listing = generateTestData().listing;

    // Navigate to create listing page
    await page.goto(`/${testTenant.slug}/listings/create`);

    // Wait for form to load
    await page.waitForSelector('form', { state: 'visible' });

    // Fill in listing details
    await titleField(page).fill(listing.title);
    await descriptionField(page).fill(listing.description);

    // Category is required. 🔴 Do not select by `listing.category` — the fixture
    // says "Skills & Trades", which is not one of this platform's categories
    // (Community, Creative Arts, Education and Tutoring, …), so selecting by
    // that label matches nothing. The first option keeps this tenant-agnostic.
    await chooseFirstCategory(page);

    // Select type (offer/request)
    await page.locator(`input[type="radio"][value="${listing.type}"]`).check();

    // Submit form
    await page.click(selectors.submitButton);

    // Wait for redirect or success message
    await page.waitForURL(/\/listings\/\d+/, { timeout: 10000 });

    // Verify listing was created
    await expect(page.locator(`text=${listing.title}`)).toBeVisible();
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
    await page.waitForURL(/\/listings\/\d+/, { timeout: 5000 });

    // Verify detail page elements
    await expect(page.locator('h1, h2')).toBeVisible();
    await expect(page.locator('text=/description|details/i')).toBeVisible();
  });

  // 🔴 fixme, not skip: the URL and field selectors below are REPAIRED and correct
  // (this used to post to /listings/new with `input[name="title"]`). What blocks it is
  // category selection — see chooseFirstCategory above. Unskip when that is solved.
  test.fixme('should edit own listing @critical', async ({ page }) => {
    // Create a listing first
    const listing = generateTestData().listing;
    await page.goto(`/${testTenant.slug}/listings/create`);
    await titleField(page).fill(listing.title);
    await descriptionField(page).fill(listing.description);
    await chooseFirstCategory(page);
    await page.click(selectors.submitButton);
    await page.waitForURL(/\/listings\/\d+/);

    // Get listing ID from URL
    const url = page.url();
    const listingId = url.match(/\/listings\/(\d+)/)?.[1];

    // Navigate to edit page
    await page.goto(`/${testTenant.slug}/listings/${listingId}/edit`);

    // Update title
    const updatedTitle = `${listing.title} - Updated`;
    await titleField(page).fill(updatedTitle);

    // Save changes
    await page.click(selectors.saveButton);

    // Verify update
    await expect(page.locator(`text=${updatedTitle}`)).toBeVisible({ timeout: 5000 });
  });

  // 🔴 fixme, not skip: the URL and field selectors below are REPAIRED and correct
  // (this used to post to /listings/new with `input[name="title"]`). What blocks it is
  // category selection — see chooseFirstCategory above. Unskip when that is solved.
  test.fixme('should delete own listing @critical', async ({ page }) => {
    // Create a listing first
    const listing = generateTestData().listing;
    await page.goto(`/${testTenant.slug}/listings/create`);
    await titleField(page).fill(listing.title);
    await descriptionField(page).fill(listing.description);
    await chooseFirstCategory(page);
    await page.click(selectors.submitButton);
    await page.waitForURL(/\/listings\/\d+/);

    // Click delete button
    await page.click(selectors.deleteButton);

    // Confirm deletion in modal
    const confirmButton = page.locator(selectors.confirmButton);
    await confirmButton.click();

    // Verify redirect to listings page
    await page.waitForURL(/\/listings\/?$/, { timeout: 5000 });
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
