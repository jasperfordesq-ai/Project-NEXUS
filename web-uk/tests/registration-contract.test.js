// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs');
const path = require('path');
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
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
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

const OPEN_POLICY = {
  data: {
    registration_mode: 'open',
    requires_invite_code: false,
    is_closed: false,
    can_register: true
  }
};

function createApp({ mounted = true, locale = 'en' } = {}) {
  const flashes = new Map();
  const app = express();
  const prefix = mounted ? '/acme/accessible' : '';

  app.use(express.urlencoded({ extended: false }));
  app.use(prefix || '/', (req, res, next) => {
    req.signedCookies = {};
    req.session = {};
    req.t = createTranslator(locale);
    req.csrfToken = () => 'csrf-token';
    if (mounted) {
      req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', prefix };
    }
    req.flash = (name, value) => {
      if (value !== undefined) {
        flashes.set(name, [...(flashes.get(name) || []), value]);
        return undefined;
      }
      const values = flashes.get(name) || [];
      flashes.delete(name);
      return values;
    };
    res.locals.urlFor = (pathname) => `${prefix}${pathname}`;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  }, authRouter);

  return app;
}

function completeBody(overrides = {}) {
  return {
    first_name: 'Ada',
    last_name: 'Lovelace',
    email: 'Ada@Example.Test',
    phone: '+353 87 123 4567',
    location: 'Dublin, Ireland',
    latitude: '53.3498',
    longitude: '-6.2603',
    password: 'LongPassword123!',
    password_confirmation: 'LongPassword123!',
    profile_type: 'individual',
    terms_accepted: '1',
    newsletter_opt_in: '1',
    tenant_slug: 'crafted-other-tenant',
    form_started_at: String(Date.now() - 6000),
    ...overrides
  };
}

describe('Laravel registration contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getRegistrationInfo.mockResolvedValue(OPEN_POLICY);
    api.getTenantBootstrap.mockImplementation(({ slug }) => Promise.resolve({
      data: { id: 2, slug, name: slug }
    }));
    api.register.mockResolvedValue({
      data: { user: { id: 123 }, requires_verification: true }
    });
  });

  it('loads tenant policy for the mounted GET and exposes open form state', async () => {
    const response = await request(createApp()).get('/acme/accessible/register');

    expect(response.status).toBe(200);
    expect(api.getRegistrationInfo).toHaveBeenCalledWith('acme');
    expect(response.body.locals).toEqual(expect.objectContaining({
      tenantSlug: 'acme',
      registrationClosed: false,
      requiresInviteCode: false,
      csrfToken: 'csrf-token'
    }));
    expect(response.body.locals.formStartedAt).toEqual(expect.any(Number));
  });

  it('renders invite-only and closed tenant policy states without guessing', async () => {
    api.getRegistrationInfo
      .mockResolvedValueOnce({
        data: {
          registration_mode: 'invite_only',
          requires_invite_code: true,
          can_register: true
        }
      })
      .mockResolvedValueOnce({
        data: {
          registration_mode: 'closed',
          requires_invite_code: false,
          is_closed: true,
          can_register: false
        }
      });

    const invite = await request(createApp()).get('/acme/accessible/register');
    const closed = await request(createApp()).get('/acme/accessible/register');

    expect(invite.body.locals.requiresInviteCode).toBe(true);
    expect(invite.body.locals.registrationClosed).toBe(false);
    expect(closed.body.locals.registrationClosed).toBe(true);
    expect(closed.body.locals.title).toBe(createTranslator('en')('auth.registration_closed_title'));
  });

  it('fails closed when registration policy cannot be loaded', async () => {
    api.getRegistrationInfo.mockRejectedValueOnce(new api.ApiOfflineError());

    const response = await request(createApp()).get('/acme/accessible/register');

    expect(response.status).toBe(503);
    expect(response.body.view).toBe('errors/503');
  });

  it('validates the complete Laravel form and retains only safe input', async () => {
    const app = createApp();
    const agent = request.agent(app);
    const response = await agent
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody({
        email: 'not-an-email',
        phone: 'bad',
        password: 'short',
        password_confirmation: 'different',
        terms_accepted: ''
      }));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/register?status=register-terms-required');
    expect(api.register).not.toHaveBeenCalled();

    const rendered = await agent.get(response.headers.location);
    expect(rendered.body.locals.values).toEqual(expect.objectContaining({
      first_name: 'Ada',
      email: 'not-an-email',
      phone: 'bad',
      tenant_slug: 'acme'
    }));
    expect(rendered.body.locals.values).not.toHaveProperty('password');
    expect(rendered.body.locals.values).not.toHaveProperty('password_confirmation');
    expect(rendered.body.locals.fieldErrors).toEqual(expect.objectContaining({
      email: expect.any(String),
      phone: expect.any(String),
      password: expect.any(String),
      password_confirmation: expect.any(String),
      terms_accepted: expect.any(String)
    }));
  });

  it('rejects an unknown flat community before policy or registration can fall back to master', async () => {
    api.getTenantBootstrap.mockRejectedValueOnce(new api.ApiError('Not found', 404, {
      errors: [{ code: 'TENANT_NOT_FOUND', message: 'Not found' }]
    }));

    const response = await request(createApp({ mounted: false }))
      .post('/register')
      .type('form')
      .send(completeBody({ tenant_slug: 'missing-community' }));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/register?status=register-validation');
    expect(api.getTenantBootstrap).toHaveBeenCalledWith({ slug: 'missing-community' });
    expect(api.getRegistrationInfo).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
  });

  it('sends the exact v2 payload under mounted tenant authority and never auto-logs in', async () => {
    const response = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody({
        profile_type: 'organisation',
        organization_name: 'Analytical Engines Cooperative'
      }));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=register-created');
    expect(api.getRegistrationInfo).toHaveBeenCalledWith('acme');
    expect(api.register).toHaveBeenCalledWith({
      first_name: 'Ada',
      last_name: 'Lovelace',
      email: 'ada@example.test',
      phone: '+353 87 123 4567',
      location: 'Dublin, Ireland',
      latitude: 53.3498,
      longitude: -6.2603,
      password: 'LongPassword123!',
      password_confirmation: 'LongPassword123!',
      profile_type: 'organisation',
      organization_name: 'Analytical Engines Cooperative',
      terms_accepted: true,
      newsletter_opt_in: true,
      form_started_at: expect.any(Number),
      tenant_slug: 'acme',
      website: ''
    }, 'acme');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('requires an invite when the tenant policy is invite-only', async () => {
    api.getRegistrationInfo.mockResolvedValue({
      data: {
        registration_mode: 'invite_only',
        requires_invite_code: true,
        can_register: true
      }
    });

    const response = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody({ invite_code: '' }));

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/register?status=register-invite-required');
    expect(api.register).not.toHaveBeenCalled();
  });

  it.each([
    ['VALIDATION_DUPLICATE', 'register-duplicate', 409],
    ['PASSWORD_PWNED', 'register-password-pwned', 422],
    ['PASSWORD_MISMATCH', 'register-password-mismatch', 422],
    ['TERMS_REQUIRED', 'register-terms-required', 422],
    ['INVITE_REQUIRED', 'register-invite-required', 422],
    ['INVITE_INVALID', 'register-invite-invalid', 422],
    ['LOCATION_NOT_VERIFIED', 'register-location-unverified', 422],
    ['EMAIL_DISPOSABLE', 'register-email-disposable', 422],
    ['EMAIL_DOMAIN_INVALID', 'register-email-domain-invalid', 422],
    ['REGISTRATION_DAILY_LIMIT', 'register-daily-limit', 429],
    ['REGISTRATION_TENANT_PAUSED', 'register-tenant-paused', 503],
    ['REGISTRATION_CLOSED', 'register-closed', 403],
    ['VALIDATION_ERROR', 'register-validation', 422]
  ])('maps %s to the Laravel status %s', async (code, status, httpStatus) => {
    api.register.mockRejectedValueOnce(new api.ApiError('Rejected', httpStatus, {
      errors: [{ code, message: 'Rejected' }]
    }));

    const response = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody());

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`/acme/accessible/register?status=${status}`);
  });

  it('retains a safe first Laravel validation error field for inline rendering', async () => {
    api.register.mockRejectedValueOnce(new api.ApiError('Invalid phone', 422, {
      errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid phone', field: 'phone' }]
    }));
    const agent = request.agent(createApp());

    const response = await agent
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody());
    const rendered = await agent.get(response.headers.location);

    expect(response.headers.location).toBe('/acme/accessible/register?status=register-validation');
    expect(rendered.body.locals.fieldErrors).toEqual({
      phone: createTranslator('en')('auth.register_validation')
    });
    expect(rendered.body.locals.errors).toEqual([{
      text: createTranslator('en')('auth.register_validation'),
      href: '#phone'
    }]);
  });

  it('renders controller rate limiting as 429 rather than mislabelling it as a daily signup cap', async () => {
    api.register.mockRejectedValueOnce(new api.ApiError('Rate limited', 429, {
      errors: [{ code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limited' }]
    }));

    const response = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody());

    expect(response.status).toBe(429);
    expect(response.body.view).toBe('errors/429');
  });

  it('uses the same visible success redirect for honeypot and minimum-time bot gates', async () => {
    const honeypot = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody({ website: 'https://bot.invalid' }));
    const tooFast = await request(createApp())
      .post('/acme/accessible/register')
      .type('form')
      .send(completeBody({ form_started_at: String(Date.now()) }));

    expect(honeypot.headers.location).toBe('/acme/accessible/login?status=register-created');
    expect(tooFast.headers.location).toBe('/acme/accessible/login?status=register-created');
    expect(api.register).not.toHaveBeenCalled();
  });

  it('keeps the Blade-style fields and removes Turnstile from the registration source', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/views/register.njk'), 'utf8');

    for (const field of [
      'profile_type', 'organization_name', 'invite_code', 'first_name', 'last_name',
      'phone', 'location', 'latitude', 'longitude', 'email', 'password',
      'password_confirmation', 'terms_accepted', 'newsletter_opt_in', 'form_started_at', 'website'
    ]) {
      expect(source).toMatch(new RegExp(`name(?:=|:)\\s*["']${field}["']`));
    }
    expect(source).toContain('minlength: "12"');
    expect(source).not.toContain('cf-turnstile');
    expect(source).not.toContain('TURNSTILE');
  });
});
