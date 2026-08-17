// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';
import {
  dismissBlockingModals,
  tenantUrl,
} from '../helpers/test-utils';

const EMPTY_STORAGE = { cookies: [], origins: [] };
const USER_STORAGE = 'e2e/fixtures/.auth/user.json';
const ADMIN_STORAGE = 'e2e/fixtures/.auth/admin.json';

type ThemeSetup = {
  theme?: 'light' | 'dark';
  language?: string;
  largeText?: boolean;
  highContrast?: boolean;
  reducedMotion?: boolean;
  accentColor?: string;
};

const IRISH_MEMBER_ROUTES = [
  { path: 'dashboard', heading: 'Fáilte ar ais' },
  { path: 'listings', heading: 'Liostálacha' },
  { path: 'events', heading: 'Imeachtaí' },
  { path: 'messages', heading: 'Teachtaireachtaí' },
  { path: 'wallet', heading: 'Sparán' },
] as const;

function formatViolations(violations: Result[]): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 5)
        .map((node) => `    - ${node.target.join(' ')}\n      ${node.failureSummary ?? node.html}`)
        .join('\n');
      return `[${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

async function setThemeProfile(page: Page, setup: ThemeSetup): Promise<void> {
  await page.addInitScript((profile: ThemeSetup) => {
    localStorage.setItem('dev_notice_dismissed', '2.1');
    localStorage.setItem('nexus_cookie_consent', JSON.stringify({
      essential: true,
      analytics: false,
      preferences: true,
      timestamp: new Date().toISOString(),
    }));

    if (profile.theme) localStorage.setItem('nexus_theme', profile.theme);
    if (profile.language) {
      localStorage.setItem('nexus_language', profile.language);
      localStorage.setItem('nexus_language_user_chosen', 'true');
    }

    localStorage.setItem('nexus_theme_preferences', JSON.stringify({
      accentColor: profile.accentColor ?? '#6366f1',
      fontSize: 'medium',
      density: 'comfortable',
      largeText: profile.largeText ?? false,
      highContrast: profile.highContrast ?? false,
      reducedMotion: profile.reducedMotion ?? false,
      simplifiedLayout: false,
    }));
  }, setup);
}

async function visit(page: Page, path: string): Promise<void> {
  const response = await page.goto(tenantUrl(path), { waitUntil: 'domcontentloaded' });
  expect(response?.status(), `HTTP status for ${path || 'home'}`).toBeLessThan(400);
  await dismissBlockingModals(page);
  await expect(page.locator('main, [role="main"]').first()).toBeVisible({ timeout: 15_000 });
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(
    dimensions.scrollWidth,
    `${label} has horizontal overflow at a 320px CSS viewport`,
  ).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

async function audit(page: Page, label: string): Promise<void> {
  // Freeze CSS transitions/animations and let any in-flight ones jump to their
  // end state before axe samples the page. Several pages fade content in via
  // the motion shim (opacity 0 -> 1); sampling mid-transition read text (e.g.
  // the dashboard empty states) at partial opacity and produced false
  // color-contrast failures even though the token colours pass at full opacity.
  // A genuinely fixed low-opacity element is unaffected by this and would still
  // be flagged, so this settles animation timing without masking real issues.
  await page.addStyleTag({
    content: `*, *::before, *::after {
      transition: none !important;
      animation: none !important;
    }`,
  });
  await page.waitForTimeout(200);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();

  expect(
    results.violations,
    `${label} has ${results.violations.length} WCAG A/AA violation(s):\n${formatViolations(results.violations)}`,
  ).toEqual([]);
}

function watchUnexpectedBrowserOutput(page: Page, testInfo: TestInfo): string[] {
  const unexpected: string[] = [];
  const reactOrAriaWarning = /react|hydration|aria|pressresponder|dialog|heading|validateDOMNesting/i;

  page.on('pageerror', (error) => {
    unexpected.push(`pageerror: ${error.message}`);
  });
  // Ignore API rate-limit (429) resource errors. This gate loads many
  // API-heavy pages rapidly from a single CI IP and trips the per-IP request
  // throttle; the resulting "Failed to load resource ... 429" console error is
  // a load artifact of the test harness, not an accessibility or app defect.
  const rateLimitNoise = /429|too many requests|rate.?limit/i;
  page.on('console', (message) => {
    const text = message.text();
    if (rateLimitNoise.test(text)) return;
    if (message.type() === 'error' || (message.type() === 'warning' && reactOrAriaWarning.test(text))) {
      unexpected.push(`${message.type()}: ${text}`);
    }
  });

  testInfo.annotations.push({
    type: 'browser-output-policy',
    description: 'Console/page errors and React/ARIA/hydration warnings fail this gate.',
  });
  return unexpected;
}

test.describe('real-browser accessibility gate', () => {
  let unexpectedBrowserOutput: string[];

  test.beforeEach(async ({ page }, testInfo) => {
    unexpectedBrowserOutput = watchUnexpectedBrowserOutput(page, testInfo);
  });

  test.afterEach(async () => {
    expect(
      unexpectedBrowserOutput,
      `Unexpected browser output:\n${unexpectedBrowserOutput.join('\n')}`,
    ).toEqual([]);
  });

  test.describe('anonymous public and auth surfaces', () => {
    test.use({ storageState: EMPTY_STORAGE });

    test('public landing has landmarks, skip navigation, and no violations', async ({ page }) => {
      await setThemeProfile(page, { theme: 'light' });
      await visit(page, '');

      await expect(page.locator('html')).toHaveAttribute('lang', /\S+/);
      await expect(page.locator('main, [role="main"]')).toHaveCount(1);
      await expect(page.locator('a[href="#main-content"]')).toHaveCount(1);
      await expect(page.locator('h1')).not.toHaveCount(0);
      await audit(page, 'public landing (light)');
    });

    test('login form is named and accessible in dark mode', async ({ page }) => {
      await setThemeProfile(page, { theme: 'dark' });
      await visit(page, 'login');

      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('input[type="email"]')).toHaveAccessibleName(/.+/);
      await expect(page.locator('input[type="password"]')).toHaveAccessibleName(/.+/);
      await audit(page, 'login form (dark)');
    });

    test('custom accent and high-contrast profile has no violations', async ({ page }) => {
      await setThemeProfile(page, {
        theme: 'light',
        highContrast: true,
        accentColor: '#005ea5',
      });
      await visit(page, 'login');

      await expect(page.locator('html')).toHaveAttribute('data-high-contrast', 'true');
      const accent = await page.locator('html').evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--accent').trim(),
      );
      expect(accent).toBe('#005ea5');
      await audit(page, 'login form (high contrast and custom accent)');
    });

    test('RTL and reduced-motion public content has no violations', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await setThemeProfile(page, {
        theme: 'dark',
        language: 'ar',
        reducedMotion: true,
      });
      await visit(page, 'about');

      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
      await audit(page, 'about (RTL and reduced motion)');
    });

    test('Irish login reflows with large text and retains translated semantics', async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await setThemeProfile(page, {
        theme: 'light',
        language: 'ga',
        largeText: true,
      });
      await visit(page, 'login');

      await expect(page.locator('html')).toHaveAttribute('lang', 'ga');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
      await expect(page.locator('html')).toHaveAttribute('data-large-text', 'true');
      await expect(page.locator('h1')).toContainText('Fáilte ar ais');
      await assertNoHorizontalOverflow(page, 'Irish login with large text');
      await audit(page, 'Irish login with large text at 320px');
    });

    test('forced-colours login retains its form semantics', async ({ page }) => {
      await page.emulateMedia({ forcedColors: 'active' });
      await setThemeProfile(page, { theme: 'light' });
      await visit(page, 'login');

      await expect(page.locator('input[type="email"]')).toHaveAccessibleName(/.+/);
      await expect(page.locator('input[type="password"]')).toHaveAccessibleName(/.+/);
      await audit(page, 'login form (forced colours)');
    });
  });

  test.describe('authenticated member surfaces', () => {
    test.use({ storageState: USER_STORAGE });

    test('dashboard and route focus are accessible', async ({ page }) => {
      await setThemeProfile(page, { theme: 'light' });
      await visit(page, 'dashboard');
      await audit(page, 'member dashboard');

      const listingsLink = page.locator(`a[href="${tenantUrl('listings')}"]:visible`).first();
      await expect(listingsLink).toBeVisible();
      await listingsLink.click();
      const escapedListingsUrl = tenantUrl('listings').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await expect(page).toHaveURL(new RegExp(`${escapedListingsUrl}/?$`));

      await expect.poll(
        () => page.evaluate(() => {
          const active = document.activeElement;
          return active?.id === 'main-content' || /^H[1-6]$/.test(active?.tagName ?? '');
        }),
        { message: 'SPA navigation should move focus to main content or its heading' },
      ).toBe(true);
      await audit(page, 'member listings after client-side navigation');
    });

    test('search modal has combobox semantics, traps focus, and restores it', async ({ page }) => {
      await visit(page, 'dashboard');

      const restoreTarget = page.locator('button:visible').first();
      await restoreTarget.evaluate((element) => { element.id = 'a11y-search-restore-target'; });
      await restoreTarget.focus();
      await page.keyboard.press('Control+KeyK');

      const dialog = page.getByRole('dialog');
      const combobox = page.getByRole('combobox');
      await expect(dialog).toBeVisible();
      await expect(combobox).toBeFocused();
      await expect(combobox).toHaveAttribute('aria-expanded', 'false');
      await expect(combobox).not.toHaveAttribute('aria-controls', /.+/);

      await combobox.fill('>');
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible();
      await expect(combobox).toHaveAttribute('aria-controls', await listbox.getAttribute('id') ?? '');
      await expect(combobox).toHaveAttribute('aria-expanded', 'true');
      await audit(page, 'global search modal');

      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(page.locator('#a11y-search-restore-target')).toBeFocused();
    });

    test('core Irish member routes retain translated headings and large-text reflow', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 320, height: 800 });
      await setThemeProfile(page, {
        theme: 'light',
        language: 'ga',
        largeText: true,
        reducedMotion: true,
      });

      for (const route of IRISH_MEMBER_ROUTES) {
        await visit(page, route.path);
        await expect(page.locator('html')).toHaveAttribute('lang', 'ga');
        await expect(page.locator('html')).toHaveAttribute('data-large-text', 'true');
        await expect(page.locator('h1').first()).toContainText(route.heading);
        await assertNoHorizontalOverflow(page, `Irish member ${route.path}`);
        await audit(page, `Irish member ${route.path} with large text at 320px`);
      }
    });
  });

  test.describe('mobile drawer surface', () => {
    test.use({
      storageState: EMPTY_STORAGE,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });

    test('guest navigation drawer traps/restores focus and has no violations', async ({ page }) => {
      await setThemeProfile(page, { theme: 'light' });
      await visit(page, '');

      const trigger = page.locator('button[aria-controls="mobile-drawer"]');
      await expect(trigger).toBeVisible();
      await trigger.click();

      const drawer = page.locator('#mobile-drawer');
      await expect(drawer).toBeVisible();
      await audit(page, 'mobile navigation drawer');

      for (let index = 0; index < 12; index += 1) {
        await page.keyboard.press('Tab');
        expect(await drawer.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });

  test.describe('administrator table and help drawer', () => {
    test.use({ storageState: ADMIN_STORAGE });

    test('admin users table and contextual help drawer have no violations', async ({ page }) => {
      await setThemeProfile(page, { theme: 'dark' });
      // Contextual help is intentionally route-owned. The users registry has no
      // article, so start on the real Caring overview article before entering
      // the separate admin shell for the table coverage below.
      await visit(page, 'caring');
      const helpTrigger = page.getByRole('button', { name: /help/i }).first();
      await expect(helpTrigger).toBeVisible({ timeout: 10_000 });
      await helpTrigger.click();

      const drawer = page.getByRole('dialog');
      await expect(drawer).toBeVisible();
      await audit(page, 'admin contextual help drawer');
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(helpTrigger).toBeFocused();

      await visit(page, 'admin/users');
      await expect(page.locator('table, [role="grid"]').first()).toBeVisible({ timeout: 15_000 });
      await audit(page, 'admin users table');
    });
  });
});
