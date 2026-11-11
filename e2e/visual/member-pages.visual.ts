// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Picture check: the main member pages of the show community, compared with
 * the last approved pictures. See playwright.visual.config.ts.
 */

const SLUG = 'riverside';

/**
 * Each view signs in as its own (fictional) member, so the four views can run
 * side by side: parallel sessions for one member sign each other out.
 */
const MEMBER_FOR_VIEW: Record<string, string> = {
  'desktop-light': 'maeve',
  'desktop-dark': 'tomas',
  'phone-light': 'priya',
  'phone-dark': 'amara',
};

/**
 * One signed-in browser per worker, reused for every signed-in page that worker
 * takes. A saved session cannot be shared between workers: the refresh cookie
 * changes on every use, and an old copy used again signs the account out.
 */
const test = base.extend<{ memberPage: Page }, { memberContext: BrowserContext; workerPage: Page }>({
  memberContext: [
    async ({ browser }, use, workerInfo) => {
      const projectUse = workerInfo.project.use;
      const context = await browser.newContext({
        ...projectUse,
        baseURL: projectUse.baseURL,
      });
      // The member's own saved theme would otherwise win over the browser's.
      const theme = workerInfo.project.name.endsWith('dark') ? 'dark' : 'light';
      await context.addInitScript((value) => {
        try {
          window.localStorage.setItem('nexus_theme', value);
        } catch {
          /* storage blocked: the browser colour scheme still applies */
        }
      }, theme);
      const page = await context.newPage();
      await page.goto('/riverside/login');
      await page.locator('input[type="email"]').fill(`${MEMBER_FOR_VIEW[workerInfo.project.name] ?? 'maeve'}@showcase.project-nexus.local`);
      await page.locator('input[type="password"]').fill(process.env.SHOWCASE_PASSWORD || 'ShowcasePassword123!');
      await page.locator('input[type="password"]').press('Enter');
      await page.waitForURL(/\/riverside\/(feed|dashboard)/, { timeout: 30_000 });
      // Essential cookies only, so the banner never covers a picture.
      const essential = page.getByRole('button', { name: /essential only/i });
      if (await essential.isVisible().catch(() => false)) {
        await essential.click();
      }
      await page.close();
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  /**
   * ONE tab per worker, moved between pages inside the app (like a member
   * clicking), never reloaded: the access token lives in memory, so every full
   * load renews the session, and the server allows 10 renewals a minute per
   * address (`auth.refresh_token_rate_limit`). Four workers reloading per page
   * hit that and came out signed out.
   */
  workerPage: [
    async ({ memberContext }, use, workerInfo) => {
      const page = await memberContext.newPage();
      // Server errors surface to members as a "Request failed" message, so a
      // picture run reports every one it meets instead of leaving it to a diff.
      page.on('response', (r) => {
        if (r.url().includes('/api/') && r.status() >= 500) {
          console.warn(`[visual ${workerInfo.project.name}] ${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
        }
      });
      page.on('requestfailed', (r) => {
        // ERR_ABORTED is the app cancelling its own request when it moves on.
        if (r.url().includes('/api/') && !/ERR_ABORTED/.test(r.failure()?.errorText ?? '')) {
          console.warn(`[visual ${workerInfo.project.name}] failed ${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText ?? ''}`);
        }
      });
      await page.goto('/riverside/dashboard');
      await use(page);
      await page.close();
    },
    { scope: 'worker' },
  ],
  memberPage: async ({ workerPage }, use) => {
    await use(workerPage);
  },
});

/** Moves the app to a page without reloading it (React Router follows popstate). */
async function visit(page: Page, path: string): Promise<void> {
  trackRequests(page);
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
    window.scrollTo(0, 0);
  }, path);
  await page.waitForURL((url) => url.pathname + url.search === path, { timeout: 10_000 });
}

/** Pages whose address is fixed. */
const FIXED_PAGES: Array<[name: string, path: string]> = [
  ['dashboard', '/dashboard'],
  ['feed', '/feed'],
  ['explore', '/explore'],
  ['listings', '/listings'],
  ['listing-create', '/listings/create'],
  ['events', '/events'],
  ['groups', '/groups'],
  ['members', '/members'],
  ['messages', '/messages'],
  ['wallet', '/wallet'],
  ['exchanges', '/exchanges'],
  ['notifications', '/notifications'],
  ['achievements', '/achievements'],
  ['leaderboard', '/leaderboard'],
  ['goals', '/goals'],
  ['connections', '/connections'],
  ['blog', '/blog'],
  ['blog-post', '/blog/riverside-repair-cafe-turns-one'],
  ['search', '/search?q=garden'],
  ['settings', '/settings'],
  ['help', '/help'],
  ['not-found', '/no-such-page-here'],
];

/** Detail pages, found by following a link with a known (seeded) title. */
const DETAIL_PAGES: Array<[name: string, listPath: string, linkText: RegExp]> = [
  ['listing-detail', '/listings', /Lift to the hospital on Thursday/],
  ['event-detail', '/events', /Thursday soup swap/],
  ['group-detail', '/groups', /Riverside Growers/],
  ['member-profile', '/members', /Grace/],
  // Each view's member has a different conversation partner; any will do.
  ['conversation', '/messages', /\S/],
];

/** Signed-out pages. */
const PUBLIC_PAGES: Array<[name: string, path: string]> = [
  ['home', ''],
  ['login', '/login'],
  ['register', '/register'],
];

async function prepare(page: Page, colourScheme: 'light' | 'dark'): Promise<void> {
  // No fixed clock: freezing time ahead of the sign-in ticket's expiry makes the
  // site discard the session. Relative times ("1 hr ago") and the greeting
  // change a few dozen pixels between runs, well inside maxDiffPixelRatio.
  // The member's own saved theme would otherwise win over the browser's.
  await page.addInitScript((theme) => {
    try {
      window.localStorage.setItem('nexus_theme', theme);
    } catch {
      /* storage blocked: the browser colour scheme still applies */
    }
  }, colourScheme);
}

/**
 * Waits until loading placeholders are gone and the page's text and height have
 * stopped changing for two seconds. Not `networkidle`: live updates, presence pings and
 * map tiles keep the network busy on several pages for ever.
 */
/** API calls that never stop on a live page (presence, realtime) and so never count as "loading". */
const BACKGROUND_API = /\/api\/v2\/(presence|realtime|notifications\/counts|messages\/unread-count)/;
const inFlight = new WeakMap<Page, Set<object>>();

function trackRequests(page: Page): Set<object> {
  let pending = inFlight.get(page);
  if (pending) return pending;
  const set = new Set<object>();
  page.on('request', (r) => { if (r.url().includes('/api/') && !BACKGROUND_API.test(r.url())) set.add(r); });
  const done = (r: object) => set.delete(r);
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  inFlight.set(page, set);
  pending = set;
  return pending;
}

async function waitUntilStill(page: Page): Promise<void> {
  const pending = trackRequests(page);
  await page.waitForLoadState('domcontentloaded');
  await page.locator('main, #main-content').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);
  const deadline = Date.now() + 25_000;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const busy = document.querySelectorAll(
        '[aria-busy="true"], .skeleton, [class*="animate-pulse"], [role="progressbar"][aria-label*="oading"]',
      ).length;
      return `${busy}|${document.body.innerText.length}|${document.documentElement.scrollHeight}`;
    });
    // A box that has not started loading shows no placeholder, so also wait
    // for the page's own data requests to finish.
    const quiet = pending.size === 0;
    if (snapshot !== last || !quiet) {
      last = snapshot;
      stableSince = Date.now();
    } else if (quiet && snapshot.startsWith('0|') && Date.now() - stableSince >= 2_000) {
      return;
    }
    await page.waitForTimeout(250);
  }
}

async function settle(page: Page): Promise<void> {
  await waitUntilStill(page);
  // Pictures fully loaded and fonts ready, so nothing pops in mid-shot.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images)
        .filter((img) => !img.complete)
        .map((img) => new Promise((resolve) => { img.onload = img.onerror = resolve; })),
    );
  });
  // Live widgets that change every run regardless of any visual change.
  await page.addStyleTag({
    content: `
      [data-visual-ignore], .leaflet-container, .gm-style, [aria-live="polite"][class*="online"] { visibility: hidden !important; }
      *, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }
    `,
  });
}

async function shoot(page: Page, name: string, signedIn = true): Promise<void> {
  await settle(page);
  // Floating pieces (phone tab bar that hides on scroll, help button, back to
  // top, toasts) land wherever the scroll stopped in a full-page picture.
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (getComputedStyle(el).position === 'fixed' && !el.closest('header, [role="banner"]')) {
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
    window.scrollTo(0, 0);
  });
  if (signedIn) {
    // A signed-out picture must never pass as a signed-in one.
    await expect(page.getByRole('banner').getByRole('link', { name: /^log in$/i }), 'still signed in').toHaveCount(0);
  }
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, timeout: 20_000 });
}

function scheme(projectName: string): 'light' | 'dark' {
  return projectName.endsWith('dark') ? 'dark' : 'light';
}

test.describe('signed in', () => {
  for (const [name, path] of FIXED_PAGES) {
    test(name, async ({ memberPage: page }) => {
      await visit(page, `/${SLUG}${path}`);
      await shoot(page, name);
    });
  }

  for (const [name, listPath, linkText] of DETAIL_PAGES) {
    test(name, async ({ memberPage: page }) => {
      await visit(page, `/${SLUG}${listPath}`);
      await waitUntilStill(page);
      const link = page.locator('main a[href]').filter({ hasText: linkText }).first();
      await expect(link).toBeVisible({ timeout: 20_000 });
      const href = await link.getAttribute('href');
      expect(href, `a link to ${name}`).toBeTruthy();
      await visit(page, href as string);
      await shoot(page, name);
    });
  }
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [name, path] of PUBLIC_PAGES) {
    test(name, async ({ page }, info) => {
      await prepare(page, scheme(info.project.name));
      // Accept only essential cookies before the page asks, so the banner never covers the picture.
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('nexus_cookie_consent', JSON.stringify({ essential: true, analytics: false, timestamp: new Date().toISOString() }));
        } catch {
          /* ignore */
        }
      });
      await page.goto(`/${SLUG}${path}`);
      await shoot(page, `public-${name}`, false);
    });
  }
});
