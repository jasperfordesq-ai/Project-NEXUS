// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * POST /session/touch — "the member is still here".
 *
 * public/js/timeout-warning.js sends it while the member is active, and from
 * the timeout warning's "Stay signed in" button. It keeps this site's own
 * session rolling, and (E-119 F-608, 30 Oct 2026) tells the main server too:
 * the server now ends a session idle past the community's inactivity timeout,
 * and a member reading or typing makes no other request it can see.
 *
 * 🔴 Never assign to req.session.touch — that name shadows express-session's
 * own Session.prototype.touch() METHOD (tests/session-touch.test.js).
 */

const { ApiError, recordSessionActivity } = require('./api');
const { clearAuthCookies } = require('../middleware/auth');

const SIGNED_OUT = { ok: false, signedOut: true };

async function handleSessionTouch(req, res) {
  if (req.session) {
    req.session.lastTouchedAt = Date.now();
  }

  // The renewal on this very request was refused (for example for inactivity):
  // the member is signed out, and the warning must not say otherwise.
  if (req.authSessionEnded) {
    return res.status(401).json(SIGNED_OUT);
  }

  if (req.token) {
    try {
      await recordSessionActivity(req.token);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearAuthCookies(res);
        return res.status(401).json(SIGNED_OUT);
      }
      // A brief outage of the main server must not sign the member out; the
      // next touch or page load records the activity.
    }
  }

  return res.json({ ok: true });
}

module.exports = { handleSessionTouch };
