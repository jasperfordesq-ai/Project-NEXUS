// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * A safeguarding report's own page, for the member who made it.
 *
 *   GET  /volunteering/incidents/:id            — the report, its plain status and history
 *   POST /volunteering/incidents/:id/additions  — add information while it is not closed
 *
 * The API decides who may see a report and sends only the reporter's own view: the
 * team's notes, the reasons for decisions and the organisation's messages never reach
 * this page. Anyone else's report is "not found".
 *
 * Mounted before routes/volunteering-actions.js, which keeps the list and the report
 * form at /volunteering/incidents.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');

const router = express.Router();

/** Information added later must say something; the API enforces the same limits. */
const ADDITION_MIN = 20;
const ADDITION_MAX = 5000;

/** Plain words for a status, as the member sees it. */
const MEMBER_STATUS = {
  open: 'received',
  investigating: 'looking_into',
  escalated: 'specialist',
  resolved: 'dealt_with',
  closed: 'closed'
};

const EVENT_LABELS = {
  reported: 'timeline_reported',
  status_changed: 'timeline_status_changed',
  message_to_reporter: 'timeline_message_from_team',
  reporter_addition: 'timeline_your_addition'
};

/** `?status=` values this page understands. */
const STATUSES = {
  'incident-reported': { type: 'success', key: 'report_sent_reference' },
  'information-added': { type: 'success', key: 'report_added' },
  'addition-too-short': { type: 'error', key: 'report_add_too_short', field: 'body' },
  'report-closed': { type: 'error', key: 'report_closed_message' },
  'addition-failed': { type: 'error', key: 'report_add_failed', field: 'body' }
};

const KEY = 'govuk_alpha_volunteering.safeguarding.';

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function redirectTo(res, pathname) {
  const target = res.locals && typeof res.locals.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
  return res.redirect(target);
}

function memberStatusLabel(t, status) {
  return t(`${KEY}member_status_${MEMBER_STATUS[status] || 'received'}`);
}

function replayKey(id) {
  return `incident-addition-${id}`;
}

/** The parts of the API's reporter view this page shows, and nothing else. */
function presentReport(data, t, formatDate) {
  const report = data && typeof data === 'object' ? data : {};
  const status = typeof report.status === 'string' ? report.status : 'open';
  const timeline = (Array.isArray(report.timeline) ? report.timeline : [])
    .filter((event) => event && Object.hasOwn(EVENT_LABELS, event.type))
    .map((event) => ({
      label: t(KEY + EVENT_LABELS[event.type]),
      detail: event.type === 'status_changed' && event.to ? memberStatusLabel(t, event.to) : '',
      body: typeof event.body === 'string' ? event.body : '',
      dateLabel: formatDate(event.created_at)
    }))
    .reverse();

  return {
    id: Number(report.id) || 0,
    title: String(report.title || ''),
    description: String(report.description || ''),
    status,
    statusLabel: memberStatusLabel(t, status),
    isFinished: status === 'resolved' || status === 'closed',
    canAdd: report.can_add === true,
    facts: [
      [t(`${KEY}incident_type_label`), report.type ? t(`${KEY}incident_type_${report.type}`) : ''],
      [t(`${KEY}incident_date_label`), formatDate(report.incident_date)],
      [t(`${KEY}incident_organisation_label`), report.organization_name || ''],
      [t(`${KEY}incident_opportunity_label`), report.opportunity_title || ''],
      [t(`${KEY}report_about_label`), report.subject_name || '']
    ].filter(([, value]) => value),
    timeline
  };
}

router.get('/incidents/:id(\\d+)', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const t = res.locals.t;
  const formatDate = (value) => (value ? String(res.locals.formatLocaleDate(value) || value) : '');

  let result;
  try {
    result = await callVolunteeringApi(token, 'GET', `/incidents/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      return res.status(404).render('errors/404', { title: t(`${KEY}report_not_found`) });
    }
    throw error;
  }

  const report = presentReport(result && result.data !== undefined ? result.data : result, t, formatDate);
  const statusKey = typeof req.query.status === 'string' ? req.query.status : '';
  const known = Object.hasOwn(STATUSES, statusKey) ? STATUSES[statusKey] : null;
  const replay = consumeFormReplay(req, 'volunteering', replayKey(id)) || {};

  return res.render('volunteering/incident-report', {
    title: t(`${KEY}report_page_title`),
    report,
    status: known ? { ...known, message: t(KEY + known.key, { id }) } : null,
    additionBody: typeof replay.body === 'string' ? replay.body : '',
    additionMax: ADDITION_MAX
  });
}));

router.post('/incidents/:id(\\d+)/additions', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const body = String((req.body && req.body.body) || '').trim().slice(0, ADDITION_MAX);
  const back = (status, anchor = '') => redirectTo(res, `/volunteering/incidents/${id}?status=${status}${anchor}`);

  if (body.length < ADDITION_MIN) {
    rememberFormReplay(req, 'volunteering', replayKey(id), { body });
    return back('addition-too-short', '#body');
  }

  try {
    await callVolunteeringApi(token, 'POST', `/incidents/${encodeURIComponent(id)}/additions`, { body });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && error.status === 409) return back('report-closed');
    rememberFormReplay(req, 'volunteering', replayKey(id), { body });
    if (error instanceof ApiError && error.status === 422) return back('addition-too-short', '#body');
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: res.locals.t(`${KEY}report_not_found`) });
    }
    return back('addition-failed', '#body');
  }

  return back('information-added');
}));

module.exports = router;
