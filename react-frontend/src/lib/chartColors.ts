// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { paletteFor } from './categoryColours';
import { mixHex } from './colorContrast';

/** Fixed chart palette for categorical data that should stay stable across themes. */
export const CHART_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#ec4899', // pink
  '#84cc16', // lime
];

/** Fixed semantic chart colors retained for reports that need export-stable colors. */
export const CHART_COLOR_MAP = {
  primary: '#6366f1',
  secondary: '#8b5cf6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  purple: '#7828c8',
  primaryLight: '#a78bfa',
  dangerAlt: '#f31260',
  warningAlt: '#f5a524',
} as const;

export const CHART_TOKEN_COLORS = {
  primary: 'var(--color-primary, #6366f1)',
  secondary: 'var(--color-secondary, #8b5cf6)',
  accent: 'var(--color-accent, #06b6d4)',
  success: 'var(--color-success, #10b981)',
  warning: 'var(--color-warning, #f59e0b)',
  danger: 'var(--color-error, #ef4444)',
  info: 'var(--color-info, #3b82f6)',
  muted: 'var(--text-muted, #64748b)',
  foreground: 'var(--foreground, #0f172a)',
  surface: 'var(--surface-solid, var(--surface-base, #ffffff))',
  surfaceAlt: 'var(--surface-elevated, #f8fafc)',
  border: 'var(--border-default, #e5e7eb)',
} as const;

export type ChartTokenColor = keyof typeof CHART_TOKEN_COLORS;

export function chartTokenColor(token: ChartTokenColor): string {
  return CHART_TOKEN_COLORS[token];
}

// ─── Charts in the community's colours (9 Nov 2026) ───────────────────────────

/**
 * The -500 shade of every colour on the palette wheel (`HUE_WHEEL` in
 * categoryColours.ts), as hex: chart fills and strokes need real colour
 * values, not Tailwind classes.
 */
const SHADE_500: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308',
  green: '#22c55e', emerald: '#10b981', teal: '#14b8a6', cyan: '#06b6d4',
  sky: '#0ea5e9', blue: '#3b82f6', violet: '#8b5cf6', fuchsia: '#d946ef',
  pink: '#ec4899', rose: '#f43f5e',
};

/** The standard colour as painted on the light theme (ThemeContext). */
const STANDARD_CHART_PRIMARY = '#5b5ede';
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export interface ChartPalette {
  /** The community colour itself: the main series. */
  primary: string;
  /** A lighter partner of it, for gradients. */
  primaryLight: string;
  /** The first colour that goes with it, for a second series. */
  secondary: string;
  /** Eight different colours for pie slices and the like, the community's first. */
  categorical: string[];
}

/**
 * Chart colours that go with a community colour: the colour itself first,
 * then the companions `paletteFor` picks for it. Meaningful colours (success
 * green, warning amber, danger red) stay in CHART_COLOR_MAP — use those where a
 * colour means something.
 *
 * Pass the site's accent as shown (`useSiteAccent`, the text shade): on the
 * dark theme it is already lightened to read against the dark page.
 */
export function chartColorsFor(accent: string | null | undefined): ChartPalette {
  const primary = accent && HEX_COLOUR.test(accent) ? accent.toLowerCase() : STANDARD_CHART_PRIMARY;
  const companions = paletteFor(primary)
    .slice(1)
    .map((name) => SHADE_500[name])
    .filter((hex): hex is string => Boolean(hex) && hex !== primary);
  return {
    primary,
    primaryLight: mixHex(primary, '#ffffff', 0.4),
    secondary: companions[0] ?? CHART_COLOR_MAP.secondary,
    categorical: [primary, ...companions].slice(0, 8),
  };
}
