// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Listings Page Object - Service marketplace
 */
export class ListingsPage extends BasePage {
  readonly listingCards: Locator;
  readonly searchInput: Locator;
  readonly filterButtons: Locator;
  readonly categoryFilter: Locator;
  readonly typeFilter: Locator;
  readonly sortDropdown: Locator;
  readonly createListingButton: Locator;
  readonly loadMoreButton: Locator;
  readonly noResultsMessage: Locator;

  constructor(page: Page, tenant?: string) {
    super(page, tenant);

    // React: GlassCard listing cards (article elements)
    this.listingCards = page.locator('article').filter({ has: page.locator('h3') });
    this.searchInput = page.locator('input[placeholder*="Search"]');
    // React: HeroUI Select components (button triggers, not <select> elements)
    this.filterButtons = page.locator('button[aria-haspopup="listbox"]');
    this.categoryFilter = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Category|All Categories/ }).first();
    this.typeFilter = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /All Types|Offer|Request/ }).first();
    this.sortDropdown = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Sort|Recent|Popular/ }).first();
    this.createListingButton = page.locator('a[href*="/listings/create"], a:has-text("New Listing"), button:has-text("New Listing")').first();
    this.loadMoreButton = page.locator('button:has-text("Load More")');
    // EmptyState renders an h3 with the title text, wrapped in a div[role="status"]
    // Worded "No offers or requests to show" since Nov 2026 (was "No listings found").
    this.noResultsMessage = page.locator('h3:has-text("No offers or requests to show"), [role="status"]:has-text("No offers or requests to show")');
  }

  /**
   * Navigate to listings page
   */
  async navigate(): Promise<void> {
    await this.goto('listings');
  }

  /**
   * Wait for listings page to load
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForLoadState('networkidle').catch(() => {});

    // Wait for React to hydrate - search input should always be present
    await this.searchInput.waitFor({
      state: 'attached',
      timeout: 15000
    }).catch(() => {});

    // Give React time to render
    await this.page.waitForTimeout(500);
  }

  /**
   * Get number of visible listings
   */
  async getListingCount(): Promise<number> {
    return await this.listingCards.count();
  }

  /**
   * Search for listings
   */
  async searchListings(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Filter by type (offer/request)
   */
  async filterByType(type: 'offer' | 'request' | 'all'): Promise<void> {
    // Click the Select button to open dropdown
    await this.typeFilter.click();
    await this.page.waitForTimeout(200);

    // Click the option from the dropdown
    const typeText = type === 'all' ? 'All Types' : type === 'offer' ? 'Offers' : 'Requests';
    const option = this.page.locator(`li[role="option"]:has-text("${typeText}")`).first();
    await option.click();
    await this.page.waitForTimeout(500);
  }

  /**
   * Filter by category
   */
  async filterByCategory(category: string): Promise<void> {
    await this.categoryFilter.selectOption(category);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Sort listings
   */
  async sortBy(option: string): Promise<void> {
    await this.sortDropdown.selectOption(option);
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click on a listing card
   */
  async clickListing(index: number = 0): Promise<void> {
    await this.listingCards.nth(index).click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Click create listing button
   */
  async clickCreateListing(): Promise<void> {
    await this.createListingButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Load more listings
   */
  async loadMore(): Promise<void> {
    if (await this.loadMoreButton.isVisible()) {
      await this.loadMoreButton.click();
      await this.page.waitForLoadState('domcontentloaded');
    }
  }

  /**
   * Check if no results are shown
   */
  async hasNoResults(): Promise<boolean> {
    return await this.noResultsMessage.isVisible();
  }

  /**
   * Get listing titles
   */
  async getListingTitles(): Promise<string[]> {
    const titles = await this.listingCards.locator('.listing-title, h3, h4').allTextContents();
    return titles.map(t => t.trim());
  }
}

/**
 * Create/Edit Listing Page Object
 */
export class CreateListingPage extends BasePage {
  readonly titleInput: Locator;
  readonly descriptionInput: Locator;
  readonly typeSelect: Locator;
  readonly categorySelect: Locator;
  readonly tagsInput: Locator;
  readonly locationInput: Locator;
  readonly durationInput: Locator;
  readonly imageUpload: Locator;
  readonly submitButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page, tenant?: string) {
    super(page, tenant);

    // HeroUI Input components do not use name attributes — match by placeholder.
    // The Title field placeholder is "e.g., Help with gardening, Computer tutoring..."
    this.titleInput = page.locator('input[placeholder*="Help with gardening"]').first();
    // The Description field is a Textarea with placeholder "Describe what you're offering..."
    this.descriptionInput = page.locator('textarea[placeholder*="Describe what you"]').first();
    // HeroUI RadioGroup for type — click on the radio label text
    this.typeSelect = page.locator('[data-slot="radio-group"]').first();
    // HeroUI Select for category
    this.categorySelect = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Select a category|Category/ }).first();
    this.tagsInput = page.locator('input[name="tags"], .tags-input');
    // HeroUI Input for location — match by placeholder
    this.locationInput = page.locator('input[placeholder*="Online, Dublin"]').first();
    this.durationInput = page.locator('input[placeholder="1"]').first();
    this.imageUpload = page.locator('input[type="file"]');
    this.submitButton = page.locator('button:has-text("Create Listing"), button:has-text("Update Listing")').first();
    this.cancelButton = page.locator('button:has-text("Cancel"), a:has-text("Cancel")').first();
  }

  /**
   * Navigate to create listing page
   */
  async navigate(): Promise<void> {
    await this.goto('listings/create');
  }

  /**
   * Fill listing form
   */
  async fillForm(data: {
    title: string;
    description: string;
    type?: 'offer' | 'request';
    category?: string;
    tags?: string[];
    location?: string;
    duration?: string;
  }): Promise<void> {
    await this.titleInput.fill(data.title);
    await this.descriptionInput.fill(data.description);

    if (data.type) {
      const typeRadio = this.page.locator(`input[name="type"][value="${data.type}"]`);
      if (await typeRadio.count() > 0) {
        await typeRadio.check();
      } else {
        await this.typeSelect.selectOption(data.type);
      }
    }

    if (data.category) {
      await this.categorySelect.selectOption({ label: data.category });
    }

    if (data.location) {
      await this.locationInput.fill(data.location);
    }

    if (data.duration) {
      await this.durationInput.fill(data.duration);
    }
  }

  /**
   * Submit listing form
   */
  async submit(): Promise<void> {
    await this.submitButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Create a listing with full flow
   */
  async createListing(data: {
    title: string;
    description: string;
    type?: 'offer' | 'request';
    category?: string;
  }): Promise<void> {
    await this.fillForm(data);
    await this.submit();
  }
}

/**
 * Listing Detail Page Object
 */
export class ListingDetailPage extends BasePage {
  readonly title: Locator;
  readonly description: Locator;
  readonly authorInfo: Locator;
  readonly contactButton: Locator;
  readonly editButton: Locator;
  readonly deleteButton: Locator;
  readonly likeButton: Locator;
  readonly shareButton: Locator;
  readonly comments: Locator;
  readonly commentInput: Locator;

  constructor(page: Page, tenant?: string) {
    super(page, tenant);

    this.title = page.locator('h1, .listing-title');
    this.description = page.locator('.listing-description, .description');
    this.authorInfo = page.locator('.author-info, .user-card, [data-author]');
    this.contactButton = page.locator('.contact-btn, a[href*="messages"]');
    this.editButton = page.locator('a[href*="edit"], .edit-btn');
    this.deleteButton = page.locator('.delete-btn, [data-delete]');
    this.likeButton = page.locator('.like-btn, [data-like]');
    this.shareButton = page.locator('.share-btn, [data-share]');
    this.comments = page.locator('.comment, .comment-item');
    this.commentInput = page.locator('textarea[name="comment"], .comment-input');
  }

  /**
   * Navigate to a listing by ID
   */
  async navigateToListing(id: number | string): Promise<void> {
    await this.goto(`listings/${id}`);
  }

  /**
   * Get listing title
   */
  async getTitle(): Promise<string> {
    return await this.title.textContent() || '';
  }

  /**
   * Click contact/message button
   */
  async clickContact(): Promise<void> {
    await this.contactButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Like the listing
   */
  async like(): Promise<void> {
    await this.likeButton.click();
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Add a comment
   */
  async addComment(text: string): Promise<void> {
    await this.commentInput.fill(text);
    await this.page.click('button[type="submit"]:near(.comment-input)');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * Get comment count
   */
  async getCommentCount(): Promise<number> {
    return await this.comments.count();
  }

  /**
   * Check if current user can edit
   */
  async canEdit(): Promise<boolean> {
    return await this.editButton.isVisible();
  }
}
