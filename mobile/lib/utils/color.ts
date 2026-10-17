// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Add alpha (opacity) to a hex color string.
 *
 * Works with 3-digit (#RGB), 6-digit (#RRGGBB), or raw RRGGBB hex strings.
 * Falls back gracefully: if the input is not a valid hex color, returns
 * a transparent fallback so the UI never crashes.
 *
 * @param hex    The base color, e.g. '#3B82F6' or '3B82F6'
 * @param alpha  Opacity from 0 (transparent) to 1 (opaque)
 * @returns      8-digit hex string '#RRGGBBAA'
 */
export function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const alphaHex = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');

  // Strip leading # if present
  let raw = hex.replace(/^#/, '');

  // Expand 3-digit shorthand (#RGB → RRGGBB)
  if (raw.length === 3) {
    raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
  }

  // Validate we have a 6-digit hex
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    // Fallback: return a semi-transparent gray
    return `#9ca3af${alphaHex}`;
  }

  return `#${raw}${alphaHex}`;
}

/**
 * Return either '#FFFFFF' or '#000000' depending on which provides
 * better contrast against the given background color (WCAG luminance).
 *
 * @param bgHex  Background hex color, e.g. '#3B82F6'
 * @returns      '#FFFFFF' or '#000000'
 */
export function contrastText(bgHex: string): string {
  const L = relativeLuminance(bgHex);
  if (L === null) {
    return '#FFFFFF'; // default to white on unknown
  }

  // Luminance > 0.179 → dark text has better contrast
  return L > 0.179 ? '#000000' : '#FFFFFF';
}

/** WCAG 2.x relative luminance, or null when the string is not a hex colour. */
function relativeLuminance(hex: string): number | null {
  let raw = hex.replace(/^#/, '');

  if (raw.length === 3) {
    raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
  }

  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;

  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;

  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * WCAG 2.x contrast ratio between two hex colours (1 to 21). An unparseable colour is
 * treated as mid-grey so a bad theme value degrades rather than throws.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a) ?? 0.2;
  const lb = relativeLuminance(b) ?? 0.2;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Sky tints for the "read" double tick: light on a dark bubble, deep on a pale one. */
const READ_TICK_ON_DARK = '#7DD3FC';
const READ_TICK_ON_LIGHT = '#0369A1';

/**
 * The colour of the "read" double tick on the member's own bubble, which is painted in the
 * community colour. A fixed blue vanishes on a blue community, so the tint is picked against
 * the actual primary and must reach 3:1 (WCAG non-text contrast); otherwise the tick falls
 * back to the bubble's text colour, which is always legible by construction.
 */
export function readReceiptColor(primary: string): string {
  const onPrimary = contrastText(primary);
  const candidate = onPrimary === '#FFFFFF' ? READ_TICK_ON_DARK : READ_TICK_ON_LIGHT;
  return contrastRatio(candidate, primary) >= 3 ? candidate : onPrimary;
}
