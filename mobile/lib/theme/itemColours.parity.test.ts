// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The app must give an item the SAME colour the member website gives it.
 *
 * The choosing rules live twice: react-frontend/src/lib/categoryColours.ts and
 * coverSeeds.ts (the source) and lib/theme/itemColours.ts (the app's copy).
 * This runs the website's real files beside the copy across many communities
 * and items, rather than re-deriving the arithmetic, so a change to either side
 * alone goes red here.
 */

import * as app from './itemColours';
import * as web from '../../../react-frontend/src/lib/categoryColours';
import { coverSeed as webCoverSeed } from '../../../react-frontend/src/lib/coverSeeds';

const ACCENTS: (string | null | undefined)[] = [
  null, undefined, '', 'not-a-colour', '#6366f1', '#5b5ede', '#006fee', '#0d9488', '#e11d48', '#f59e0b',
  '#16a34a', '#7c3aed', '#db2777', '#0891b2', '#64748b', '#808080', '#000000', '#ffffff', '#ff0000', '#8B4513',
];

describe('item colours match the website', () => {
  it('builds the same palette for every community colour', () => {
    for (const accent of ACCENTS) {
      expect(app.paletteFor(accent)).toEqual(web.paletteFor(accent));
    }
    // Every hue on a fine sweep, not only the sample above.
    for (let hue = 0; hue < 360; hue += 3) {
      const accent = hslHex(hue, 0.7, 0.5);
      expect(app.paletteFor(accent)).toEqual(web.paletteFor(accent));
    }
  });

  it('gives every item the same colour', () => {
    const seeds: (string | number)[] = [0, 1, 2, 17, 999, 123456, 'abc', 'Maeve Byrne', 'event-category-4', 'podcast-show-the-weekly'];
    for (let i = 0; i < 300; i++) seeds.push(i, `item-${i}`);
    for (const accent of ACCENTS) {
      const palette = web.paletteFor(accent);
      for (const seed of seeds) expect(app.colourForSeed(seed, palette)).toBe(web.colourForSeed(seed, palette));
    }
  });

  it('colours themes the same way', () => {
    const allBlue = ['garden', 'care', 'lifts', 'tech', 'food', 'pets', 'music', 'repairs', 'admin'].map((slug) => ({ slug, color: 'blue' }));
    const chosen = [{ slug: 'a', color: 'red' }, { slug: 'b', color: 'Purple' }, { slug: 'c', color: 'nonsense' }, { slug: 'd', color: null }];
    for (const accent of ACCENTS) {
      expect(app.themeColourNames(allBlue, accent)).toEqual(web.themeColourNames(allBlue, accent));
      expect(app.themeColourNames(chosen, accent)).toEqual(web.themeColourNames(chosen, accent));
    }
  });

  it('uses the same seeds for every kind of item the website colours', () => {
    // One or more sample inputs for EVERY seed the website has. A seed the website adds
    // fails here (and in the type check, through the Record type) until the app copies it.
    const samples: Record<keyof typeof webCoverSeed, unknown[][]> = {
      course: [[{ id: 4, category: { name: 'Gardening' } }], [{ id: 4 }], [{ id: 4, category: null }]],
      podcastShow: [['the-weekly']],
      podcastCategory: [[' Arts '], ['News']],
      jobType: [['volunteer'], ['paid']],
      organisation: [[12]],
      volunteeringCategory: [[' Outdoors ']],
      opportunity: [[7, 'Outdoors'], [7, '  '], [7, null], [7]],
      goal: [[3]],
      idea: [[3]],
      challenge: [[3]],
      campaign: [[3]],
      groupExchange: [[3]],
      kbCategory: [['Getting started'], [null], ['  ']],
      article: [[{ id: 1, category_name: 'FAQ' }], [{ id: 1, category_name: null }]],
      event: [[10, 4], [10, null], [10]],
      blogPost: [[5, 2], [5, 'News'], [5, null]],
      marketplaceCategory: [['tools'], [9]],
      collection: [[3]],
      skillsCategory: [[' Cooking ']],
      federatedListing: [['Gardening'], ['offer']],
      federatedCommunity: [[8]],
    };
    const webSeeds = webCoverSeed as unknown as Record<string, (...args: unknown[]) => unknown>;
    const appSeeds = app.coverSeed as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const key of Object.keys(webSeeds)) {
      expect({ key, copied: typeof appSeeds[key] }).toEqual({ key, copied: 'function' });
      const inputs = (samples as Record<string, unknown[][] | undefined>)[key];
      expect({ key, hasSamples: Boolean(inputs?.length) }).toEqual({ key, hasSamples: true });
      for (const args of inputs ?? []) expect({ key, seed: appSeeds[key]!(...args) }).toEqual({ key, seed: webSeeds[key]!(...args) });
    }
  });

  it('knows every colour name the website knows, including the two reserved ones', () => {
    for (const { name } of web.HUE_WHEEL) expect(app.isKnownColourName(name)).toBe(true);
    for (const name of ['gray', 'slate', 'purple', 'indigo', 'PURPLE']) expect(app.isKnownColourName(name)).toBe(true);
    expect(app.HUE_WHEEL).toEqual(web.HUE_WHEEL);
  });
});

function hslHex(hue: number, saturation: number, lightness: number): string {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lightness - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}
