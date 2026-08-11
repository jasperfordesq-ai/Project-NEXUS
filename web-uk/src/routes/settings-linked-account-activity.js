// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getChildAccounts, getChildActivity } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const {
  linkedAccountsRedirect,
  positiveInt,
  supportedMemberName,
  unwrap
} = require('../lib/linked-account-support');

/**
 * Read-only activity summary for a supported member.
 *
 * 🔴 Read-only in the strict sense: there is no action on this page. The grant
 * behind it is re-checked by the service on every request, and a member id that
 * is not on this user's own list never gets past the name lookup.
 *
 * Mounted at `/settings/linked-accounts/activity` rather than at
 * `/settings/linked-accounts`, deliberately: mounting at the parent would put
 * this router's middleware in front of the existing hub page.
 */
const router = express.Router();

router.get('/:childId', asyncRoute(async (req, res) => {
  const childUserId = positiveInt(req.params.childId);
  if (childUserId <= 0) return linkedAccountsRedirect(res, 'activity-denied');

  let childName = null;
  try {
    childName = await supportedMemberName(getChildAccounts, req.token, childUserId);
  } catch {
    childName = null;
  }

  let summary = null;
  if (childName !== null) {
    try {
      summary = unwrap(await getChildActivity(req.token, childUserId));
    } catch {
      summary = null;
    }
  }

  // "Not yours" and "no grant" are deliberately the same outcome, so this page
  // cannot be used to probe whether a given member exists.
  if (summary === null || childName === null || Object.keys(summary).length === 0) {
    return linkedAccountsRedirect(res, 'activity-denied');
  }

  const section = (key) => (summary[key] && typeof summary[key] === 'object' ? summary[key] : null);

  return res.render('settings/linked-account-activity', {
    title: res.locals.t('govuk_alpha_settings.linked.activity_title', { name: childName }),
    activeNav: 'account',
    childName,
    hours: section('hours'),
    connections: section('connections'),
    engagement: section('engagement'),
    timeline: (Array.isArray(summary.timeline) ? summary.timeline : []).slice(0, 10)
  });
}));

module.exports = router;
