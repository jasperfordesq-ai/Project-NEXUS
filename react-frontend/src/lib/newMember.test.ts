// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { NEW_MEMBER_DAYS, isNewMember } from './newMember';

describe('isNewMember', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

  it('is true for the first 30 days and false from the 30th day on', () => {
    expect(NEW_MEMBER_DAYS).toBe(30);
    expect(isNewMember(daysAgo(0), now)).toBe(true);
    expect(isNewMember(daysAgo(29.9), now)).toBe(true);
    expect(isNewMember(daysAgo(30), now)).toBe(false);
    expect(isNewMember(daysAgo(400), now)).toBe(false);
  });

  it('reads the "YYYY-MM-DD HH:MM:SS" form the members list sends (older Safari cannot parse the space)', () => {
    expect(isNewMember('2026-11-06 19:24:49', now)).toBe(true);
    expect(isNewMember('2026-08-29 17:24:46', now)).toBe(false);
  });

  it('is false for a missing, unreadable or future date', () => {
    expect(isNewMember(null, now)).toBe(false);
    expect(isNewMember(undefined, now)).toBe(false);
    expect(isNewMember('', now)).toBe(false);
    expect(isNewMember('not a date', now)).toBe(false);
    expect(isNewMember(daysAgo(-2), now)).toBe(false);
  });
});
