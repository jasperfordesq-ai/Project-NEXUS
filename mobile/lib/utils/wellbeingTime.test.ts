// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  calendarDayRelativeTo,
  formatCalendarDate,
  formatWellbeingDateTime,
  parseLocalCalendarDate,
  parseWellbeingTime,
} from './wellbeingTime';

describe('parseWellbeingTime', () => {
  it('reads the legacy Y-m-d H:i:s form as UTC, not local time', () => {
    expect(parseWellbeingTime('2026-10-21 14:05:00')?.toISOString()).toBe('2026-10-21T14:05:00.000Z');
  });

  it('reads ISO-8601 with an offset as the instant it names', () => {
    expect(parseWellbeingTime('2026-10-21T14:05:00+00:00')?.toISOString()).toBe('2026-10-21T14:05:00.000Z');
    expect(parseWellbeingTime('2026-10-21T15:05:00+01:00')?.toISOString()).toBe('2026-10-21T14:05:00.000Z');
    expect(parseWellbeingTime('2026-10-21T09:05:00-0500')?.toISOString()).toBe('2026-10-21T14:05:00.000Z');
    expect(parseWellbeingTime('2026-10-21T14:05:00.250Z')?.toISOString()).toBe('2026-10-21T14:05:00.250Z');
  });

  it('gives the same instant for the legacy and the ISO shape of one stamp', () => {
    expect(parseWellbeingTime('2026-10-20 16:05:00')?.getTime()).toBe(parseWellbeingTime('2026-10-20T16:05:00+00:00')?.getTime());
  });

  it('refuses what is not a time', () => {
    expect(parseWellbeingTime(null)).toBeNull();
    expect(parseWellbeingTime('')).toBeNull();
    expect(parseWellbeingTime('yesterday')).toBeNull();
    expect(parseWellbeingTime('2026-02-31 10:00:00')).toBeNull();
    expect(parseWellbeingTime('2026-10-21')).toBeNull();
  });
});

describe('parseLocalCalendarDate', () => {
  it('builds a rest day as a LOCAL calendar date, so it never shows the day before', () => {
    const date = parseLocalCalendarDate('2026-10-22');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(22);
    expect(date?.getHours()).toBe(0);
  });

  it('refuses a date that does not exist or is not a date', () => {
    expect(parseLocalCalendarDate('2026-02-30')).toBeNull();
    expect(parseLocalCalendarDate('22/10/2026')).toBeNull();
    expect(parseLocalCalendarDate(undefined)).toBeNull();
  });

  it('formats the calendar day it was given', () => {
    expect(formatCalendarDate('2026-10-22')).toMatch(/22/);
    expect(formatWellbeingDateTime('nonsense')).toBeNull();
  });
});

describe('calendarDayRelativeTo', () => {
  const now = new Date(2026, 9, 21, 9, 0);
  it('says today, yesterday or earlier on the member\'s own calendar', () => {
    expect(calendarDayRelativeTo(new Date(2026, 9, 21, 0, 30), now)).toBe('today');
    expect(calendarDayRelativeTo(new Date(2026, 9, 20, 23, 59), now)).toBe('yesterday');
    expect(calendarDayRelativeTo(new Date(2026, 9, 19, 12, 0), now)).toBe('earlier');
  });
});
