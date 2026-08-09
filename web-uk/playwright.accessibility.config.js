// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('node:path');

const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.WEB_UK_ACCESSIBILITY_BASE_URL;

if (!baseURL) {
  throw new Error(
    'WEB_UK_ACCESSIBILITY_BASE_URL is required. Run `npm run test:accessibility` so the gate uses a fresh current-checkout server.'
  );
}

const artifactRoot = path.join(__dirname, 'artifacts', 'accessibility');

module.exports = defineConfig({
  testDir: './tests/accessibility',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactRoot, 'playwright-report.json') }],
    ['html', { outputFolder: path.join(artifactRoot, 'html-report'), open: 'never' }]
  ],
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});
