// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ApiResponseError } from '@/lib/api/client';
import { isRefusal, refusalStatus } from './refusal';

describe('refusalStatus', () => {
  it.each([401, 403, 404])('treats %i as a refusal', (status) => {
    expect(refusalStatus(new ApiResponseError(status, 'no'))).toBe(status);
    expect(isRefusal(new ApiResponseError(status, 'no'))).toBe(true);
  });

  it.each([500, 502, 503, 504])('does not treat %i as a refusal — retrying can work', (status) => {
    expect(refusalStatus(new ApiResponseError(status, 'boom'))).toBeNull();
    expect(isRefusal(new ApiResponseError(status, 'boom'))).toBe(false);
  });

  it('does not treat a validation failure as a refusal', () => {
    // 422 means "fix your input", which is neither a dead end nor a retry.
    expect(isRefusal(new ApiResponseError(422, 'Name is required'))).toBe(false);
  });

  it('does not treat a dropped connection as a refusal', () => {
    // `lib/api/client.ts` wraps network failures as status 0. Retrying those IS the fix.
    expect(isRefusal(new ApiResponseError(0, 'Network request failed'))).toBe(false);
    expect(isRefusal(new TypeError('Network request failed'))).toBe(false);
  });

  it('is safe on things that are not errors at all', () => {
    expect(refusalStatus(null)).toBeNull();
    expect(refusalStatus(undefined)).toBeNull();
    expect(refusalStatus('403')).toBeNull();
    expect(refusalStatus({ status: 403 })).toBeNull();
  });
});
