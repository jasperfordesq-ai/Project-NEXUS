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
