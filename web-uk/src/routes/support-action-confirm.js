// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  ApiError,
  getSupportActionByEmailToken,
  confirmSupportActionByEmailToken
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');

const router = express.Router();

/**
 * Supported decisions — the single-use link from the email
 * (React route `support-actions/confirm/:token`).
 *
 * A supporter prepared something on a member's behalf; nothing happens until the
 * member approves it. For a member who rarely signs in, the email IS the flow, so
 * this page needs no sign-in: the token in the address is the only authority,
 * exactly as on React.
 *
 * Opening the link changes nothing — the GET is Laravel's read-only lookup, and
 * only the form POST confirms. Declining is done by doing nothing (the request
 * expires) or from Settings, the same choice React offers.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const ACTION_TYPES = new Set(['listing_create', 'credit_transfer', 'message_access_grant']);

function unwrap(result) {
  return result && result.data && typeof result.data === 'object' ? result.data : (result || {});
}

function confirmPath(token, status) {
  const path = `/support-actions/confirm/${encodeURIComponent(token)}`;
  return status ? `${path}?status=${encodeURIComponent(status)}` : path;
}

function renderState(res, state, extra = {}) {
  const t = res.locals.t;
  return res.render('support-actions/confirm', {
    title: t('govuk_alpha_settings.support_confirm.page_title'),
    state,
    ...extra
  });
}

router.get('/:token([A-Za-z0-9_-]{8,255})', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!TOKEN_PATTERN.test(token)) {
    return renderState(res.status(404), 'error');
  }

  let details;
  try {
    details = unwrap(await getSupportActionByEmailToken(token));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return renderState(res.status(404), 'error');
    }
    return renderState(res.status(503), 'error');
  }

  const status = String(details.status || '');
  const queryStatus = typeof req.query.status === 'string' ? req.query.status : '';

  if (queryStatus === 'confirmed' && status === 'confirmed') {
    return renderState(res, 'success');
  }
  if (queryStatus === 'failed') {
    return renderState(res, 'error');
  }
  if (status !== 'pending') {
    return renderState(res, 'unavailable');
  }

  const actionType = ACTION_TYPES.has(details.action_type) ? details.action_type : 'listing_create';
  const summary = details.payload_summary && typeof details.payload_summary === 'object' ? details.payload_summary : {};
  const detail = actionType === 'credit_transfer'
    ? `${summary.amount ?? ''} → ${summary.recipient_name ?? ''} (#${summary.recipient_id ?? ''})`
    : String(summary.title || '');
  const locale = res.locals.locale || 'en';

  return renderState(res, 'confirm', {
    token,
    supporterName: String(details.supporter_name || ''),
    typeKey: `govuk_alpha_settings.support_actions.type_${actionType}`,
    detail,
    expiresOnLabel: details.expires_at
      ? formatLocaleDate(details.expires_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
      : '',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:token([A-Za-z0-9_-]{8,255})', asyncRoute(async (req, res) => {
  const token = String(req.params.token || '');
  if (!TOKEN_PATTERN.test(token)) {
    return renderState(res.status(404), 'error');
  }

  try {
    await confirmSupportActionByEmailToken(token);
  } catch {
    return res.redirect(res.locals.urlFor(confirmPath(token, 'failed')));
  }

  return res.redirect(res.locals.urlFor(confirmPath(token, 'confirmed')));
}));

module.exports = router;
