// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * An organisation's own opportunities: open, closed to new volunteers, and
 * cancelled (parity gap 1, 21 Oct 2026). The website has had this list on the
 * organisation dashboard since 6 Oct 2026 (OrgOpportunitiesTab.tsx). The accessible
 * site only showed a count, so an organiser who closed an opportunity could get back
 * to it only by its address: closed and cancelled opportunities never appear in the
 * public list.
 *
 *   GET  /volunteering/organisations/:orgId/opportunities?show=open|closed|cancelled|all
 *
 * API: GET /v2/volunteering/organisations/{id}/opportunities → { items: [{ id, title,
 * state, location, is_remote, start_date, end_date, pending_applications,
 * approved_volunteers, upcoming_shifts }] } (newest first, at most 200). The API
 * decides who may see it (403 otherwise). The filter is applied here, as on the
 * website, so each tab can show its count.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { splitDate } = require('../lib/date-input');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.org_opportunities.';
const LOGIN = '/login?status=auth-required';
const STATES = ['open', 'closed', 'cancelled'];
const FILTERS = [...STATES, 'all'];
const STATE_TAGS = { open: 'govuk-tag--green', closed: 'govuk-tag--yellow', cancelled: 'govuk-tag--red' };

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

function count(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
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

function presentOpportunity(raw, t) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const state = STATES.includes(item.state) ? item.state : 'open';
  const start = day(item.start_date);
  const end = day(item.end_date);
  return {
    id: positiveInteger(item.id),
    title: trimmed(item.title, 255) || t(`${KEY}untitled`),
    state,
    stateLabel: t(`${KEY}state.${state}`),
    stateClass: STATE_TAGS[state],
    meta: [
      item.is_remote === true ? t(`${KEY}remote`) : trimmed(item.location, 255),
      start && end && end !== start ? t(`${KEY}date_range`, { start, end }) : start
    ].filter(Boolean).join(' · '),
    pending: count(item.pending_applications),
    approved: count(item.approved_volunteers),
    upcomingShifts: count(item.upcoming_shifts),
    // An open opportunity with nothing scheduled cannot take a volunteer, which is
    // why the website colours that figure; here it gets a sentence instead.
    needsShifts: state === 'open' && count(item.upcoming_shifts) === 0,
    canEdit: state !== 'cancelled'
  };
}

router.get('/organisations/:orgId(\\d+)/opportunities', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const orgId = Number(req.params.orgId);
  const show = FILTERS.includes(trimmed(req.query.show)) ? trimmed(req.query.show) : 'open';

  let items = [];
  let orgName = '';
  try {
    const [list, stats] = await Promise.all([
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/opportunities`),
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/stats`).catch(() => null)
    ]);
    const data = dataOf(list) || {};
    items = (Array.isArray(data.items) ? data.items : []).map((row) => presentOpportunity(row, t)).filter((row) => row.id);
    const statsData = dataOf(stats) || {};
    orgName = trimmed(statsData.org_name ?? statsData.orgName);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return errorPage(res, 403);
    if (isStatus(error, 404)) return errorPage(res, 404);
    throw error;
  }

  const counts = { open: 0, closed: 0, cancelled: 0, all: items.length };
  for (const item of items) counts[item.state] += 1;
  const base = `/volunteering/organisations/${orgId}/opportunities`;

  return res.render('volunteering/org-opportunities', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    orgId,
    orgName,
    show,
    filters: FILTERS.map((value) => ({
      value,
      label: t(`${KEY}filters.${value}`, { count: counts[value] }),
      href: value === 'open' ? base : `${base}?show=${value}`,
      current: value === show
    })),
    opportunities: items.filter((item) => show === 'all' || item.state === show),
    emptyMessage: t(show === 'open' ? `${KEY}empty_open` : `${KEY}empty_other`)
  });
}));

module.exports = router;
