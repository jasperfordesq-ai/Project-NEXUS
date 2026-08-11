// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 WHY THIS FILE EXISTS.
 *
 * `captureError` was exported from `src/lib/sentry.js` with a docblock saying it was
 * "used by the existing error logger so a fault is reported through the same path
 * that already logs it". It was called from nowhere in `web-uk/src` — a dead export
 * whose comment asserted a wiring that did not exist.
 *
 * The gap it should have been closing is real. Sentry's Express error handler only
 * sees errors that reach the end of the middleware chain, and every branch of
 * `handleApiError` that returns `true` deliberately stops that happening. Two of
 * those branches hide genuine server faults:
 *
 *   - the platform API being unreachable, rendered as a 503 page;
 *   - a 5xx from Laravel, turned into a flash message and a redirect.
 *
 * Both were invisible in production. These tests pin BOTH directions — the faults
 * are reported, and the ordinary outcomes (401, 404, 4xx) are not — because
 * "reports everything" would be as wrong as "reports nothing": a fault channel full
 * of expected outcomes is one nobody reads.
 */

const mockCaptureError = jest.fn();
jest.mock('../src/lib/sentry', () => ({
  captureError: (...args) => mockCaptureError(...args),
  initSentry: jest.fn(),
  attachExpressErrorHandler: jest.fn(),
  flushSentry: jest.fn(() => Promise.resolve()),
  isEnabled: jest.fn(() => false)
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn()
}));

const { ApiError, ApiOfflineError } = require('../src/lib/api');
const { handleApiError } = require('../src/lib/routeHelpers');

function fakeReqRes() {
  const req = {
    method: 'POST',
    path: '/listings/create',
    // originalUrl carries the query string — asserted below to be excluded.
    originalUrl: '/listings/create?draft=secret-term',
    flash: jest.fn()
  };
  const res = {
    locals: { urlFor: (v) => v },
    status: jest.fn(() => res),
    render: jest.fn(() => res),
    redirect: jest.fn(() => res),
    clearCookie: jest.fn()
  };
  return { req, res };
}

beforeEach(() => {
  mockCaptureError.mockClear();
});

describe('faults that handleApiError hides from Sentry are reported explicitly', () => {
  it('reports the platform API being unreachable', () => {
    const { req, res } = fakeReqRes();

    const handled = handleApiError(new ApiOfflineError('backend down'), req, res, {});

    expect(handled).toBe(true);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][1]).toMatchObject({
      swallowed_by: 'handleApiError',
      reason: 'api-offline'
    });
  });

  it('reports a 5xx that becomes a flash message', () => {
    const { req, res } = fakeReqRes();

    const handled = handleApiError(
      new ApiError('Server error', 500, {}),
      req,
      res,
      { redirectOnError: '/listings' }
    );

    expect(handled).toBe(true);
    expect(res.redirect).toHaveBeenCalled();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
    expect(mockCaptureError.mock.calls[0][1]).toMatchObject({ reason: 'api-5xx-swallowed', status: 500 });
  });

  it('never puts the query string in the report', () => {
    // `originalUrl` would carry a draft title or a search term. Only the path goes.
    const { req, res } = fakeReqRes();

    handleApiError(new ApiError('Server error', 503, {}), req, res, { redirectOnError: '/listings' });

    const context = mockCaptureError.mock.calls[0][1];
    expect(context.path).toBe('/listings/create');
    expect(JSON.stringify(context)).not.toContain('secret-term');
  });
});

describe('the API behaving correctly is NOT reported', () => {
  it('stays quiet on 401', () => {
    const { req, res } = fakeReqRes();
    handleApiError(new ApiError('Unauthenticated', 401, {}), req, res, {});
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('stays quiet on 404', () => {
    const { req, res } = fakeReqRes();
    handleApiError(new ApiError('Not found', 404, {}), req, res, {});
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('stays quiet on a 422 validation failure', () => {
    const { req, res } = fakeReqRes();
    handleApiError(new ApiError('Invalid', 422, {}), req, res, { redirectOnError: '/listings' });
    expect(mockCaptureError).not.toHaveBeenCalled();
  });

  it('stays quiet on a 403 refusal', () => {
    const { req, res } = fakeReqRes();
    handleApiError(new ApiError('Forbidden', 403, {}), req, res, { redirectOnError: '/listings' });
    expect(mockCaptureError).not.toHaveBeenCalled();
  });
});

describe('reporting can never break the member response', () => {
  it('still handles the error when the Sentry call throws', () => {
    mockCaptureError.mockImplementationOnce(() => {
      throw new Error('sentry exploded');
    });
    const { req, res } = fakeReqRes();

    // The member must still get their 503 page.
    expect(() => handleApiError(new ApiOfflineError('down'), req, res, {})).not.toThrow();
    expect(res.render).toHaveBeenCalled();
  });

  it('does not need req.flash or res.locals to exist', () => {
    const bare = { method: 'GET', path: '/x' };
    const res = { status: jest.fn(() => res), render: jest.fn(() => res), locals: {} };

    expect(() => handleApiError(new ApiOfflineError('down'), bare, res, {})).not.toThrow();
    expect(mockCaptureError).toHaveBeenCalledTimes(1);
  });
});
