// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Retire, reinstate and remove volunteers on an organisation's roster (parity gap 3,
 * 21 Oct 2026). The website's OrgVolunteersTab.tsx has had these since October; the
 * accessible site's roster was read-only.
 *
 *   GET|POST  /volunteering/organisations/:orgId/volunteers/:userId/retire     ask first, then retire
 *   POST      /volunteering/organisations/:orgId/volunteers/:userId/reinstate  straight through
 *   GET|POST  /volunteering/organisations/:orgId/volunteers/:userId/remove     ask first, then remove
 *
 * API: POST /v2/volunteering/organisations/{id}/volunteers/{userId}/retire|reinstate and
 * DELETE /v2/volunteering/organisations/{id}/volunteers/{userId}. Retiring releases the
 * volunteer's places on upcoming shifts; removing takes them off every opportunity. Both
 * tell the volunteer, so both ask first, as on the website. The roster list itself
 * (GET .../volunteers, ?show=retired) lives in routes/volunteering-actions.js.
 *
 * The confirmation page needs the volunteer's name. The roster API has no single-volunteer
 * read, but it pages by descending user id with `cursor` = "ids below this one", so
 * cursor = userId + 1 and per_page = 1 returns exactly that volunteer if they are on the
 * list being shown. The outcome message carries the name, so it travels in the session
 * (form replay), never in the address.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay } = require('../lib/form-replay');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.org_roster.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'orgRoster';

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

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function apiMessage(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed((errors[0] && errors[0].message) || (error && error.data && error.data.message), 500);
}

function errorPage(res, status) {
  const titles = { 403: 'error_pages.403_title', 404: 'error_pages.404_title' };
  return res.status(status).render(`errors/${status}`, { title: res.locals.t(titles[status]) });
}

function rosterPath(orgId, show) {
  return `/volunteering/organisations/${orgId}/volunteers${show === 'retired' ? '?show=retired' : ''}`;
}

/** One volunteer on the active or retired list, or null. */
async function findVolunteer(token, orgId, userId, show) {
  const params = new URLSearchParams({ per_page: '1', cursor: String(userId + 1) });
  if (show === 'retired') params.set('status', 'retired');
  const result = await callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/volunteers?${params.toString()}`);
  const rows = Array.isArray(result?.data) ? result.data : (Array.isArray(result?.data?.items) ? result.data.items : []);
  const row = rows.find((item) => positiveInteger(item && item.id) === userId);
  return row ? { id: userId, name: trimmed(row.name) } : null;
}

function confirmPage(action) {
  return asyncRoute(async (req, res) => {
    const token = tokenFrom(req);
    if (!token) return redirectTo(res, LOGIN);
    const t = res.locals.t;
    const orgId = Number(req.params.orgId);
    const userId = Number(req.params.userId);
    // Remove works on either list; retire only on the active one.
    const show = action === 'remove' && req.query.show === 'retired' ? 'retired' : 'active';

    let volunteer;
    try {
      volunteer = await findVolunteer(token, orgId, userId, show);
    } catch (error) {
      if (isStatus(error, 401)) return redirectTo(res, LOGIN);
      if (isStatus(error, 403)) return errorPage(res, 403);
      if (isStatus(error, 404)) return errorPage(res, 404);
      throw error;
    }
    if (!volunteer) return errorPage(res, 404);
    const name = volunteer.name || t('members.unknown_member');

    return res.render('volunteering/org-roster-confirm', {
      title: t(`${KEY}${action}_title`),
      activeNav: 'volunteering',
      orgId,
      action,
      show,
      volunteer,
      body: t(`${KEY}${action}_confirm`, { name }),
      confirmLabel: t(`${KEY}${action}`),
      cancelHref: rosterPath(orgId, show)
    });
  }, { redirectOn401: LOGIN });
}

/**
 * The shared half of each roster change. `send` makes the API call; it is written out at
 * each route below, because the API consumer ledger only reads calls it can see there.
 */
function change(action, send) {
  return asyncRoute(async (req, res) => {
    const token = tokenFrom(req);
    if (!token) return redirectTo(res, LOGIN);
    const t = res.locals.t;
    const orgId = Number(req.params.orgId);
    const name = trimmed(req.body && req.body.name) || t('members.unknown_member');
    // Where the organiser was: reinstate is offered on the retired list, remove on either.
    const back = action === 'reinstate' || req.body?.show === 'retired' ? 'retired' : 'active';

    let outcome;
    try {
      await send(token, orgId, Number(req.params.userId));
      const done = { retire: 'retired', reinstate: 'reinstated', remove: 'removed' }[action];
      outcome = { type: 'success', message: t(`${KEY}${done}`, { name }) };
    } catch (error) {
      if (isStatus(error, 401)) return redirectTo(res, LOGIN);
      if (isStatus(error, 403)) return errorPage(res, 403);
      // The API's own words (already retired, not on the roster) read better than a "could not".
      outcome = { type: 'error', message: apiMessage(error) || t(`${KEY}${action}_failed`) };
    }
    rememberFormReplay(req, REPLAY, `roster-${orgId}`, outcome);
    return redirectTo(res, rosterPath(orgId, back));
  }, { redirectOn401: LOGIN });
}

// Literal paths, one per line: the route matrix reads them as written.
router.get('/organisations/:orgId(\\d+)/volunteers/:userId(\\d+)/retire', confirmPage('retire'));
router.get('/organisations/:orgId(\\d+)/volunteers/:userId(\\d+)/remove', confirmPage('remove'));
router.post('/organisations/:orgId(\\d+)/volunteers/:userId(\\d+)/retire', change('retire',
  (token, org, user) => callVolunteeringApi(token, 'POST', `/organisations/${encodeURIComponent(org)}/volunteers/${encodeURIComponent(user)}/retire`)));
router.post('/organisations/:orgId(\\d+)/volunteers/:userId(\\d+)/reinstate', change('reinstate',
  (token, org, user) => callVolunteeringApi(token, 'POST', `/organisations/${encodeURIComponent(org)}/volunteers/${encodeURIComponent(user)}/reinstate`)));
router.post('/organisations/:orgId(\\d+)/volunteers/:userId(\\d+)/remove', change('remove',
  (token, org, user) => callVolunteeringApi(token, 'DELETE', `/organisations/${encodeURIComponent(org)}/volunteers/${encodeURIComponent(user)}`)));

module.exports = router;
