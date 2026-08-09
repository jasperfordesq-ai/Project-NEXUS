// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Unit tests for API client
 */

// Mock fetch before requiring the module
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Set environment variable before requiring
process.env.API_BASE_URL = 'http://localhost:5000';

const { ApiError, ApiOfflineError } = require('../src/lib/api');

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  describe('ApiError', () => {
    it('should create error with message and status', () => {
      const error = new ApiError('Test error', 400, { field: 'value' });

      expect(error.message).toBe('Test error');
      expect(error.status).toBe(400);
      expect(error.data).toEqual({ field: 'value' });
      expect(error.name).toBe('ApiError');
    });
  });

  describe('ApiOfflineError', () => {
    it('should create offline error with default message', () => {
      const error = new ApiOfflineError();

      expect(error.message).toBe('Unable to connect to the service');
      expect(error.status).toBe(503);
      expect(error.name).toBe('ApiOfflineError');
    });

    it('should accept custom message', () => {
      const error = new ApiOfflineError('Custom offline message');

      expect(error.message).toBe('Custom offline message');
    });
  });
});

describe('API Request Functions', () => {
  // Re-require to get fresh module with mocked fetch
  let api;

  beforeEach(() => {
    jest.resetModules();
    mockFetch.mockClear();
    api = require('../src/lib/api');
  });

  describe('request-scoped tenant authority', () => {
    const jsonResponse = (body = { data: [] }) => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body
    });

    it('normalizes routed slugs without accepting path or header syntax', () => {
      const { normalizeTenantSlug } = require('../src/lib/request-tenant-context');

      expect(normalizeTenantSlug(' Acme-Timebank ')).toBe('acme-timebank');
      expect(normalizeTenantSlug('legacy_slug')).toBe('legacy_slug');
      expect(normalizeTenantSlug('acme/timebank')).toBeNull();
      expect(normalizeTenantSlug('acme\r\nX-Tenant-ID: 1')).toBeNull();
    });

    it('uses the routed tenant slug for anonymous API and download requests', async () => {
      const previousTenantId = process.env.TENANT_ID;
      const previousAccessibleSlug = process.env.ACCESSIBLE_TENANT_SLUG;
      process.env.TENANT_ID = '1';
      delete process.env.ACCESSIBLE_TENANT_SLUG;
      jest.resetModules();
      api = require('../src/lib/api');
      const { runWithRequestTenant } = require('../src/lib/request-tenant-context');
      mockFetch
        .mockResolvedValueOnce(jsonResponse({ data: [], meta: { cursor: null, has_more: false } }))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: {
            get: (name) => name.toLowerCase() === 'content-type' ? 'text/csv' : null
          },
          arrayBuffer: async () => Buffer.from('wallet export')
        });

      try {
        await runWithRequestTenant('acme', async () => {
          await api.getEvents('', { per_page: 20, tenant_slug: 'untrusted-query' });
          await api.callWalletDownload('', '/export.csv');
        });

        for (const [, options] of mockFetch.mock.calls) {
          expect(options.headers).toEqual(expect.objectContaining({ 'X-Tenant-Slug': 'acme' }));
          expect(options.headers).not.toHaveProperty('X-Tenant-ID');
        }
        expect(mockFetch.mock.calls[0][0]).not.toContain('tenant_slug');
      } finally {
        if (previousTenantId === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previousTenantId;
        if (previousAccessibleSlug === undefined) delete process.env.ACCESSIBLE_TENANT_SLUG;
        else process.env.ACCESSIBLE_TENANT_SLUG = previousAccessibleSlug;
      }
    });

    it('prefers the configured flat-local tenant slug over the legacy tenant id fallback', async () => {
      const previousTenantId = process.env.TENANT_ID;
      const previousAccessibleSlug = process.env.ACCESSIBLE_TENANT_SLUG;
      process.env.TENANT_ID = '1';
      process.env.ACCESSIBLE_TENANT_SLUG = 'hour-timebank';
      jest.resetModules();
      api = require('../src/lib/api');
      mockFetch.mockResolvedValueOnce(jsonResponse({ data: [], meta: { cursor: null, has_more: false } }));

      try {
        await api.getListings('', { per_page: 20 });
        expect(mockFetch.mock.calls[0][1].headers).toEqual(expect.objectContaining({
          'X-Tenant-Slug': 'hour-timebank'
        }));
        expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
      } finally {
        if (previousTenantId === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previousTenantId;
        if (previousAccessibleSlug === undefined) delete process.env.ACCESSIBLE_TENANT_SLUG;
        else process.env.ACCESSIBLE_TENANT_SLUG = previousAccessibleSlug;
      }
    });

    it('keeps concurrent anonymous tenant contexts isolated', async () => {
      const previousTenantId = process.env.TENANT_ID;
      const previousAccessibleSlug = process.env.ACCESSIBLE_TENANT_SLUG;
      delete process.env.TENANT_ID;
      delete process.env.ACCESSIBLE_TENANT_SLUG;
      jest.resetModules();
      api = require('../src/lib/api');
      const { runWithRequestTenant } = require('../src/lib/request-tenant-context');
      mockFetch.mockImplementation(async () => {
        await new Promise((resolve) => global.setImmediate(resolve));
        return jsonResponse({ data: [], meta: { cursor: null, has_more: false } });
      });

      try {
        await Promise.all([
          runWithRequestTenant('tenant-one', async () => {
            await new Promise((resolve) => global.setImmediate(resolve));
            return api.getEvents('', { per_page: 20 });
          }),
          runWithRequestTenant('tenant-two', async () => {
            await Promise.resolve();
            return api.getListings('', { per_page: 20 });
          })
        ]);

        const eventCall = mockFetch.mock.calls.find(([url]) => url.includes('/api/v2/events'));
        const listingCall = mockFetch.mock.calls.find(([url]) => url.includes('/api/v2/listings'));
        expect(eventCall[1].headers['X-Tenant-Slug']).toBe('tenant-one');
        expect(listingCall[1].headers['X-Tenant-Slug']).toBe('tenant-two');
      } finally {
        if (previousTenantId === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previousTenantId;
        if (previousAccessibleSlug === undefined) delete process.env.ACCESSIBLE_TENANT_SLUG;
        else process.env.ACCESSIBLE_TENANT_SLUG = previousAccessibleSlug;
      }
    });
  });

  describe('login', () => {
    it('should send correct request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ access_token: 'test-token', user: { id: 1 } })
      });

      const result = await api.login('test@example.com', 'password123', 'acme');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          }),
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
            tenant_slug: 'acme'
          })
        })
      );
      expect(result.access_token).toBe('test-token');
    });

    it('should resolve Laravel login tenant context from the submitted community code', async () => {
      process.env.TENANT_ID = '1';
      jest.resetModules();
      api = require('../src/lib/api');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ access_token: 'test-token', user: { id: 1, tenant_id: 2 } })
      });

      await api.login('test@example.com', 'password123', 'hour-timebank');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/login',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tenant-Slug': 'hour-timebank'
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
    });

    it('should not send the default tenant id on authenticated Laravel requests', async () => {
      process.env.TENANT_ID = '1';
      jest.resetModules();
      api = require('../src/lib/api');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ id: 123, email: 'test@example.com' })
      });

      await api.getProfile('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
    });

    it('should throw ApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ error: 'Invalid credentials' })
      });

      await expect(api.login('test@example.com', 'wrong', 'acme'))
        .rejects.toThrow(api.ApiError);
    });

    it('should surface Laravel errors array messages', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          errors: [
            { code: 'ALREADY_EXISTS', message: 'A connection with this user already exists' }
          ]
        })
      });

      await expect(api.sendConnectionRequest('test-token', 2))
        .rejects.toThrow('A connection with this user already exists');
    });
  });

  describe('registration', () => {
    const successfulJson = (body) => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(body)
    });

    it('uses Laravel v2 registration with explicit tenant authority', async () => {
      mockFetch.mockResolvedValueOnce(successfulJson({
        data: { requires_verification: true }
      }));
      const payload = {
        first_name: 'Ada',
        last_name: 'Lovelace',
        email: 'ada@example.test',
        phone: '+353871234567',
        location: 'Dublin, Ireland',
        password: 'LongPassword123!',
        password_confirmation: 'LongPassword123!',
        terms_accepted: true
      };

      await api.register(payload, 'acme');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/auth/register',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Tenant-Slug': 'acme'
          }),
          body: JSON.stringify(payload)
        })
      );
    });

    it('reads registration policy and validates invites through tenant-scoped v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce(successfulJson({ data: { registration_mode: 'invite_only' } }))
        .mockResolvedValueOnce(successfulJson({ data: { valid: true, reason: null } }));

      await api.getRegistrationInfo('acme');
      await api.validateRegistrationInvite('acme', 'ABCD1234');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/auth/registration-info',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/auth/validate-invite',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' }),
          body: JSON.stringify({ code: 'ABCD1234' })
        })
      );
    });
  });

  describe('validateToken', () => {
    it('should use Laravel\'s canonical token validation endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { valid: true, user: { id: 42 } } })
      });

      await api.validateToken('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/validate-token',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should change passwords through Laravel v2 users/me', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { password_updated: true } })
      });

      await api.changePassword('test-token', 'old-password', 'new-password');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me/password',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ current_password: 'old-password', new_password: 'new-password' })
        })
      );
    });
  });

  describe('refreshToken', () => {
    it('should use Laravel\'s refresh-token endpoint and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ access_token: 'fresh-token', refresh_token: 'fresh-refresh-token' })
      });

      await api.refreshToken('expired-access-refresh-token', 'hour-timebank');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/refresh-token',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'hour-timebank' }),
          body: JSON.stringify({ refresh_token: 'expired-access-refresh-token' })
        })
      );
    });
  });

  describe('logout', () => {
    it('submits the rotating refresh credential for family revocation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: true })
      });

      await api.logout('short-access-token', 'rotating-refresh-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer short-access-token' }),
          body: JSON.stringify({ refresh_token: 'rotating-refresh-token' })
        })
      );
    });
  });

  describe('tenant-scoped public authentication contracts', () => {
    const successfulJson = (body) => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body
    });

    it('completes Laravel TOTP login with the challenge token in the body', async () => {
      const responseBody = {
        success: true,
        access_token: 'verified-access-token',
        refresh_token: 'verified-refresh-token',
        token_type: 'Bearer'
      };
      mockFetch.mockResolvedValueOnce(successfulJson(responseBody));

      const result = await api.verify2fa('pending-two-factor-token', 'ABCD1234', 'acme', {
        useBackupCode: true,
        trustDevice: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/totp/verify',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Tenant-Slug': 'acme'
          }),
          body: JSON.stringify({
            two_factor_token: 'pending-two-factor-token',
            code: 'ABCD1234',
            use_backup_code: true,
            trust_device: true
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
      expect(result).toEqual(responseBody);
    });

    it('sends tenant authority as a header for recovery and email verification', async () => {
      mockFetch
        .mockResolvedValueOnce(successfulJson({ data: { message: 'reset sent' } }))
        .mockResolvedValueOnce(successfulJson({ data: { message: 'verification sent' } }))
        .mockResolvedValueOnce(successfulJson({ data: { verified: true } }));

      await api.forgotPassword('member@example.test', 'acme');
      await api.resendVerification('member@example.test', 'acme');
      await api.verifyEmail('email-verification-token', 'acme');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/auth/forgot-password',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' }),
          body: JSON.stringify({ email: 'member@example.test' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/auth/resend-verification-by-email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' }),
          body: JSON.stringify({ email: 'member@example.test' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/auth/verify-email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' }),
          body: JSON.stringify({ token: 'email-verification-token' })
        })
      );
    });
  });

  describe('getTenants', () => {
    it('should call the Laravel tenant list endpoint without master by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [{ id: 2, slug: 'acme' }] })
      });

      const result = await api.getTenants();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/tenants',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data[0].slug).toBe('acme');
    });

    it('should opt in to the Laravel master tenant list parameter', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [{ id: 1, slug: 'master' }] })
      });

      await api.getTenants({ includeMaster: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/tenants?include_master=1',
        expect.any(Object)
      );
    });
  });

  describe('getTenantBootstrap', () => {
    it('should ask Laravel to resolve tenant bootstrap data from the supplied host', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 2, slug: 'acme', accessible_domain: 'acme-accessible.test' } })
      });

      const result = await api.getTenantBootstrap({ host: 'acme-accessible.test:5180' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/tenant/bootstrap',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Host: 'acme-accessible.test',
            Origin: 'https://acme-accessible.test'
          })
        })
      );
      expect(result.data.slug).toBe('acme');
    });

    it('should not override host-scoped bootstrap resolution with configured tenant fallbacks', async () => {
      const previousTenantId = process.env.TENANT_ID;
      const previousAccessibleSlug = process.env.ACCESSIBLE_TENANT_SLUG;
      process.env.TENANT_ID = '2';
      process.env.ACCESSIBLE_TENANT_SLUG = 'hour-timebank';
      jest.resetModules();
      api = require('../src/lib/api');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 4, slug: 'timebank-global', domain: 'timebank.global' } })
      });

      try {
        await api.getTenantBootstrap({ host: 'timebank.global' });

        expect(mockFetch.mock.calls[0][1].headers).toEqual(expect.objectContaining({
          Host: 'timebank.global',
          Origin: 'https://timebank.global'
        }));
        expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-Slug');
        expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
      } finally {
        if (previousTenantId === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = previousTenantId;
        if (previousAccessibleSlug === undefined) delete process.env.ACCESSIBLE_TENANT_SLUG;
        else process.env.ACCESSIBLE_TENANT_SLUG = previousAccessibleSlug;
      }
    });

    it('should ask Laravel to resolve tenant bootstrap data from an explicit slug', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 2, slug: 'acme' } })
      });

      await api.getTenantBootstrap({ slug: 'acme' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/tenant/bootstrap?slug=acme',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Tenant-Slug': 'acme' })
        })
      );
    });
  });

  describe('getPlatformStats', () => {
    it('should call the Laravel public platform stats endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { members: 10, hours_exchanged: 25.5 } })
      });

      const result = await api.getPlatformStats();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/platform/stats',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data.members).toBe(10);
    });

    it('should pass an explicit tenant slug when fetching tenant-scoped stats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { scope: 'tenant', communities: 1 } })
      });

      await api.getPlatformStats({ slug: 'acme' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/platform/stats',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Tenant-Slug': 'acme'
          })
        })
      );
    });

    it('should pass a custom accessible host when fetching host-scoped stats', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { scope: 'tenant', communities: 1 } })
      });

      await api.getPlatformStats({ host: 'acme-accessible.test:5180' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/platform/stats',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Host: 'acme-accessible.test',
            Origin: 'https://acme-accessible.test'
          })
        })
      );
    });

    it('should not override host-scoped stats resolution with the default tenant id', async () => {
      process.env.TENANT_ID = '2';
      jest.resetModules();
      api = require('../src/lib/api');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { scope: 'tenant', communities: 5 } })
      });

      await api.getPlatformStats({ host: 'timebank.global' });

      expect(mockFetch.mock.calls[0][1].headers).toEqual(expect.objectContaining({
        Host: 'timebank.global',
        Origin: 'https://timebank.global'
      }));
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
    });
  });

  describe('getListings', () => {
    it('should send auth header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [], pagination: {} })
      });

      await api.getListings('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });

    it('should use Laravel cursor and supported listing query params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [] })
      });

      await api.getListings('test-token', { q: 'garden', type: 'offer', cursor: 'next-page', per_page: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings?type=offer&q=garden&cursor=next-page&per_page=20',
        expect.anything()
      );
    });

    it('should call the Laravel v2 listings endpoint with accessible filter params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [], meta: { total_items: 0 } })
      });

      await api.getListings('test-token', {
        search: 'garden',
        type: 'offer',
        category_id: 3,
        skills: 'pruning',
        featured_first: true,
        min_hours: '1',
        max_hours: '3',
        service_type: 'remote_only',
        posted_within: '7',
        near_lat: '54.6',
        near_lng: '-5.9',
        radius_km: '10',
        cursor: 'abc',
        per_page: 20
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings?type=offer&q=garden&category_id=3&skills=pruning&featured_first=true&min_hours=1&max_hours=3&service_type=remote_only&posted_within=7&near_lat=54.6&near_lng=-5.9&radius_km=10&cursor=abc&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should call the Laravel v2 listing detail endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            id: 90992,
            title: 'E2E Fixture Listing - Gardening Help'
          }
        })
      });

      const result = await api.getListing('test-token', 90992);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings/90992',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.title).toBe('E2E Fixture Listing - Gardening Help');
    });

    it('should call the Laravel v2 listing detail endpoint with tenant slug for public fallback', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            id: 90992,
            title: 'E2E Fixture Listing - Gardening Help'
          }
        })
      });

      const result = await api.getPublicListing(90992, 'hour-timebank');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings/90992',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Tenant-Slug': 'hour-timebank'
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
      expect(result.data.title).toBe('E2E Fixture Listing - Gardening Help');
    });

    it('should omit Authorization for Laravel public listing collection and detail reads', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [], meta: { cursor: null, has_more: false } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42, title: 'Public listing' } })
        });

      await api.getListings('', { per_page: 20 });
      await api.getListing('', 42);

      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
    });

    it('should use the exact Laravel v2 listing mutation methods, paths, and JSON payload', async () => {
      const payload = {
        title: 'Garden tool sharing',
        description: 'Share useful garden tools with neighbours nearby.',
        type: 'offer',
        category_id: 3,
        hours_estimate: 2.5,
        service_type: 'physical_only',
        location: 'Town shed'
      };
      for (const response of [
        { data: { id: 42 } },
        { data: { id: 42 } },
        ''
      ]) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => (typeof response === 'string' ? 'text/plain' : 'application/json') },
          json: () => Promise.resolve(response),
          text: () => Promise.resolve(response)
        });
      }

      await api.createListing('test-token', payload);
      await api.updateListing('test-token', 42, payload);
      await api.deleteListing('test-token', 42);

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/listings',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify(payload)
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/listings/42',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify(payload)
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(3,
        'http://localhost:5000/api/v2/listings/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should load listing categories and persist tags and image through their separate v2 boundaries', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [{ id: 3, name: 'Gardening' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { listing_id: 42, tags: ['gardening'] } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { image_url: '/uploads/listings/cover.webp' } })
        });

      await api.getListingCategories('test-token');
      await api.setListingSkillTags('test-token', 42, ['gardening']);
      await api.uploadListingImage('test-token', 42, {
        file: {
          buffer: Buffer.from('fake listing image', 'utf8'),
          filename: 'cover.webp',
          contentType: 'image/webp'
        }
      });

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/categories?type=listing',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/listings/42/tags',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ tags: ['gardening'] })
        })
      );
      const uploadOptions = mockFetch.mock.calls[2][1];
      expect(mockFetch.mock.calls[2][0]).toBe('http://localhost:5000/api/v2/listings/42/image');
      expect(uploadOptions.method).toBe('POST');
      expect(uploadOptions.headers.Authorization).toBe('Bearer test-token');
      expect(uploadOptions.headers).not.toHaveProperty('Content-Type');
      expect(uploadOptions.body).toBeInstanceOf(globalThis.FormData);
      expect(uploadOptions.body.get('image')).toBeTruthy();
    });
  });

  describe('getFeedPosts', () => {
    it('should call the Laravel v2 feed endpoint with filters and auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 11, type: 'listing', title: 'Community update' }
          ],
          meta: { has_more: false }
        })
      });

      const result = await api.getFeedPosts('test-token', {
        per_page: 5,
        type: 'listings',
        mode: 'ranked',
        subtype: 'offer',
        cursor: 'abc',
        group_id: 7,
        user_id: 77,
        personalised: true,
        tz: 'Europe/Dublin'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/feed?per_page=5&type=listings&mode=ranked&subtype=offer&cursor=abc&group_id=7&user_id=77&personalised=true&tz=Europe%2FDublin',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].title).toBe('Community update');
    });

    it('does not expose the removed nonexistent legacy feed helpers', () => {
      expect(api).not.toHaveProperty('getFeedPost');
      expect(api).not.toHaveProperty('createFeedPost');
      expect(api).not.toHaveProperty('updateFeedPost');
      expect(api).not.toHaveProperty('deleteFeedPost');
      expect(api).not.toHaveProperty('likeFeedPost');
      expect(api).not.toHaveProperty('unlikeFeedPost');
      expect(api).not.toHaveProperty('getFeedComments');
      expect(api).not.toHaveProperty('addFeedComment');
      expect(api).not.toHaveProperty('deleteFeedComment');
    });

    it('uses the valid v2 post and polymorphic item permalink endpoints with optional auth', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42, type: 'post' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 77, type: 'listing' } })
        });

      await api.getFeedPostV2('', 42);
      await api.getFeedItemV2('test-token', 'listing', 77);

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/feed/posts/42',
        expect.objectContaining({
          headers: expect.not.objectContaining({ Authorization: expect.anything() })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/feed/items/listing/77',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });
  });

  describe('getMembers', () => {
    it('should call the canonical Laravel v2 users endpoint with its exact directory query', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [{ id: 77, name: 'Ada' }],
          meta: { total_items: 41, per_page: 20, offset: 20, has_more: true }
        })
      });

      const result = await api.getUsers('test-token', {
        q: 'repair',
        sort: 'joined',
        order: 'DESC',
        limit: 20,
        offset: 20
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users?q=repair&sort=joined&order=DESC&limit=20&offset=20',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(result).toEqual(expect.objectContaining({
        data: [{ id: 77, name: 'Ada' }],
        meta: expect.objectContaining({ total_items: 41, offset: 20, has_more: true })
      }));
    });

    it('should call the canonical Laravel v2 user detail endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 77, name: 'Ada' } })
      });

      const result = await api.getUser('test-token', 77);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/77',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(result.data.name).toBe('Ada');
    });

    it('should call the Laravel v2 users endpoint with directory filters and auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 26554, name: 'E2E User A' }
          ],
          meta: { total_items: 1, has_more: false }
        })
      });

      const result = await api.getMembers('test-token', {
        q: 'e2e',
        sort: 'joined',
        order: 'DESC',
        limit: 20,
        offset: 20
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users?q=e2e&sort=joined&order=DESC&limit=20&offset=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].name).toBe('E2E User A');
    });
  });

  describe('connections', () => {
    it('should call the Laravel v2 connection request endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: { id: 77, status: 'pending' }
        })
      });

      const result = await api.sendConnectionRequest('test-token', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/request',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ user_id: 2 })
        })
      );
      expect(result.data.status).toBe('pending');
    });

    it('should call Laravel v2 connection action endpoints with POST', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { status: 'accepted' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { status: 'declined' } })
        });

      await api.acceptConnection('test-token', 77);
      await api.declineConnection('test-token', 77);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/connections/77/accept',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/connections/77/decline',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should call the Laravel v2 connection status endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: { status: 'pending_sent', connection_id: 73, direction: 'sent' }
        })
      });

      const result = await api.getConnectionStatus('test-token', 2);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/status/2',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.status).toBe('pending_sent');
    });
  });

  describe('reviews', () => {
    it('does not expose the unsupported Laravel review update contract', () => {
      expect(api.updateReview).toBeUndefined();
    });

    it('should call the Laravel v2 user reviews endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 91, rating: 5, comment: 'Helpful exchange' }
          ],
          meta: { per_page: 20, has_more: false }
        })
      });

      const result = await api.getUserReviews('test-token', 267, 1, 20);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/reviews/user/267?per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].comment).toBe('Helpful exchange');
    });

    it('should create member reviews through the Laravel v2 reviews endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: { id: 91, receiver_id: 267, rating: 4 }
        })
      });

      const result = await api.createUserReview('test-token', 267, {
        rating: 4,
        comment: 'Helpful exchange'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/reviews',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            receiver_id: 267,
            rating: 4,
            comment: 'Helpful exchange'
          })
        })
      );
      expect(result.data.receiver_id).toBe(267);
    });

    it('should call the Laravel v2 review detail and delete endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { id: 91, rating: 5 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '' },
          text: () => Promise.resolve('')
        });

      await api.getReview('test-token', 91);
      await api.deleteReview('test-token', 91);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/reviews/91',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/reviews/91',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('events', () => {
    it('should call the Laravel v2 event collection with cursor filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [], meta: { cursor: null, has_more: false } })
      });

      await api.getEvents('test-token', {
        per_page: 12,
        cursor: 'next-page',
        group_id: 9,
        category_id: 4,
        near_lat: 51.85,
        near_lng: -9.3,
        radius_km: 10,
        when: 'past',
        step_free: 'unknown',
        q: 'repair'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events?per_page=12&cursor=next-page&group_id=9&category_id=4&near_lat=51.85&near_lng=-9.3&radius_km=10&step_free=unknown&when=past&q=repair',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should omit Authorization for Laravel public event collection, detail, and attendee reads', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [], meta: { cursor: null, has_more: false } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 6, title: 'Public event' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [], meta: { cursor: null, has_more: false } })
        });

      await api.getEvents('', { per_page: 20 });
      await api.getEvent('', 6);
      await api.getEventRsvps('', 6);

      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch.mock.calls[1][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch.mock.calls[2][1].headers).not.toHaveProperty('Authorization');
    });

    it('should load dashboard events from the real Laravel v2 upcoming collection', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [], meta: { cursor: null, has_more: false } })
      });

      await api.getMyEvents('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events?per_page=3&when=upcoming',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should call the Laravel v2 event detail endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            id: 6,
            title: 'Community Meetup 3',
            description: 'Third monthly gathering'
          }
        })
      });

      const result = await api.getEvent('test-token', 6);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/6',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.title).toBe('Community Meetup 3');
    });

    it('should call the Laravel v2 event attendee endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 26554, first_name: 'E2E', last_name: 'UserA', status: 'going' }
          ],
          meta: { per_page: 20, has_more: false }
        })
      });

      const result = await api.getEventRsvps('test-token', 6, 'going');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/6/attendees?status=going&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].status).toBe('going');
    });

    it('should forward Blade attendee cursor and page-size options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: [], meta: { cursor: null, has_more: false } })
      });

      await api.getEventRsvps('test-token', 6, { status: 'all', perPage: 50, cursor: 'next+page/2=' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/6/attendees?status=all&per_page=50&cursor=next%2Bpage%2F2%3D',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should submit Laravel v2 RSVP statuses and request the complete attendee roster', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { status: 'interested', rsvp_counts: { going: 1, interested: 2 } } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: [], meta: { per_page: 20, has_more: false } })
        });

      await api.rsvpToEvent('test-token', 6, 'interested');
      await api.getEventRsvps('test-token', 6);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/events/6/rsvp',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ status: 'interested' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/events/6/attendees?status=all&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });
  });

  describe('exchanges', () => {
    it('should call the authoritative Laravel exchange config and listing check endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({
            data: { exchange_workflow_enabled: true, direct_messaging_enabled: true }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({
            data: { id: 42, status: 'pending_provider', role: 'requester' }
          })
        });

      await api.getExchangeConfig('test-token');
      await api.checkExchangeForListing('test-token', 90992);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/exchanges/config',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/exchanges/check?listing_id=90992',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should call the Laravel v2 exchanges list endpoint with filters and auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 42, status: 'pending_provider' }
          ],
          meta: { has_more: false }
        })
      });

      const result = await api.getExchanges('test-token', {
        status: 'active',
        per_page: 20,
        cursor: 'abc'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges?per_page=20&status=active&cursor=abc',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].id).toBe(42);
    });

    it('should create exchange requests through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: { id: 42, listing_id: 90992, status: 'pending_provider' }
        })
      });

      const result = await api.createExchangeRequest('test-token', 90992, {
        proposed_hours: 2,
        prep_time: 0.5,
        message: 'I can help with this.'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            listing_id: 90992,
            proposed_hours: 2,
            prep_time: 0.5,
            message: 'I can help with this.'
          })
        })
      );
      expect(result.data.id).toBe(42);
    });

    it('should call exchange lifecycle and rating endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { id: 42, status: 'accepted' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { id: 42, status: 'completed' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: [{ rating: 5 }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { message: 'Exchange cancelled' } })
        });

      await api.acceptExchange('test-token', 42);
      await api.confirmExchange('test-token', 42, { hours: 2 });
      await api.rateExchange('test-token', 42, { rating: 5, comment: 'Great help' });
      await api.cancelExchange('test-token', 42, { reason: 'No longer needed' });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/exchanges/42/accept',
        expect.objectContaining({ method: 'POST' })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/exchanges/42/confirm',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ hours: 2 })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/exchanges/42/rate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 5, comment: 'Great help' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        'http://localhost:5000/api/v2/exchanges/42',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({ reason: 'No longer needed' })
        })
      );
    });
  });

  describe('AI chat', () => {
    it('should call the Laravel AI chat starter endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            starters: ['How do I find a gardener?']
          }
        })
      });

      const result = await api.getAiChatStarters('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/ai/chat/starters',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.starters[0]).toBe('How do I find a gardener?');
    });

    it('should send chat messages to the Laravel AI chat endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            success: true,
            conversation_id: 12,
            message: {
              id: 33,
              role: 'assistant',
              content: 'You can search the listings directory.'
            }
          }
        })
      });

      const result = await api.sendAiChatMessage('test-token', {
        conversation_id: 12,
        message: 'How do I find help?'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/ai/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            conversation_id: 12,
            message: 'How do I find help?'
          })
        })
      );
      expect(result.data.conversation_id).toBe(12);
    });

    it('should call conversation and limits endpoints used by the accessible chat page', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: [{ id: 12, title: 'Gardening help' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { id: 12, messages: [] } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { limits: { allowed: true } } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: () => Promise.resolve({ data: { providers: ['gemini'], default: 'gemini', enabled: true } })
        });

      await api.getAiConversations('test-token', { limit: 20 });
      await api.getAiConversation('test-token', 12);
      await api.getAiLimits('test-token');
      await api.getAiProviders('test-token');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/ai/conversations?limit=20',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/ai/conversations/12',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/ai/limits',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        4,
        'http://localhost:5000/api/ai/providers',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
    });
  });

  describe('getListing', () => {
    it('should call the Laravel v2 listing detail endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 90992 } })
      });

      await api.getListing('test-token', 90992);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings/90992',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('getVolunteerOrganisations', () => {
    it('should call the Laravel volunteering organisations endpoint with search and per_page params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 7, name: 'Community Club', description: 'A local volunteer organisation.' }
          ],
          meta: { per_page: 30, has_more: false }
        })
      });

      const result = await api.getVolunteerOrganisations({ search: 'club', per_page: 30 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/organisations?search=club&per_page=30',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data[0].name).toBe('Community Club');
    });
  });

  describe('getVolunteeringOpportunities', () => {
    it('should call the Laravel volunteering opportunities endpoint with search, category, remote and per_page params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 77, title: 'Community Kitchen Helper', is_remote: true }
          ],
          meta: { per_page: 20, has_more: false }
        })
      });

      const result = await api.getVolunteeringOpportunities({
        search: 'kitchen',
        category_id: 3,
        is_remote: true,
        per_page: 20
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/opportunities?search=kitchen&category_id=3&is_remote=true&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data[0].title).toBe('Community Kitchen Helper');
    });
  });

  describe('getVolunteerOrganisation', () => {
    it('should call the Laravel volunteering organisation detail endpoint with bearer auth when supplied', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            id: 42,
            name: 'Community Club',
            public_contract: {
              id: 42,
              name: 'Community Club',
              stats: { opportunity_count: 2, volunteer_count: 5 }
            }
          }
        })
      });

      const result = await api.getVolunteerOrganisation(42, 'test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/organisations/42?include=public_contract',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.public_contract.name).toBe('Community Club');
    });
  });

  describe('getMyVolunteerOrganisations', () => {
    it('should call the Laravel my organisations endpoint with auth and per_page params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          items: [
            { id: 7, name: 'Community Club', status: 'approved', member_role: 'owner' }
          ],
          meta: { per_page: 50 }
        })
      });

      const result = await api.getMyVolunteerOrganisations('test-token', { per_page: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/my-organisations?per_page=50',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.items[0].name).toBe('Community Club');
    });
  });

  describe('getOrganisationJobs', () => {
    it('should call the Laravel jobs endpoint for open jobs at an organisation with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          items: [
            { id: 501, title: 'Volunteer Coordinator', type: 'volunteer' }
          ],
          meta: { limit: 20 }
        })
      });

      const result = await api.getOrganisationJobs(42, 'test-token', { limit: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/jobs?organization_id=42&status=open&limit=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.items[0].title).toBe('Volunteer Coordinator');
    });
  });

  describe('getJobs', () => {
    it('should call the Laravel jobs endpoint with browse filters and auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          items: [
            { id: 501, title: 'Volunteer Coordinator', type: 'volunteer' }
          ],
          meta: { total: 1, has_more: false, offset: 12, per_page: 12 }
        })
      });

      const result = await api.getJobs('test-token', {
        limit: 12,
        offset: 12,
        status: 'open',
        sort: 'deadline',
        search: 'coordinator',
        type: 'paid',
        commitment: 'part_time',
        is_remote: 1
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/jobs?limit=12&offset=12&status=open&sort=deadline&search=coordinator&type=paid&commitment=part_time&is_remote=1',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.items[0].title).toBe('Volunteer Coordinator');
    });
  });

  describe('getJob', () => {
    it('should call the Laravel job detail endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: { id: 501, title: 'Volunteer Coordinator', type: 'volunteer' }
        })
      });

      const result = await api.getJob('test-token', 501);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/jobs/501',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.title).toBe('Volunteer Coordinator');
    });
  });

  describe('callJobApi', () => {
    it('should call Laravel v2 job action endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { message: 'updated' } })
      });

      await api.callJobApi('test-token', 'PUT', '/applications/91', {
        status: 'shortlisted',
        notes: 'Strong fit'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/jobs/applications/91',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ status: 'shortlisted', notes: 'Strong fit' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({})
      });

      await api.callJobApi('test-token', 'DELETE', '/alerts/12');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/jobs/alerts/12',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should preserve interview and offer decision paths, notes, and conflict errors', async () => {
      const cases = [
        ['/interviews/31/accept', { notes: 'I can attend.' }, 'accepted'],
        ['/interviews/32/decline', { notes: 'I am unavailable.' }, 'declined'],
        ['/offers/41/accept', { notes: 'Thank you.' }, 'accepted'],
        ['/offers/42/reject', { notes: 'I have accepted another role.' }, 'rejected']
      ];

      for (const [pathValue, body, status] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { status } })
        });

        await expect(api.callJobApi('test-token', 'PUT', pathValue, body))
          .resolves.toEqual({ data: { status } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/jobs${pathValue}`,
          expect.objectContaining({
            method: 'PUT',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            body: JSON.stringify(body)
          })
        );
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'This response is no longer pending.', code: 'RESPONSE_NOT_PENDING' })
      });

      await expect(api.callJobApi('test-token', 'PUT', '/offers/41/accept', { notes: '' }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 409,
          message: 'This response is no longer pending.',
          data: { message: 'This response is no longer pending.', code: 'RESPONSE_NOT_PENDING' }
        });
    });

    it('should upload job application CVs to Laravel with multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { id: 91 } })
      });

      await api.uploadJobApplication('test-token', 501, {
        message: 'I can help with delivery.',
        file: {
          buffer: Buffer.from('%PDF-1.4 test cv', 'utf8'),
          filename: 'alex-cv.pdf',
          contentType: 'application/pdf',
          size: 16
        }
      });

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5000/api/v2/jobs/501/apply');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe('Bearer test-token');
      expect(options.body).toBeInstanceOf(FormData);
    });
  });

  describe('getVolunteerOpportunity', () => {
    it('should call the Laravel volunteering opportunity detail endpoint with auth when present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            id: 77,
            title: 'Community Kitchen Helper',
            organization_id: 42,
            org_name: 'Community Club',
            has_applied: false
          }
        })
      });

      const result = await api.getVolunteerOpportunity(77, 'test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/opportunities/77',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data.title).toBe('Community Kitchen Helper');
    });
  });

  describe('getOrganisationOpportunities', () => {
    it('should call the Laravel volunteering opportunities endpoint for an organisation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: [
            { id: 77, title: 'Community Kitchen Helper', is_remote: true }
          ],
          meta: { per_page: 10 }
        })
      });

      const result = await api.getOrganisationOpportunities(42, { per_page: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/opportunities?organization_id=42&per_page=10',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data[0].title).toBe('Community Kitchen Helper');
    });
  });

  describe('getOrganisationReviews', () => {
    it('should call the Laravel volunteering organisation reviews endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          data: {
            reviews: [
              { id: 12, rating: 5, comment: 'Helpful and welcoming.' }
            ]
          }
        })
      });

      const result = await api.getOrganisationReviews(42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/reviews/organization/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json'
          })
        })
      );
      expect(result.data.reviews[0].rating).toBe(5);
    });
  });

  describe('network errors', () => {
    it('should throw ApiOfflineError on connection refused', async () => {
      const error = new Error('fetch failed');
      error.code = 'ECONNREFUSED';
      mockFetch.mockRejectedValueOnce(error);

      await expect(api.login('test@example.com', 'pass', 'acme'))
        .rejects.toThrow(api.ApiOfflineError);
    });
  });

  describe('submitContact', () => {
    it('should call the Laravel v2 contact endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'received' } })
      });

      await api.submitContact({
        name: 'Ada Lovelace',
        email: 'ada@example.org',
        subject: 'technical',
        message: 'The page did not load.',
        turnstile_token: ''
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/contact',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Ada Lovelace',
            email: 'ada@example.org',
            subject: 'technical',
            message: 'The page did not load.',
            turnstile_token: ''
          })
        })
      );
    });
  });

  describe('submitSupportReport', () => {
    it('should call the Laravel v2 support report endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { report: { reference: 'NXR-260706-ABC123' } } })
      });

      await api.submitSupportReport('test-token', {
        summary: 'Broken page',
        description: 'The accessible page failed to render.',
        impact: 'major',
        page_url: '/explore',
        route: '/report-a-problem'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/support/reports',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            summary: 'Broken page',
            description: 'The accessible page failed to render.',
            impact: 'major',
            page_url: '/explore',
            route: '/report-a-problem'
          })
        })
      );
    });
  });

  describe('resetPassword', () => {
    it('should call the Laravel reset-password endpoint with confirmation', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'reset' } })
      });

      await api.resetPassword('reset-token', 'correct horse battery staple', 'correct horse battery staple');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/reset-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            token: 'reset-token',
            password: 'correct horse battery staple',
            password_confirmation: 'correct horse battery staple'
          })
        })
      );
    });
  });

  describe('resendVerification', () => {
    it('should call the Laravel resend-verification-by-email endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'sent' } })
      });

      await api.resendVerification('ada@example.org');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/auth/resend-verification-by-email',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'ada@example.org' })
        })
      );
    });
  });

  describe('createVolunteerOrganisation', () => {
    it('should call the Laravel volunteering organisation creation endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.createVolunteerOrganisation('test-token', {
        name: 'Community Helpers',
        description: 'We coordinate local volunteering projects.',
        contact_email: 'hello@example.org',
        website: 'https://example.org'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/organisations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            name: 'Community Helpers',
            description: 'We coordinate local volunteering projects.',
            contact_email: 'hello@example.org',
            website: 'https://example.org'
          })
        })
      );
    });
  });

  describe('callVolunteeringApi', () => {
    it('should call Laravel v2 volunteering action endpoints with auth, method, and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callVolunteeringApi('test-token', 'PUT', '/organisations/42/wallet/auto-pay', {
        enabled: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/organisations/42/wallet/auto-pay',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ enabled: true })
        })
      );
    });

    it('should preserve volunteering accessibility, finance, safety, training, and organisation paths', async () => {
      const cases = [
        ['PUT', '/accessibility-needs', {
          needs: [{
            need_type: 'mobility',
            description: 'Step-free access required',
            accommodations_required: 'Accessible entrance',
            emergency_contact_name: 'Sam Member',
            emergency_contact_phone: '+353 1 555 0100'
          }]
        }],
        ['POST', '/donations', {
          amount: 25,
          payment_method: 'bank_transfer',
          message: 'Community garden',
          is_anonymous: false,
          giving_day_id: 7
        }],
        ['POST', '/expenses', {
          organization_id: 42,
          expense_type: 'supplies',
          amount: 18.5,
          description: 'Repair materials',
          currency: 'EUR'
        }],
        ['POST', '/incidents', {
          title: 'Minor equipment issue',
          description: 'A damaged tool was removed from service immediately.',
          severity: 'low',
          category: 'equipment',
          incident_type: 'other'
        }],
        ['PUT', '/organisations/42', {
          name: 'Community Helpers',
          description: 'Local volunteering projects',
          contact_email: 'hello@example.test',
          website: 'https://example.test'
        }],
        ['POST', '/organisations/42/wallet/deposit', { amount: 10, note: 'Opening balance' }],
        ['POST', '/training', {
          training_type: 'first_aid',
          training_name: 'Emergency first aid',
          provider: 'Training Co',
          completed_at: '2026-07-01',
          expires_at: '2027-07-01'
        }]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callVolunteeringApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/volunteering${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            body: JSON.stringify(body)
          })
        );
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Vetting is required.', code: 'VETTING_REQUIRED' })
      });

      await expect(api.callVolunteeringApi('test-token', 'POST', '/training', {
        training_type: 'first_aid', training_name: 'Emergency first aid', completed_at: '2026-07-01'
      })).rejects.toMatchObject({
        name: 'ApiError',
        status: 403,
        message: 'Vetting is required.',
        data: { message: 'Vetting is required.', code: 'VETTING_REQUIRED' }
      });
    });

    it('should upload volunteer credentials to Laravel with multipart file data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.uploadVolunteerCredential('test-token', {
        credential_type: 'garda_vetting',
        expires_at: '2026-12-31',
        file: {
          buffer: Buffer.from('%PDF volunteer credential', 'utf8'),
          filename: 'garda-vetting.pdf',
          contentType: 'application/pdf'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/credentials',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('should download a volunteer credential from Laravel as binary data', async () => {
      const body = Buffer.from('%PDF credential download', 'utf8');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => ({
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="first-aid.pdf"',
            'content-length': String(body.length)
          }[name.toLowerCase()] || '')
        },
        arrayBuffer: async () => body
      });

      const result = await api.downloadVolunteerCredential('test-token', 44);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/volunteering/credentials/44/download',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(result.status).toBe(200);
      expect(result.headers['content-disposition']).toBe('attachment; filename="first-aid.pdf"');
      expect(result.body.equals(body)).toBe(true);
    });

    it('should upload insurance certificates to Laravel with multipart file data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.uploadInsuranceCertificate('test-token', {
        insurance_type: 'public_liability',
        provider_name: 'Example Mutual',
        policy_number: 'PL-123',
        expiry_date: '2027-06-30',
        file: {
          buffer: Buffer.from('%PDF insurance certificate', 'utf8'),
          filename: 'insurance.pdf',
          contentType: 'application/pdf'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me/insurance',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });
  });

  describe('callMarketplaceApi', () => {
    it('should call Laravel v2 marketplace action endpoints with auth, method, and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callMarketplaceApi('test-token', 'PUT', '/listings/42', {
        title: 'Community bike'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/marketplace/listings/42',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ title: 'Community bike' })
        })
      );
    });

    it('should preserve listing, offer, and order mutation paths and payload boundaries', async () => {
      const cases = [
        ['POST', '/listings/42/offers', { amount: 25, message: 'Can collect Friday' }],
        ['POST', '/listings/42/renew', { duration_days: 30 }],
        ['POST', '/listings/42/report', { reason: 'unsafe', description: 'Unsafe electrical wiring' }],
        ['POST', '/listings/42/save', undefined],
        ['DELETE', '/listings/42/save', undefined],
        ['PUT', '/offers/91/accept', undefined],
        ['PUT', '/offers/92/decline', undefined],
        ['DELETE', '/offers/93', undefined],
        ['PUT', '/orders/101/cancel', { reason: 'Item no longer available' }],
        ['PUT', '/orders/102/confirm-delivery', undefined],
        ['POST', '/orders/103/rate', { rating: 5, comment: 'Excellent', is_anonymous: false }],
        ['PUT', '/orders/104/ship', {
          tracking_number: 'TRACK-104',
          tracking_url: 'https://carrier.example.test/TRACK-104',
          shipping_method: 'tracked'
        }]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callMarketplaceApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/marketplace${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => 'application/json' },
        json: async () => ({
          message: 'The offer amount is invalid.',
          errors: { amount: ['The amount must be greater than zero.'] },
          code: 'VALIDATION_FAILED'
        })
      });
      await expect(api.callMarketplaceApi('test-token', 'POST', '/listings/42/offers', { amount: 0 }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 422,
          message: 'The offer amount is invalid.',
          data: {
            errors: { amount: ['The amount must be greater than zero.'] },
            code: 'VALIDATION_FAILED'
          }
        });
    });

    it('should preserve seller coupon, pickup-slot, and pickup-scan mutation paths', async () => {
      const coupon = {
        code: 'COMMUNITY10',
        discount_type: 'percent',
        discount_value: 10,
        status: 'active'
      };
      const slot = {
        starts_at: '2026-07-16T10:00:00Z',
        ends_at: '2026-07-16T12:00:00Z',
        capacity: 4,
        is_active: true
      };
      const cases = [
        ['POST', '/seller/coupons', coupon],
        ['PUT', '/seller/coupons/8', { ...coupon, status: 'paused' }],
        ['DELETE', '/seller/coupons/8', undefined],
        ['POST', '/seller/pickup-scan', { qr_code: 'PICKUP-ABC123' }],
        ['POST', '/seller/pickup-slots', slot],
        ['PUT', '/seller/pickup-slots/17', { ...slot, is_active: false }],
        ['DELETE', '/seller/pickup-slots/17', undefined]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callMarketplaceApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/marketplace${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }
    });

    it('should upload marketplace listing images through Laravel multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [{ id: 9 }] })
      });

      await api.uploadMarketplaceListingImages('test-token', 42, {
        file: {
          buffer: Buffer.from('fake marketplace image', 'utf8'),
          filename: 'lamp.webp',
          contentType: 'image/webp'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/marketplace/listings/42/images',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });
  });

  describe('callIdeationApi', () => {
    it('should call Laravel v2 ideation action endpoints with auth, method, and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callIdeationApi('test-token', 'PUT', '/ideation-challenges/7/status', {
        status: 'voting'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/ideation-challenges/7/status',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ status: 'voting' })
        })
      );
    });
  });

  describe('callGroupExchangeApi', () => {
    it('should call Laravel v2 group exchange action endpoints with auth, method, and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callGroupExchangeApi('test-token', 'POST', '/7/participants', {
        user_id: 55,
        role: 'provider'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/group-exchanges/7/participants',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ user_id: 55, role: 'provider' })
        })
      );
    });
  });

  describe('callEventApi', () => {
    it('should fetch event details through the Laravel v2 event endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42, title: 'Community meetup' } })
      });

      await api.getEvent('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should call Laravel v2 event action endpoints with auth, method, and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callEventApi('test-token', 'PUT', '/7/recurring', {
        scope: 'all'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/7/recurring',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ scope: 'all' })
        })
      );
    });

    it('should call Laravel event broadcast endpoints outside the event resource prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { changed: true } })
      });

      await api.callEventBroadcastApi('test-token', 'POST', '/8/schedule', {
        expected_version: 3,
        scheduled_at: '2026-08-01T10:00'
      }, { headers: { 'Idempotency-Key': 'comm-schedule-123' } });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/event-broadcasts/8/schedule',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Idempotency-Key': 'comm-schedule-123'
          }),
          body: JSON.stringify({ expected_version: 3, scheduled_at: '2026-08-01T10:00' })
        })
      );
    });

    it('should export Event Registration submissions through Laravel POST binary contract', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/csv; charset=UTF-8']]),
        arrayBuffer: async () => Buffer.from('Question,Answer').buffer
      });

      await api.downloadEventRegistrationSubmissions('test-token', 42, {
        purpose: 'Governance export',
        correlation_id: 'audit-123',
        include_sensitive: false
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/42/registration-product/submissions/export',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ purpose: 'Governance export', correlation_id: 'audit-123', include_sensitive: false })
        })
      );
    });

    it('should call Laravel admin event endpoints with the exact query and decision payload', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [], meta: { total: 0 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42, publication_state: 'draft' } })
        });

      await api.callAdminEventApi(
        'test-token',
        'GET',
        '?publication_state=pending_review&page=2&per_page=20'
      );
      await api.callAdminEventApi('test-token', 'POST', '/42/reject', {
        reason: 'The venue information needs more detail.'
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/admin/events?publication_state=pending_review&page=2&per_page=20',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/admin/events/42/reject',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ reason: 'The venue information needs more detail.' })
        })
      );
    });

    it('should call Laravel Event Template reads and mutations with exact paths, auth, and payloads', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 7, name: 'Weekly meetup' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { created: 3 } })
        });

      await api.callEventTemplateApi('test-token', 'GET', '/7/history?cursor=next');
      await api.callEventTemplateApi('test-token', 'POST', '/7/materializations', {
        from: '2026-08-01',
        to: '2026-08-31'
      }, { headers: { 'Idempotency-Key': 'template-run-7' } });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/event-templates/7/history?cursor=next',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/event-templates/7/materializations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Idempotency-Key': 'template-run-7'
          }),
          body: JSON.stringify({ from: '2026-08-01', to: '2026-08-31' })
        })
      );
    });

    it('should use the exact Laravel v2 event mutation contracts', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { cancelled: true, event_id: 42, reason: 'Weather' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({})
        });

      const payload = {
        title: 'Community gathering',
        description: 'An event for the whole community.',
        start_time: '2026-08-01T10:00',
        end_time: '2026-08-01T12:00'
      };

      await api.createEvent('test-token', payload);
      await api.updateEvent('test-token', 42, payload);
      await api.cancelEvent('test-token', 42, {
        reason: 'Weather',
        idempotency_key: 'cancel-event-42'
      });
      await api.deleteEvent('test-token', 42, {
        reason: 'Event completed',
        idempotency_key: 'archive-event-42'
      });

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/events',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify(payload)
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/events/42',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify(payload)
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(3,
        'http://localhost:5000/api/v2/events/42/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Idempotency-Key': 'cancel-event-42'
          }),
          body: JSON.stringify({
            reason: 'Weather',
            idempotency_key: 'cancel-event-42'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(4,
        'http://localhost:5000/api/v2/events/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
            'Idempotency-Key': 'archive-event-42'
          }),
          body: JSON.stringify({
            reason: 'Event completed',
            idempotency_key: 'archive-event-42'
          })
        })
      );
    });

    it('should fetch Laravel event categories through the shared category endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [{ id: 7, name: 'Gardening' }] })
      });

      const result = await api.getEventCategories('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/categories?type=event',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result.data[0].name).toBe('Gardening');
    });

    it('should merge current and legacy Laravel volunteering category types', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [{ id: 7, name: 'Community' }, { id: 8, name: 'Food' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { items: [{ id: 8, name: 'Food legacy' }, { id: 9, name: 'Driving' }] } })
        });

      const result = await api.getVolunteeringCategories('test-token');

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/categories?type=volunteering',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/categories?type=volunteer',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(result.data.map(({ id, name }) => ({ id, name }))).toEqual([
        { id: 7, name: 'Community' },
        { id: 8, name: 'Food' },
        { id: 9, name: 'Driving' }
      ]);
    });

    it('should upload event cover images through Laravel multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { cover_image: '/uploads/events/garden.webp' } })
      });

      await api.uploadEventImage('test-token', 42, {
        file: {
          buffer: Buffer.from('fake event image', 'utf8'),
          filename: 'garden.webp',
          contentType: 'image/webp'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/events/42/image',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });
  });

  describe('getGoals', () => {
    it('should call the Laravel v2 goals endpoint with auth and cursor-style params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [{ id: 42, title: 'Walk daily' }] })
      });

      await api.getGoals('test-token', {
        status: 'active',
        visibility: 'public',
        limit: 30,
        cursor: 'next-cursor'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/goals?status=active&visibility=public&per_page=30&cursor=next-cursor',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('getGoal', () => {
    it('should call the Laravel v2 goal detail endpoint with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42, title: 'Walk daily' } })
      });

      await api.getGoal('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/goals/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('callGoalApi', () => {
    it('should call Laravel v2 goal action endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { current_value: 4 } })
      });

      await api.callGoalApi('test-token', 'POST', '/42/progress', {
        increment: 2
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/goals/42/progress',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ increment: 2 })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({})
      });

      await api.callGoalApi('test-token', 'DELETE', '/42');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/goals/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should preserve the Laravel goal buddy nudge path and action payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { sent: true } })
      });

      await expect(api.callGoalApi('test-token', 'POST', '/42/buddy/nudge', {
        type: 'encouragement',
        message: 'You are making great progress'
      })).resolves.toEqual({ data: { sent: true } });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/goals/42/buddy/nudge',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            type: 'encouragement',
            message: 'You are making great progress'
          })
        })
      );
    });
  });

  describe('callCourseApi', () => {
    it('should call Laravel v2 course action endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { course_completed: false } })
      });

      await api.callCourseApi('test-token', 'POST', '/42/lessons/7/complete', {
        watch_percent: 100
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/courses/42/lessons/7/complete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ watch_percent: 100 })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.callCourseApi('test-token', 'DELETE', '/42');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/courses/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.callCourseApi('test-token', 'GET', '?per_page=30&q=care');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/courses?per_page=30&q=care',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should preserve the Laravel course authoring, learner, review, and grading dispatch paths', async () => {
      const cases = [
        ['POST', '/42/enroll', { confirmation: true }],
        ['POST', '/42/lessons', { title: 'Introduction', section_id: 3 }],
        ['PUT', '/42/lessons/7', { title: 'Updated introduction' }],
        ['DELETE', '/42/lessons/7', undefined],
        ['POST', '/42/publish', { confirmation: 'publish' }],
        ['POST', '/42/reviews', { rating: 5, comment: 'Clear and useful' }],
        ['POST', '/42/sections', { title: 'Getting started' }],
        ['PUT', '/42/sections/3', { title: 'Start here' }],
        ['DELETE', '/42/sections/3', undefined],
        ['POST', '/42/unpublish', { reason: 'Needs revision' }],
        ['POST', '/attempts/19/grade', { score: 8, feedback: 'Good work' }],
        ['POST', '/quizzes/11/attempt', { answers: { 2: ['a'] } }]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callCourseApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });

        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/courses${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'The course state changed.', code: 'COURSE_VERSION_CONFLICT' })
      });

      await expect(api.callCourseApi('test-token', 'POST', '/42/publish', { confirmation: 'publish' }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 409,
          message: 'The course state changed.',
          data: { message: 'The course state changed.', code: 'COURSE_VERSION_CONFLICT' }
        });
    });

    it('should call Laravel v2 member course enrolments with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getMyCourses('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/courses',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('callGroupApi', () => {
    it('should use Laravel v2 group collection contracts without falling back to the unfiltered legacy route', async () => {
      const collection = {
        data: [{ id: 42, name: 'Repair circle' }],
        meta: { cursor: 'next-groups', per_page: 20, has_more: true }
      };
      const memberships = {
        data: [{ id: 42, name: 'Repair circle' }],
        meta: { cursor: null, per_page: 100, has_more: false }
      };
      const members = {
        data: [{ id: 101, name: 'Ada Member', role: 'owner' }],
        meta: { cursor: null, per_page: 50, has_more: false }
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => collection
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => memberships
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => members
        });

      const groupsResult = await api.getGroups('test-token', {
        per_page: 20,
        cursor: 'previous-cursor',
        q: 'repair',
        visibility: 'private'
      });
      const membershipsResult = await api.getMyGroups('test-token');
      const membersResult = await api.getGroupMembers('test-token', 42, {
        per_page: 50,
        cursor: 'member-cursor',
        role: 'admin'
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/groups?per_page=20&cursor=previous-cursor&q=repair&visibility=private',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/groups?member=me&per_page=100',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/groups/42/members?per_page=50&cursor=member-cursor&role=admin',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(groupsResult).toEqual(collection);
      expect(membershipsResult).toEqual(memberships);
      expect(membersResult).toEqual(members);
      expect(mockFetch.mock.calls.map(([url]) => url).some((url) => /\/api\/groups(?:\?|$)/.test(url))).toBe(false);
    });

    it('should update and remove group members only through Laravel v2 membership endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { user_id: 101, role: 'admin' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => '' },
          text: async () => ''
        });

      await api.updateGroupMemberRole('test-token', 42, 101, 'admin');
      await api.removeGroupMember('test-token', 42, 101);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/groups/42/members/101',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ role: 'admin' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/groups/42/members/101',
        expect.objectContaining({ method: 'DELETE' })
      );
      expect(api.addGroupMember).toBeUndefined();
      expect(api.transferGroupOwnership).toBeUndefined();
    });

    it('should fetch group details through the Laravel v2 group endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 484, name: 'Dunmanway' } })
      });

      await api.getGroup('test-token', 484);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/484',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should create, update, and delete groups through exact Laravel v2 mutation endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42, visibility: 'private' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42, visibility: 'public' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 204,
          headers: { get: () => null },
          text: async () => ''
        });

      await api.createGroup('test-token', {
        name: 'Repair circle',
        description: 'Share repair skills.',
        location: 'Dublin',
        visibility: 'private'
      });
      await api.updateGroup('test-token', 42, { visibility: 'public' });
      await api.deleteGroup('test-token', 42);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/groups',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            name: 'Repair circle',
            description: 'Share repair skills.',
            location: 'Dublin',
            visibility: 'private'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/groups/42',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ visibility: 'public' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/groups/42',
        expect.objectContaining({ method: 'DELETE' })
      );
    });

    it('should call Laravel v2 group depth endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { frequency: 'digest' } })
      });

      await api.callGroupApi('test-token', 'PUT', '/42/notification-prefs', {
        frequency: 'digest'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/42/notification-prefs',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ frequency: 'digest' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.callGroupApi('test-token', 'DELETE', '/42/files/5');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/groups/42/files/5',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should preserve group invitation paths, payloads, revocation, and authorization errors', async () => {
      const cases = [
        ['POST', '/42/invites/link', { expiry_days: 14 }],
        ['POST', '/42/invites/email', {
          emails: ['alex@example.test', 'sam@example.test'],
          message: 'Join our repair circle'
        }],
        ['DELETE', '/42/invites/19', undefined]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callGroupApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/groups${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'You cannot manage invitations for this group.', code: 'FORBIDDEN' })
      });

      await expect(api.callGroupApi('test-token', 'POST', '/42/invites/link', { expiry_days: 14 }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 403,
          message: 'You cannot manage invitations for this group.',
          data: { message: 'You cannot manage invitations for this group.', code: 'FORBIDDEN' }
        });
    });

    it('should upload group images to Laravel with multipart image data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { image_url: '/uploads/groups/cover.png' } })
      });

      await api.uploadGroupImage('test-token', 42, {
        type: 'cover',
        file: {
          buffer: Buffer.from('fake group cover image', 'utf8'),
          filename: 'group-cover.png',
          contentType: 'image/png'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/42/image?type=cover',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('should upload group files to Laravel with multipart file metadata', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 99 } })
      });

      await api.uploadGroupFile('test-token', 42, {
        folder: 'Policies',
        description: 'Member handbook',
        file: {
          buffer: Buffer.from('%PDF group handbook', 'utf8'),
          filename: 'handbook.pdf',
          contentType: 'application/pdf'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/42/files',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('should download group-file bytes with Laravel headers and preserve authorization errors', async () => {
      const bytes = Buffer.from('%PDF group handbook', 'utf8');
      const responseHeaders = {
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="handbook.pdf"',
        'content-length': String(bytes.length),
        'cache-control': 'private, no-store',
        pragma: 'no-cache',
        expires: '0',
        etag: '"group-file-99"',
        'last-modified': 'Wed, 15 Jul 2026 08:00:00 GMT'
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (name) => responseHeaders[name] || null },
        arrayBuffer: async () => bytes
      });

      await expect(api.downloadGroupFile('test-token', '/42/files/99/download'))
        .resolves.toEqual({ status: 200, body: bytes, headers: responseHeaders });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/42/files/99/download',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Content-Type');
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'You are not a member of this group.', code: 'GROUP_MEMBERSHIP_REQUIRED' })
      });

      await expect(api.downloadGroupFile('test-token', '42/files/99/download'))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 403,
          message: 'You are not a member of this group.',
          data: {
            message: 'You are not a member of this group.',
            code: 'GROUP_MEMBERSHIP_REQUIRED'
          }
        });
    });
  });

  describe('callUserSettingsApi', () => {
    it('should call Laravel v2 user settings endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { theme: 'dark' } })
      });

      await api.callUserSettingsApi('test-token', 'PUT', '/theme', {
        theme: 'dark'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me/theme',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ theme: 'dark' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'revoked' } })
      });

      await api.callUserSettingsApi('test-token', 'DELETE', '/sub-accounts/77');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/users/me/sub-accounts/77',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should submit a password-gated pending erasure request without calling the immediate purge endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          data: { request_id: 123, logout_required: true }
        })
      });

      await api.requestAccountDeletion('test-token', {
        password: 'current-password',
        reason: 'No longer needed'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/gdpr/delete-account',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            password: 'current-password',
            reason: 'No longer needed'
          })
        })
      );
      expect(mockFetch.mock.calls[0][0]).not.toContain('/api/v2/users/me');
    });

    it('should join a group through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { status: 'active' } })
      });

      await api.joinGroup('test-token', 449);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/449/join',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should leave a group through the Laravel v2 membership endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({})
      });

      await api.leaveGroup('test-token', 449);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/groups/449/membership',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

  });

  describe('callMerchantOnboardingApi', () => {
    it('should call Laravel v2 merchant-onboarding endpoints without a marketplace prefix', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ok: true } })
      });

      await api.callMerchantOnboardingApi('test-token', 'POST', '/step-2', {
        business_address: { city: 'Cork' }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/merchant-onboarding/step-2',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ business_address: { city: 'Cork' } })
        })
      );
    });

    it('should preserve merchant identity and bodyless completion contracts', async () => {
      const identity = {
        seller_type: 'business',
        display_name: 'Community Repairs',
        business_name: 'Community Repairs Limited'
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { step: 1, saved: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { completed: true } })
        });

      await expect(api.callMerchantOnboardingApi('test-token', 'POST', '/step-1', identity))
        .resolves.toEqual({ data: { step: 1, saved: true } });
      await expect(api.callMerchantOnboardingApi('test-token', 'POST', '/complete'))
        .resolves.toEqual({ data: { completed: true } });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/merchant-onboarding/step-1',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify(identity)
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/merchant-onboarding/complete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch.mock.calls[1][1]).not.toHaveProperty('body');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => 'application/json' },
        json: async () => ({
          message: 'The business identity is incomplete.',
          errors: { business_name: ['The business name field is required.'] },
          code: 'VALIDATION_FAILED'
        })
      });
      await expect(api.callMerchantOnboardingApi('test-token', 'POST', '/step-1', {
        seller_type: 'business', display_name: 'Community Repairs'
      })).rejects.toMatchObject({
        name: 'ApiError',
        status: 422,
        message: 'The business identity is incomplete.',
        data: {
          errors: { business_name: ['The business name field is required.'] },
          code: 'VALIDATION_FAILED'
        }
      });
    });
  });

  describe('callProfileApi', () => {
    it('should call arbitrary Laravel v2 profile-adjacent endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { language: 'ga' } })
      });

      await api.callProfileApi('test-token', 'PUT', '/users/me/language', {
        language: 'ga'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me/language',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ language: 'ga' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { revoked: true } })
      });

      await api.callProfileApi('test-token', 'POST', '/safeguarding/revoke', {
        option_id: 9
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/safeguarding/revoke',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ option_id: 9 })
        })
      );
    });

    it('should preserve global notification and safeguarding review mutation paths', async () => {
      const cases = [
        ['/notifications/settings', { context_type: 'global', context_id: 0, frequency: 'daily' }],
        ['/safeguarding/vetting-review-request', undefined],
        ['/safeguarding/confirm-policy-review', undefined]
      ];

      for (const [pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callProfileApi('test-token', 'POST', pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2${pathValue}`,
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'A vetting review is already open.', code: 'VETTING_REVIEW_ALREADY_OPEN' })
      });

      await expect(api.callProfileApi('test-token', 'POST', '/safeguarding/vetting-review-request'))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 409,
          message: 'A vetting review is already open.',
          data: { message: 'A vetting review is already open.', code: 'VETTING_REVIEW_ALREADY_OPEN' }
        });
    });
  });

  describe('callWebAuthnApi', () => {
    it('should call Laravel passkey endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { device_name: 'Laptop' } })
      });

      await api.callWebAuthnApi('test-token', 'POST', '/rename', {
        credential_id: 'cred-1',
        device_name: 'Laptop'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/webauthn/rename',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            credential_id: 'cred-1',
            device_name: 'Laptop'
          })
        })
      );
    });
  });

  describe('callListingApi', () => {
    it('should call Laravel v2 listing action endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { saved: true } })
      });

      await api.callListingApi('test-token', 'POST', '/42/save');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/listings/42/save',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { description: 'Generated listing copy' } })
      });

      await api.callListingApi('test-token', 'POST', '/generate-description', {
        title: 'Garden help'
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/listings/generate-description',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ title: 'Garden help' })
        })
      );
    });
  });

  describe('createExchangeRequest', () => {
    it('should create a Laravel v2 exchange request with listing payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 88 } })
      });

      await api.createExchangeRequest('test-token', {
        listing_id: 42,
        proposed_hours: 2.5
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            listing_id: 42,
            proposed_hours: 2.5
          })
        })
      );
    });
  });

  describe('callUgcTranslateApi', () => {
    it('should call the Laravel v2 UGC translation endpoint with auth and payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { translated_text: 'Dia duit' } })
      });

      await api.callUgcTranslateApi('test-token', {
        content_type: 'event',
        content_id: 7,
        source_text: 'Hello',
        target_locale: 'ga'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/ugc-translate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            content_type: 'event',
            content_id: 7,
            source_text: 'Hello',
            target_locale: 'ga'
          })
        })
      );
    });
  });

  describe('Laravel message helpers', () => {
    it('should call Laravel v2 message and conversation endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.callMessageApi('test-token', 'PUT', '/12', {
        body: 'Updated message'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/messages/12',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ body: 'Updated message' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 33 } })
      });

      await api.callConversationApi('test-token', 'POST', '/33/messages', {
        body: 'Hello group'
      });

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/conversations/33/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ body: 'Hello group' })
        })
      );
    });

    it('should preserve the Laravel message translation path and validation envelope', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { translated_text: 'Dia duit' } })
      });

      await expect(api.callMessageApi('test-token', 'POST', '/44/translate', {
        target_language: 'ga'
      })).resolves.toEqual({ data: { translated_text: 'Dia duit' } });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/messages/44/translate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ target_language: 'ga' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => 'application/json' },
        json: async () => ({
          message: 'The target language is invalid.',
          errors: { target_language: ['Select a supported language.'] },
          code: 'VALIDATION_FAILED'
        })
      });

      await expect(api.callMessageApi('test-token', 'POST', '/44/translate', {
        target_language: 'invalid'
      })).rejects.toMatchObject({
        name: 'ApiError',
        status: 422,
        message: 'The target language is invalid.',
        data: {
          errors: { target_language: ['Select a supported language.'] },
          code: 'VALIDATION_FAILED'
        }
      });
    });

    it('should preserve group-conversation and participant mutation paths and payloads', async () => {
      const cases = [
        ['POST', '/groups', { name: 'Repair coordinators', participant_ids: [77, 91] }],
        ['POST', '/33/participants', { user_ids: [105, 106] }],
        ['DELETE', '/33/participants/105', undefined]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callConversationApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/conversations${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'You cannot manage this conversation.', code: 'FORBIDDEN' })
      });

      await expect(api.callConversationApi('test-token', 'POST', '/33/participants', { user_ids: [105] }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 403,
          message: 'You cannot manage this conversation.',
          data: { message: 'You cannot manage this conversation.', code: 'FORBIDDEN' }
        });
    });

    it('should upload voice messages to Laravel with multipart audio data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12, is_voice: true } })
      });

      await api.uploadVoiceMessage('test-token', {
        recipient_id: 77,
        file: {
          buffer: Buffer.from('fake webm audio bytes', 'utf8'),
          filename: 'voice-note.webm',
          contentType: 'audio/webm'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/messages/voice',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('should upload message attachments to Laravel with multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.uploadMessageAttachments('test-token', {
        recipient_id: 77,
        body: 'Here is the handbook.',
        context_type: 'listing',
        context_id: 42,
        files: [
          {
            buffer: Buffer.from('%PDF message attachment', 'utf8'),
            filename: 'handbook.pdf',
            contentType: 'application/pdf'
          }
        ]
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('recipient_id')).toBe('77');
      expect(options.body.get('body')).toBe('Here is the handbook.');
      expect(options.body.get('context_type')).toBe('listing');
      expect(options.body.get('context_id')).toBe('42');
    });

    it('should send and mark direct conversations through Laravel v2 message endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 12 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 13 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { marked_read: 1 } })
        });

      await api.sendMessage('test-token', 77, 'Hello there');
      await api.replyToConversation('test-token', 77, 'A reply');
      await api.markConversationRead('test-token', 77);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ recipient_id: 77, body: 'Hello there' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/messages',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ recipient_id: 77, body: 'A reply' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/messages/77/read',
        expect.objectContaining({ method: 'PUT' })
      );
    });

    it('should preserve passkey security confirmation and removal contracts', async () => {
      const cases = [
        ['/security-confirm', { password: 'correct horse battery staple' }, { confirmed: true }],
        ['/remove', { credential_id: 'cred-1', security_confirmation: 'proof-7' }, { removed: true }]
      ];

      for (const [pathValue, body, responseData] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: responseData })
        });

        await expect(api.callWebAuthnApi('test-token', 'POST', pathValue, body))
          .resolves.toEqual({ data: responseData });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/webauthn${pathValue}`,
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            body: JSON.stringify(body)
          })
        );
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Security confirmation is required.', code: 'SECURITY_CONFIRMATION_REQUIRED' })
      });

      await expect(api.callWebAuthnApi('test-token', 'POST', '/remove', { credential_id: 'cred-1' }))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 401,
          message: 'Security confirmation is required.',
          data: {
            message: 'Security confirmation is required.',
            code: 'SECURITY_CONFIRMATION_REQUIRED'
          }
        });
    });
  });

  describe('callPodcastApi', () => {
    it('should call Laravel v2 podcast endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.callPodcastApi('test-token', 'POST', '/42/episodes', {
        title: 'Community update',
        audio_url: 'https://media.example/audio.mp3'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/podcasts/42/episodes',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            title: 'Community update',
            audio_url: 'https://media.example/audio.mp3'
          })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.callPodcastApi('test-token', 'DELETE', '/42');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/podcasts/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should upload podcast episode audio to Laravel with multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 99 } })
      });

      await api.uploadPodcastEpisode('test-token', 42, {
        title: 'First update',
        summary: 'Short summary',
        description: 'Longer notes',
        episode_number: 3,
        file: {
          buffer: Buffer.from('fake mp3 podcast bytes', 'utf8'),
          filename: 'first-update.mp3',
          contentType: 'audio/mpeg'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/podcasts/42/episodes',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });

    it('should upload podcast artwork to Laravel with the image multipart field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { artwork_url: '/uploads/podcasts/show.webp' } })
      });

      await api.uploadPodcastArtwork('test-token', 42, {
        buffer: Buffer.from('fake podcast image bytes', 'utf8'),
        filename: 'show.webp',
        contentType: 'image/webp'
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/podcasts/42/artwork',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.get('image')).toBeInstanceOf(Blob);
    });

    it('should update episode audio through Laravel method spoofing and upload its cover', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 99 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { url: '/uploads/podcasts/episode.webp' } })
        });

      await api.updatePodcastEpisode('test-token', 42, 99, {
        title: 'Updated episode',
        episode_number: 0,
        explicit: true,
        chapters: [{ title: 'Opening', starts_at_seconds: 0 }],
        file: {
          buffer: Buffer.from('replacement audio bytes', 'utf8'),
          filename: 'replacement.wav',
          contentType: 'audio/wav'
        }
      });
      await api.uploadPodcastEpisodeCover('test-token', 42, 99, {
        buffer: Buffer.from('cover bytes', 'utf8'),
        filename: 'episode.webp',
        contentType: 'image/webp'
      });

      const updateOptions = mockFetch.mock.calls[0][1];
      expect(mockFetch.mock.calls[0][0]).toBe('http://localhost:5000/api/v2/podcasts/42/episodes/99');
      expect(updateOptions.method).toBe('POST');
      expect(updateOptions.body).toBeInstanceOf(FormData);
      expect(updateOptions.body.get('_method')).toBe('PUT');
      expect(updateOptions.body.get('episode_number')).toBe('0');
      expect(updateOptions.body.get('explicit')).toBe('1');
      expect(updateOptions.body.get('audio')).toBeInstanceOf(Blob);

      const coverOptions = mockFetch.mock.calls[1][1];
      expect(mockFetch.mock.calls[1][0]).toBe('http://localhost:5000/api/v2/podcasts/42/episodes/99/cover');
      expect(coverOptions.method).toBe('POST');
      expect(coverOptions.body.get('image')).toBeInstanceOf(Blob);
    });
  });

  describe('callFederationApi', () => {
    it('should call Laravel v2 federation endpoints with auth, method, and optional payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.callFederationApi('test-token', 'POST', '/messages', {
        receiver_id: 77,
        receiver_tenant_id: 12,
        body: 'Hello federation'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/federation/messages',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            receiver_id: 77,
            receiver_tenant_id: 12,
            body: 'Hello federation'
          })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { removed: true } })
      });

      await api.callFederationApi('test-token', 'DELETE', '/connections/91');

      expect(mockFetch).toHaveBeenLastCalledWith(
        'http://localhost:5000/api/v2/federation/connections/91',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should preserve federation connection, translation, read, and transfer mutation paths', async () => {
      const cases = [
        ['POST', '/connections', { receiver_id: 77, receiver_tenant_id: 12, message: 'Let us connect' }],
        ['POST', '/connections/91/accept', undefined],
        ['POST', '/connections/92/reject', undefined],
        ['POST', '/messages/44/translate', { target_language: 'ga' }],
        ['POST', '/messages/mark-read-batch', { ids: [44, 45] }],
        ['POST', '/transactions', {
          receiver_id: 77,
          receiver_tenant_id: 12,
          amount: 3,
          description: 'Shared repair work',
          idempotency_key: 'transfer-123'
        }]
      ];

      for (const [method, pathValue, body] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { accepted: true } })
        });

        await expect(api.callFederationApi('test-token', method, pathValue, body))
          .resolves.toEqual({ data: { accepted: true } });
        expect(mockFetch).toHaveBeenLastCalledWith(
          `http://localhost:5000/api/v2/federation${pathValue}`,
          expect.objectContaining({
            method,
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
            ...(body === undefined ? {} : { body: JSON.stringify(body) })
          })
        );
        if (body === undefined) {
          expect(mockFetch.mock.calls.at(-1)[1]).not.toHaveProperty('body');
        }
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => 'application/json' },
        json: async () => ({
          message: 'The transfer could not be completed.',
          errors: { amount: ['The amount exceeds the federation limit.'] },
          code: 'TRANSFER_LIMIT_EXCEEDED'
        })
      });

      await expect(api.callFederationApi('test-token', 'POST', '/transactions', {
        receiver_id: 77, receiver_tenant_id: 12, amount: 101, description: 'Too large'
      })).rejects.toMatchObject({
        name: 'ApiError',
        status: 422,
        message: 'The transfer could not be completed.',
        data: {
          errors: { amount: ['The amount exceeds the federation limit.'] },
          code: 'TRANSFER_LIMIT_EXCEEDED'
        }
      });
    });
  });

  describe('donateCredits', () => {
    it('should call the Laravel wallet donation endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'sent' } })
      });

      await api.donateCredits('test-token', {
        recipient_type: 'community_fund',
        amount: 2,
        message: 'Thank you'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/wallet/donate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            recipient_type: 'community_fund',
            amount: 2,
            message: 'Thank you'
          })
        })
      );
    });
  });

  describe('Laravel saved and appreciation helpers', () => {
    it('should read a member public collection projection with bearer authority', async () => {
      const responseBody = {
        data: [{ id: 12, name: 'Useful links', description: 'Things to revisit', is_public: true }]
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => responseBody
      });

      await expect(api.getUserPublicCollections('test-token', 77)).resolves.toEqual(responseBody);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/77/public-collections',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch.mock.calls[0][1].method).toBeUndefined();
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('X-Tenant-ID');
    });

    it('should preserve appreciation pagination and Laravel authorization errors', async () => {
      const responseBody = {
        data: [{ id: 55, receiver_id: 77, message: 'Thank you', is_public: true }],
        meta: { current_page: 2, last_page: 4, total: 65, per_page: 20 }
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => responseBody
      });

      await expect(api.getUserAppreciations('test-token', 77, { page: 2, per_page: 20 }))
        .resolves.toEqual(responseBody);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/77/appreciations?page=2&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'This action is unauthorized.', code: 'FORBIDDEN' })
      });

      await expect(api.getUserAppreciations('test-token', 77))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 403,
          message: 'This action is unauthorized.',
          data: { message: 'This action is unauthorized.', code: 'FORBIDDEN' }
        });
    });

    it('should remove a saved item by item pair through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '' },
        text: async () => ''
      });

      await api.unsaveSavedItem('test-token', 'listing', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/saved-items?item_type=listing&item_id=42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should send an appreciation through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 55 } })
      });

      await api.sendAppreciation('test-token', {
        receiver_id: 77,
        message: 'Thank you',
        context_type: 'general',
        is_public: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/appreciations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            receiver_id: 77,
            message: 'Thank you',
            context_type: 'general',
            is_public: true
          })
        })
      );
    });

    it('should react to an appreciation through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { reaction_type: 'heart' } })
      });

      await api.reactToAppreciation('test-token', 55, 'heart');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/appreciations/55/react',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ reaction_type: 'heart' })
        })
      );
    });

    it('should create a saved collection through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.createSavedCollection('test-token', {
        name: 'Useful links',
        description: 'Things to revisit',
        is_public: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/collections',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            name: 'Useful links',
            description: 'Things to revisit',
            is_public: true
          })
        })
      );
    });

    it('should update a saved collection through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.updateSavedCollection('test-token', 12, {
        name: 'Updated',
        description: null,
        is_public: false
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/collections/12',
        expect.objectContaining({
          method: 'PATCH',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            name: 'Updated',
            description: null,
            is_public: false
          })
        })
      );
    });

    it('should delete a saved collection through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '' },
        text: async () => ''
      });

      await api.deleteSavedCollection('test-token', 12);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/collections/12',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should delete a saved item through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => '' },
        text: async () => ''
      });

      await api.deleteSavedItem('test-token', 99);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/me/saved-items/99',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Laravel matching helpers', () => {
    it('should dismiss a match through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { dismissed: true } })
      });

      await api.dismissMatch('test-token', 77, 'too_far');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/matches/77/dismiss',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ reason: 'too_far' })
        })
      );
    });
  });

  describe('Laravel exchange helpers', () => {
    it('should perform an exchange action through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 88 } })
      });

      await api.performExchangeAction('test-token', 88, 'confirm', { hours: 2.5 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges/88/confirm',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ hours: 2.5 })
        })
      );
    });

    it('should cancel an exchange through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'cancelled' } })
      });

      await api.performExchangeAction('test-token', 88, 'cancel', { reason: 'No longer needed' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges/88',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ reason: 'No longer needed' })
        })
      );
    });

    it('should rate an exchange through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ratings: [] } })
      });

      await api.rateExchange('test-token', 88, {
        rating: 5,
        comment: 'Great exchange'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges/88/rate',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            rating: 5,
            comment: 'Great exchange'
          })
        })
      );
    });
  });

  describe('Laravel AI chat helpers', () => {
    it('should send a chat message through the Laravel AI endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { conversation_id: 123 } })
      });

      await api.sendAiChat('test-token', {
        message: 'Find me a gardener',
        conversation_id: 44
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/ai/chat',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            message: 'Find me a gardener',
            conversation_id: 44
          })
        })
      );
    });
  });

  describe('Laravel search helpers', () => {
    it('should preserve encoded member and skill lookup queries with bearer authority', async () => {
      const memberResponse = { data: [{ id: 77, name: 'Renée O\'Connor' }], meta: { total: 1 } };
      const skillResponse = {
        data: [{ id: 77, name: 'Renée O\'Connor', proficiency: 'can_help' }],
        meta: { total: 1 }
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => memberResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => skillResponse
        });

      await expect(api.searchUsers('test-token', 'Renée & repair', { limit: 25 }))
        .resolves.toEqual(memberResponse);
      await expect(api.getSkillMembers('test-token', 'Bike repair & maintenance', { limit: 40 }))
        .resolves.toEqual(skillResponse);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/users/search?q=Ren%C3%A9e+%26+repair&limit=25',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/skills/members?skill=Bike+repair+%26+maintenance&limit=40',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      for (const [, options] of mockFetch.mock.calls) {
        expect(options.method).toBeUndefined();
        expect(options.headers).not.toHaveProperty('X-Tenant-ID');
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'This skill directory is not available.', code: 'FEATURE_DISABLED' })
      });

      await expect(api.getSkillMembers('test-token', 'gardening')).rejects.toMatchObject({
        name: 'ApiError',
        status: 403,
        message: 'This skill directory is not available.',
        data: { message: 'This skill directory is not available.', code: 'FEATURE_DISABLED' }
      });
    });

    it('should search through the Laravel v2 endpoint with advanced filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [], meta: { search: { total: 0 } } })
      });

      await api.searchV2('test-token', {
        q: 'gardening',
        type: 'listings',
        per_page: 30,
        category_id: 3,
        sort: 'newest',
        skills: 'repair,teaching'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search?q=gardening&type=listings&per_page=30&category_id=3&sort=newest&skills=repair%2Cteaching',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should toggle a flat bookmark through Laravel BookmarkController', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { bookmarked: false } })
      });

      await api.toggleBookmark('test-token', 'listing', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/bookmarks',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ type: 'listing', id: 42 })
        })
      );
    });

    it('should fetch suggestions through the Laravel v2 search endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { listings: [], users: [], events: [], groups: [] } })
      });

      await api.searchSuggestions('test-token', 'garden', 8);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search/suggestions?q=garden&limit=8',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should list saved searches through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getSavedSearches('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search/saved',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should save a search through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.saveSavedSearch('test-token', {
        name: 'Gardeners',
        query_params: {
          q: 'gardening',
          type: 'listings'
        },
        notify_on_new: false
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search/saved',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            name: 'Gardeners',
            query_params: {
              q: 'gardening',
              type: 'listings'
            },
            notify_on_new: false
          })
        })
      );
    });

    it('should delete a saved search through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ deleted: true })
      });

      await api.deleteSavedSearch('test-token', 12);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search/saved/12',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should run a saved search through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12, query_params: { q: 'gardening' } } })
      });

      await api.runSavedSearch('test-token', 12);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/search/saved/12/run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({})
        })
      );
    });
  });

  describe('Laravel gamification helpers', () => {
    it('should dispatch legacy achievement and v2 gamification reads without rewriting projections', async () => {
      const cases = [
        ['/achievements/progress', '/api/achievements/progress', { data: { completed: 4, total: 12 } }],
        ['/community-dashboard', '/api/v2/gamification/community-dashboard', { data: { members: 34 } }],
        ['/engagement-history', '/api/v2/gamification/engagement-history', { data: [], meta: { total: 0 } }],
        ['/member-spotlight?limit=3', '/api/v2/gamification/member-spotlight?limit=3', { data: [{ id: 77 }] }],
        ['/nexus-score', '/api/v2/gamification/nexus-score', { data: { score: 81, band: 'high' } }],
        ['/personal-journey', '/api/v2/gamification/personal-journey', { data: { milestones: [] } }]
      ];

      for (const [, , responseBody] of cases) {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => responseBody
        });
      }

      for (let index = 0; index < cases.length; index += 1) {
        const [pathValue, expectedPath, responseBody] = cases[index];
        await expect(api.callGamificationApi('test-token', 'GET', pathValue)).resolves.toEqual(responseBody);
        expect(mockFetch).toHaveBeenNthCalledWith(
          index + 1,
          `http://localhost:5000${expectedPath}`,
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
          })
        );
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Gamification is not enabled.', code: 'FEATURE_DISABLED' })
      });

      await expect(api.callGamificationApi('test-token', 'GET', '/nexus-score'))
        .rejects.toMatchObject({
          name: 'ApiError',
          status: 403,
          message: 'Gamification is not enabled.',
          data: { message: 'Gamification is not enabled.', code: 'FEATURE_DISABLED' }
        });
    });

    it('should fetch own and member gamification profiles through the exact Laravel v2 contract', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { user: { id: 101 }, xp: 1250, level: 4, badges_count: 2 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { user: { id: 77 }, xp: 120, level: 2, badges_count: 1 } })
        });

      const ownProfile = await api.getGamificationProfile('test-token');
      const memberProfile = await api.getGamificationProfileByUserId('test-token', 77);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/gamification/profile',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/gamification/profile?user_id=77',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(ownProfile.data.xp).toBe(1250);
      expect(memberProfile.data.user.id).toBe(77);
    });

    it('should fetch own and member badges through the exact Laravel v2 data/meta contract', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            data: [{ badge_key: 'helper', name: 'Community helper' }],
            meta: { total: 1, available_types: ['community'] }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({
            data: [{ badge_key: 'mentor', name: 'Mentor' }],
            meta: { total: 1, available_types: ['community'] }
          })
        });

      const ownBadges = await api.getMyBadges('test-token');
      const memberBadges = await api.getAllBadges('test-token', { user_id: 77 });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/gamification/badges',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/gamification/badges?user_id=77',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(ownBadges.meta.available_types).toEqual(['community']);
      expect(memberBadges.data[0].badge_key).toBe('mentor');
    });

    it('should claim the daily reward through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { claimed: true } })
      });

      await api.claimDailyReward('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/gamification/daily-reward',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should claim a gamification challenge through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { claimed: true, challenge_id: 7 } })
      });

      await api.claimGamificationChallenge('test-token', 7);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/gamification/challenges/7/claim',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should purchase a gamification shop item through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { success: true } })
      });

      await api.purchaseGamificationShopItem('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/gamification/shop/purchase',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ item_id: 42 })
        })
      );
    });

    it('should update the gamification showcase through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'updated' } })
      });

      await api.updateGamificationShowcase('test-token', ['helper', 'mentor']);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/gamification/showcase',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ badge_keys: ['helper', 'mentor'] })
        })
      );
    });
  });

  describe('Laravel club and coupon directory helpers', () => {
    it('should preserve the public club query and signed coupon paths', async () => {
      const clubResponse = {
        data: [{ id: 3, name: 'Cycling Club', member_count: 0 }],
        meta: { current_page: 2, last_page: 3, total: 21, per_page: 10 }
      };
      const couponsResponse = { data: [{ id: 8, code: 'SAVE10', discount_type: 'percentage' }] };
      const couponResponse = { data: { id: 8, code: 'SAVE10', discount_value: 10 } };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => clubResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => couponsResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => couponResponse
        });

      await expect(api.getClubs({ search: 'cycle & repair', page: 2, per_page: 10 }))
        .resolves.toEqual(clubResponse);
      await expect(api.callCouponApi('test-token', 'GET')).resolves.toEqual(couponsResponse);
      await expect(api.callCouponApi('test-token', 'GET', '/8')).resolves.toEqual(couponResponse);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/clubs?search=cycle+%26+repair&page=2&per_page=10',
        expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/coupons',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/coupons/8',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should preserve a disabled coupon module as a structured Laravel error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Coupons are not enabled.', code: 'FEATURE_DISABLED' })
      });

      await expect(api.callCouponApi('test-token', 'GET')).rejects.toMatchObject({
        name: 'ApiError',
        status: 403,
        message: 'Coupons are not enabled.',
        data: { message: 'Coupons are not enabled.', code: 'FEATURE_DISABLED' }
      });
    });
  });

  describe('remaining Laravel OpenAPI-omitted read helpers', () => {
    const jsonResponse = (body) => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body
    });

    it('should preserve bookmark and saved-collection query envelopes', async () => {
      const bookmarks = { data: [{ id: 4, type: 'listing' }], meta: { total: 1 } };
      const collections = { data: [{ id: 12, name: 'Useful links' }], meta: { total: 1 } };
      const items = { data: [{ id: 4, item_type: 'listing' }], meta: { current_page: 2, total: 21 } };
      mockFetch
        .mockResolvedValueOnce(jsonResponse(bookmarks))
        .mockResolvedValueOnce(jsonResponse(collections))
        .mockResolvedValueOnce(jsonResponse(items));

      await expect(api.getBookmarks('test-token', {
        type: 'listing', collection_id: 12, page: 2, per_page: 20
      })).resolves.toEqual(bookmarks);
      await expect(api.getSavedCollections('test-token')).resolves.toEqual(collections);
      await expect(api.getSavedCollectionItems('test-token', '12/unsafe', { page: 2, per_page: 20 }))
        .resolves.toEqual(items);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/bookmarks?type=listing&collection_id=12&page=2&per_page=20',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/me/collections',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/me/collections/12%2Funsafe/items?page=2&per_page=20',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
    });

    it('should preserve public reaction summaries and signed reactor pagination', async () => {
      const summary = { data: { like: 3, celebrate: 1, total: 4 } };
      const reactors = { data: [{ id: 77, name: 'Alex' }], meta: { current_page: 2, total: 3 } };
      mockFetch
        .mockResolvedValueOnce(jsonResponse(summary))
        .mockResolvedValueOnce(jsonResponse(reactors));

      await expect(api.getReactionSummary('', 'blog/post', 42)).resolves.toEqual(summary);
      await expect(api.getReactors('test-token', 'blog/post', 42, 'celebrate & support', {
        page: 2, per_page: 20
      })).resolves.toEqual(reactors);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/reactions/blog%2Fpost/42',
        expect.objectContaining({ headers: expect.not.objectContaining({ Authorization: expect.anything() }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/reactions/blog%2Fpost/42/users/celebrate%20%26%20support?page=2&per_page=20',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
    });

    it('should preserve newsletter-token and given-review read contracts', async () => {
      const newsletter = { data: { status: 'valid', email_masked: 'a***@example.test' } };
      const reviews = { data: [{ id: 91, rating: 5 }], meta: { total: 1 } };
      mockFetch
        .mockResolvedValueOnce(jsonResponse(newsletter))
        .mockResolvedValueOnce(jsonResponse(reviews));

      await expect(api.callNewsletterApi('GET', '?token=signed%2Btoken')).resolves.toEqual(newsletter);
      await expect(api.callReviewApi('test-token', 'GET', '/given?per_page=20')).resolves.toEqual(reviews);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/newsletter/unsubscribe?token=signed%2Btoken',
        expect.objectContaining({ method: 'GET' })
      );
      expect(mockFetch.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/reviews/given?per_page=20',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should preserve job CV and resource download bytes, metadata, and errors', async () => {
      const cvBytes = Buffer.from('%PDF candidate cv', 'utf8');
      const resourceBytes = Buffer.from('resource bytes', 'utf8');
      const binaryResponse = (body, contentType, disposition) => ({
        ok: true,
        status: 200,
        headers: {
          get: (name) => ({
            'content-type': contentType,
            'content-disposition': disposition,
            'content-length': String(body.length),
            'cache-control': 'private, no-store'
          })[name] || null
        },
        arrayBuffer: async () => body
      });
      mockFetch
        .mockResolvedValueOnce(binaryResponse(cvBytes, 'application/pdf', 'attachment; filename="candidate.pdf"'))
        .mockResolvedValueOnce(binaryResponse(resourceBytes, 'application/octet-stream', 'attachment; filename="guide.bin"'));

      await expect(api.callJobDownload('test-token', '/applications/91/cv')).resolves.toMatchObject({
        status: 200,
        body: cvBytes,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': 'attachment; filename="candidate.pdf"',
          'content-length': String(cvBytes.length),
          'cache-control': 'private, no-store'
        }
      });
      await expect(api.downloadResource('test-token', '42/unsafe')).resolves.toMatchObject({
        status: 200,
        body: resourceBytes,
        headers: {
          'content-type': 'application/octet-stream',
          'content-disposition': 'attachment; filename="guide.bin"'
        }
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/jobs/applications/91/cv',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/resources/42%2Funsafe/download',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'File not found.', code: 'FILE_NOT_FOUND' })
      });
      await expect(api.downloadResource('test-token', 999999)).rejects.toMatchObject({
        name: 'ApiError',
        status: 404,
        message: 'File not found.',
        data: { message: 'File not found.', code: 'FILE_NOT_FOUND' }
      });
    });
  });

  describe('Laravel member profile action helpers', () => {
    it('should list member connections through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [], meta: { has_more: false } })
      });

      const result = await api.getConnections('test-token', {
        status: 'pending_received',
        per_page: 20,
        cursor: 'next-page'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections?status=pending_received&per_page=20&cursor=next-page',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(result).toEqual({ data: [], meta: { has_more: false } });
    });

    it('should fetch pending connection counts through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { received: 1, sent: 2, total_friends: 3 } })
      });

      await api.getConnectionPendingCountsV2('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/pending',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch member connection status through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { status: 'none' } })
      });

      await api.getMemberConnectionStatus('test-token', 77);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/status/77',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should send a member connection request through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.sendMemberConnectionRequest('test-token', 77);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/request',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ user_id: 77 })
        })
      );
    });

    it('should accept and decline member connections through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { status: 'connected' } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({})
        });

      await api.acceptMemberConnection('test-token', 12);
      await api.declineMemberConnection('test-token', 13);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/connections/12/accept',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/connections/13/decline',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should remove a member connection through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({})
      });

      await api.removeMemberConnection('test-token', 12);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/connections/12',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should block and unblock members through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { success: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { success: true } })
        });

      await api.blockMember('test-token', 77, 'spam');
      await api.unblockMember('test-token', 77);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/users/77/block',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ reason: 'spam' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/users/77/block',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should add and remove member endorsements through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { endorsement_id: 22 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { message: 'removed' } })
        });

      await api.endorseMemberSkill('test-token', 77, { skill_name: 'Gardening' });
      await api.removeMemberEndorsement('test-token', 77, 'Gardening');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/members/77/endorse',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ skill_name: 'Gardening' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/members/77/endorse',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ skill_name: 'Gardening' })
        })
      );
    });

    it('should fetch member endorsements through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { endorsements: [] } })
      });

      await api.getMemberEndorsements('test-token', 77);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/members/77/endorsements',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should fetch the Laravel v2 member profile depth endpoints', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getUserListings('test-token', 77, { limit: 6, type: 'offer', cursor: 'next' });
      await api.getUserSkills('test-token', 77);
      await api.getUserAvailability('test-token', 77);
      await api.getUserActivityDashboard('test-token', 77);
      await api.getUserBlockStatus('test-token', 77);

      const expectedPaths = [
        '/api/v2/users/77/listings?limit=6&type=offer&cursor=next',
        '/api/v2/users/77/skills',
        '/api/v2/users/77/availability',
        '/api/v2/users/77/activity/dashboard',
        '/api/v2/users/77/block-status'
      ];
      expectedPaths.forEach((path, index) => {
        expect(mockFetch).toHaveBeenNthCalledWith(
          index + 1,
          `http://localhost:5000${path}`,
          expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
        );
      });
    });

    it('should transfer wallet credits through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 99, type: 'debit', status: 'completed' } })
      });

      await api.transferWalletCredits('test-token', {
        recipient: 77,
        amount: 5,
        description: 'Thanks',
        idempotency_key: 'idem-1'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/wallet/transfer',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            recipient: 77,
            amount: 5,
            description: 'Thanks',
            idempotency_key: 'idem-1'
          })
        })
      );
    });
  });

  describe('Laravel member premium helpers', () => {
    it('should fetch member premium tiers through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { tiers: [] } })
      });

      await api.getMemberPremiumTiers('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/member-premium/tiers',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch the current member premium subscription through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { subscription: null, entitled_tier: null } })
      });

      await api.getMemberPremiumMe('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/member-premium/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should create a member premium checkout session through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { checkout_url: 'https://checkout.stripe.test/session' } })
      });

      await api.createMemberPremiumCheckout('test-token', {
        tier_id: 7,
        interval: 'yearly',
        return_url: '/premium/return?status=success'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/member-premium/checkout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            tier_id: 7,
            interval: 'yearly',
            return_url: '/premium/return?status=success'
          })
        })
      );
    });

    it('should create a member premium billing portal session through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { portal_url: 'https://billing.stripe.test/session' } })
      });

      await api.createMemberPremiumPortal('test-token', {
        return_url: '/premium/manage'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/member-premium/billing-portal',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            return_url: '/premium/manage'
          })
        })
      );
    });

    it('should cancel member premium through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { cancelled: true } })
      });

      await api.cancelMemberPremium('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/member-premium/cancel',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Laravel blog helpers', () => {
    it('should fetch blog posts through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getBlogPosts('test-token', {
        q: 'community',
        category: 7,
        cursor: 'abc',
        limit: 12
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/blog?search=community&category_id=7&cursor=abc&per_page=12',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch a blog post by slug through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42, slug: 'community-news' } })
      });

      await api.getBlogPost('test-token', 'community-news');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/blog/community-news',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Laravel poll helpers', () => {
    it('should fetch polls through the Laravel v2 endpoint with supported filters', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getPolls('test-token', {
        status: 'open',
        limit: 30,
        cursor: 'abc',
        mine: true,
        category: 'local',
        event_id: 5
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls?status=open&per_page=30&cursor=abc&mine=1&category=local&event_id=5',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch a poll by ID through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.getPoll('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should create a poll through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.createPoll('test-token', {
        question: 'Which project?',
        poll_type: 'standard',
        options: ['Garden', 'Cafe']
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            question: 'Which project?',
            poll_type: 'standard',
            options: ['Garden', 'Cafe']
          })
        })
      );
    });

    it('should vote on a poll through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.votePoll('test-token', 42, { option_id: 7 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls/42/vote',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ option_id: 7 })
        })
      );
    });

    it('should submit ranked poll choices through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { ranked_results: [] } })
      });

      await api.rankPoll('test-token', 42, {
        rankings: [
          { option_id: 9, rank: 1 },
          { option_id: 8, rank: 2 }
        ]
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls/42/rank',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            rankings: [
              { option_id: 9, rank: 1 },
              { option_id: 8, rank: 2 }
            ]
          })
        })
      );
    });

    it('should delete a poll through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.deletePoll('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/polls/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should toggle a polymorphic feed like through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { action: 'liked' } })
      });

      await api.toggleFeedLike('test-token', {
        target_type: 'poll',
        target_id: 42
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/feed/like',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            target_type: 'poll',
            target_id: 42
          })
        })
      );
    });
  });

  describe('Laravel feed action helpers', () => {
    it('should read the nested Laravel v2 comments envelope through the generic comments endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { comments: [{ id: 12 }], count: 1 } })
      });

      const result = await api.getComments('test-token', {
        target_type: 'post',
        target_id: 42
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/comments?target_type=post&target_id=42',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(result.data.comments).toEqual([{ id: 12 }]);
    });

    it('should create, update, and delete feed posts through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { deleted: true } })
        });

      await api.createFeedPostV2('test-token', { content: 'Hello', visibility: 'public' });
      await api.updateFeedPostV2('test-token', 42, { content: 'Updated' });
      await api.deleteFeedPostV2('test-token', 42);

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/feed/posts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ content: 'Hello', visibility: 'public' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/feed/posts/42',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ content: 'Updated' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(3,
        'http://localhost:5000/api/v2/feed/posts/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should create feed posts with uploaded images through Laravel multipart data', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42 } })
      });

      await api.createFeedPostV2('test-token', {
        content: 'Garden day update',
        visibility: 'public',
        image_alt: 'Volunteers planting herbs',
        file: {
          buffer: Buffer.from('fake image bytes', 'utf8'),
          filename: 'garden.webp',
          contentType: 'image/webp'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/feed/posts',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
      expect(options.body.getAll('media[]')).toHaveLength(1);
      expect(options.body.get('alt_texts[]')).toBe('Volunteers planting herbs');
      expect(options.body.get('image')).toBeNull();
    });

    it('should call Laravel v2 feed moderation helpers', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { hidden: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { success: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { reported: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { muted: true } })
        });

      await api.hideFeedItem('test-token', 42, { type: 'poll' });
      await api.markFeedItemNotInterested('test-token', 42, { type: 'resource' });
      await api.reportFeedItem('test-token', 'listing', 77, { reason: 'Spam' });
      await api.muteFeedUser('test-token', 99);

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/feed/posts/42/hide',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ type: 'poll' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/feed/posts/42/not-interested',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ type: 'resource' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(3,
        'http://localhost:5000/api/v2/feed/items/listing/77/report',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ reason: 'Spam' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(4,
        'http://localhost:5000/api/v2/feed/users/99/mute',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should call Laravel v2 feed share, save, saved-check, and poll vote helpers', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { shared: true } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 72 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { saved: false } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        });

      await api.shareFeedItem('test-token', { type: 'post', id: 42, comment: 'Worth reading' });
      await api.saveSavedItem('test-token', { item_type: 'post', item_id: 42 });
      await api.checkSavedItem('test-token', 'post', 42);
      await api.voteFeedPoll('test-token', 42, { option_id: 9 });

      expect(mockFetch).toHaveBeenNthCalledWith(1,
        'http://localhost:5000/api/v2/shares',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ type: 'post', id: 42, comment: 'Worth reading' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(2,
        'http://localhost:5000/api/v2/me/saved-items',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ item_type: 'post', item_id: 42 })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(3,
        'http://localhost:5000/api/v2/me/saved-items/check?item_type=post&item_id=42',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(4,
        'http://localhost:5000/api/v2/feed/polls/42/vote',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ option_id: 9 })
        })
      );
    });
  });

  describe('Laravel resource helpers', () => {
    it('should fetch the signed-in profile through the Laravel v2 users endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42, name: 'Test Member' } })
      });

      await api.getProfile('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch wallet overview data through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ balance: 12 })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        });

      await api.getBalance('test-token');
      await api.getTransactions('test-token', { per_page: 20, type: 'received', cursor: 'next-page' });
      await api.getTransaction('test-token', 42);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/wallet/balance',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/wallet/transactions?type=received&cursor=next-page&per_page=20',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/wallet/transactions/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch message overview data through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { count: 3 } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 42 } })
        });

      await api.getConversations('test-token', { per_page: 20, cursor: 'abc', archived: true });
      await api.getUnreadCount('test-token');
      await api.getConversation('test-token', 42);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/messages?per_page=20&cursor=abc&archived=true',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/messages/unread-count',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/messages/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should fetch exchange attention count through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { count: 2, items: [] } })
      });

      await api.getExchangeAttentionCount('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/exchanges/needs-attention-count',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
        })
      );
    });

    it('should fetch resources through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [] })
      });

      await api.getResources('test-token', {
        search: 'handbook',
        category_id: 3,
        cursor: 'abc',
        per_page: 50
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/resources?search=handbook&category_id=3&cursor=abc&per_page=50',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should delete a resource through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.deleteResource('test-token', 42);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/resources/42',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should reorder resources through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'reordered' } })
      });

      await api.reorderResources('test-token', {
        items: [
          { id: 20, sort_order: 0 },
          { id: 10, sort_order: 1 }
        ]
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/resources/reorder',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            items: [
              { id: 20, sort_order: 0 },
              { id: 10, sort_order: 1 }
            ]
          })
        })
      );
    });

    it('should fetch resource categories and category tree through Laravel v2 endpoints', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [{ id: 7, name: 'Guides' }] })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [{ id: 7, name: 'Guides', children: [] }] })
        });

      await api.getResourceCategories('test-token');
      await api.getResourceCategoryTree('test-token');

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/resources/categories',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/resources/categories/tree',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Laravel review social helpers', () => {
    it('should create an exchange review through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 91 } })
      });

      await api.createReview('test-token', {
        receiver_id: 77,
        rating: 5,
        comment: 'Great exchange',
        transaction_id: 22
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/reviews',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            receiver_id: 77,
            rating: 5,
            comment: 'Great exchange',
            transaction_id: 22
          })
        })
      );
    });

    it('should create a polymorphic comment through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12 } })
      });

      await api.createComment('test-token', {
        target_type: 'review',
        target_id: 91,
        content: 'Helpful context',
        parent_id: 4
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/comments',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            target_type: 'review',
            target_id: 91,
            content: 'Helpful context',
            parent_id: 4
          })
        })
      );
    });

    it('should update a polymorphic comment through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 12, content: 'Updated' } })
      });

      await api.updateComment('test-token', 12, { content: 'Updated' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/comments/12',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ content: 'Updated' })
        })
      );
    });

    it('should toggle a polymorphic reaction through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { action: 'added' } })
      });

      await api.toggleReaction('test-token', {
        target_type: 'review',
        target_id: 91,
        reaction_type: 'love'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/reactions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            target_type: 'review',
            target_id: 91,
            reaction_type: 'love'
          })
        })
      );
    });

    it('should delete a polymorphic comment through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.deleteComment('test-token', 12);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/comments/12',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });

  describe('Laravel onboarding helpers', () => {
    it('should read onboarding configuration and safeguarding options with bearer authority', async () => {
      const configResponse = {
        data: {
          config: { require_safeguarding: true, allow_skip: false },
          steps: ['profile', 'safeguarding', 'confirm']
        }
      };
      const safeguardingResponse = {
        data: [{ id: 9, key: 'adult_safeguarding', label: 'Adult safeguarding', required: true }]
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => configResponse
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => safeguardingResponse
        });

      await expect(api.getOnboardingConfig('test-token')).resolves.toEqual(configResponse);
      await expect(api.getOnboardingSafeguardingOptions('test-token')).resolves.toEqual(safeguardingResponse);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/onboarding/config',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/onboarding/safeguarding-options',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      for (const [, options] of mockFetch.mock.calls) {
        expect(options.method).toBeUndefined();
        expect(options.headers).not.toHaveProperty('X-Tenant-ID');
      }

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Unauthenticated.', code: 'UNAUTHENTICATED' })
      });

      await expect(api.getOnboardingConfig('expired-token')).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        message: 'Unauthenticated.',
        data: { message: 'Unauthenticated.', code: 'UNAUTHENTICATED' }
      });
    });

    it('should update the onboarding profile through Laravel\'s v2 user endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { bio: 'I can help with gardening' } })
      });

      await api.updateProfile('test-token', { bio: 'I can help with gardening' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me',
        expect.objectContaining({
          method: 'PUT',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ bio: 'I can help with gardening' })
        })
      );
    });

    it('should upload a resource through the exact Laravel multipart contract', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { id: 42, title: 'Volunteer guide' } })
      });

      await api.uploadResource('test-token', {
        title: 'Volunteer guide',
        description: 'A practical handbook',
        category_id: 7,
        file: {
          buffer: Buffer.from('resource bytes'),
          filename: 'guide.pdf',
          contentType: 'application/pdf'
        }
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/resources',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: expect.any(FormData)
        })
      );
      const options = mockFetch.mock.calls[0][1];
      expect(options.body.get('title')).toBe('Volunteer guide');
      expect(options.body.get('description')).toBe('A practical handbook');
      expect(options.body.get('category_id')).toBe('7');
      expect(options.body.get('file')).toBeInstanceOf(Blob);
      expect(options.headers).not.toHaveProperty('Content-Type');
    });

    it('should read polymorphic likers through Laravel legacy social compatibility', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { likers: [{ id: 7 }], total_count: 1 } })
      });

      await api.getSocialLikers('test-token', {
        target_type: 'goal',
        target_id: 42,
        page: 1,
        limit: 50
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/social/likers',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
          body: JSON.stringify({ target_type: 'goal', target_id: 42, page: 1, limit: 50 })
        })
      );
    });

    it('should save safeguarding preferences through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { preferences_count: 1 } })
      });

      await api.saveOnboardingSafeguarding('test-token', [
        { option_id: 9, value: 'yes' }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/onboarding/safeguarding',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            preferences: [{ option_id: 9, value: 'yes' }]
          })
        })
      );
    });

    it('should complete onboarding through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { message: 'complete' } })
      });

      await api.completeOnboarding('test-token', {
        interests: [2, 3],
        offers: [5],
        needs: [6]
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/onboarding/complete',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({
            interests: [2, 3],
            offers: [5],
            needs: [6]
          })
        })
      );
    });

    it('should upload the onboarding avatar through the Laravel v2 profile endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { avatar_url: '/avatars/member.jpg' } })
      });

      await api.uploadProfileAvatar('test-token', {
        file: {
          buffer: Buffer.from('fake png bytes', 'utf8'),
          filename: 'profile.png',
          contentType: 'image/png'
        }
      });

      const [, options] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/users/me/avatar',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
      expect(options.body).toBeInstanceOf(FormData);
    });
  });

  describe('Laravel notification helpers', () => {
    it('should read the normal inbox through Laravel\'s grouped cursor contract', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: [], meta: { cursor: null, has_more: false } })
      });

      await api.getGroupedNotifications('test-token', {
        per_page: 30,
        cursor: 'next-page',
        type: 'messages',
        unread_only: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications/grouped?per_page=30&cursor=next-page',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
    });

    it('should read unread notification pages, counts, and detail through Laravel v2 contracts', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: [], meta: { cursor: null, has_more: false } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { total: 3, categories: { messages: 2 } } })
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { id: 17 } })
        });

      await api.getNotifications('test-token', {
        per_page: 30,
        cursor: 'next-page',
        type: 'message_received',
        unread_only: true
      });
      await api.getNotificationUnreadCount('test-token');
      await api.getNotification('test-token', 17);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'http://localhost:5000/api/v2/notifications?per_page=30&cursor=next-page&type=message_received&unread_only=true',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'http://localhost:5000/api/v2/notifications/counts',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        'http://localhost:5000/api/v2/notifications/17',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
      );
    });

    it('should mark one notification read through Laravel\'s v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { marked_read: true } })
      });

      await api.markNotificationRead('test-token', 17);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications/17/read',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should mark all notifications read through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { marked_read: 2 } })
      });

      await api.markAllNotificationsRead('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications/read-all',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should mark a notification group read through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { marked_read: 2 } })
      });

      await api.markNotificationGroupRead('test-token', 'post_like:/feed/posts/7');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications/group/read',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          }),
          body: JSON.stringify({ group_key: 'post_like:/feed/posts/7' })
        })
      );
    });

    it('should delete all notifications through the Laravel v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: 2 } })
      });

      await api.deleteAllNotifications('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('should delete one notification through Laravel\'s v2 endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { deleted: true } })
      });

      await api.deleteNotification('test-token', 23);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/notifications/23',
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });

    it('does not expose the legacy receiver_id wallet transfer helper', () => {
      expect(api.transferCredits).toBeUndefined();
    });
  });

  describe('finite read-only API assertion manifest', () => {
    const jsonResponse = (body = { data: [] }) => ({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => body
    });

    it('asserts admin jobs, matching, and wallet read wrappers', async () => {
      mockFetch.mockResolvedValue(jsonResponse());

      await api.callAdminJobApi('test-token', 'GET', '/?limit=200');
      await api.callAdminJobApi('test-token', 'GET', '/42');
      await api.callMatchesApi('test-token', 'GET', '/all?limit=20&cursor=next');
      await api.callWalletApi('test-token', 'GET', '/balance');
      await api.callWalletApi('test-token', 'GET', '/community-fund');
      await api.callWalletApi('test-token', 'GET', '/user-search?q=ann&limit=10');

      const expectedUrls = [
        'http://localhost:5000/api/v2/admin/jobs/?limit=200',
        'http://localhost:5000/api/v2/admin/jobs/42',
        'http://localhost:5000/api/v2/matches/all?limit=20&cursor=next',
        'http://localhost:5000/api/v2/wallet/balance',
        'http://localhost:5000/api/v2/wallet/community-fund',
        'http://localhost:5000/api/v2/wallet/user-search?q=ann&limit=10'
      ];
      expectedUrls.forEach((url, index) => {
        expect(mockFetch).toHaveBeenNthCalledWith(
          index + 1,
          url,
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
          })
        );
      });
    });

    it('asserts Event and Poll binary read contracts', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => 'text/csv' },
        arrayBuffer: async () => Buffer.from('export bytes')
      });

      await api.downloadEventApi('test-token', '/42/analytics/export.csv');
      await api.downloadEventApi('test-token', '/42/calendar.ics');
      await api.downloadEventApi('test-token', '/calendar/feed.ics');
      await api.getPollExport('test-token', 'poll/42');

      const expectedUrls = [
        'http://localhost:5000/api/v2/events/42/analytics/export.csv',
        'http://localhost:5000/api/v2/events/42/calendar.ics',
        'http://localhost:5000/api/v2/events/calendar/feed.ics',
        'http://localhost:5000/api/v2/polls/poll%2F42/export'
      ];
      expectedUrls.forEach((url, index) => {
        expect(mockFetch).toHaveBeenNthCalledWith(
          index + 1,
          url,
          expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
          })
        );
      });
    });

    it('asserts public discovery, knowledge, legal, and feed read contracts', async () => {
      mockFetch.mockResolvedValue(jsonResponse());

      await api.getFeedHashtags('test-token', { q: 'repair', limit: 5 });
      await api.getFeedHashtags('', { limit: 10, days: 30 });
      await api.getFeedHashtagPosts('test-token', 'community garden', { limit: 20, cursor: 'next' });
      await api.getHelpFaqs({ q: 'password', category_id: 7 });
      await api.getKnowledgeBaseArticles('', { per_page: 12, cursor: 'abc', category_id: 7 });
      await api.getKnowledgeBaseArticles('test-token', { q: 'safeguarding', limit: 8 });
      await api.getKnowledgeBaseArticle('test-token', 'article/42');
      await api.getLegalDocument('acceptable_use');
      await api.getPopularListingTags('test-token', 12);

      const expected = [
        ['http://localhost:5000/api/v2/feed/hashtags/search?q=repair&limit=5', 'Bearer test-token'],
        ['http://localhost:5000/api/v2/feed/hashtags/trending?limit=10&days=30', null],
        ['http://localhost:5000/api/v2/feed/hashtags/community%20garden?limit=20&cursor=next', 'Bearer test-token'],
        ['http://localhost:5000/api/v2/help/faqs?q=password&category_id=7', null],
        ['http://localhost:5000/api/v2/kb?per_page=12&cursor=abc&category_id=7', null],
        ['http://localhost:5000/api/v2/kb/search?q=safeguarding&limit=8', 'Bearer test-token'],
        ['http://localhost:5000/api/v2/kb/article%2F42', 'Bearer test-token'],
        ['http://localhost:5000/api/v2/legal/acceptable_use', null],
        ['http://localhost:5000/api/v2/listings/tags/popular?limit=12', 'Bearer test-token']
      ];
      expected.forEach(([url, authorization], index) => {
        expect(mockFetch.mock.calls[index][0]).toBe(url);
        const headers = mockFetch.mock.calls[index][1]?.headers || {};
        if (authorization) expect(headers.Authorization).toBe(authorization);
        else expect(headers).not.toHaveProperty('Authorization');
      });
    });

    it('asserts member, onboarding, taxonomy, poll, and exchange read contracts', async () => {
      mockFetch.mockResolvedValue(jsonResponse());

      await api.getExchange('test-token', 'exchange/42');
      await api.getExchangeRatings('test-token', 42);
      await api.getMembersNearby('test-token', {
        lat: 51.8,
        lon: -8.3,
        radius_km: 25,
        q: 'repair',
        limit: 20,
        offset: 0
      });
      await api.getOnboardingCategories('test-token');
      await api.getOnboardingStatus('test-token');
      await api.getPollCategories('test-token');
      await api.getPollRankedResults('test-token', 'poll/42');
      await api.getSkillCategories('');
      await api.getSkillCategory('test-token', 'skill/7');
      await api.getMembersV2('test-token', {
        q: 'ann',
        sort: 'name',
        order: 'asc',
        limit: 25,
        offset: 0
      });
      await api.getMemberVerificationBadges('test-token', 'member/77');

      const expectedUrls = [
        'http://localhost:5000/api/v2/exchanges/exchange%2F42',
        'http://localhost:5000/api/v2/exchanges/42/ratings',
        'http://localhost:5000/api/v2/members/nearby?lat=51.8&lon=-8.3&radius_km=25&q=repair&limit=20&offset=0',
        'http://localhost:5000/api/v2/onboarding/categories',
        'http://localhost:5000/api/v2/onboarding/status',
        'http://localhost:5000/api/v2/polls/categories',
        'http://localhost:5000/api/v2/polls/poll%2F42/ranked-results',
        'http://localhost:5000/api/v2/skills/categories',
        'http://localhost:5000/api/v2/skills/categories/skill%2F7',
        'http://localhost:5000/api/v2/users?q=ann&sort=name&order=asc&limit=25&offset=0',
        'http://localhost:5000/api/v2/users/member%2F77/verification-badges'
      ];
      expectedUrls.forEach((url, index) => {
        expect(mockFetch.mock.calls[index][0]).toBe(url);
      });
      expect(mockFetch.mock.calls[7][1].headers).not.toHaveProperty('Authorization');
      for (const index of [0, 1, 2, 3, 4, 5, 6, 8, 9, 10]) {
        expect(mockFetch.mock.calls[index][1].headers.Authorization).toBe('Bearer test-token');
      }
    });
  });

  describe('getExplore', () => {
    it('should request the Laravel v2 Explore aggregate with auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ data: { popular_listings: [] } })
      });

      await api.getExplore('test-token');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:5000/api/v2/explore',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token'
          })
        })
      );
    });
  });
});
