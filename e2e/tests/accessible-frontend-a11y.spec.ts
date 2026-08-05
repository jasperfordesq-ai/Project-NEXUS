// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WCAG 2.1 A/AA scan of the accessible (GOV.UK) frontend.
 *
 * 🔴 Read e2e/helpers/accessible-auth.ts before changing the path lists.
 *
 * Two defects were fixed here on 2026-08-05, both of which made this suite
 * report green while covering less than it claimed:
 *
 *  1. It never logged in. Six paths are auth-gated and answered 302 to the
 *     login page. `page.goto()` follows redirects, and the login page satisfies
 *     every structural assertion below (main region, h1, skip link, phase
 *     banner), so axe scanned /login six times and the member pages were never
 *     looked at. Member pages now run with a real session AND assert they were
 *     not bounced — a structural assertion is not proof of which page you are
 *     on.
 *  2. It discarded `moderate` violations. Heading order, landmark structure and
 *     labelling defects are routinely rated moderate, and those are precisely
 *     the things a screen-reader user navigates by. Moderate now fails.
 *
 * `minor` is reported but does not fail, so the remaining gap is visible in the
 * log rather than invisible. If you tighten that, tighten it deliberately.
 */

import AxeBuilder from '@axe-core/playwright';
import type { Result } from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import {
  ALPHA_AUTH_FILE,
  ALPHA_MEMBER_PAGES,
  ALPHA_PUBLIC_PAGES,
  isLoginUrl,
} from '../helpers/accessible-auth';

/** Impacts that fail the build. `minor` is logged only — see the header note. */
const FAILING_IMPACTS = new Set(['critical', 'serious', 'moderate']);

function summarise(violations: Result[]): string {
  return violations
    .map((v) => {
      const targets = v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(' '))
        .join(' | ');
      return `  [${v.impact}] ${v.id}: ${v.help}\n      ${targets}`;
    })
    .join('\n');
}

/** Structural checks every accessible-frontend page must satisfy. */
async function assertPageShell(page: Page): Promise<void> {
  await expect(page.locator('main#main-content')).toBeVisible();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.locator('.govuk-skip-link')).toHaveAttribute('href', '#main-content');
  await expect(page.locator('.govuk-phase-banner')).toBeVisible();
}

async function scanForViolations(page: Page, path: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const failing = results.violations.filter(
    (v) => v.impact !== null && v.impact !== undefined && FAILING_IMPACTS.has(v.impact),
  );
  const minor = results.violations.filter((v) => v.impact === 'minor');

  if (minor.length > 0) {
    console.log(`ℹ ${path} — ${minor.length} minor violation(s), not failing:\n${summarise(minor)}`);
  }

  expect(
    failing,
    failing.length === 0
      ? ''
      : `${path} has ${failing.length} WCAG 2.1 AA violation(s) at moderate or above:\n${summarise(failing)}`,
  ).toEqual([]);
}

test.describe('Accessible frontend — public pages', () => {
  for (const path of ALPHA_PUBLIC_PAGES) {
    test(`public: ${path}`, async ({ page }) => {
      await page.goto(path);
      await assertPageShell(page);
      await scanForViolations(page, path);
    });
  }
});

test.describe('Accessible frontend — member pages', () => {
  test.use({ storageState: ALPHA_AUTH_FILE });

  for (const path of ALPHA_MEMBER_PAGES) {
    test(`member: ${path}`, async ({ page }) => {
      await page.goto(path);

      // 🔴 The guard that stops this whole class of bug returning. Without it
      // an auth regression silently turns every case below into a second scan
      // of the login page, and the suite stays green.
      expect(
        isLoginUrl(page.url()),
        `Bounced to login while scanning ${path} — the member session is not working, ` +
          'so this page was NOT scanned. Fix the session; do not relax this assertion.',
      ).toBe(false);

      await assertPageShell(page);
      await scanForViolations(page, path);
    });
  }
});
