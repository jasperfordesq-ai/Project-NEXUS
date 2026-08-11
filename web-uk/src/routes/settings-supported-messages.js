// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getChildAccounts,
  getSupportedConversations,
  getSupportedThread
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { linkedAccountsRedirect, positiveInt, supportedMemberName, unwrap } = require('../lib/linked-account-support');

/**
 * A supporter's READ-ONLY window onto a supported member's conversations.
 *
 * 🔴 Nothing is fetched until the supporter has stated WHY. The purpose is
 * written to an immutable audit row before any data is returned, and it is free
 * text that can quote a safeguarding concern about a named person.
 *
 * The purpose therefore lives in the SESSION with a 30-minute life, exactly as
 * the Blade page does, and reaches the API in the `X-Message-View-Purpose`
 * header. It never appears in a URL: URLs are written to server access logs,
 * browser history, `Referer` headers and shared screenshots.
 *
 * A viewer GET with no live session purpose renders the purpose form INSTEAD of
 * any messages — the form is the page, not an overlay on top of loaded data.
 */
const router = express.Router();

// Matches SettingsAuthParity::SETTINGS_MSG_VIEW_REASONS.
const REASONS = Object.freeze(['wellbeing', 'safety', 'helping_reply', 'other']);
const PURPOSE_TTL_MS = 30 * 60 * 1000;
const DETAIL_MAX = 300;

function purposeSessionKey(childUserId) {
  return `alpha_msg_view_purpose_${childUserId}`;
}

/** The live session purpose for this member, or null when absent or expired. */
function livePurpose(req, childUserId) {
  const stored = req.session?.[purposeSessionKey(childUserId)];
  if (!stored || typeof stored !== 'object') return null;

  const purpose = typeof stored.purpose === 'string' ? stored.purpose : '';
  const expires = Number(stored.expires) || 0;
  if (purpose.trim() === '' || expires < Date.now()) {
    if (req.session) delete req.session[purposeSessionKey(childUserId)];
    return null;
  }

  return purpose;
}

function renderPurposeForm(res, { childUserId, childName, partnerId }) {
  return res.render('settings/supported-messages-purpose', {
    title: res.locals.t('govuk_alpha_settings.linked_messages.purpose_title'),
    activeNav: 'account',
    childUserId,
    childName,
    partnerId: partnerId || null,
    reasons: REASONS,
    csrfToken: res.req.csrfToken ? res.req.csrfToken() : ''
  });
}

/**
 * Capture WHY, before anything is fetched. Stored in the session and never in
 * the query string.
 */
router.post('/:childId/purpose', asyncRoute(async (req, res) => {
  const childUserId = positiveInt(req.params.childId);
  if (childUserId <= 0) return linkedAccountsRedirect(res, 'message-view-denied');

  const rawReason = String(req.body?.reason ?? '');
  const reason = REASONS.includes(rawReason) ? rawReason : 'wellbeing';
  const detail = String(req.body?.detail ?? '').trim();

  let purpose = res.locals.t(`govuk_alpha_settings.linked_messages.reason_${reason}`);
  if (detail !== '') {
    purpose += ` — ${detail.slice(0, DETAIL_MAX)}`;
  }

  if (req.session) {
    req.session[purposeSessionKey(childUserId)] = { purpose, expires: Date.now() + PURPOSE_TTL_MS };
  }

  const partnerId = positiveInt(req.body?.partner_id);
  const target = partnerId > 0
    ? `/settings/linked-accounts/messages/${childUserId}/${partnerId}`
    : `/settings/linked-accounts/messages/${childUserId}`;

  return res.redirect(res.locals.urlFor(target));
}));

async function renderViewer(req, res, childUserId, partnerUserId) {
  if (childUserId <= 0) return linkedAccountsRedirect(res, 'message-view-denied');

  // The name is resolved from THIS user's own children list, so a member id
  // belonging to somebody else never yields one — and the service refuses it
  // regardless.
  let childName = null;
  try {
    childName = await supportedMemberName(getChildAccounts, req.token, childUserId);
  } catch {
    childName = null;
  }

  if (childName === null) return linkedAccountsRedirect(res, 'message-view-denied');

  const purpose = livePurpose(req, childUserId);
  if (purpose === null) {
    return renderPurposeForm(res, { childUserId, childName, partnerId: partnerUserId });
  }

  if (partnerUserId === null) {
    let payload;
    try {
      payload = unwrap(await getSupportedConversations(req.token, childUserId, purpose, {
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: 20
      }));
    } catch {
      return linkedAccountsRedirect(res, 'message-view-denied');
    }

    return res.render('settings/supported-messages', {
      title: res.locals.t('govuk_alpha_settings.linked_messages.title', { name: childName }),
      activeNav: 'account',
      childUserId,
      childName,
      conversations: Array.isArray(payload.conversations) ? payload.conversations : [],
      nextCursor: payload.has_more ? (payload.cursor || null) : null
    });
  }

  let payload;
  try {
    payload = unwrap(await getSupportedThread(req.token, childUserId, partnerUserId, purpose));
  } catch {
    return linkedAccountsRedirect(res, 'message-view-denied');
  }

  return res.render('settings/supported-messages-thread', {
    title: res.locals.t('govuk_alpha_settings.linked_messages.title', { name: childName }),
    activeNav: 'account',
    childUserId,
    childName,
    partnerUserId,
    messages: Array.isArray(payload.items) ? payload.items : []
  });
}

router.get('/:childId', asyncRoute(async (req, res) => (
  renderViewer(req, res, positiveInt(req.params.childId), null)
)));

router.get('/:childId/:partnerId', asyncRoute(async (req, res) => (
  renderViewer(req, res, positiveInt(req.params.childId), positiveInt(req.params.partnerId))
)));

module.exports = router;
