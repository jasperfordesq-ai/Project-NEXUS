// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requestMessageAccess, withdrawMessageAccess } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { linkedAccountsRedirect, positiveInt } = require('../lib/linked-account-support');

/**
 * The two ends of the message-access consent loop.
 *
 * 🔴 The supporter ASKS; only the supported member's own yes grants anything.
 * The supported member WITHDRAWS in one press. There is deliberately no write
 * route for viewing under this prefix — viewing is a separate, purpose-gated
 * read, and access is never granted by a permission checkbox.
 */
const router = express.Router();

router.post('/request', asyncRoute(async (req, res) => {
  const relationshipId = positiveInt(req.body?.relationship_id);
  if (relationshipId <= 0) return linkedAccountsRedirect(res, 'link-failed', 'children');

  try {
    // Grants NOTHING on its own: the backend intercepts the tier write into a
    // pending consent action. Asking again while an ask is open is a no-op,
    // not a nag.
    await requestMessageAccess(req.token, relationshipId);
  } catch {
    return linkedAccountsRedirect(res, 'link-failed', 'children');
  }

  return linkedAccountsRedirect(res, 'message-access-requested', 'children');
}));

router.post('/withdraw', asyncRoute(async (req, res) => {
  const relationshipId = positiveInt(req.body?.relationship_id);
  if (relationshipId <= 0) return linkedAccountsRedirect(res, 'link-failed', 'parents');

  try {
    // Immediate, and no reason is asked. Re-enabling always needs fresh
    // consent, which is why there is no undo.
    await withdrawMessageAccess(req.token, relationshipId);
  } catch {
    return linkedAccountsRedirect(res, 'link-failed', 'parents');
  }

  return linkedAccountsRedirect(res, 'message-access-withdrawn', 'parents');
}));

module.exports = router;
