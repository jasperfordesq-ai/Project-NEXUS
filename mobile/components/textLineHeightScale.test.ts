// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A fixed line height does not grow when the member enlarges text.
 *
 * React Native scales `fontSize` by the OS font scale (`allowFontScaling` defaults to
 * true) but leaves an explicit `lineHeight` exactly where it was — and Uniwind compiles
 * `leading-5` to `lineHeight: 20`, a fixed number of pixels. Nothing in this app sets
 * `maxFontSizeMultiplier`, so at Android's larger text sizes the glyphs keep growing
 * inside a line box that does not, and the text is sliced.
 *
 * The arithmetic, which is why this is a guard and not a judgement call. Android's 1.3x
 * setting is the one the 2026-09-05 sweep actually photographed:
 *
 *   text-2xl + leading-7  = 24px in a 28px line. At 1.3x: 31.2px in a 28px line.
 *   text-3xl + leading-9  = 30px in a 36px line. At 1.3x: 39.0px in a 36px line.
 *   text-base + leading-5 = 16px in a 20px line. At 1.3x: 20.8px in a 20px line.
 *
 * In each case the glyph is taller than the space it is drawn in, so it clips — and
 * `text-2xl leading-7` is already clipping by about 1.15x. This settles the "More screen
 * eyebrow appeared sliced" observation left open in VISUAL_AUDIT.md §7 as a real,
 * arithmetic defect rather than a mid-layout capture.
 *
 * The rule: a class list that pins BOTH a font size and a line height must leave the line
 * at least 1.3x the font, so the text still fits at the setting we test. Ten sites were
 * below that and had their `leading-*` removed, which hands the line height back to the
 * platform, where it scales.
 *
 * 🔴 Deliberately NOT enforced above 1.3. The next tier up (`text-sm leading-5`, ratio
 * 1.43, and `text-xs leading-4`, 1.33) covers about 350 sites and holds at 1.3x; tightening
 * this threshold would be a change to the app's vertical rhythm everywhere, which is a
 * design decision and not a bug fix. Android offers 1.5x and 2.0x as well, where those
 * tiers do give out — recorded in VISUAL_AUDIT.md, not silently swept.
 */

import fs from 'fs';
import path from 'path';

/** Tailwind's defaults, in px — the values Uniwind compiles these classes to. */
const FONT_SIZES: Record<string, number> = {
  xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30, '4xl': 36,
};
const LINE_HEIGHTS: Record<string, number> = {
  '3': 12, '4': 16, '5': 20, '6': 24, '7': 28, '8': 32, '9': 36, '10': 40,
};

/** The largest OS text setting this rule guarantees, and the sweep photographed. */
const GUARDED_FONT_SCALE = 1.3;

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.expo', 'coverage', 'android', 'ios', 'dist', '.git']);

function screenFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) screenFiles(path.join(dir, entry.name), found);
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      found.push(path.join(dir, entry.name));
    }
  }
  return found;
}

describe('text that scales must have a line box that scales with it', () => {
  it(`never pins a line height below ${GUARDED_FONT_SCALE}x its font size`, () => {
    const offenders: string[] = [];

    for (const file of screenFiles(ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      const lines = source.split('\n');

      lines.forEach((line, index) => {
        for (const match of line.matchAll(/className="([^"]*)"/g)) {
          const classes = match[1];
          const size = /(?<![\w-])text-(xs|sm|base|lg|xl|2xl|3xl|4xl)(?![\w-])/.exec(classes);
          const lead = /(?<![\w-])leading-(\d+)(?![\w-])/.exec(classes);
          if (!size || !lead) continue;

          const fontSize = FONT_SIZES[size[1]];
          const lineHeight = LINE_HEIGHTS[lead[1]];
          if (!fontSize || !lineHeight) continue;

          const ratio = lineHeight / fontSize;
          if (ratio < GUARDED_FONT_SCALE) {
            const scaled = (fontSize * GUARDED_FONT_SCALE).toFixed(1);
            offenders.push(
              `${path.relative(ROOT, file).split(path.sep).join('/')}:${index + 1} — ` +
              `${size[0]} in ${lead[0]} is ${ratio.toFixed(2)}x; at ${GUARDED_FONT_SCALE}x the text ` +
              `is ${scaled}px inside a ${lineHeight}px line, so it clips. Drop the leading class ` +
              `and let the platform scale it.`,
            );
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it('measures the ratio the way the rule describes', () => {
    // Guards the guard: if these three stop being violations, the thresholds have drifted.
    expect(LINE_HEIGHTS['7'] / FONT_SIZES['2xl']).toBeCloseTo(1.167, 3);
    expect(LINE_HEIGHTS['9'] / FONT_SIZES['3xl']).toBeCloseTo(1.2, 3);
    expect(LINE_HEIGHTS['5'] / FONT_SIZES.base).toBeCloseTo(1.25, 3);
    // ...and that the tier deliberately left alone is genuinely above the line.
    expect(LINE_HEIGHTS['5'] / FONT_SIZES.sm).toBeGreaterThanOrEqual(GUARDED_FONT_SCALE);
  });
});
