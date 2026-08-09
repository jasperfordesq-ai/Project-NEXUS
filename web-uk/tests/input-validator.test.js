// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { isValidEmail } = require('../src/lib/inputValidator');

describe('isValidEmail', () => {
  test.each([
    'person@example.org',
    'first.last+updates@community.example'
  ])('accepts %s', (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  test.each([
    '',
    'missing-at.example.org',
    '@example.org',
    'person@localhost',
    'person@example.',
    'person @example.org',
    `person@${'a'.repeat(250)}.org`
  ])('rejects %s', (email) => {
    expect(isValidEmail(email)).toBe(false);
  });
});
