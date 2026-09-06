// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every option on the "+" Create menu must open a screen that exists inside this app.
 *
 * 🔴 Why a SOURCE-level test, when `quick-create.test.tsx` already presses each option.
 * That test asserts the route string the app navigates to; it cannot tell whether a
 * screen answers at the other end. Expo Router renders an unmatched route as the
 * not-found screen rather than throwing, so a typo'd or deleted destination looks
 * exactly like a working one in a render test and shows up only on a device.
 *
 * The history this guards, in two steps:
 *   1. 2026-09-04 — courses and podcasts were missing from the menu entirely, on a
 *      community that had both switched on, so both features looked non-existent.
 *   2. 2026-09-06 — they were added, but as links that opened the WEBSITE, because
 *      `parity-map.json` recorded both authoring surfaces as out-of-scope. The owner
 *      reported that a Create menu that leaves the app reads as a broken app.
 *
 * So this asserts both halves at once: no option escapes to a browser, and every
 * option's destination is a real screen file on disk.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(__dirname);
const QUICK_CREATE = path.join(APP_DIR, '(modals)', 'quick-create.tsx');

function source(): string {
  return fs.readFileSync(QUICK_CREATE, 'utf8');
}

/** Every `route:` literal declared in QUICK_CREATE_OPTIONS. */
function declaredRoutes(): string[] {
  return [...source().matchAll(/^\s*route:\s*'([^']+)'/gm)].map((m) => m[1]!);
}

/** Resolve a route to the screen file that would serve it, ignoring any query string. */
function screenFileFor(route: string): string | null {
  const pathOnly = route.split('?')[0]!;
  const withoutLeadingSlash = pathOnly.replace(/^\//, '');
  const candidate = path.join(APP_DIR, `${withoutLeadingSlash}.tsx`);
  if (fs.existsSync(candidate)) return candidate;
  const asIndex = path.join(APP_DIR, withoutLeadingSlash, 'index.tsx');
  return fs.existsSync(asIndex) ? asIndex : null;
}

describe('quick-create destinations', () => {
  it('declares at least the options the audits added, so an empty match cannot pass', () => {
    // A regex that silently matched nothing would make every assertion below vacuous.
    expect(declaredRoutes().length).toBeGreaterThanOrEqual(14);
  });

  it('🔴 opens a real in-app screen for every option', () => {
    const missing = declaredRoutes().filter((route) => screenFileFor(route) === null);

    expect(missing).toEqual([]);
  });

  it('🔴 never hands the member to a browser', () => {
    // Comments are stripped first: this file deliberately RECORDS the removed
    // `opensOnWebsite` mechanism in prose, and a naive substring search would match
    // that explanation and fail forever.
    const src = source()
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    // The hand-off mechanism removed on 2026-09-06, and the two ways back to it.
    expect(src).not.toContain('opensOnWebsite');
    expect(src).not.toMatch(/Linking/);
    expect(src).not.toContain('buildWebUrl');

    // Every route is an in-app path, never an absolute URL.
    declaredRoutes().forEach((route) => {
      expect(route.startsWith('/')).toBe(true);
      expect(route).not.toMatch(/^https?:/);
    });
  });

  it('routes the two builders the owner reported to their native screens', () => {
    const routes = declaredRoutes();

    expect(routes).toContain('/(modals)/new-course');
    expect(routes).toContain('/(modals)/podcast-studio');
  });
});
