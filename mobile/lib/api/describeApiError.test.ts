// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 This helper had no test of its own, and it now stands between the server's wording and
 * **165 member-facing failure messages** across 53 screens (journey 7.6). Everything it
 * refuses to pass on is a judgement about what a member should never be shown — an internal
 * 500 description, an HTML error page, a refusal the app answers with its own screen — so
 * each of those rules is pinned here.
 *
 * The sentence in the first case is the real one that started this: walking the volunteering
 * journey on 2026-08-20, logging hours failed, the server said "You have already logged
 * hours for this organization and date", and the member was told only "Could not log these
 * hours" and retried.
 */

import { ApiResponseError } from './client';
import { describeApiError } from './describeApiError';

const FALLBACK = 'Could not log these hours.';

describe('describeApiError', () => {
  it('passes on the server’s explanation when it is fit to show', () => {
    const error = new ApiResponseError(
      422,
      'You have already logged hours for this organization and date',
    );

    expect(describeApiError(error, FALLBACK)).toBe(
      'You have already logged hours for this organization and date',
    );
  });

  it('never shows a 5xx message, which describes an internal failure', () => {
    const error = new ApiResponseError(500, 'SQLSTATE[23000]: Integrity constraint violation');

    expect(describeApiError(error, FALLBACK)).toBe(FALLBACK);
  });

  it('refuses anything that looks like an HTML error page', () => {
    const error = new ApiResponseError(404, '<!DOCTYPE html><html lang="en"><head>');

    expect(describeApiError(error, FALLBACK)).toBe(FALLBACK);
  });

  it('refuses a message too long to be a sentence to a member', () => {
    const error = new ApiResponseError(422, 'x'.repeat(201));

    expect(describeApiError(error, FALLBACK)).toBe(FALLBACK);
  });

  it('leaves refusals that have their own screen to that screen', () => {
    // 🔴 `ONBOARDING_REQUIRED` and `LEGAL_ACCEPTANCE_REQUIRED` are answered by taking the
    // member somewhere, not by a toast. Showing the server's sentence as well would be a
    // second, worse answer to the same event.
    for (const code of ['ONBOARDING_REQUIRED', 'LEGAL_ACCEPTANCE_REQUIRED', 'UNAUTHENTICATED']) {
      const error = new ApiResponseError(403, 'Complete your profile first', undefined, code);
      expect(describeApiError(error, FALLBACK)).toBe(FALLBACK);
    }
  });

  it('falls back for anything that is not an API error at all', () => {
    // A dropped connection throws a plain Error, and its message ("Network request failed")
    // is not an explanation a member can act on.
    expect(describeApiError(new Error('Network request failed'), FALLBACK)).toBe(FALLBACK);
    expect(describeApiError(undefined, FALLBACK)).toBe(FALLBACK);
    expect(describeApiError('a string', FALLBACK)).toBe(FALLBACK);
  });

  it('falls back when the server sent an empty message', () => {
    expect(describeApiError(new ApiResponseError(422, '   '), FALLBACK)).toBe(FALLBACK);
  });

  it('keeps a validation code that has no screen of its own', () => {
    // Not every code is special: a plain validation refusal should still speak for itself.
    const error = new ApiResponseError(422, 'Choose what the problem is', undefined, 'VALIDATION_REQUIRED_FIELD');

    expect(describeApiError(error, FALLBACK)).toBe('Choose what the problem is');
  });
});
