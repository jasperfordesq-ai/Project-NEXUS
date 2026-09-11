// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { completeTwoFactorIfChallenged } from '../helpers/two-factor';
import {
  DEFAULT_TENANT,
  dismissBlockingModals,
  pinSpaApiToCandidate,
  tenantUrl,
} from '../helpers/test-utils';

const hasAdminCredentials = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
const apiBaseUrl = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:8090';

async function primeBrowserState(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('dev_notice_dismissed', '2.1');
    localStorage.setItem('nexus_cookie_consent', JSON.stringify({
      essential: true,
      analytics: false,
      preferences: true,
      timestamp: new Date().toISOString(),
    }));
  });
}

async function primeAdminAuth(page: Page): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('Missing E2E admin credentials');
  }

  const response = await page.request.post(`${apiBaseUrl}/api/auth/login`, {
    data: { email, password, tenant_slug: DEFAULT_TENANT },
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Tenant-Slug': DEFAULT_TENANT,
    },
  });

  expect(response.ok()).toBeTruthy();

  // An administrator's login hands over a two-factor step since the MFA baseline.
  const loginData = await completeTwoFactorIfChallenged(await response.json(), {
    request: page.request,
    apiBaseUrl,
    tenantSlug: DEFAULT_TENANT,
    email,
  });
  const accessToken = loginData?.data?.access_token || loginData?.access_token;
  const refreshToken = loginData?.data?.refresh_token || loginData?.refresh_token;
  const tenantId = loginData?.data?.tenant_id || loginData?.tenant_id;

  expect(accessToken).toBeTruthy();

  await page.addInitScript(
    ({ accessToken, refreshToken, tenantId }) => {
      localStorage.setItem('nexus_access_token', accessToken);
      if (refreshToken) localStorage.setItem('nexus_refresh_token', refreshToken);
      if (tenantId) localStorage.setItem('nexus_tenant_id', String(tenantId));
    },
    { accessToken, refreshToken, tenantId },
  );
}

async function expectHeroButton(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible({ timeout: 20_000 });
  const className = await locator.getAttribute('class');
  expect(className).toContain('button');
}

test.beforeEach(async ({ page }) => {
  await pinSpaApiToCandidate(page);
  await primeBrowserState(page);
});

test.describe('HeroUI/Tailwind visual polish @smoke', () => {
  test('login keeps polished HeroUI controls and auth utility chrome', async ({ page }) => {
    await page.goto(tenantUrl('login'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expectHeroButton(page.locator('button[type="submit"]').first());
    await expectHeroButton(page.getByRole('button', { name: /current language|select language|english|en/i }).first());

    const sourceLink = page.getByRole('link', { name: /source|repository|project nexus/i }).first();
    await expect(sourceLink).toBeVisible({ timeout: 20_000 });
    await expect(sourceLink).toHaveCSS('border-radius', /[1-9]/);
  });

  test('register keeps polished HeroUI form controls', async ({ page }) => {
    await page.goto(tenantUrl('register'), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    await expect(page.getByRole('heading', { name: /create your account|create account|register|sign up/i }).first())
      .toBeVisible({ timeout: 20_000 });
    await expectHeroButton(page.locator('button[type="submit"]').first());
  });

  test('admin shell keeps an opaque polished header when credentials are available', async ({ page }) => {
    test.skip(!hasAdminCredentials, 'No E2E admin credentials configured');

    await primeAdminAuth(page);
    await page.goto(`/${DEFAULT_TENANT}/admin`, { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);

    const header = page.locator('header').first();
    await expect(header).toBeVisible({ timeout: 30_000 });
    await expect(header).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');

    const pageHeader = page.locator('main .card, main [class*="card"]').first();
    await expect(pageHeader).toBeVisible({ timeout: 30_000 });
  });
});
