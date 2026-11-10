// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the soft glow in a page opening never costs a label its contrast.
 *
 * A page opening (PublicPageHero) has a blurred patch of a second colour in
 * its top corner (warmth plan P1). Small labels can sit over it: the chip
 * above the title on a phone, a "4 new" chip beside the buttons. Those labels
 * are tuned close to 4.5:1 on the panel's own tint, so the patch must not make
 * the surface under them darker (light theme) or brighter (dark theme) than
 * the panel already is.
 *
 * The first version was a see-through -400 at 25%. Over a pale-yellow
 * community's panel it took the chip from 4.64:1 to 3.88:1 (browser, 10 Nov
 * 2026). `.hero-glow` in styles/glass.css is now a SOLID mix: mostly white on
 * the light theme, mostly the page colour on the dark theme. This test works
 * out that mix for every hue on the colour wheel, from Tailwind's own values.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { HUE_WHEEL } from '@/lib/categoryColours';

const GLASS = fs.readFileSync(path.resolve(__dirname, '../styles/glass.css'), 'utf8');
const THEME = fs.readFileSync(path.resolve(__dirname, '../../node_modules/tailwindcss/theme.css'), 'utf8');
const HERO = fs.readFileSync(path.resolve(__dirname, '../components/public/PublicPageHero.tsx'), 'utf8');

type Lab = [number, number, number];

function shade(name: string, step: number): Lab {
  const m = new RegExp(String.raw`--color-${name}-${step}:\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)`).exec(THEME);
  expect(m, `Tailwind defines ${name}-${step}`).not.toBeNull();
  const hue = (Number(m![3]) * Math.PI) / 180;
  return [Number(m![1]) / 100, Number(m![2]) * Math.cos(hue), Number(m![2]) * Math.sin(hue)];
}

/** Relative luminance (WCAG) of an oklab colour. */
function luminance([L, a, b]: Lab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

const mix = (colour: Lab, share: number, base: Lab): Lab =>
  [0, 1, 2].map((i) => colour[i]! * share + base[i]! * (1 - share)) as Lab;

const WHITE: Lab = [1, 0, 0];
/** The dark page, #0c0a09 (tokens.css --background), as oklab. */
const DARK_PAGE: Lab = [0.147, 0.002, 0.003];

function share(pattern: RegExp, what: string): number {
  const m = pattern.exec(GLASS);
  expect(m, `glass.css sets the ${what} glow as a mix`).not.toBeNull();
  return Number(m![1]) / 100;
}

const lightShare = () => share(
  /\n\.hero-glow\s*\{\s*background-color:\s*color-mix\(in oklab, var\(--glow-hue, var\(--companion\)\) (\d+)%, white\)/,
  'light',
);
const darkShare = () => share(
  /:root\[data-theme="dark"\] \.hero-glow\s*\{\s*background-color:\s*color-mix\(in oklab, var\(--glow-hue, var\(--companion\)\) (\d+)%, var\(--background\)\)/,
  'dark',
);

describe('the glow in a page opening', () => {
  it('is a pale solid on the light theme: never darker than the panel under it, for any hue', () => {
    // The darkest light panel measured (a pale-yellow community) has a
    // luminance of about 0.80; a glow at or above that cannot lower contrast.
    for (const { name } of HUE_WHEEL) {
      expect(luminance(mix(shade(name, 500), lightShare(), WHITE)), name).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('is a dim solid on the dark theme: never brighter than the panel under it, for any hue', () => {
    // The dark panel is the community colour at 18% over the page. The dimmest
    // one measured, a red community's, has a luminance of 0.0128; light text
    // loses contrast only if the glow is brighter than the panel. (At 22% an
    // amber glow reached 0.02 and a red label on it read at 4.43:1.)
    for (const { name } of HUE_WHEEL) {
      expect(luminance(mix(shade(name, 400), darkShare(), DARK_PAGE)), name).toBeLessThanOrEqual(0.0128);
    }
  });

  it('still shows as a colour', () => {
    expect(lightShare()).toBeGreaterThanOrEqual(0.1);
    expect(darkShare()).toBeGreaterThanOrEqual(0.1);
  });

  it('is switched off in high-contrast mode', () => {
    expect(GLASS).toMatch(/html\[data-high-contrast="true"\] \.hero-glow\s*\{\s*display:\s*none/);
  });

  it('is only ever given a hue by the page opening, never a see-through fill', () => {
    const glowLines = HERO.split('\n').filter((line) => /^\s*glow: '/.test(line));
    expect(glowLines.length).toBeGreaterThanOrEqual(6);
    for (const line of glowLines) {
      expect(line).toMatch(/\[--glow-hue:var\(--/);
      expect(line).not.toMatch(/\bbg-/);
    }
    expect(HERO).toMatch(/aria-hidden="true"\s+data-hero-glow="true"\s+className=\{`hero-glow pointer-events-none/);
  });
});
