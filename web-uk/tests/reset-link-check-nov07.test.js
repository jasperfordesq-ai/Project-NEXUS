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
  checkResetLink: jest.fn(),
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

// AWID focus group, Oct 2026: "When you click on the link on the invite, it
// didn't work. I had to use Forget Password". The accessible site showed the
// full form for a dead link and only said so after a password was typed, with
// no way to ask for a new link. It now asks Laravel first (read-only), and an
// account invitation reads as "Set up your account", not a reset.

function createApp() {
  const app = express();
  app.use(cookieParser('reset-link-check-test-secret'));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'reset-link-check-test-secret', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    res.render = (view, locals = {}) => res.json({ view, locals });
    // Minimal express-flash stand-in: set with (key, value), read once with (key).
    req.flash = (key, value) => {
      req.session.flash = req.session.flash || {};
      if (value !== undefined) {
        (req.session.flash[key] = req.session.flash[key] || []).push(value);
        return undefined;
      }
      const values = req.session.flash[key] || [];
      delete req.session.flash[key];
      return values;
    };
    next();
  });
  app.use(authRouter);
  return app;
}

describe('the set-password page checks the emailed link first', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks Laravel about the token and shows the form for a live reset link', async () => {
    api.checkResetLink.mockResolvedValueOnce({ data: { valid: true, kind: 'reset' } });
    const res = await request(createApp()).get('/password/reset?token=live-token');

    expect(api.checkResetLink).toHaveBeenCalledWith('live-token');
    expect(res.body.view).toBe('reset-password');
    expect(res.body.locals.isInvitation).toBe(false);
    expect(res.body.locals.resetToken).toBe('live-token');
  });

  it('words an invitation as setting up an account', async () => {
    api.checkResetLink.mockResolvedValueOnce({ data: { valid: true, kind: 'invitation' } });
    const res = await request(createApp()).get('/password/reset?token=invite-token');

    expect(res.body.view).toBe('reset-password');
    expect(res.body.locals.isInvitation).toBe(true);
    expect(res.body.locals.title).toBe('Set up your account');
  });

  it('shows a dead link plainly, without the form', async () => {
    api.checkResetLink.mockResolvedValueOnce({ data: { valid: false, kind: null } });
    const res = await request(createApp()).get('/password/reset?token=dead-token');

    expect(res.body.view).toBe('reset-link-dead');
    expect(res.body.locals.title).toBe('This link no longer works');
    expect(res.body.locals.resetToken).toBeUndefined();
  });

  it('treats a link with no token as dead, without calling Laravel', async () => {
    const res = await request(createApp()).get('/password/reset');

    expect(api.checkResetLink).not.toHaveBeenCalled();
    expect(res.body.view).toBe('reset-link-dead');
  });

  it('still shows the form when the check cannot be made', async () => {
    api.checkResetLink.mockRejectedValueOnce(new api.ApiOfflineError('down'));
    const res = await request(createApp()).get('/password/reset?token=unknown-token');

    expect(res.body.view).toBe('reset-password');
    expect(res.body.locals.isInvitation).toBe(false);
  });

  it('keeps the invitation wording when the form comes back with an error', async () => {
    const res = await request(createApp())
      .post('/password/reset')
      .type('form')
      .send({ token: 't', kind: 'invitation', password: 'short', password_confirmation: 'short' });

    expect(res.body.view).toBe('reset-password');
    expect(res.body.locals.isInvitation).toBe(true);
  });

  it('a set invitation password says so on the sign-in page', async () => {
    api.resetPassword.mockResolvedValueOnce({ data: { message: 'ok' } });
    const agent = request.agent(createApp());
    const res = await agent
      .post('/password/reset')
      .type('form')
      .send({ token: 't', kind: 'invitation', password: 'a-long-enough-password', password_confirmation: 'a-long-enough-password' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login/);
    const login = await agent.get('/login');
    expect(JSON.stringify(login.body.locals)).toContain('Your password is set');
  });
});
