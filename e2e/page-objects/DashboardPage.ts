// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Dashboard Page Object (React with GlassCard components)
 *
 * The React dashboard uses GlassCard components and a 2-column layout.
 * Main sections: Welcome, Stats, Recent offers and requests, Activity Feed
 * Sidebar: Quick Actions, Suggested Matches, Groups, Events, Gamification
 */
export class DashboardPage extends BasePage {
  readonly welcomeMessage: Locator;
  readonly walletBalance: Locator;
  readonly recentActivity: Locator;
  readonly quickActions: Locator;
  readonly myListings: Locator;
  readonly suggestedListings: Locator;
  readonly myGroups: Locator;
  readonly upcomingEvents: Locator;
  readonly gamificationCard: Locator;
  readonly statsCards: Locator;

  constructor(page: Page, tenant?: string) {
    super(page, tenant);

    // Welcome section (h1 or h2)
    this.welcomeMessage = page.locator('h1, h2:has-text("Welcome")');

    // Wallet balance in GlassCard
    this.walletBalance = page.locator('text=Wallet Balance').locator('..').locator('..');

    // Recent activity feed
    this.recentActivity = page.locator('text=Recent Activity').locator('..').locator('..').or(
      page.locator('[data-activity-feed]')
    );

    // Quick actions sidebar
    this.quickActions = page.locator('text=Quick Actions').locator('..').locator('..').or(
      page.locator('[data-quick-actions]')
    );

    // Recent listings
    this.myListings = page.locator('text=Your offers and requests').locator('..').locator('..').or(
      page.locator('text=Recent offers and requests').locator('..').locator('..')
    );

    // Suggested matches
    this.suggestedListings = page.locator('text=Suggested Listings').locator('..').locator('..').or(
      page.locator('text=Suggested Matches').locator('..').locator('..')
    );

    // My groups
    this.myGroups = page.locator('text=My Groups').locator('..').locator('..').or(
      page.locator('[data-my-groups]')
    );

    // Upcoming events
    this.upcomingEvents = page.locator('text=Upcoming Events').locator('..').locator('..').or(
      page.locator('[data-upcoming-events]')
    );

    // Gamification card
    this.gamificationCard = page.locator('text=Your Progress').locator('..').locator('..').or(
      page.locator('[data-gamification]')
    );

    // Stats cards (GlassCard with icons)
    this.statsCards = page.locator('[class*="glass"], .glass-card').filter({
      has: page.locator('svg')
    });
  }

  /**
   * Navigate to dashboard
   */
  async navigate(): Promise<void> {
    await this.goto('dashboard');
  }

  /**
   * Get wallet balance text
   */
  async getWalletBalance(): Promise<string> {
    const balance = await this.walletBalance.textContent();
    return balance?.trim() || '0';
  }

  /**
   * Get number of recent activities shown
   */
  async getActivityCount(): Promise<number> {
    const activities = this.recentActivity.locator('[data-activity-item], article, li');
    return await activities.count();
  }

  /**
   * Click quick action button
   */
  async clickQuickAction(actionName: string): Promise<void> {
    await this.quickActions.getByRole('button', { name: new RegExp(actionName, 'i') }).click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Get listings count
   */
  async getMyListingsCount(): Promise<number> {
    const listings = this.myListings.locator('article, [data-listing], li');
    return await listings.count();
  }

  /**
   * Get groups count
   */
  async getMyGroupsCount(): Promise<number> {
    const groups = this.myGroups.locator('article, [data-group], li');
    return await groups.count();
  }

  /**
   * Get events count
   */
  async getUpcomingEventsCount(): Promise<number> {
    const events = this.upcomingEvents.locator('article, [data-event], li');
    return await events.count();
  }

  /**
   * Check if gamification card is visible
   */
  async hasGamificationCard(): Promise<boolean> {
    return await this.gamificationCard.count() > 0;
  }

  /**
   * Check if dashboard is loaded
   */
  async isDashboardLoaded(): Promise<boolean> {
    try {
      await expect(this.welcomeMessage).toBeVisible({ timeout: 10000 });
      return true;
    } catch {
      // May not have welcome message, check for main content
      const main = this.page.locator('main');
      return await main.count() > 0;
    }
  }

  /**
   * Wait for dashboard to load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    // Wait for at least one GlassCard to appear
    await this.page.locator('[class*="glass"], main').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  }

  /**
   * Check if has content (any cards visible)
   */
  async hasContent(): Promise<boolean> {
    const cards = this.page.locator('[class*="glass"], .glass-card, article');
    return await cards.count() > 0;
  }

  /**
   * Get notification count if notifications widget exists
   */
  async getNotificationCount(): Promise<number> {
    const notifWidget = this.page.locator('text=Notifications').locator('..').locator('..');
    if (await notifWidget.count() > 0) {
      const items = notifWidget.locator('article, li, [data-notification]');
      return await items.count();
    }
    return 0;
  }
}
