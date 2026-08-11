// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect } from '@playwright/test';
import {
  goToTenantPage,
  waitForPageLoad,
  dismissBlockingModals,
} from '../../helpers/test-utils';

/**
 * Dropdowns must actually drop down — in every engine.
 *
 * 🔴 Why this file exists. A Mac user reported on 2026-08-09 that "the drop
 * downs don't drop down consistently" in Safari, and there was no check anywhere
 * that could have caught it: desktop Safari had no Playwright project at all,
 * and the only WebKit project (`mobile-safari`) sits in the `e2e-cross-browser`
 * job, which is skipped whenever the E2E secrets are absent — while the workflow
 * still reports success. Safari's engine had therefore never run.
 *
 * These are tagged @smoke and run in BOTH `chromium-modern` and `webkit-modern`
 * so the two engines are compared on every push.
 *
 * 🔴 What "open" means here, and why it is not `role=menuitem`. The header menus
 * are HeroUI popovers containing LINKS, not menu items — an early version of this
 * check looked only for `[role="menuitem"]` / `[role="option"]` and reported the
 * Community and More menus as broken in *both* engines when they were fine. Assert
 * on the trigger's `aria-expanded` plus a visible popover, which is true for both
 * the listbox-style and the link-list-style menus.
 */

/** Every attempt matters: the reported symptom was "inconsistent", not "broken". */
const ATTEMPTS = 3;

/**
 * 🔴 Pin a desktop viewport. `devices['Desktop Safari']` defaults to 1280x720,
 * and the header collapses its menus into the mobile drawer below the desktop
 * breakpoint — so every one of these tests SKIPPED on the webkit project while
 * reporting a green run. A skipped test proves nothing, which is the exact
 * failure mode that let a Safari bug reach a user unnoticed.
 */
test.use({ viewport: { width: 1440, height: 950 } });

async function openAndAssert(
  page: import('@playwright/test').Page,
  trigger: import('@playwright/test').Locator,
  label: string,
): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    await trigger.click();

    await expect(trigger, `${label} did not report itself open (attempt ${attempt})`).toHaveAttribute(
      'aria-expanded',
      'true',
      { timeout: 8000 },
    );

    // Something the user can actually see and click.
    const popover = page
      .locator('[role="dialog"], [role="menu"], [role="listbox"]')
      .filter({ visible: true });
    await expect(
      popover.first(),
      `${label} reported open but nothing visible appeared (attempt ${attempt})`,
    ).toBeVisible({ timeout: 8000 });

    // Move the pointer off the trigger before closing. Left where it is, the
    // button keeps `data-hovered`/`data-pressed` and a rapid reopen races the
    // close animation — which fails the NEXT attempt for reasons that have
    // nothing to do with the browser. Observed in Chromium, not WebKit.
    await page.mouse.move(0, 0);
    await page.keyboard.press('Escape');

    await expect(trigger, `${label} did not close on Escape (attempt ${attempt})`).toHaveAttribute(
      'aria-expanded',
      'false',
      { timeout: 8000 },
    );

    // Wait for it to be really gone, not merely marked closed, so the next
    // attempt starts from a settled state.
    await expect(
      page.locator('[role="dialog"], [role="menu"], [role="listbox"]').filter({ visible: true }),
      `${label} stayed on screen after closing (attempt ${attempt})`,
    ).toHaveCount(0, { timeout: 8000 });

    // 🔴 And wait for the trigger's own transient state to clear. React Aria
    // leaves `data-pressed` set for a beat after the close, and a click that
    // lands in that window is swallowed — so the NEXT attempt reports "did not
    // open" when the menu is fine. Reproduced in Chromium (2 of 3 runs), never
    // in WebKit; without this wait the gate would be flaky, which is worse than
    // having no gate at all.
    await expect(trigger).not.toHaveAttribute('data-pressed', 'true', { timeout: 8000 });
  }
}

/** First VISIBLE match. The header renders desktop AND mobile copies. */
function firstVisible(locator: import('@playwright/test').Locator) {
  return locator.filter({ visible: true }).first();
}

test.describe('Header dropdowns open reliably @smoke', () => {
  test.beforeEach(async ({ page }) => {
    await goToTenantPage(page, '/feed');
    await waitForPageLoad(page);
    await dismissBlockingModals(page);
  });

  test('the language menu opens, shows options, and closes', async ({ page }) => {
    const trigger = firstVisible(page.getByRole('button', { name: /Language/i }));

    // Deliberately NOT test.skip: a missing trigger means either the header did
    // not render or we are not signed in, both of which are real failures.
    await expect(
      trigger,
      'No visible language switcher — header did not render, or the run is unauthenticated',
    ).toBeVisible({ timeout: 15000 });

    await openAndAssert(page, trigger, 'language menu');

    // Options must be reachable, not just a popover frame. The language list is
    // a radio group, not a listbox — accept any of the selectable roles rather
    // than assuming one, so this asserts "the user can pick a language" instead
    // of pinning an implementation detail.
    await trigger.click();
    const choices = page
      .locator('[role="option"], [role="radio"], [role="menuitemradio"], [role="menuitem"]')
      .filter({ visible: true });
    await expect(
      choices.first(),
      'Language menu opened but offered nothing selectable',
    ).toBeVisible({ timeout: 8000 });
    expect(await choices.count(), 'Expected several languages to choose from').toBeGreaterThan(1);
  });

  test('the Timebanking navigation menu opens and closes', async ({ page }) => {
    const trigger = firstVisible(page.getByRole('button', { name: /^Timebanking$/i }));

    await expect(
      trigger,
      'No visible Timebanking menu — header did not render, or the run is unauthenticated',
    ).toBeVisible({ timeout: 15000 });

    await openAndAssert(page, trigger, 'Timebanking menu');
  });

  test('no uncaught page errors while opening menus', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    for (const name of [/Language/i, /^Timebanking$/i, /^Community$/i, /^More$/i]) {
      const trigger = firstVisible(page.getByRole('button', { name }));
      if ((await trigger.count()) === 0) continue;
      await trigger.click();
      await page.waitForTimeout(600);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    expect(errors, `Opening menus threw: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
