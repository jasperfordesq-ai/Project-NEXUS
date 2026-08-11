// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, 'e2e/.env.test') });

const enterpriseEventsJourney = '**/events/enterprise-journey.spec.ts';

/**
 * Real Safari on real macOS, via a remote browser grid.
 *
 * 🔴 Why this exists. Playwright's bundled `webkit` is Safari's ENGINE, not
 * Safari. It cannot tell you anything about Safari's own native form controls,
 * content blockers and ad blockers, extensions, or Lockdown Mode — and after a
 * Mac user reported the app misbehaving on 2026-08-09, those were exactly the
 * things left untested once the engine came back clean. Closing that gap needs
 * actual macOS, which no amount of local testing provides.
 *
 * Deliberately provider-agnostic: set `PLAYWRIGHT_REMOTE_WS_ENDPOINT` to any
 * Playwright-compatible grid (BrowserStack, Sauce Labs, LambdaTest, or a
 * self-hosted one). For BrowserStack specifically, setting
 * `BROWSERSTACK_USERNAME` + `BROWSERSTACK_ACCESS_KEY` is enough and the endpoint
 * is built below. See docs/REAL-SAFARI-TESTING.md.
 *
 * The project only exists when configured, so an unconfigured checkout is not
 * left with a project that always fails.
 */
function realSafariWsEndpoint(): string | null {
  const explicit = process.env.PLAYWRIGHT_REMOTE_WS_ENDPOINT;
  if (explicit) return explicit;

  const user = process.env.BROWSERSTACK_USERNAME;
  const key = process.env.BROWSERSTACK_ACCESS_KEY;
  if (!user || !key) return null;

  const caps = {
    browser: 'playwright-webkit',
    os: 'OS X',
    osVersion: process.env.BROWSERSTACK_OS_VERSION || 'Sonoma',
    // Named so a failing run is identifiable in the provider's dashboard.
    buildName: process.env.GITHUB_RUN_ID
      ? `nexus-ci-${process.env.GITHUB_RUN_ID}`
      : 'nexus-local',
    sessionName: 'Real Safari on macOS',
    'browserstack.username': user,
    'browserstack.accessKey': key,
  };

  return `wss://cdp.browserstack.com/playwright?caps=${encodeURIComponent(JSON.stringify(caps))}`;
}

const REAL_SAFARI_WS = realSafariWsEndpoint();

/**
 * Project NEXUS - E2E Test Configuration
 *
 * This configuration supports:
 * - Multi-tenant testing (hour-timebank tenant)
 * - React frontend only
 * - Parallel test execution
 * - Visual regression testing
 * - Mobile viewport testing
 */

export default defineConfig({
  // Test directory
  testDir: './e2e/tests',

  // Test file pattern
  testMatch: '**/*.spec.ts',

  // Global timeout for each test
  timeout: 30000,

  // Expect timeout
  expect: {
    timeout: 5000,
  },

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // The local PHP/API stack is resource-sensitive on Docker Desktop. Keep the
  // default serial and allow explicit opt-in parallelism when the stack can take it.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1,

  // Reporter to use
  reporter: [
    ['html', { outputFolder: 'e2e/reports/html' }],
    ['json', { outputFile: 'e2e/reports/results.json' }],
    ['list'],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the local development server
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',

    // Default tenant for tests
    extraHTTPHeaders: {
      'X-Test-Tenant': 'hour-timebank',
    },

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'on-first-retry',

    // Accept self-signed certificates
    ignoreHTTPSErrors: true,
  },

  // Configure projects for major browsers
  projects: [
    // Setup project for authentication state
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },

    // Desktop Chrome - React app
    {
      name: 'chromium-modern',
      testIgnore: [
        '**/accessibility-audit.spec.ts',
        '**/pwa/offline-install.spec.ts',
        enterpriseEventsJourney,
      ],
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/fixtures/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Desktop Firefox - React app
    {
      name: 'firefox-modern',
      testIgnore: [
        '**/accessibility-audit.spec.ts',
        '**/pwa/offline-install.spec.ts',
        enterpriseEventsJourney,
      ],
      use: {
        ...devices['Desktop Firefox'],
        storageState: 'e2e/fixtures/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Mobile Chrome - Modern Theme
    {
      name: 'mobile-chrome',
      testIgnore: [
        '**/accessibility-audit.spec.ts',
        '**/pwa/offline-install.spec.ts',
        enterpriseEventsJourney,
      ],
      use: {
        ...devices['Pixel 5'],
        storageState: 'e2e/fixtures/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Desktop Safari (WebKit) - React app
    //
    // 🔴 Added 2026-08-11 after a Mac user reported the app behaving oddly and
    // there was NOTHING to check it against. Before this, desktop Safari had no
    // project at all, and the only WebKit project (`mobile-safari` below) lives
    // in the `e2e-cross-browser` job, which is gated on E2E secrets and is
    // SKIPPED — while the workflow still reports success. So Safari's engine had
    // never actually run in this repo.
    //
    // Playwright's `webkit` is a real WebKit build, so engine-level bugs
    // reproduce without a Mac. It is NOT Safari the application: native macOS
    // form-control rendering, content blockers, extensions and Lockdown Mode are
    // outside its scope, so a clean run here does not fully exonerate Safari.
    {
      name: 'webkit-modern',
      testIgnore: [
        '**/accessibility-audit.spec.ts',
        '**/pwa/offline-install.spec.ts',
        enterpriseEventsJourney,
      ],
      use: {
        ...devices['Desktop Safari'],
        // 🔴 VIEWPORT PINNED. `devices['Desktop Safari']` leaves Playwright's 1280×720
        // default, and 1280 is exactly the width at which this suite's own recorded
        // trap bites: several checks silently skip below the desktop breakpoint, so a
        // pass proves less than it appears to. `real-safari` pins 1440×950 and
        // `e2e/tests/ui/dropdowns.spec.ts` pins its own, which meant the two Safari
        // layers were running the same specs at different widths and were not
        // comparable. Any spec added to the webkit job inherits this.
        viewport: { width: 1440, height: 950 },
        storageState: 'e2e/fixtures/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Mobile Safari - React app
    {
      name: 'mobile-safari',
      testIgnore: [
        '**/accessibility-audit.spec.ts',
        '**/pwa/offline-install.spec.ts',
        enterpriseEventsJourney,
      ],
      use: {
        ...devices['iPhone 12'],
        storageState: 'e2e/fixtures/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Real Safari on real macOS, via a remote grid. Only registered when
    // configured — see realSafariWsEndpoint() above and
    // docs/REAL-SAFARI-TESTING.md. This is the ONLY project that can see
    // Safari's native controls, content blockers, extensions and Lockdown Mode;
    // webkit-modern is the engine only.
    ...(REAL_SAFARI_WS
      ? [
          {
            name: 'real-safari',
            // Keep it to the fast, high-signal specs. A remote grid is billed by
            // the minute and is a poor place to run the whole suite.
            testMatch: ['**/smoke.spec.ts', '**/ui/dropdowns.spec.ts'],
            use: {
              ...devices['Desktop Safari'],
              // Desktop Safari's default 1280x720 sits below the header's
              // desktop breakpoint, which silently skipped every menu test.
              viewport: { width: 1440, height: 950 },
              storageState: 'e2e/fixtures/.auth/user.json',
              connectOptions: { wsEndpoint: REAL_SAFARI_WS },
            },
            dependencies: ['setup'],
          },
        ]
      : []),

    // Chromium-only production PWA install/offline lifecycle. This project is
    // invoked against the built live stack; Vite development intentionally has
    // service-worker generation disabled.
    {
      name: 'pwa',
      testMatch: '**/pwa/offline-install.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
      dependencies: ['setup'],
    },

    // Blocking real-browser WCAG gate. The spec supplies explicit anonymous,
    // member, admin, mobile, theme, and locale storage/context profiles, so it
    // runs once in Chromium rather than being duplicated by every broad project.
    {
      name: 'accessibility',
      testMatch: '**/accessibility-audit.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
      dependencies: ['setup'],
    },

    // Admin user tests
    {
      name: 'admin',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/fixtures/.auth/admin.json',
      },
      dependencies: ['setup'],
      testMatch: ['**/admin/**/*.spec.ts', '**/broker/**/*.spec.ts'],
    },

    // Unauthenticated tests (public pages, login, register)
    {
      name: 'unauthenticated',
      use: {
        ...devices['Desktop Chrome'],
        // No storage state - fresh browser
      },
      // Depends on setup so the seed (incl. legal-document acceptance for the
      // test user) is in place — otherwise the "Updated legal documents" gate
      // blocks post-login interactions like logout. Storage state is still
      // empty, so these tests start as a genuinely fresh/unauthenticated browser.
      dependencies: ['setup'],
      testMatch: '**/auth/**/*.spec.ts',
    },
  ],

  // Output folder for test artifacts
  outputDir: 'e2e/test-results',

  // Global setup and teardown
  globalSetup: require.resolve('./e2e/global.setup.ts'),
  globalTeardown: require.resolve('./e2e/global.teardown.ts'),
});
