// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Propose and support community projects (parity gap 5, 21 Oct 2026). The website's
 * CommunityProjectsTab.tsx has both; the accessible site's Community projects tab
 * (volunteering.njk, loaded in server.js) only listed them.
 *
 *   GET|POST  /volunteering/community-projects/propose          the proposal form
 *   POST      /volunteering/community-projects/:id/support      add your support
 *   POST      /volunteering/community-projects/:id/unsupport    take it back
 *
 * API: POST /v2/volunteering/community-projects { title, description, category?,
 * location?, target_volunteers?, proposed_date? (YYYY-MM-DD) } → 201, or 422 with the
 * field it refused (since 21 Oct 2026; before that a refusal came back as 201);
 * POST and DELETE /v2/volunteering/community-projects/{id}/support. A new proposal is
 * "proposed" and appears on the tab only once an administrator approves it, which the
 * confirmation says.
 *
 * A community that has switched the Community projects section off
 * (volunteering.tab_community_projects) gets the volunteering page instead, as for the
 * tab itself.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { composeDate } = require('../lib/date-input');
const { volunteeringSections } = require('../lib/volunteering-sections');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.community_projects.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'communityProjectPropose';
const TAB = '/volunteering?tab=community_projects';
const MAX_VOLUNTEERS = 100000;

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

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function apiFirstError(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return errors[0] && typeof errors[0] === 'object' ? errors[0] : {};
}

function sectionOn(req) {
  return volunteeringSections(req.accessibleRouting?.tenant).enabled('community-projects');
}

function tabWith(status, projectId = null) {
  return `${TAB}&status=${encodeURIComponent(status)}${projectId ? `#project-${projectId}` : ''}`;
}

/** Check the proposal locally, before anything reaches the API. */
function readProposal(body) {
  const source = body && typeof body === 'object' ? body : {};
  const title = String(source.title ?? '').trim();
  const description = String(source.description ?? '').trim();
  const category = trimmed(source.category, 100);
  const location = trimmed(source.location, 255);
  const targetRaw = trimmed(source.target_volunteers, 20);
  const date = composeDate(source, 'proposed_date');
  const values = {
    title: title.slice(0, 510),
    description: description.slice(0, 10000),
    category,
    location,
    target: targetRaw,
    date: date.parts
  };
  const errors = [];
  if (title === '') errors.push({ field: 'title', key: `${KEY}title_required` });
  else if ([...title].length > 255) errors.push({ field: 'title', key: `${KEY}title_too_long` });
  if (description === '') errors.push({ field: 'description', key: `${KEY}description_required` });
  let target = null;
  if (targetRaw !== '') {
    target = /^\d+$/.test(targetRaw) ? Number(targetRaw) : NaN;
    if (!Number.isInteger(target) || target < 1 || target > MAX_VOLUNTEERS) {
      errors.push({ field: 'target_volunteers', key: `${KEY}target_invalid` });
    }
  }
  if (date.error) {
    errors.push({
      field: 'proposed_date',
      href: `#proposed_date-${date.errorFields[0] || 'day'}`,
      key: `web_uk.date_input.${date.error}`,
      parts: date.errorFields
    });
  }
  const payload = errors.length ? null : {
    title,
    description,
    ...(category ? { category } : {}),
    ...(location ? { location } : {}),
    ...(target ? { target_volunteers: target } : {}),
    ...(date.value ? { proposed_date: date.value } : {})
  };
  return { values, errors, payload };
}

const FIELDS = { title: 'title', description: 'description', proposed_date: 'proposed_date', target_volunteers: 'target_volunteers' };

function presentErrors(stored, t) {
  return (Array.isArray(stored) ? stored : []).map((error) => ({
    field: typeof error.field === 'string' ? error.field : '',
    href: typeof error.href === 'string' ? error.href : (error.field ? `#${error.field}` : ''),
    text: typeof error.message === 'string' && error.message ? error.message : t(error.key),
    parts: Array.isArray(error.parts) ? error.parts : []
  })).filter((error) => error.text);
}

router.get('/community-projects/propose', asyncRoute(async (req, res) => {
  if (!tokenFrom(req)) return redirectTo(res, LOGIN);
  if (!sectionOn(req)) return redirectTo(res, '/volunteering');
  const t = res.locals.t;
  const replay = consumeFormReplay(req, REPLAY, 'propose') || {};
  let errors = replay.errors || [];
  if (errors.length === 0 && req.query.status === 'invalid') errors = [{ field: '', key: `${KEY}propose_failed` }];
  const presented = presentErrors(errors, t);
  const fieldErrors = {};
  for (const error of presented) if (error.field && !fieldErrors[error.field]) fieldErrors[error.field] = error;
  return res.render('volunteering/community-project-propose', {
    title: t(`${KEY}propose_title`),
    activeNav: 'volunteering',
    values: replay.values || { title: '', description: '', category: '', location: '', target: '', date: { day: '', month: '', year: '' } },
    errors: presented,
    fieldErrors
  });
}, { redirectOn401: LOGIN }));

router.post('/community-projects/propose', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  if (!sectionOn(req)) return redirectTo(res, '/volunteering');
  const form = readProposal(req.body);
  const failed = (errors) => {
    rememberFormReplay(req, REPLAY, 'propose', { values: form.values, errors });
    return redirectTo(res, '/volunteering/community-projects/propose?status=invalid');
  };
  if (form.errors.length) return failed(form.errors);

  try {
    await callVolunteeringApi(token, 'POST', '/community-projects', form.payload);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 400) || isStatus(error, 422)) {
      const first = apiFirstError(error);
      const field = FIELDS[trimmed(first.field)] || '';
      const message = trimmed(first.message, 500);
      if (message) return failed([{ field, href: field === 'proposed_date' ? '#proposed_date-day' : (field ? `#${field}` : ''), message }]);
    }
    return failed([{ field: '', key: `${KEY}propose_failed` }]);
  }
  return redirectTo(res, tabWith('project-proposed'));
}, { redirectOn401: LOGIN }));

router.post('/community-projects/:id(\\d+)/support', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  try {
    await callVolunteeringApi(token, 'POST', `/community-projects/${encodeURIComponent(id)}/support`);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    const code = trimmed(apiFirstError(error).code).toUpperCase();
    if (['SAFEGUARDING_CONTACT_RESTRICTED', 'VETTING_REQUIRED'].includes(code)) return redirectTo(res, tabWith('project-support-restricted', id));
    return redirectTo(res, tabWith('project-support-failed', id));
  }
  return redirectTo(res, tabWith('project-supported', id));
}, { redirectOn401: LOGIN }));

router.post('/community-projects/:id(\\d+)/unsupport', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  try {
    await callVolunteeringApi(token, 'DELETE', `/community-projects/${encodeURIComponent(id)}/support`);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    return redirectTo(res, tabWith('project-support-failed', id));
  }
  return redirectTo(res, tabWith('project-unsupported', id));
}, { redirectOn401: LOGIN }));

module.exports = router;
module.exports.readProposal = readProposal;
