// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { test, expect, devices } from '@playwright/test';
import { testTenant, selectors } from '../helpers/fixtures';

/**
 * Responsive layout checks.
 *
 * 🔴 Read this before adding a case. On 2026-08-12 six of the nine tests in this
 * file were failing, and NONE of the failures were responsive-design bugs. They
 * were tests written against a DOM that does not exist:
 *
 *   - `[data-testid="navbar"], nav.navbar` matched nothing at any viewport.
 *   - `[data-testid="mobile-drawer"]` matched nothing; the drawer is `#mobile-drawer`.
 *   - `a[href*="/dashboard"]` matched nothing; the drawer navigates with buttons.
 *   - `devices['iPad Pro']` was removed from Playwright (1.59.1 has `iPad Pro 11`).
 *   - `/listings/new` is a 404; the create route is `/listings/create`.
 *   - `input[name="title"]` never matches — HeroUI/React Aria generate the `name`.
 *
 * A selector that matches nothing fails with "element(s) not found", which reads
 * exactly like a missing feature. Six of these sat here looking like real bugs.
 * **Verify a selector against the running app before you trust it** — and reach
 * for a structural `data-*` hook over a translated `aria-label` or a class name
 * you hope exists.
 *
 * These run signed in: `chromium-modern` supplies `storageState` from the
 * `setup` project. That matters more here than anywhere else in the suite,
 * because this app's mobile navigation is DIFFERENT for guests and members —
 * see the drawer tests below.
 */

/** iPhone 12: 390×664. The suite's standard phone. */
const PHONE = devices['iPhone 12'].viewport!;

/**
 * 🔴 `devices['iPad Pro']` no longer exists. Playwright renamed its iPad presets
 * and 1.59.1 ships `iPad Pro 11` (834×1194) plus `iPad Pro 11 landscape`
 * (1194×834). Reading `.viewport` off the missing entry threw a TypeError before
 * the browser was ever opened, so the tablet case had not run since the upgrade.
 * These two straddle the `lg` (1024px) breakpoint, which is the point of the
 * tablet test.
 */
const TABLET_PORTRAIT = devices['iPad Pro 11'].viewport!;
const TABLET_LANDSCAPE = devices['iPad Pro 11 landscape'].viewport!;

test.describe('Responsive Design', () => {
  /**
   * The mobile navigation drawer.
   *
   * 🔴 There are TWO ways to open it and which one exists depends on whether you
   * are signed in:
   *
   *   - GUEST  → the header hamburger (`Navbar.tsx`, rendered `{!isAuthenticated}`).
   *   - MEMBER → the bottom tab bar's last tab (`MobileTabBar.tsx`, members only).
   *
   * The old tests looked only for the hamburger, with
   * `button[aria-label*="menu"], button:has-text("Menu"), .mobile-menu-button`.
   * Signed in, that matched the user-menu avatar ("User menu for E2E") and the
   * tab bar's Menu tab — two elements, neither of them a hamburger — so the test
   * died on a strict-mode violation rather than on anything about drawers.
   *
   * Both openers are covered below, and each persona also asserts that the
   * OTHER one is absent. That is the actual contract, and it is the contract the
   * 768–1023px navigation blackout broke.
   */
  test.describe('mobile navigation drawer', () => {
    test('a signed-in member opens the drawer from the tab bar @smoke @critical', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(`/${testTenant.slug}`);

      const tabBarTrigger = page.locator(selectors.drawerTriggerMember);
      await expect(
        tabBarTrigger,
        'A signed-in member has no Menu tab. The bottom tab bar is a member\'s only '
          + 'way into the navigation drawer on a phone — the hamburger is guests-only.',
      ).toBeVisible({ timeout: 15000 });

      // The mirror image of the same contract: no hamburger while signed in.
      await expect(
        page.locator(selectors.drawerTriggerGuest),
        'The guests-only header hamburger rendered for a signed-in member. '
          + 'If that is intended, MobileTabBar.tsx\'s breakpoint note needs updating too.',
      ).toHaveCount(0);

      await tabBarTrigger.click();

      await expect(
        page.locator(selectors.mobileDrawer),
        'Tapping the Menu tab did not open the navigation drawer',
      ).toBeVisible({ timeout: 5000 });
    });

    test('a signed-in member navigates from the drawer @critical', async ({ page }) => {
      await page.setViewportSize(PHONE);
      await page.goto(`/${testTenant.slug}`);

      await page.locator(selectors.drawerTriggerMember).click();

      const drawer = page.locator(selectors.mobileDrawer);
      await expect(drawer).toBeVisible({ timeout: 5000 });

      // 🔴 Drawer destinations are BUTTONS that call navigate(), not anchors —
      // the old `${mobileDrawer} a:has-text("About")` could never have matched.
      // The drawer's only <a> elements are the logo and two external links.
      //
      // "Dashboard" is picked because it lives in the `main` accordion section,
      // which is the only one expanded by default (MobileDrawer.tsx:142). An item
      // in any other section is in the DOM but collapsed, so a test that clicked
      // one would fail for a reason that has nothing to do with navigation.
      const destination = drawer.getByRole('button', { name: 'Dashboard', exact: true });
      await expect(
        destination,
        'No visible Dashboard entry in the drawer\'s open "Main" section',
      ).toBeVisible({ timeout: 5000 });

      await destination.click();

      await expect(page).toHaveURL(new RegExp(`/${testTenant.slug}/dashboard/?$`));

      // Navigating must also dismiss the drawer, or the member lands on the new
      // page with the menu still covering it.
      await expect(
        drawer,
        'Navigated, but the drawer stayed open over the destination page',
      ).toBeHidden({ timeout: 5000 });
    });

    test.describe('signed out', () => {
      // A genuinely fresh browser: the hamburger only exists for guests, so the
      // project's member storageState would hide the very thing under test.
      test.use({ storageState: { cookies: [], origins: [] } });

      test('a guest opens the drawer from the header hamburger @smoke @critical', async ({ page }) => {
        await page.setViewportSize(PHONE);
        // Keep the dev-notice and cookie banners from covering the header.
        await page.addInitScript(() => {
          localStorage.setItem('dev_notice_dismissed', '2.1');
          localStorage.setItem(
            'nexus_cookie_consent',
            JSON.stringify({ essential: true, analytics: false, preferences: true, timestamp: new Date().toISOString() }),
          );
        });
        await page.goto(`/${testTenant.slug}`);

        const hamburger = page.locator(selectors.drawerTriggerGuest);
        await expect(
          hamburger,
          'A guest has no header hamburger, and guests never get the member tab bar — '
            + 'so a guest on a phone would have no navigation at all.',
        ).toBeVisible({ timeout: 15000 });

        await expect(
          page.locator(selectors.mobileTabBar),
          'The members-only bottom tab bar rendered for a guest',
        ).toHaveCount(0);

        await hamburger.click();

        await expect(
          page.locator(selectors.mobileDrawer),
          'Tapping the hamburger did not open the navigation drawer',
        ).toBeVisible({ timeout: 5000 });
      });
    });
  });

  test('should display forms correctly on mobile @critical', async ({ page }) => {
    await page.setViewportSize(PHONE);

    // Authentication comes from the project's storageState, as in the landscape
    // tests below. `loginAsUser` would work now that its /dashboard assumption is
    // fixed, but signing in through the form on every test adds a failure mode
    // that has nothing to do with responsive layout.
    //
    // 🔴 `/listings/new` is NOT the create route — it is matched by
    // `/listings/:id` and renders "Listing Not Found", which is why this test
    // used to find no form at all. The create route is `/listings/create`.
    await page.goto(`/${testTenant.slug}/listings/create`);

    await expect(page.locator('form')).toBeVisible({ timeout: 20000 });

    // 🔴 Fields are matched by their LABEL, not by `name`. HeroUI/React Aria
    // generate the `name` attribute (`react-aria5019373555-_r_6j_`), so
    // `input[name="title"]` never matched and never could. Label text is English
    // here because the whole E2E suite runs in English — the same assumption
    // e2e/tests/ui/dropdowns.spec.ts makes.
    //
    // The trailing `\*?` is not decoration: these are required fields and the
    // asterisk is part of the accessible name ("Title*"), so an `exact: 'Title'`
    // match finds nothing.
    await expect(page.getByRole('textbox', { name: /^Title\s*\*?$/ })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Description\s*\*?$/ })).toBeVisible();

    const submit = page.locator(selectors.submitButton);
    await expect(submit).toBeVisible();

    // "Correctly on mobile" has to mean more than "the elements exist". A form
    // wider than the phone is the classic mobile break, and it is invisible to
    // any presence-only assertion.
    //
    // 🔴 Measure the FORM, not just the document's scroll width. An ancestor of
    // this page clips horizontally, so a form forced to 900px wide left
    // `document.documentElement.scrollWidth` sitting at 390 — the page did not
    // scroll, it just cut the form off, which is the worse outcome and the one a
    // scroll-width-only check waves through. Both are asserted below.
    const measurements = await page.evaluate(() => {
      const form = document.querySelector('form');
      const r = form?.getBoundingClientRect();
      return {
        formWidth: r ? Math.round(r.width) : null,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      };
    });

    expect(measurements.formWidth, 'no form to measure').not.toBeNull();
    expect(
      measurements.formWidth!,
      `The create-listing form is ${measurements.formWidth}px wide on a ${PHONE.width}px phone — `
        + 'it is either cut off or scrolling sideways. Something in it is not shrinking.',
    ).toBeLessThanOrEqual(measurements.innerWidth);

    expect(
      measurements.scrollWidth,
      `The create-listing page scrolls sideways on a ${PHONE.width}px phone `
        + `(content is ${measurements.scrollWidth}px wide).`,
    ).toBeLessThanOrEqual(measurements.innerWidth + 1);
  });

  test('should display cards in grid on mobile @regression', async ({ page }) => {
    await page.setViewportSize(PHONE);

    await page.goto(`/${testTenant.slug}/listings`);

    // 🔴 Needs listings to exist for the test tenant. If this times out, check
    // the fixture data before suspecting the layout.
    const cards = page.locator(selectors.listingCard);
    await expect(
      cards.first(),
      'No listing cards rendered. Either the tenant has no listings, or ListingCard '
        + 'lost its data-testid="listing-card" hook.',
    ).toBeVisible({ timeout: 15000 });

    const cardCount = await cards.count();
    const boxes = [];
    for (let i = 0; i < cardCount; i++) {
      boxes.push(await cards.nth(i).boundingBox());
    }

    // Cards should fill the phone width...
    const first = boxes[0];
    expect(first, 'first listing card has no box').not.toBeNull();
    expect(
      first!.width,
      `A listing card is only ${Math.round(first!.width)}px wide on a ${PHONE.width}px phone`,
    ).toBeGreaterThan(300);

    // ...and stack in a single column, which is what "grid on mobile" means
    // here. Same left edge for every card is the real test; a width threshold
    // alone would pass a two-column layout of wide cards.
    const lefts = boxes.filter(Boolean).map((b) => Math.round(b!.x));
    expect(
      new Set(lefts).size,
      `Listing cards are not in a single column on mobile — left edges: ${lefts.join(', ')}`,
    ).toBe(1);
  });

  test('should display navbar correctly on tablet @regression', async ({ page }) => {
    // 🔴 A tablet straddles the `lg` (1024px) breakpoint, and the two navigations
    // are exact complements: Navbar's desktop nav is `hidden lg:flex`, MobileTabBar
    // is `lg:hidden`. Portrait (834px) is below it, landscape (1194px) above.
    // Checking both orientations is what makes this a breakpoint test rather than
    // a restatement of the phone cases.
    await page.setViewportSize(TABLET_PORTRAIT);
    await page.goto(`/${testTenant.slug}`);

    await expect(page.locator(selectors.siteHeader)).toBeVisible({ timeout: 15000 });

    // Portrait, 834px — below `lg`, so the tab bar carries navigation.
    await expect(
      page.locator(selectors.mobileTabBar),
      `At ${TABLET_PORTRAIT.width}px (below the 1024px lg breakpoint) a signed-in member `
        + 'has no tab bar. That is the navigation blackout — see the phone-landscape tests below.',
    ).toBeVisible({ timeout: 15000 });
    await expect(
      page.locator(selectors.desktopNav),
      `The desktop nav is showing at ${TABLET_PORTRAIT.width}px; it is meant to start at 1024px`,
    ).toBeHidden();

    // Landscape, 1194px — at/above `lg`, so the desktop nav takes over.
    await page.setViewportSize(TABLET_LANDSCAPE);
    await page.waitForTimeout(500);

    const desktopNav = page.locator(selectors.desktopNav);
    await expect(
      desktopNav,
      `The desktop nav is missing at ${TABLET_LANDSCAPE.width}px, above the 1024px breakpoint`,
    ).toBeVisible({ timeout: 10000 });

    // Real destinations, not just a container. The old assertion looked for
    // `a[href*="/dashboard"]` inside the navbar; there is no /dashboard link
    // anywhere in this app's header, so it could only ever fail.
    await expect(
      desktopNav.locator('a[href]').first(),
      'The desktop nav rendered but contains no navigation links',
    ).toBeVisible();

    await expect(
      page.locator(selectors.mobileTabBar),
      `Both navigations are visible at ${TABLET_LANDSCAPE.width}px — they are supposed to be `
        + 'exact complements, so this means the breakpoints have drifted apart.',
    ).toBeHidden();
  });

  test('should handle orientation change @regression', async ({ page }) => {
    // Start in portrait
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/${testTenant.slug}`);

    // A signed-in member's way into the menu is the tab bar, not a hamburger.
    await expect(page.locator(selectors.drawerTriggerMember)).toBeVisible({ timeout: 15000 });

    // Switch to landscape.
    //
    // 🔴 667×375 is a SMALL-phone landscape and sits BELOW the 768px breakpoint,
    // so it cannot reach the dead band this suite's own landscape bug lived in.
    // It is kept because rotating a small phone is still worth covering, but it
    // must not be mistaken for landscape coverage — that is
    // 'signed-in member keeps primary navigation in phone landscape' below,
    // which tests 844×390 and 932×430 inside the band.
    await page.setViewportSize({ width: 667, height: 375 });

    // Wait for layout to adjust
    await page.waitForTimeout(500);

    // Navigation must survive the rotation. Both of these are what the member
    // actually has at 667px: the header, and the tab bar under it.
    await expect(page.locator(selectors.siteHeader)).toBeVisible();
    await expect(
      page.locator(selectors.mobileTabBar),
      'Rotating to landscape left a signed-in member with no bottom navigation',
    ).toBeVisible();
    await expect(page.locator(selectors.drawerTriggerMember)).toBeVisible();
  });

  /**
   * 🔴 The landscape navigation blackout, pinned at the widths where it happened.
   *
   * Reported by James Ryan (TBUK) on 2026-07-14: the bottom bar "sometimes
   * overlaps or obscures content ... so when completing a form, the navigation
   * bar can cover the Submit, Continue, or other action button", and it was worse
   * in landscape. He was still carrying it in his 2026-08-10 assessment as
   * NFR-02, "bottom navigation can misalign and cover submit controls".
   *
   * Root cause (fixed in b27d6eedc): the bottom tab bar hid at >=768px while the
   * desktop nav only appears at >=1024px, and the hamburger is guests-only — so a
   * SIGNED-IN member between those widths had no primary navigation at all. A
   * phone in landscape is 844–932px, squarely inside that band.
   *
   * The fix is now "by construction" — `MobileTabBar` uses `lg:hidden` as the
   * exact complement of `Navbar`'s `hidden lg:flex`. This test exists because an
   * argument is not a regression test, and because nothing else in the suite
   * covers these widths: the case above stops at 667px.
   *
   * Must be signed in. The bar does not render for guests, so an anonymous test
   * would pass while proving nothing.
   */
  const PHONE_LANDSCAPE = [
    { label: 'iPhone 14 landscape', width: 844, height: 390 },
    { label: 'iPhone 14 Pro Max landscape', width: 932, height: 430 },
  ];

  for (const { label, width, height } of PHONE_LANDSCAPE) {
    test(`signed-in member keeps primary navigation in phone landscape — ${label} @regression`, async ({ page }) => {
      await page.setViewportSize({ width, height });

      // Authentication comes from the project's `storageState` (the `setup`
      // dependency), not from logging in here — signing in through the form on
      // every test adds a failure mode unrelated to responsive layout.

      // Somewhere with a form and a submit control at the foot of the page.
      await page.goto(`/${testTenant.slug}/listings/create`);
      await page.waitForLoadState('domcontentloaded');

      // 1. Primary navigation must exist. Between 768 and 1023px this is the
      //    tab bar's job: the desktop nav is still hidden and the hamburger is
      //    guests-only. Either the bar or a visible desktop nav is acceptable —
      //    what is NOT acceptable is neither, which is the bug.
      //
      // 🔴 Both are matched by structural `data-*` hooks. `desktopNav` used to be
      // `selectors.navbar` (`[data-testid="navbar"], nav.navbar`), which matched
      // NOTHING — so this `.or()` had only one live branch and the test would not
      // have noticed the desktop nav appearing early.
      const tabBar = page.locator(selectors.mobileTabBar).first();

      // 🔴 Assert on the first VISIBLE member of the union — NOT on
      // `tabBar.or(desktopNav).first()`, which is what this was until 2026-08-12.
      // `.or()` is a union and `.first()` takes DOCUMENT ORDER, so it returned
      // the desktop nav: an element that is in the DOM at every width and merely
      // `hidden` below 1024px. The assertion would have reported "no navigation"
      // with the tab bar sitting there perfectly visible.
      //
      // That bug could not bite while `selectors.navbar` matched nothing — the
      // union had one live branch, so `.first()` had nothing to get wrong. The
      // moment the selector was repaired, both landscape tests went red. A dead
      // selector had been holding a broken assertion upright.
      const primaryNav = page
        .locator(`${selectors.mobileTabBar}, ${selectors.desktopNav}`)
        .filter({ visible: true });

      // 🔴 Auto-waiting assertion, not an instant `isVisible()`. Under Vite dev
      // the SPA has not rendered by `domcontentloaded`, so an instant check
      // reports "no navigation" and manufactures exactly the failure this test
      // is supposed to detect.
      await expect(
        primaryNav.first(),
        `${label} (${width}×${height}): a signed-in member had NO primary navigation — `
          + 'this is the 768–1023px blackout. Check that MobileTabBar\'s lg:hidden '
          + 'is still the exact complement of Navbar\'s hidden lg:flex.',
      ).toBeVisible({ timeout: 30000 });

      const hasTabBar = await tabBar.isVisible().catch(() => false);

      // 2. The submit control must be reachable and not sitting underneath the
      //    tab bar. That was the actual complaint: navigation covering Submit.
      const submit = page.locator('button[type="submit"]').first();
      if (await submit.count()) {
        await submit.scrollIntoViewIfNeeded();
        await expect(submit).toBeVisible();

        const submitBox = await submit.boundingBox();
        expect(submitBox, 'submit control has no box').not.toBeNull();

        if (submitBox && hasTabBar) {
          const barBox = await tabBar.boundingBox();
          if (barBox) {
            // Overlap on the vertical axis means the bar is over the button.
            const submitBottom = submitBox.y + submitBox.height;
            const overlap = submitBottom > barBox.y && submitBox.y < barBox.y + barBox.height;
            expect(
              overlap,
              `${label}: the bottom navigation overlaps the submit control `
                + `(submit ${Math.round(submitBox.y)}–${Math.round(submitBottom)}, `
                + `bar starts ${Math.round(barBox.y)}). The tab bar's spacer should `
                + 'reserve its own height plus the safe-area inset.',
            ).toBe(false);
          }
        }
      }
    });
  }

  test('should display modals correctly on mobile @regression', async ({ page }) => {
    await page.setViewportSize(PHONE);

    // Signed in via the project's storageState.
    await page.goto(`/${testTenant.slug}/listings`);

    // 🔴 This used to look for a Delete button and wrap everything in
    // `if (await deleteButton.isVisible())`. There is no Delete button on the
    // listings index, so the body never ran and the test passed having asserted
    // nothing — a silent skip wearing a green tick. The tab bar's Create button
    // opens QuickCreateMenu, a modal that is always there for a signed-in member
    // on a phone, so this can be unconditional.
    const createTab = page.locator(selectors.mobileTabBarCreate);
    await expect(createTab).toBeVisible({ timeout: 15000 });
    await createTab.click();

    const modal = page.locator(selectors.modal).filter({ visible: true }).first();
    await expect(modal, 'The Create button did not open a modal').toBeVisible({ timeout: 5000 });

    // "Correctly on mobile" means it fits the phone, not just that it exists.
    //
    // 🔴 Polled, not measured once. The modal animates in, and a single
    // `boundingBox()` taken the instant it becomes visible catches it mid
    // transition — 407px on a 390px screen, which reads as a layout bug and is
    // not one. Poll until it settles; if it never settles inside the viewport,
    // that IS the bug and this still fails.
    await expect
      .poll(
        async () => {
          const b = await modal.boundingBox();
          return b ? Math.round(b.width) : null;
        },
        { message: `The modal never settled inside a ${PHONE.width}px phone screen`, timeout: 5000 },
      )
      .toBeLessThanOrEqual(PHONE.width);

    await expect
      .poll(
        async () => {
          const b = await modal.boundingBox();
          return b ? Math.round(b.x) : null;
        },
        { message: 'The modal settled off the left edge of the screen', timeout: 5000 },
      )
      .toBeGreaterThanOrEqual(0);

    // The page itself must not gain a sideways scroll because of the modal.
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      scroll.scrollWidth,
      `The open modal pushed the page ${scroll.scrollWidth - scroll.innerWidth}px wider than the screen`,
    ).toBeLessThanOrEqual(scroll.innerWidth + 1);

    // Its actions have to be reachable, which is the part that breaks on small
    // screens — a modal taller than the viewport hides its own buttons.
    const firstAction = modal.getByRole('button').first();
    await expect(firstAction, 'The modal opened with no reachable action').toBeVisible();

    // And it must be dismissible without a mouse.
    await page.keyboard.press('Escape');
    await expect(modal, 'The modal did not close on Escape').toBeHidden({ timeout: 5000 });
  });

  test('should render touch-friendly buttons on mobile @smoke', async ({ page }) => {
    await page.setViewportSize(PHONE);

    await page.goto(`/${testTenant.slug}/listings`);
    await expect(page.locator(selectors.mobileTabBar)).toBeVisible({ timeout: 15000 });

    // 🔴 Wait for the CONTENT, not just the chrome. Listings arrive from the API
    // after first paint, and measuring before they land covers only the header
    // and tab bar — whose targets are all comfortably large. A deliberately
    // shrunk 16×16 button inside a listing card went undetected exactly this way
    // while the test reported green.
    await expect(page.locator(selectors.listingCard).first()).toBeVisible({ timeout: 15000 });

    // 🔴 This used to measure `buttons.first()` inside an `if (isVisible)`. The
    // first button in the DOM is "Switch community", which is hidden — so the
    // condition was false, nothing was measured, and the test passed. It is now
    // unconditional and covers EVERY visible button on the page.
    //
    // The floor is WCAG 2.2 SC 2.5.8 Target Size (Minimum), 24×24 CSS px. It is
    // deliberately the AA floor and not the 44×44 of SC 2.5.5 (AAA): several
    // header and card icon buttons are currently 36px, so a 44px assertion here
    // would be a standing red for a known, separate piece of work rather than a
    // regression guard.
    const measured = await page.evaluate(() => {
      const MIN = 24;

      // 🔴 Screen-reader-only controls are not pointer targets and must not be
      // measured. React Aria wraps its overlay `DismissButton` in
      // `VisuallyHidden`, which renders a 1×1 button labelled "Dismiss" clipped
      // to nothing. It appears and disappears with whatever overlay is mounted,
      // so counting it would make this test fail at random.
      //
      // The clip is applied to a WRAPPER, not to the button, so this walks
      // ancestors. It deliberately keys on the visually-hidden signature rather
      // than on size — a genuinely tiny, genuinely visible control still fails.
      const isVisuallyHidden = (el: Element): boolean => {
        let node: Element | null = el;
        while (node && node !== document.body) {
          const cs = getComputedStyle(node as HTMLElement);
          if (cs.clip !== 'auto' || cs.clipPath !== 'none' || cs.opacity === '0') return true;
          node = node.parentElement;
        }
        return false;
      };

      const tooSmall: { name: string; w: number; h: number }[] = [];
      let visible = 0;
      for (const el of Array.from(document.querySelectorAll('button, a.button'))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (isVisuallyHidden(el)) continue;
        visible++;
        if (r.width < MIN || r.height < MIN) {
          tooSmall.push({
            name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
      }
      return { visible, tooSmall };
    });

    expect(measured.visible, 'No visible buttons on the listings page to measure').toBeGreaterThan(0);
    expect(
      measured.tooSmall,
      `Touch targets below the WCAG 2.2 AA minimum of 24×24px: ${
        measured.tooSmall.map((b) => `"${b.name}" ${b.w}×${b.h}`).join(', ')}`,
    ).toEqual([]);
  });
});
