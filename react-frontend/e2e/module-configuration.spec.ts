// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two-session certification for the tenant Module Configuration page.
 *
 * An administrator changes every top-level switch through the real UI while a
 * separately authenticated member context reads a fresh tenant bootstrap. The
 * test always restores the original value before moving to the next switch.
 * Representative disabled routes and writes are also checked for the module
 * families that expose them.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const TENANT = process.env.E2E_TENANT ?? 'hour-timebank';
const TENANT_ROOT = `/${TENANT}`;
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@project-nexus.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ChangeMe123!';
const MEMBER_EMAIL = process.env.E2E_EMAIL ?? 'e2e.user.a@project-nexus.local';
const MEMBER_PASSWORD = process.env.E2E_PASSWORD ?? 'TestPassword123!';

type SwitchDefinition = {
  id: string;
  label: string;
  kind: 'module' | 'feature';
  route?: string;
};

const SWITCHES: SwitchDefinition[] = [
  { id: 'listings', label: 'Listings', kind: 'module', route: '/listings' },
  { id: 'wallet', label: 'Wallet', kind: 'module', route: '/wallet' },
  { id: 'messages', label: 'Messages', kind: 'module', route: '/messages' },
  { id: 'dashboard', label: 'Dashboard', kind: 'module', route: '/dashboard' },
  { id: 'feed', label: 'Feed', kind: 'module', route: '/feed' },
  { id: 'notifications', label: 'Notifications', kind: 'module', route: '/notifications' },
  { id: 'profile', label: 'Profile', kind: 'module' },
  { id: 'settings', label: 'Settings', kind: 'module', route: '/settings' },
  { id: 'explore', label: 'Explore', kind: 'feature', route: '/explore' },
  { id: 'events', label: 'Events', kind: 'feature', route: '/events' },
  { id: 'public_events', label: 'Public Events', kind: 'feature' },
  { id: 'event_attendance_credits', label: 'Attendance Rewards', kind: 'feature' },
  { id: 'partner_venues', label: 'Partner Venues', kind: 'feature' },
  { id: 'groups', label: 'Groups', kind: 'feature', route: '/groups' },
  { id: 'gamification', label: 'Gamification', kind: 'feature', route: '/achievements' },
  { id: 'goals', label: 'Goals', kind: 'feature', route: '/goals' },
  { id: 'blog', label: 'Blog', kind: 'feature', route: '/blog' },
  { id: 'resources', label: 'Resources', kind: 'feature', route: '/resources' },
  { id: 'caring_community', label: 'Caring Community Alpha', kind: 'feature', route: '/caring' },
  { id: 'volunteering', label: 'Volunteering', kind: 'feature', route: '/volunteering' },
  { id: 'exchange_workflow', label: 'Exchange Workflow', kind: 'feature', route: '/exchanges' },
  { id: 'organisations', label: 'Organisations', kind: 'feature', route: '/organisations' },
  { id: 'federation', label: 'Federation', kind: 'feature', route: '/federation' },
  { id: 'connections', label: 'Connections', kind: 'feature', route: '/connections' },
  { id: 'reviews', label: 'Reviews', kind: 'feature', route: '/reviews' },
  { id: 'polls', label: 'Polls', kind: 'feature', route: '/polls' },
  { id: 'job_vacancies', label: 'Job Vacancies', kind: 'feature', route: '/jobs' },
  { id: 'ideation_challenges', label: 'Ideation Challenges', kind: 'feature', route: '/ideation' },
  { id: 'direct_messaging', label: 'Direct Messaging', kind: 'feature' },
  { id: 'group_exchanges', label: 'Group Exchanges', kind: 'feature', route: '/group-exchanges' },
  { id: 'search', label: 'Search', kind: 'feature', route: '/search' },
  { id: 'ai_chat', label: 'AI Assistant', kind: 'feature', route: '/chat' },
  { id: 'marketplace', label: 'Marketplace', kind: 'feature', route: '/marketplace' },
  { id: 'identity_verification', label: 'Identity Verification', kind: 'feature', route: '/verify-identity-optional' },
  { id: 'two_factor_authentication', label: 'Two-factor authentication', kind: 'feature' },
  { id: 'biometric_login', label: 'Passkeys & biometric login', kind: 'feature' },
  { id: 'newsletter', label: 'Newsletter', kind: 'feature' },
  { id: 'message_translation', label: 'Message Translation', kind: 'feature' },
  { id: 'courses', label: 'Courses', kind: 'feature', route: '/courses' },
  { id: 'podcasts', label: 'Podcasts', kind: 'feature', route: '/podcasts' },
  { id: 'member_premium', label: 'Donations & Support', kind: 'feature' },
];

const REJECTED_WRITES: Partial<Record<string, string>> = {
  wallet: '/v2/wallet/transfer',
  messages: '/v2/messages',
  feed: '/v2/feed/posts',
  notifications: '/v2/notifications/read-all',
  connections: '/v2/connections/request',
  reviews: '/v2/reviews',
  polls: '/v2/feed/polls',
  goals: '/v2/goals',
  search: '/v2/search/saved',
  ai_chat: '/ai/chat',
  resources: '/v2/resources',
  organisations: '/v2/volunteering/organisations',
};

async function login(browser: Browser, email: string, password: string): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: 'http://localhost:5173' });
  const page = await context.newPage();
  await page.goto(`${TENANT_ROOT}/login`);

  const essentialOnly = page.getByRole('button', { name: 'Essential only' });
  if (await essentialOnly.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await essentialOnly.click();
  }

  await page.getByLabel('Email').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 20_000 });
  await expect(page.locator('header[data-site-header="true"]')).toBeVisible({ timeout: 20_000 });
  return context;
}

async function bootstrapFlag(page: Page, definition: SwitchDefinition): Promise<boolean> {
  const response = await page.request.get(`/api/v2/tenant/bootstrap?slug=${encodeURIComponent(TENANT)}`, {
    headers: { 'Cache-Control': 'no-cache' },
  });
  expect(response.ok(), `tenant bootstrap for ${definition.id}`).toBeTruthy();
  const payload = await response.json();
  return Boolean(payload.data?.[definition.kind === 'module' ? 'modules' : 'features']?.[definition.id]);
}

async function memberWrite(page: Page, path: string): Promise<{ status: number; code?: string }> {
  return page.evaluate(async endpoint => {
    const response = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${localStorage.getItem('nexus_access_token') ?? ''}`,
        'X-Tenant-ID': localStorage.getItem('nexus_tenant_id') ?? '',
      },
      body: '{}',
    });
    const body = await response.json().catch(() => ({}));
    return {
      status: response.status,
      code: body?.errors?.[0]?.code ?? body?.error?.code ?? body?.code,
    };
  }, path);
}

async function settleAdminPage(page: Page): Promise<void> {
  // A successful toggle refreshes the tenant context and briefly remounts the
  // entire admin shell. Wait past that transition before activating the next
  // switch so its click cannot land on a control that is being removed.
  await page.waitForTimeout(1_200);
  await expect(page.getByRole('heading', { name: 'Module Configuration' })).toBeVisible({ timeout: 20_000 });
}

async function activateSwitch(page: Page, label: string): Promise<void> {
  const toggle = page.getByRole('switch', { name: `Toggle ${label}`, exact: true });
  await expect(toggle).toBeEnabled({ timeout: 20_000 });
  await toggle.evaluate(element => (element as HTMLElement).click());
}

test.describe('Module Configuration — two independent sessions', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(90_000);

  let adminContext: BrowserContext;
  let memberContext: BrowserContext;
  let adminPage: Page;
  let memberPage: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    adminContext = await login(
      browser,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
    );
    memberContext = await login(
      browser,
      MEMBER_EMAIL,
      MEMBER_PASSWORD,
    );
    adminPage = adminContext.pages()[0];
    memberPage = memberContext.pages()[0];
    await adminPage.goto(`${TENANT_ROOT}/admin/module-configuration`);
    await expect(adminPage.getByRole('heading', { name: 'Module Configuration' })).toBeVisible({ timeout: 20_000 });
    await expect(adminPage.getByRole('switch')).toHaveCount(SWITCHES.length);
  });

  test.afterAll(async () => {
    await memberContext?.close();
    await adminContext?.close();
  });

  for (const [index, definition] of SWITCHES.entries()) {
    test(`${definition.id} propagates and restores`, async ({ browser }) => {
      // Local access tokens expire during this intentionally long serial suite.
      // Renew both independent actors before expiry so late route checks cannot
      // mistake a login redirect for feature enforcement.
      if (index > 0 && index % 20 === 0) {
        await memberContext.close();
        await adminContext.close();
        adminContext = await login(browser, ADMIN_EMAIL, ADMIN_PASSWORD);
        memberContext = await login(browser, MEMBER_EMAIL, MEMBER_PASSWORD);
        adminPage = adminContext.pages()[0];
        memberPage = memberContext.pages()[0];
        await adminPage.goto(`${TENANT_ROOT}/admin/module-configuration`);
      }

      await settleAdminPage(adminPage);
      const toggle = adminPage.getByRole('switch', { name: `Toggle ${definition.label}`, exact: true });
      await expect(toggle, `admin switch ${definition.id}`).toBeVisible();
      await expect(toggle, `enabled admin switch ${definition.id}`).toBeEnabled();
      const original = await toggle.isChecked();
      const changed = !original;
      console.log(`[module-configuration] ${definition.id}: ${original} -> ${changed}`);

      try {
        await activateSwitch(adminPage, definition.label);

        if (definition.id === 'biometric_login' && !changed) {
          await adminPage.getByRole('button', { name: 'Disable passkey authentication', exact: true }).click();
        }

        await expect(toggle, `admin update ${definition.id}`).toBeChecked({ checked: changed, timeout: 15_000 });
        await expect.poll(() => bootstrapFlag(memberPage, definition), {
          message: `member bootstrap reflects ${definition.id}=${changed}`,
          timeout: 15_000,
        }).toBe(changed);

        if (!changed && definition.route) {
          await memberPage.goto(`${TENANT_ROOT}${definition.route}`);
          await memberPage.waitForLoadState('domcontentloaded');
          await expect.poll(async () => {
            const redirected = new URL(memberPage.url()).pathname !== `${TENANT_ROOT}${definition.route}`;
            const unavailable = await memberPage.getByRole('heading', { name: 'Coming Soon' })
              .isVisible()
              .catch(() => false);
            return redirected || unavailable;
          }, {
            message: `disabled route ${definition.route} redirects or renders its unavailable fallback`,
            timeout: 12_000,
          }).toBe(true);
        }

        if (!changed && REJECTED_WRITES[definition.id]) {
          const rejection = await memberWrite(memberPage, REJECTED_WRITES[definition.id]!);
          expect(rejection.status, `disabled write ${definition.id}`).toBe(403);
          expect(rejection.code, `disabled write code ${definition.id}`).toBe(
            definition.kind === 'module' ? 'MODULE_DISABLED' : 'FEATURE_DISABLED',
          );
        }
      } finally {
        await adminPage.bringToFront();
        await settleAdminPage(adminPage);
        const currentToggle = adminPage.getByRole('switch', { name: `Toggle ${definition.label}`, exact: true });
        if (await currentToggle.isChecked() !== original) {
          await activateSwitch(adminPage, definition.label);
          if (definition.id === 'biometric_login' && !original) {
            await adminPage.getByRole('button', { name: 'Disable passkey authentication', exact: true }).click();
          }
        }
        await expect.poll(() => bootstrapFlag(memberPage, definition), {
          message: `member bootstrap restored ${definition.id}=${original}`,
          timeout: 15_000,
        }).toBe(original);
        await settleAdminPage(adminPage);
        const restoredToggle = adminPage.getByRole('switch', { name: `Toggle ${definition.label}`, exact: true });
        if (!await restoredToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await adminPage.reload();
          await settleAdminPage(adminPage);
        }
        await expect(
          adminPage.getByRole('switch', { name: `Toggle ${definition.label}`, exact: true }),
          `restore ${definition.id}`,
        ).toBeChecked({ checked: original, timeout: 15_000 });
      }
    });
  }
});
