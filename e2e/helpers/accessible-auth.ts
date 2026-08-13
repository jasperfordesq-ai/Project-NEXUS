// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared login + path lists for the accessible (GOV.UK) frontend a11y scan.
 *
 * 🔴 Why this file exists. Until 2026-08-05 the accessible-frontend a11y spec
 * never authenticated. Six of its twenty-three paths are behind
 * `RequireAccessibleAuthentication` and answered 302 to the login page, and
 * Playwright's `page.goto()` follows redirects silently. Every structural
 * assertion in that spec — `main#main-content`, an `h1`, the skip link, the
 * phase banner — is ALSO true of the login page, so the test passed and axe
 * scanned `/login` six times over. The suite reported green while the member
 * pages had no screen-reader coverage at all.
 *
 * The paths that were silently unscanned, confirmed by probing a running
 * server on 2026-08-05: /feed, /listings, /messages, /events, /volunteering
 * and /kb. (/members is genuinely public and was fine.)
 *
 * Two rules follow from that, and both are enforced in the spec:
 *   1. A member page must assert it did NOT land on the login page. A
 *      structural assertion is not proof you are on the page you asked for.
 *   2. The member pages must be scanned with a real session, which is what
 *      this helper establishes.
 *
 * Credentials come from `Database\Seeders\E2ETestDataSeeder`, which creates
 * active, approved, email-verified accounts with known passwords and refuses
 * to run in production. Seed before running:
 *
 *   E2E_TENANT_ID=2 php artisan db:seed --class="Database\Seeders\E2ETestDataSeeder"
 */

import { expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export const ALPHA_TENANT = process.env.E2E_ALPHA_TENANT || 'hour-timebank';

/** Defaults match E2ETestDataSeeder's user A. */
export const ALPHA_MEMBER_EMAIL =
  process.env.E2E_USER_EMAIL || 'e2e.user.a@project-nexus.local';
export const ALPHA_MEMBER_PASSWORD =
  process.env.E2E_USER_PASSWORD || 'TestPassword123!';

/** Saved session state. Gitignored — it holds a live bearer token. */
export const ALPHA_AUTH_FILE = path.join(
  __dirname,
  '..',
  '.auth',
  'accessible-member.json',
);

const base = `/${ALPHA_TENANT}/accessible`;

/** Pages that must render for a signed-out visitor (verified 200 unauthenticated). */
export const ALPHA_PUBLIC_PAGES = [
  '/',
  base,
  `${base}/login`,
  `${base}/register`,
  `${base}/contact`,
  `${base}/members`,
  `${base}/about`,
  `${base}/trust-and-safety`,
  `${base}/accessibility`,
  `${base}/legal`,
  `${base}/legal/terms`,
  `${base}/legal/privacy`,
  `${base}/legal/cookies`,
  `${base}/legal/community-guidelines`,
  `${base}/legal/acceptable-use`,
  `${base}/help`,
  `${base}/blog`,
];

/**
 * Pages behind authentication (verified 302 unauthenticated).
 *
 * The first six were in the old list and were silently scanning /login. The
 * last four were absent entirely, which is why the core member exchange journey
 * — browse a post, open it, message, confirm, complete, review balance — had no
 * accessibility coverage on the pages that actually carry it.
 */
export const ALPHA_MEMBER_PAGES = [
  // Guardian arrangements: the screen where a member agrees to, refuses, or
  // withdraws from a safeguarding arrangement made about them. It carries form
  // controls, a status tag and notification banners, so it is exactly the kind of
  // page a screen-reader scan must cover — and the population it serves is the
  // one most likely to be using this frontend.
  `${base}/settings/guardians`,
  `${base}/dashboard`,
  `${base}/feed`,
  `${base}/listings`,
  `${base}/messages`,
  `${base}/events`,
  `${base}/volunteering`,
  `${base}/kb`,
  `${base}/exchanges`,
  `${base}/wallet`,
  `${base}/profile`,
];

/** True when a URL has been bounced to the accessible login page. */
export function isLoginUrl(url: string): boolean {
  return new URL(url, 'http://127.0.0.1').pathname.endsWith('/accessible/login');
}

/**
 * Log in through the real Blade form (session cookies, CSRF token in the page).
 * Asserts loudly on failure — a silent auth failure is the exact bug this
 * whole file exists to prevent.
 */
export async function loginAsAlphaMember(page: Page): Promise<void> {
  await page.goto(`${base}/login`);

  // Scope to the login form: the same page carries a resend-verification form
  // whose action also contains "/login".
  const form = page.locator('form:has(#password)');
  await form.locator('#email').fill(ALPHA_MEMBER_EMAIL);
  await form.locator('#password').fill(ALPHA_MEMBER_PASSWORD);
  await form.locator('button[type="submit"]').click();

  // Wait for the POST to land somewhere — success redirects to the dashboard,
  // failure back to /login?status=... Matching both means a bad credential
  // reports the real reason immediately instead of timing out.
  await page.waitForURL(/\/accessible(\/|\?|$)/, { timeout: 20_000 });
  const status = new URL(page.url()).searchParams.get('status');
  expect(
    status,
    `Login was rejected (status=${status}) for ${ALPHA_MEMBER_EMAIL}. ` +
      'Seed the fixture first: E2E_TENANT_ID=2 php artisan db:seed --class="Database\\Seeders\\E2ETestDataSeeder"',
  ).toBeNull();

  // Prove the session works on a page that requires it, rather than trusting
  // that we merely navigated somewhere.
  await page.goto(`${base}/dashboard`);
  expect(
    isLoginUrl(page.url()),
    `Login did not establish a session for ${ALPHA_MEMBER_EMAIL}. Landed on ${page.url()}. ` +
      'Seed the fixture first: E2E_TENANT_ID=2 php artisan db:seed --class="Database\\Seeders\\E2ETestDataSeeder"',
  ).toBe(false);
}

export function ensureAuthDir(): void {
  mkdirSync(path.dirname(ALPHA_AUTH_FILE), { recursive: true });
}
