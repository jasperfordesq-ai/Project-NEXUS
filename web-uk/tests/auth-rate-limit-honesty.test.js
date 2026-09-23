// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getRegistrationInfo: jest.fn(),
  getTenantBootstrap: jest.fn(),
  login: jest.fn(),
  register: jest.fn(),
  logout: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  resendVerification: jest.fn(),
  verify2fa: jest.fn(),
  setupRequiredTwoFactor: jest.fn(),
  verifyEmail: jest.fn(),
  callNewsletterApi: jest.fn(),
  invalidateUserCache: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn()
}));

const api = require('../src/lib/api');
const authRouter = require('../src/routes/auth');

// F-110: when Laravel refuses a forgot-password or resend-verification request
// with 429, the member was still told the email had been sent. They must be told
// to wait instead; every other failure keeps the enumeration-safe "sent" reply.

function createApp() {
  const app = express();
  app.use(cookieParser('auth-rate-limit-test-secret'));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'auth-rate-limit-test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use(authRouter);
  return app;
}

function rateLimited() {
  return new api.ApiError('Too many attempts', 429, {
    errors: [{ code: 'RATE_LIMIT_EXCEEDED', message: 'Too many attempts' }]
  });
}

describe('honest rate-limit messages on email-sending auth forms (F-110)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('forgot-password: a 429 tells the member to wait, not that the email was sent', async () => {
    api.forgotPassword.mockRejectedValueOnce(rateLimited());
    const res = await request(createApp())
      .post('/login/forgot-password')
      .type('form')
      .send({ email: 'member@example.test', tenant_slug: 'acme' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login/forgot-password?status=forgot-rate-limited');

    const page = await request(createApp()).get('/login/forgot-password?status=forgot-rate-limited');
    expect(page.body.locals.forgotSent).toBe(false);
    expect(page.body.locals.errors[0].text).toMatch(/too many/i);
  });

  it('forgot-password: success and non-rate-limit failures still say "sent" (no enumeration)', async () => {
    api.forgotPassword.mockResolvedValueOnce({});
    const ok = await request(createApp())
      .post('/login/forgot-password')
      .type('form')
      .send({ email: 'member@example.test', tenant_slug: 'acme' });
    expect(ok.headers.location).toBe('/login/forgot-password?status=forgot-sent');

    api.forgotPassword.mockRejectedValueOnce(new api.ApiError('Not found', 404, {}));
    const notFound = await request(createApp())
      .post('/login/forgot-password')
      .type('form')
      .send({ email: 'nobody@example.test', tenant_slug: 'acme' });
    expect(notFound.headers.location).toBe('/login/forgot-password?status=forgot-sent');
  });

  it('resend-verification: a 429 tells the member to wait, not that the email was re-sent', async () => {
    api.resendVerification.mockRejectedValueOnce(rateLimited());
    const res = await request(createApp())
      .post('/login/resend-verification')
      .type('form')
      .send({ email: 'member@example.test', tenant_slug: 'acme' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?status=verification-rate-limited');

    const page = await request(createApp()).get('/login?status=verification-rate-limited');
    expect(page.body.locals.successMessage || '').toBe('');
    expect(page.body.locals.error).toMatch(/too many/i);
  });

  it('resend-verification: success and other failures still say "re-sent"', async () => {
    api.resendVerification.mockResolvedValueOnce({ data: { message: 'sent' } });
    const ok = await request(createApp())
      .post('/login/resend-verification')
      .type('form')
      .send({ email: 'member@example.test', tenant_slug: 'acme' });
    expect(ok.headers.location).toBe('/login?status=verification-resent');

    api.resendVerification.mockRejectedValueOnce(new api.ApiError('Bad request', 400, {}));
    const failed = await request(createApp())
      .post('/login/resend-verification')
      .type('form')
      .send({ email: 'member@example.test', tenant_slug: 'acme' });
    expect(failed.headers.location).toBe('/login?status=verification-resent');
  });
});
