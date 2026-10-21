// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reading API times (wellbeing deep audit, 21 Oct 2026). The API is moving its
 * wellbeing times from the bare database form to ISO-8601 with an offset; both must
 * give the same moment, and the bare form is UTC — never the server's local time.
 */

const { formatApiDateTime, parseApiInstant } = require('../src/lib/api-instant');

const MOMENT = Date.UTC(2026, 9, 21, 14, 5, 0);

describe('parseApiInstant', () => {
  it.each([
    '2026-10-21 14:05:00',
    '2026-10-21T14:05:00',
    '2026-10-21 14:05',
    '2026-10-21T14:05:00Z',
    '2026-10-21T14:05:00.000Z',
    '2026-10-21T14:05:00+00:00',
    '2026-10-21T15:05:00+01:00',
    '2026-10-21T07:05:00-07:00',
    '2026-10-21T15:05:00+0100'
  ])('reads %s as 14:05 UTC', (value) => {
    expect(parseApiInstant(value).getTime()).toBe(MOMENT);
  });

  it.each([null, undefined, '', '   ', 'yesterday', '2026-10-22', 42, {}, '2026-13-45 99:99:99x'])('returns null for %p', (value) => {
    expect(parseApiInstant(value)).toBeNull();
  });

  it('passes a valid Date through and rejects an invalid one', () => {
    const date = new Date(MOMENT);
    expect(parseApiInstant(date)).toBe(date);
    expect(parseApiInstant(new Date('nonsense'))).toBeNull();
  });
});

describe('formatApiDateTime', () => {
  it('shows the moment in UTC and names the zone', () => {
    expect(formatApiDateTime('2026-10-21 14:05:00', 'en-GB')).toBe('21 October 2026 at 14:05 UTC');
    expect(formatApiDateTime('2026-10-21T15:05:00+01:00', 'en-GB')).toBe('21 October 2026 at 14:05 UTC');
  });

  it('returns an empty string for something that is not a time', () => {
    expect(formatApiDateTime('', 'en-GB')).toBe('');
    expect(formatApiDateTime('not a time', 'en-GB')).toBe('');
  });
});
