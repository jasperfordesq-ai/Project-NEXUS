// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A community paused for non-payment shows a paused page on the accessible site.
 *
 * Laravel says so two ways: the tenant bootstrap carries `billing_paused: true`,
 * and every member-side API call answers HTTP 403 with code COMMUNITY_PAUSED.
 * Either one must put the paused page in front of every member page, while
 * sign-in and sign-out keep working. The page never mentions payment: why a
 * community is paused is for its admins, not its members.
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
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  refreshToken: jest.fn(),
  validateToken: jest.fn(),
  getUnreadCount: jest.fn(),
  getNotificationUnreadCount: jest.fn(),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn(),
  getLegalAcceptanceStatus: jest.fn()
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

const PAUSED_BODY = Object.freeze({
  success: false,
  error: 'This community is paused.',
  code: 'COMMUNITY_PAUSED'
});

function signedCookie(name, value) {
  return `${name}=` + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

function jwtWithExpiry(expiresAt) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expiresAt })}.signature`;
}

function tenant(overrides = {}) {
  return {
    data: {
      id: 7,
      name: 'Acme Timebank',
      slug: 'acme',
      features: {},
      modules: {},
      ...overrides
    }
  };
}

describe('the paused page on the accessible site', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.getUnreadCount.mockResolvedValue({ data: { count: 0 } });
    api.getNotificationUnreadCount.mockResolvedValue({ data: { unread: 0 } });
    api.getPlatformStats.mockResolvedValue({ data: {} });
    api.getLegalAcceptanceStatus.mockResolvedValue({ data: { documents: [] } });
  });

  describe('when the tenant bootstrap says the community is paused', () => {
    beforeEach(() => {
      api.getTenantBootstrap.mockResolvedValue(tenant({ billing_paused: true }));
    });

    it('answers a member page with 503, a day-long Retry-After and noindex', async () => {
      const response = await request(app).get('/acme/accessible/listings');

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('86400');
      expect(response.headers['x-robots-tag']).toMatch(/noindex/);
      expect(response.text).toMatch(/<meta name="robots" content="noindex/);
    });

    it('names the community, says nothing about payment, and offers sign-in to a visitor', async () => {
      const response = await request(app).get('/acme/accessible/listings');

      expect(response.text).toContain('<h1 class="govuk-heading-xl">Acme Timebank is paused</h1>');
      expect(response.text).toContain('This community is not available at the moment. Please contact its organisers.');
      expect(response.text).toContain('href="/acme/accessible/login"');
      expect(response.text).not.toMatch(/pay|billing|invoice/i);
      expect(response.text).not.toContain('/acme/accessible/logout');
    });

    it('covers the community home page too', async () => {
      const response = await request(app).get('/acme/accessible/');

      expect(response.status).toBe(503);
      expect(response.text).toContain('Acme Timebank is paused');
    });

    it('offers a signed-in member a working sign-out form instead of sign-in', async () => {
      const response = await request(app)
        .get('/acme/accessible/dashboard')
        .set('Cookie', [
          signedCookie('token', jwtWithExpiry(Math.floor(Date.now() / 1000) + 3600)),
          signedCookie('refresh_token', 'refresh')
        ].join('; '));

      expect(response.status).toBe(503);
      expect(response.text).toContain('Acme Timebank is paused');
      expect(response.text).toMatch(/<form method="post" action="\/acme\/accessible\/logout"/);
      expect(response.text).toMatch(/name="_csrf" value="[^"]+"/);
      expect(response.text).not.toContain('href="/acme/accessible/login"');
    });

    it('leaves the sign-in page working', async () => {
      const response = await request(app).get('/acme/accessible/login');

      expect(response.status).toBe(200);
      expect(response.text).not.toContain('Acme Timebank is paused');
    });

    it('renders in the reader\'s language', async () => {
      const response = await request(app).get('/acme/accessible/listings?locale=de');

      expect(response.status).toBe(503);
      expect(response.text).toContain('Acme Timebank ist pausiert');
    });
  });

  describe('when the bootstrap does not say so', () => {
    it('shows the community normally', async () => {
      api.getTenantBootstrap.mockResolvedValue(tenant({ billing_paused: false }));

      const response = await request(app).get('/acme/accessible/');

      expect(response.status).toBe(200);
      expect(response.text).not.toContain('is paused');
    });

    it('shows the paused page when an API call answers COMMUNITY_PAUSED', async () => {
      // The bootstrap is cached for a short while, so the API can close first.
      api.getTenantBootstrap.mockResolvedValue(tenant());
      api.getPlatformStats.mockRejectedValue(new api.ApiError('This community is paused.', 403, PAUSED_BODY));

      const response = await request(app).get('/acme/accessible/');

      expect(response.status).toBe(503);
      expect(response.headers['retry-after']).toBe('86400');
      expect(response.text).toContain('Acme Timebank is paused');
    });

    it('does not mistake another refusal for a pause', async () => {
      api.getTenantBootstrap.mockResolvedValue(tenant());
      api.getPlatformStats.mockRejectedValue(new api.ApiError('Forbidden', 403, { success: false, code: 'SOMETHING_ELSE' }));

      const response = await request(app).get('/acme/accessible/');

      expect(response.status).not.toBe(503);
      expect(response.text).not.toContain('is paused');
    });
  });
});
