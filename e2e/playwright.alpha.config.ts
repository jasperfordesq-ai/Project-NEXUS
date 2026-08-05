// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';

/**
 * 🔴 The `alpha-setup` dependency is load-bearing, not a convenience.
 *
 * Six of the scanned paths are behind authentication. Without a real session
 * they answer 302 to the login page, Playwright follows it, and every
 * structural assertion in the spec is satisfied by the login page — so the
 * scan passed while never looking at a member page. The setup project makes a
 * failed login fail the whole run instead.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_ALPHA_BASE_URL || 'http://127.0.0.1:8090',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'alpha-setup',
      testMatch: /accessible-frontend-a11y\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-alpha',
      testMatch: '**/accessible-frontend-a11y.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['alpha-setup'],
    },
  ],
});
