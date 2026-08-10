// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
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
  verify2fa: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  setAuthCookies: jest.fn()
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const authRouter = require('../src/routes/auth');

function createApp(locale, options = {}) {
  const flash = new Map();
  const flashWrites = [];
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = options.pending2faToken
      ? { pending2faToken: options.pending2faToken }
      : {};
    req.signedCookies = {};
    if (locale) req.t = createTranslator(locale);
    req.flash = (name, value) => {
      if (value !== undefined) {
        flashWrites.push({ name, value });
        flash.set(name, [...(flash.get(name) || []), value]);
        return undefined;
      }
      const values = flash.get(name) || [];
      flash.delete(name);
      return values;
    };
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use(authRouter);

  return { app, flashWrites };
}

describe('request-scoped auth route localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getRegistrationInfo.mockResolvedValue({
      data: {
        registration_mode: 'open',
        requires_invite_code: false,
        is_closed: false,
        can_register: true
      }
    });
    api.getTenantBootstrap.mockResolvedValue({ data: { id: 2, slug: 'acme', name: 'Acme' } });
  });

  it('localizes login statuses and API failures in Irish', async () => {
    const t = createTranslator('ga');
    const { app } = createApp('ga');

    const confirmation = await request(app).get('/login?status=verification-resent');
    expect(confirmation.body.locals.successMessage).toBe(t('auth.verification_resent'));
    expect(confirmation.body.locals.title).toBe(t('auth.login_title'));

    const expired = await request(app).get('/login?status=two-factor-expired');
    expect(expired.body.locals.error).toBe(t('auth.two_factor_expired'));
    expect(expired.body.locals.loginStatus).toBe('two-factor-expired');

    api.login.mockRejectedValueOnce(new api.ApiError('Suspended', 403, {
      errors: [{ code: 'AUTH_ACCOUNT_SUSPENDED' }]
    }));
    const suspended = await request(app)
      .post('/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'secret', tenant_slug: 'acme' });

    expect(suspended.body.locals.error).toBe(t('auth.account_suspended'));
    expect(suspended.body.locals.loginStatus).toBe('account-suspended');
  });

  it('localizes two-factor required and invalid errors in Arabic', async () => {
    const t = createTranslator('ar');
    const { app } = createApp('ar', { pending2faToken: 'pending-token' });

    const required = await request(app)
      .post('/login/two-factor')
      .type('form')
      .send({ code: '' });
    expect(required.body.locals.error).toBe(t('auth.two_factor_code_required'));

    api.verify2fa.mockRejectedValueOnce(new api.ApiError('Invalid', 422));
    const invalid = await request(app)
      .post('/login/two-factor')
      .type('form')
      .send({ code: '123456' });
    expect(invalid.body.locals.error).toBe(t('auth.two_factor_invalid'));
  });

  it('localizes exact registration validation and duplicate-account messages in Arabic', async () => {
    const t = createTranslator('ar');
    const { app } = createApp('ar');
    const agent = request.agent(app);
    const formStartedAt = Date.now() - 6000;

    const validationRedirect = await agent
      .post('/register')
      .type('form')
      .send({
        email: 'not-an-email',
        password: 'Password123!',
        password_confirmation: 'Different123!',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        terms_accepted: '1',
        tenant_slug: 'acme',
        form_started_at: formStartedAt
      });
    expect(validationRedirect.status).toBe(302);
    const validation = await agent.get(validationRedirect.headers.location);

    expect(validation.body.locals.fieldErrors.email).toBe(t('auth.forgot_invalid'));
    expect(validation.body.locals.fieldErrors.password_confirmation).toBe(t('auth.register_password_mismatch'));

    api.register.mockRejectedValueOnce(new api.ApiError('Duplicate', 409, {
      errors: [{ code: 'VALIDATION_DUPLICATE' }]
    }));
    const duplicateRedirect = await agent
      .post('/register')
      .type('form')
      .send({
        email: 'member@example.test',
        password: 'Password123!',
        password_confirmation: 'Password123!',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        terms_accepted: '1',
        tenant_slug: 'acme',
        form_started_at: formStartedAt
      });
    expect(duplicateRedirect.headers.location).toBe('/register?status=register-duplicate');
    const duplicate = await agent.get(duplicateRedirect.headers.location);

    expect(duplicate.body.locals.errors).toEqual([{
      text: t('auth.register_duplicate'),
      href: '#email'
    }]);
  });

  it('stores an untranslated registration status and renders its Arabic success copy on sign in', async () => {
    api.register.mockResolvedValueOnce({ success: true });
    api.login.mockResolvedValueOnce({});
    const t = createTranslator('ar');
    const { app, flashWrites } = createApp('ar');

    const registration = await request(app)
      .post('/register')
      .type('form')
      .send({
        email: 'member@example.test',
        password: 'Password123!',
        password_confirmation: 'Password123!',
        first_name: 'Ada',
        last_name: 'Lovelace',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        terms_accepted: '1',
        tenant_slug: 'acme',
        form_started_at: Date.now() - 6000
      });

    expect(registration.status).toBe(302);
    expect(registration.headers.location).toBe('/login?status=register-created');
    expect(flashWrites).toEqual([]);
    expect(api.login).not.toHaveBeenCalled();

    const login = await request(app).get(registration.headers.location);
    expect(login.body.locals.successMessage).toBe(t('auth.register_created'));
  });

  it('localizes forgot-password validation, failure, and success states in Irish', async () => {
    const t = createTranslator('ga');
    const { app } = createApp('ga');

    const invalid = await request(app)
      .post('/login/forgot-password')
      .type('form')
      .send({ email: '', tenant_slug: 'acme' });
    expect(invalid.body.locals.fieldErrors.email).toBe(t('auth.forgot_invalid'));

    const malformed = await request(app)
      .post('/login/forgot-password')
      .type('form')
      .send({ email: 'not-an-email', tenant_slug: 'acme' });
    expect(malformed.body.locals.fieldErrors.email).toBe(t('auth.forgot_invalid'));
    expect(api.forgotPassword).not.toHaveBeenCalled();

    const rateLimited = await request(app).get('/login/forgot-password?status=forgot-rate-limited');
    expect(rateLimited.body.locals.errors).toEqual([{
      text: t('auth.forgot_rate_limited'),
      href: '#email'
    }]);
    expect(rateLimited.body.locals.fieldErrors).toEqual({});

    const sent = await request(app).get('/login/forgot-password?status=forgot-sent');
    expect(sent.body.locals.forgotSent).toBe(true);
  });

  it('localizes reset validation and API failures in Arabic', async () => {
    const t = createTranslator('ar');
    const { app } = createApp('ar');

    const mismatch = await request(app)
      .post('/password/reset')
      .type('form')
      .send({
        token: 'reset-token',
        password: 'Password123!',
        password_confirmation: 'Different123!'
      });
    expect(mismatch.body.locals.fieldErrors.password_confirmation).toBe(t('auth.reset_mismatch'));

    api.resetPassword.mockRejectedValueOnce(new api.ApiError('Pwned', 422, {
      errors: [{ code: 'PASSWORD_PWNED' }]
    }));
    const pwned = await request(app)
      .post('/password/reset')
      .type('form')
      .send({
        token: 'reset-token',
        password: 'Password123!',
        password_confirmation: 'Password123!'
      });
    expect(pwned.body.locals.errors).toEqual([{ text: t('auth.reset_pwned') }]);
  });

  it('stores a reset status token and translates it only on the destination request', async () => {
    api.resetPassword.mockResolvedValueOnce({ success: true });
    const t = createTranslator('ga');
    const { app, flashWrites } = createApp('ga');

    const reset = await request(app)
      .post('/password/reset')
      .type('form')
      .send({
        token: 'reset-token',
        password: 'Password123!',
        password_confirmation: 'Password123!'
      });

    expect(reset.status).toBe(302);
    expect(reset.headers.location).toBe('/login');
    expect(flashWrites).toEqual([{ name: 'authStatus', value: 'password-reset' }]);

    const login = await request(app).get('/login');
    expect(login.body.locals.successMessage).toBe(t('auth.password_reset'));
  });

  it('falls back to the English catalog when isolated router tests do not install req.t', async () => {
    const t = createTranslator('en');
    const { app } = createApp();

    const response = await request(app).get('/login?status=login-failed');

    expect(response.body.locals.title).toBe(t('auth.login_title'));
    expect(response.body.locals.error).toBe(t('auth.login_failed'));
  });
});
