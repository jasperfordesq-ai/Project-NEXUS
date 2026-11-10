// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { coverSeed } from './coverSeeds';

/**
 * Warmth plan W2 (10 Nov 2026): a thing wears the same colour on its card, on
 * its own page and anywhere else it appears. Where a list colours by category
 * (knowledge base, volunteering, events, blog), the item's own page follows
 * its category too; an item with no category keeps a colour of its own.
 */
describe('coverSeed', () => {
  // Keyed by the category's id: help-centre category names are translated
  // for each reader, so a name-based colour would change with the language.
  it('gives an article the colour of its knowledge-base category', () => {
    expect(coverSeed.article({ id: 1, category_id: 5 })).toBe(coverSeed.kbCategory(5));
    expect(coverSeed.article({ id: 2, category_id: 5 })).toBe(coverSeed.article({ id: 1, category_id: 5 }));
  });

  it('puts an article without a category in the general group', () => {
    expect(coverSeed.article({ id: 3, category_id: null })).toBe(coverSeed.kbCategory(null));
    expect(coverSeed.kbCategory(null)).toBe(coverSeed.kbCategory(undefined));
  });

  // By the category's id too: volunteering category names are translated.
  it('gives a volunteering role the colour of its category, or its own when it has none', () => {
    expect(coverSeed.opportunity(42, 3)).toBe(coverSeed.volunteeringCategory(3));
    expect(coverSeed.opportunity(42, null)).not.toBe(coverSeed.opportunity(43, null));
  });

  it('gives events in one category one colour, and an uncategorised event its own', () => {
    expect(coverSeed.event(1, 7)).toBe(coverSeed.event(2, 7));
    expect(coverSeed.event(1, null)).not.toBe(coverSeed.event(2, null));
  });

  it('gives blog posts in one category one colour, and an uncategorised post its own', () => {
    expect(coverSeed.blogPost(1, 4)).toBe(coverSeed.blogPost(2, 4));
    expect(coverSeed.blogPost(1, null)).not.toBe(coverSeed.blogPost(2, null));
  });

  it('ignores letter case in category names', () => {
    expect(coverSeed.skillsCategory('Gardening')).toBe(coverSeed.skillsCategory('GARDENING '));
  });
});
