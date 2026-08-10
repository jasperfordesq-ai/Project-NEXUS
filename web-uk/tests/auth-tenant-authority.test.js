// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
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
  verifyEmail: jest.fn(),
  callNewsletterApi: jest.fn(),
  invalidateUserCache: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  setAuthCookies: jest.fn(),
  clearAuthCookies: jest.fn()
}));

const api = require('../src/lib/api');
const { setAuthCookies } = require('../src/middleware/auth');
const authRouter = require('../src/routes/auth');
const publicInfoRouter = require('../src/routes/public-info');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({
    secret: 'auth-tenant-authority-test-secret',
    resave: false,
    saveUninitialized: true
  }));
  app.use((req, res, next) => {
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });

  app.use('/acme/accessible', (req, res, next) => {
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    };
    res.locals.urlFor = (pathname) => `/acme/accessible${pathname}`;
    next();
  }, authRouter, publicInfoRouter);

  app.use(authRouter);
  app.use(publicInfoRouter);
  app.get('/__test/session', (req, res) => res.json({
    pending2faToken: req.session.pending2faToken || null,
    pending2faTenantSlug: req.session.pending2faTenantSlug || null
  }));
  return app;
}

describe('auth tenant authority', () => {
  let app;

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
    api.getTenantBootstrap.mockImplementation(({ slug }) => Promise.resolve({
      data: { id: 2, slug, name: slug }
    }));
    app = createApp();
  });

  it('uses the mounted tenant for login even when a different tenant is posted', async () => {
    api.login.mockResolvedValue({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 900, refresh_expires_in: 604800 });

    const response = await request(app)
      .post('/acme/accessible/login')
      .type('form')
      .send({
        email: 'member@example.test',
        password: 'Test123!',
        tenant_slug: 'crafted-other-tenant'
      });

    expect(response.status).toBe(302);
    expect(api.login).toHaveBeenCalledWith('member@example.test', 'Test123!', 'acme');
  });

  it('keeps accepting the posted tenant for flat login', async () => {
    api.login.mockResolvedValue({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 900, refresh_expires_in: 604800 });

    const response = await request(app)
      .post('/login')
      .type('form')
      .send({
        email: 'member@example.test',
        password: 'Test123!',
        tenant_slug: 'flat-community'
      });

    expect(response.status).toBe(302);
    expect(api.login).toHaveBeenCalledWith('member@example.test', 'Test123!', 'flat-community');
  });

  it('uses the mounted tenant header for registration without automatic login', async () => {
    api.register.mockResolvedValue({});

    const response = await request(app)
      .post('/acme/accessible/register')
      .type('form')
      .send({
        email: 'new-member@example.test',
        password: 'LongPassword123!',
        password_confirmation: 'LongPassword123!',
        first_name: 'New',
        last_name: 'Member',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        terms_accepted: '1',
        form_started_at: Date.now() - 6000,
        tenant_slug: 'crafted-other-tenant'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=register-created');
    expect(api.getRegistrationInfo).toHaveBeenCalledWith('acme');
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({
      tenant_slug: 'acme',
      password_confirmation: 'LongPassword123!',
      phone: '+353871234567',
      location: 'Dublin, Ireland',
      terms_accepted: true
    }), 'acme');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('keeps accepting the posted tenant for flat registration', async () => {
    api.register.mockResolvedValue({});

    const response = await request(app)
      .post('/register')
      .type('form')
      .send({
        email: 'new-member@example.test',
        password: 'LongPassword123!',
        password_confirmation: 'LongPassword123!',
        first_name: 'New',
        last_name: 'Member',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        terms_accepted: '1',
        form_started_at: Date.now() - 6000,
        tenant_slug: 'flat-community'
      });

    expect(response.status).toBe(302);
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({
      tenant_slug: 'flat-community'
    }), 'flat-community');
    expect(api.getTenantBootstrap).toHaveBeenCalledWith({ slug: 'flat-community' });
    expect(api.getRegistrationInfo).toHaveBeenCalledWith('flat-community');
    expect(api.login).not.toHaveBeenCalled();
  });

  it('uses the mounted tenant for password recovery even when a different tenant is posted', async () => {
    api.forgotPassword.mockResolvedValue({});

    const response = await request(app)
      .post('/acme/accessible/login/forgot-password')
      .type('form')
      .send({
        email: 'member@example.test',
        tenant_slug: 'crafted-other-tenant'
      });

    expect(response.status).toBe(302);
    expect(api.forgotPassword).toHaveBeenCalledWith('member@example.test', 'acme');
  });

  it('keeps accepting the posted tenant for flat password recovery', async () => {
    api.forgotPassword.mockResolvedValue({});

    const response = await request(app)
      .post('/login/forgot-password')
      .type('form')
      .send({
        email: 'member@example.test',
        tenant_slug: 'flat-community'
      });

    expect(response.status).toBe(302);
    expect(api.forgotPassword).toHaveBeenCalledWith('member@example.test', 'flat-community');
  });

  it('stores tenant authority with the 2FA challenge and clears both after exact token-envelope success', async () => {
    api.login.mockResolvedValueOnce({
      requires_2fa: true,
      two_factor_token: 'pending-two-factor-token',
      allow_trusted_device: true,
      trusted_device_days: 45
    });
    api.verify2fa.mockResolvedValueOnce({
      success: true,
      access_token: 'verified-access-token',
      refresh_token: 'verified-refresh-token',
      expires_in: 900,
      refresh_expires_in: 604800
    });
    const agent = request.agent(app);

    const loginResponse = await agent
      .post('/acme/accessible/login')
      .type('form')
      .send({
        email: 'member@example.test',
        password: 'Test123!',
        tenant_slug: 'crafted-other-tenant'
      });

    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.location).toBe('/acme/accessible/login/two-factor');
    expect((await agent.get('/__test/session')).body).toEqual({
      pending2faToken: 'pending-two-factor-token',
      pending2faTenantSlug: 'acme'
    });

    const twoFactorPage = await agent.get('/acme/accessible/login/two-factor');
    expect(twoFactorPage.body.locals).toEqual(expect.objectContaining({
      allowTrustedDevice: true,
      trustedDeviceDays: 45
    }));

    const verifyResponse = await agent
      .post('/acme/accessible/login/two-factor')
      .type('form')
      .send({
        code: 'ABCD1234',
        use_backup_code: '1',
        trust_device: '1',
        tenant_slug: 'crafted-other-tenant'
      });

    expect(verifyResponse.status).toBe(302);
    expect(verifyResponse.headers.location).toBe('/acme/accessible/dashboard');
    expect(api.verify2fa).toHaveBeenCalledWith('pending-two-factor-token', 'ABCD1234', 'acme', {
      useBackupCode: true,
      trustDevice: true
    });
    expect(setAuthCookies).toHaveBeenCalledWith(
      expect.anything(),
      'verified-access-token',
      'verified-refresh-token',
      {
        expiresIn: 900,
        refreshExpiresIn: 604800,
        tenantSlug: 'acme'
      }
    );
    expect((await agent.get('/__test/session')).body).toEqual({
      pending2faToken: null,
      pending2faTenantSlug: null
    });
  });

  it('keeps a retryable 2FA challenge but clears expired challenge state', async () => {
    api.login.mockResolvedValueOnce({
      requires_2fa: true,
      two_factor_token: 'retryable-two-factor-token'
    });
    const agent = request.agent(app);
    await agent
      .post('/acme/accessible/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'Test123!' });

    api.verify2fa.mockRejectedValueOnce(new api.ApiError('Invalid code', 401, {
      errors: [{ code: 'AUTH_2FA_INVALID' }]
    }));
    const invalid = await agent
      .post('/acme/accessible/login/two-factor')
      .type('form')
      .send({ code: '111111' });

    expect(invalid.status).toBe(200);
    expect(invalid.body.view).toBe('login');
    expect(invalid.body.locals.show2fa).toBe(true);
    expect((await agent.get('/__test/session')).body).toEqual({
      pending2faToken: 'retryable-two-factor-token',
      pending2faTenantSlug: 'acme'
    });

    api.verify2fa.mockRejectedValueOnce(new api.ApiError('Challenge expired', 401, {
      errors: [{ code: 'AUTH_2FA_TOKEN_EXPIRED' }]
    }));
    const expired = await agent
      .post('/acme/accessible/login/two-factor')
      .type('form')
      .send({ code: '222222' });

    expect(expired.status).toBe(302);
    expect(expired.headers.location).toBe('/acme/accessible/login?status=two-factor-expired');
    expect((await agent.get('/__test/session')).body).toEqual({
      pending2faToken: null,
      pending2faTenantSlug: null
    });
  });

  it('suppresses and rejects trusted-device requests when Laravel disables them', async () => {
    api.login.mockResolvedValueOnce({
      requires_2fa: true,
      two_factor_token: 'no-trust-token',
      allow_trusted_device: false,
      trusted_device_days: 60
    });
    api.verify2fa.mockResolvedValueOnce({
      success: true,
      access_token: 'verified-access-token',
      refresh_token: 'verified-refresh-token',
      expires_in: 900,
      refresh_expires_in: 604800
    });
    const agent = request.agent(app);

    await agent
      .post('/acme/accessible/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'Test123!' });

    const page = await agent.get('/acme/accessible/login/two-factor');
    expect(page.body.locals.allowTrustedDevice).toBe(false);

    await agent
      .post('/acme/accessible/login/two-factor')
      .type('form')
      .send({ code: '123456', trust_device: '1' });

    expect(api.verify2fa).toHaveBeenCalledWith('no-trust-token', '123456', 'acme', {
      useBackupCode: false,
      trustDevice: false
    });
  });

  it('rejects a nested or incomplete 2FA token envelope without authenticating', async () => {
    api.login.mockResolvedValueOnce({
      requires_2fa: true,
      two_factor_token: 'malformed-response-token'
    });
    api.verify2fa.mockResolvedValueOnce({
      data: {
        access_token: 'incorrectly-nested-access-token',
        refresh_token: 'incorrectly-nested-refresh-token'
      }
    });
    const agent = request.agent(app);
    await agent
      .post('/acme/accessible/login')
      .type('form')
      .send({ email: 'member@example.test', password: 'Test123!' });

    const response = await agent
      .post('/acme/accessible/login/two-factor')
      .type('form')
      .send({ code: '123456' });

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('login');
    expect(response.body.locals.show2fa).toBe(true);
    expect(setAuthCookies).not.toHaveBeenCalled();
    expect((await agent.get('/__test/session')).body).toEqual({
      pending2faToken: 'malformed-response-token',
      pending2faTenantSlug: 'acme'
    });
  });

  it('passes mounted tenant authority to resend and email-verification calls', async () => {
    api.resendVerification.mockResolvedValueOnce({ data: { message: 'sent' } });
    api.verifyEmail.mockResolvedValueOnce({ data: { verified: true } });

    const resend = await request(app)
      .post('/acme/accessible/login/resend-verification')
      .type('form')
      .send({
        email: 'Member@Example.TEST',
        tenant_slug: 'crafted-other-tenant'
      });
    const verification = await request(app)
      .get('/acme/accessible/verify-email?token=email-verification-token');

    expect(resend.status).toBe(302);
    expect(api.resendVerification).toHaveBeenCalledWith('member@example.test', 'acme');
    expect(verification.status).toBe(200);
    expect(verification.body.locals.state).toBe('success');
    expect(api.verifyEmail).toHaveBeenCalledWith('email-verification-token', 'acme');
  });
});
