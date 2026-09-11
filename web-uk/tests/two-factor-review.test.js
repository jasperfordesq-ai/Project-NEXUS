// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Two-factor security review (register engagement E-004): pins the accessible
// site's handling of enrolment secrets, recovery codes and the remembered-device
// cookie. Each test names the property it protects.

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiOfflineError: class ApiOfflineError extends Error {},
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
const profileRouter = require('../src/routes/profile');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.secret = 'test-cookie-secret'; // cookie-parser sets this in the real app; signed clearCookie needs it
    req.session = { destroy: (cb) => cb && cb() };
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('P11 — enrolment secrets and one-time recovery codes are never cacheable', () => {
  it('sends no-store with the enrolment page that shows the QR code and setup key', async () => {
    api.callProfileApi
      .mockResolvedValueOnce({ data: { enabled: false, backup_codes_remaining: 0 } })
      .mockResolvedValueOnce({ data: { secret: 'SETUPKEY', qr_code_url: 'data:image/svg+xml;base64,abc' } });

    const response = await request(createApp()).get('/profile/two-factor').expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
  });

  it('sends no-store with the page that shows freshly issued recovery codes', async () => {
    api.callProfileApi.mockResolvedValueOnce({ data: { backup_codes: ['ABCD-1234', 'EFGH-5678'] } });

    const response = await request(createApp())
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: '123456' })
      .expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(JSON.stringify(response.body)).toContain('ABCD-1234');
  });
});

describe('P12 — code input is validated locally before it is forwarded', () => {
  it('refuses a non-six-digit enrolment code without calling the API', async () => {
    const response = await request(createApp())
      .post('/profile/two-factor/verify')
      .type('form')
      .send({ code: 'not-a-code' })
      .expect(302);
    expect(response.headers.location).toContain('2fa-code-invalid');
    expect(api.callProfileApi).not.toHaveBeenCalled();
  });
});

describe('P5 — the remembered-device cookie is cleared with the same attributes it was set with', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  it('clears the cookie as Secure in production when devices are revoked', async () => {
    process.env.NODE_ENV = 'production';
    api.callProfileApi.mockResolvedValueOnce({ data: { revoked_count: 1 } });

    const response = await request(createApp()).post('/profile/two-factor/revoke-devices').expect(302);
    const cleared = (response.headers['set-cookie'] || []).find((c) => c.startsWith('nexus_trusted_device='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/;\s*Secure/i);
    expect(cleared).toMatch(/;\s*HttpOnly/i);
  });

  it('clears the cookie as Secure in production when the factor is disabled', async () => {
    process.env.NODE_ENV = 'production';
    api.callProfileApi.mockResolvedValueOnce({ data: { message: 'disabled' } });

    const response = await request(createApp())
      .post('/profile/two-factor/disable')
      .type('form')
      .send({ password: 'correct-horse' })
      .expect(302);
    const cleared = (response.headers['set-cookie'] || []).find((c) => c.startsWith('nexus_trusted_device='));
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/;\s*Secure/i);
  });
});

describe('Resilience — a failed upstream call renders a message, not a crash', () => {
  it('reports a revoke-devices failure on the two-factor page instead of a 500', async () => {
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Upstream unavailable', 503));

    const response = await request(createApp()).post('/profile/two-factor/revoke-devices');
    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('/profile/two-factor');
    expect(response.headers.location).toMatch(/status=2fa-devices-revoke-failed/);
  });
});
