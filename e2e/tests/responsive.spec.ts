// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, devices } from '@playwright/test';
import { loginAsUser } from '../helpers/auth';
import { testUsers, testTenant, selectors } from '../helpers/fixtures';

test.describe('Responsive Design', () => {
  test('should display mobile drawer on mobile viewport @smoke @critical', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize(devices['iPhone 12'].viewport);

    await page.goto(`/${testTenant.slug}`);

    // Look for mobile menu button (hamburger)
    const menuButton = page.locator('button[aria-label*="menu"], button:has-text("Menu"), .mobile-menu-button');
    await expect(menuButton).toBeVisible();

    // Click to open drawer
    await menuButton.click();

    // Verify drawer is visible
    await expect(page.locator(selectors.mobileDrawer)).toBeVisible({ timeout: 3000 });
  });

  test('should navigate using mobile drawer @critical', async ({ page }) => {
    await page.setViewportSize(devices['iPhone 12'].viewport);
    await page.goto(`/${testTenant.slug}`);

    // Open mobile menu
    const menuButton = page.locator('button[aria-label*="menu"], button:has-text("Menu")');
    await menuButton.click();

    // Wait for drawer
    await page.waitForSelector(selectors.mobileDrawer, { state: 'visible' });

    // Click on a navigation link (e.g., About)
    await page.locator(`${selectors.mobileDrawer} a:has-text("About")`).click();

    // Verify navigation occurred
    await expect(page).toHaveURL(/\/about/);
  });

  test('should display forms correctly on mobile @critical', async ({ page }) => {
    await page.setViewportSize(devices['iPhone 12'].viewport);

    // Login as user
    await loginAsUser(page, testUsers.primary.email, testUsers.primary.password, testTenant.slug);

    // Navigate to create listing
    await page.goto(`/${testTenant.slug}/listings/new`);

    // Verify form is visible and usable
    await expect(page.locator('form')).toBeVisible();
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await expect(page.locator('textarea[name="description"]')).toBeVisible();

    // Verify submit button is accessible
    await expect(page.locator(selectors.submitButton)).toBeVisible();
  });

  test('should display cards in grid on mobile @regression', async ({ page }) => {
    await page.setViewportSize(devices['iPhone 12'].viewport);

    await page.goto(`/${testTenant.slug}/listings`);

    // Wait for listings to load
    await page.waitForSelector(selectors.listingCard, { state: 'visible', timeout: 10000 });

    // Verify at least one listing card is visible
    const cardCount = await page.locator(selectors.listingCard).count();
    expect(cardCount).toBeGreaterThan(0);

    // Verify cards are stacked (single column on mobile)
    const firstCard = page.locator(selectors.listingCard).first();
    const cardBox = await firstCard.boundingBox();

    if (cardBox) {
      // Card should take most of viewport width on mobile
      expect(cardBox.width).toBeGreaterThan(300);
    }
  });

  test('should display navbar correctly on tablet @regression', async ({ page }) => {
    await page.setViewportSize(devices['iPad Pro'].viewport);

    await page.goto(`/${testTenant.slug}`);

    // On tablet, navbar should be visible
    await expect(page.locator(selectors.navbar)).toBeVisible();

    // Main navigation links should be visible (not in drawer)
    await expect(page.locator(`${selectors.navbar} ${selectors.dashboardLink}`)).toBeVisible();
  });

  test('should handle orientation change @regression', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/${testTenant.slug}`);

    // Verify mobile menu is visible
    const menuButton = page.locator('button[aria-label*="menu"]');
    await expect(menuButton).toBeVisible();

    // Switch to landscape.
    //
    // 🔴 667×375 is a SMALL-phone landscape and sits BELOW the 768px breakpoint,
    // so it cannot reach the dead band this suite's own landscape bug lived in.
    // It is kept because rotating a small phone is still worth covering, but it
    // must not be mistaken for landscape coverage — that is
    // 'signed-in member keeps primary navigation in phone landscape' below,
    // which tests 844×390 and 932×430 inside the band.
    await page.setViewportSize({ width: 667, height: 375 });

    // Wait for layout to adjust
    await page.waitForTimeout(500);

    // Navigation should still be accessible
    await expect(page.locator(selectors.navbar)).toBeVisible();
  });

  /**
   * 🔴 The landscape navigation blackout, pinned at the widths where it happened.
   *
   * Reported by James Ryan (TBUK) on 2026-07-14: the bottom bar "sometimes
   * overlaps or obscures content ... so when completing a form, the navigation
   * bar can cover the Submit, Continue, or other action button", and it was worse
   * in landscape. He was still carrying it in his 2026-08-10 assessment as
   * NFR-02, "bottom navigation can misalign and cover submit controls".
   *
   * Root cause (fixed in b27d6eedc): the bottom tab bar hid at >=768px while the
   * desktop nav only appears at >=1024px, and the hamburger is guests-only — so a
   * SIGNED-IN member between those widths had no primary navigation at all. A
   * phone in landscape is 844–932px, squarely inside that band.
   *
   * The fix is now "by construction" — `MobileTabBar` uses `lg:hidden` as the
   * exact complement of `Navbar`'s `hidden lg:flex`. This test exists because an
   * argument is not a regression test, and because nothing else in the suite
   * covers these widths: the case above stops at 667px.
   *
   * Must be signed in. The bar does not render for guests, so an anonymous test
   * would pass while proving nothing.
   */
  const PHONE_LANDSCAPE = [
    { label: 'iPhone 14 landscape', width: 844, height: 390 },
    { label: 'iPhone 14 Pro Max landscape', width: 932, height: 430 },
  ];

  for (const { label, width, height } of PHONE_LANDSCAPE) {
    test(`signed-in member keeps primary navigation in phone landscape — ${label} @regression`, async ({ page }) => {
      await page.setViewportSize({ width, height });

      // Authentication comes from the project's `storageState` (the `setup`
      // dependency), not from logging in here. `loginAsUser` waits for a redirect
      // to /dashboard and this app lands on /feed, so calling it would fail on
      // the helper's assumption rather than on anything this test is about.

      // Somewhere with a form and a submit control at the foot of the page.
      await page.goto(`/${testTenant.slug}/listings/create`);
      await page.waitForLoadState('domcontentloaded');

      // 1. Primary navigation must exist. Between 768 and 1023px this is the
      //    tab bar's job: the desktop nav is still hidden and the hamburger is
      //    guests-only. Either the bar or a visible desktop nav is acceptable —
      //    what is NOT acceptable is neither, which is the bug.
      // The bar's accessible name comes from `aria.mobile_navigation`, which is
      // "Mobile navigation" in English. Matched case-insensitively on the word
      // that survives translation least badly, plus the nav role, rather than a
      // guessed test id — MobileTabBar does not carry one.
      const tabBar = page.getByRole('navigation', { name: /mobile/i }).first();
      const desktopNav = page.locator(selectors.navbar).first();

      // 🔴 Auto-waiting assertion, not an instant `isVisible()`. Under Vite dev
      // the SPA has not rendered by `domcontentloaded`, so an instant check
      // reports "no navigation" and manufactures exactly the failure this test
      // is supposed to detect. `.or()` waits for whichever arrives.
      await expect(
        tabBar.or(desktopNav).first(),
        `${label} (${width}×${height}): a signed-in member had NO primary navigation — `
          + 'this is the 768–1023px blackout. Check that MobileTabBar\'s lg:hidden '
          + 'is still the exact complement of Navbar\'s hidden lg:flex.',
      ).toBeVisible({ timeout: 30000 });

      const hasTabBar = await tabBar.isVisible().catch(() => false);

      // 2. The submit control must be reachable and not sitting underneath the
      //    tab bar. That was the actual complaint: navigation covering Submit.
      const submit = page.locator('button[type="submit"]').first();
      if (await submit.count()) {
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeVisible();

        const submitBox = await submit.boundingBox();
        expect(submitBox, 'submit control has no box').not.toBeNull();

        if (submitBox && hasTabBar) {
          const barBox = await tabBar.boundingBox();
          if (barBox) {
            // Overlap on the vertical axis means the bar is over the button.
            const submitBottom = submitBox.y + submitBox.height;
            const overlap = submitBottom > barBox.y && submitBox.y < barBox.y + barBox.height;
            expect(
              overlap,
              `${label}: the bottom navigation overlaps the submit control `
                + `(submit ${Math.round(submitBox.y)}–${Math.round(submitBottom)}, `
                + `bar starts ${Math.round(barBox.y)}). The tab bar's spacer should `
                + 'reserve its own height plus the safe-area inset.',
            ).toBe(false);
          }
        }
      }
    });
  }

  test('should display modals correctly on mobile @regression', async ({ page }) => {
    await page.setViewportSize(devices['iPhone 12'].viewport);

    // Login first
    await loginAsUser(page, testUsers.primary.email, testUsers.primary.password, testTenant.slug);

    // Navigate to a page with modals (e.g., listings)
    await page.goto(`/${testTenant.slug}/listings`);

    // Try to trigger a modal (e.g., delete confirmation)
    const deleteButton = page.locator(selectors.deleteButton).first();

    if (await deleteButton.isVisible({ timeout: 5000 })) {
      await deleteButton.click();

      // Verify modal appears and is usable on mobile
      const modal = page.locator(selectors.modal);
      await expect(modal).toBeVisible({ timeout: 3000 });

      // Verify modal action buttons are visible
      await expect(page.locator(selectors.confirmButton)).toBeVisible();
    }
  });

  test('should render touch-friendly buttons on mobile @smoke', async ({ page }) => {
    await page.setViewportSize(devices['iPhone 12'].viewport);

    await page.goto(`/${testTenant.slug}/listings`);

    // Check that buttons have adequate touch target size (min 44x44px)
    const buttons = page.locator('button, a.button');
    const firstButton = buttons.first();

    if (await firstButton.isVisible({ timeout: 5000 })) {
      const buttonBox = await firstButton.boundingBox();

      if (buttonBox) {
        // Touch target should be at least 44px in height
        expect(buttonBox.height).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
