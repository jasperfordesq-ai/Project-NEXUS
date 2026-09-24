// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { FullConfig } from '@playwright/test';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { seedTwoActors } from './helpers/seed';
import { completeTwoFactorIfChallenged } from './helpers/two-factor';

// Load environment variables from .env.test
dotenv.config({ path: path.join(__dirname, '.env.test') });

/**
 * Global Setup for E2E Tests
 *
 * This script runs once before all tests to:
 * 1. Create authenticated sessions for different user types
 * 2. Set up test data fixtures
 * 3. Verify the test environment is accessible
 */

// Test user credentials (should be configured in .env.test)
const TEST_USERS = {
  user: {
    email: process.env.E2E_USER_EMAIL || 'test@hour-timebank.ie',
    password: process.env.E2E_USER_PASSWORD || 'TestPassword123!',
    theme: 'react',
  },
  admin: {
    email: process.env.E2E_ADMIN_EMAIL || 'admin@hour-timebank.ie',
    password: process.env.E2E_ADMIN_PASSWORD || 'AdminPassword123!',
    theme: 'react',
  },
};

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';
const TENANT_SLUG = process.env.E2E_TENANT || 'hour-timebank';
const HAS_USER_CREDENTIALS = Boolean(process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD);
const HAS_ADMIN_CREDENTIALS = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD);
const SKIP_DATA_SEED = process.env.E2E_SKIP_DATA_SEED === '1';
const REQUIRE_CONFIGURED_AUTH = process.env.E2E_REQUIRE_AUTH === '1';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;
const COOKIE_CONSENT = {
  essential: true,
  analytics: false,
  preferences: true,
  timestamp: new Date().toISOString(),
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkServerWithRetry(page: any, url: string, retries: number = MAX_RETRIES): Promise<boolean> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`   Attempt ${attempt}/${retries}...`);
      const response = await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });

      if (response && response.status() < 400) {
        return true;
      }

      // 503 might be temporary - retry
      if (response && response.status() === 503 && attempt < retries) {
        console.log(`   Got 503, waiting ${RETRY_DELAY}ms before retry...`);
        await sleep(RETRY_DELAY);
        continue;
      }

      console.log(`   Server returned status ${response?.status()}`);
    } catch (error) {
      if (attempt < retries) {
        console.log(`   Connection failed, waiting ${RETRY_DELAY}ms before retry...`);
        await sleep(RETRY_DELAY);
        continue;
      }
      throw error;
    }
  }
  return false;
}

async function dismissDevNoticeModal(page: any): Promise<void> {
  // The dev notice modal blocks interactions until dismissed
  // It uses localStorage key 'dev_notice_dismissed' with value matching STORAGE_VERSION
  try {
    // Set localStorage to dismiss the dev notice before it appears
    await page.addInitScript(() => {
      localStorage.setItem('dev_notice_dismissed', '2.1');
    });
  } catch (error) {
    // If we can't set localStorage, try to click the dismiss button
    try {
      const continueBtn = page.locator('#dev-notice-continue');
      if (await continueBtn.isVisible({ timeout: 2000 })) {
        await continueBtn.click();
        await page.waitForTimeout(300); // Wait for modal animation
      }
    } catch {
      // Modal might not be present, continue
    }
  }
}

/**
 * Authenticate through the browser-facing API and save its HttpOnly session
 * cookie plus the non-secret binding needed to restore an in-memory token.
 */
async function authenticateViaApi(
  authContext: any,
  authPage: any,
  credentials: { email: string; password: string; theme: string },
  userType: string,
  authDir: string
): Promise<void> {
  const reactUrl = process.env.E2E_REACT_URL || BASE_URL;
  const apiBaseUrl = new URL(reactUrl).origin;

  console.log(`   Authenticating admin via API at ${apiBaseUrl}/api/auth/login...`);

  // Call the auth API directly to get JWT tokens. The E2E Smoke job runs
  // several Playwright invocations back-to-back and each global setup logs in
  // (member + admin), so the login throttle can be briefly exhausted by the
  // later invocations (429 rate_limited, short retry_after). Retry on 429
  // instead of failing the whole run.
  const doLogin = () => authPage.request.post(`${apiBaseUrl}/api/auth/login`, {
    data: {
      email: credentials.email,
      password: credentials.password,
      tenant_slug: TENANT_SLUG,
    },
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Slug': TENANT_SLUG,
        Origin: apiBaseUrl,
    },
  });

  let loginResponse = await doLogin();
  for (let attempt = 0; attempt < 6 && loginResponse.status() === 429; attempt++) {
    let retryAfter = 2;
    try {
      const parsed = Number((await loginResponse.json())?.retry_after);
      if (Number.isFinite(parsed) && parsed > 0) {
        retryAfter = parsed;
      }
    } catch {
      // non-JSON body — use the default backoff
    }
    console.log(`   Login throttled (429); retrying in ${retryAfter}s (attempt ${attempt + 1})...`);
    await sleep(Math.min(retryAfter, 10) * 1000 + 500);
    loginResponse = await doLogin();
  }

  if (!loginResponse.ok()) {
    const body = await loginResponse.text();
    throw new Error(`API login failed (${loginResponse.status()}): ${body}`);
  }

  let loginData = await loginResponse.json();

  // Since the MFA baseline (security register E-004) an administrator cannot
  // receive a credential from the password step alone: login hands over the
  // enrolment (fresh CI database) or a code challenge (already enrolled). The
  // helper completes either and remembers the secret for the specs that sign
  // in again during the run.
  if (loginData?.two_factor_token) {
    console.log('   Login handed over a two-factor step; completing it...');
  }
  loginData = await completeTwoFactorIfChallenged(loginData, {
    request: authPage.request,
    apiBaseUrl,
    tenantSlug: TENANT_SLUG,
    email: credentials.email,
    origin: apiBaseUrl,
  });

  // Credential responses keep the refresh secret in a host-only HttpOnly cookie.
  const accessToken = loginData?.data?.access_token || loginData?.access_token;
  const sessionBinding = loginData?.data?.session_binding || loginData?.session_binding;
  const tenantId = loginData?.data?.tenant_id || loginData?.tenant_id;

  if (!accessToken || typeof sessionBinding !== 'string' || !/^[a-f0-9]{64}$/.test(sessionBinding)) {
    throw new Error('Browser API login did not return an access token and session binding');
  }

  const cookieName = `__Host-nexus_refresh_${sessionBinding.slice(0, 32)}`;
  const cookies = await authContext.cookies(apiBaseUrl);
  if (!cookies.some((cookie: { name: string; httpOnly: boolean }) => cookie.name === cookieName && cookie.httpOnly)) {
    throw new Error('Browser API login did not set its HttpOnly refresh cookie');
  }

  // Ensure onboarding is marked complete to avoid redirecting to the wizard
  try {
    await authPage.request.post(`${apiBaseUrl}/api/v2/onboarding/complete`, {
      data: { offers: [], needs: [] },
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'X-Tenant-Slug': TENANT_SLUG,
      },
    });
  } catch {
    // Ignore if already completed or endpoint unavailable
  }

  // Navigate to the React app origin so we can set localStorage
  // Use the React frontend URL (may differ from API URL in Docker setup)
  await authPage.goto(`${reactUrl}/${TENANT_SLUG}/login`, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {
    // If /login redirects or fails, try the root
    return authPage.goto(reactUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
  });

  // The access token stays in module memory. Only the non-secret continuity
  // marker is serialized so the SPA can restore through its HttpOnly cookie.
  await authPage.evaluate(
    ({ sessionBinding, tenantId, cookieConsent }: {
      sessionBinding: string;
      tenantId?: string | number;
      cookieConsent: typeof COOKIE_CONSENT;
    }) => {
      const generation = crypto.randomUUID();
      localStorage.setItem('nexus_auth_session_generation', generation);
      localStorage.setItem(`nexus_auth_binding:${generation}`, sessionBinding);
      if (tenantId) {
        localStorage.setItem('nexus_tenant_id', String(tenantId));
      }
      // Dismiss dev notice
      localStorage.setItem('dev_notice_dismissed', '2.1');
      localStorage.setItem('nexus_cookie_consent', JSON.stringify(cookieConsent));
    },
    { sessionBinding, tenantId: tenantId ? String(tenantId) : undefined, cookieConsent: COOKIE_CONSENT }
  );

  // Storage state contains no script-readable credential.
  const storagePath = path.join(authDir, `${userType}.json`);
  await authContext.storageState({ path: storagePath });
  const savedState = JSON.parse(fs.readFileSync(storagePath, 'utf8'));
  const storedNames = (savedState.origins ?? []).flatMap((origin: { localStorage?: Array<{ name: string }> }) =>
    (origin.localStorage ?? []).map((entry) => entry.name));
  if (storedNames.includes('nexus_access_token') || storedNames.includes('nexus_refresh_token')) {
    throw new Error('E2E auth state contains a script-readable credential');
  }
}

/**
 * Authenticate user via the legacy PHP form login (session-based).
 * Legacy-only. Not used for the React SPA.
 */
async function authenticateViaForm(
  authContext: any,
  authPage: any,
  credentials: { email: string; password: string; theme: string },
  userType: string,
  authDir: string
): Promise<void> {
  // Navigate to login page with retry
  const loginAccessible = await checkServerWithRetry(
    authPage,
    `${BASE_URL}/${TENANT_SLUG}/login`,
    2
  );

  if (!loginAccessible) {
    throw new Error('Login page not accessible');
  }

  // Wait a moment for any modals to appear
  await authPage.waitForTimeout(500);

  // Check if dev notice modal appeared
  const devNoticeBtn = authPage.locator('#dev-notice-continue');
  if (await devNoticeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    console.log('   Dismissing dev notice modal...');
    await devNoticeBtn.click();
    await authPage.waitForTimeout(300);
  }

  // Wait for form to be ready
  await authPage.waitForSelector('input[name="email"], input[type="email"]', { timeout: 5000 });

  // Fill login form
  const emailInput = authPage.locator('form input[name="email"], form input[type="email"]').first();
  const passwordInput = authPage.locator('form input[name="password"], form input[type="password"]').first();

  await emailInput.fill(credentials.email);
  await passwordInput.fill(credentials.password);

  // Submit form
  const loginForm = authPage.locator('form:has(input[name="password"])').first();
  const submitBtn = loginForm.locator('button[type="submit"], input[type="submit"]').first();
  await submitBtn.click();

  // Wait for navigation
  await authPage.waitForURL(/\/(dashboard|home|feed|login|\/)/, { timeout: 15000 });

  // Check if login was successful
  const currentUrl = authPage.url();
  if (currentUrl.includes('/login')) {
    const errorMessage = await authPage.locator('.error, .alert-danger').textContent().catch(() => '');
    throw new Error(`Login failed: ${errorMessage || 'Invalid credentials'}`);
  }

  // Save storage state
  const storageName = userType === 'user' ? 'user' : userType;
  const storagePath = path.join(authDir, `${storageName}.json`);
  await authContext.storageState({ path: storagePath });
}

async function globalSetup(config: FullConfig) {
  console.log('\n🚀 Starting E2E Global Setup...\n');

  // Create auth directory if it doesn't exist
  const authDir = path.join(__dirname, 'fixtures', '.auth');
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  // Create empty auth files first (so tests can run even if auth fails)
  const emptyState = { cookies: [], origins: [] };
  for (const userType of ['user', 'admin']) {
    const storagePath = path.join(authDir, `${userType}.json`);
    if (!fs.existsSync(storagePath)) {
      fs.writeFileSync(storagePath, JSON.stringify(emptyState, null, 2));
    }
  }

  const browser = await chromium.launch();
  let serverAccessible = false;
  const authFailures: string[] = [];

  try {
    // Verify server is accessible
    console.log(`📡 Checking server at ${BASE_URL}...`);
    const context = await browser.newContext();
    const page = await context.newPage();

    // Dismiss dev notice modal for server check
    await dismissDevNoticeModal(page);

    try {
      serverAccessible = await checkServerWithRetry(page, `${BASE_URL}/${TENANT_SLUG}/login`);

      if (!serverAccessible) {
        console.warn('⚠️  Server returned error status. Tests will run with empty auth state.');
        console.warn('   Some tests may fail or be skipped.\n');
      } else {
        console.log('✅ Server is accessible\n');
      }
    } catch (error) {
      console.warn('⚠️  Could not connect to server:', error);
      console.warn('   Tests will run with empty auth state.\n');
    }

    await context.close();

    if (REQUIRE_CONFIGURED_AUTH && !serverAccessible) {
      throw new Error(`Required E2E auth could not run because ${BASE_URL} is unavailable`);
    }

    const configuredUsers = Object.entries(TEST_USERS).filter(([userType]) => (
      userType === 'admin' ? HAS_ADMIN_CREDENTIALS : HAS_USER_CREDENTIALS
    ));

    if (REQUIRE_CONFIGURED_AUTH && (!HAS_USER_CREDENTIALS || !HAS_ADMIN_CREDENTIALS)) {
      throw new Error('Required E2E auth needs both member and admin credential pairs');
    }

    if (configuredUsers.length === 0) {
      console.log('No E2E auth credentials configured; using empty auth state files.');
    }

    // Only attempt authentication if server is accessible and credentials exist.
    if (serverAccessible) {
      // Create authenticated sessions for each user type
      for (const [userType, credentials] of configuredUsers) {
        console.log(`🔐 Creating auth session for ${userType} user...`);

        const authContext = await browser.newContext();
        const authPage = await authContext.newPage();

        // Dismiss dev notice modal for this context
        await dismissDevNoticeModal(authPage);

        try {
          // All React users authenticate via the API (JWT-based)
          await authenticateViaApi(authContext, authPage, credentials, userType, authDir);

          console.log(`✅ Auth session saved for ${userType}\n`);
        } catch (error) {
          authFailures.push(userType);
          console.warn(`⚠️  Could not create auth session for ${userType}: ${error}`);
          console.warn(`   Tests requiring ${userType} auth may fail.\n`);
        }

        await authContext.close();
      }

      if (REQUIRE_CONFIGURED_AUTH && authFailures.length > 0) {
        throw new Error(`Required E2E auth session(s) failed: ${authFailures.join(', ')}`);
      }

      // Seed the deterministic two-actor fixture (balance floor, second actor,
      // listing, exchange) so money/auth specs can assert real outcomes. Best-effort:
      // a seeding failure must not block the suite.
      if (HAS_USER_CREDENTIALS && HAS_ADMIN_CREDENTIALS && !SKIP_DATA_SEED) {
        console.log('🌱 Seeding two-actor fixture...');
        try {
          await seedTwoActors({
            userA: { email: TEST_USERS.user.email, password: TEST_USERS.user.password },
            admin: { email: TEST_USERS.admin.email, password: TEST_USERS.admin.password },
          });
          console.log('✅ Seed fixture written.\n');
        } catch (error) {
          console.warn(`⚠️  Two-actor seeding failed: ${error}`);
          console.warn('   Money/exchange specs that require the seed may be skipped.\n');
        }
      }
    }

    console.log('✅ Global setup complete!\n');
  } finally {
    await browser.close();
  }
}

export default globalSetup;
