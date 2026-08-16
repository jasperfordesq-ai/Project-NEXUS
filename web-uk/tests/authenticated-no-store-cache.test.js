// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Defense-in-depth: every response rendered for a signed-in member is
 * personal (wallet, messages, profile, notifications, settings, CSV exports)
 * and must never be stored by the browser's back/forward cache or any shared
 * cache, where it could surface to the next person on the device. A global
 * middleware sets `Cache-Control: private, no-store` whenever the signed
 * `token` cookie is present. This test proves the header is emitted when
 * authenticated and NOT forced for anonymous visitors (so public pages stay
 * cacheable).
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
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getListings: jest.fn(),
  getListingCategories: jest.fn(),
  getBalance: jest.fn(),
  getUnreadCount: jest.fn(),
  getTransactions: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn()
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

// A signed cookie as cookie-parser expects it: `s:` + value.hmac, URL-encoded.
function signedTokenCookie(value = 'token:test') {
  return 'token=' + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

describe('authenticated responses are never cached', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({
      data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }]
    });
  });

  it('sets private, no-store when the signed session token is present', async () => {
    const response = await request(app)
      .get('/')
      .set('Cookie', signedTokenCookie());

    const cacheControl = response.headers['cache-control'] || '';
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('private');
  });

  it('does not force no-store for an anonymous visitor', async () => {
    const response = await request(app).get('/');

    const cacheControl = response.headers['cache-control'] || '';
    expect(cacheControl).not.toContain('no-store');
  });
});
