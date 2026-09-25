// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An account whose recorded date of birth is under 18 keeps no session.
 *
 * Laravel answers EVERY authenticated request made with such an account's
 * existing token with HTTP 403 and errors[0].code === 'ACCOUNT_UNDER_MINIMUM_AGE'.
 * web-uk must treat that as signed out — clear the sign-in cookies the way
 * sign-out does — and tell the member why on the sign-in page, rather than
 * showing a bare "access denied" page on every click.
 *
 * Two shared places are pinned here:
 *   1. the per-request middleware in server.js that already makes an
 *      authenticated call on every signed-in page (the unread counts), and
 *   2. the access-token refresh, which runs before any route.
 */

const request = require('supertest');
const signature = require('cookie-signature');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  login: jest.fn(),
  setupRequiredTwoFactor: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  refreshToken: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getListings: jest.fn(),
  getListingCategories: jest.fn(),
  getBalance: jest.fn(),
  getUnreadCount: jest.fn(),
  getNotificationUnreadCount: jest.fn(),
  getTransactions: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn()
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

const UNDER_AGE_BODY = Object.freeze({
  success: false,
  errors: [{ code: 'ACCOUNT_UNDER_MINIMUM_AGE', message: 'Server text' }],
  account_under_minimum_age: true
});

function signedCookie(name, value) {
  return `${name}=` + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

function jwtWithExpiry(expiresAt) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expiresAt })}.signature`;
}

function clearedCookie(setCookies, name) {
  return (setCookies || []).some((cookie) => (
    cookie.startsWith(`${name}=`) && /Expires=Thu, 01 Jan 1970/i.test(cookie)
  ));
}

describe('an existing session of an under-18 account', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }] });
  });

  it('is signed out and sent to the sign-in page with the adults-only reason', async () => {
    const refusal = new api.ApiError('Under age', 403, UNDER_AGE_BODY);
    api.getNotificationUnreadCount.mockRejectedValue(refusal);
    api.getUnreadCount.mockRejectedValue(refusal);

    const response = await request(app)
      .get('/dashboard')
      .set('Cookie', [signedCookie('token', 'under-age-token'), signedCookie('refresh_token', 'under-age-refresh')].join('; '));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login?status=account-under-minimum-age');
    expect(clearedCookie(response.headers['set-cookie'], 'token')).toBe(true);
    expect(clearedCookie(response.headers['set-cookie'], 'refresh_token')).toBe(true);
    expect(api.invalidateUserCache).toHaveBeenCalledWith('under-age-token');
  });

  it('shows the reason on the sign-in page it lands on', async () => {
    const response = await request(app).get('/login?status=account-under-minimum-age');

    expect(response.status).toBe(200);
    expect(response.text).toContain('govuk-error-summary');
    expect(response.text).toContain('adults aged 18 and over');
  });

  it('keeps an ordinary signed-in member signed in when the counts fail for another reason', async () => {
    api.getNotificationUnreadCount.mockRejectedValue(new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN' }] }));
    api.getUnreadCount.mockResolvedValue({ data: { count: 0 } });

    const response = await request(app)
      .get('/login?status=signed-out')
      .set('Cookie', signedCookie('token', 'ordinary-token'));

    expect(response.headers.location || '').not.toContain('account-under-minimum-age');
    expect(clearedCookie(response.headers['set-cookie'], 'token')).toBe(false);
  });
});

describe('refreshing the access token of an under-18 account', () => {
  it('ends the session and gives the adults-only reason instead of a generic sign-in prompt', async () => {
    const api = require('../src/lib/api');
    const { requireAuth } = require('../src/middleware/auth');
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Under age', 403, UNDER_AGE_BODY));
    const req = {
      path: '/dashboard',
      signedCookies: {
        token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 1),
        refresh_token: 'under-age-refresh',
        tenant_slug: 'acme'
      },
      accessibleRouting: { tenantSlug: 'acme' }
    };
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      locals: { urlFor: (pathname) => pathname }
    };
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledWith('token', expect.any(Object));
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(res.redirect).toHaveBeenCalledWith('/login?status=account-under-minimum-age');
  });
});
