// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';

// Deliberately no shared login setup: these tests intercept every API call.
export default defineConfig({
  testDir: './e2e', testMatch: 'mfa-audit.spec.ts', workers: 1, timeout: 60000,
  reporter: 'list', use: { baseURL: 'http://127.0.0.1:5173', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: { command: 'npm run dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 120000 },
});
