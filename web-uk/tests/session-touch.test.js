// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * POST /session/touch — the "Stay signed in" endpoint behind the session
 * timeout warning modal.
 *
 * Regression: the handler used to write `req.session.touch = Date.now()`,
 * which shadowed express-session's built-in Session.prototype.touch() METHOD
 * with a number. express-session calls req.session.touch() itself when the
 * response ends, so every call to this endpoint threw
 * "req.session.touch is not a function" and returned a 500 — which
 * timeout-warning.js treated as "session could not be extended" and redirected
 * the member to the login page. Clicking "Stay signed in" signed you out.
 */

const request = require('supertest');

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

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

describe('POST /session/touch', () => {
  let app;

  beforeAll(() => {
    app = require('../src/server');
  });

  async function csrfAgent() {
    const agent = request.agent(app);
    const page = await agent.get('/acme/accessible/login');
    const csrfMatch = page.text.match(/name="_csrf" value="([^"]+)"/);
    expect(csrfMatch).not.toBeNull();
    return { agent, csrfToken: csrfMatch[1] };
  }

  it('extends the session and returns ok instead of crashing at response end', async () => {
    const { agent, csrfToken } = await csrfAgent();

    const response = await agent
      .post('/session/touch')
      .set('x-csrf-token', csrfToken)
      .set('content-type', 'application/json')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('refreshes the session cookie so the browser-side expiry rolls with activity', async () => {
    const { agent, csrfToken } = await csrfAgent();

    const response = await agent
      .post('/session/touch')
      .set('x-csrf-token', csrfToken)
      .set('content-type', 'application/json')
      .send({});

    const setCookies = response.headers['set-cookie'] || [];
    expect(setCookies.some((cookie) => cookie.startsWith('nexus.sid='))).toBe(true);
  });

  it('never shadows express-session\'s touch() method with a data property', () => {
    const fs = require('fs');
    const path = require('path');
    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    expect(serverSource).not.toMatch(/req\.session\.touch\s*=/);
  });
});
