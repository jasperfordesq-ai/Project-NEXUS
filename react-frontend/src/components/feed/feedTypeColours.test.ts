// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { feedFilterDot, feedTypeColour, FEED_FILTER_KINDS } from './feedTypeColours';

const FILTERABLE_KINDS = ['listing', 'event', 'poll', 'goal', 'job', 'challenge', 'volunteer', 'blog', 'discussion'] as const;

describe('feed type colours', () => {
  it('gives every kind in the filter row its own colour', () => {
    const labels = FILTERABLE_KINDS.map((kind) => feedTypeColour(kind).label);
    const dots = FILTERABLE_KINDS.map((kind) => feedTypeColour(kind).dot);
    expect(new Set(labels).size).toBe(FILTERABLE_KINDS.length);
    expect(new Set(dots).size).toBe(FILTERABLE_KINDS.length);
  });

  it('keeps offers and requests in the community colour', () => {
    expect(feedTypeColour('listing').label).toContain('bg-accent-soft');
    expect(feedTypeColour('listing').dot).toBe('bg-accent');
  });

  it('labels read in both themes: deep text on a pale tint, light text on a dark tint', () => {
    for (const kind of FILTERABLE_KINDS.filter((k) => k !== 'listing')) {
      const { label } = feedTypeColour(kind);
      expect(label, kind).toMatch(/(^|\s)bg-[a-z]+-100(\s|$)/);
      expect(label, kind).toMatch(/(^|\s)text-[a-z]+-800(\s|$)/);
      expect(label, kind).toMatch(/(^|\s)dark:bg-[a-z]+-500\/15(\s|$)/);
      expect(label, kind).toMatch(/(^|\s)dark:text-[a-z]+-300(\s|$)/);
    }
  });

  it('matches each filter chip dot to the label on that kind of card', () => {
    for (const [filter, kind] of Object.entries(FEED_FILTER_KINDS)) {
      expect(feedFilterDot(filter), filter).toBe(feedTypeColour(kind).dot);
    }
  });

  it('gives no dot to filters that are not one kind of post', () => {
    for (const filter of ['all', 'following', 'saved', 'posts']) {
      expect(feedFilterDot(filter), filter).toBeNull();
    }
  });

  it('falls back to a neutral label for a kind it does not know', () => {
    expect(feedTypeColour('something_new').label).toContain('bg-[var(--surface-elevated)]');
  });

  it('never uses the brand-reserved indigo or purple utilities', () => {
    for (const kind of [...FILTERABLE_KINDS, 'review', 'resource', 'course', 'podcast_show', 'podcast_episode', 'volunteer_hours']) {
      const { label, dot } = feedTypeColour(kind);
      expect(`${label} ${dot}`, kind).not.toMatch(/-(indigo|purple)-/);
    }
  });
});
