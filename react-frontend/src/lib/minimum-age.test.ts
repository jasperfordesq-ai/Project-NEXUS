// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_UNDER_MINIMUM_AGE,
  DATE_OF_BIRTH_UNDER_MINIMUM_AGE,
  latestAdultDateOfBirth,
  serverMessageFor,
} from './minimum-age';

describe('latestAdultDateOfBirth (adults-only decision 2026-09-25)', () => {
  it('is exactly 18 years before today, so a member born today-18y turns 18 today', () => {
    expect(latestAdultDateOfBirth(new Date(2026, 8, 25))).toBe('2008-09-25');
  });

  it('pads single-digit months and days', () => {
    expect(latestAdultDateOfBirth(new Date(2026, 0, 5))).toBe('2008-01-05');
  });

  it('never rolls a 29 February forward into March, which would admit someone a day too young', () => {
    expect(latestAdultDateOfBirth(new Date(2028, 1, 29))).toBe('2010-02-28');
  });
});

describe('serverMessageFor', () => {
  it('returns the message the server attached to the matching code', () => {
    expect(serverMessageFor([
      { code: 'OTHER', message: 'no' },
      { code: DATE_OF_BIRTH_UNDER_MINIMUM_AGE, message: 'You must be 18.' },
    ], DATE_OF_BIRTH_UNDER_MINIMUM_AGE)).toBe('You must be 18.');
  });

  it('returns nothing when the code is absent or its message is blank', () => {
    expect(serverMessageFor(undefined, ACCOUNT_UNDER_MINIMUM_AGE)).toBeUndefined();
    expect(serverMessageFor([{ code: ACCOUNT_UNDER_MINIMUM_AGE, message: '  ' }], ACCOUNT_UNDER_MINIMUM_AGE)).toBeUndefined();
    expect(serverMessageFor([{ code: 'OTHER', message: 'x' }], ACCOUNT_UNDER_MINIMUM_AGE)).toBeUndefined();
  });
});
