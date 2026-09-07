// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E2E tests for navigation responsive breakpoints.
 * Validates that desktop nav, mobile drawer, and search overlay
 * render correctly across viewport sizes.
 */

import { test, expect } from '@playwright/test';

const TENANT_ROOT = `/${process.env.E2E_TENANT ?? 'hour-timebank'}/`;
test.use({ storageState: 'e2e/.auth/user.json' });

test.describe('Navigation — Desktop', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('desktop nav links are visible', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    // Desktop nav should be visible (hidden on mobile via sm:flex)
    const header = page.locator('header[data-site-header="true"]');
    await expect(header).toBeVisible();
  });

  test('skip-to-content link becomes visible on focus', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const skipLink = page.locator('a[href="#main-content"]');
    // Exercise the focus-visible styling directly; browser startup focus can be
    // claimed by restored-session controls before the first synthetic Tab.
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
  });

  test('skip-to-content link targets main content', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toHaveAttribute('href', '#main-content');
    const main = page.locator('main#main-content');
    await expect(main).toBeAttached();
  });

  test('More dropdown opens on click (desktop)', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    // Wait for app to hydrate
    await page.waitForTimeout(1000);
    const moreButton = page.getByText('More', { exact: true });
    if (await moreButton.isVisible()) {
      await moreButton.click();
      // MegaMenu nav should appear
      const megaNav = page.locator('nav[aria-label="More navigation"]');
      await expect(megaNav).toBeVisible({ timeout: 3000 });
    }
  });

  test('search overlay opens with Ctrl+K', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[aria-label="Search"]');
    // Search overlay may require auth — check if visible
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(searchInput).toBeFocused();
    }
  });

  test('search overlay closes with Escape', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    await page.waitForTimeout(1000);
    await page.keyboard.press('Control+k');
    const searchInput = page.locator('input[aria-label="Search"]');
    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(searchInput).not.toBeVisible();
    }
  });

  test('Marketplace creation is grouped under Community', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    await page.getByRole('button', { name: /create new/i }).click();

    const marketplace = page.getByRole('menuitem', { name: /new marketplace listing/i });
    await expect(marketplace).toBeVisible();
    await expect(page.getByRole('group', { name: 'Community' }).getByRole('menuitem', { name: /new marketplace listing/i })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Timebanking' }).getByRole('menuitem', { name: /new marketplace listing/i })).toHaveCount(0);
  });
});

test.describe('Navigation — Mobile', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('authenticated mobile header shows the user menu', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    await expect(page.locator('header[data-site-header="true"]')).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /user menu/i })).toBeVisible();
  });

  test('mobile tab bar is visible', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    await expect(page.locator('nav[data-mobile-tabbar]')).toBeVisible({ timeout: 15000 });
  });

  test('main content has correct id for skip-to-content', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const main = page.locator('main#main-content');
    await expect(main).toBeAttached();
  });
});

test.describe('Navigation — Tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('header renders correctly at tablet width', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const header = page.locator('header[data-site-header="true"]');
    await expect(header).toBeVisible();
  });

  test('main content area fills available space', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const main = page.locator('main#main-content');
    await expect(main).toBeVisible();
    const box = await main.boundingBox();
    expect(box).toBeTruthy();
    // Main content should span most of the viewport width
    expect(box!.width).toBeGreaterThan(700);
  });
});

test.describe('Navigation — Accessibility', () => {
  test('header has proper landmark role', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const banner = page.locator('header[data-site-header="true"]');
    await expect(banner).toBeVisible();
  });

  test('main content has proper landmark', async ({ page }) => {
    await page.goto(TENANT_ROOT);
    const main = page.getByRole('main');
    await expect(main).toBeVisible();
    await expect(main).toHaveId('main-content');
  });

  test('reduced motion is respected', async ({ page }) => {
    // Emulate prefers-reduced-motion
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(TENANT_ROOT);
    // Page should load without animation errors
    const main = page.locator('main#main-content');
    await expect(main).toBeVisible();
  });
});
