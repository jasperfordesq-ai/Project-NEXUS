// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the app-shell accessibility scan, which runs against a STATIC
 * `dist` build with no API behind it. Deliberately separate from
 * playwright.config.ts so it inherits none of that config's auth setup,
 * storageState or projects — there is no backend here to authenticate against.
 *
 * See e2e/tests/app-shell-a11y.spec.ts for why this scope is what it is.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/app-shell-a11y.spec.ts',
  timeout: 60_000,
  reporter: [['list']],
  // A shell scan must never be retried into passing.
  retries: 0,
  use: {
    baseURL: process.env.E2E_SHELL_BASE_URL || 'http://localhost:3000',
    ignoreHTTPSErrors: true,
  },
  projects: [{ name: 'chromium-shell', use: { ...devices['Desktop Chrome'] } }],
});
