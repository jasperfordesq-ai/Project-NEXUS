// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Moments in time as the API sends them (21 Oct 2026, wellbeing deep audit).
 *
 * The API is moving its wellbeing times from the bare database form
 * `2026-10-21 14:05:00` to ISO-8601 with an offset (`2026-10-21T14:05:00+00:00`).
 * Both must be read correctly: an older server, or a cached response, still sends
 * the bare form. The bare form carries no zone, and the platform stores UTC
 * (config/app.php `timezone => 'UTC'`), so it is read as UTC — never as the
 * server process's local time, which is what `new Date('2026-10-21 14:05:00')` does.
 *
 * A page rendered on the server does not know the reader's time zone, so a time
 * is shown in UTC and says so ("21 October 2026 at 14:05 UTC"), rather than a
 * bare "14:05" that a reader would take as their own clock.
 */

// Bare database form, optionally with a T and/or fractional seconds, and NO zone.
const BARE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
// ISO-8601 that names its zone: Z, +hh:mm, +hhmm or +hh.
const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i;

/** The moment the API meant, or null when the value is missing or not a time. */
function parseApiInstant(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;

  const bare = text.match(BARE);
  if (bare) {
    const [, year, month, day, hour, minute, second] = bare.map((part) => (part === undefined ? undefined : Number(part)));
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (ZONED.test(text)) {
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

/** Date-and-time options that show the moment in UTC and name the zone. */
const UTC_DATE_TIME_OPTIONS = Object.freeze({
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
  timeZoneName: 'short'
});

/** "21 October 2026 at 14:05 UTC" in the given Intl locale, or '' for no time. */
function formatApiDateTime(value, intlLocale = 'en-GB', options = {}) {
  const date = parseApiInstant(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(intlLocale, { ...UTC_DATE_TIME_OPTIONS, ...options }).format(date);
}

module.exports = {
  UTC_DATE_TIME_OPTIONS,
  formatApiDateTime,
  parseApiInstant
};
