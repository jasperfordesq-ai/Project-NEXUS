// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import {
  tenantUrl,
  goToTenantPage,
  dismissBlockingModals,
  DEFAULT_TENANT,
} from '../helpers/test-utils';

/**
 * Federation Cross-Tenant Flow E2E Tests
 *
 * Tests the federation feature which enables cross-community interaction.
 * These tests verify the full user journey through federation pages:
 * hub, partner list, directory, federated listings, and federated events.
 *
 * Marked with test.skip since they require a running app with the federation
 * feature enabled and partner communities configured.
 *
 * Run with: npx playwright test federation-flow
 */

test.describe('Federation Cross-Tenant Flow', () => {
  // ---------------------------------------------------------------------------
  // 1. Navigate to Federation Hub Page
  // ---------------------------------------------------------------------------

  test.describe('Federation Hub Navigation', () => {
    test.skip('should navigate to federation hub from main navigation', async ({ page }) => {
      // Navigate to dashboard first
      await goToTenantPage(page, 'dashboard');

      // Look for federation link in main nav, dropdown, or sidebar
      const fedLink = page.locator(
        'a[href*="federation"], a:has-text("Federation"), a:has-text("Partners")'
      ).first();
      await expect(fedLink).toBeVisible({ timeout: 10000 });
      await fedLink.click();

      // Should arrive at the federation hub
      await page.waitForLoadState('domcontentloaded');
      expect(page.url()).toContain('federation');
    });

    test.skip('should load federation hub page with hero section', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      // The hub page should display a hero or header section
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible({ timeout: 10000 });

      // Should contain federation-related text
      const pageText = await page.locator('main, [role="main"]').first().textContent();
      expect(pageText).toBeTruthy();
    });

    test.skip('should display federation feature tabs or navigation', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      // Federation hub should have navigation to sub-sections
      // (partners, directory, listings, events, etc.)
      const hasTabNav = await page.locator('[role="tablist"]').isVisible({ timeout: 5000 }).catch(() => false);
      const hasSubNav = await page.locator('a[href*="federation/"]').first().isVisible({ timeout: 5000 }).catch(() => false);
      const hasButtonGroup = await page.locator('button:has-text("Partners"), button:has-text("Directory")').first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasTabNav || hasSubNav || hasButtonGroup).toBeTruthy();
    });

    test.skip('should show federation status indicator', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      // Should indicate whether federation is active/enabled
      const statusIndicator = page.locator(
        '[data-federation-status], .federation-status, text=Active, text=Enabled, text=Connected'
      ).first();
      const hasStatus = await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false);

      // Might show opt-in prompt instead if not yet enabled
      const hasOptIn = await page.locator('text=opt-in, text=Enable Federation, text=Join').first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasStatus || hasOptIn).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. View Partner Community List
  // ---------------------------------------------------------------------------

  test.describe('Partner Community List', () => {
    test.skip('should display partner communities on federation hub', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      // Look for partner community cards, grid, or list
      const partnerCards = page.locator(
        '.partner-card, .community-card, [data-partner], article'
      );
      const hasPartners = await partnerCards.first().isVisible({ timeout: 10000 }).catch(() => false);

      // If no partners, should show empty state
      const hasEmptyState = await page.locator(
        'text=No partners, text=No communities, text=Join the federation'
      ).first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasPartners || hasEmptyState).toBeTruthy();
    });

    test.skip('should show partner community details (name, member count, status)', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      // Each partner card should show basic info
      const firstPartner = page.locator(
        '.partner-card, .community-card, [data-partner]'
      ).first();

      if (await firstPartner.isVisible({ timeout: 5000 }).catch(() => false)) {
        // A partner card must carry a name. Waiting assertion rather than an
        // instantaneous snapshot: `isVisible()` ignores its timeout, so the old form
        // raced the render and reported "no name" for a card that simply had not
        // painted yet.
        await expect(
          firstPartner.locator('h3, h4, .partner-name, .community-name').first()
        ).toBeVisible({ timeout: 10000 });

        // Member count / status is genuinely optional, so there is nothing to
        // assert. The previous `expect(hasStats || true).toBeTruthy()` passed
        // whatever happened — it read as coverage while checking nothing.
      }
    });

    test.skip('should allow clicking a partner community for details', async ({ page }) => {
      await goToTenantPage(page, 'federation');

      const firstPartner = page.locator(
        '.partner-card a, .community-card a, [data-partner] a, a[href*="federation/partner"]'
      ).first();

      if (await firstPartner.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstPartner.click();
        await page.waitForLoadState('domcontentloaded');

        // Should navigate to a partner detail or community profile page
        const hasDetailContent = await page.locator('main, [role="main"]').first().isVisible({ timeout: 10000 }).catch(() => false);
        expect(hasDetailContent).toBeTruthy();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. View Federation Directory
  // ---------------------------------------------------------------------------

  test.describe('Federation Directory', () => {
    test.skip('should navigate to federation directory page', async ({ page }) => {
      await goToTenantPage(page, 'federation/members');

      // Directory page should have heading
      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test.skip('should display search/filter controls in the directory', async ({ page }) => {
      await goToTenantPage(page, 'federation/members');

      // Directory should have search and/or filter controls
      const hasSearch = await page.locator(
        'input[type="search"], input[placeholder*="Search" i], input[name="q"]'
      ).first().isVisible({ timeout: 5000 }).catch(() => false);

      const hasFilter = await page.locator(
        'select, button[role="combobox"], [data-filter]'
      ).first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasSearch || hasFilter).toBeTruthy();
    });

    test.skip('should display member cards from partner communities', async ({ page }) => {
      await goToTenantPage(page, 'federation/members');

      // Member cards should be visible (or empty state)
      const memberCards = page.locator(
        '.member-card, .glass-member-card, article, [data-member]'
      );
      const hasMembers = await memberCards.first().isVisible({ timeout: 10000 }).catch(() => false);

      const hasEmptyState = await page.locator(
        'text=No members, text=No results, .empty-state'
      ).first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasMembers || hasEmptyState).toBeTruthy();
    });

    test.skip('should show community provenance badge on federated members', async ({ page }) => {
      await goToTenantPage(page, 'federation/members');

      // Federated member cards should show which community they belong to
      const firstMember = page.locator(
        '.member-card, .glass-member-card, article, [data-member]'
      ).first();

      if (await firstMember.isVisible({ timeout: 5000 }).catch(() => false)) {
        // 🔴 A provenance badge is the whole point of this test: it is how a member
        // can tell which community someone belongs to. The old
        // `expect(hasBadge || true).toBeTruthy()` passed whether the badge was there
        // or not, so the test's own subject was never actually checked.
        await expect(
          firstMember.locator(
            '.community-badge, .provenance-badge, .federation-badge, [data-community]'
          ).first()
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('should filter directory by partner community', async ({ page }) => {
      await goToTenantPage(page, 'federation/members');

      // Find community filter dropdown or selector
      const communityFilter = page.locator(
        'select[name*="community"], button[role="combobox"][aria-label*="community" i], [data-community-filter]'
      ).first();

      if (await communityFilter.isVisible({ timeout: 5000 }).catch(() => false)) {
        await communityFilter.click();

        // Should have at least one community option
        const options = page.locator('[role="option"], option');
        const optionCount = await options.count();
        expect(optionCount).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Browse Federated Listings from Partner Community
  // ---------------------------------------------------------------------------

  test.describe('Federated Listings', () => {
    test.skip('should navigate to federated listings page', async ({ page }) => {
      await goToTenantPage(page, 'federation/listings');

      // Should load the federated listings page
      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible({ timeout: 10000 });
      expect(page.url()).toContain('federation/listings');
    });

    test.skip('should display listing cards from partner communities', async ({ page }) => {
      await goToTenantPage(page, 'federation/listings');

      // Listing cards or empty state
      const listingCards = page.locator(
        '.listing-card, .glass-listing-card, article, [data-listing]'
      );
      const hasListings = await listingCards.first().isVisible({ timeout: 10000 }).catch(() => false);

      const hasEmptyState = await page.locator(
        'text=No listings, text=No federated listings, .empty-state'
      ).first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasListings || hasEmptyState).toBeTruthy();
    });

    test.skip('should have offer/request type filter for federated listings', async ({ page }) => {
      await goToTenantPage(page, 'federation/listings');

      // Type filter (offer vs request)
      const hasTypeFilter = await page.locator(
        'button:has-text("Offers"), button:has-text("Requests"), select[name="type"], [data-type-filter]'
      ).first().isVisible({ timeout: 5000 }).catch(() => false);

      const hasTabFilter = await page.locator(
        '[role="tablist"], .filter-tabs, .smart-buttons'
      ).isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasTypeFilter || hasTabFilter).toBeTruthy();
    });

    test.skip('should show origin community on federated listing cards', async ({ page }) => {
      await goToTenantPage(page, 'federation/listings');

      const firstListing = page.locator(
        '.listing-card, .glass-listing-card, article, [data-listing]'
      ).first();

      if (await firstListing.isVisible({ timeout: 5000 }).catch(() => false)) {
        // 🔴 The source community IS the subject of this test — a member needs to know
        // which community an offer comes from before responding to it. The previous
        // `|| true` meant that was never verified.
        await expect(
          firstListing.locator(
            '.community-badge, .origin-badge, [data-community], text=from'
          ).first()
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('should navigate to listing detail from federated listings', async ({ page }) => {
      await goToTenantPage(page, 'federation/listings');

      const firstListingLink = page.locator(
        '.listing-card a, .glass-listing-card a, article a, [data-listing] a'
      ).first();

      if (await firstListingLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstListingLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should navigate to a listing detail page
        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 5. View Federated Events
  // ---------------------------------------------------------------------------

  test.describe('Federated Events', () => {
    test.skip('should navigate to federated events page', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      // Should load the federated events page
      const heading = page.locator('h1').first();
      await expect(heading).toBeVisible({ timeout: 10000 });
      expect(page.url()).toContain('federation/events');
    });

    test.skip('should display event cards from partner communities', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      // Event cards or empty state
      const eventCards = page.locator(
        '.event-card, article, [data-event], [class*="card"]'
      );
      const hasEvents = await eventCards.first().isVisible({ timeout: 10000 }).catch(() => false);

      const hasEmptyState = await page.locator(
        'text=No events, text=No federated events, .empty-state'
      ).first().isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasEvents || hasEmptyState).toBeTruthy();
    });

    test.skip('should show event details (date, location, community)', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      const firstEvent = page.locator(
        '.event-card, article, [data-event]'
      ).first();

      if (await firstEvent.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Should show date information
        const hasDate = await firstEvent.locator(
          'time, [data-date], text=/\\d{1,2}.*\\d{4}/, text=/Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/'
        ).first().isVisible().catch(() => false);

        // Should show event title
        const hasTitle = await firstEvent.locator(
          'h3, h4, .event-title, [data-title]'
        ).isVisible().catch(() => false);

        expect(hasDate || hasTitle).toBeTruthy();
      }
    });

    test.skip('should show origin community badge on federated events', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      const firstEvent = page.locator(
        '.event-card, article, [data-event]'
      ).first();

      if (await firstEvent.isVisible({ timeout: 5000 }).catch(() => false)) {
        // Same as the listings case above: the origin community is what this test is
        // named for, so it is asserted rather than merely computed.
        await expect(
          firstEvent.locator('.community-badge, .origin-badge, [data-community]').first()
        ).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('should navigate to event detail from federated events list', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      const firstEventLink = page.locator(
        '.event-card a, article a, [data-event] a'
      ).first();

      if (await firstEventLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstEventLink.click();
        await page.waitForLoadState('domcontentloaded');

        // Should navigate to event detail page
        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
      }
    });

    test.skip('should support filtering federated events by date or community', async ({ page }) => {
      await goToTenantPage(page, 'federation/events');

      // 🔴 EITHER filter is acceptable, so `.or()` — which genuinely waits for
      // whichever appears first. The old form took two instantaneous snapshots and
      // then `expect(a || b || true)`, which passed even when neither existed, so a
      // test named "should support filtering" asserted nothing about filtering.
      const dateFilter = page.locator(
        'input[type="date"], [data-date-filter], button:has-text("Date")'
      ).first();
      const communityFilter = page.locator(
        'select[name*="community"], button[role="combobox"], [data-community-filter]'
      ).first();

      await expect(dateFilter.or(communityFilter).first()).toBeVisible({ timeout: 10000 });
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Cross-Tenant API Smoke Tests
  // ---------------------------------------------------------------------------

  test.describe('Federation API Endpoints', () => {
    const apiBaseUrl = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:8090';

    test.skip('should return federation status from API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/federation/status`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      // Should respond (may need auth)
      expect([200, 401, 403]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        const data = body?.data || body;
        expect(data).toBeTruthy();
      }
    });

    test.skip('should return partner list from API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/federation/partners`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect([200, 401, 403]).toContain(response.status());

      if (response.status() === 200) {
        const body = await response.json();
        const data = body?.data || body;
        expect(Array.isArray(data) || typeof data === 'object').toBeTruthy();
      }
    });

    test.skip('should return federated directory from API', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/federation/directory`, {
        headers: {
          'X-Tenant-ID': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect([200, 401, 403]).toContain(response.status());
    });
  });
});
