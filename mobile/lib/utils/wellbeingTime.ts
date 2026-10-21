// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Times and dates on the wellbeing screens (21 Oct 2026, deep audit findings 6 and 13).
 *
 * 🔴 Why this is not `new Date(value)`. The API used to send every wellbeing time as
 * `2026-10-21 14:05:00` — UTC, with no offset (the server runs `config('app.timezone')
 * = 'UTC'`). `new Date()` reads that shape as LOCAL time where it parses it at all, so a
 * member in Ireland saw a stamp an hour out, one in California seven hours out, and
 * "already told today" could mean yesterday. The API now sends ISO-8601 with an offset
 * (`2026-10-21T14:05:00+00:00`), but an older server or cached data can still hand us the
 * legacy form, so both are read here, and the legacy form is read as UTC.
 *
 * The parsing is done by hand rather than by `Date.parse`, so neither shape depends on
 * what the JavaScript engine (Hermes on the phone) happens to accept.
 *
 * 🔴 `suggested_rest_days` are calendar dates (`2026-10-22`), not instants. `new Date
 * ('2026-10-22')` is UTC midnight, which west of Greenwich is the evening of the 21st —
 * so a date-only value is built as a LOCAL calendar date instead.
 */

import { dateLocale } from '@/lib/utils/dateLocale';

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Minutes east of UTC for `Z`, `+01:00`, `+0100`, `-05`. */
function offsetMinutes(offset: string | undefined): number {
  if (!offset || offset.toUpperCase() === 'Z') return 0;
  const sign = offset.startsWith('-') ? -1 : 1;
  const digits = offset.slice(1).replace(':', '');
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  return sign * (hours * 60 + minutes);
}

/**
 * A wellbeing time from the API as an instant, or null when it is missing or not a time.
 * ISO with an offset is honoured; a time with no offset (the legacy `Y-m-d H:i:s`) is UTC.
 */
export function parseWellbeingTime(value: string | null | undefined): Date | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  const match = DATE_TIME.exec(trimmed);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, offset] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s ? Number(s) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const millis = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  // A day that rolled over (31 February) is not the date the server meant.
  const check = new Date(utc);
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return null;
  return new Date(utc - offsetMinutes(offset) * 60_000);
}

/** A `Y-m-d` calendar date as local midnight on that date, or null. Never shifted by a time zone. */
export function parseLocalCalendarDate(value: string | null | undefined): Date | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  const match = DATE_ONLY.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** "21 Oct, 15:05" in the member's language and time zone, or null. */
export function formatWellbeingDateTime(value: string | null | undefined): string | null {
  const date = parseWellbeingTime(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "15:05" in the member's language and time zone. */
export function formatWellbeingClock(date: Date): string {
  return new Intl.DateTimeFormat(dateLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

/** "22 Oct 2026" for a calendar date, or null. */
export function formatCalendarDate(value: string | null | undefined): string | null {
  const date = parseLocalCalendarDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

/** Whether `date` falls today, yesterday or earlier on the member's own calendar. */
export function calendarDayRelativeTo(date: Date, now: Date = new Date()): 'today' | 'yesterday' | 'earlier' {
  const startOf = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const today = startOf(now);
  const day = startOf(date);
  if (day >= today) return 'today';
  const yesterday = startOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  return day >= yesterday ? 'yesterday' : 'earlier';
}
