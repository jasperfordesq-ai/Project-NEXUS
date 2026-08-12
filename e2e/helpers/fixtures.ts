// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { expect } from '@playwright/test';

/**
 * Test user credentials and data
 */
/**
 * 🔴 `E2E_USER_EMAIL` is the fallback for a reason — read this before changing it.
 *
 * `primary` read ONLY `E2E_TEST_USER_EMAIL` / `E2E_TEST_USER_PASSWORD` until
 * 2026-08-12. Nothing sets those names: not `e2e/global.setup.ts`, not
 * `e2e/helpers/accessible-auth.ts`, not `admin/groups-admin.spec.ts`, and not any
 * of the six places CI supplies credentials (`.github/workflows/ci.yml`,
 * `e2e-tests.yml`) — every one of them uses `E2E_USER_EMAIL`. So `primary`
 * always fell through to the hardcoded `e2e-test@example.com`, which is not a
 * real account on any environment.
 *
 * The consequence was not subtle: every spec whose `beforeEach` calls
 * `loginAsUser(testUsers.primary…)` failed at the login step. All 8 tests in
 * `messages.spec.ts` died in `beforeEach` with a `waitForURL` timeout, having
 * never reached a single assertion — which is easily mistaken for the messaging
 * feature being broken.
 *
 * The `E2E_TEST_USER_*` names are still honoured and still win, so anything that
 * does set them is unaffected; the added fallback only changes the case that was
 * previously guaranteed to fail.
 */
export const testUsers = {
  primary: {
    email: process.env.E2E_TEST_USER_EMAIL || process.env.E2E_USER_EMAIL || 'e2e-test@example.com',
    password: process.env.E2E_TEST_USER_PASSWORD || process.env.E2E_USER_PASSWORD || 'TestPass123!',
    firstName: process.env.E2E_TEST_USER_FIRSTNAME || 'E2E',
    lastName: process.env.E2E_TEST_USER_LASTNAME || 'Tester',
  },
  secondary: {
    email: process.env.E2E_SECOND_USER_EMAIL || 'e2e-test-2@example.com',
    password: process.env.E2E_SECOND_USER_PASSWORD || 'TestPass456!',
    firstName: 'Second',
    lastName: 'Tester',
  },
};

/**
 * Test tenant configuration
 */
export const testTenant = {
  slug: process.env.E2E_TENANT_SLUG || 'hour-timebank',
  id: parseInt(process.env.E2E_TENANT_ID || '2', 10),
};

/**
 * Generate random test data
 */
export function generateTestData() {
  const timestamp = Date.now();
  const randomId = Math.random().toString(36).substring(7);

  return {
    listing: {
      title: `E2E Test Listing ${timestamp}`,
      description: `This is a test listing created by E2E tests at ${new Date().toISOString()}`,
      category: 'Skills & Trades',
      type: 'offer',
      duration: 60,
      location: 'Test Location',
    },
    message: {
      subject: `E2E Test Message ${timestamp}`,
      content: `This is a test message sent at ${new Date().toISOString()}`,
    },
    event: {
      title: `E2E Test Event ${timestamp}`,
      description: `Test event created at ${new Date().toISOString()}`,
      location: 'Test Venue',
      startDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
      endDate: new Date(Date.now() + 90000000).toISOString(), // Tomorrow + 1 hour
    },
    group: {
      name: `E2E Test Group ${timestamp}`,
      description: `Test group created at ${new Date().toISOString()}`,
      privacy: 'public',
    },
    user: {
      email: `e2e-${randomId}@example.com`,
      password: `TestPass${randomId}!`,
      firstName: 'Test',
      lastName: `User-${randomId}`,
    },
  };
}

/**
 * Common selectors for reusability
 */
export const selectors = {
  // Layout
  //
  // 🔴 These are structural `data-*` hooks, deliberately NOT translated
  // aria-labels and NOT guessed class names.
  //
  // The values here until 2026-08-12 were `[data-testid="navbar"], nav.navbar`
  // and `[data-testid="mobile-drawer"]`, and they matched NOTHING in the app at
  // any viewport, signed in or out. Every test that used them failed with
  // "element(s) not found" — a broken selector wearing the costume of a broken
  // feature. Verify a selector against the real DOM before trusting it.
  //
  /** The site header. Always present, every viewport, both auth states. */
  siteHeader: '[data-site-header]',
  /**
   * Desktop primary navigation. `hidden lg:flex` — in the DOM but not visible
   * below 1024px, so assert visibility, never mere presence.
   */
  desktopNav: 'nav[data-main-nav]',
  /**
   * Mobile bottom tab bar. `lg:hidden` — the exact complement of `desktopNav`,
   * and rendered for SIGNED-IN members only. Those two facts together are the
   * 768–1023px navigation blackout guarded in responsive.spec.ts.
   */
  mobileTabBar: 'nav[data-mobile-tabbar]',
  /** The slide-up navigation drawer itself (HeroUI DrawerContent). */
  mobileDrawer: '#mobile-drawer',
  /** Opens the drawer for GUESTS — the header hamburger, rendered signed-out only. */
  drawerTriggerGuest: 'button[aria-controls="mobile-drawer"]',
  /** Opens the drawer for SIGNED-IN MEMBERS — the tab bar's last tab. */
  drawerTriggerMember: 'nav[data-mobile-tabbar] [data-mobile-tab="menu"]',
  /** The tab bar's centre Create button; opens the QuickCreateMenu modal. */
  mobileTabBarCreate: 'nav[data-mobile-tabbar] [data-mobile-tab="create"]',
  /** Present only when a session is signed in. */
  userMenu: '[data-user-menu]',
  footer: '[data-testid="footer"], footer',

  // Forms
  submitButton: 'button[type="submit"]',
  cancelButton: 'button:has-text("Cancel")',
  saveButton: 'button:has-text("Save")',
  deleteButton: 'button:has-text("Delete")',

  // Modals
  modal: '[role="dialog"], .modal',
  modalClose: '[aria-label="Close"], button:has-text("Close")',
  confirmButton: 'button:has-text("Confirm"), button:has-text("Yes")',

  // Listings
  //
  // Measured against the running app on 2026-08-12, signed in, at 1440x950 and
  // 390x844. Every selector below was DEAD before that date; the notes record
  // what each one was actually pointing at, so nobody restores them.
  //
  listingCard: '[data-testid="listing-card"], .listing-card',
  /**
   * The results container, once results are painted.
   *
   * 🔴 Do NOT key this on the grid's Tailwind classes. The loading skeleton
   * carries a byte-identical class list, so a class-based selector cannot tell
   * "results" from "still loading" and will pass against an empty page.
   * The attribute value is the view mode (`grid` | `list` | `map`).
   */
  listingGrid: '[data-listings-grid]',
  /**
   * A listing detail page that actually rendered its listing. Present on the
   * success branch only — a loading or not-found detail page does NOT match.
   */
  listingDetail: '[data-listing-detail]',
  /**
   * The "Create Listing" call to action.
   *
   * 🔴 Was `button:has-text("Create Listing"), a[href*="/listings/new"]` and both
   * halves were wrong for the same element: it is an anchor, not a button, and
   * the route is `/listings/create` — `/listings/new` matches the `listings/:id`
   * route with the literal id "new". Matching on href keeps it locale-proof;
   * the visible label is translated.
   *
   * Rendered for signed-in members only, and hidden on phones (the hero is
   * `hidden sm:block`, and phones get MobileFilterBar instead).
   */
  createListingButton: 'a[href$="/listings/create"]',

  // Messages
  /** The inbox conversation list, populated. Empty and loading states do NOT match. */
  messageList: '[data-conversation-list]',
  /** A conversation thread that rendered. */
  messageThread: '[data-message-thread]',
  /**
   * The thread composer.
   *
   * 🔴 Was `textarea[placeholder*="message"]`, which passed only because the
   * placeholder reads "Type a message..." in English. It matched nothing in the
   * other ten locales.
   */
  messageInput: '[data-message-input]',
  /**
   * The composer's send button.
   *
   * 🔴 Was `button:has-text("Send")`, which could never match: the button is
   * icon-only and its aria-label is translated. It is also CONDITIONAL — it is
   * not rendered until the composer has text or an attachment, so fill the
   * input first, then locate it.
   */
  sendButton: '[data-message-send]',

  // Navigation
  //
  // 🔴 `dashboardLink` was removed on 2026-08-12. It was `a[href*="/dashboard"]`
  // and matched ZERO elements anywhere in the app — verified signed in at four
  // viewports, including with the mobile drawer open. The drawer's "Dashboard"
  // entry is a <button> that calls navigate(); there is no dashboard anchor to
  // find. Nothing consumed it. Do not restore it: if a test needs to reach the
  // dashboard, drive the real control or navigate directly.
  listingsLink: 'a[href*="/listings"]',
  messagesLink: 'a[href*="/messages"]',
  /**
   * Note: dead on the pages probed so far, but unlike the selectors above this
   * one is the right SHAPE — the wallet nav item simply was not rendered. Left
   * as-is rather than "fixed", because there is nothing wrong with it.
   */
  walletLink: 'a[href*="/wallet"]',

  // Auth
  loginForm: 'form:has(input[type="password"])',
  emailInput: 'input[name="email"], input[type="email"]',
  passwordInput: 'input[name="password"], input[type="password"]',

  // Notifications
  /**
   * One rendered toast. The attribute value is the toast type
   * (`success` | `error` | `warning` | `info`).
   *
   * 🔴 Was `[data-testid="toast"], .toast, [role="alert"]`. The first two matched
   * nothing, but `[role="alert"]` was worse than dead — it was a FALSE PASS
   * generator. ToastViewport mounts two role containers unconditionally, so one
   * is in the DOM with zero toasts, and `role="alert"` is used throughout the app
   * for ordinary error banners (the safeguarding notice on every message thread
   * is one, and it is what this selector was matching there). Every
   * `expect(toast).toBeVisible()` after an action could therefore be satisfied by
   * the error banner explaining that the action FAILED.
   *
   * If you need a specific outcome, say so: `[data-toast="success"]`.
   */
  toast: '[data-toast]',
  /**
   * The unread dot on the notification bell. Rendered only while the unread
   * count is above zero, so its absence is assertable.
   */
  notificationBadge: '[data-notification-badge]',
};

/**
 * Wait for toast notification
 */
export async function waitForToast(page: any, expectedText?: string): Promise<void> {
  const toast = page.locator(selectors.toast);
  await toast.waitFor({ state: 'visible', timeout: 5000 });

  if (expectedText) {
    await expect(toast).toContainText(expectedText);
  }

  // Wait for toast to disappear
  await toast.waitFor({ state: 'hidden', timeout: 10000 });
}
