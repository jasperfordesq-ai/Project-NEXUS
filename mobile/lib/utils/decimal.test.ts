// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockLocale = { current: 'en-GB' };
jest.mock('@/lib/utils/dateLocale', () => ({ dateLocale: () => mockLocale.current }));

import { formatDecimal, parseDecimalInput } from './decimal';

describe('parseDecimalInput', () => {
  it.each([
    ['1.5', 1.5],
    ['1,5', 1.5], // 🔴 the audit case: Number('1,5') was NaN and the form rejected it
    ['0,5', 0.5],
    [',5', 0.5],
    ['2', 2],
    [' 1 234,5 ', 1234.5],
    ['1.234,5', 1234.5],
    ['1,234.5', 1234.5],
    ['1 234,50', 1234.5],
  ])('parses %j as %s', (input, expected) => {
    expect(parseDecimalInput(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1.2.3', '1,2,3', '1..5', null, undefined])('rejects %j', (input) => {
    expect(parseDecimalInput(input as string | null | undefined)).toBeNull();
  });
});

describe('formatDecimal', () => {
  it('uses the member locale decimal mark', () => {
    mockLocale.current = 'de-DE';
    expect(formatDecimal(1.5)).toBe('1,5');
    mockLocale.current = 'en-GB';
    expect(formatDecimal(1.5)).toBe('1.5');
  });

  it('prints whole numbers without a fraction by default', () => {
    expect(formatDecimal(3)).toBe('3');
    expect(formatDecimal(3, 1, 1)).toBe('3.0');
  });

  it('rounds to the requested precision and tolerates non-finite input', () => {
    expect(formatDecimal(2.66, 1)).toBe('2.7');
    expect(formatDecimal(Number.NaN)).toBe('');
  });
});
