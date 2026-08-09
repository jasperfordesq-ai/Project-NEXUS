// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  refreshToken: jest.fn(),
  validateToken: jest.fn()
}));

const api = require('../src/lib/api');
const {
  jwtExpiresSoon,
  refreshAuthSession,
  sessionEnvelope,
  setAuthCookies,
  withTokenRefresh
} = require('../src/middleware/auth');

function jwtWithExpiry(expiresAt) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expiresAt })}.signature`;
}

function responseDouble() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    locals: { urlFor: (path) => path }
  };
}

describe('Laravel rotating accessible session contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses Laravel-declared access and refresh lifetimes for every cookie', () => {
    const res = responseDouble();

    setAuthCookies(res, 'access-token', 'refresh-token', {
      expiresIn: 900,
      refreshExpiresIn: 3600,
      tenantSlug: 'acme'
    });

    expect(res.cookie).toHaveBeenNthCalledWith(1, 'token', 'access-token', expect.objectContaining({
      path: '/', maxAge: 900000, httpOnly: true, signed: true, sameSite: 'lax'
    }));
    expect(res.cookie).toHaveBeenNthCalledWith(2, 'refresh_token', 'refresh-token', expect.objectContaining({
      path: '/', maxAge: 3600000, httpOnly: true, signed: true, sameSite: 'lax'
    }));
    expect(res.cookie).toHaveBeenNthCalledWith(3, 'tenant_slug', 'acme', expect.objectContaining({
      path: '/', maxAge: 3600000, httpOnly: true, signed: true, sameSite: 'lax'
    }));
  });

  it('requires the complete current Laravel rotation envelope', () => {
    expect(sessionEnvelope({ access_token: 'access', refresh_token: 'refresh' })).toBeNull();
    expect(sessionEnvelope({
      access_token: 'access',
      refresh_token: 'refresh',
      expires_in: 900,
      refresh_expires_in: 3600
    })).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900, refreshExpiresIn: 3600 });
  });

  it('rotates an expired access token before the route reads authentication', async () => {
    const expired = jwtWithExpiry(Math.floor(Date.now() / 1000) - 1);
    const fresh = jwtWithExpiry(Math.floor(Date.now() / 1000) + 900);
    const req = {
      signedCookies: { token: expired, refresh_token: 'old-refresh' },
      accessibleRouting: { tenantSlug: 'acme' }
    };
    const res = responseDouble();
    const next = jest.fn();
    api.refreshToken.mockResolvedValueOnce({
      success: true,
      access_token: fresh,
      refresh_token: 'new-refresh',
      expires_in: 900,
      refresh_expires_in: 3600
    });

    await refreshAuthSession(req, res, next);

    expect(api.refreshToken).toHaveBeenCalledWith('old-refresh', 'acme');
    expect(req.token).toBe(fresh);
    expect(req.signedCookies).toEqual({ token: fresh, refresh_token: 'new-refresh' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves refresh cookies on transient failures but does not use expired access', async () => {
    const req = {
      signedCookies: {
        token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 1),
        refresh_token: 'retry-later'
      },
      accessibleRouting: { tenantSlug: 'acme' }
    };
    const res = responseDouble();
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Busy', 503));

    await refreshAuthSession(req, res, jest.fn());

    expect(req.signedCookies.token).toBeUndefined();
    expect(req.signedCookies.refresh_token).toBe('retry-later');
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('expires the complete local pair after an authoritative refresh rejection', async () => {
    const req = {
      signedCookies: { refresh_token: 'revoked-refresh', tenant_slug: 'acme' },
      accessibleRouting: { tenantSlug: 'acme' }
    };
    const res = responseDouble();
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Revoked', 401, {
      errors: [{ code: 'AUTH_TOKEN_EXPIRED' }]
    }));

    await refreshAuthSession(req, res, jest.fn());

    expect(req.signedCookies.refresh_token).toBeUndefined();
    expect(res.clearCookie).toHaveBeenCalledTimes(3);
  });

  it('preserves a valid refresh cookie when a route retry is temporarily unavailable', async () => {
    const req = {
      signedCookies: { token: 'rejected-access', refresh_token: 'retry-later', tenant_slug: 'acme' }
    };
    const res = responseDouble();
    const handler = jest.fn().mockRejectedValueOnce(new api.ApiError('Expired', 401));
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Busy', 503));

    await withTokenRefresh(handler)(req, res, jest.fn());

    expect(api.refreshToken).toHaveBeenCalledWith('retry-later', 'acme');
    expect(req.signedCookies.token).toBeUndefined();
    expect(req.signedCookies.refresh_token).toBe('retry-later');
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login?status=auth-required');
  });

  it('shares one single-use Laravel rotation across parallel route retries', async () => {
    let releaseRefresh;
    const refreshResult = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    api.refreshToken.mockReturnValue(refreshResult);

    const makeRequest = () => ({
      signedCookies: {
        token: 'rejected-access',
        refresh_token: 'single-use-refresh',
        tenant_slug: 'acme'
      },
      accessibleRouting: { tenantSlug: 'acme' }
    });
    const firstRequest = makeRequest();
    const secondRequest = makeRequest();
    const firstResponse = responseDouble();
    const secondResponse = responseDouble();
    const firstHandler = jest.fn()
      .mockRejectedValueOnce(new api.ApiError('Expired', 401))
      .mockResolvedValueOnce(undefined);
    const secondHandler = jest.fn()
      .mockRejectedValueOnce(new api.ApiError('Expired', 401))
      .mockResolvedValueOnce(undefined);

    const firstRetry = withTokenRefresh(firstHandler)(firstRequest, firstResponse, jest.fn());
    const secondRetry = withTokenRefresh(secondHandler)(secondRequest, secondResponse, jest.fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(api.refreshToken).toHaveBeenCalledTimes(1);
    expect(api.refreshToken).toHaveBeenCalledWith('single-use-refresh', 'acme');

    releaseRefresh({
      access_token: 'fresh-access',
      refresh_token: 'rotated-refresh',
      expires_in: 900,
      refresh_expires_in: 3600
    });
    await Promise.all([firstRetry, secondRetry]);

    expect(firstHandler).toHaveBeenCalledTimes(2);
    expect(secondHandler).toHaveBeenCalledTimes(2);
    expect(firstRequest.signedCookies).toEqual(expect.objectContaining({
      token: 'fresh-access',
      refresh_token: 'rotated-refresh'
    }));
    expect(secondRequest.signedCookies).toEqual(expect.objectContaining({
      token: 'fresh-access',
      refresh_token: 'rotated-refresh'
    }));
    expect(firstResponse.redirect).not.toHaveBeenCalled();
    expect(secondResponse.redirect).not.toHaveBeenCalled();
  });

  it('recognizes only real JWT expiry evidence', () => {
    expect(jwtExpiresSoon('test-token')).toBe(false);
    expect(jwtExpiresSoon(jwtWithExpiry(Math.floor(Date.now() / 1000) - 1))).toBe(true);
    expect(jwtExpiresSoon(jwtWithExpiry(Math.floor(Date.now() / 1000) + 600))).toBe(false);
  });
});
