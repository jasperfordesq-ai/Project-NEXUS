#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Capture SIGNED-IN member pages from the disposable journey environment.
 *
 * Why this is separate from `capture-blade-web-screenshots.js`: that script captures the
 * six public pages a signed-out visitor sees, because until now the only database
 * available locally was a copy of the live platform. Anything captured while signed in
 * embedded real members' names and messages, so it could never be committed to a public
 * repository — which is why there was no visual evidence for the pages members spend all
 * their time on.
 *
 * 🔴 This script REFUSES to run against anything but the disposable fixture. Two
 * independent guards, because getting this wrong would publish real members' data:
 *
 *   1. The database it is pointed at must contain only synthetic accounts.
 *   2. The signed-in page must render the synthetic member's name.
 *
 * A failure of either is a hard stop, never a warning.
 *
 * Usage:
 *   bash ../scripts/webuk-e2e-env.sh up      # from the repo root, first
 *   npm run visual:journey                   # from web-uk/
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const BASE_URL = process.env.WEBUK_JOURNEY_BASE_URL || 'http://127.0.0.1:5181';
const TENANT = process.env.WEBUK_JOURNEY_TENANT || 'e2e-community';
const DB_NAME = 'nexus_webuk_e2e';
const DB_CONTAINER = 'nexus-php-db';
const OUT_DIR = path.join(__dirname, '..', 'docs', 'screenshots', 'journey');

const ACCOUNT = {
  email: process.env.WEBUK_JOURNEY_EMAIL || 'e2e.user.a@project-nexus.local',
  password: process.env.WEBUK_JOURNEY_PASSWORD || 'TestPassword123!',
  expectedName: 'E2E UserA',
};

/**
 * The pages a member actually spends time on. Kept deliberately short: every entry is two
 * committed images, and a set nobody looks at is just repository weight.
 */
const PAGES = Object.freeze([
  { name: '01-home', path: '', auth: false },
  { name: '02-login', path: '/login', auth: false },
  { name: '03-dashboard', path: '/dashboard', auth: true },
  { name: '04-listings', path: '/listings', auth: true },
  { name: '05-listing-detail', path: '/listings', auth: true, followFirstListing: true },
  { name: '06-messages', path: '/messages', auth: true },
  { name: '07-wallet', path: '/wallet', auth: true },
  { name: '08-members', path: '/members', auth: true },
  { name: '09-profile-settings', path: '/profile/settings', auth: true },
  { name: '10-exchanges', path: '/exchanges', auth: true },
]);

const VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1280, height: 900 },
  // 320px is the GDS reflow width: WCAG 2.2 §1.4.10 requires no horizontal scrolling
  // there, so capturing it makes a regression visible rather than merely measurable.
  { name: 'mobile-320', width: 320, height: 900 },
]);

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
function defaultDatabaseQuery(sql) {
  return execFileSync('docker', [
    'exec', DB_CONTAINER, 'mysql', '--skip-ssl', '-h', '127.0.0.1',
    '-unexus', '-pnexus_secret', DB_NAME, '-N', '-e', sql,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// `query` is injectable ONLY so the three refusal paths can be tested deterministically.
// Without it a test's outcome depends on whether the disposable environment happens to be
// running, which means the same assertion can pass for two different reasons — and a guard
// that protects a public repository from real member data deserves better than that.
function assertDisposableDatabase(query = defaultDatabaseQuery) {
  let total;
  let real;
  try {
    total = Number(query('SELECT COUNT(*) FROM users;'));
    real = Number(query(
      "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@project-nexus.local' AND email NOT LIKE '%@example.%';"
    ));
  } catch (error) {
    throw new Error(
      `Could not inspect ${DB_NAME} to prove it is the disposable fixture: ${error.message}\n`
      + 'Refusing to capture. Bring the environment up with: bash scripts/webuk-e2e-env.sh up'
    );
  }

  if (!Number.isFinite(total) || total === 0) {
    throw new Error(`${DB_NAME} has no users. Refusing to capture from an unseeded database.`);
  }
  if (real > 0) {
    throw new Error(
      `🔴 REFUSING TO CAPTURE: ${real} of ${total} accounts in ${DB_NAME} do not look synthetic.\n`
      + 'These screenshots are committed to a PUBLIC repository. Do not capture from real member data.'
    );
  }
  console.log(`guard 1 ok: ${DB_NAME} holds ${total} synthetic accounts, 0 real`);
}

function assertSyntheticMemberVisible(html) {
  if (!html.includes(ACCOUNT.expectedName)) {
    throw new Error(
      `🔴 REFUSING TO CAPTURE: the signed-in page does not show "${ACCOUNT.expectedName}".\n`
      + 'Either the sign-in did not take, or this is not the synthetic fixture.'
    );
  }
  console.log(`guard 2 ok: signed in as the synthetic member "${ACCOUNT.expectedName}"`);
}

// ---------------------------------------------------------------------------
function urlFor(pathname) {
  return `${BASE_URL.replace(/\/+$/, '')}/${TENANT}/accessible${pathname}`;
}

async function dismissCookieBanner(page) {
  // Present on the first view and would otherwise sit across the top of every image.
  const reject = page.locator('form[action*="cookie"] button, .govuk-cookie-banner button').first();
  if (await reject.count()) {
    await reject.click({ timeout: 3000 }).catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
  }
}

async function signIn(page) {
  await page.goto(urlFor('/login'), { waitUntil: 'domcontentloaded' });
  await dismissCookieBanner(page);
  await page.fill('#email', ACCOUNT.email);
  await page.fill('#password', ACCOUNT.password);
  // 🔴 Identify the sign-in form by the field only IT has, not by its action.
  // The login page carries FOUR submit buttons: two in the cookie banner, one in the
  // language switcher, and the real one. The language switcher's form is
  // `method="get" action="…/login"` and appears FIRST, so `form[action*="login"]` selects
  // the wrong form — which submits a language change, leaves the visitor signed out, and
  // makes everything captured afterwards a signed-out page wearing a signed-in label.
  // An unscoped `button[type=submit]` click hit the cookie banner for the same reason
  // earlier in this audit and produced a whole round of wrong findings.
  await page.locator('form:has(input[name="password"]) button[type="submit"]').first().click();
  await page.waitForLoadState('domcontentloaded');
  const html = await page.content();
  assertSyntheticMemberVisible(html);
}

async function main() {
  assertDisposableDatabase();

  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await signIn(page);

      for (const target of PAGES) {
        let url = urlFor(target.path);
        if (target.followFirstListing) {
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          const href = await page.locator('a[href*="/listings/"]').first().getAttribute('href').catch(() => null);
          if (!href) {
            console.log(`  skip ${target.name} (${viewport.name}): no listing to open`);
            continue;
          }
          url = new URL(href, BASE_URL).toString();
        }

        const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
        await dismissCookieBanner(page);
        const status = response ? response.status() : 0;

        // Horizontal overflow at 320px is a WCAG 1.4.10 failure; record it beside the image
        // so the manifest states it rather than leaving it to the eye.
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth);

        const file = `${target.name}.${viewport.name}.png`;
        await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true });
        results.push({
          page: target.name,
          viewport: viewport.name,
          url: url.replace(BASE_URL, ''),
          status,
          signedIn: target.auth,
          horizontalOverflow: overflow,
          file,
        });
        console.log(`  ${status} ${file}${overflow ? '  🔴 HORIZONTAL OVERFLOW' : ''}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const bad = results.filter((r) => r.status >= 400);
  const overflowing = results.filter((r) => r.horizontalOverflow);

  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    `${JSON.stringify({
      // No timestamp on purpose: a generated file that changes on every run produces a
      // diff even when nothing changed, and these are committed.
      source: 'disposable journey environment (synthetic accounts only)',
      tenant: TENANT,
      viewports: VIEWPORTS,
      results,
      pagesWithErrorStatus: bad.map((r) => `${r.page} (${r.status})`),
      pagesWithHorizontalOverflow: overflowing.map((r) => `${r.page} @ ${r.viewport}`),
    }, null, 2)}\n`,
    'utf8'
  );

  console.log(`\n${results.length} screenshots in ${path.relative(process.cwd(), OUT_DIR)}`);
  if (bad.length) console.log(`🔴 ${bad.length} page(s) returned an error status: ${bad.map((r) => r.page).join(', ')}`);
  if (overflowing.length) console.log(`🔴 ${overflowing.length} page(s) scroll horizontally at 320px: ${overflowing.map((r) => r.page).join(', ')}`);
  if (bad.length || overflowing.length) process.exitCode = 1;
}

// 🔴 Only run as a CLI. The guards below are exported so they can be tested, and an
// unconditional main() would launch a browser and hit the database the moment a test
// file required this module.
if (require.main === module) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exitCode = 2;
  });
}

// Exported for tests. These two guards are the only thing standing between this
// script and real member data being committed to a PUBLIC repository, so they are
// covered rather than trusted. `tests/webuk-journey-capture.test.js` asserts both
// refusal paths; the coverage replaces what the two deleted Blade-pairing capture
// suites used to provide for the old paired script.
module.exports = {
  assertDisposableDatabase,
  assertSyntheticMemberVisible,
  urlFor,
  PAGES,
  VIEWPORTS,
  ACCOUNT,
  DB_NAME,
};
