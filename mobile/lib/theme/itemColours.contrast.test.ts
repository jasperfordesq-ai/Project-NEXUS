// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every item colour must stay readable (WCAG AA) in light and dark.
 *
 * Category labels and figures draw words on a band; covers draw an icon on a
 * gradient. The dark sets are tints, so they are composited over the surfaces
 * they actually sit on (a card and the page) before measuring. Ratios are
 * recomputed from the colours, never stored.
 */

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));

import { contrastRatio } from '@/lib/utils/color';
import { DARK, LIGHT } from '@/lib/hooks/useTheme';
import { bandColours, coverColours, HUE_WHEEL } from './itemColours';

const NAMES = [...HUE_WHEEL.map(({ name }) => name), 'gray', 'slate', 'purple', 'indigo', 'unknown'];

function parse(colour: string): { rgb: [number, number, number]; alpha: number } {
  const rgba = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(colour);
  if (rgba) return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: Number(rgba[4]) };
  const value = parseInt(colour.slice(1), 16);
  return { rgb: [(value >> 16) & 255, (value >> 8) & 255, value & 255], alpha: 1 };
}

/** The colour seen when `top` (possibly translucent) is painted on solid `under`. */
function over(top: string, under: string, alpha?: number): string {
  const a = parse(top);
  const b = parse(under);
  const opacity = alpha ?? a.alpha;
  const mixed = a.rgb.map((channel, i) => Math.round(channel * opacity + b.rgb[i]! * (1 - opacity)));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

describe('item colours are readable', () => {
  it.each(NAMES)('%s label text clears 4.5:1 in light mode on cards and the page', (name) => {
    const band = bandColours(name, 'light');
    for (const surface of [LIGHT.surface, LIGHT.bg]) {
      expect(contrastRatio(band.text, over(band.background, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(NAMES)('%s label text clears 4.5:1 in dark mode on cards and the page', (name) => {
    const band = bandColours(name, 'dark');
    for (const surface of [DARK.surface, DARK.bg]) {
      expect(contrastRatio(band.text, over(band.background, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });

  // A cover's icon is a picture, not words (WCAG 1.4.11 asks 3:1 of graphics),
  // and it is decorative: screen readers skip it. Words never sit straight on a
  // cover in the app — a label on a cover goes on its own band (above). On the
  // deepest light stop (-300) four colours give the icon 4.1–4.4:1, which is
  // why this is 3:1 and not 4.5:1; that is the website's own cover too.
  it.each(NAMES)('%s cover icon clears 3:1 on every part of its gradient, light and dark', (name) => {
    for (const scheme of ['light', 'dark'] as const) {
      const cover = coverColours(name, scheme);
      for (const surface of scheme === 'light' ? [LIGHT.surface] : [DARK.surface, DARK.bg]) {
        cover.stops.forEach((stop, i) => {
          const painted = over(stop, surface, cover.opacities[i]);
          // The icon sits on its frosted square, itself on the gradient.
          const tile = over(cover.iconTile, painted);
          expect(contrastRatio(cover.foreground, painted)).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(cover.foreground, tile)).toBeGreaterThanOrEqual(3);
        });
      }
    }
  });
});
