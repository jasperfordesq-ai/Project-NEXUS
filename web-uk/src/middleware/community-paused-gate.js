// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const {
  COMMUNITY_PAUSED_VIEW,
  isCommunityPausedTenant,
  renderCommunityPaused,
  runWithPauseWatch
} = require('../lib/community-paused');

/**
 * Put the paused page in front of every member page of a paused community.
 *
 * Mounted after the shell locals (it needs `t`, `urlFor`, `csrfToken` and the
 * sign-in state) and before the feature gates and every router, so no member
 * page renders for a paused community.
 *
 * Laravel is the authority: it refuses every member-side call. This only shows
 * the member one honest page instead of a run of empty or error pages. When the
 * bootstrap is not yet saying "paused" (it is cached), a COMMUNITY_PAUSED
 * refusal from any API call made for the request swaps whatever the route
 * renders, including the empty state a route renders after swallowing it.
 *
 * Fails open: with no tenant resolved and no refusal seen, the request goes on.
 */

/**
 * Paths that keep working for a paused community, matched as prefixes. The
 * API keeps the same things open (CheckBillingLock): signing in, the second
 * sign-in step, password reset and signing out, so a member on a shared
 * computer can always leave, and the community's admins can get in.
 */
const OPEN_PREFIXES = [
  '/login',
  '/logout',
  '/password',
  '/session',
  '/cookie-consent',
  '/cookies',
  '/service-unavailable',
  '/health',
  '/version',
  '/assets',
  '/css',
  '/js',
  '/images',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/service-worker.js'
];

function isOpenPath(pathname) {
  const path = String(pathname || '/');
  return OPEN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function communityPausedGate(req, res, next) {
  if (isOpenPath(req.path)) {
    return next();
  }

  const render = res.render.bind(res);

  if (isCommunityPausedTenant(req.accessibleRouting && req.accessibleRouting.tenant)) {
    return renderCommunityPaused(req, res, render);
  }

  const watch = { refused: false };
  res.render = (view, options, callback) => {
    if (watch.refused && view !== COMMUNITY_PAUSED_VIEW) {
      return renderCommunityPaused(req, res, render);
    }
    return render(view, options, callback);
  };

  return runWithPauseWatch(watch, next);
}

module.exports = {
  communityPausedGate,
  isOpenPath
};
