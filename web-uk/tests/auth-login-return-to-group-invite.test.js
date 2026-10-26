// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A signed-out visitor who opens a group invitation link is sent to sign in and
 * must come back to the invitation, not the dashboard — including through the
 * two-factor step. Anything other than an allowlisted invitation path is
 * ignored, so the parameter cannot be used as an open redirect.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  forgotPassword: jest.fn(),
  getRegistrationInfo: jest.fn(),
  getTenantBootstrap: jest.fn(),
  invalidateUserCache: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  register: jest.fn(),
  resendVerification: jest.fn(),
  resetPassword: jest.fn(),
  setupRequiredTwoFactor: jest.fn(),
  verify2fa: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  setAuthCookies: jest.fn()
}));

const api = require('../src/lib/api');
const authRouter = require('../src/routes/auth');

const INVITE = `/groups/invite/${'x'.repeat(40)}`;
const SESSION = { access_token: 'a', refresh_token: 'r', expires_in: 900, refresh_expires_in: 3600 };

function createApp(session = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = session;
    req.session.regenerate = (callback) => callback();
    req.signedCookies = {};
    req.flash = () => [];
    req.accessibleRouting = { tenantSlug: 'acme' };
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use(authRouter);
  return app;
}

beforeEach(() => jest.clearAllMocks());

it('carries an invitation return path into the sign-in form, and nothing else', async () => {
  const good = await request(createApp()).get(`/login?return_to=${encodeURIComponent(INVITE)}`);
  expect(good.body.locals.returnTo).toBe(INVITE);
  const bad = await request(createApp()).get('/login?return_to=%2F%2Fevil.example');
  expect(bad.body.locals.returnTo).toBe('');
});

it('returns to the invitation after a password sign-in', async () => {
  api.login.mockResolvedValueOnce(SESSION);
  const response = await request(createApp()).post('/login').type('form')
    .send({ email: 'a@example.com', password: 'pw', return_to: INVITE });
  expect(response.status).toBe(302);
  expect(response.headers.location).toBe(INVITE);
});

it('still goes to the dashboard for a forged return path', async () => {
  api.login.mockResolvedValueOnce(SESSION);
  const response = await request(createApp()).post('/login').type('form')
    .send({ email: 'a@example.com', password: 'pw', return_to: 'https://evil.example/' });
  expect(response.headers.location).toBe('/dashboard');
});

it('keeps the return path across the two-factor step', async () => {
  const session = {};
  api.login.mockResolvedValueOnce({ requires_2fa: true, two_factor_token: 'challenge' });
  const first = await request(createApp(session)).post('/login').type('form')
    .send({ email: 'a@example.com', password: 'pw', return_to: INVITE });
  expect(first.headers.location).toBe('/login/two-factor');
  expect(session.pending2faReturnTo).toBe(INVITE);

  api.verify2fa.mockResolvedValueOnce({ success: true, ...SESSION });
  const second = await request(createApp(session)).post('/login/two-factor').type('form').send({ code: '123456' });
  expect(second.headers.location).toBe(INVITE);
  expect(session.pending2faReturnTo).toBeUndefined();
});
