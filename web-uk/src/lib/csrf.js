// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { doubleCsrf } = require('csrf-csrf');

/**
 * CSRF protection (double-submit cookie via csrf-csrf).
 *
 * F-114: the token used to be bound to nothing but the server secret, so a
 * token/cookie pair minted in one browser session was accepted with any other
 * session, and the cookie had no `__Host-` prefix, so a sibling subdomain or a
 * plain-http response could plant one. Now:
 *
 *   - every token is bound to the express-session id (`getSessionIdentifier`),
 *     and the session is persisted whenever a token is issued so the id is
 *     stable for an anonymous visitor's next request;
 *   - production names the cookie `__Host-nexus.csrf` — Secure, Path=/ and no
 *     Domain, which is exactly what the browser requires of a `__Host-` cookie;
 *   - development and tests keep `nexus.csrf` without Secure so http works.
 */
function csrfCookieSettings(nodeEnv) {
  const production = nodeEnv === 'production';
  return {
    cookieName: production ? '__Host-nexus.csrf' : 'nexus.csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: production,
      path: '/',
      signed: true
    }
  };
}

function sessionIdentifier(req) {
  return String(req.sessionID || '');
}

function createCsrfProtection({ nodeEnv, getSecret }) {
  const { cookieName, cookieOptions } = csrfCookieSettings(nodeEnv);
  const { generateToken, doubleCsrfProtection: validate } = doubleCsrf({
    getSecret,
    getSessionIdentifier: sessionIdentifier,
    cookieName,
    cookieOptions,
    getTokenFromRequest: (req) => (req.body && req.body._csrf) || req.headers['x-csrf-token']
  });

  // One token per request. Every view and several routes ask for it, and each
  // fresh generation used to set another cookie, leaving the page's form with a
  // token that did not match the last cookie the browser kept.
  function csrfToken(req, res) {
    if (typeof req.nexusCsrfToken === 'string') return req.nexusCsrfToken;
    // A token is only valid for this session id, so the session must survive to
    // the next request (saveUninitialized is off, so mark it as used).
    if (req.session && !req.session.csrfBound) req.session.csrfBound = true;
    // overwrite=false reuses a valid cookie; validateOnReuse=false quietly
    // replaces one that belongs to an earlier session (expiry, sign-in rotation)
    // instead of turning an ordinary page view into an error.
    req.nexusCsrfToken = generateToken(req, res, false, false);
    return req.nexusCsrfToken;
  }

  function attachCsrfToken(req, res, next) {
    req.csrfToken = () => csrfToken(req, res);
    next();
  }

  // csrf-csrf replaces req.csrfToken with its own generator; put ours back so
  // routes behind the check keep the one-token-per-request behaviour above.
  function doubleCsrfProtection(req, res, next) {
    validate(req, res, (error) => {
      req.csrfToken = () => csrfToken(req, res);
      next(error);
    });
  }

  return { cookieName, csrfToken, attachCsrfToken, doubleCsrfProtection };
}

module.exports = { csrfCookieSettings, createCsrfProtection, sessionIdentifier };
