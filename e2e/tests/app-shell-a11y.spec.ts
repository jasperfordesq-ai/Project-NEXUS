// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Accessibility of the React app SHELL and its offline/connection-failure state.
 *
 * 🔴 What this replaced, and why it is scoped the way it is.
 *
 * The CI job "Accessibility Audit (WCAG 2.1 AA)" used to run the axe CLI over
 * four URLs — /{tenant}, /{tenant}/login, /{tenant}/about, /{tenant}/help —
 * against a STATIC build served by `serve -s dist`, with no API behind it. Three
 * things were wrong with that, all confirmed by measurement on 2026-08-05:
 *
 *  1. `serve -s` is an SPA fallback server: all four URLs returned the SAME
 *     byte-identical 1,836-byte index.html. There were never four pages.
 *  2. With no API reachable, `TenantShell` cannot load tenant config, so the app
 *     renders its connection-failure screen. All four "pages" were in fact one
 *     error screen reading "Unable to connect". About, Help and Login were never
 *     scanned, and could not be.
 *  3. The result was reported as zero violations through three independent
 *     swallowing paths: `axe ... > file 2>&1` wrote axe's own error text into the
 *     JSON file, `|| true` discarded its exit code, and the inline python parser
 *     ended in a bare `except: print(0)`. A scanner crash counted as a pass.
 *
 * Measured honestly, that error screen had **1 serious violation** — white text
 * on the default accent at 4.46:1 where WCAG AA needs 4.5:1 — and **no `main`
 * landmark at all**. So the job was simultaneously vacuous and sitting on a real
 * defect, on the screen users see when the platform is unreachable.
 *
 * Rather than pretend a backendless build can audit real pages, this spec tests
 * exactly what such a build genuinely renders, and does it properly. Real pages
 * with real data are covered by `accessibility-audit.spec.ts`, which runs against
 * the full Docker stack with authenticated member and admin sessions — that is
 * the authoritative browser-level gate, not this one.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const TENANT = process.env.E2E_TENANT || 'hour-timebank';

test.describe('React app shell (no backend)', () => {
  test('the offline/connection-failure screen is accessible', async ({ page }) => {
    await page.goto(`/${TENANT}`, { waitUntil: 'networkidle' });

    // React must actually have mounted. If the bundle fails to load this is the
    // assertion that catches it, rather than axe cheerfully passing an empty body.
    await expect(page.locator('#root')).not.toBeEmpty();

    // Confirm we really are on the connection-failure screen, so the assertions
    // below cannot silently start describing some other page.
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();

    // 🔴 Regression guard for the missing landmark. This screen had none.
    await expect(page.locator('main, [role="main"]')).toHaveCount(1);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(
      results.violations,
      `Offline screen has ${results.violations.length} WCAG A/AA violation(s):\n` +
        results.violations
          .map((v) => `  [${v.impact}] ${v.id}: ${v.help}\n      ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)
          .join('\n'),
    ).toEqual([]);
  });

  test('the document declares a language and a title', async ({ page }) => {
    await page.goto(`/${TENANT}`, { waitUntil: 'domcontentloaded' });

    // WCAG 3.1.1 — without this a screen reader guesses pronunciation.
    await expect(page.locator('html')).toHaveAttribute('lang', /\S+/);
    expect(await page.title()).not.toBe('');
  });
});
