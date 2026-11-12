// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the VIVID wash behind the page carries more colour on the dark
 * theme, and still never costs text its contrast.
 *
 * The soft wash (`.page-wash`, styles/background.css) is pinned by
 * page-wash.contract.test.ts: it takes only the hue of the community colour
 * and fixes its own lightness, so on the dark theme it is never lighter than a
 * card (#18181b) — the surface community-coloured text is lightened against.
 *
 * A community that chose "vivid" (warmth phase 5) gets a stronger wash on the
 * dark theme: more colour at the same lightness. This test holds the vivid
 * wash to the SAME bound as the soft one, for every hue, so it can never be
 * the reason a word on the page fails. It also checks it really is stronger,
 * that the light theme is not touched, and that high-contrast mode still
 * removes it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.resolve(__dirname, '../styles/background.css'), 'utf8');

/** Relative luminance (WCAG) of an oklch colour, clipped into sRGB. */
function luminance(L: number, C: number, hueDegrees: number): number {
  const h = (hueDegrees * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

function hexLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The two wash colours a block sets, which must share one lightness and chroma. */
function wash(block: string, what: string): { L: number; C: number } {
  const values = [...block.matchAll(/oklch\(from var\(--(?:accent-color|companion)\) ([\d.]+) ([\d.]+) h\)/g)];
  expect(values.length, `${what}: one wash from the community colour, one from its companion`).toBe(2);
  expect(values[0]![1]).toBe(values[1]![1]);
  expect(values[0]![2]).toBe(values[1]![2]);
  return { L: Number(values[0]![1]), C: Number(values[0]![2]) };
}

const VIVID_DARK = /:root\[data-theme="dark"\]\[data-colour-strength="vivid"\] \.page-wash \{[^}]*\}/;

function vividDarkBlock(): string {
  const block = VIVID_DARK.exec(CSS);
  expect(block, 'background.css sets a vivid wash for the dark theme').not.toBeNull();
  return block![0];
}

const softDark = () => wash(/\n {2}\.page-wash \{[^}]*\}/.exec(CSS)![0], 'soft dark');
const vividDark = () => wash(vividDarkBlock(), 'vivid dark');

const HUES = Array.from({ length: 72 }, (_, i) => i * 5);

describe('the vivid wash behind the page', () => {
  it('is never lighter than a dark card, for any hue (card: #18181b)', () => {
    const { L, C } = vividDark();
    const card = hexLuminance('#18181b');
    for (const hue of HUES) {
      expect(luminance(L, C, hue), `hue ${hue}`).toBeLessThanOrEqual(card);
    }
  });

  it('carries more colour than the soft wash, at the same lightness or darker', () => {
    const soft = softDark();
    const strong = vividDark();
    expect(strong.C).toBeGreaterThan(soft.C);
    expect(strong.L).toBeLessThanOrEqual(soft.L);
  });

  // Only the two colours: the picture itself stays the soft wash's, so the
  // high-contrast rule that removes it (a weaker selector) still wins.
  it('changes only the two wash colours', () => {
    const block = vividDarkBlock();
    const properties = [...block.matchAll(/^\s*([a-z-]+):/gm)].map((m) => m[1]);
    expect(properties.sort()).toEqual(['--page-wash-a', '--page-wash-b']);
  });

  it('lives inside the relative-colour check, like the soft one', () => {
    const supports = CSS.indexOf('@supports (color: oklch(from red l c h))');
    const block = CSS.search(VIVID_DARK);
    expect(supports).toBeGreaterThanOrEqual(0);
    expect(block).toBeGreaterThan(supports);
    expect(CSS.indexOf('\n}\n', supports)).toBeGreaterThan(block);
  });

  it('leaves the light theme alone', () => {
    expect(CSS).not.toMatch(/\[data-theme="light"\]\[data-colour-strength="vivid"\]/);
    expect(CSS).not.toMatch(/\[data-colour-strength="vivid"\]\[data-theme="light"\]/);
  });

  it('is still switched off in high-contrast mode', () => {
    expect(CSS).toMatch(/html\[data-high-contrast="true"\] \.page-wash\s*\{\s*background-image:\s*none/);
  });
});
