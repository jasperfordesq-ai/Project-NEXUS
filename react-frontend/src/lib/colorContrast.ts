// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const BLACK = '#000000';
const WHITE = '#ffffff';

function hexToRelativeLuminance(color: string): number | null {
  const normalized = color.trim().replace(/^#/, '');
  const hex = normalized.length === 3
    ? normalized.split('').map((character) => character.repeat(2)).join('')
    : normalized;

  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return null;
  }

  const [red = 0, green = 0, blue = 0] = [0, 2, 4].map((offset) => {
    const srgb = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

/**
 * WCAG 2.2 contrast ratio between two hex colours, or null when either is not
 * a valid #rgb / #rrggbb value. The server's App\Support\ColourContrast uses
 * the same formula, so a colour this calls readable the server accepts.
 */
export function getContrastRatio(colorA: string, colorB: string): number | null {
  const a = hexToRelativeLuminance(colorA);
  const b = hexToRelativeLuminance(colorB);
  if (a === null || b === null) {
    return null;
  }
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Minimum ratio for normal-size text (WCAG 2.2 AA, 1.4.3). */
export const AA_NORMAL_TEXT_CONTRAST = 4.5;

function mixHex(color: string, towards: string, amount: number): string {
  const parse = (value: string) => {
    const hex = value.trim().replace(/^#/, '');
    const full = hex.length === 3 ? hex.split('').map((c) => c.repeat(2)).join('') : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16));
  };
  const from = parse(color);
  const to = parse(towards);
  return `#${from
    .map((channel, index) => Math.round(channel + ((to[index] ?? 0) - channel) * amount))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/**
 * The colour itself when it already reads at `minRatio` against `background`;
 * otherwise the least-mixed shade towards `towards` (white by default) that
 * does. Used to keep a community's colour readable as link text on the dark
 * theme without losing its hue. Returns the input unchanged when it is not a
 * valid hex colour.
 */
export function ensureContrast(
  color: string,
  background: string,
  minRatio = AA_NORMAL_TEXT_CONTRAST,
  towards = WHITE,
): string {
  const start = getContrastRatio(color, background);
  if (start === null || start >= minRatio) {
    return color;
  }
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(color, towards, step / 20);
    const ratio = getContrastRatio(candidate, background);
    if (ratio !== null && ratio >= minRatio) {
      return candidate;
    }
  }
  return towards;
}

/**
 * Return the black or white foreground with the higher WCAG contrast ratio.
 * At least one of these two colors always reaches 4.5:1 for a valid solid
 * background, including mid-tone brand colors near the crossover point.
 */
export function getAccessibleForegroundColor(
  backgroundColor: string,
  fallback = WHITE,
): string {
  const luminance = hexToRelativeLuminance(backgroundColor);
  if (luminance === null) {
    return fallback;
  }

  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);

  return blackContrast >= whiteContrast ? BLACK : WHITE;
}
