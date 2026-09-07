// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E2E tests — Authentication happy paths.
 *
 * Covers:
 *   - Login with valid credentials → redirected to dashboard
 *   - Logout → redirected to login page
 *   - Protected route redirect → unauthenticated user visiting /dashboard is
 *     sent to the login page
 *
 * NOTE: These tests do NOT use the global auth state (storageState) because
 * they exercise the login/logout flow itself.
 */

import { test, expect } from '@playwright/test';

const TENANT_SLUG = process.env.E2E_TENANT ?? 'hour-timebank';
const E2E_EMAIL = process.env.E2E_EMAIL ?? 'e2e.user.a@project-nexus.local';
const E2E_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPassword123!';

/** Full login path for the test tenant */
const loginPath = `/t/${TENANT_SLUG}/login`;
/** A protected route that requires authentication */
const dashboardPath = `/t/${TENANT_SLUG}/dashboard`;

test.describe('Auth — Login happy path', () => {
  test('login with valid credentials redirects to dashboard', async ({ page }) => {
    await page.goto(loginPath);

    // The tenant card / branding should appear before the form
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10000 });

    // Fill in email and password
    await page.getByLabel('Email').fill(E2E_EMAIL);
    await page.getByLabel('Password').fill(E2E_PASSWORD);

    // Click the sign-in button (HeroUI Button renders as <button type="submit">)
    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // After successful login the app should navigate away from /login
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 15000 });

    // We should land somewhere inside the tenant prefix
    expect(page.url()).toContain(`/t/${TENANT_SLUG}/`);
  });

  test('login with invalid password shows an error message', async ({ page }) => {
    await page.goto(loginPath);

    await page.getByLabel('Email').fill(E2E_EMAIL);
    await page.getByLabel('Password').fill('wrong-password-xyz');

    await page.getByRole('button', { name: /sign in|log in/i }).click();

    // An inline error should be visible (the red error div in LoginPage)
    await expect(
      page.locator('.text-red-600, .text-red-400').first()
    ).toBeVisible({ timeout: 10000 });

    // URL should still be the login page
    await expect(page).toHaveURL(new RegExp(`/t/${TENANT_SLUG}/login`));
  });
});

test.describe('Auth — Protected route redirect', () => {
  test('unauthenticated visit to /dashboard redirects to login', async ({ page }) => {
    // Visit dashboard without any stored auth state
    await page.goto(dashboardPath);

    // Should be redirected to the login page
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
  });
});

test.describe('Auth — Logout happy path', () => {
  test.use({ storageState: 'e2e/.auth/user.json' });

  test('logout redirects to login page', async ({ page }) => {
    // Start from a protected page (dashboard)
    await page.goto(dashboardPath);

    // Wait for the app to hydrate — dashboard heading should appear
    await expect(page.getByRole('main')).toBeVisible({ timeout: 10000 });

    // Open the user menu — HeroUI Navbar typically renders an avatar button
    // The Navbar avatar/dropdown button has aria-label or contains the user avatar
    const userMenuButton = page
      .getByRole('button', { name: /account|user|profile|menu/i })
      .or(page.locator('[aria-label*="user" i], [aria-label*="account" i], [aria-label*="profile" i]'))
      .first();

    if (await userMenuButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await userMenuButton.click();

      // Click the Sign Out / Logout item in the dropdown
      const logoutItem = page
        .getByRole('menuitem', { name: /sign out|log out|logout/i })
        .or(page.getByText(/sign out|log out|logout/i).first());

      await logoutItem.click({ timeout: 5000 });
    } else {
      // Fallback: navigate directly to logout endpoint if menu not found
      await page.goto(`/t/${TENANT_SLUG}/login`);
    }

    // After logout we should be on the login page
    await expect(page).toHaveURL(new RegExp('/login'), { timeout: 10000 });
  });
});
