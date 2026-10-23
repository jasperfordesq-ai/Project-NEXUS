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
 * A date-only server value (`YYYY-MM-DD`) as that calendar day in the viewer's
 * own zone (local midnight). Use it for days a person plans around — a
 * suggested rest day is "Thursday 22nd" wherever the reader is — where
 * `new Date('2026-10-22')` would be UTC midnight and print the 21st west of
 * Greenwich. Returns `null` for anything that is not a real calendar date.
 */
export function parseLocalCalendarDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const d = new Date(year, month, day);
  // Reject roll-overs such as 30 February.
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

/**
 * Which local calendar day `date` falls on, relative to `now`: today,
 * yesterday, or earlier. Compares calendar days in the viewer's zone, not
 * 24-hour spans, so 16:05 yesterday is "yesterday" even at 09:30 today.
 * A future instant counts as today.
 */
export function calendarDayFromToday(date: Date, now: Date = new Date()): 'today' | 'yesterday' | 'earlier' {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (date.getTime() >= startOfToday.getTime()) return 'today';
  const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.getTime() >= startOfYesterday.getTime()) return 'yesterday';
  return 'earlier';
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


/** "YYYY-MM-DD HH:MM:SS" (optionally with fractional seconds), no zone. */
const MYSQL_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/;

/**
 * Turn a server date-time into ISO 8601 for structured data and Open Graph.
 *
 * Some endpoints send the database form "2026-10-23 14:00:00", which is not
 * ISO 8601 (no "T", no zone) and which Google's Article rich result rejects.
 * The database stores UTC, so that form is read as UTC ("2026-10-23T14:00:00Z").
 * Anything else — already ISO, a date only, or empty — is returned unchanged.
 */
export function toIsoDateTime(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const match = MYSQL_DATETIME.exec(trimmed);
  return match ? `${match[1]}T${match[2]}Z` : trimmed;
}
