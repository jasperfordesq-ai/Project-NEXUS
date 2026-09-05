// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { dateLocale } from '@/lib/utils/dateLocale';

/**
 * Parse a number a member typed, whatever their locale's decimal mark.
 *
 * 🔴 `Number('1,5')` is NaN and `parseFloat('1,5')` is 1 — the second is worse,
 * because it silently books the wrong number of hours. Half the app's locales
 * (de, es, fr, it, pt) write decimals with a comma, and Android's decimal keypad
 * emits whichever mark the device locale uses. Found by the 2026-09-05 audit
 * (F06); before it, the listing forms rejected "1,5" as invalid credits.
 *
 * Rules: whitespace (incl. NBSP) is ignored; when both `,` and `.` appear the
 * LAST one is the decimal mark and the other is a thousands separator; a lone
 * `,` is a decimal mark. Returns null for anything that is not a finite number.
 */
export function parseDecimalInput(value: string | null | undefined): number | null {
  if (value == null) return null;
  let s = String(value).replace(/[\s  ]/g, '');
  if (s === '') return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // "1,234" is ambiguous; a single comma is far more often a decimal mark in the
    // app's comma locales than a thousands separator in a time-credit field.
    s = s.replace(',', '.');
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Format a number for display in the member's locale (e.g. "1,5" in German).
 * Integers print without a fraction unless `minFractionDigits` says otherwise.
 */
export function formatDecimal(
  value: number,
  maxFractionDigits = 1,
  minFractionDigits = 0,
): string {
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(dateLocale(), {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    }).format(value);
  } catch {
    // Intl is available on Hermes, but keep a deterministic fallback.
    return Number.isInteger(value) && minFractionDigits === 0 ? String(value) : value.toFixed(maxFractionDigits);
  }
}
