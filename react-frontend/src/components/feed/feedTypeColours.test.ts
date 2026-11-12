// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { feedFilterDot, feedTypeColour, FEED_FILTER_KINDS, kindTile } from './feedTypeColours';
import { getContrastRatio } from '@/lib/colorContrast';

const FILTERABLE_KINDS = ['listing', 'event', 'poll', 'goal', 'job', 'challenge', 'volunteer', 'blog', 'discussion'] as const;

describe('feed type colours', () => {
  it('gives every kind in the filter row its own colour', () => {
    const labels = FILTERABLE_KINDS.map((kind) => feedTypeColour(kind).label);
    const dots = FILTERABLE_KINDS.map((kind) => feedTypeColour(kind).dot);
    expect(new Set(labels).size).toBe(FILTERABLE_KINDS.length);
    expect(new Set(dots).size).toBe(FILTERABLE_KINDS.length);
  });

  // Owner, 10 Nov 2026 (warmth plan W1): one colour per kind of thing,
  // everywhere — the sidebar, notifications, Explore and federation pages use
  // this list too, so it covers the kinds they show.
  it('has a colour for every kind the rest of the site shows', () => {
    const SITE_KINDS = ['group', 'member', 'message', 'hours', 'exchange', 'organisation', 'achievement', 'resource', 'review'];
    for (const kind of SITE_KINDS) {
      const { label } = feedTypeColour(kind);
      expect(label, kind).not.toContain('surface-elevated');
      expect(label, kind).toMatch(/(^|\s)text-[a-z]+-800(\s|$)/);
    }
    // The kinds a member most often meets side by side stay distinct.
    const together = ['listing', 'event', 'group', 'member', 'message', 'hours'].map((kind) => feedTypeColour(kind).label);
    expect(new Set(together).size).toBe(together.length);
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
      const { label, dot, solid } = feedTypeColour(kind);
      expect(`${label} ${dot} ${solid ?? ''}`, kind).not.toMatch(/-(indigo|purple)-/);
    }
  });
});

/** A Tailwind colour as #rrggbb, from the installed theme's oklch value. */
function tailwindHex(family: string, step: string): string {
  const theme = fs.readFileSync(path.resolve(__dirname, '../../../node_modules/tailwindcss/theme.css'), 'utf8');
  const m = new RegExp(String.raw`--color-${family}-${step}:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)`).exec(theme);
  expect(m, `Tailwind defines ${family}-${step}`).not.toBeNull();
  const L = Number(m![1]) / 100;
  const h = (Number(m![3]) * Math.PI) / 180;
  const a = Number(m![2]) * Math.cos(h);
  const b = Number(m![2]) * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  return `#${linear.map((v) => {
    const c = Math.min(1, Math.max(0, v));
    const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255).toString(16).padStart(2, '0');
  }).join('')}`;
}

const ALL_KINDS = [...FILTERABLE_KINDS, 'review', 'resource', 'course', 'podcast_show', 'podcast_episode', 'volunteer_hours',
  'group', 'member', 'message', 'hours', 'exchange', 'organisation', 'achievement'];

// Warmth phase 5: in the VIVID colour strength a kind's picture tile (form
// sections, dashboard shortcuts) is filled with its colour and the picture is
// white — but only where that fill carries white at 4.5:1. Any other kind,
// and the kinds that wear the community colour, use its button shade.
describe('kind tiles in vivid', () => {
  it('fill with a shade that carries a white picture at 4.5:1 or better', () => {
    for (const kind of ALL_KINDS) {
      const { solid } = feedTypeColour(kind);
      if (!solid) continue;
      const fill = /(?:^|\s)bg-([a-z]+)-(\d{3})(?:\s|$)/.exec(solid);
      expect(fill, `${kind}: one plain palette fill`).not.toBeNull();
      expect(solid.split(/\s+/), kind).toContain('text-white');
      const ratio = getContrastRatio(tailwindHex(fill![1]!, fill![2]!), '#ffffff')!;
      expect(ratio, `${kind}: white on ${fill![1]}-${fill![2]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keep each kind in its own colour', () => {
    for (const kind of ALL_KINDS) {
      const { solid, dot } = feedTypeColour(kind);
      if (!solid) continue;
      const family = /bg-([a-z]+)-500/.exec(dot)?.[1];
      expect(solid, kind).toContain(`bg-${family}-`);
    }
  });

  it('give most kinds their own fill, not the community colour', () => {
    const own = ALL_KINDS.filter((kind) => feedTypeColour(kind).solid);
    expect(own.length).toBeGreaterThanOrEqual(ALL_KINDS.length - 1);
  });

  it('use the button shade for offers and requests and for an unknown kind', () => {
    expect(feedTypeColour('listing').solid).toBeUndefined();
    expect(kindTile('listing', true)).toBe('bg-accent-strong text-white');
    expect(kindTile('something_new', true)).toBe('bg-accent-strong text-white');
  });

  it('are the pale label in soft strength', () => {
    for (const kind of ALL_KINDS) {
      expect(kindTile(kind, false), kind).toBe(feedTypeColour(kind).label);
    }
  });

  it('are the solid fill in vivid', () => {
    expect(kindTile('event', true)).toBe(feedTypeColour('event').solid);
  });
});
