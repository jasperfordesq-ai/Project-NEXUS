// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  eventIsoToLocalInput,
  eventLocalInputToIso,
  formatEventSchedule,
  shiftEventLocalDate,
} from './eventDateTime';

describe('formatEventSchedule', () => {
  it('formats timed events in the event IANA timezone', () => {
    const result = formatEventSchedule({
      start_at: '2026-08-09T23:30:00Z',
      end_at: '2026-08-10T00:30:00Z',
      timezone: 'Pacific/Auckland',
      all_day: false,
    }, 'en-IE');

    expect(result.dayLabel).toBe('10');
    // Day-first. A bare 'en' renders "August 10, 2026" — see dateLocale.test.ts
    // for why that is the wrong output for this platform's members.
    expect(result.dateLabel).toContain('10 August 2026');
    expect(result.timeLabel).toContain('11:30');
  });

  it('uses the exclusive all-day end boundary across a DST offset change', () => {
    const result = formatEventSchedule({
      start_at: '2026-10-31T04:00:00Z',
      end_at: '2026-11-02T05:00:00Z',
      timezone: 'America/New_York',
      all_day: true,
    }, 'en-IE');

    expect(result.startDateLabel).toContain('31 October 2026');
    expect(result.endDateLabel).toContain('1 November 2026');
    expect(result.dateLabel).not.toContain('2 November 2026');
    expect(result.timeLabel).toBeNull();
  });

  it('round-trips event-local editor values without using the device timezone', () => {
    expect(eventIsoToLocalInput('2030-05-01T17:30:00.000Z', 'America/Los_Angeles'))
      .toBe('2030-05-01T10:30');
    expect(eventLocalInputToIso('2030-05-01T10:30', 'America/Los_Angeles'))
      .toBe('2030-05-01T17:30:00.000Z');
    expect(eventIsoToLocalInput('2030-05-01T00:30:00.000Z', 'Australia/Brisbane'))
      .toBe('2030-05-01T10:30');
  });

  it('rejects nonexistent and ambiguous DST wall clocks', () => {
    expect(eventLocalInputToIso('2026-03-08T02:30', 'America/New_York')).toBeNull();
    expect(eventLocalInputToIso('2026-11-01T01:30', 'America/New_York')).toBeNull();
  });

  it('shifts inclusive all-day dates using calendar arithmetic', () => {
    expect(shiftEventLocalDate('2026-03-08', 1)).toBe('2026-03-09');
    expect(shiftEventLocalDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});
