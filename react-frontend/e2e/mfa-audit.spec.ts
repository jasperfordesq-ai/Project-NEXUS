// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';

test('password login reaches required enrollment and retains recovery codes until acknowledgment', async ({ page }) => {
  let verified = false;
  const protectedRequests: string[] = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) {
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort();
      return route.continue();
    }
    const path = url.pathname.replace(/^\/api/, '');
    if (route.request().headers().authorization) protectedRequests.push(path);
    const respond = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === '/v2/tenant/bootstrap') return respond({ success: true, data: {
      id: 2, slug: 'hour-timebank', name: 'Audit community', branding: { name: 'Audit community' },
      features: { two_factor_authentication: false }, modules: {},
      authentication_config: {}, registration: {},
    } });
    if (path === '/auth/login') return respond({ success: false, requires_2fa_setup: true, two_factor_token: 'restricted-challenge' });
    if (path === '/v2/auth/2fa/setup') {
      expect(route.request().headers().authorization).toBeUndefined();
      expect(route.request().postDataJSON().two_factor_token).toBe('restricted-challenge');
      return respond({ success: true, data: { secret: 'AUDIT-MANUAL-KEY', qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    }
    if (path === '/v2/auth/2fa/verify') {
      expect(route.request().headers().authorization).toBeUndefined();
      verified = true;
      return respond({ success: true, data: { login_complete: true, backup_codes: ['AUDIT-1234', 'AUDIT-5678'],
        access_token: 'test-access-token', refresh_token: 'test-refresh-token', expires_in: 900 } });
    }
    if (path.includes('/auth/oauth/providers')) return respond({ success: true, providers: [] });
    return respond({ success: true, data: [] });
  });
  await page.goto('/hour-timebank/login');
  await page.locator('input[type="email"]').fill('audit@example.test');
  await page.locator('input[autocomplete="current-password"]').fill('test-password');
  await page.locator('form').filter({ has: page.locator('input[type="email"]') }).locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/auth\/two-factor\/setup$/);
  await expect(page.getByText('AUDIT-MANUAL-KEY')).toBeVisible();
  await page.getByLabel('Six-digit verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await expect(page.getByText('AUDIT-1234')).toBeVisible();
  expect(verified).toBe(true);
  expect(protectedRequests).toEqual([]);
  await expect(page.getByRole('button', { name: 'I have saved my recovery codes' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
