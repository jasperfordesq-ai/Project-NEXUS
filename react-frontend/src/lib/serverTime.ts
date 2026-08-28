// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Server-time parsing helpers.
 *
 * MySQL TIMESTAMP and DATETIME columns are stored UTC but returned to API
 * consumers as bare strings without a zone marker (e.g. `"2026-04-26 18:00:00"`).
 * JS `new Date(string)` interprets bare datetime strings as **local** time
 * (per ECMA-262 § 21.4.3.2), which silently shifts every "X minutes ago",
 * day-boundary calculation, and expiry comparison by the user's UTC offset.
 *
 * For pure DATE columns (`YYYY-MM-DD`) the same `new Date(string)` returns
 * UTC midnight. Day-of-month then differs across timezones — e.g. a
 * UK-issued `expiry_date='2026-04-26'` viewed in PST would render as
 * Apr 25 because UTC midnight is Apr 25 evening locally. Anchoring the
 * parse at UTC noon makes day-of-month stable across ±12h zones, which is
 * the right behaviour for issue/expiry/birth dates.
 *
 * Usage pattern across the broker panel:
 *
 *   import { parseServerTimestamp, formatServerDate, formatServerDateTime }
 *     from '@/lib/serverTime';
 *
 *   formatServerDate(item.created_at)     // '26/4/2026' or '—'
 *   formatServerDateTime(item.reviewed_at) // '26/4/2026, 18:00:00' or '—'
 *
 * The dashed fallback is intentional — null timestamps render as a dash
 * rather than the JS default 'Invalid Date'.
 */

/**
 * Parse a server-emitted timestamp into a `Date`. Returns `null` for
 * empty/invalid input.
 *
 * - ISO-8601 strings with a Z or numeric offset are passed through.
 * - Bare `YYYY-MM-DD` is anchored at UTC 12:00 (stable day-of-month
 *   across ±12h zones).
 * - Bare `YYYY-MM-DD HH:MM:SS` (MySQL DATETIME) is promoted to ISO UTC
 *   by replacing the space with `T` and appending `Z`.
 */
import { getFormattingLocale } from '@/lib/helpers';
export function parseServerTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  // Already-zoned ISO string — trust it.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Pure date — anchor at UTC noon to keep day-of-month stable.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const d = new Date(value + 'T12:00:00Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // Bare datetime — promote to ISO UTC.
  const d = new Date(value.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Render a server timestamp as a localised date, falling back to a dash. */
export function formatServerDate(value: string | null | undefined): string {
  const d = parseServerTimestamp(value);
  return d ? d.toLocaleDateString(getFormattingLocale()) : '—';
}

/** Render a server timestamp as a localised date+time, falling back to a dash. */
export function formatServerDateTime(value: string | null | undefined): string {
  const d = parseServerTimestamp(value);
  return d ? d.toLocaleString(getFormattingLocale()) : '—';
}

/**
 * Whole-day difference between two server timestamps, rounded UP. Used
 * for "days until expiry" UIs where partial days should round to the
 * next bucket (so a record expiring tomorrow morning still reads as
 * "1 day"). Returns `null` if either side fails to parse.
 */
export function daysBetween(
  fromValue: string | null | undefined,
  toValue: string | null | undefined,
): number | null {
  const from = parseServerTimestamp(fromValue);
  const to = parseServerTimestamp(toValue);
  if (!from || !to) return null;
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}
