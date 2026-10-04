// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Stock GOV.UK-style header colours used when a community sets none. */
export const DEFAULT_HEADER_BG = '#0b0c0c';
export const DEFAULT_HEADER_ACCENT = '#1d70b8';

/** True for a full six-digit hex colour, with or without the leading '#'. */
export function isHexColor(value: string): boolean {
  return /^#?[0-9a-fA-F]{6}$/.test(value.trim());
}

/**
 * Mirror of AlphaController::readableForeground — pick white or near-black
 * text for the live preview so it matches what the accessible header actually
 * renders (WCAG relative-luminance contrast, whichever foreground wins).
 */
export function readableHeaderText(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const v = m?.[1];
  if (!v) return '#ffffff';
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L =
    0.2126 * lin(parseInt(v.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(v.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(v.slice(4, 6), 16));
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#0b0c0c';
}
