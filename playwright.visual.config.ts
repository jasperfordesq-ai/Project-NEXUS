// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { defineConfig, devices } from '@playwright/test';

/**
 * Picture check for the member website (warmth plan Phase 4, E1).
 *
 * Takes screenshots of the main member pages on the show community
 * ("Riverside Timebank", `database/seeders/ShowcaseCommunitySeeder.php`) in
 * light and dark, desktop and phone, and compares them with the last approved
 * pictures, so a visual slip is caught before members see it.
 *
 * LOCAL ONLY, by design:
 *   - it needs the disposable e2e stack with the show community loaded
 *     (`bash scripts/webuk-e2e-env.sh showcase`) and a Vite server pointed at it
 *     (`react-e2e-polish` in .claude/launch.json → http://127.0.0.1:5193);
 *   - screenshots depend on the machine's fonts, so pictures from Windows and
 *     from CI's Linux would never match each other;
 *   - the approved pictures stay in `.local-docs-archive/visual-baselines/`
 *     (not committed: this repository is public and they are large).
 *
 * Run:     npm run visual:check
 * Approve: npm run visual:approve   (after looking at the differences)
 * Re-seed the show community and re-approve when the day changes: its dates
 * are relative to the day it was seeded.
 */

const BASE_URL = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:5193';

export default defineConfig({
  testDir: './e2e/visual',
  testMatch: '**/*.visual.ts',
  outputDir: './e2e/test-results/visual',
  snapshotPathTemplate: './.local-docs-archive/visual-baselines/{projectName}/{arg}{ext}',
  timeout: 60_000,
  // One worker per view, pages taken one after another inside it. Each view
  // signs in as its own show-community member: parallel sessions for the SAME
  // member sign each other out (measured 11 Nov: 5–8 of 29 pages signed out
  // with 4 workers on one account, 0 with one worker).
  fullyParallel: false,
  workers: 4,
  // One retry: a real visual change fails twice; a one-off loading hiccup does not.
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'e2e/reports/visual', open: 'never' }]],
  expect: {
    toHaveScreenshot: {
      // A fixed pixel count, not a share of the page: on a 4,000-pixel-tall
      // page one recoloured button is under 0.2% of it, so a ratio let it
      // through (proved 11 Nov). 600 px absorbs "1 hr ago" → "2 hr ago" and
      // sub-pixel text; a button is several thousand.
      maxDiffPixels: 600,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    baseURL: BASE_URL,
    reducedMotion: 'reduce',
    locale: 'en-GB',
    timezoneId: 'Europe/Dublin',
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop-light',
      use: { viewport: { width: 1280, height: 900 }, colorScheme: 'light'},
    },
    {
      name: 'desktop-dark',
      use: { viewport: { width: 1280, height: 900 }, colorScheme: 'dark'},
    },
    {
      name: 'phone-light',
      use: { ...devices['Pixel 7'], colorScheme: 'light'},
    },
    {
      name: 'phone-dark',
      use: { ...devices['Pixel 7'], colorScheme: 'dark'},
    },
  ],
});
