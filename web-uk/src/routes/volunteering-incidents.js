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
 * and, for an organisation's owner, administrators and safeguarding lead:
 *
 *   GET  /volunteering/organisations/:id/safeguarding                    — reports linked to it
 *   GET  /volunteering/organisations/:id/safeguarding/:incidentId         — one report
 *   POST /volunteering/organisations/:id/safeguarding/:incidentId/updates — tell the team
 *
 * The API decides who may see a report and sends only that viewer's part of it: the
 * reporter never sees the team's notes or the organisation's messages; the organisation
 * sees a summary, and its lead the full report only while the team shares it — never
 * who made it. The organisation pages copy only the fields they show, so a reporter's
 * name could not appear even if a response carried one. A report the caller may not
 * see is "not found".
 *
 * Mounted before routes/volunteering-actions.js, which keeps the list and the report
 * form at /volunteering/incidents.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { parseApiInstant } = require('../lib/api-instant');

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
      [t(`${KEY}report_fact_kind`), report.type ? t(`${KEY}incident_type_${report.type}`) : ''],
      [t(`${KEY}report_fact_date`), formatDate(report.incident_date)],
      [t(`${KEY}report_fact_organisation`), report.organization_name || ''],
      [t(`${KEY}report_fact_opportunity`), report.opportunity_title || ''],
      [t(`${KEY}report_fact_person`), report.subject_name || '']
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

// ── The organisation the report is linked to ─────────────────────────────────

const ORG_KEY = 'govuk_alpha_volunteering.org_safeguarding.';

const ORG_EVENT_LABELS = {
  reported: 'timeline_reported',
  status_changed: 'timeline_status_changed',
  message_to_organisation: 'message_from_team',
  org_update: 'timeline_org_update',
  reporter_addition: 'timeline_reporter_addition',
  shared_with_organisation: 'timeline_shared',
  share_withdrawn: 'timeline_share_withdrawn'
};

const ORG_STATUSES = {
  'update-sent': { type: 'success', key: 'update_sent' },
  'update-too-short': { type: 'error', key: 'update_too_short', field: 'body' },
  'update-failed': { type: 'error', key: 'update_failed', field: 'body' },
  // The API refuses an update on a closed report (409). The form is hidden on a
  // closed report, so this only happens when it closed while the page was open.
  'report-closed': { type: 'error', key: 'closed_no_updates', field: 'closed' }
};

/** The statuses an organisation can see, in the order a report moves through them. */
const ORG_STATUS_ORDER = ['open', 'investigating', 'escalated', 'resolved', 'closed'];

/** One plain sentence on what a status means for the organisation (React's status_help). */
function orgStatusHelp(t, status) {
  return t(`${ORG_KEY}status_help_${ORG_STATUS_ORDER.includes(status) ? status : 'open'}`);
}

function orgReplayKey(orgId, incidentId) {
  return `org-incident-update-${orgId}-${incidentId}`;
}

function dateFormatter(res) {
  return (value) => (value ? String(res.locals.formatLocaleDate(value) || value) : '');
}

/** Only the summary fields the organisation may see. */
function presentOrgSummary(row, t, formatDate) {
  const item = row && typeof row === 'object' ? row : {};
  const status = typeof item.status === 'string' ? item.status : 'open';
  return {
    id: Number(item.id) || 0,
    kindLabel: t(`${KEY}incident_type_${typeof item.type === 'string' ? item.type : 'other'}`),
    severityLabel: t(`${KEY}severity_${typeof item.severity === 'string' ? item.severity : 'medium'}`),
    status,
    statusLabel: memberStatusLabel(t, status),
    statusHelp: orgStatusHelp(t, status),
    // "Still open" as React counts it: anything the team has not dealt with or closed.
    isOpen: status !== 'resolved' && status !== 'closed',
    isClosed: status === 'closed',
    dateLabel: formatDate(item.incident_date || item.created_at),
    opportunityTitle: typeof item.opportunity_title === 'string' ? item.opportunity_title : '',
    fullReportShared: item.full_report_shared === true
  };
}

function presentOrgDetail(row, t, formatDate) {
  const item = row && typeof row === 'object' ? row : {};
  const shared = item.full_report_shared === true;
  const timeline = (Array.isArray(item.timeline) ? item.timeline : [])
    .filter((event) => event && Object.hasOwn(ORG_EVENT_LABELS, event.type))
    .map((event) => ({
      label: t(ORG_KEY + ORG_EVENT_LABELS[event.type]),
      detail: event.type === 'status_changed' && event.to ? memberStatusLabel(t, event.to) : '',
      body: typeof event.body === 'string' ? event.body : '',
      // The organisation's own updates name who in the organisation wrote them.
      actorName: event.type === 'org_update' && typeof event.actor_name === 'string' ? event.actor_name : '',
      dateLabel: formatDate(event.created_at)
    }))
    .reverse();

  return {
    ...presentOrgSummary(item, t, formatDate),
    fullReport: shared ? {
      title: String(item.title || ''),
      description: String(item.description || ''),
      subjectName: typeof item.subject_name === 'string' ? item.subject_name : ''
    } : null,
    timeline
  };
}

function orgIncidentNotFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t(`${ORG_KEY}not_found`) });
}

const WB_KEY = 'govuk_alpha_volunteering.org_wellbeing.';
const WB_STATUS_KEYS = { active: 'status_active', acknowledged: 'status_acknowledged', resolved: 'status_resolved', dismissed: 'status_dismissed' };

/** One wellbeing row for the organisation: who, how they feel, when, and whether the organisation was told. Never the note. */
function presentOrgWellbeing(row, t, formatDate) {
  const item = row && typeof row === 'object' ? row : {};
  const volunteer = item.volunteer && typeof item.volunteer === 'object' ? item.volunteer : {};
  const status = typeof item.status === 'string' && Object.hasOwn(WB_STATUS_KEYS, item.status) ? item.status : 'active';
  return {
    id: Number(item.alert_id) || 0,
    volunteerId: Number(volunteer.id) || 0,
    volunteerName: typeof volunteer.name === 'string' ? volunteer.name : '',
    moodLabel: t(`${WB_KEY}${Number(item.mood) === 1 ? 'mood_struggling' : 'mood_low'}`),
    checkinLabel: formatDate(item.checkin_at),
    toldLabel: parseApiInstant(item.told_at) ? formatDate(item.told_at) : t(`${WB_KEY}not_told`),
    statusLabel: t(`${WB_KEY}${WB_STATUS_KEYS[status]}`),
    isOpen: status === 'active' || status === 'acknowledged'
  };
}

/**
 * Organisation dashboard: the volunteers who said they are low or struggling and
 * asked for someone to get in touch (20 Oct 2026). Same audience as the safeguarding
 * list — the API answers 403 for anyone who is not an owner, admin or safeguarding lead.
 */
router.get('/organisations/:id(\\d+)/wellbeing', asyncRoute(async (req, res) => {
  const orgId = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const t = res.locals.t;

  let result;
  try {
    result = await callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/wellbeing`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: t(`${WB_KEY}forbidden`) });
    }
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: t(`${WB_KEY}not_found`) });
    }
    throw error;
  }

  const data = result && result.data !== undefined ? result.data : result;
  const rows = data && Array.isArray(data.items) ? data.items : [];
  // Wellbeing times are moments (21 Oct 2026): the bare database form is UTC, an ISO
  // time carries its offset. Both are read by parseApiInstant and shown in UTC with
  // the zone named, because a server-rendered page cannot know the reader's zone.
  // `new Date('2026-10-20 12:05:22')` would have read the bare form as the server's
  // local time.
  const formatDate = (value) => {
    const date = parseApiInstant(value);
    return date
      ? String(res.locals.formatLocaleDate(date, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }) || '')
      : '';
  };
  const items = rows.map((row) => presentOrgWellbeing(row, t, formatDate)).filter((row) => row.id > 0);
  return res.render('volunteering/organisation-wellbeing', {
    title: t(`${WB_KEY}title`),
    orgId,
    items,
    openCount: items.filter((row) => row.isOpen).length
  });
}));

router.get('/organisations/:id(\\d+)/safeguarding', asyncRoute(async (req, res) => {
  const orgId = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const t = res.locals.t;

  let result;
  try {
    result = await callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/incidents`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && error.status === 403) {
      return res.status(403).render('errors/403', { title: t(`${ORG_KEY}forbidden`) });
    }
    if (error instanceof ApiError && error.status === 404) return orgIncidentNotFound(res);
    throw error;
  }

  const data = result && result.data !== undefined ? result.data : result;
  const rows = data && Array.isArray(data.items) ? data.items : [];
  const formatDate = dateFormatter(res);
  const items = rows.map((row) => presentOrgSummary(row, t, formatDate)).filter((row) => row.id > 0);
  return res.render('volunteering/organisation-safeguarding', {
    title: t(`${ORG_KEY}title`),
    orgId,
    items,
    openCount: items.filter((item) => item.isOpen).length,
    statusGuide: ORG_STATUS_ORDER.map((status) => ({
      label: memberStatusLabel(t, status),
      help: orgStatusHelp(t, status)
    }))
  });
}));

router.get('/organisations/:id(\\d+)/safeguarding/:incidentId(\\d+)', asyncRoute(async (req, res) => {
  const orgId = Number(req.params.id);
  const incidentId = Number(req.params.incidentId);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const t = res.locals.t;

  let result;
  try {
    result = await callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/incidents/${encodeURIComponent(incidentId)}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return orgIncidentNotFound(res);
    throw error;
  }

  const statusKey = typeof req.query.status === 'string' ? req.query.status : '';
  const known = Object.hasOwn(ORG_STATUSES, statusKey) ? ORG_STATUSES[statusKey] : null;
  const replay = consumeFormReplay(req, 'volunteering', orgReplayKey(orgId, incidentId)) || {};

  return res.render('volunteering/organisation-safeguarding-incident', {
    title: t(`${ORG_KEY}detail_title`),
    orgId,
    incident: presentOrgDetail(result && result.data !== undefined ? result.data : result, t, dateFormatter(res)),
    status: known ? { ...known, message: t(ORG_KEY + known.key) } : null,
    updateBody: typeof replay.body === 'string' ? replay.body : '',
    updateMax: ADDITION_MAX
  });
}));

router.post('/organisations/:id(\\d+)/safeguarding/:incidentId(\\d+)/updates', asyncRoute(async (req, res) => {
  const orgId = Number(req.params.id);
  const incidentId = Number(req.params.incidentId);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, '/login?status=auth-required');
  const body = String((req.body && req.body.body) || '').trim().slice(0, ADDITION_MAX);
  const back = (status, anchor = '') => redirectTo(res, `/volunteering/organisations/${orgId}/safeguarding/${incidentId}?status=${status}${anchor}`);

  if (body.length < ADDITION_MIN) {
    rememberFormReplay(req, 'volunteering', orgReplayKey(orgId, incidentId), { body });
    return back('update-too-short', '#body');
  }

  try {
    await callVolunteeringApi(token, 'POST', `/organisations/${encodeURIComponent(orgId)}/incidents/${encodeURIComponent(incidentId)}/updates`, { body });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return redirectTo(res, '/login?status=auth-required');
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return orgIncidentNotFound(res);
    // Closed while the page was open: say so. Nothing can be added any more, so
    // the text is not kept for a retry the API would refuse again.
    if (error instanceof ApiError && error.status === 409) return back('report-closed', '#closed');
    rememberFormReplay(req, 'volunteering', orgReplayKey(orgId, incidentId), { body });
    if (error instanceof ApiError && error.status === 422) return back('update-too-short', '#body');
    return back('update-failed', '#body');
  }

  return back('update-sent');
}));

module.exports = router;
