// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * A community paused for non-payment.
 *
 * Laravel says so two ways, and either is enough:
 *   - the tenant bootstrap carries `billing_paused: true` (the fact only; the
 *     reason is for the community's admins, never the public);
 *   - every member-side API call answers HTTP 403 with code COMMUNITY_PAUSED
 *     (app/Http/Middleware/CheckBillingLock.php). The bootstrap is cached for a
 *     short while on both sides, so the API usually closes first.
 *
 * The page this renders never says why the community is paused. Members are
 * not told it is about money, the same rule as React's CommunityPausedPage.
 *
 * Deliberately dependency-free at load time: many tests mock `./api` with
 * partial objects, and the API client itself requires this file.
 */

const { AsyncLocalStorage } = require('node:async_hooks');

const COMMUNITY_PAUSED_CODE = 'COMMUNITY_PAUSED';
const COMMUNITY_PAUSED_VIEW = 'errors/community-paused';
// A pause lasts until someone pays or a manager restores it: a day is a fair
// hint to a crawler, which must not replace what it holds with this page.
const RETRY_AFTER_SECONDS = '86400';

const refusalStorage = new AsyncLocalStorage();

function isCommunityPausedError(error) {
  if (!error || Number(error.status) !== 403) return false;
  const data = error.data && typeof error.data === 'object' ? error.data : {};
  const first = Array.isArray(data.errors) ? data.errors[0] : null;
  const code = String(data.code || (first && first.code) || '').trim().toUpperCase();
  return code === COMMUNITY_PAUSED_CODE;
}

/** Only an explicit `true`: an absent or odd value must not close a community. */
function isCommunityPausedTenant(tenant) {
  return Boolean(tenant && typeof tenant === 'object' && tenant.billing_paused === true);
}

/**
 * Run the rest of a request with a place to note a COMMUNITY_PAUSED refusal,
 * so the gate can show the paused page even when a route swallowed the error.
 */
function runWithPauseWatch(watch, callback) {
  return refusalStorage.run(watch, callback);
}

/** Called by the API client for every error it throws. */
function notePausedRefusal(error) {
  if (!isCommunityPausedError(error)) return;
  const watch = refusalStorage.getStore();
  if (watch) watch.refused = true;
}

function communityNameFor(req, res) {
  const tenant = req && req.accessibleRouting && req.accessibleRouting.tenant;
  return String(
    (tenant && tenant.name)
    || (res && res.locals && res.locals.tenantName)
    || (req && req.accessibleRouting && req.accessibleRouting.tenantSlug)
    || 'Project NEXUS'
  );
}

/**
 * Render the paused page. `render` is the response's render function to use;
 * the gate passes the one it wrapped, so this cannot loop through itself.
 */
function renderCommunityPaused(req, res, render = res.render.bind(res)) {
  const communityName = communityNameFor(req, res);
  const t = res.locals && typeof res.locals.t === 'function' ? res.locals.t : null;
  const title = t
    ? t('govuk_alpha.community_paused.title', { community: communityName })
    : `${communityName} is paused`;

  res.status(503);
  res.set('Retry-After', RETRY_AFTER_SECONDS);
  // A signed-in member's page must not be stored either; this one is the same
  // for everyone, but whether it carries a sign-out form is not.
  res.set('Cache-Control', 'private, no-store, max-age=0');
  return render(COMMUNITY_PAUSED_VIEW, {
    title,
    communityName,
    noIndex: true
  });
}

module.exports = {
  COMMUNITY_PAUSED_CODE,
  COMMUNITY_PAUSED_VIEW,
  RETRY_AFTER_SECONDS,
  isCommunityPausedError,
  isCommunityPausedTenant,
  notePausedRefusal,
  renderCommunityPaused,
  runWithPauseWatch
};
