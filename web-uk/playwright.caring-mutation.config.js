// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('node:path');

const { defineConfig, devices } = require('@playwright/test');

/**
 * The Caring Community caregiver-consent journey, walked in a real browser
 * against a running accessible frontend and a DISPOSABLE Laravel.
 *
 * 🔴 This journey WRITES caregiver relationships, consent evidence and
 * safeguarding decisions. It must only ever run against the disposable stack
 * built by `bash scripts/webuk-e2e-env.sh up` (Laravel :8091, database
 * `nexus_webuk_e2e`, synthetic accounts only) — never the shared local `nexus`
 * database, which is a production-derived snapshot of real members.
 *
 * `WEB_UK_BASE_URL` is required rather than defaulted, so a mistyped or absent
 * environment fails loudly instead of quietly pointing at whatever happens to be
 * on the default port.
 */
const baseURL = process.env.WEB_UK_BASE_URL;

if (!baseURL) {
  throw new Error(
    'WEB_UK_BASE_URL is required (e.g. http://127.0.0.1:5181, the disposable web-uk). '
      + 'Run: bash scripts/webuk-e2e-env.sh up && bash scripts/caring-e2e-provision.sh'
  );
}

const artifactRoot = path.join(__dirname, 'artifacts', 'caring-mutation');

module.exports = defineConfig({
  testDir: './tests/runtime',
  testMatch: 'caring-mutation.spec.js',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // A consent journey must never be retried into passing.
  retries: 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactRoot, 'playwright-report.json') }]
  ],
  use: {
    baseURL,
    // Evidence, not decoration: the point of this run is browser proof.
    screenshot: 'on',
    trace: 'retain-on-failure'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
