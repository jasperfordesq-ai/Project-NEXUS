// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('node:path');

const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.WEB_UK_ACCESSIBILITY_BASE_URL;

if (!baseURL) {
  throw new Error('WEB_UK_ACCESSIBILITY_BASE_URL is required. Run npm run smoke:laravel:saved-collections.');
}

const artifactRoot = path.join(__dirname, 'artifacts', 'saved-collections-mutation');

module.exports = defineConfig({
  testDir: './tests/runtime',
  testMatch: 'saved-collections-mutation.spec.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 10_000 },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactRoot, 'playwright-report.json') }]
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
