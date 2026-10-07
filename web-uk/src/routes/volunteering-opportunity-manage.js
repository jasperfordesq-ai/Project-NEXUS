// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Change, close, reopen or cancel a volunteering opportunity (gap B2, 7 Oct 2026).
 *
 * Until now an organiser on the accessible site could post an opportunity and then
 * never touch it again: there was no edit page, no way to stop new applications, and
 * no way to withdraw it. The website gained these on 6 Oct (gap A2,
 * react-frontend/src/pages/volunteering/OpportunityDetailPage.tsx and
 * CreateOpportunityPage.tsx in edit mode); these pages follow the same rules, laid out
 * as GOV.UK pages: one thing per page and a confirmation page before cancelling.
 *
 *   GET|POST  /volunteering/opportunities/:id/edit     change the details
 *   POST      /volunteering/opportunities/:id/close    stop new applications
 *   POST      /volunteering/opportunities/:id/reopen   take applications again
 *   GET|POST  /volunteering/opportunities/:id/cancel   withdraw it for good
 *
 * API contract (VolunteerService::updateOpportunity / deleteOpportunity):
 *   PUT    /v2/volunteering/opportunities/{id}  any of title, description, location,
 *          is_remote, latitude, longitude, skills_needed, start_date, end_date,
 *          category_id, federated_visibility, and status open|closed
 *   DELETE /v2/volunteering/opportunities/{id}  sets is_active = 0 and tells volunteers
 *          whose applications were approved
 * Who may use these pages is decided by the API (`can_manage` or `is_owner`), exactly
 * as for shifts (routes/volunteering-shifts.js); every write is refused by the API for
 * anyone else too. A cancelled opportunity cannot be changed or reopened.
 *
 * Mounted before routes/volunteering-actions.js, which owns the volunteer's apply and
 * shift actions under the same opportunity path.
 */

const express = require('express');
const { ApiError, callVolunteeringApi, getVolunteeringCategories } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { readDate, splitDate, dateParts } = require('../lib/date-input');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.opp_manage.';
const CREATE_KEY = 'govuk_alpha_volunteering.create_opp.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'volunteeringOpportunityEdit';
/** Sentinel for "keep the category it already has" when its id is not known here. */
const KEEP_CATEGORY = 'keep';

// ── Small helpers ────────────────────────────────────────────────────────────

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

function checked(value) {
  return value === true || value === '1' || value === 'on' || value === 'true' || value === 1;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function isApiStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function opportunityPath(id) {
  return `/volunteering/opportunities/${id}`;
}

function opportunityRedirect(id, status) {
  return `${opportunityPath(id)}?status=${encodeURIComponent(status)}`;
}

function forbidden(res) {
  return res.status(403).render('errors/403', { title: res.locals.t('error_pages.403_title') });
}

function notFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
}

/** 401 → sign in again; 403 → refusal page; 404 → not found. True when it responded. */
function answerRefusal(error, res) {
  if (isApiStatus(error, 401)) {
    redirectTo(res, LOGIN);
    return true;
  }
  if (isApiStatus(error, 403)) {
    forbidden(res);
    return true;
  }
  if (isApiStatus(error, 404)) {
    notFound(res);
    return true;
  }
  return false;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * The opportunity, if the signed-in member may manage it. Responds itself (sign-in,
 * 403, 404) and returns null when the page must not go on. A cancelled opportunity is
 * refused too: the API keeps it, but nothing about it can be changed any more.
 */
async function managedOpportunity(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, LOGIN);
    return null;
  }
  const id = Number(req.params.id);
  let item;
  try {
    item = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(id)}`));
  } catch (error) {
    if (answerRefusal(error, res)) return null;
    throw error;
  }
  const opportunity = item && typeof item === 'object' ? item : {};
  if (opportunity.can_manage !== true && opportunity.is_owner !== true) {
    forbidden(res);
    return null;
  }
  if (opportunity.is_active === false) {
    redirectTo(res, opportunityRedirect(id, 'opp-is-cancelled'));
    return null;
  }
  return { token, id, opportunity };
}

async function loadCategories(token) {
  try {
    const rows = dataOf(await getVolunteeringCategories(token));
    const list = Array.isArray(rows) ? rows : (rows && Array.isArray(rows.items) ? rows.items : []);
    return list
      .map((row) => ({ id: positiveInteger(row?.id), name: trimmed(row?.name) }))
      .filter((row) => row.id && row.name);
  } catch {
    // The category list is a convenience; without it the current category is kept.
    return [];
  }
}

// ── The edit form ────────────────────────────────────────────────────────────

/** What the form shows when it opens: the opportunity as it is now. */
function formFromOpportunity(opportunity, categories) {
  const categoryName = trimmed(typeof opportunity.category === 'string'
    ? opportunity.category
    : opportunity.category?.name);
  const match = categories.find((category) => category.name === categoryName);
  return {
    title: trimmed(opportunity.title, 255),
    description: String(opportunity.description ?? ''),
    location: trimmed(opportunity.location, 255),
    originalLocation: trimmed(opportunity.location, 255),
    skillsNeeded: trimmed(opportunity.skills_needed, 1000),
    categoryId: match ? String(match.id) : (categoryName ? KEEP_CATEGORY : ''),
    isRemote: opportunity.is_remote === true,
    originalRemote: opportunity.is_remote === true,
    federatedVisibility: opportunity.federated_visibility === 'listed',
    startDateParts: splitDate(opportunity.start_date),
    endDateParts: splitDate(opportunity.end_date)
  };
}

/** What was typed, kept so a refused form comes back filled in. */
function formFromBody(body) {
  return {
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    location: String(body.location ?? ''),
    originalLocation: String(body.original_location ?? ''),
    skillsNeeded: String(body.skills_needed ?? ''),
    categoryId: String(body.category_id ?? ''),
    isRemote: checked(body.is_remote),
    originalRemote: checked(body.original_remote),
    federatedVisibility: checked(body.federated_visibility),
    startDateParts: dateParts(body, 'start_date'),
    endDateParts: dateParts(body, 'end_date')
  };
}

function validate(body, t) {
  const errors = [];
  const fields = {};
  const title = trimmed(body.title, 1000);
  const description = String(body.description ?? '').trim();
  const start = readDate(body, 'start_date');
  const end = readDate(body, 'end_date');

  if (!title) {
    errors.push({ href: '#title', text: t(`${CREATE_KEY}error_title_required`) });
    fields.title = t(`${CREATE_KEY}error_title_required`);
  } else if (title.length > 255) {
    errors.push({ href: '#title', text: t(`${KEY}error_title_too_long`) });
    fields.title = t(`${KEY}error_title_too_long`);
  }
  if (!description) {
    errors.push({ href: '#description', text: t(`${CREATE_KEY}error_description_required`) });
    fields.description = t(`${CREATE_KEY}error_description_required`);
  }
  if (start.error) {
    errors.push({ href: '#start_date-day', text: t(`${KEY}error_start_date`) });
    fields.startDate = t(`${KEY}error_start_date`);
  }
  if (end.error) {
    errors.push({ href: '#end_date-day', text: t(`${KEY}error_end_date`) });
    fields.endDate = t(`${KEY}error_end_date`);
  } else if (start.value && end.value && end.value < start.value) {
    errors.push({ href: '#end_date-day', text: t(`${KEY}error_end_before_start`) });
    fields.endDate = t(`${KEY}error_end_before_start`);
  }

  return { errors, fields, title, description, startDate: start.value, endDate: end.value };
}

function renderEdit(res, managed, view) {
  const { opportunity, id } = managed;
  return res.status(view.statusCode || 200).render('volunteering/opportunity-edit', {
    title: res.locals.t(`${KEY}edit_title`),
    activeNav: 'volunteering',
    opportunityId: id,
    opportunityTitle: trimmed(opportunity.title, 300),
    organisationName: trimmed(opportunity.organization?.name ?? opportunity.org_name, 300),
    currentCategoryName: trimmed(typeof opportunity.category === 'string' ? opportunity.category : opportunity.category?.name),
    keepCategory: KEEP_CATEGORY,
    categories: view.categories,
    form: view.form,
    errors: view.errors || [],
    fieldErrors: view.fieldErrors || {},
    failure: view.failure || '',
    csrfToken: res.req.csrfToken ? res.req.csrfToken() : ''
  });
}

router.get('/opportunities/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const managed = await managedOpportunity(req, res);
  if (!managed) return undefined;
  const categories = await loadCategories(managed.token);
  const replay = consumeFormReplay(req, REPLAY, String(managed.id));
  return renderEdit(res, managed, {
    categories,
    form: replay?.form || formFromOpportunity(managed.opportunity, categories),
    errors: replay?.errors,
    fieldErrors: replay?.fieldErrors,
    failure: replay?.failure
  });
}));

router.post('/opportunities/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const managed = await managedOpportunity(req, res);
  if (!managed) return undefined;
  const t = res.locals.t;
  const form = formFromBody(req.body);
  const checkedForm = validate(req.body, t);

  if (checkedForm.errors.length) {
    const categories = await loadCategories(managed.token);
    return renderEdit(res, managed, {
      statusCode: 400,
      categories,
      form,
      errors: checkedForm.errors,
      fieldErrors: checkedForm.fields
    });
  }

  const isRemote = checked(req.body.is_remote);
  const location = trimmed(req.body.location, 255);
  const payload = {
    title: checkedForm.title,
    description: checkedForm.description,
    location,
    is_remote: isRemote,
    skills_needed: trimmed(req.body.skills_needed, 1000),
    start_date: checkedForm.startDate || null,
    end_date: checkedForm.endDate || null,
    federated_visibility: checked(req.body.federated_visibility) ? 'listed' : 'none'
  };
  const categoryChoice = trimmed(req.body.category_id);
  if (categoryChoice !== KEEP_CATEGORY) {
    payload.category_id = positiveInteger(categoryChoice);
  }
  // This form has no map. A place that changed, or an opportunity that went remote,
  // must drop the old pin rather than keep pointing at the previous place — the same
  // rule as the website's edit form. An unchanged place keeps its pin.
  if (location !== trimmed(req.body.original_location, 255) || isRemote !== checked(req.body.original_remote)) {
    payload.latitude = null;
    payload.longitude = null;
  }

  try {
    await callVolunteeringApi(managed.token, 'PUT', `/opportunities/${encodeURIComponent(managed.id)}`, payload);
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    const failure = isApiStatus(error, 422) ? 'validation' : 'failed';
    rememberFormReplay(req, REPLAY, String(managed.id), { form, failure });
    return redirectTo(res, `${opportunityPath(managed.id)}/edit`);
  }
  return redirectTo(res, opportunityRedirect(managed.id, 'opp-updated'));
}));

// ── Close and reopen ─────────────────────────────────────────────────────────

function statusAction(nextStatus, successStatus) {
  return asyncRoute(async (req, res) => {
    const managed = await managedOpportunity(req, res);
    if (!managed) return undefined;
    try {
      await callVolunteeringApi(managed.token, 'PUT', `/opportunities/${encodeURIComponent(managed.id)}`, { status: nextStatus });
    } catch (error) {
      if (answerRefusal(error, res)) return undefined;
      return redirectTo(res, opportunityRedirect(managed.id, 'opp-manage-failed'));
    }
    return redirectTo(res, opportunityRedirect(managed.id, successStatus));
  });
}

router.post('/opportunities/:id(\\d+)/close', statusAction('closed', 'opp-closed'));
router.post('/opportunities/:id(\\d+)/reopen', statusAction('open', 'opp-reopened'));

// ── Cancel ───────────────────────────────────────────────────────────────────

router.get('/opportunities/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const managed = await managedOpportunity(req, res);
  if (!managed) return undefined;
  return res.render('volunteering/opportunity-cancel', {
    title: res.locals.t(`${KEY}cancel_title`),
    activeNav: 'volunteering',
    opportunityId: managed.id,
    opportunityTitle: trimmed(managed.opportunity.title, 300),
    isClosed: managed.opportunity.status === 'closed',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/opportunities/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const managed = await managedOpportunity(req, res);
  if (!managed) return undefined;
  try {
    await callVolunteeringApi(managed.token, 'DELETE', `/opportunities/${encodeURIComponent(managed.id)}`);
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    return redirectTo(res, opportunityRedirect(managed.id, 'opp-manage-failed'));
  }
  return redirectTo(res, opportunityRedirect(managed.id, 'opp-cancelled'));
}));

module.exports = router;
