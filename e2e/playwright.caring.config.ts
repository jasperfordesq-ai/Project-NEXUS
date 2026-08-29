// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';

/**
 * Config for the Caring Community caregiver-consent journey.
 *
 * 🔴 Deliberately separate from the root `playwright.config.ts`, and its specs
 * live in `e2e/journeys/` rather than `e2e/tests/`.
 *
 * The root config's `testDir` is `e2e/tests` with `testMatch: '**‍/*.spec.ts'`,
 * and five broad projects (chromium-modern, firefox-modern, mobile-chrome,
 * webkit-modern, mobile-safari) each attach
 * `storageState: e2e/fixtures/.auth/user.json` and point at
 * `E2E_BASE_URL` (default :5173 → the :8090 stack, whose `nexus` database is a
 * PRODUCTION-DERIVED snapshot of real members).
 *
 * This journey WRITES caregiver relationships, consent evidence and
 * safeguarding decisions. Putting its spec under `e2e/tests/` would have swept
 * it into all five of those projects and run it, five times over, against real
 * member data with the wrong actor's session. Keeping it outside that tree
 * makes the isolation structural rather than a convention someone has to
 * remember.
 *
 * It targets the disposable stack instead — `bash scripts/webuk-e2e-env.sh up`
 * (Laravel :8091, database `nexus_webuk_e2e`, synthetic members only) with a
 * Vite on :5174 proxied to it. Port 5173 is left alone: it belongs to the
 * developer.
 *
 * There is no `webServer` block. Playwright would otherwise start (or worse,
 * reuse) a server whose API target it cannot verify, and the whole point of
 * `assertCaringFixtureEnvironment()` is to prove which backend is behind the
 * frontend before a single assertion runs. Prerequisites are checked and
 * reported, never silently provisioned.
 *
 * Run:  npm run test:e2e:caring
 */
export default defineConfig({
  testDir: './journeys',
  testMatch: '**/*.spec.ts',

  // A consent journey must never be retried into passing.
  retries: 0,

  // Three actors act in sequence on one record. Running files in parallel would
  // let two runs race for the same caregiver/recipient pair.
  fullyParallel: false,
  workers: 1,

  // Real multi-actor navigation across a dev-mode Vite is slower than a unit
  // test; the default 30s trips on first compile rather than on a real fault.
  timeout: 120_000,
  expect: { timeout: 15_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/caring', open: 'never' }],
    ['json', { outputFile: 'reports/caring-results.json' }],
  ],

  outputDir: 'test-results/caring',

  use: {
    baseURL: process.env.CARING_E2E_BASE_URL || 'http://127.0.0.1:5174',
    // Evidence, not decoration: this journey's whole purpose is browser proof.
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'caring-chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Pinned above the desktop breakpoint. Several controls in this app are
        // `hidden lg:flex`, so a narrower default silently skips them and a pass
        // proves less than it appears to.
        viewport: { width: 1440, height: 950 },
      },
    },
  ],
});
