// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford

const path = require('node:path');
const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.WEB_UK_ACCESSIBILITY_BASE_URL;
if (!baseURL) throw new Error('WEB_UK_ACCESSIBILITY_BASE_URL is required.');
const artifactRoot = path.join(__dirname, 'artifacts', 'group-management-mutation');

module.exports = defineConfig({
  testDir: './tests/runtime',
  testMatch: 'group-management-mutation.spec.js',
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [['list'], ['json', { outputFile: path.join(artifactRoot, 'playwright-report.json') }]],
  use: { baseURL, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
