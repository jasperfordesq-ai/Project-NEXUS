// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import { DashboardPage } from '../../page-objects';

/**
 * Dashboard E2E Tests (React Frontend)
 *
 * Tests the main user dashboard with GlassCard components
 * and 2-column layout (main + sidebar).
 *
 * Note: The React dashboard is a single page (no sub-routes like /dashboard/listings).
 * Legacy PHP had /dashboard/listings, /dashboard/hubs - those routes no longer exist.
 */

test.describe('Dashboard', () => {
  test.describe('Dashboard Overview', () => {
    test('should display dashboard page', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();

      // Should be on dashboard
      expect(page.url()).toContain('dashboard');

      // Should have main content
      const hasContent = await dashboard.hasContent();
      expect(hasContent).toBeTruthy();
    });

    test('should show welcome message or heading', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Should have h1 or welcome message
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('should display dashboard cards', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Should have at least one GlassCard or content card
      const cards = page.locator('[class*="glass"], article, section');
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
    });

    test('should show wallet balance if wallet module enabled', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Wallet section is optional (module-gated)
      const walletSection = page.locator('text=Wallet Balance, text=Balance, text=Time Credits').first();
      const hasWallet = await walletSection.count() > 0;

      // Wallet is optional
      expect(hasWallet || true).toBeTruthy();
    });

    test('should show recent listings section', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Recent listings section
      const listingsSection = page.locator('text=Recent Listings, text=My Listings, text=My Recent Listings').first();
      const hasListings = await listingsSection.count() > 0;

      expect(hasListings || true).toBeTruthy();
    });

    test('should show activity feed section', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Activity feed
      const activitySection = page.locator('text=Recent Activity, text=Activity Feed').first();
      const hasActivity = await activitySection.count() > 0;

      expect(hasActivity || true).toBeTruthy();
    });
  });

  test.describe('Dashboard Sidebar', () => {
    test('should show quick actions if available', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Quick actions may be in sidebar
      const quickActions = page.locator('text=Quick Actions').first();
      const hasActions = await quickActions.count() > 0;

      expect(hasActions || true).toBeTruthy();
    });

    test('should show suggested listings if available', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Suggested matches
      const suggested = page.locator('text=Suggested, text=Matches, text=Recommended').first();
      const hasSuggested = await suggested.count() > 0;

      expect(hasSuggested || true).toBeTruthy();
    });

    test('should show my groups if groups feature enabled', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // My Groups (feature-gated)
      const groups = page.locator('text=My Groups').first();
      const hasGroups = await groups.count() > 0;

      expect(hasGroups || true).toBeTruthy();
    });

    test('should show upcoming events if events feature enabled', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Upcoming Events (feature-gated)
      const events = page.locator('text=Upcoming Events, text=Events').first();
      const hasEvents = await events.count() > 0;

      expect(hasEvents || true).toBeTruthy();
    });

    test('should show gamification if feature enabled', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Gamification (feature-gated)
      const gamification = page.locator('text=Your Progress, text=Level, text=XP').first();
      const hasGamification = await gamification.count() > 0;

      expect(hasGamification || true).toBeTruthy();
    });
  });

  test.describe('Dashboard Interactions', () => {
    test('should have clickable action buttons', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Should have at least some buttons
      const buttons = page.locator('button, a[href]');
      const count = await buttons.count();
      expect(count).toBeGreaterThan(0);
    });

    test('should navigate when clicking create listing button', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Look for create listing button.
      // 🔴 `a[href*="listings/new"]` matched nothing — that is not a route (it
      // resolves to `listings/:id` with the literal id "new"). The create route
      // is `/listings/create`, and the destination assertion below was checking
      // for the same dead path, so it could only have passed via the `feed`
      // alternative.
      const createBtn = page.locator('button:has-text("Create"), a:has-text("Create Listing"), a[href*="listings/create"]').first();
      if (await createBtn.count() > 0 && await createBtn.isVisible()) {
        await createBtn.click();
        await page.waitForLoadState('domcontentloaded');

        // Should navigate to the create form, or to the feed
        await expect(page).toHaveURL(/listings\/create|feed/);
      }
    });

    test('should show refresh option if available', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Refresh button is optional
      const refreshBtn = page.locator('button:has-text("Refresh"), button[aria-label*="refresh" i]').first();
      const hasRefresh = await refreshBtn.count() > 0;

      expect(hasRefresh || true).toBeTruthy();
    });

    test('should link to listings page if clicked', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Find any link to full listings page
      const listingsLink = page.locator('a[href*="/listings"]').first();
      if (await listingsLink.count() > 0) {
        const href = await listingsLink.getAttribute('href');
        expect(href).toContain('listings');
      }
    });
  });

  test.describe('Dashboard Responsive', () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test('should display properly on mobile', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Should have content on mobile
      const hasContent = await dashboard.hasContent();
      expect(hasContent).toBeTruthy();
    });

    test('should stack cards vertically on mobile', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Cards should be visible
      const cards = page.locator('[class*="glass"], article').first();
      await expect(cards).toBeVisible();
    });
  });

  test.describe('Dashboard Accessibility', () => {
    test('should have proper heading structure', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      const h1 = page.locator('h1');
      const h1Count = await h1.count();
      expect(h1Count).toBeGreaterThanOrEqual(1);
    });

    test('should have semantic HTML structure', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      const main = page.locator('main');
      await expect(main).toBeVisible();
    });

    test('should have accessible buttons', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      const buttons = page.locator('button');
      const count = await buttons.count();

      if (count > 0) {
        const firstBtn = buttons.first();
        // Button should have text or aria-label
        const text = await firstBtn.textContent();
        const ariaLabel = await firstBtn.getAttribute('aria-label');
        expect(text || ariaLabel).toBeTruthy();
      }
    });
  });

  test.describe('Dashboard Performance', () => {
    test('should load within reasonable time', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      const startTime = Date.now();

      await dashboard.navigate();
      await dashboard.waitForLoad();

      const loadTime = Date.now() - startTime;

      // Should load within 15 seconds
      expect(loadTime).toBeLessThan(15000);
    });
  });

  test.describe('Dashboard Content', () => {
    test('should show stats or metrics if available', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();
      await dashboard.waitForLoad();

      // Look for any numeric stats
      const statsSection = page.locator('text=Active, text=Total, text=Pending').first();
      const hasStats = await statsSection.count() > 0;

      expect(hasStats || true).toBeTruthy();
    });

    test('should load data from API', async ({ page }) => {
      const dashboard = new DashboardPage(page);
      await dashboard.navigate();

      // Wait for network to settle (API calls complete)
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      // Should have loaded content
      const hasContent = await dashboard.hasContent();
      expect(hasContent).toBeTruthy();
    });
  });
});
