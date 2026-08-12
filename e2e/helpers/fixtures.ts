// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { expect } from '@playwright/test';

/**
 * Test user credentials and data
 */
export const testUsers = {
  primary: {
    email: process.env.E2E_TEST_USER_EMAIL || 'e2e-test@example.com',
    password: process.env.E2E_TEST_USER_PASSWORD || 'TestPass123!',
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
  listingCard: '[data-testid="listing-card"], .listing-card',
  listingGrid: '[data-testid="listings-grid"], .listings-grid',
  listingDetail: '[data-testid="listing-detail"]',
  createListingButton: 'button:has-text("Create Listing"), a[href*="/listings/new"]',

  // Messages
  messageList: '[data-testid="messages-list"], .messages-list',
  messageThread: '[data-testid="message-thread"]',
  messageInput: '[data-testid="message-input"], textarea[placeholder*="message"]',
  sendButton: 'button:has-text("Send")',

  // Navigation
  dashboardLink: 'a[href*="/dashboard"]',
  listingsLink: 'a[href*="/listings"]',
  messagesLink: 'a[href*="/messages"]',
  walletLink: 'a[href*="/wallet"]',

  // Auth
  loginForm: 'form:has(input[type="password"])',
  emailInput: 'input[name="email"], input[type="email"]',
  passwordInput: 'input[name="password"], input[type="password"]',

  // Notifications
  toast: '[data-testid="toast"], .toast, [role="alert"]',
  notificationBadge: '[data-testid="notification-badge"], .notification-badge',
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
