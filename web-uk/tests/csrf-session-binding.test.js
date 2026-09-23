// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-114: the double-submit CSRF token was not bound to the session, so a token
 * and cookie pair minted in one browser session was accepted with any other
 * session, and the cookie lacked the `__Host-` prefix (a sibling subdomain or a
 * plain-http response could plant one). The token is now bound to the
 * express-session id, and production uses a `__Host-` cookie (Secure, Path=/,
 * no Domain) while development keeps working over http.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
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

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

const { csrfCookieSettings } = require('../src/lib/csrf');

function cookiesFrom(response) {
  return (response.headers['set-cookie'] || []).map((cookie) => cookie.split(';')[0]);
}

// The browser keeps the LAST Set-Cookie of a given name.
function cookieNamed(cookies, name) {
  return cookies.filter((cookie) => cookie.startsWith(`${name}=`)).pop();
}

describe('F-114 CSRF cookie settings', () => {
  test('production uses a __Host- cookie: Secure, Path=/, no Domain', () => {
    const { cookieName, cookieOptions } = csrfCookieSettings('production');
    expect(cookieName.startsWith('__Host-')).toBe(true);
    expect(cookieOptions).toEqual(expect.objectContaining({ secure: true, path: '/', httpOnly: true, signed: true }));
    expect(cookieOptions).not.toHaveProperty('domain');
  });

  test('development keeps a plain cookie that works over http', () => {
    const { cookieName, cookieOptions } = csrfCookieSettings('development');
    expect(cookieName.startsWith('__Host-')).toBe(false);
    expect(cookieOptions.secure).toBe(false);
    expect(cookieOptions.path).toBe('/');
  });
});

describe('F-114 CSRF token is bound to the session', () => {
  let app;

  beforeAll(() => {
    app = require('../src/server');
  });

  async function freshSession() {
    const page = await request(app).get('/acme/accessible/login');
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const cookies = cookiesFrom(page);
    return {
      token,
      sid: cookieNamed(cookies, 'nexus.sid'),
      csrf: cookieNamed(cookies, csrfCookieSettings('test').cookieName)
    };
  }

  test('a token and cookie pair works in the session it was issued to', async () => {
    const own = await freshSession();
    expect(own.sid).toBeTruthy();
    expect(own.csrf).toBeTruthy();

    const response = await request(app)
      .post('/session/touch')
      .set('Cookie', `${own.sid}; ${own.csrf}`)
      .set('x-csrf-token', own.token)
      .set('content-type', 'application/json')
      .send({});

    expect(response.status).toBe(200);
  });

  test('a token and cookie pair minted in another session is refused', async () => {
    const attacker = await freshSession();
    const victim = await freshSession();

    const response = await request(app)
      .post('/session/touch')
      .set('Cookie', `${victim.sid}; ${attacker.csrf}`)
      .set('x-csrf-token', attacker.token)
      .set('content-type', 'application/json')
      .send({});

    expect(response.status).toBe(419);
  });

  test('a stale cookie from an earlier session is replaced, not turned into an error page', async () => {
    const earlier = await freshSession();
    const current = await freshSession();

    const page = await request(app)
      .get('/acme/accessible/login')
      .set('Cookie', `${current.sid}; ${earlier.csrf}`);

    expect(page.status).toBe(200);
    const token = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const replaced = cookieNamed(cookiesFrom(page), csrfCookieSettings('test').cookieName);
    expect(replaced).toBeTruthy();

    const response = await request(app)
      .post('/session/touch')
      .set('Cookie', `${current.sid}; ${replaced}`)
      .set('x-csrf-token', token)
      .set('content-type', 'application/json')
      .send({});
    expect(response.status).toBe(200);
  });
});
