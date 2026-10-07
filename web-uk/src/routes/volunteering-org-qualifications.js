// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * An organisation confirms its volunteers' qualifications (gap B7, part 3, 7 Oct 2026).
 * The accessible site had no qualifications register for an organisation; the website
 * has had one (OrgQualificationsTab.tsx) and these pages follow its rules.
 *
 *   GET   /volunteering/organisations/:orgId/qualifications                               the register
 *   POST  /volunteering/organisations/:orgId/qualifications/:qualificationId/confirm      confirm, saying how it was checked
 *   POST  /volunteering/organisations/:orgId/qualifications/:qualificationId/withdraw     withdraw, with a reason
 *
 * API: GET /v2/volunteering/organizations/{orgId}/qualifications (status, q, cursor),
 * POST /v2/volunteering/qualifications/{id}/confirm { method, organization_id } and
 * POST .../withdraw { reason }. Nothing is uploaded or stored: confirming is a statement
 * that someone checked the original, an online register, or asked the issuer. Confirm is
 * offered for a qualification awaiting confirmation or expired, but never on the member's
 * own (the API also refuses that, SELF_CONFIRMATION); withdraw for anything not already
 * withdrawn, own included, as on the website. Who may use the register is the API's
 * decision.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { splitDate } = require('../lib/date-input');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.org_qualifications.';
const LOGIN = '/login?status=auth-required';
const FILTERS = ['attention', 'confirmed', 'expired', 'all'];
const STATUSES = ['recorded', 'confirmed', 'expired', 'withdrawn'];
const STATUS_TAGS = { recorded: 'govuk-tag--blue', confirmed: 'govuk-tag--green', expired: 'govuk-tag--red', withdrawn: 'govuk-tag--grey' };
const METHODS = ['saw_original', 'online_register', 'issuer_confirmed'];
const REASONS = ['volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced'];
const TYPES = ['first_aid', 'safeguarding_training', 'manual_handling', 'food_hygiene', 'driving_licence',
  'professional_registration', 'other', 'children_first', 'first_aid_response', 'safeguarding_adults', 'efaw', 'faw'];

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

function apiCode(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed((errors[0] && errors[0].code) || (error && error.data && error.data.code)).toUpperCase();
}

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function errorPage(res, status) {
  const titles = { 403: 'error_pages.403_title', 404: 'error_pages.404_title' };
  return res.status(status).render(`errors/${status}`, { title: res.locals.t(titles[status]) });
}

function day(value) {
  const parts = splitDate(value);
  if (!parts.year) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

function registerPath(orgId, show, q, outcome) {
  const query = new URLSearchParams();
  if (show && show !== 'attention') query.set('show', show);
  if (q) query.set('q', q);
  if (outcome) query.set('status', outcome);
  const text = query.toString();
  return `/volunteering/organisations/${orgId}/qualifications${text ? `?${text}` : ''}`;
}

function presentQualification(raw, t, selfId) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const status = STATUSES.includes(item.status) ? item.status : 'recorded';
  const type = TYPES.includes(item.qualification_type) ? item.qualification_type : 'other';
  const isOwn = selfId !== null && positiveInteger(item.user_id) === selfId;
  const expires = day(item.expires_at);
  let expiryLabel = t(`${KEY}no_expiry`);
  if (expires) {
    expiryLabel = status === 'expired' ? t(`${KEY}expired_on`, { date: expires }) : t(`${KEY}expires_on`, { date: expires });
  }
  const confirmedBy = trimmed(item.confirmed_by?.name);
  const confirmedFor = trimmed(item.confirmed_for_organization?.name);
  const confirmedOn = day(item.confirmed_at);
  let confirmedLine = '';
  if (status === 'confirmed' && confirmedBy) {
    confirmedLine = confirmedFor
      ? t(`${KEY}confirmed_line_org`, { name: confirmedBy, org: confirmedFor, date: confirmedOn })
      : t(`${KEY}confirmed_line`, { name: confirmedBy, date: confirmedOn });
    if (METHODS.includes(item.confirmation_method)) {
      confirmedLine = `${confirmedLine} (${t(`${KEY}method_short.${item.confirmation_method}`)})`;
    }
  }
  return {
    id: positiveInteger(item.id),
    volunteerName: trimmed(item.volunteer?.name) || t(`${KEY}unknown_volunteer`),
    typeLabel: t(`${KEY}types.${type}`),
    title: trimmed(item.title),
    issuer: trimmed(item.issuer),
    reference: trimmed(item.reference_number),
    obtainedLabel: day(item.obtained_at),
    expiryLabel,
    isExpiring: item.is_expiring === true && status !== 'expired' && status !== 'withdrawn',
    status,
    statusLabel: t(`${KEY}status.${status}`),
    statusClass: STATUS_TAGS[status],
    confirmedLine,
    isOwn,
    canConfirm: !isOwn && (status === 'recorded' || status === 'expired'),
    canWithdraw: status !== 'withdrawn'
  };
}

const OUTCOMES = {
  'qualification-confirmed': ['success', 'confirm.done'],
  'qualification-withdrawn': ['success', 'withdraw.done'],
  'qualification-self': ['error', 'confirm.self'],
  'qualification-expired': ['error', 'confirm.expired_hint'],
  'qualification-failed': ['error', 'update_failed']
};

router.get('/organisations/:orgId(\\d+)/qualifications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const orgId = Number(req.params.orgId);
  const show = FILTERS.includes(trimmed(req.query.show)) ? trimmed(req.query.show) : 'attention';
  const q = trimmed(req.query.q, 100);
  const cursor = trimmed(req.query.cursor, 500);
  const params = new URLSearchParams({ per_page: '20' });
  if (show !== 'all') params.set('status', show);
  if (q) params.set('q', q);
  if (cursor) params.set('cursor', cursor);

  let data;
  let orgName = '';
  let selfId = null;
  try {
    const [list, stats, profile] = await Promise.all([
      callVolunteeringApi(token, 'GET', `/organizations/${encodeURIComponent(orgId)}/qualifications?${params.toString()}`),
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/stats`).catch(() => null),
      getRequestProfile(req, token).catch(() => null)
    ]);
    data = dataOf(list) || {};
    const statsData = dataOf(stats) || {};
    orgName = trimmed(statsData.org_name ?? statsData.orgName);
    selfId = positiveInteger((dataOf(profile) || {}).id);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return errorPage(res, 403);
    if (isStatus(error, 404)) return errorPage(res, 404);
    throw error;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const counts = data.counts && typeof data.counts === 'object' ? data.counts : {};
  const outcome = OUTCOMES[trimmed(req.query.status)] || null;
  const nextCursor = trimmed(data.next_cursor, 500);

  return res.render('volunteering/org-qualifications', {
    title: t(`${KEY}heading`),
    activeNav: 'volunteering',
    orgId,
    orgName,
    show,
    q,
    counts: ['expiring', 'recorded', 'confirmed', 'expired'].map((key) => ({
      label: t(`${KEY}tiles.${key}`),
      value: Number.isFinite(Number(counts[key])) ? Number(counts[key]) : 0
    })),
    filters: FILTERS.map((value) => ({
      value,
      label: t(`${KEY}filters.${value}`),
      href: registerPath(orgId, value, q),
      current: value === show
    })),
    qualifications: items.map((row) => presentQualification(row, t, selfId)).filter((item) => item.id),
    nextHref: nextCursor
      ? `/volunteering/organisations/${orgId}/qualifications?${new URLSearchParams({ ...(show !== 'attention' ? { show } : {}), ...(q ? { q } : {}), cursor: nextCursor }).toString()}`
      : '',
    methods: METHODS.map((value) => ({ value, label: t(`${KEY}confirm.methods.${value}`) })),
    reasons: REASONS.map((value) => ({ value, label: t(`${KEY}withdraw.reasons.${value}`) })),
    outcome: outcome ? { type: outcome[0], message: t(`${KEY}${outcome[1]}`) } : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

function backTo(req, orgId, outcome) {
  const show = FILTERS.includes(trimmed(req.body.show)) ? trimmed(req.body.show) : 'attention';
  return registerPath(orgId, show, trimmed(req.body.q, 100), outcome);
}

router.post('/organisations/:orgId(\\d+)/qualifications/:qualificationId(\\d+)/confirm', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const orgId = Number(req.params.orgId);
  const method = trimmed(req.body.method);
  if (!METHODS.includes(method)) return redirectTo(res, backTo(req, orgId, 'qualification-failed'));
  try {
    await callVolunteeringApi(token, 'POST', `/qualifications/${encodeURIComponent(Number(req.params.qualificationId))}/confirm`, {
      method,
      organization_id: orgId
    });
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    const code = apiCode(error);
    if (code === 'SELF_CONFIRMATION') return redirectTo(res, backTo(req, orgId, 'qualification-self'));
    if (code === 'EXPIRED') return redirectTo(res, backTo(req, orgId, 'qualification-expired'));
    return redirectTo(res, backTo(req, orgId, 'qualification-failed'));
  }
  return redirectTo(res, backTo(req, orgId, 'qualification-confirmed'));
}));

router.post('/organisations/:orgId(\\d+)/qualifications/:qualificationId(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const orgId = Number(req.params.orgId);
  const reason = trimmed(req.body.reason);
  if (!REASONS.includes(reason)) return redirectTo(res, backTo(req, orgId, 'qualification-failed'));
  try {
    await callVolunteeringApi(token, 'POST', `/qualifications/${encodeURIComponent(Number(req.params.qualificationId))}/withdraw`, { reason });
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    return redirectTo(res, backTo(req, orgId, 'qualification-failed'));
  }
  return redirectTo(res, backTo(req, orgId, 'qualification-withdrawn'));
}));

module.exports = router;
