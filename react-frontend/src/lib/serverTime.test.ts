// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  calendarDayFromToday,
  daysBetween,
  formatServerDate,
  formatServerDateTime,
  parseLocalCalendarDate,
  toIsoDateTime,
  parseServerTimestamp,
} from './serverTime';

describe('parseServerTimestamp', () => {
  it('returns null for empty/nullish input', () => {
    expect(parseServerTimestamp(null)).toBeNull();
    expect(parseServerTimestamp(undefined)).toBeNull();
    expect(parseServerTimestamp('')).toBeNull();
  });

  it('passes through an ISO string with a Z marker', () => {
    const d = parseServerTimestamp('2026-04-26T18:00:00Z');
    expect(d?.toISOString()).toBe('2026-04-26T18:00:00.000Z');
  });

  it('passes through an ISO string with a numeric offset', () => {
    const d = parseServerTimestamp('2026-04-26T18:00:00+02:00');
    // +02:00 means the UTC instant is two hours earlier
    expect(d?.toISOString()).toBe('2026-04-26T16:00:00.000Z');
  });

  it('anchors a bare date at UTC noon for stable day-of-month', () => {
    const d = parseServerTimestamp('2026-04-26');
    expect(d?.toISOString()).toBe('2026-04-26T12:00:00.000Z');
  });

  it('promotes a bare MySQL DATETIME to UTC', () => {
    const d = parseServerTimestamp('2026-04-26 18:00:00');
    expect(d?.toISOString()).toBe('2026-04-26T18:00:00.000Z');
  });

  it('returns null for an unparseable value', () => {
    expect(parseServerTimestamp('not-a-date')).toBeNull();
  });

  it('returns null for an invalid zoned-looking value', () => {
    expect(parseServerTimestamp('2026-13-99T99:99:99Z')).toBeNull();
  });
});

describe('formatServerDate', () => {
  it('returns a dash for nullish input', () => {
    expect(formatServerDate(null)).toBe('—');
    expect(formatServerDate(undefined)).toBe('—');
    expect(formatServerDate('garbage')).toBe('—');
  });

  it('renders a non-dash localised date for a valid value', () => {
    const out = formatServerDate('2026-04-26');
    expect(out).not.toBe('—');
    expect(out).not.toBe('Invalid Date');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('formatServerDateTime', () => {
  it('returns a dash for nullish/invalid input', () => {
    expect(formatServerDateTime(null)).toBe('—');
    expect(formatServerDateTime('garbage')).toBe('—');
  });

  it('renders a non-dash localised datetime for a valid value', () => {
    const out = formatServerDateTime('2026-04-26 18:00:00');
    expect(out).not.toBe('—');
    expect(out).not.toBe('Invalid Date');
  });
});

describe('daysBetween', () => {
  it('returns the whole-day difference', () => {
    expect(daysBetween('2026-04-01', '2026-04-11')).toBe(10);
  });

  it('rounds partial days up', () => {
    // 1 day and 1 hour apart -> rounds up to 2
    expect(daysBetween('2026-04-01 00:00:00', '2026-04-02 01:00:00')).toBe(2);
  });

  it('can be zero for the same instant', () => {
    expect(daysBetween('2026-04-01 12:00:00', '2026-04-01 12:00:00')).toBe(0);
  });

  it('can be negative when the range is reversed', () => {
    expect(daysBetween('2026-04-11', '2026-04-01')).toBe(-10);
  });

  it('returns null when either side fails to parse', () => {
    expect(daysBetween(null, '2026-04-01')).toBeNull();
    expect(daysBetween('2026-04-01', null)).toBeNull();
    expect(daysBetween('bad', 'also-bad')).toBeNull();
  });
});

describe('parseLocalCalendarDate', () => {
  it('reads a date-only value as that calendar day in the viewer\'s own zone', () => {
    const d = parseLocalCalendarDate('2026-10-22');
    expect(d).not.toBeNull();
    // Local fields, not UTC fields: the day must never slip to the 21st west of Greenwich.
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(9);
    expect(d?.getDate()).toBe(22);
    expect(d?.getHours()).toBe(0);
  });

  it('refuses anything that is not a real Y-m-d date', () => {
    expect(parseLocalCalendarDate(null)).toBeNull();
    expect(parseLocalCalendarDate('')).toBeNull();
    expect(parseLocalCalendarDate('2026-02-30')).toBeNull();
    expect(parseLocalCalendarDate('2026-10-22 10:00:00')).toBeNull();
    expect(parseLocalCalendarDate('not a date')).toBeNull();
  });
});

describe('calendarDayFromToday', () => {
  const now = new Date(2026, 9, 21, 9, 30); // 21 Oct 2026, 09:30 local

  it('says today for an earlier time on the same local day', () => {
    expect(calendarDayFromToday(new Date(2026, 9, 21, 0, 5), now)).toBe('today');
  });

  it('says yesterday for any time on the previous local day, even under 24 hours ago', () => {
    expect(calendarDayFromToday(new Date(2026, 9, 20, 16, 5), now)).toBe('yesterday');
    expect(calendarDayFromToday(new Date(2026, 9, 20, 0, 1), now)).toBe('yesterday');
  });

  it('says earlier for anything before yesterday', () => {
    expect(calendarDayFromToday(new Date(2026, 9, 19, 23, 59), now)).toBe('earlier');
  });

  it('crosses a month boundary correctly', () => {
    expect(calendarDayFromToday(new Date(2026, 8, 30, 22, 0), new Date(2026, 9, 1, 8, 0))).toBe('yesterday');
  });
});

describe('toIsoDateTime', () => {
  it('reads the database form as UTC', () => {
    expect(toIsoDateTime('2026-10-23 14:00:00')).toBe('2026-10-23T14:00:00Z');
    expect(toIsoDateTime('2026-10-23 14:00:00.123')).toBe('2026-10-23T14:00:00.123Z');
  });

  it('leaves an ISO 8601 value alone', () => {
    expect(toIsoDateTime('2026-10-23T14:00:00+01:00')).toBe('2026-10-23T14:00:00+01:00');
    expect(toIsoDateTime('2026-10-23T14:00:00Z')).toBe('2026-10-23T14:00:00Z');
    expect(toIsoDateTime('2026-10-23T14:00:00.000000Z')).toBe('2026-10-23T14:00:00.000000Z');
    expect(toIsoDateTime('2026-10-23')).toBe('2026-10-23');
  });

  it('returns undefined for nothing', () => {
    expect(toIsoDateTime(null)).toBeUndefined();
    expect(toIsoDateTime(undefined)).toBeUndefined();
    expect(toIsoDateTime('  ')).toBeUndefined();
  });
});
