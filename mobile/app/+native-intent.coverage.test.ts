// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The gate that would have caught the whole deep-link outage.
 *
 * 🔴 What went wrong. `app.json` registers an autoVerify intent filter for ALL of
 * `https://app.project-nexus.ie/*` with no `pathPrefix`, so Android hands this app
 * every URL on the platform. `mapSystemPathToNativeRoute` mapped only 27 sections and
 * returned `null` for the rest, `redirectSystemPath` passed the raw WEB path through,
 * Expo Router could not match it, and — with no `app/+not-found.tsx` — the member got
 * the framework's "Unmatched Route" screen. 169 of 254 member routes behaved that way,
 * including `/password/reset`, so a password-reset email opened on a device with the
 * app installed silently dropped its token.
 *
 * Why the existing `+native-intent.test.ts` did not catch it: every one of its cases
 * asserts a section that IS mapped. Nothing asserted what an unmapped *web* path does.
 * A suite that only exercises the paths you remembered cannot tell you which ones you
 * forgot — so this test derives its cases from `parity-map.json` instead of from a
 * hand-written list, and fails when a route exists on the web with a native screen but
 * no way to reach it.
 *
 * Contract: every route in parity-map.json must be exactly one of
 *   1. mapped to a native route, or
 *   2. deliberately declined as browser-only (`isBrowserOnlyPath`), or
 *   3. not a native screen at all (status gap / needs-review / out-of-scope).
 * Anything else is a member tapping a link and landing nowhere.
 */

import fs from 'node:fs';
import path from 'node:path';

import { isBrowserOnlyPath, mapSystemPathToNativeRoute } from './+native-intent';

const MOBILE_ROOT = path.resolve(__dirname, '..');

interface ParityEntry {
  route: string;
  status: string;
  mobile?: string;
}

function parityEntries(): ParityEntry[] {
  const doc = JSON.parse(
    fs.readFileSync(path.join(MOBILE_ROOT, 'parity-map.json'), 'utf8')
  ) as { routes: Record<string, string | { status: string; mobile?: string }> };

  return Object.entries(doc.routes).map(([route, value]) =>
    typeof value === 'string' ? { route, status: value } : { route, ...value }
  );
}

/**
 * Turn a parity-map pattern into a URL a phone could actually receive: `:id` style
 * segments get a plausible concrete value. The mapper must cope with real values, not
 * with the literal string ":id".
 */
function concreteUrl(routePattern: string): string {
  const filled = routePattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment;
      // Optional trailing segments (`:section?`) are legitimately absent.
      if (segment.endsWith('?')) return '';
      return /slug|tag/i.test(segment) ? 'example-slug' : '42';
    })
    .filter((segment) => segment !== '')
    .join('/');

  return `https://app.project-nexus.ie/${filled.replace(/^\//, '')}`;
}

describe('deep-link coverage against parity-map.json', () => {
  const entries = parityEntries();

  it('reads a non-trivial parity map, so this suite cannot pass vacuously', () => {
    expect(entries.length).toBeGreaterThan(200);
    expect(entries.filter((e) => e.status === 'native').length).toBeGreaterThan(100);
  });

  it('🔴 resolves every route that HAS a native screen', () => {
    // The core assertion. A `native` entry means the screen exists — so a link to it
    // must reach it, or the screen may as well not be there.
    const unreachable = entries
      .filter((entry) => entry.status === 'native')
      .filter((entry) => {
        const url = concreteUrl(entry.route);
        return mapSystemPathToNativeRoute(url) === null && !isBrowserOnlyPath(url);
      })
      .map((entry) => `  ${entry.route}  (native screen: ${entry.mobile ?? 'unnamed'})`);

    const OK = 'every native route is reachable by deep link';
    const actual = unreachable.length === 0
      ? OK
      : [
          'These web routes have a working native screen that NO deep link can reach.',
          'Android hands the app the URL, the mapper returns null, and the member gets',
          'the "Unmatched Route" screen. Add a case to mapSystemPathToNativeRoute, or',
          'declare the path browser-only:',
          ...unreachable,
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('never maps a browser-only path into the app', () => {
    // Staff consoles have no native equivalent, and the two callbacks are mid-handshake
    // redirects that must finish in the browser that started them. Swallowing either
    // strands the member holding a token the app cannot complete.
    for (const declined of [
      'https://app.project-nexus.ie/admin/users',
      'https://app.project-nexus.ie/broker/dashboard',
      'https://app.project-nexus.ie/super-admin/tenants',
      'https://app.project-nexus.ie/verify-identity/callback?status=ok',
      'https://app.project-nexus.ie/auth/oauth/callback?code=abc',
    ]) {
      expect(isBrowserOnlyPath(declined)).toBe(true);
    }
  });

  it('still declines a genuinely foreign host', () => {
    expect(mapSystemPathToNativeRoute('https://evil.example.com/marketplace/42')).toBeNull();
  });
});

describe('the routes this outage actually broke', () => {
  // Spelled out individually rather than left to the sweep above, because these are
  // the ones with a real member consequence and each deserves to fail by name.

  it('carries a password-reset token through to the reset screen', () => {
    const mapped = mapSystemPathToNativeRoute(
      'https://app.project-nexus.ie/password/reset?token=abc123&email=a%40b.com'
    );

    expect(mapped).toContain('/(auth)/reset-password');
    // The token is the entire point — without it the screen cannot do its job.
    expect(mapped).toContain('token=abc123');
  });

  it('reaches forgot-password', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/password/forgot'))
      .toBe('/(auth)/forgot-password');
  });

  it('reaches a marketplace listing, and its edit screen', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/42'))
      .toBe('/(modals)/marketplace-detail?id=42');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/42/edit'))
      .toBe('/(modals)/edit-marketplace-listing?id=42');
  });

  it('does NOT read a fixed marketplace sub-page as a listing id', () => {
    // Ordering bug this guards: `/marketplace/collections` must not become a listing
    // whose id is "collections".
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/collections'))
      .toBe('/(modals)/marketplace-collections');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/map'))
      .toBe('/(modals)/marketplace-map');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/orders/sales'))
      .toBe('/(modals)/marketplace-sales-orders');
  });

  it('distinguishes the two seller onboarding routes, which differ by one letter', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/seller/onboard'))
      .toBe('/(modals)/marketplace-seller-onboarding');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/marketplace/seller/onboarding'))
      .toBe('/(modals)/marketplace-stripe-onboarding');
  });

  it('reaches a job and its sub-screens', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/jobs/7'))
      .toBe('/(modals)/job-detail?id=7');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/jobs/7/kanban'))
      .toBe('/(modals)/job-pipeline?id=7');
  });

  it('treats a blog segment as a slug, not an id', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/blog/why-timebanking'))
      .toBe('/(modals)/blog-post?slug=why-timebanking');
  });

  it('reaches federation members and partners by id', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/federation/members/9'))
      .toBe('/(modals)/federation-member?id=9');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/federation/partners'))
      .toBe('/(modals)/federation-partners');
  });

  it('maps both spellings of a feed item to one screen', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/feed/posts/12'))
      .toBe('/(modals)/feed-item-detail?type=post&id=12');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/feed/item/exchange/12'))
      .toBe('/(modals)/feed-item-detail?type=exchange&id=12');
  });

  it('sends a linked-accounts message link to the settings screen, not a conversation', () => {
    // `can_view_messages` is NOT enforced server-side. The native app must not present
    // proxy message viewing as available until it is.
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/linked-accounts/5/messages/9'))
      .toContain('/(modals)/settings-linked-accounts');
  });

  it('sends /dashboard and /feed to the home tab', () => {
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/dashboard')).toBe('/(tabs)/home');
    expect(mapSystemPathToNativeRoute('https://app.project-nexus.ie/feed')).toBe('/(tabs)/home');
  });
});
