// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The seed each kind of item's colour is chosen from (`colourForSeed`), in one
 * place, so an item has the same colour on its card, its page and anywhere
 * else it appears (AWID feedback, Nov 2026: "clear categories, attractive
 * visuals"). Change a seed here and every place follows.
 *
 * The rule (warmth plan W2, 10 Nov 2026): where a list colours its items by
 * category, the item's own page — and every other place it appears — follows
 * its category too. An item with no category keeps a colour of its own.
 */
const lower = (name: string): string => name.trim().toLowerCase();

/**
 * Knowledge-base category, by id: its names are translated for each reader,
 * so a name would give a different colour in each language. No category is
 * the "general" group.
 */
const kbCategory = (categoryId: number | string | null | undefined): string =>
  `kb-category-${categoryId ?? 'general'}`;

/** Volunteering category, by id: its names are translated for each reader too. */
const volunteeringCategory = (categoryId: number | string): string => `volunteering-category-${categoryId}`;

export const coverSeed = {
  /** Courses in one category share a colour; others have their own. */
  course: (course: { id: number | string; category?: { name?: string | null } | null }): string =>
    course.category?.name ? `course-category-${course.category.name.toLowerCase()}` : `course-${course.id}`,
  podcastShow: (slug: string): string => `podcast-show-${slug}`,
  podcastCategory: (name: string): string => `podcast-category-${lower(name)}`,
  jobType: (type: string): string => `job-type-${type}`,
  organisation: (id: number | string): string => `organisation-${id}`,
  volunteeringCategory,
  /** A volunteering role wears its category's colour, as on its card. */
  opportunity: (id: number | string, categoryId?: number | string | null): string =>
    categoryId != null ? volunteeringCategory(categoryId) : `opportunity-${id}`,
  goal: (id: number | string): string => `goal-${id}`,
  idea: (id: number | string): string => `idea-${id}`,
  challenge: (id: number | string): string => `challenge-${id}`,
  campaign: (id: number | string): string => `campaign-${id}`,
  groupExchange: (id: number | string): string => `group-exchange-${id}`,
  kbCategory,
  /** An article wears its knowledge-base category's colour, as in the list. */
  article: (article: { id: number | string; category_id?: number | null }): string =>
    kbCategory(article.category_id),
  /** Events in one category share a colour (events page date tiles, Explore). */
  event: (id: number | string, categoryId?: number | string | null): string =>
    categoryId != null ? `event-category-${categoryId}` : `event-${id}`,
  /** Blog posts in one category share a colour (blog page, Explore). */
  blogPost: (id: number | string, categoryId?: number | string | null): string =>
    categoryId != null ? `category-${categoryId}` : `post-${id}`,
  marketplaceCategory: (slugOrId: number | string): string => `marketplace-${slugOrId}`,
  collection: (id: number | string): string => `collection-${id}`,
  skillsCategory: (name: string): string => `skills-category-${lower(name)}`,
  /** A federated listing's colour follows its category, or its type when it has none. */
  federatedListing: (categoryOrType: string): string => `listing-category-${lower(categoryOrType)}`,
  federatedCommunity: (id: number | string): string => `federated-community-${id}`,
} as const;
