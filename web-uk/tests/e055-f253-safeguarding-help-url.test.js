// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E-055 F-253 (F-207 residual) — a safeguarding option's help link reaches an
 * `href` on the onboarding page every new member sees. The API only accepts
 * https:// help links, but a value stored before that check (or by any other
 * path) must not become a javascript:/data:/http link here either: web-uk keeps
 * a help link only when it is a well-formed https URL.
 */

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  ApiOfflineError: class ApiOfflineError extends Error {}
}));

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const { normalizeSafeguardingOption } = require('../src/routes/onboarding-posts');

describe('safeguarding option help links (F-253)', () => {
  it.each([
    ['javascript:alert(document.domain)'],
    ['JavaScript:alert(1)'],
    [' javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['http://example.test/help'],
    ['//evil.example/help'],
    ['/relative/help'],
    ['https://'],
    ['https://localhost/help']
  ])('drops an unsafe or non-https help link: %s', (value) => {
    expect(normalizeSafeguardingOption({ id: 1, label: 'x', help_url: value }).help_url).toBe('');
  });

  it('keeps a well-formed https help link (control)', () => {
    expect(normalizeSafeguardingOption({ id: 1, label: 'x', help_url: 'https://example.test/help?a=1' }).help_url)
      .toBe('https://example.test/help?a=1');
    expect(normalizeSafeguardingOption({ id: 1, label: 'x' }).help_url).toBe('');
  });
});
