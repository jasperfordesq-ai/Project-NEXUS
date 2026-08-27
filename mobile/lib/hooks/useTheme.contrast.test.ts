// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WCAG AA contrast gate for the mobile theme.
 *
 * This is the one automated check that can catch a whole CLASS of visual bug
 * without a device, an emulator or a screenshot. `LIGHT` and `DARK` are the
 * single source of truth for every literal colour in the app, so one failing
 * token is not one bad screen — it is every label of that kind, everywhere.
 *
 * It found five real failures in light mode when first written (2026-08-18):
 * `textMuted` was 2.45:1 against the page background, against a 4.5 requirement
 * — barely half. `success` on its own tint was 2.91. Those are not marginal
 * misses, and nothing in the suite could see them, because a unit test renders a
 * colour perfectly happily whether or not a human can read it.
 *
 * The ratios are RECOMPUTED here from the same sRGB formula the WCAG definition
 * uses, not asserted against stored numbers. A stored number would pass forever
 * once someone updated it to match a regression; a recomputation cannot.
 *
 * Scope, honestly: this proves the palette is legible. It does not prove any
 * screen USES the palette — 1,506 hardcoded hex literals across 95 files sit
 * outside it (see docs/CURRENT_MOBILE_PRODUCTION_STATUS.md §9), and it says nothing about
 * layout, truncation or touch targets. It is one layer, not the visual testing
 * the app still lacks.
 */

/**
 * 🔴 Mocked because the REAL `@sentry/react-native` starts a `setInterval` at
 * import time (`AsyncExpiringMap` cleanup), and Jest then reports an open handle
 * and refuses to exit. This test only wants two constant objects, but importing
 * `./useTheme` pulls in `themeStore` → `storage` → Sentry.
 *
 * Any new test that transitively imports `lib/storage.ts` needs this mock for the
 * same reason. An open handle is not a cosmetic warning — it can hang the CI job
 * rather than failing it, which is the worst of both outcomes.
 */
jest.mock('@sentry/react-native', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

import { DARK, LIGHT } from './useTheme';

/** WCAG 2.1 relative luminance. */
function relativeLuminance(hex: string): number {
  const normalised = hex.replace('#', '');
  const full =
    normalised.length === 3
      ? normalised
          .split('')
          .map((c) => c + c)
          .join('')
      : normalised;

  const channel = (raw: number): number => {
    const s = raw / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };

  return (
    0.2126 * channel(parseInt(full.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(full.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(full.slice(4, 6), 16))
  );
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

/**
 * Foreground/background pairs that genuinely appear together on screen. A pair
 * is listed here because the UI draws it, not because it is arithmetically
 * possible — asserting on combinations nobody renders would make the gate noisy
 * and get it switched off.
 */
const RENDERED_PAIRS: [foreground: keyof typeof LIGHT, background: keyof typeof LIGHT][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['textSecondary', 'bg'],
  ['textSecondary', 'surface'],
  ['textMuted', 'bg'],
  ['textMuted', 'surface'],
  ['error', 'bg'],
  ['error', 'surface'],
  ['error', 'errorBg'],
  ['success', 'bg'],
  ['success', 'surface'],
  ['success', 'successBg'],
  ['info', 'bg'],
  ['info', 'surface'],
  ['info', 'infoBg'],
  ['warning', 'bg'],
  ['warning', 'surface'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme meets WCAG AA for normal text', (_schemeName, theme) => {
  it.each(RENDERED_PAIRS)('%s on %s', (foreground, background) => {
    const ratio = contrastRatio(theme[foreground], theme[background]);

    // Asserted as an object so the failure diff carries the measured ratio and the
    // two hex values. Jest's `expect` takes no message argument (that is Vitest),
    // and "expected 4.5, received 2.45" with no colours named is not actionable.
    const describePair =
      `${String(foreground)} (${theme[foreground]}) on ${String(background)} (${theme[background]})`;

    expect({
      pair: describePair,
      ratio: Number(ratio.toFixed(2)),
      meetsAA: ratio >= AA_NORMAL_TEXT,
    }).toEqual({
      pair: describePair,
      ratio: Number(ratio.toFixed(2)),
      meetsAA: true,
    });
  });
});

describe('theme structure', () => {
  it('defines the same keys in both schemes, so no token is missing in one mode', () => {
    // A key present in one scheme only renders as `undefined` at runtime, which
    // React Native quietly treats as "no colour" rather than erroring.
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('uses only parseable colour values', () => {
    // `overlay` is deliberately rgba() — it is a scrim, not text, and is
    // excluded from the contrast pairs above for that reason.
    for (const [scheme, theme] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      for (const [key, value] of Object.entries(theme)) {
        const isHex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
        const isRgba = /^rgba?\([\d.,\s]+\)$/.test(value);
        expect({ token: `${scheme}.${key}`, value, parseable: isHex || isRgba }).toEqual({
          token: `${scheme}.${key}`,
          value,
          parseable: true,
        });
      }
    }
  });

  it('keeps the three text weights visually ordered, strongest first', () => {
    // If textMuted ever became darker than textSecondary the hierarchy would
    // invert and "muted" would read as emphasis.
    for (const theme of [LIGHT, DARK]) {
      const onSurface = (k: keyof typeof LIGHT) => contrastRatio(theme[k], theme.surface);
      expect(onSurface('text')).toBeGreaterThan(onSurface('textSecondary'));
      expect(onSurface('textSecondary')).toBeGreaterThan(onSurface('textMuted'));
    }
  });
});
