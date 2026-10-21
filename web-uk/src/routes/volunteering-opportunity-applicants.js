// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Who applied to one opportunity, for the people who run it (parity gap 4, 21 Oct 2026).
 * The website shows these on the opportunity's own page (OpportunityDetailPage.tsx,
 * "Applications"); the accessible site had only the organisation-wide review list, so an
 * organiser with several opportunities could not see one opportunity's applicants.
 *
 *   GET   /volunteering/opportunities/:id/applications?show=pending|approved|declined|all
 *   POST  /volunteering/opportunities/:id/applications/:appId    approve or decline, with a note
 *
 * API: GET /v2/volunteering/opportunities/{id}/applications (status, cursor, per_page)
 * → { items: [{ id, status, message, org_note, user, shift, created_at }], cursor, has_more },
 * and PUT /v2/volunteering/applications/{id} { action, org_note? } for the decision, the
 * same call the organisation review list makes. The API decides who may see the list
 * (403 otherwise) and enforces a community's "note required when declining" rule, whose
 * message is shown as the API words it.
 *
 * Not built here: the website's tick-several-and-approve-all and its search of the loaded
 * names. Each application is decided on its own, as on the organisation review list.
 *
 * Mounted before routes/volunteering-actions.js, which owns the volunteer's apply action
 * under the same opportunity path.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.opp_applicants.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'opportunityApplicants';
const FILTERS = ['pending', 'approved', 'declined', 'all'];
const NOTE_MAX = 1000;

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function redirectTo(res, pathname) {
  const target = res.locals && typeof res.locals.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
  return res.redirect(target);
}

function trimmed(value, limit = 200) {
  return String(value ?? '').trim().slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function apiFirstError(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return errors[0] && typeof errors[0] === 'object' ? errors[0] : {};
}

function errorPage(res, status) {
  const titles = { 403: 'error_pages.403_title', 404: 'error_pages.404_title' };
  return res.status(status).render(`errors/${status}`, { title: res.locals.t(titles[status]) });
}

/** "YYYY-MM-DD HH:mm:ss" (the platform's wall-clock time, UTC) as an epoch, or null. */
function wallClock(value) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])) : null;
}

function dayLabel(epoch) {
  return epoch === null ? '' : new Intl.DateTimeFormat(getRequestIntlLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(epoch));
}

function dateLabel(epoch) {
  return epoch === null ? '' : new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(epoch));
}

/** A shift's day and times in the member's language, e.g. "Saturday 14 March 2099, 09:00–12:00". */
function shiftWhen(start, end) {
  if (start === null) return '';
  const format = new Intl.DateTimeFormat(getRequestIntlLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  });
  return end === null || end < start ? dayLabel(start) : format.formatRange(new Date(start), new Date(end));
}

function listPath(id, show, outcome) {
  const query = new URLSearchParams();
  if (show && show !== 'pending') query.set('show', show);
  if (outcome) query.set('status', outcome);
  const text = query.toString();
  return `/volunteering/opportunities/${id}/applications${text ? `?${text}` : ''}`;
}

function presentApplication(raw, t) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const user = row.user && typeof row.user === 'object' ? row.user : {};
  const shift = row.shift && typeof row.shift === 'object' ? row.shift : null;
  const start = shift ? wallClock(shift.start_time) : null;
  const end = shift ? wallClock(shift.end_time) : null;
  const status = trimmed(row.status, 40) || 'pending';
  return {
    id: positiveInteger(row.id),
    status,
    statusLabel: t(`volunteering.status_values.${status}`),
    statusClass: status === 'approved' ? 'govuk-tag--green' : 'govuk-tag--grey',
    applicant: { id: positiveInteger(user.id), name: trimmed(user.name) || t('members.unknown_member') },
    message: trimmed(row.message, 2000),
    orgNote: trimmed(row.org_note, NOTE_MAX),
    shiftLabel: shiftWhen(start, end),
    appliedLabel: dateLabel(wallClock(row.created_at))
  };
}

const OUTCOMES = {
  'application-approved': ['success', 'govuk_alpha.vol_org.states.application-approved'],
  'application-declined': ['success', 'govuk_alpha.vol_org.states.application-declined'],
  'application-failed': ['error', 'govuk_alpha.vol_org.states.application-failed'],
  'application-safeguarding-restricted': ['error', 'safeguarding.errors.interaction_not_allowed'],
  'application-safeguarding-unavailable': ['error', 'safeguarding.errors.policy_unavailable']
};

router.get('/opportunities/:id(\\d+)/applications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const id = Number(req.params.id);
  const show = FILTERS.includes(trimmed(req.query.show)) ? trimmed(req.query.show) : 'pending';
  const cursor = trimmed(req.query.cursor, 200);
  const params = new URLSearchParams({ per_page: '20' });
  if (show !== 'all') params.set('status', show);
  if (cursor) params.set('cursor', cursor);

  let opportunity;
  let data;
  try {
    opportunity = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(id)}`)) || {};
    if (opportunity.can_manage !== true && opportunity.is_owner !== true) return errorPage(res, 403);
    data = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(id)}/applications?${params.toString()}`)) || {};
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return errorPage(res, 403);
    if (isStatus(error, 404)) return errorPage(res, 404);
    throw error;
  }

  const known = OUTCOMES[trimmed(req.query.status)] || null;
  // A refusal the API worded itself (a note required when declining, say) reads better than "could not".
  const refusal = consumeFormReplay(req, REPLAY, `opportunity-${id}`);
  let outcome = null;
  if (known) {
    const message = known[0] === 'error' && refusal && typeof refusal.message === 'string' && refusal.message
      ? refusal.message
      : t(known[1]);
    outcome = { type: known[0], message };
  }
  const nextCursor = data.has_more === true ? trimmed(data.cursor, 200) : '';
  const nextQuery = new URLSearchParams();
  if (show !== 'pending') nextQuery.set('show', show);
  if (nextCursor) nextQuery.set('cursor', nextCursor);

  return res.render('volunteering/opportunity-applicants', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    opportunityId: id,
    opportunityTitle: trimmed(opportunity.title, 300),
    show,
    filters: FILTERS.map((value) => ({
      value,
      label: value === 'all' ? t('volunteering.application_status_all') : t(`volunteering.status_values.${value}`),
      href: listPath(id, value),
      current: value === show
    })),
    applications: (Array.isArray(data.items) ? data.items : []).map((row) => presentApplication(row, t)).filter((row) => row.id),
    nextHref: nextCursor ? `/volunteering/opportunities/${id}/applications?${nextQuery.toString()}` : '',
    emptyMessage: t(show === 'all' ? `${KEY}none_yet` : `${KEY}none_filtered`),
    outcome,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/applications/:appId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const appId = Number(req.params.appId);
  const action = trimmed(req.body && req.body.action) === 'decline' ? 'decline' : 'approve';
  const show = FILTERS.includes(trimmed(req.body && req.body.show)) ? trimmed(req.body.show) : 'pending';
  const note = trimmed(req.body && req.body.org_note, NOTE_MAX);

  try {
    await callVolunteeringApi(token, 'PUT', `/applications/${encodeURIComponent(appId)}`, {
      action,
      ...(note ? { org_note: note } : {})
    });
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403) && ['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(trimmed(apiFirstError(error).code).toUpperCase())) {
      return redirectTo(res, listPath(id, show, 'application-safeguarding-restricted'));
    }
    if (trimmed(apiFirstError(error).code).toUpperCase() === 'SAFEGUARDING_POLICY_UNAVAILABLE') {
      return redirectTo(res, listPath(id, show, 'application-safeguarding-unavailable'));
    }
    if (isStatus(error, 403)) return errorPage(res, 403);
    const message = (isStatus(error, 400) || isStatus(error, 422) || isStatus(error, 409)) ? trimmed(apiFirstError(error).message, 500) : '';
    if (message) rememberFormReplay(req, REPLAY, `opportunity-${id}`, { message });
    return redirectTo(res, listPath(id, show, 'application-failed'));
  }
  return redirectTo(res, listPath(id, show, action === 'approve' ? 'application-approved' : 'application-declined'));
}, { redirectOn401: LOGIN }));

module.exports = router;
