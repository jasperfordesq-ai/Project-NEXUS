// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Project NEXUS is for adults aged 18 and over. Laravel refuses to sign in an
 * account whose recorded date of birth is under 18 (HTTP 403,
 * errors[0].code === 'ACCOUNT_UNDER_MINIMUM_AGE'), and refuses every
 * authenticated request made with an existing session of such an account the
 * same way.
 *
 * This file pins the sign-in page's side of that contract, and the shared
 * route-error helper that most routes run their API failures through.
 */

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
const { clearAuthCookies } = require('../src/middleware/auth');
const { createTranslator } = require('../src/lib/localization');
const { handleApiError } = require('../src/lib/routeHelpers');
const authRouter = require('../src/routes/auth');

const UNDER_AGE_BODY = Object.freeze({
  success: false,
  errors: [{ code: 'ACCOUNT_UNDER_MINIMUM_AGE', message: 'Server text' }],
  account_under_minimum_age: true
});

function createApp(locale, options = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = options.pending2faToken
      ? { pending2faToken: options.pending2faToken, pending2faTenantSlug: 'acme' }
      : {};
    req.session.regenerate = (callback) => callback();
    req.signedCookies = {};
    if (locale) req.t = createTranslator(locale);
    req.flash = () => [];
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use(authRouter);
  return app;
}

describe('sign-in refused because the account is under 18', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has a real, translated message in every locale', () => {
    const english = createTranslator('en')('auth.account_under_minimum_age');
    expect(english).toMatch(/adults aged 18 and over/);
    for (const locale of ['ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']) {
      const value = createTranslator(locale)('auth.account_under_minimum_age');
      expect(value).not.toBe('auth.account_under_minimum_age');
      expect(value).not.toBe(english);
      expect(value).toMatch(/18/);
    }
  });

  it('shows the adults-only message in the error summary when Laravel refuses the sign-in', async () => {
    const t = createTranslator('ga');
    api.login.mockRejectedValueOnce(new api.ApiError('Under age', 403, UNDER_AGE_BODY));

    const response = await request(createApp('ga'))
      .post('/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'secret', tenant_slug: 'acme' });

    expect(response.body.view).toBe('login');
    expect(response.body.locals.loginStatus).toBe('account-under-minimum-age');
    expect(response.body.locals.error).toBe(t('auth.account_under_minimum_age'));
  });

  it('shows the same message when the refusal arrives at the two-factor step', async () => {
    api.verify2fa.mockRejectedValueOnce(new api.ApiError('Under age', 403, UNDER_AGE_BODY));

    const response = await request(createApp('en', { pending2faToken: 'pending-token' }))
      .post('/login/two-factor')
      .type('form')
      .send({ code: '123456' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login?status=account-under-minimum-age');
  });

  it('renders the message for the status a signed-out session is redirected with', async () => {
    const t = createTranslator('fr');

    const response = await request(createApp('fr')).get('/login?status=account-under-minimum-age');

    expect(response.body.locals.error).toBe(t('auth.account_under_minimum_age'));
    expect(response.body.locals.loginStatus).toBe('account-under-minimum-age');
  });

  it('does not treat an ordinary 403 as an age refusal', async () => {
    api.login.mockRejectedValueOnce(new api.ApiError('Suspended', 403, {
      errors: [{ code: 'AUTH_ACCOUNT_SUSPENDED' }]
    }));

    const response = await request(createApp('en'))
      .post('/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'secret', tenant_slug: 'acme' });

    expect(response.body.locals.loginStatus).toBe('account-suspended');
  });
});

describe('an existing session of an under-18 account is signed out by the shared route helper', () => {
  function responseDouble() {
    return {
      locals: { urlFor: (pathname) => `/acme/accessible${pathname}` },
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      render: jest.fn()
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears the sign-in cookies and sends the member to the sign-in page with the reason', () => {
    const destroy = jest.fn((callback) => callback && callback());
    const req = { session: { destroy }, signedCookies: { token: 'under-age-token' }, flash: jest.fn() };
    const res = responseDouble();

    const handled = handleApiError(new api.ApiError('Under age', 403, UNDER_AGE_BODY), req, res);

    expect(handled).toBe(true);
    expect(clearAuthCookies).toHaveBeenCalledWith(res);
    expect(destroy).toHaveBeenCalled();
    expect(api.invalidateUserCache).toHaveBeenCalledWith('under-age-token');
    expect(res.redirect).toHaveBeenCalledWith('/acme/accessible/login?status=account-under-minimum-age');
  });

  it('leaves any other 403 alone', () => {
    const req = { session: {}, signedCookies: { token: 't' }, flash: jest.fn() };
    const res = responseDouble();

    const handled = handleApiError(new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN' }] }), req, res);

    expect(handled).toBe(false);
    expect(clearAuthCookies).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
