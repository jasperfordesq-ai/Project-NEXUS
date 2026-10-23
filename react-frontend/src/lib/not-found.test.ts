// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { isNotFoundResponse } from './not-found';

describe('isNotFoundResponse', () => {
  it.each(['NOT_FOUND', 'RESOURCE_NOT_FOUND', 'HTTP_404', 'HTTP_410'])('treats %s as missing', (code) => {
    expect(isNotFoundResponse({ success: false, code })).toBe(true);
  });

  it('reads the code from the error list too', () => {
    expect(isNotFoundResponse({ success: false, errors: [{ code: 'NOT_FOUND' }] })).toBe(true);
    expect(isNotFoundResponse({ success: false, errors: [{ code: 'SERVER_ERROR' }] })).toBe(false);
  });

  it('treats a successful answer with no record as missing', () => {
    expect(isNotFoundResponse({ success: true, data: null })).toBe(true);
    expect(isNotFoundResponse({ success: true })).toBe(true);
  });

  it('never treats a server or network failure as missing', () => {
    for (const code of ['SERVER_ERROR', 'HTTP_500', 'SERVICE_UNAVAILABLE', 'NETWORK_ERROR', 'TIMEOUT', 'FORBIDDEN', undefined]) {
      expect(isNotFoundResponse({ success: false, code })).toBe(false);
    }
    expect(isNotFoundResponse(null)).toBe(false);
  });

  it('does not treat a found record as missing', () => {
    expect(isNotFoundResponse({ success: true, data: { id: 1 } })).toBe(false);
  });
});
