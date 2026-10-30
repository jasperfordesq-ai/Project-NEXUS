// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How long a signed-in member may be idle before this site signs them out.
 *
 * It follows the community's "Inactivity timeout (minutes)" setting
 * (`settings.inactivity_timeout_minutes` in the tenant bootstrap), the one the
 * main website enforces in react-frontend/src/hooks/useIdleLogout.ts. Until
 * 30 Oct 2026 this site ignored it and always used 30 minutes (AWID pilot).
 *
 * Rules, matching React and the admin screen (AdminConfigController):
 *   - 5–480 minutes: that timeout (larger values are capped at 480);
 *   - 0: the community turned automatic sign-out off. The bootstrap sends a
 *     stored '0' as `false`, so false means off too;
 *   - not set, or unusable: this site's existing 30-minute default. (React's
 *     default is off; this site's has always been 30 and stays 30.)
 *
 * The session cookie's lifetime is the server side of the timeout; the page
 * passes the same number to public/js/timeout-warning.js, which warns the
 * member and signs them out. With the timeout off, the cookie lasts until the
 * browser closes and the warning script is not loaded.
 */

const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
const MIN_SESSION_TIMEOUT_MINUTES = 5;
const MAX_SESSION_TIMEOUT_MINUTES = 480;

function sessionTimeoutMinutesFor(tenant) {
  const settings = tenant && typeof tenant.settings === 'object' && tenant.settings ? tenant.settings : {};
  const raw = settings.inactivity_timeout_minutes;
  if (raw === false) return 0;
  if (raw === null || raw === undefined || typeof raw === 'boolean' || raw === '') {
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes)) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  if (minutes === 0) return 0;
  if (minutes < MIN_SESSION_TIMEOUT_MINUTES) return DEFAULT_SESSION_TIMEOUT_MINUTES;
  return Math.min(Math.floor(minutes), MAX_SESSION_TIMEOUT_MINUTES);
}

/**
 * Express middleware: mount after express-session and tenant routing. Sets the
 * (rolling) session cookie lifetime for this request and the two view locals
 * the layout reads.
 */
function applyTenantSessionTimeout(req, res, next) {
  const minutes = sessionTimeoutMinutesFor(req.accessibleRouting && req.accessibleRouting.tenant);
  if (req.session && req.session.cookie) {
    req.session.cookie.maxAge = minutes > 0 ? minutes * 60 * 1000 : null;
  }
  res.locals.sessionTimeout = minutes > 0 ? minutes : null;
  res.locals.sessionTimeoutDisabled = minutes === 0;
  next();
}

module.exports = {
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  sessionTimeoutMinutesFor,
  applyTenantSessionTimeout
};
