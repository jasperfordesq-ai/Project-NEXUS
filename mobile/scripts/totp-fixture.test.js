// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { createTotpCode } = require('./totp-fixture.cjs');

describe('disposable E2E TOTP fixture', () => {
  it('matches the RFC 6238 SHA-1 vector after reducing it to six digits', () => {
    expect(createTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59)).toBe('287082');
  });
});
