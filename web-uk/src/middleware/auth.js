// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { createHash } = require('node:crypto');
const { refreshToken: refreshTokenApi, validateToken, ApiError, ApiOfflineError } = require('../lib/api');

const NODE_ENV = process.env.NODE_ENV || 'development';

// Token refresh locks keyed by a one-way digest prevent concurrent single-use
// rotation without retaining refresh credentials in process-global keys.
const refreshLocks = new Map();
const AUTH_REQUIRED_LOGIN_PATH = '/login?status=auth-required';
const DEFAULT_ACCESS_EXPIRES_IN = 15 * 60;
const DEFAULT_REFRESH_EXPIRES_IN = 7 * 24 * 60 * 60;

function positiveSeconds(value, fallback) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : fallback;
}

function sessionEnvelope(result) {
  const value = result && typeof result === 'object' ? result : {};
  const accessToken = String(value.access_token || '').trim();
  const refreshToken = String(value.refresh_token || '').trim();
  const expiresIn = positiveSeconds(value.expires_in, 0);
  const refreshExpiresIn = positiveSeconds(value.refresh_expires_in, 0);
  return accessToken && refreshToken && expiresIn && refreshExpiresIn
    ? { accessToken, refreshToken, expiresIn, refreshExpiresIn }
    : null;
}

// Helper to set auth cookies
function setAuthCookies(res, accessToken, refreshTokenValue, options = {}) {
  const settings = options && typeof options === 'object' ? options : { tenantSlug: options };
  const expiresIn = positiveSeconds(settings.expiresIn, DEFAULT_ACCESS_EXPIRES_IN);
  const refreshExpiresIn = positiveSeconds(settings.refreshExpiresIn, DEFAULT_REFRESH_EXPIRES_IN);
  res.cookie('token', accessToken, {
    path: '/',
    httpOnly: true,
    signed: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: expiresIn * 1000
  });

  if (refreshTokenValue) {
    res.cookie('refresh_token', refreshTokenValue, {
      path: '/',
      httpOnly: true,
      signed: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: refreshExpiresIn * 1000
    });
  }

  const normalizedTenantSlug = String(settings.tenantSlug || '').trim();
  if (normalizedTenantSlug) {
    res.cookie('tenant_slug', normalizedTenantSlug, {
      path: '/',
      httpOnly: true,
      signed: true,
      secure: NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: refreshExpiresIn * 1000
    });
  }
}

// Helper to clear auth cookies
function clearAuthCookies(res) {
  res.clearCookie('token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
  res.clearCookie('refresh_token', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
  res.clearCookie('tenant_slug', { path: '/', httpOnly: true, signed: true, sameSite: 'lax' });
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function tenantSlugForRequest(req) {
  return String(req.accessibleRouting?.tenantSlug || req.signedCookies?.tenant_slug || '').trim();
}

function jwtExpiresSoon(token, now = Date.now()) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const expiresAt = Number(payload.exp);
    return Number.isFinite(expiresAt) && expiresAt <= Math.floor(now / 1000) + 5;
  } catch {
    return false;
  }
}

function refreshLockKey(refreshTokenValue, tenantSlug = '') {
  return createHash('sha256').update(`${tenantSlug}\0${refreshTokenValue}`).digest('hex');
}

function apiErrorCode(error) {
  const first = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  return String(first?.code || error?.data?.code || '').trim().toUpperCase();
}

function transientRefreshFailure(error) {
  if (error instanceof ApiOfflineError) return true;
  if (!(error instanceof ApiError)) return true;
  if ([408, 429].includes(error.status) || error.status >= 500) return true;
  return error.status === 409 && apiErrorCode(error) === 'AUTH_REFRESH_SUPERSEDED';
}

async function rotateSession(req, res, refreshTokenValue) {
  const tenantSlug = tenantSlugForRequest(req);
  const key = refreshLockKey(refreshTokenValue, tenantSlug);
  if (!refreshLocks.has(key)) {
    refreshLocks.set(key, refreshTokenApi(refreshTokenValue, tenantSlug).finally(() => {
      refreshLocks.delete(key);
    }));
  }
  const result = await refreshLocks.get(key);
  const envelope = sessionEnvelope(result);
  if (!envelope) {
    throw new ApiError('Laravel returned an incomplete rotating-session envelope', 502, {
      errors: [{ code: 'AUTH_REFRESH_RESPONSE_INVALID' }]
    });
  }

  setAuthCookies(res, envelope.accessToken, envelope.refreshToken, {
    expiresIn: envelope.expiresIn,
    refreshExpiresIn: envelope.refreshExpiresIn,
    tenantSlug: tenantSlugForRequest(req)
  });
  req.signedCookies.token = envelope.accessToken;
  req.signedCookies.refresh_token = envelope.refreshToken;
  req.token = envelope.accessToken;
  req.refreshToken = envelope.refreshToken;
}

async function ensureAuthSession(req, res) {
  if (req.authSessionChecked) return;
  req.authSessionChecked = true;
  const token = req.signedCookies?.token || '';
  const refreshTokenValue = req.signedCookies?.refresh_token || '';
  const needsRefresh = !token || jwtExpiresSoon(token);
  if (!refreshTokenValue || !needsRefresh) {
    if (token) req.token = token;
    return;
  }

  try {
    await rotateSession(req, res, refreshTokenValue);
  } catch (error) {
    // Do not present an expired access credential as authenticated during this
    // request. Transient failures preserve browser cookies for a later retry;
    // authoritative credential failures expire the complete local pair.
    delete req.signedCookies.token;
    delete req.token;
    if (!transientRefreshFailure(error)) {
      delete req.signedCookies.refresh_token;
      clearAuthCookies(res);
    }
  }
}

async function refreshAuthSession(req, res, next) {
  await ensureAuthSession(req, res);
  next();
}

// Middleware to require authentication
// Will attempt to refresh token if access token is missing but refresh token exists
async function requireAuth(req, res, next) {
  await ensureAuthSession(req, res);
  const token = req.token || req.signedCookies.token;

  if (!token) {
    return redirectTo(res, AUTH_REQUIRED_LOGIN_PATH);
  }

  req.token = token;
  req.refreshToken = req.signedCookies.refresh_token || '';
  next();
}

// Middleware to redirect if already authenticated
function redirectIfAuthenticated(req, res, next) {
  const token = req.signedCookies.token;

  if (token) {
    return redirectTo(res, '/dashboard');
  }

  next();
}

// Middleware to handle 401 responses by attempting token refresh
// This wraps async route handlers to catch 401 errors and retry with refreshed token
function withTokenRefresh(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      // If we get a 401 and have a refresh token, try to refresh
      if (error instanceof ApiError && error.status === 401) {
        const refreshTokenValue = req.signedCookies.refresh_token;

        if (refreshTokenValue) {
          try {
            // Laravel refresh credentials are single-use. Share the same
            // digest-keyed rotation used by the pre-route session check so
            // parallel 401 retries cannot spend one credential twice.
            await rotateSession(req, res, refreshTokenValue);
            return handler(req, res, next);
          } catch (refreshError) {
            delete req.token;
            delete req.signedCookies.token;
            if (!transientRefreshFailure(refreshError)) {
              delete req.signedCookies.refresh_token;
              clearAuthCookies(res);
            }
            return redirectTo(res, AUTH_REQUIRED_LOGIN_PATH);
          }
        }

        // No refresh token - redirect to login
        clearAuthCookies(res);
        return redirectTo(res, AUTH_REQUIRED_LOGIN_PATH);
      }

      // Not a 401 error - pass to error handler
      next(error);
    }
  };
}

// Middleware to require admin role
// Must be used after requireAuth
async function requireAdmin(req, res, next) {
  try {
    // Validate token and get user info
    const user = await validateToken(req.token);

    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return res.status(403).render('errors/403', {
        title: 'Access denied',
        message: 'You do not have permission to access this page. Admin access required.'
      });
    }

    // Store user info for use in routes
    req.user = user;
    next();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      clearAuthCookies(res);
      return redirectTo(res, '/login');
    }
    next(error);
  }
}

module.exports = {
  requireAuth,
  requireAdmin,
  redirectIfAuthenticated,
  withTokenRefresh,
  refreshAuthSession,
  setAuthCookies,
  clearAuthCookies,
  sessionEnvelope,
  jwtExpiresSoon
};
