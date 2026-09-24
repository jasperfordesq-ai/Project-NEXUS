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

// ─── Cookie names (F-208) ──────────────────────────────────────────────────
//
// In production the sign-in cookies carry the `__Host-` prefix. A browser only
// accepts a `__Host-` cookie that is Secure, has Path=/ and no Domain, so a
// sibling subdomain (anything else under the same registrable domain) can no
// longer plant its own signed session cookie here and swap the member into
// another account. Development keeps the plain names so it works over http.
//
// Every route reads `req.signedCookies.token` (about sixty call sites), so the
// prefixed names are mapped back to the plain names on the way IN by
// `normalizeAuthCookieNames`, which server.js mounts before cookie-parser.
//
// 🔴 One-release fallback: a member signed in before this change still holds
// the plain-named cookies, and is read from them only when NO `__Host-` sign-in
// cookie is present — so nobody is signed out by the deploy, and a planted plain
// cookie can never override a real `__Host-` session. The next token refresh
// (at most ~15 minutes) rewrites them under the new names. Remove the fallback
// in the release after this one.
const HOST_COOKIE_PREFIX = '__Host-';
const AUTH_COOKIE_NAMES = Object.freeze(['token', 'refresh_token', 'tenant_slug']);
const SESSION_COOKIE_BASE_NAME = 'nexus.sid';
const ORIGINAL_CLEAR_COOKIE = Symbol('nexus.originalClearCookie');

function usesHostPrefixedCookies(nodeEnv = NODE_ENV) {
  return nodeEnv === 'production';
}

/** The name a sign-in cookie is WRITTEN under in this environment. */
function authCookieName(name, nodeEnv = NODE_ENV) {
  return usesHostPrefixedCookies(nodeEnv) ? `${HOST_COOKIE_PREFIX}${name}` : name;
}

/**
 * The express-session cookie name. No legacy fallback for this one on purpose:
 * the session is not the sign-in (the token cookies are), and a planted session
 * could carry someone else's pending two-factor state. Dropping it at the deploy
 * signs nobody out; at worst a half-filled form is not restored once.
 */
function sessionCookieName(nodeEnv = NODE_ENV) {
  return usesHostPrefixedCookies(nodeEnv)
    ? `${HOST_COOKIE_PREFIX}${SESSION_COOKIE_BASE_NAME}`
    : SESSION_COOKIE_BASE_NAME;
}

function authCookieOptions(maxAge) {
  return {
    path: '/',
    httpOnly: true,
    signed: true,
    secure: NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge
  };
}

// A browser only honours the deletion of a Secure (and any `__Host-`) cookie
// when the deleting Set-Cookie is Secure too.
function clearingOptions() {
  return { path: '/', httpOnly: true, signed: true, sameSite: 'lax', secure: NODE_ENV === 'production' };
}

function cookiePairName(pair) {
  const index = pair.indexOf('=');
  return (index < 0 ? pair : pair.slice(0, index)).trim();
}

/**
 * Mounted BEFORE cookie-parser and express-session (production only).
 *
 * Inbound: `__Host-token=…` is presented to the app as `token=…` (likewise
 * refresh_token and tenant_slug). When any `__Host-` sign-in cookie is present,
 * plain-named sign-in cookies are discarded; otherwise they are kept as the
 * one-release fallback. A plain `nexus.sid` is always discarded.
 *
 * Outbound: `res.clearCookie('token')` from anywhere (the error handlers clear
 * the plain names) also clears the `__Host-` cookie, so a sign-out or a 401
 * really ends the session.
 */
function normalizeAuthCookieNames(req, res, next) {
  if (!usesHostPrefixedCookies()) return next();

  const header = req.headers && req.headers.cookie;
  if (typeof header === 'string' && header !== '') {
    const pairs = header.split(';').map((pair) => pair.trim()).filter(Boolean);
    const names = new Set(pairs.map(cookiePairName));
    const hasHostSignIn = AUTH_COOKIE_NAMES.some((name) => names.has(`${HOST_COOKIE_PREFIX}${name}`));
    const kept = [];
    for (const pair of pairs) {
      const name = cookiePairName(pair);
      if (name === SESSION_COOKIE_BASE_NAME) continue;
      if (AUTH_COOKIE_NAMES.includes(name)) {
        if (!hasHostSignIn) kept.push(pair);
        continue;
      }
      const base = name.startsWith(HOST_COOKIE_PREFIX) ? name.slice(HOST_COOKIE_PREFIX.length) : '';
      if (AUTH_COOKIE_NAMES.includes(base)) {
        kept.push(`${base}${pair.slice(pair.indexOf(name) + name.length)}`);
        continue;
      }
      kept.push(pair);
    }
    req.headers.cookie = kept.join('; ');
    req.legacyAuthCookies = !hasHostSignIn && AUTH_COOKIE_NAMES.some((name) => names.has(name));
  }

  if (res && typeof res.clearCookie === 'function' && !res.clearCookie[ORIGINAL_CLEAR_COOKIE]) {
    const originalClearCookie = res.clearCookie;
    const hostAwareClearCookie = function clearCookie(name, options) {
      if (AUTH_COOKIE_NAMES.includes(name)) {
        originalClearCookie.call(this, `${HOST_COOKIE_PREFIX}${name}`, clearingOptions());
        return originalClearCookie.call(this, name, { ...(options || {}), ...clearingOptions() });
      }
      return originalClearCookie.call(this, name, options);
    };
    hostAwareClearCookie[ORIGINAL_CLEAR_COOKIE] = originalClearCookie;
    res.clearCookie = hostAwareClearCookie;
  }

  return next();
}

// Helper to set auth cookies
function setAuthCookies(res, accessToken, refreshTokenValue, options = {}) {
  const settings = options && typeof options === 'object' ? options : { tenantSlug: options };
  const expiresIn = positiveSeconds(settings.expiresIn, DEFAULT_ACCESS_EXPIRES_IN);
  const refreshExpiresIn = positiveSeconds(settings.refreshExpiresIn, DEFAULT_REFRESH_EXPIRES_IN);
  res.cookie(authCookieName('token'), accessToken, authCookieOptions(expiresIn * 1000));

  if (refreshTokenValue) {
    res.cookie(authCookieName('refresh_token'), refreshTokenValue, authCookieOptions(refreshExpiresIn * 1000));
  }

  const normalizedTenantSlug = String(settings.tenantSlug || '').trim();
  if (normalizedTenantSlug) {
    res.cookie(authCookieName('tenant_slug'), normalizedTenantSlug, authCookieOptions(refreshExpiresIn * 1000));
  }
}

// Helper to clear auth cookies — both the `__Host-` and the plain names in
// production, so the one-release fallback cannot resurrect a signed-out session.
function clearAuthCookies(res) {
  const hostAware = Boolean(res.clearCookie && res.clearCookie[ORIGINAL_CLEAR_COOKIE]);
  for (const name of AUTH_COOKIE_NAMES) {
    if (usesHostPrefixedCookies() && !hostAware) {
      res.clearCookie(`${HOST_COOKIE_PREFIX}${name}`, clearingOptions());
    }
    res.clearCookie(name, clearingOptions());
  }
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

// F-112: a session belongs to the community its token was issued for, which the
// signed `tenant_slug` cookie records. The address's community is only a
// fallback for a session that predates that cookie. Refreshing with the
// address's community instead made Laravel refuse the refresh token (it is
// tenant-bound), and web-uk then cleared the cookies — so opening a link to
// another community on the shared host signed the member out.
function sessionTenantSlug(req) {
  return String(req.signedCookies?.tenant_slug || '').trim();
}

function tenantSlugForRequest(req) {
  return sessionTenantSlug(req) || String(req.accessibleRouting?.tenantSlug || '').trim();
}

// True when the address names a different community from the signed session's.
// A refresh refused on such a request says nothing reliable about the member's
// own session, so it must never clear their cookies.
function isForeignCommunityRequest(req) {
  const routed = String(req.accessibleRouting?.tenantSlug || '').trim().toLowerCase();
  const session = sessionTenantSlug(req).toLowerCase();
  return Boolean(routed && session && routed !== session);
}

function refreshFailureClearsSession(req, error) {
  return !transientRefreshFailure(error) && !isForeignCommunityRequest(req);
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
    tenantSlug
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
    if (refreshFailureClearsSession(req, error)) {
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
/**
 * Send a signed-in member back to their OWN community when the address names a
 * different one.
 *
 * 🔴 Found by running two synthetic communities against one Laravel. A member of
 * community A requesting `/community-b/accessible/dashboard` got a 200 — and the page
 * showed **their own** community-A data (own balance, own community's member list),
 * because the API resolves the member from the token, not from the URL. So nothing
 * leaked. The bug is that the page renders at all: it presents one community's name in
 * the address while showing another's data, and every link on it keeps the foreign
 * prefix, so the member stays in that hybrid state indefinitely. A shared or bookmarked
 * link puts them there with no way back other than editing the address.
 *
 * The guard lives here rather than in tenant routing on purpose: `requireAuth` runs
 * only on member-private routes, so browsing another community's PUBLIC pages while
 * signed in still works, which is legitimate. Cross-community federation browsing is
 * also unaffected — those links are `/federation/partners/...` under the member's own
 * prefix, never another community's mount.
 */
function redirectForeignTenantMount(req, res) {
  const routing = req.accessibleRouting;
  const routed = String(routing?.tenantSlug || '').trim().toLowerCase();
  const session = String(req.signedCookies?.tenant_slug || '').trim().toLowerCase();

  // Nothing to compare, or already the member's own community.
  if (!routed || !session || routed === session) {
    return false;
  }

  // 🔴 Only slug-prefixed mounts. On a custom domain (`mode: 'custom-domain'`, empty
  // prefix) there is no slug in the address to be wrong about, and redirecting to
  // `/slug/accessible/...` on that host would send the member to a path that community
  // does not serve. Signed cookies are host-scoped anyway, so a session cannot follow a
  // member onto another community's domain in the first place.
  if (!String(routing?.prefix || '')) {
    return false;
  }

  // `routePath` is the mount-relative path the router rewrote `req.url` to, so
  // re-prefixing it cannot produce a doubled prefix.
  const relative = String(routing?.routePath || req.path || '/');
  const target = `/${session}/accessible${relative.startsWith('/') ? relative : `/${relative}`}`;

  // 🔴 Deliberately NOT `res.redirect`. On a shared mount, tenant routing replaces
  // `res.redirect` with a wrapper that prefixes local paths with the CURRENT mount — so
  // `res.redirect('/community-a/accessible/dashboard')` while serving community B emits
  // `/community-b/accessible/community-a/accessible/dashboard`. That wrapper is correct
  // for ordinary redirects, which are mount-relative; this is the one case that needs to
  // leave the mount, so it sets the header directly.
  res.status(302).location(target).end();
  return true;
}

async function requireAuth(req, res, next) {
  await ensureAuthSession(req, res);
  const token = req.token || req.signedCookies.token;

  if (!token) {
    return redirectTo(res, AUTH_REQUIRED_LOGIN_PATH);
  }

  if (redirectForeignTenantMount(req, res)) {
    return undefined;
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
            if (refreshFailureClearsSession(req, refreshError)) {
              delete req.signedCookies.refresh_token;
              clearAuthCookies(res);
            }
            return redirectTo(res, AUTH_REQUIRED_LOGIN_PATH);
          }
        }

        // No refresh token - redirect to login. On another community's mount
        // the 401 is about that community, not this member's session (F-112).
        if (!isForeignCommunityRequest(req)) clearAuthCookies(res);
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
  normalizeAuthCookieNames,
  authCookieName,
  sessionCookieName,
  sessionEnvelope,
  jwtExpiresSoon
};
