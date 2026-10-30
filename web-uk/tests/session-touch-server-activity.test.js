// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E-119 F-608: the main server now ends a session that is idle past the
 * community's inactivity timeout. This site's "still here" request
 * (POST /session/touch, sent while the member is active, and by the timeout
 * warning's "Stay signed in" button) must therefore reach the main server too,
 * and must say so honestly when the session has already ended.
 */

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return { ApiError, recordSessionActivity: jest.fn() };
});
jest.mock('../src/middleware/auth', () => ({ clearAuthCookies: jest.fn() }));

const fs = require('fs');
const path = require('path');
const api = require('../src/lib/api');
const auth = require('../src/middleware/auth');
const { handleSessionTouch } = require('../src/lib/session-touch');

function fakeRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /session/touch', () => {
  it('tells the main server the signed-in member is still here', async () => {
    api.recordSessionActivity.mockResolvedValue('');
    const res = fakeRes();
    await handleSessionTouch({ token: 'access-1', session: {} }, res);

    expect(api.recordSessionActivity).toHaveBeenCalledWith('access-1');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('reports a session the main server has ended, and clears this site\'s sign-in', async () => {
    api.recordSessionActivity.mockRejectedValue(new api.ApiError('idle', 401, { errors: [{ code: 'AUTH_SESSION_IDLE' }] }));
    const res = fakeRes();
    await handleSessionTouch({ token: 'access-1', session: {} }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ ok: false, signedOut: true });
    expect(auth.clearAuthCookies).toHaveBeenCalledWith(res);
  });

  it('reports a session whose renewal was already refused on this request', async () => {
    const res = fakeRes();
    await handleSessionTouch({ authSessionEnded: true, session: {} }, res);

    expect(api.recordSessionActivity).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('keeps a brief main-server outage from signing the member out', async () => {
    api.recordSessionActivity.mockRejectedValue(new api.ApiError('down', 503));
    const res = fakeRes();
    await handleSessionTouch({ token: 'access-1', session: {} }, res);

    expect(res.statusCode).toBe(200);
  });

  it('still answers a signed-out page as before', async () => {
    const res = fakeRes();
    await handleSessionTouch({ session: {} }, res);

    expect(api.recordSessionActivity).not.toHaveBeenCalled();
    expect(res.body).toEqual({ ok: true });
  });
});

describe('timeout warning keep-alive', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'timeout-warning.js'), 'utf8');

  it('pings well inside short timeouts, not on a fixed 5 minutes', () => {
    expect(source).toMatch(/var KEEP_ALIVE_INTERVAL_MS = Math\.max\(60 \* 1000, Math\.min\(5 \* 60 \* 1000, Math\.floor\(sessionTimeoutMs \/ 3\)\)\);/);
  });

  it('sends the member to sign in when the keep-alive learns the session has ended', () => {
    expect(source).toMatch(/response\.status === 401\) \{\s*redirectToLogin\(\);/);
  });
});
