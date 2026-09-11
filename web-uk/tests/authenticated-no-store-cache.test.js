// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Defense-in-depth: every response rendered for a signed-in member is
 * personal (wallet, messages, profile, notifications, settings, CSV exports)
 * and must never be stored by the browser's back/forward cache or any shared
 * cache, where it could surface to the next person on the device. A global
 * middleware sets `Cache-Control: private, no-store` whenever the signed
 * `token` cookie is present. This test proves the header is emitted when
 * authenticated and NOT forced for anonymous visitors (so public pages stay
 * cacheable).
 */

const request = require('supertest');
const signature = require('cookie-signature');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
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
  login: jest.fn(),
  setupRequiredTwoFactor: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getListings: jest.fn(),
  getListingCategories: jest.fn(),
  getBalance: jest.fn(),
  getUnreadCount: jest.fn(),
  getTransactions: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn()
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

// A signed cookie as cookie-parser expects it: `s:` + value.hmac, URL-encoded.
function signedTokenCookie(value = 'token:test') {
  return 'token=' + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

describe('authenticated responses are never cached', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({
      data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }]
    });
  });

  it('mounts mandatory enrollment on the real server and protects its posts with CSRF', async () => {
    const setup = await request(app).get('/login/two-factor/setup');
    expect(setup.status).toBe(302);
    expect(setup.headers.location).toContain('/login?status=two-factor-expired');
    await request(app).post('/login/two-factor/setup').type('form').send({ code: '123456' }).expect(419);
    await request(app).post('/login/two-factor/setup/complete').type('form').send({}).expect(419);
  });

  it('renders and completes enrollment through the real server, session and CSRF middleware', async () => {
    const client = request.agent(app);
    api.getTenantBootstrap.mockResolvedValue({ data: { id: 2, slug: 'acme', name: 'Acme' } });
    api.login.mockResolvedValue({ requires_2fa_setup: true, two_factor_token: 'restricted-setup' });
    const signIn = await client.get('/login').expect(200);
    const csrf = html => {
      const match = html.match(/name="_csrf" value="([^"]+)"/);
      expect(match).not.toBeNull();
      return match[1];
    };
    await client.post('/login').type('form').send({ email: 'admin@example.test', password: 'password', tenant_slug: 'acme', _csrf: csrf(signIn.text) }).expect(302);
    api.setupRequiredTwoFactor.mockResolvedValueOnce({ data: { secret: 'JBSWY3DPEHPK3PXP', qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+' } });
    const setup = await client.get('/login/two-factor/setup').expect(200);
    expect(setup.text).toContain('JBSWY3DPEHPK3PXP');
    expect(setup.text).toContain('Set up two-factor authentication');
    api.setupRequiredTwoFactor.mockResolvedValueOnce({ data: { login_complete: true, access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 900, refresh_expires_in: 2592000, backup_codes: ['recover-once'] } });
    const verified = await client.post('/login/two-factor/setup').type('form').send({ code: '123456', _csrf: csrf(setup.text) }).expect(302);
    expect((verified.headers['set-cookie'] || []).join(';')).not.toMatch(/(?:^|;)\s*token=/);
    const recovery = await client.get('/login/two-factor/setup').expect(200);
    expect(recovery.text).toContain('recover-once');
    expect(recovery.text).not.toContain('fixture-access-token');
    expect(recovery.text).not.toContain('fixture-refresh-token');
    expect(recovery.headers['cache-control']).toContain('no-store');
    const complete = await client.post('/login/two-factor/setup/complete').type('form').send({ _csrf: csrf(recovery.text) }).expect(302);
    expect(complete.headers.location).toBe('/dashboard');
    expect((complete.headers['set-cookie'] || []).join(';')).toContain('token=');
  });

  it('sets private, no-store when the signed session token is present', async () => {
    const response = await request(app)
      .get('/')
      .set('Cookie', signedTokenCookie());

    const cacheControl = response.headers['cache-control'] || '';
    expect(cacheControl).toContain('no-store');
    expect(cacheControl).toContain('private');
  });

  it('does not force no-store for an anonymous visitor', async () => {
    const response = await request(app).get('/');

    const cacheControl = response.headers['cache-control'] || '';
    expect(cacheControl).not.toContain('no-store');
  });
});
