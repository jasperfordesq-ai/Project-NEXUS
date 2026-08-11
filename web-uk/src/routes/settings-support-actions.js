// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getSupportActions,
  confirmSupportAction,
  declineSupportAction,
  cancelSupportAction
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');

const router = express.Router();

/**
 * Co-decide support actions, both sides.
 *
 * A supporter PREPARES a listing or a transfer and nothing happens until the
 * supported member answers — here, from the emailed single-use link, or in the
 * React app. Members who never sign in are covered by the email route; this
 * page is for those who do.
 *
 * HTML-first: every answer is a plain form POST with the answer as a field, so
 * the page needs only submit buttons and no JavaScript.
 */

const ANSWERS = Object.freeze(['approve', 'decline', 'withdraw']);

const SUCCESS_STATES = Object.freeze(['support-approved', 'support-declined', 'support-withdrawn']);
const ERROR_STATES = Object.freeze(['support-not-found', 'support-failed']);
const STATUS_KEYS = Object.freeze({
  'support-approved': 'status_approved',
  'support-declined': 'status_declined',
  'support-withdrawn': 'status_withdrawn',
  'support-not-found': 'status_not_found',
  'support-failed': 'status_failed'
});

const STATE_TAG_CLASS = Object.freeze({
  confirmed: 'govuk-tag--green',
  declined: 'govuk-tag--red',
  pending: 'govuk-tag--yellow'
});

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

function actionsFrom(result) {
  const data = unwrap(result);
  return Array.isArray(data.actions) ? data.actions : [];
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function redirectToSupportActions(res, status) {
  return res.redirect(`${res.locals.urlFor('/settings/support-actions')}?status=${encodeURIComponent(status)}`);
}

router.get('/', asyncRoute(async (req, res) => {
  const locale = res.locals.locale || 'en';

  // One side failing must not blank the other: a member needs to see what they
  // have been asked to answer even if their own prepared actions fail to load.
  const [incomingResult, outgoingResult] = await Promise.all([
    getSupportActions(req.token, 'supported').catch(() => null),
    getSupportActions(req.token, 'supporter').catch(() => null)
  ]);

  const status = typeof req.query.status === 'string' ? req.query.status : null;

  return res.render('settings/support-actions', {
    title: res.locals.t('govuk_alpha_settings.support_actions.title'),
    activeNav: 'account',
    incoming: actionsFrom(incomingResult).map((action) => {
      const summary = action?.payload_summary && typeof action.payload_summary === 'object'
        ? action.payload_summary
        : {};
      return {
        ...action,
        id: positiveInt(action?.id),
        typeKey: `type_${action?.action_type || 'listing_create'}`,
        // Blade shows a title, or an amount for a transfer. `?? ` rather than
        // `||` so an amount of 0 is still shown rather than treated as absent.
        detail: summary.title ?? summary.amount ?? null,
        expiresOnLabel: action?.expires_at
          ? formatLocaleDate(action.expires_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
          : null
      };
    }),
    outgoing: actionsFrom(outgoingResult).map((action) => {
      const state = action?.status || 'pending';
      return {
        ...action,
        id: positiveInt(action?.id),
        state,
        stateTagClass: STATE_TAG_CLASS[state] || 'govuk-tag--grey',
        typeKey: `type_${action?.action_type || 'listing_create'}`
      };
    }),
    statusKey: status ? STATUS_KEYS[status] || null : null,
    statusIsSuccess: SUCCESS_STATES.includes(status),
    statusIsError: ERROR_STATES.includes(status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * One handler for approve, decline and withdraw. The decline reason is OPTIONAL
 * and never required — the same rule as refusing a guardian arrangement.
 */
router.post('/respond', asyncRoute(async (req, res) => {
  const actionId = positiveInt(req.body?.action_id);
  const answer = String(req.body?.answer ?? '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';

  if (actionId <= 0 || !ANSWERS.includes(answer)) {
    return redirectToSupportActions(res, 'support-failed');
  }

  try {
    if (answer === 'approve') {
      await confirmSupportAction(req.token, actionId);
    } else if (answer === 'decline') {
      await declineSupportAction(req.token, actionId, reason);
    } else {
      await cancelSupportAction(req.token, actionId);
    }
  } catch (error) {
    // Blade separates "that is not there" from a general failure, because an
    // action that has already been answered or expired is a different message
    // from something going wrong.
    return redirectToSupportActions(res, error?.status === 404 ? 'support-not-found' : 'support-failed');
  }

  return redirectToSupportActions(res, {
    approve: 'support-approved',
    decline: 'support-declined',
    withdraw: 'support-withdrawn'
  }[answer]);
}));

module.exports = router;
