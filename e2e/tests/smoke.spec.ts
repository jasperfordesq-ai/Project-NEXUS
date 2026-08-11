// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Page } from '@playwright/test';
import {
  tenantUrl,
  goToTenantPage,
  waitForPageLoad,
  dismissBlockingModals,
  pinSpaApiToCandidate,
  DEFAULT_TENANT,
} from '../helpers/test-utils';

/**
 * Smoke Test Suite — Deployment Gate
 *
 * Minimal, fast, critical-path tests that verify the app is not broken.
 * These run before every production deployment. Each test should complete
 * in under 15 seconds and focus on "does it load and not crash" rather
 * than detailed functional correctness.
 *
 * Tagged @smoke for selective CI execution:
 *   npx playwright test --grep @smoke
 */

// Collect console errors per test
let consoleErrors: string[] = [];
const hasUserCredentials = Boolean(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);
const hasAdminCredentials = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
const apiBaseUrl = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:8090';
const cookieConsent = {
  essential: true,
  analytics: false,
  preferences: true,
  timestamp: new Date().toISOString(),
};

async function primeBrowserState(page: Page): Promise<void> {
  await page.addInitScript((consent) => {
    localStorage.setItem('dev_notice_dismissed', '2.1');
    localStorage.setItem('nexus_cookie_consent', JSON.stringify(consent));
  }, cookieConsent);
}

type CachedAuth = {
  accessToken: string;
  refreshToken?: string;
  tenantId?: string | number;
};

// Log in at most once per role per worker and reuse the tokens across every
// test. `/api/auth/login` is IP-rate-limited (route `throttle:30,1` plus the
// App\Core\RateLimiter brute-force limiter) and returns 429 `rate_limited`;
// logging in per test flooded it (~40 logins/min from the CI runner's single
// IP → ~11 succeed, the rest 429 and fail the whole smoke suite). Caching keeps
// it to two logins per worker, and the retry below absorbs any residual throttle
// when parallel workers share the runner IP.
const authTokenCache = new Map<'user' | 'admin', CachedAuth>();

async function loginForRole(page: Page, kind: 'user' | 'admin'): Promise<CachedAuth> {
  const email = kind === 'admin' ? process.env.E2E_ADMIN_EMAIL : process.env.E2E_USER_EMAIL;
  const password = kind === 'admin' ? process.env.E2E_ADMIN_PASSWORD : process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(`Missing E2E ${kind} credentials`);
  }

  const maxAttempts = 5;
  let lastStatus = 0;
  let lastBody = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await page.request.post(`${apiBaseUrl}/api/auth/login`, {
      data: {
        email,
        password,
        tenant_slug: DEFAULT_TENANT,
      },
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': DEFAULT_TENANT,
      },
    });

    if (response.ok()) {
      const loginData = await response.json();
      const accessToken = loginData?.data?.access_token || loginData?.access_token;
      const refreshToken = loginData?.data?.refresh_token || loginData?.refresh_token;
      const tenantId = loginData?.data?.tenant_id || loginData?.tenant_id;

      if (!accessToken) {
        throw new Error(`E2E ${kind} API login did not return an access token`);
      }

      return { accessToken, refreshToken, tenantId };
    }

    lastStatus = response.status();
    lastBody = await response.text();

    // On a throttle response, honour retry_after (seconds) and try again rather
    // than failing the suite on a transient rate-limit.
    if (lastStatus === 429 && attempt < maxAttempts) {
      let retryAfter = 2;
      try {
        const parsed = Number(JSON.parse(lastBody)?.retry_after);
        if (Number.isFinite(parsed) && parsed > 0) {
          retryAfter = parsed;
        }
      } catch {
        // non-JSON body — fall back to the default backoff
      }
      await page.waitForTimeout(Math.min(retryAfter, 20) * 1000);
      continue;
    }

    break;
  }

  throw new Error(`E2E ${kind} API login failed (${lastStatus}): ${lastBody}`);
}

async function primeApiAuth(page: Page, kind: 'user' | 'admin'): Promise<void> {
  let tokens = authTokenCache.get(kind);
  if (!tokens) {
    tokens = await loginForRole(page, kind);
    authTokenCache.set(kind, tokens);
  }

  const { accessToken, refreshToken, tenantId } = tokens;

  await page.addInitScript(
    ({ accessToken, refreshToken, tenantId }) => {
      localStorage.setItem('nexus_access_token', accessToken);
      if (refreshToken) {
        localStorage.setItem('nexus_refresh_token', refreshToken);
      }
      if (tenantId) {
        localStorage.setItem('nexus_tenant_id', String(tenantId));
      }
    },
    { accessToken, refreshToken, tenantId }
  );
}

async function waitForTenantHydration(page: Page): Promise<void> {
  const loadingShell = page
    .locator('[aria-label="Loading community"], [aria-label="Loading"], text=/Loading community|Loading\\.\\.\\./')
    .first();

  await expect(loadingShell).toBeHidden({ timeout: 20000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.body?.innerText.includes('Loading community'), null, { timeout: 25000 })
    .catch(() => undefined);

  await dismissBlockingModals(page);
}

test.beforeEach(async ({ page }) => {
  // Deploy gate: the candidate bundle calls the live API origin, which is
  // CORS-blocked from the 127.0.0.1 gate origin. Proxy those calls to the
  // candidate API so the SPA can actually bootstrap and render. No-op outside
  // the gate (only active when E2E_API_URL points at a candidate API).
  await pinSpaApiToCandidate(page);
  await primeBrowserState(page);
  consoleErrors = [];
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
});

test.setTimeout(60000);

// ---------------------------------------------------------------------------
// 1. Public Pages Load
// ---------------------------------------------------------------------------

test.describe('Smoke Tests @smoke', () => {
  test.describe('Public Pages Load', () => {
    test('landing/home page loads without errors', async ({ page }) => {
      await page.goto(tenantUrl(''), { waitUntil: 'domcontentloaded' });
      await waitForPageLoad(page);
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      // The page should have rendered something meaningful
      const body = page.locator('body');
      await expect(body).toBeVisible();

      await expect(page.getByRole('heading', { name: /Exchange Skills|Future of Time Banking/i }).first())
        .toBeVisible({ timeout: 20000 });

      // No uncaught JS errors
      expect(consoleErrors).toHaveLength(0);
    });

    test('about page loads', async ({ page }) => {
      await page.goto(tenantUrl('about'), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      await expect(page.getByRole('heading', { name: /About|Project NEXUS|hOUR Timebank/i, level: 1 }).first())
        .toBeVisible({ timeout: 20000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('terms page loads', async ({ page }) => {
      await page.goto(tenantUrl('terms'), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      await expect(page.getByRole('heading', { name: /Terms/i, level: 1 }))
        .toBeVisible({ timeout: 20000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('FAQ / help page loads', async ({ page }) => {
      // Try help page first (the app's help center), fall back to FAQ
      await page.goto(tenantUrl('help'), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      await expect(page.getByRole('heading', { name: /Help Center|FAQ/i, level: 1 }))
        .toBeVisible({ timeout: 20000 });

      expect(consoleErrors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Authentication Flow
  // ---------------------------------------------------------------------------

  test.describe('Authentication Flow', () => {
    // These tests run without auth state (fresh browser)
    test.use({ storageState: { cookies: [], origins: [] } });

    test('login page renders with form elements', async ({ page }) => {
      await page.goto(tenantUrl('login'), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);

      // Email input
      const emailInput = page.locator('#login-email, input[name="email"], input[type="email"]').first();
      await expect(emailInput).toBeVisible({ timeout: 10000 });

      // Password input
      const passwordInput = page.locator('#login-password, input[name="password"], input[type="password"]').first();
      await expect(passwordInput).toBeVisible();

      // Submit button
      const submitBtn = page.locator('button[type="submit"]').first();
      await expect(submitBtn).toBeVisible();
    });

    test('login with valid credentials succeeds and redirects to dashboard', async ({ page }) => {
      const email = process.env.E2E_USER_EMAIL;
      const password = process.env.E2E_USER_PASSWORD;
      if (!email || !password) {
        test.skip(true, 'No E2E credentials configured');
        return;
      }

      await page.goto(tenantUrl('login'), { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);

      // Fill and submit login form
      const emailInput = page.getByRole('textbox', { name: /^Email/i }).first();
      const passwordInput = page.getByRole('textbox', { name: /^Password/i }).first();
      await emailInput.fill(email);
      await passwordInput.fill(password);

      const submitBtn = page.getByRole('button', { name: /Sign In|Log in|Login/i }).first();
      await submitBtn.click();

      // Should redirect away from login (dashboard, home, feed, or onboarding)
      await page.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
      const currentUrl = page.url();
      expect(currentUrl).toMatch(/\/(dashboard|home|feed|onboarding)/);
    });

    test('login with invalid credentials shows error or stays on login', async ({ page }) => {
      await page.goto(tenantUrl('login'), { waitUntil: 'domcontentloaded' });
      await waitForPageLoad(page);
      await dismissBlockingModals(page);

      const emailInput = page.locator('#login-email, input[name="email"], input[type="email"]').first();
      const passwordInput = page.locator('#login-password, input[name="password"], input[type="password"]').first();
      await emailInput.fill('nonexistent-smoke-test@example.com');
      await passwordInput.fill('WrongPassword123!');

      // Submit via form to handle both SPA and full-page forms
      await page.evaluate(() => {
        const form = document.querySelector('form');
        if (form) {
          form.requestSubmit ? form.requestSubmit() : form.submit();
        }
      });

      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(2000);

      // Should still be on login page (not redirected to dashboard)
      expect(page.url()).toContain('login');
    });

    test('registration page renders with form fields', async ({ page }) => {
      await page.goto(tenantUrl('register'), { waitUntil: 'domcontentloaded' });
      await waitForPageLoad(page);
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      // The registration flow may render as a multi-step HeroUI form on narrow
      // viewports, so assert the shell and at least one actionable control.
      await expect(page.getByRole('heading', { name: /Create your account|Create Account|Register|Sign Up/i }))
        .toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('textbox', { name: /^Email/i }))
        .toBeVisible({ timeout: 10000 });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Dashboard (Authenticated)
  // ---------------------------------------------------------------------------

  test.describe('Dashboard - Authenticated', () => {
    test.skip(!hasUserCredentials, 'No E2E user credentials configured');

    test('dashboard loads and shows heading or content', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'dashboard');
      await waitForTenantHydration(page);

      // Should be on dashboard URL (may have tenant prefix)
      expect(page.url()).toContain('dashboard');

      // Should have a heading (welcome message or "Dashboard")
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible({ timeout: 30000 });
    });

    test('dashboard shows navigation elements', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'dashboard');
      await waitForTenantHydration(page);

      // Should have nav bar with links
      const nav = page.locator('nav, header, [role="navigation"], [role="banner"]').first();
      await expect(nav).toBeVisible({ timeout: 30000 });

      // Should have at least some navigation links
      const navLinks = page.locator('nav a[href], header a[href]');
      const linkCount = await navLinks.count();
      expect(linkCount).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Core Feature Pages Load (Authenticated)
  // ---------------------------------------------------------------------------

  test.describe('Core Feature Pages Load - Authenticated', () => {
    test.skip(!hasUserCredentials, 'No E2E user credentials configured');

    test('listings page loads and shows content area', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'listings');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      // Should have a heading or listing cards/list.
      //
      // 🔴 A WAITING assertion, because the previous form did not wait at all.
      // It read:
      //   const hasHeading = await page.locator('h1').isVisible({ timeout: 3000 })
      // and `isVisible()` is an INSTANTANEOUS check — it returns the current state
      // and ignores `timeout`. So the test looked like it allowed three seconds for
      // the heading to appear and in fact raced React's first render, immediately
      // after `main` became visible.
      //
      // That made it flaky in BOTH engines, not just Safari. On the run at
      // 2026-08-11 (ae692b79d): chromium failed once and passed on retry 1; webkit
      // failed twice and passed on retry 2 — consistent with WebKit simply being
      // slower to paint, not with a Safari-specific defect.
      //
      // `.or()` waits for EITHER locator, so this now expresses what the old code
      // meant. The `.catch(() => false)` is also gone: it silently swallowed
      // strict-mode violations, so a page with two `h1`s would have reported
      // "no heading" rather than the real problem.
      const heading = page.locator('h1');
      const cards = page.locator('article, [class*="card"], [class*="glass"]');
      await expect(heading.or(cards).first()).toBeVisible({ timeout: 15000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('messages page loads', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'messages');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('wallet page loads and shows balance area', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'wallet');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      // The wallet balance value must render for an authenticated member.
      await expect(page.getByTestId('wallet-balance')).toBeVisible({ timeout: 30000 });
      await expect(page.getByText('Your Balance')).toBeVisible();

      expect(consoleErrors).toHaveLength(0);
    });

    test('feed page loads', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'feed');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('events page loads', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'events');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('groups page loads', async ({ page }) => {
      await primeApiAuth(page, 'user');
      await goToTenantPage(page, 'groups');

      await page.waitForLoadState('domcontentloaded');
      await waitForTenantHydration(page);
      const content = page.locator('main, [role="main"], .content');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      expect(consoleErrors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Admin Panel
  // ---------------------------------------------------------------------------

  test.describe('Admin Panel', () => {
    test.skip(!hasAdminCredentials, 'No E2E admin credentials configured');
    test.use({ storageState: 'e2e/fixtures/.auth/admin.json' });

    test('admin dashboard loads', async ({ page }) => {
      await primeApiAuth(page, 'admin');
      await page.goto(`/${DEFAULT_TENANT}/admin`, { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      // Should either show admin content or redirect to login (if not admin)
      await page.waitForLoadState('domcontentloaded');

      // The seeded admin has panel access — it must land on /admin, not be
      // redirected away to login or the member dashboard.
      expect(page.url()).toContain('/admin');
      expect(page.url()).not.toContain('/login');

      const content = page.locator('main, .content, [role="main"]');
      await expect(content.first()).toBeVisible({ timeout: 30000 });

      expect(consoleErrors).toHaveLength(0);
    });

    test('admin shows navigation sidebar', async ({ page }) => {
      await primeApiAuth(page, 'admin');
      await page.goto(`/${DEFAULT_TENANT}/admin`, { waitUntil: 'domcontentloaded' });
      await dismissBlockingModals(page);
      await waitForTenantHydration(page);

      // Only check sidebar if we are on admin page (not redirected to login)
      if (!page.url().includes('/login')) {
        const sidebar = page.locator('nav, aside, [data-sidebar], [role="navigation"]');
        await expect(sidebar.first()).toBeVisible({ timeout: 30000 });

        // Sidebar should have admin links
        const adminLinks = page.locator('a[href*="/admin/"]');
        const linkCount = await adminLinks.count();
        expect(linkCount).toBeGreaterThan(0);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. API Health
  // ---------------------------------------------------------------------------

  test.describe('API Health', () => {
    const apiBaseUrl = process.env.E2E_API_URL || process.env.E2E_BASE_URL || 'http://localhost:8090';

    test('health endpoint responds with 200', async ({ request }) => {
      // Try the standard health endpoint
      const response = await request.get(`${apiBaseUrl}/health.php`, {
        timeout: 10000,
      }).catch(() => null);

      if (response) {
        expect(response.status()).toBe(200);
      } else {
        // If health.php is not available, try the root
        const rootResponse = await request.get(apiBaseUrl, { timeout: 10000 });
        expect(rootResponse.status()).toBeLessThan(500);
      }
    });

    test('bootstrap API returns tenant data', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/tenant/bootstrap`, {
        headers: {
          'X-Tenant-Slug': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      // Bootstrap should return tenant configuration data
      // The response may be wrapped in {data: ...} or be the direct object
      const data = body?.data || body;
      expect(data).toBeTruthy();

      // Should have tenant-identifying fields
      const hasTenantInfo =
        data?.tenant_id !== undefined ||
        data?.slug !== undefined ||
        data?.name !== undefined ||
        data?.site_name !== undefined ||
        data?.settings !== undefined;
      expect(hasTenantInfo).toBeTruthy();
    });

    test('categories API returns data', async ({ request }) => {
      const response = await request.get(`${apiBaseUrl}/api/v2/categories`, {
        headers: {
          'X-Tenant-Slug': DEFAULT_TENANT,
          'Accept': 'application/json',
        },
        timeout: 10000,
      });

      expect(response.status()).toBe(200);

      const body = await response.json();
      // Should return an array or an object with data array
      const categories = body?.data || body;
      expect(categories).toBeTruthy();
      expect(Array.isArray(categories)).toBeTruthy();
    });
  });
});
