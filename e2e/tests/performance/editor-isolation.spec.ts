// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Page } from '@playwright/test';
import { dismissBlockingModals, tenantUrl } from '../../helpers/test-utils';
import { primeApiAuth } from '../../helpers/browser-session';

const EMPTY_STORAGE = { cookies: [], origins: [] };
const EDITOR_ASSET = /\/(?:vendor-(?:grapesjs|codemirror)|PageDesignBuilder|NewsletterBuilder|HtmlSourceEditor)-[^/?]+\.(?:js|css)(?:\?|$)/i;

async function visitWithoutEditorAssets(
  page: Page,
  path: string,
  options: { requireAuthenticatedRoute?: boolean } = {},
): Promise<void> {
  const editorRequests: string[] = [];
  const captureEditorRequest = (request: import('@playwright/test').Request) => {
    if (EDITOR_ASSET.test(request.url())) editorRequests.push(request.url());
  };
  page.on('request', captureEditorRequest);

  try {
    await page.goto(tenantUrl(path), { waitUntil: 'domcontentloaded' });
    await dismissBlockingModals(page);
    if (options.requireAuthenticatedRoute) {
      await expect(page).toHaveURL(new RegExp(`/${path}(?:[/?#]|$)`), { timeout: 15_000 });
      await expect(page.locator('input[type="email"]')).toHaveCount(0);
    }
    await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);

    expect(editorRequests, `${path || 'home'} fetched admin-only editor assets`).toEqual([]);
  } finally {
    page.off('request', captureEditorRequest);
  }
}

test.describe('editor bundle isolation', () => {
  test.describe('anonymous startup', () => {
    test.use({ storageState: EMPTY_STORAGE });

    test('home and login do not fetch GrapesJS or CodeMirror', async ({ page }) => {
      await visitWithoutEditorAssets(page, '');
      await visitWithoutEditorAssets(page, 'login');
    });
  });

  test.describe('ordinary member startup', () => {
    test.use({ storageState: EMPTY_STORAGE });
    test.beforeEach(async ({ page }) => { await primeApiAuth(page, 'user'); });

    test('dashboard and listings do not fetch admin editors', async ({ page }) => {
      await visitWithoutEditorAssets(page, 'dashboard', { requireAuthenticatedRoute: true });
      await visitWithoutEditorAssets(page, 'listings', { requireAuthenticatedRoute: true });
    });
  });
});
