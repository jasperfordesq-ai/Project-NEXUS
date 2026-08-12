// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Page, expect } from '@playwright/test';
import { selectors } from './fixtures';

/**
 * Where the app is allowed to land after a successful sign-in.
 *
 * 🔴 This used to be `/dashboard` only, and the app lands on `/feed`. Every
 * caller therefore sat in `waitForURL` until it timed out — after a sign-in that
 * had already succeeded. The Playwright log said so plainly
 * ("navigated to .../feed" while "waiting for .../dashboard") and it still cost
 * four specs their auth for as long as nobody read it.
 *
 * Both destinations are accepted rather than pinning the current one, because
 * which of the two a member lands on is a product decision (module gating picks
 * it) and is not what any caller of this helper is testing.
 */
const POST_LOGIN_PATHS = /\/(feed|dashboard)\/?$/;

/**
 * Login helper - authenticates a user via the login form
 */
export async function loginAsUser(
  page: Page,
  email: string,
  password: string,
  tenantSlug: string = process.env.E2E_TENANT_SLUG || 'hour-timebank'
): Promise<void> {
  await page.goto(`/${tenantSlug}/login`);

  // Wait for login form to be visible
  await page.waitForSelector('form', { state: 'visible' });

  // Fill in credentials
  await page.fill('input[name="email"], input[type="email"]', email);
  await page.fill('input[name="password"], input[type="password"]', password);

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for the post-login landing page (see POST_LOGIN_PATHS above).
  await page.waitForURL(
    (url) => url.pathname.startsWith(`/${tenantSlug}/`) && POST_LOGIN_PATHS.test(url.pathname),
    { timeout: 15000 },
  );

  // Verify we're logged in. `[data-user-menu]` is a structural hook on the
  // Navbar's avatar trigger and is present at every viewport; the old selector
  // list (`[data-testid="user-menu"], .user-avatar, button:has-text("Profile")`)
  // matched nothing in the app, so this assertion could only ever have passed by
  // never being reached.
  await expect(
    page.locator(selectors.userMenu).first(),
    'Signed in and landed correctly, but no user menu rendered',
  ).toBeVisible({ timeout: 10000 });
}

/**
 * Logout helper - logs out the current user
 */
export async function logout(page: Page): Promise<void> {
  // Click user menu/avatar
  const userMenu = page.locator(selectors.userMenu).first();
  await userMenu.click();

  // Click logout button
  await page.click('button:has-text("Logout"), a:has-text("Logout")');

  // Wait for redirect to home or login
  await page.waitForURL(/\/(login|$)/, { timeout: 5000 });
}

/**
 * Sign up helper - creates a new user account
 */
export async function signUp(
  page: Page,
  userData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  },
  tenantSlug: string = process.env.E2E_TENANT_SLUG || 'hour-timebank'
): Promise<void> {
  await page.goto(`/${tenantSlug}/register`);

  // Wait for registration form
  await page.waitForSelector('form', { state: 'visible' });

  // Fill in registration details
  await page.fill('input[name="firstName"], input[name="first_name"]', userData.firstName);
  await page.fill('input[name="lastName"], input[name="last_name"]', userData.lastName);
  await page.fill('input[name="email"], input[type="email"]', userData.email);
  await page.fill('input[name="password"], input[type="password"]', userData.password);

  // Accept terms if checkbox exists
  const termsCheckbox = page.locator('input[type="checkbox"][name*="terms"], input[type="checkbox"][name*="agree"]');
  if (await termsCheckbox.isVisible()) {
    await termsCheckbox.check();
  }

  // Submit form
  await page.click('button[type="submit"]');

  // Wait for successful registration (redirect to dashboard or onboarding)
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 10000 });
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    await expect(page.locator(selectors.userMenu).first()).toBeVisible({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure user is logged in (login if not already)
 */
export async function ensureLoggedIn(
  page: Page,
  email: string = process.env.E2E_TEST_USER_EMAIL || '',
  password: string = process.env.E2E_TEST_USER_PASSWORD || ''
): Promise<void> {
  if (!(await isLoggedIn(page))) {
    await loginAsUser(page, email, password);
  }
}
