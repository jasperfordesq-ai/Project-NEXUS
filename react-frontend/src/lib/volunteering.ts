// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared helpers for volunteering opportunity data.
 */

/**
 * Category object shape returned by API endpoints that serialize the
 * VolCategory relation directly (eager-loaded as `category:id,name,color`).
 */
export interface OpportunityCategoryObject {
  id?: number;
  name?: string | null;
  color?: string | null;
}

/**
 * The API is inconsistent about `category` on volunteering opportunities:
 * some endpoints flatten it to the category name (a plain string), while
 * others serialize the whole relation as an object ({ id, name, color }).
 * Rendering the raw value as a React child crashes the page with
 * "Objects are not valid as a React child" when it is an object.
 */
export type OpportunityCategory = string | OpportunityCategoryObject | null;

/**
 * The id of an opportunity's category: `category_id` where the response has
 * it, else the id inside an object category. Null when neither is known.
 */
export function getOpportunityCategoryId(opportunity: {
  category?: OpportunityCategory | undefined;
  category_id?: number | null;
}): number | null {
  if (opportunity.category_id != null) return opportunity.category_id;
  const category = opportunity.category;
  if (category != null && typeof category === 'object' && category.id != null) return category.id;
  return null;
}

/**
 * Unwraps an opportunity category (string or object) into a displayable name.
 * Returns null when there is no usable name so callers can skip rendering.
 */
export function getOpportunityCategoryName(
  category: OpportunityCategory | undefined
): string | null {
  if (category == null) return null;
  if (typeof category === 'string') {
    return category.trim() === '' ? null : category;
  }
  if (typeof category.name === 'string' && category.name.trim() !== '') {
    return category.name;
  }
  return null;
}
