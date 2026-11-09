// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The seed each kind of item's colour is chosen from (`colourForSeed`), in one
 * place, so an item has the same colour on its card, its page and anywhere
 * else it appears (AWID feedback, Nov 2026: "clear categories, attractive
 * visuals"). Change a seed here and every place follows.
 */
export const coverSeed = {
  /** Courses in one category share a colour; others have their own. */
  course: (course: { id: number | string; category?: { name?: string | null } | null }): string =>
    course.category?.name ? `course-category-${course.category.name.toLowerCase()}` : `course-${course.id}`,
  podcastShow: (slug: string): string => `podcast-show-${slug}`,
  jobType: (type: string): string => `job-type-${type}`,
  organisation: (id: number | string): string => `organisation-${id}`,
  opportunity: (id: number | string): string => `opportunity-${id}`,
  goal: (id: number | string): string => `goal-${id}`,
  idea: (id: number | string): string => `idea-${id}`,
  challenge: (id: number | string): string => `challenge-${id}`,
  campaign: (id: number | string): string => `campaign-${id}`,
  groupExchange: (id: number | string): string => `group-exchange-${id}`,
  article: (id: number | string): string => `article-${id}`,
} as const;
