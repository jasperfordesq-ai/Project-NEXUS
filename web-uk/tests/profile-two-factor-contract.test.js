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
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const { createChoiceTranslator } = require('../src/lib/localization');
const profileRouter = require('../src/routes/profile');

function createApp({ tc, urlFor = (pathname) => pathname } = {}) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    if (tc) req.tc = tc;
    res.locals.urlFor = urlFor;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });

  return app;
}

describe('Laravel two-factor enrolment contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reads status before initializing disabled enrolment with POST setup', async () => {
    api.callProfileApi
      .mockResolvedValueOnce({
        data: { enabled: false, setup_required: false, backup_codes_remaining: 0 }
      })
      .mockResolvedValueOnce({
        data: {
          qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+',
          secret: 'ABCD EFGH IJKL',
          backup_codes: []
        }
      });

    const response = await request(createApp()).get('/profile/two-factor');

    expect(response.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenNthCalledWith(1, 'test-token', 'GET', '/auth/2fa/status');
    expect(api.callProfileApi).toHaveBeenNthCalledWith(2, 'test-token', 'POST', '/auth/2fa/setup');
    expect(response.body.locals.enabled).toBe(false);
    expect(response.body.locals.setup).toEqual({
      qr_data_uri: 'data:image/svg+xml;base64,PHN2Zy8+',
      secret: 'ABCD EFGH IJKL'
    });
    expect(response.body.locals.backupCodes).toEqual([]);
    expect(response.body.locals.titleKey).toBe('security_2fa.title');
  });

  it('preserves enabled status without reinitializing setup', async () => {
    api.callProfileApi.mockResolvedValueOnce({
      data: { enabled: true, setup_required: false, backup_codes_remaining: 3 }
    });

    const response = await request(createApp()).get('/profile/two-factor');

    expect(response.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenCalledTimes(1);
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/auth/2fa/status');
    expect(response.body.locals.enabled).toBe(true);
    expect(response.body.locals.setup).toBeNull();
    expect(response.body.locals.backupCodesRemaining).toBe(3);
  });

  it('localizes the backup-code count through the request choice translator', async () => {
    api.callProfileApi.mockResolvedValueOnce({
      data: { enabled: true, setup_required: false, backup_codes_remaining: 3 }
    });
    const tc = createChoiceTranslator('ga');

    const response = await request(createApp({ tc })).get('/profile/two-factor');

    expect(response.status).toBe(200);
    expect(response.body.locals.backupCodesRemainingLabel).toBe(
      tc('security_2fa.backup_remaining', 3, { count: 3 })
    );
  });

  it('renders one-time backup codes from verify and does not redisplay them on refresh', async () => {
    api.callProfileApi
      .mockResolvedValueOnce({
        data: { backup_codes: ['otter-amber', 'cedar-river'] }
      })
      .mockResolvedValueOnce({
        data: { enabled: true, setup_required: false, backup_codes_remaining: 2 }
      });

    const app = createApp();
    const verified = await request(app)
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '123456' });

    expect(verified.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenNthCalledWith(
      1,
      'test-token',
      'POST',
      '/auth/2fa/verify',
      { code: '123456' }
    );
    expect(verified.body.locals.status).toBe('2fa-enabled');
    expect(verified.body.locals.enabled).toBe(true);
    expect(verified.body.locals.backupCodes).toEqual(['otter-amber', 'cedar-river']);

    const refreshed = await request(app).get('/profile/two-factor');

    expect(refreshed.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenNthCalledWith(2, 'test-token', 'GET', '/auth/2fa/status');
    expect(api.callProfileApi).toHaveBeenCalledTimes(2);
    expect(refreshed.body.locals.enabled).toBe(true);
    expect(refreshed.body.locals.backupCodes).toEqual([]);
    expect(refreshed.body.locals.backupCodesRemaining).toBe(2);
  });

  it('keeps invalid verification errors on the enrolment page', async () => {
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Invalid verification code', 400));

    const response = await request(createApp())
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '654321' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/two-factor?status=2fa-code-invalid');
    expect(api.callProfileApi).toHaveBeenCalledWith(
      'test-token',
      'POST',
      '/auth/2fa/verify',
      { code: '654321' }
    );
  });

  it('keeps invalid-code redirects inside the active tenant mount', async () => {
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Invalid verification code', 400));

    const response = await request(createApp({
      urlFor: (pathname) => `/acme/accessible${pathname}`
    }))
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '654321' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/profile/two-factor?status=2fa-code-invalid');
  });

  it.each([429, 503])('preserves non-validation API status %s instead of calling the code invalid', async (status) => {
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Upstream failure', status));

    const response = await request(createApp())
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '654321' });

    expect(response.status).toBe(status);
    expect(response.headers.location).toBeUndefined();
  });

  it('redirects an expired backend session through the tenant-aware login path', async () => {
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Unauthenticated', 401));

    const response = await request(createApp({
      urlFor: (pathname) => `/acme/accessible${pathname}`
    }))
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '654321' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
  });

  it('uses the exact Laravel keys for visible two-factor setup chrome', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'profile', 'two-factor.njk'),
      'utf8'
    );

    for (const key of [
      'security_2fa.back',
      'states.warning',
      'security_2fa.disable_heading',
      'security_2fa.qr_alt'
    ]) {
      expect(source).toContain(`t("${key}")`);
    }
    expect(source).not.toContain('>Back to settings<');
    expect(source).not.toContain('>Warning<');
    expect(source).not.toContain('alt="QR code for setting up two-step verification"');
  });
});
