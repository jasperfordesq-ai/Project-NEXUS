// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// F-112: on the shared host, opening a link to ANOTHER community's accessible
// mount used to refresh the session with the address's community instead of
// the one the token was issued for. Laravel rejects a refresh token presented
// through another tenant with a 401, web-uk read that as "credential revoked"
// and cleared every auth cookie — so following a link signed the member out.

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
const { refreshAuthSession, requireAuth, withTokenRefresh } = require('../src/middleware/auth');

function jwtWithExpiry(expiresAt) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode({ exp: expiresAt })}.signature`;
}

function responseDouble() {
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    redirect: jest.fn(),
    locals: { urlFor: (path) => path }
  };
  res.status = jest.fn(() => res);
  res.location = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

function foreignMountRequest(extraCookies = {}) {
  return {
    path: '/dashboard',
    signedCookies: {
      token: jwtWithExpiry(Math.floor(Date.now() / 1000) - 1),
      refresh_token: 'member-of-alpha-refresh',
      tenant_slug: 'alpha',
      ...extraCookies
    },
    accessibleRouting: {
      mode: 'shared',
      tenantSlug: 'beta',
      prefix: '/beta/accessible',
      routePath: '/dashboard'
    }
  };
}

describe('F-112 foreign community link keeps the member signed in', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refreshes with the community the token was issued for, not the one in the address', async () => {
    const fresh = jwtWithExpiry(Math.floor(Date.now() / 1000) + 900);
    api.refreshToken.mockResolvedValueOnce({
      access_token: fresh,
      refresh_token: 'rotated',
      expires_in: 900,
      refresh_expires_in: 3600
    });
    const req = foreignMountRequest();
    const res = responseDouble();

    await refreshAuthSession(req, res, jest.fn());

    expect(api.refreshToken).toHaveBeenCalledWith('member-of-alpha-refresh', 'alpha');
    expect(req.token).toBe(fresh);
    expect(res.clearCookie).not.toHaveBeenCalled();
    // The session stays bound to the member's own community.
    expect(res.cookie).toHaveBeenCalledWith('tenant_slug', 'alpha', expect.objectContaining({ signed: true }));
    expect(res.cookie).not.toHaveBeenCalledWith('tenant_slug', 'beta', expect.anything());
  });

  it('sends the member back to their own community after refreshing on a foreign mount', async () => {
    const fresh = jwtWithExpiry(Math.floor(Date.now() / 1000) + 900);
    api.refreshToken.mockResolvedValueOnce({
      access_token: fresh,
      refresh_token: 'rotated',
      expires_in: 900,
      refresh_expires_in: 3600
    });
    const req = foreignMountRequest();
    const res = responseDouble();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.location).toHaveBeenCalledWith('/alpha/accessible/dashboard');
    expect(res.redirect).not.toHaveBeenCalledWith(expect.stringContaining('/login'));
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('does not clear the session cookies when a refresh on a foreign mount is refused', async () => {
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Invalid or expired refresh token', 401, {
      errors: [{ code: 'AUTH_TOKEN_INVALID' }]
    }));
    const req = foreignMountRequest();
    const res = responseDouble();

    await refreshAuthSession(req, res, jest.fn());

    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(req.signedCookies.refresh_token).toBe('member-of-alpha-refresh');
    expect(req.token).toBeUndefined();
  });

  it('does not clear the session cookies when a route 401 on a foreign mount cannot be refreshed', async () => {
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Invalid or expired refresh token', 401, {
      errors: [{ code: 'AUTH_TOKEN_INVALID' }]
    }));
    const req = foreignMountRequest({ token: jwtWithExpiry(Math.floor(Date.now() / 1000) + 900) });
    const res = responseDouble();
    const handler = jest.fn(async () => {
      throw new api.ApiError('Unauthenticated', 401);
    });

    await withTokenRefresh(handler)(req, res, jest.fn());

    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it('still expires the local pair after an authoritative refusal in the member\'s own community', async () => {
    api.refreshToken.mockRejectedValueOnce(new api.ApiError('Invalid or expired refresh token', 401, {
      errors: [{ code: 'AUTH_TOKEN_INVALID' }]
    }));
    const req = foreignMountRequest();
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'alpha', prefix: '/alpha/accessible', routePath: '/dashboard' };
    const res = responseDouble();

    await refreshAuthSession(req, res, jest.fn());

    expect(api.refreshToken).toHaveBeenCalledWith('member-of-alpha-refresh', 'alpha');
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_token', expect.anything());
  });
});
