// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  eventIsoToLocalInput,
  eventLocalInputToIso,
  eventLocalInputToOffsetIso,
} from './eventLocalDateTime';

describe('event-local date/time conversion', () => {
  it('renders an instant in the Event IANA timezone', () => {
    expect(eventIsoToLocalInput('2030-06-01T09:30:00Z', 'Europe/Dublin'))
      .toBe('2030-06-01T10:30');
  });

  it('round-trips valid wall-clock input to a UTC instant', () => {
    expect(eventLocalInputToIso('2030-06-01T10:30', 'Europe/Dublin'))
      .toBe('2030-06-01T09:30:00.000Z');
  });

  it('rejects a DST gap instead of silently moving the requested time', () => {
    expect(eventLocalInputToIso('2027-03-14T02:30', 'America/New_York')).toBeNull();
  });

  it('rejects a duplicated fall-back wall clock instead of choosing an arbitrary instant', () => {
    expect(eventLocalInputToIso('2027-11-07T01:30', 'America/New_York')).toBeNull();
  });

  it('rejects malformed browser input and invalid IANA zones', () => {
    expect(eventLocalInputToIso('2030-06-01 10:30', 'Europe/Dublin')).toBeNull();
    expect(eventIsoToLocalInput('not-a-date', 'UTC')).toBe('');
    expect(eventLocalInputToIso('2030-06-01T10:30', 'Not/A_Zone')).toBeNull();
    expect(eventIsoToLocalInput('2030-06-01T09:30:00Z', 'Not/A_Zone')).toBe('');
  });

  it('writes the event zone offset so the server offset check accepts it', () => {
    expect(eventLocalInputToOffsetIso('2030-06-01T10:30', 'Europe/Dublin'))
      .toBe('2030-06-01T10:30:00+01:00');
    expect(eventLocalInputToOffsetIso('2030-01-15T10:30', 'Europe/Dublin'))
      .toBe('2030-01-15T10:30:00+00:00');
    expect(eventLocalInputToOffsetIso('2030-06-01T10:30', 'America/New_York'))
      .toBe('2030-06-01T10:30:00-04:00');
    expect(eventLocalInputToOffsetIso('2030-06-01T10:30', 'Asia/Kolkata'))
      .toBe('2030-06-01T10:30:00+05:30');
    expect(Date.parse(eventLocalInputToOffsetIso('2030-06-01T10:30', 'Europe/Dublin') ?? ''))
      .toBe(Date.parse('2030-06-01T09:30:00Z'));
  });

  it('fails closed on DST gaps and malformed input when writing an offset', () => {
    expect(eventLocalInputToOffsetIso('2027-03-14T02:30', 'America/New_York')).toBeNull();
    expect(eventLocalInputToOffsetIso('', 'Europe/Dublin')).toBeNull();
  });
});
