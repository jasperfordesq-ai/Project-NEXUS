// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  ApiError,
  getMyVereinInvitations,
  respondToVereinInvitation
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const {
  INVITE_TAGS,
  dateLabel,
  forbidden,
  isForbidden,
  itemsFrom,
  positiveInt,
  rethrowAuth,
  trimmed,
  v,
  withStatus
} = require('../lib/verein-shared');

/**
 * Clubs (Verein): a member's own club invitations (`/me/verein-invitations`).
 * See `routes/verein.js` for the module overview.
 */

const router = express.Router();

// ---------------------------------------------------------------------------
// A member's own club invitations
// ---------------------------------------------------------------------------

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  let invitations = [];
  let loadFailed = false;
  try {
    invitations = itemsFrom(await getMyVereinInvitations(req.token)).map((invite) => {
      const status = trimmed(invite?.status, 32);
      return {
        id: positiveInt(invite?.id),
        status,
        statusLabel: ['sent', 'accepted', 'declined', 'expired'].includes(status)
          ? v(t, `invitations.status_${status}`)
          : status,
        statusTag: INVITE_TAGS[status] || 'govuk-tag--grey',
        targetName: trimmed(invite?.target_name) || v(t, 'unnamed_club'),
        inviterName: trimmed(invite?.inviter_name),
        sourceName: trimmed(invite?.source_name),
        message: trimmed(invite?.message, 500),
        expiresLabel: dateLabel(res, invite?.expires_at),
        canRespond: status === 'sent'
      };
    });
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    loadFailed = true;
  }

  const status = trimmed(req.query.status, 32);
  const flashed = req.session && typeof req.session.vereinError === 'string' ? req.session.vereinError : '';
  if (req.session) delete req.session.vereinError;
  return res.render('verein/invitations', {
    title: v(t, 'invitations.title'),
    activeNav: 'account',
    invitations,
    loadFailed,
    statusMessage: {
      accepted: { type: 'success', text: v(t, 'invitations.status_accepted') },
      declined: { type: 'success', text: v(t, 'invitations.status_declined') },
      failed: { type: 'error', text: flashed || v(t, 'invitations.respond_failed') }
    }[status] || null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:id(\\d+)/respond', asyncRoute(async (req, res) => {
  const id = positiveInt(req.params.id);
  const action = req.body?.action === 'accept' ? 'accept' : (req.body?.action === 'decline' ? 'decline' : '');
  if (!id || !action) return withStatus(res, '/me/verein-invitations', 'failed');
  if (req.session) delete req.session.vereinError;

  try {
    await respondToVereinInvitation(req.token, id, action);
  } catch (error) {
    rethrowAuth(error);
    // Laravel's refusal (an expired invitation, a safeguarding restriction) is
    // already in the member's language.
    if (error instanceof ApiError && error.status < 500 && req.session) {
      req.session.vereinError = trimmed(error.message, 300);
    }
    return withStatus(res, '/me/verein-invitations', 'failed');
  }
  return withStatus(res, '/me/verein-invitations', action === 'accept' ? 'accepted' : 'declined');
}));

// ---------------------------------------------------------------------------
// A member's own dues — view only; card payment is BLOCKED (see header)
// ---------------------------------------------------------------------------

module.exports = router;
