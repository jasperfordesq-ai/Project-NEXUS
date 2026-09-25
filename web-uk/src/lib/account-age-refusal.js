// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Project NEXUS is for adults aged 18 and over (owner decision, 25 September 2026).
 *
 * Laravel refuses an account whose recorded date of birth is under 18 — at sign-in
 * and on EVERY authenticated request made with an existing session of such an
 * account — with HTTP 403 and `errors[0].code === 'ACCOUNT_UNDER_MINIMUM_AGE'`.
 *
 * web-uk treats that refusal as "signed out": the session can never do anything
 * again, so showing a bare 403 page on every click would strand the member. This
 * module is the one place that recognises the refusal and ends the session, so
 * the shared session layer (server.js per-request middleware, the token refresh,
 * and the shared route-error helper) all behave the same way.
 *
 * Deliberately dependency-free at load time (no `instanceof ApiError`, lazy
 * requires): many tests mock `../lib/api` and `../middleware/auth` with partial
 * objects, and this must not break them.
 */

const ACCOUNT_UNDER_MINIMUM_AGE_CODE = 'ACCOUNT_UNDER_MINIMUM_AGE';
const ACCOUNT_UNDER_MINIMUM_AGE_STATUS = 'account-under-minimum-age';
const ACCOUNT_UNDER_MINIMUM_AGE_LOGIN_PATH = `/login?status=${ACCOUNT_UNDER_MINIMUM_AGE_STATUS}`;

function isAccountUnderMinimumAgeError(error) {
  if (!error || Number(error.status) !== 403) return false;
  const data = error.data && typeof error.data === 'object' ? error.data : {};
  const first = Array.isArray(data.errors) ? data.errors[0] : null;
  const code = String((first && first.code) || data.code || '').trim().toUpperCase();
  return code === ACCOUNT_UNDER_MINIMUM_AGE_CODE;
}

/**
 * End the local session the way sign-out does (forget cached user data, destroy
 * the express session, clear the sign-in cookies) and send the member to the
 * sign-in page, which explains why. No logout call is made to Laravel: it refuses
 * every request from this account, and the account cannot sign in again anyway.
 */
function endUnderAgeSession(req, res) {
  const token = req && req.signedCookies ? req.signedCookies.token : '';
  try {
    const { invalidateUserCache } = require('./api');
    if (token && typeof invalidateUserCache === 'function') invalidateUserCache(token);
  } catch {
    // Cache eviction is best effort; the cookies below are what end the session.
  }

  if (req && req.flash) {
    req.flash('success');
    req.flash('error');
  }
  if (req && req.session && typeof req.session.destroy === 'function') {
    req.session.destroy(() => {});
  }
  if (req && req.signedCookies) {
    delete req.signedCookies.token;
    delete req.signedCookies.refresh_token;
  }
  if (req) delete req.token;

  const { clearAuthCookies } = require('../middleware/auth');
  if (typeof clearAuthCookies === 'function') clearAuthCookies(res);

  const urlFor = res && res.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  return res.redirect(urlFor(ACCOUNT_UNDER_MINIMUM_AGE_LOGIN_PATH));
}

module.exports = {
  ACCOUNT_UNDER_MINIMUM_AGE_CODE,
  ACCOUNT_UNDER_MINIMUM_AGE_STATUS,
  ACCOUNT_UNDER_MINIMUM_AGE_LOGIN_PATH,
  isAccountUnderMinimumAgeError,
  endUnderAgeSession
};
