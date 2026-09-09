// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  addHoursToInput,
  formatLocalDateInput,
  formatLocalDateTimeInput,
  nextWholeHourInput,
  parseLocalDateInput,
  parseLocalDateTimeInput,
} from './dateTimeInput';

describe('typed date fields', () => {
  it('accepts the shape the app asks for, with a space or a T', () => {
    expect(parseLocalDateTimeInput('2026-09-08 18:30')).not.toBeNull();
    expect(parseLocalDateTimeInput('2026-09-08T18:30')).not.toBeNull();
    expect(parseLocalDateTimeInput('2026-09-08 18:30:00')).not.toBeNull();
  });

  /**
   * 🔴 The values a member actually types when nothing is checking. Each of these used to
   * be sent to the server exactly as written.
   */
  it.each([
    'next Tuesday',
    '12/09/2026',
    '8 Sept 6.30pm',
    '2026-09-08',
    '2026-09-08 18',
    '',
    '   ',
  ])('refuses %p rather than sending it', (value) => {
    expect(parseLocalDateTimeInput(value)).toBeNull();
  });

  /**
   * 🔴 The right shape and not a real day. Some engines roll 31 February into 3 March, so
   * the member would have booked a slot on a date they never chose.
   */
  it('refuses a date that is not a real day instead of rolling it forward', () => {
    expect(parseLocalDateTimeInput('2026-02-31 10:00')).toBeNull();
    expect(parseLocalDateTimeInput('2026-13-01 10:00')).toBeNull();
  });

  it('round-trips through the editor field without drifting', () => {
    const typed = '2026-09-08 18:30';
    const iso = parseLocalDateTimeInput(typed);
    expect(iso).not.toBeNull();
    expect(formatLocalDateTimeInput(iso)).toBe(typed);
  });

  it('reads a date-only field and gives back local midnight', () => {
    const iso = parseLocalDateInput('2026-09-08');
    expect(iso).not.toBeNull();
    expect(formatLocalDateTimeInput(iso)).toBe('2026-09-08 00:00');
    expect(parseLocalDateInput('2026-09-08 18:30')).toBeNull();
  });

  it('formats an empty or unparseable stored value as an empty field', () => {
    expect(formatLocalDateTimeInput(null)).toBe('');
    expect(formatLocalDateTimeInput('not a date')).toBe('');
    expect(formatLocalDateInput(null)).toBe('');
  });

  it('quick fill lands on the next whole hour, today or a day ahead', () => {
    const now = new Date('2026-09-08T18:17:42');
    expect(nextWholeHourInput(0, now)).toBe('2026-09-08 19:00');
    expect(nextWholeHourInput(1, now)).toBe('2026-09-09 19:00');
  });

  it('adds hours without changing the shape, and leaves rubbish alone', () => {
    expect(addHoursToInput('2026-09-08 19:00', 1)).toBe('2026-09-08 20:00');
    expect(addHoursToInput('2026-09-08 23:30', 1)).toBe('2026-09-09 00:30');
    expect(addHoursToInput('next Tuesday', 1)).toBe('next Tuesday');
  });
});
