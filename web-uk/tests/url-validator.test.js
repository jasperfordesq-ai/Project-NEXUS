// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { validateReturnUrl } = require('../src/lib/urlValidator');

describe('validateReturnUrl', () => {
  test.each([
    '/dashboard',
    '/search?q=community#results',
    '/members/%E2%82%AC'
  ])('keeps a local return path: %s', (path) => {
    expect(validateReturnUrl(path, '/fallback')).toBe(path);
  });

  test.each([
    'https://example.test/path',
    '//example.test/path',
    '/\\example.test/path',
    '/%5Cexample.test/path',
    '/%2F%2Fexample.test/path',
    '/%252F%252Fexample.test/path',
    '/safe%0D%0ALocation%3A%20https%3A%2F%2Fexample.test',
    '/broken%escape'
  ])('rejects an unsafe or malformed return path: %s', (path) => {
    expect(validateReturnUrl(path, '/fallback')).toBe('/fallback');
  });

  test('uses the fallback for missing and non-string values', () => {
    expect(validateReturnUrl('', '/fallback')).toBe('/fallback');
    expect(validateReturnUrl(null, '/fallback')).toBe('/fallback');
    expect(validateReturnUrl({ path: '/dashboard' }, '/fallback')).toBe('/fallback');
  });
});
