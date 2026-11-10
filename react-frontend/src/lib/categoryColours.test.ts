// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import {
  accentLineClasses,
  categoryColour,
  colourForSeed,
  companionColourName,
  companionPaint,
  paletteFor,
  themeColourNames,
  HUE_WHEEL,
} from './categoryColours';
import { getContrastRatio } from './colorContrast';
import fs from 'node:fs';
import path from 'node:path';

describe('companionColourName — the second colour that goes with the community colour', () => {
  it('is a near neighbour on the colour wheel, so the two blend rather than clash', () => {
    expect(companionColourName('#0f766e')).toBe('sky');
    expect(companionColourName('#a3195b')).toBe('red');
    expect(companionColourName('#6366f1')).toBe('pink');
  });

  it("is never the community's own hue, and is one of the palette's colours", () => {
    for (const accent of ['#a3195b', '#0f766e', '#6366f1', '#facc15', '#ef4444', '#16a34a', '#1e3a8a']) {
      const palette = paletteFor(accent);
      expect(companionColourName(accent)).not.toBe(palette[0]);
      expect(palette).toContain(companionColourName(accent));
    }
  });

  it('uses the standard colour when there is none, or it is invalid, or it is grey', () => {
    expect(companionColourName(null)).toBe('pink');
    expect(companionColourName('not-a-colour')).toBe('pink');
    expect(companionColourName('#777777')).toBe('pink');
  });
});

describe('companionPaint — the companion colour as a CSS value', () => {
  it('is the -500 shade on the light theme and the lighter -400 on the dark theme', () => {
    expect(companionPaint('#0f766e', 'light')).toBe('var(--color-sky-500)');
    expect(companionPaint('#0f766e', 'dark')).toBe('var(--color-sky-400)');
  });

  it('only names colours Tailwind defines and tokens.css keeps, never indigo or purple', () => {
    const theme = fs.readFileSync(path.resolve(__dirname, '../../node_modules/tailwindcss/theme.css'), 'utf8');
    const tokens = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8');
    for (const { name } of HUE_WHEEL) {
      for (const mode of ['light', 'dark'] as const) {
        const paint = companionPaint(null, mode, name);
        const variable = /^var\((--color-[a-z]+-\d+)\)$/.exec(paint)?.[1];
        expect(variable, paint).toBeDefined();
        expect(theme).toContain(`${variable}:`);
        // Tailwind drops theme variables that no utility uses; tokens.css
        // names each shade so the companion colour never resolves to nothing.
        expect(tokens, `${variable} is kept in tokens.css`).toContain(`var(${variable})`);
        expect(paint).not.toMatch(/indigo|purple/);
      }
    }
  });
});

const RASPBERRY = '#a3195b';
const TEAL = '#0f766e';
const STANDARD_INDIGO = '#6366f1';

describe('paletteFor — colours that go with the community colour', () => {
  it('starts with the hue nearest the community colour', () => {
    expect(paletteFor(RASPBERRY)[0]).toBe('pink');
    expect(paletteFor(TEAL)[0]).toBe('teal');
  });

  it('pairs that hue with the colours opposite it, so neighbours never look alike', () => {
    const palette = paletteFor(TEAL);
    // Teal's opposite side of the wheel is the warm reds and pinks.
    expect(palette[1]).toBe('rose');
    expect(palette).toEqual(expect.arrayContaining(['red', 'pink']));
    for (let i = 1; i < palette.length; i++) {
      expect(palette[i]).not.toBe(palette[i - 1]);
    }
  });

  it('gives eight different colours', () => {
    for (const accent of [RASPBERRY, TEAL, STANDARD_INDIGO, '#be123c', '#a16207', '#15803d']) {
      expect(new Set(paletteFor(accent)).size).toBe(8);
    }
  });

  it('changes when the community colour changes', () => {
    expect(paletteFor(RASPBERRY)).not.toEqual(paletteFor(TEAL));
  });

  it('uses the standard colour when there is none, or it is invalid, or it is grey', () => {
    const standard = paletteFor(STANDARD_INDIGO);
    expect(paletteFor(null)).toEqual(standard);
    expect(paletteFor('not-a-colour')).toEqual(standard);
    expect(paletteFor('#777777')).toEqual(standard);
  });

  it('only hands out colours the class map knows, and never the grey "unknown" one', () => {
    for (const { name } of HUE_WHEEL) {
      expect(categoryColour(name)).not.toBe(categoryColour('no-such-colour'));
    }
    expect(paletteFor(TEAL)).not.toContain('slate');
  });
});

describe('themeColourNames', () => {
  it('colours themes from the community palette while they are all left on the default blue', () => {
    const names = themeColourNames(
      [{ slug: 'care', color: 'blue' }, { slug: 'learning', color: 'blue' }, { slug: 'transport', color: 'blue' }],
      TEAL,
    );
    const palette = paletteFor(TEAL);
    expect(names).toEqual({ care: palette[0], learning: palette[1], transport: palette[2] });
  });

  it('follows the community colour, so a new colour recolours the themes', () => {
    const themes = [{ slug: 'care', color: 'blue' }, { slug: 'learning', color: 'blue' }];
    expect(themeColourNames(themes, RASPBERRY)).not.toEqual(themeColourNames(themes, TEAL));
  });

  it('treats themes with no colour stored as left on the default', () => {
    const names = themeColourNames([{ slug: 'a', color: null }, { slug: 'b' }]);
    expect(names.a).not.toBe(names.b);
  });

  it('keeps exactly the colours an admin chose once they differ', () => {
    expect(themeColourNames([
      { slug: 'care', color: 'pink' },
      { slug: 'learning', color: 'blue' },
      { slug: 'other', color: null },
    ], TEAL)).toEqual({ care: 'pink', learning: 'blue', other: 'slate' });
  });

  it('wraps round the palette when there are more themes than colours', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ slug: `t${i}`, color: 'blue' }));
    const names = themeColourNames(many, TEAL);
    expect(names.t8).toBe(paletteFor(TEAL)[0]);
  });
});

describe('colourForSeed', () => {
  it('always gives the same item the same colour', () => {
    const palette = paletteFor(TEAL);
    expect(colourForSeed(42, palette)).toBe(colourForSeed(42, palette));
    expect(colourForSeed('Aoife Nolan', palette)).toBe(colourForSeed('Aoife Nolan', palette));
  });

  it('spreads different items across the palette', () => {
    const palette = paletteFor(RASPBERRY);
    const used = new Set(Array.from({ length: 40 }, (_, i) => colourForSeed(i + 1, palette)));
    expect(used.size).toBeGreaterThanOrEqual(6);
  });

  it('only gives colours from the palette', () => {
    const palette = paletteFor(TEAL);
    for (const seed of ['', 'x', 0, 7, 'Saoirse Ní Bhriain']) {
      expect(palette).toContain(colourForSeed(seed, palette));
    }
  });
});

describe('accentLineClasses — the line under the site header', () => {
  it("runs from one neighbour of the community's hue, through the community colour, to the other", () => {
    // Teal sits between emerald and cyan on the wheel.
    const classes = accentLineClasses(paletteFor(TEAL));
    expect(classes).toContain('from-emerald-500');
    expect(classes).toContain('via-accent');
    expect(classes).toContain('to-cyan-500');
  });

  it('uses lighter shades in dark mode', () => {
    const classes = accentLineClasses(paletteFor(RASPBERRY));
    expect(classes).toMatch(/dark:from-\w+-400/);
    expect(classes).toMatch(/dark:to-\w+-400/);
  });

  it('never uses the brand-reserved indigo or purple utilities', () => {
    for (const accent of [STANDARD_INDIGO, RASPBERRY, TEAL, '#6d28d9', '#1d4ed8']) {
      expect(accentLineClasses(paletteFor(accent))).not.toMatch(/(indigo|purple)-/);
    }
  });
});

describe('class sets stay readable in light and dark mode', () => {
  // Every class set pairs a -800 text shade with a -100..-200 background in
  // light mode, and a -200/-300 text shade on a faint tint in dark mode. The
  // light pair is the one at risk; checked here against Tailwind v4's values
  // for the darkest background each set uses.
  const LIGHT_PAIRS: Record<string, [text: string, background: string]> = {
    yellow: ['#894b00', '#fff085'],
    amber: ['#973c00', '#fee685'],
    green: ['#016630', '#b9f8cf'],
    cyan: ['#005f78', '#a2f4fd'],
  };

  it.each(Object.entries(LIGHT_PAIRS))('%s text clears 4.5:1 on its own panel', (_name, [text, background]) => {
    expect(getContrastRatio(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('every class set carries both a light and a dark variant', () => {
    for (const { name } of HUE_WHEEL) {
      const colour = categoryColour(name);
      for (const classes of [colour.band, colour.cover]) {
        expect(classes).toMatch(/(^| )text-\w+-800/);
        expect(classes).toMatch(/dark:text-\w+-[23]00/);
        expect(classes).toMatch(/dark:(bg|from)-\w+-500\//);
      }
    }
  });
});
