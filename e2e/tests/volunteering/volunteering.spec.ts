// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Page } from '@playwright/test';
import { tenantUrl, dismissBlockingModals } from '../../helpers/test-utils';

const opportunity = {
  id: 9001,
  title: 'Community Garden Steward',
  description: 'Help neighbours maintain the shared garden and welcome new volunteers.',
  location: 'Community Hub',
  is_remote: false,
  start_date: '2026-06-01',
  end_date: '2026-06-30',
  has_applied: false,
  organization: { id: 77, name: 'Green Streets', logo_url: null },
  category: { id: 2, name: 'Environment' },
  skills_needed: 'Gardening, welcoming',
};

const approvedApplication = {
  id: 5001,
  status: 'approved',
  created_at: '2026-05-01T10:00:00Z',
  opportunity: {
    id: opportunity.id,
    title: opportunity.title,
  },
  organization: opportunity.organization,
  org_note: 'Bring comfortable shoes.',
};

async function mockVolunteeringApi(page: Page): Promise<void> {
  await page.route('**/api/v2/volunteering/my-organisations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [
            {
              id: 77,
              name: 'Green Streets',
              status: 'active',
              member_role: 'owner',
              balance: 12,
            },
          ],
        },
      }),
    });
  });

  await page.route('**/api/v2/volunteering/opportunities**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [opportunity],
        meta: { has_more: false, cursor: null },
      }),
    });
  });

  await page.route('**/api/v2/volunteering/applications**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [approvedApplication],
        meta: { has_more: false, cursor: null },
      }),
    });
  });

  await page.route('**/api/v2/volunteering/hours/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          verified_hours: 8,
          pending_hours: 2,
          total_hours: 10,
          goal_hours: 20,
          by_organization: [{ organization_name: 'Green Streets', hours: 8 }],
          by_month: [{ month: '2026-05', hours: 8 }],
        },
      }),
    });
  });
}

test.describe('Volunteering module', () => {
  test.beforeEach(async ({ page }) => {
    await mockVolunteeringApi(page);
  });

  test('renders opportunities with real controls and mocked data', async ({ page }) => {
    await page.goto(tenantUrl('volunteering'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expect(page.getByRole('heading', { level: 1, name: /make a difference/i })).toBeVisible();
    await expect(page.getByPlaceholder(/search opportunities/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /explore opportunities/i })).toBeVisible();
    await expect(page.getByRole('link', { name: opportunity.title })).toBeVisible();
    await expect(page.getByText('Green Streets')).toBeVisible();
    await expect(page.getByRole('button', { name: /view details/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^apply$/i })).toBeVisible();
  });

  test('opens the applications section from the current URL', async ({ page }) => {
    await page.goto(tenantUrl('volunteering?tab=applications'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expect(page.getByRole('heading', { level: 1, name: /my applications/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /volunteering home/i })).toBeVisible();
    await expect(page.getByText(opportunity.title)).toBeVisible();
    await expect(page.getByText(/approved/i)).toBeVisible();
    await expect(page.getByText(/organiser's note/i)).toBeVisible();
  });

  test('keeps the volunteering page usable on mobile without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(tenantUrl('volunteering'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expect(page.getByRole('link', { name: opportunity.title })).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
  });

  test('uses the current volunteering API endpoint, not the stale legacy path', async ({ page }) => {
    const requestedUrls: string[] = [];
    await page.route('**/api/v2/volunteering/opportunities**', async (route) => {
      requestedUrls.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [opportunity],
          meta: { has_more: false, cursor: null },
        }),
      });
    });

    await page.goto(tenantUrl('volunteering'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expect(page.getByRole('link', { name: opportunity.title })).toBeVisible();
    expect(requestedUrls.some((url) => url.includes('/api/v2/volunteering/opportunities'))).toBe(true);
    expect(requestedUrls.every((url) => !url.includes('/api/volunteering'))).toBe(true);
  });
});
