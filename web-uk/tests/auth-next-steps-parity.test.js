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

// 29 Oct 2026 parity round: what React tells a member that the accessible site
// did not. Laravel is the source of truth for each answer.

function createApp() {
  const app = express();
  app.use(cookieParser('auth-next-steps-test-secret'));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'auth-next-steps-test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use(authRouter);
  return app;
}

describe('sign-in while waiting for approval', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a calm notice, not "wrong email or password" (AUTH_ACCOUNT_PENDING_APPROVAL)', async () => {
    api.login.mockRejectedValueOnce(new api.ApiError('pending', 403, {
      errors: [{ code: 'AUTH_ACCOUNT_PENDING_APPROVAL', message: 'Your account is pending admin approval.' }]
    }));
    const res = await request(createApp())
      .post('/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'a-long-password', tenant_slug: 'acme' });
    expect(res.body.view).toBe('login');
    expect(res.body.locals.loginStatus).toBe('pending-approval');
    expect(res.body.locals.error).toBeNull();
  });
});

describe('after registering', () => {
  it('passes the waitlist position Laravel returns to the sign-in page', async () => {
    const page = await request(createApp()).get('/login?status=register-created&next=waitlist&position=4');
    expect(page.body.locals.registrationNext).toBe('waitlist');
    expect(page.body.locals.waitlistPosition).toBe('4');
  });

  it('ignores anything that is not a known next step or a plain number', async () => {
    const page = await request(createApp()).get('/login?status=register-created&next=<b>&position=4abc');
    expect(page.body.locals.registrationNext).toBe('');
    expect(page.body.locals.waitlistPosition).toBe('');
  });
});

describe('password reset', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for 12 characters, Laravel\'s minimum, before calling the API', async () => {
    const res = await request(createApp())
      .post('/password/reset')
      .type('form')
      .send({ token: 't', password: 'elevenchars', password_confirmation: 'elevenchars' });
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(res.body.locals.fieldErrors.password).toMatch(/12/);
  });

  it('shows Laravel\'s reason against the field when it refuses the password itself', async () => {
    api.resetPassword.mockRejectedValueOnce(new api.ApiError('refused', 422, {
      errors: [{ code: 'VALIDATION_ERROR', field: 'password', message: 'This password has appeared in a data breach.' }]
    }));
    const res = await request(createApp())
      .post('/password/reset')
      .type('form')
      .send({ token: 't', password: 'a-long-enough-password', password_confirmation: 'a-long-enough-password' });
    expect(res.body.locals.fieldErrors.password).toBe('This password has appeared in a data breach.');
    expect(res.body.locals.errors[0].href).toBe('#password');
  });

  it('still calls a broken link a broken link', async () => {
    api.resetPassword.mockRejectedValueOnce(new api.ApiError('bad token', 400, {
      errors: [{ code: 'INVALID_TOKEN', message: 'Invalid token' }]
    }));
    const res = await request(createApp())
      .post('/password/reset')
      .type('form')
      .send({ token: 't', password: 'a-long-enough-password', password_confirmation: 'a-long-enough-password' });
    expect(res.body.locals.fieldErrors).toEqual({});
  });
});
