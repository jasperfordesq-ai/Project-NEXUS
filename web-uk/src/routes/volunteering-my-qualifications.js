// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * A volunteer's own qualifications register (gap B15, 7 Oct 2026).
 *
 * The website replaced its document-upload "credentials" section with this
 * register on 5 Oct 2026 (owner decision: qualifications are recorded, never
 * uploaded). The accessible site never got the volunteer side and still had the
 * old upload page; these pages follow the website's QualificationsTab.tsx and use
 * the same wording, and the old address now forwards here.
 *
 *   GET  /volunteering/qualifications                     the register
 *   GET  /volunteering/qualifications/new                 add form
 *   POST /volunteering/qualifications                     add
 *   GET  /volunteering/qualifications/:id/edit            edit form
 *   POST /volunteering/qualifications/:id                 save changes
 *   GET  /volunteering/qualifications/:id/withdraw        choose a reason
 *   POST /volunteering/qualifications/:id/withdraw        withdraw
 *
 * API: GET/POST /v2/volunteering/qualifications, PUT /v2/volunteering/qualifications/{id},
 * POST /v2/volunteering/qualifications/{id}/withdraw. The API decides everything; the
 * checks here only save a round trip and put each message on its field.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { composeDate, splitDate } = require('../lib/date-input');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.my_qualifications.';
const LOGIN = '/login?status=auth-required';
const STATUSES = ['recorded', 'confirmed', 'expired', 'withdrawn'];
const STATUS_TAGS = { recorded: 'govuk-tag--blue', confirmed: 'govuk-tag--green', expired: 'govuk-tag--red', withdrawn: 'govuk-tag--grey' };
const REASONS = ['volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced'];
const LIMITS = { title: 160, issuer: 160, reference_number: 100, notes: 500 };

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

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function apiCode(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed((errors[0] && errors[0].code) || (error && error.data && error.data.code)).toUpperCase();
}

function apiField(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed(errors[0] && errors[0].field);
}

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function notFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
}

function day(value) {
  const parts = splitDate(value);
  if (!parts.year) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

async function loadRegister(token) {
  const data = dataOf(await callVolunteeringApi(token, 'GET', '/qualifications')) || {};
  return {
    items: Array.isArray(data.items) ? data.items : [],
    types: (Array.isArray(data.types) ? data.types : [])
      .map((type) => ({ code: trimmed(type?.code, 60), years: Number(type?.expiry_hint_years) || null }))
      .filter((type) => type.code),
    counts: data.counts && typeof data.counts === 'object' ? data.counts : {}
  };
}

function typeLabel(t, code, title) {
  const label = t(`${KEY}types.${code}`);
  return label && label !== `${KEY}types.${code}` ? label : (title || code);
}

function present(raw, t) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const status = STATUSES.includes(item.status) ? item.status : 'recorded';
  const label = typeLabel(t, trimmed(item.qualification_type, 60), trimmed(item.title));
  const expires = day(item.expires_at);
  let expiryLabel = t(`${KEY}no_expiry`);
  if (expires) expiryLabel = status === 'expired' ? t(`${KEY}expired_on`, { date: expires }) : t(`${KEY}expires_on`, { date: expires });
  const confirmedBy = trimmed(item.confirmed_by?.name);
  const confirmedFor = trimmed(item.confirmed_for_organization?.name);
  let confirmedLine = '';
  if (status === 'confirmed' && confirmedBy) {
    confirmedLine = confirmedFor
      ? t(`${KEY}confirmed_line_org`, { name: confirmedBy, org: confirmedFor, date: day(item.confirmed_at) })
      : t(`${KEY}confirmed_line`, { name: confirmedBy, date: day(item.confirmed_at) });
  }
  const isExpiring = item.is_expiring === true && (status === 'recorded' || status === 'confirmed');
  return {
    id: Number(item.id) || null,
    label,
    title: trimmed(item.title) !== label ? trimmed(item.title) : '',
    issuer: trimmed(item.issuer),
    reference: trimmed(item.reference_number) ? t(`${KEY}reference`, { ref: trimmed(item.reference_number) }) : '',
    obtained: item.obtained_at ? t(`${KEY}obtained_on`, { date: day(item.obtained_at) }) : '',
    expiryLabel,
    status,
    statusLabel: t(`${KEY}status.${status}`),
    statusClass: STATUS_TAGS[status],
    isExpiring,
    confirmedLine,
    withdrawnLine: status === 'withdrawn' && item.withdrawn_at ? t(`${KEY}withdrawn_line`, { date: day(item.withdrawn_at) }) : '',
    needsAttention: isExpiring || status === 'expired'
  };
}

/** The form, as posted or as stored. Dates stay in three parts for the GOV.UK pattern. */
function formFrom(source) {
  return {
    qualification_type: trimmed(source.qualification_type, 60),
    title: trimmed(source.title, LIMITS.title),
    issuer: trimmed(source.issuer, LIMITS.issuer),
    reference_number: trimmed(source.reference_number, LIMITS.reference_number),
    notes: trimmed(source.notes, LIMITS.notes),
    obtained: splitDate(source.obtained_at),
    expires: splitDate(source.expires_at)
  };
}

function readPosted(body) {
  const form = formFrom(body || {});
  const obtained = composeDate(body || {}, 'obtained');
  const expires = composeDate(body || {}, 'expires');
  form.obtained = obtained.parts;
  form.expires = expires.parts;
  const errors = [];
  if (!form.qualification_type) errors.push({ field: 'qualification_type', key: `${KEY}form.type_placeholder` });
  if (form.qualification_type === 'other' && !form.title) errors.push({ field: 'title', key: `${KEY}errors.title_required` });
  if (obtained.error) errors.push({ field: 'obtained', href: `#obtained-${obtained.errorFields[0] || 'day'}`, key: `web_uk.date_input.${obtained.error}`, parts: obtained.errorFields });
  if (expires.error) errors.push({ field: 'expires', href: `#expires-${expires.errorFields[0] || 'day'}`, key: `web_uk.date_input.${expires.error}`, parts: expires.errorFields });
  if (!obtained.error && !expires.error && obtained.value && expires.value && expires.value < obtained.value) {
    errors.push({ field: 'expires', href: '#expires-day', key: `${KEY}errors.expiry_before_obtained`, parts: ['day', 'month', 'year'] });
  }
  return {
    form,
    errors,
    body: {
      qualification_type: form.qualification_type,
      title: form.title || null,
      issuer: form.issuer || null,
      reference_number: form.reference_number || null,
      obtained_at: obtained.value || null,
      expires_at: expires.value || null,
      notes: form.notes || null
    }
  };
}

/** Where the API's refusal belongs. */
function apiError(error) {
  const code = apiCode(error);
  if (code === 'TITLE_REQUIRED_FOR_OTHER') return { field: 'title', key: `${KEY}errors.title_required` };
  if (code === 'EXPIRY_BEFORE_OBTAINED') return { field: 'expires', href: '#expires-day', key: `${KEY}errors.expiry_before_obtained` };
  if (code === 'VETTING_NOT_A_QUALIFICATION') return { field: 'qualification_type', key: `${KEY}errors.vetting` };
  if (code === 'UNSUPPORTED_QUALIFICATION_TYPE') return { field: 'qualification_type', key: `${KEY}errors.unsupported_type` };
  if (apiField(error) === 'qualification_type') return { field: 'qualification_type', key: `${KEY}form.type_placeholder` };
  return { field: null, key: `${KEY}form.save_error` };
}

function renderForm(res, { editing, form, types, errors = [], status = 200 }) {
  const t = res.locals.t;
  const list = errors.map((error) => ({
    ...error,
    href: error.href || (error.field ? `#${error.field}` : null),
    message: t(error.key)
  }));
  const byField = {};
  for (const error of list) if (error.field && !byField[error.field]) byField[error.field] = error;
  // A type no longer offered (a stored record) still shows as chosen.
  const offered = types.map((type) => type.code);
  const options = (form.qualification_type && !offered.includes(form.qualification_type)
    ? [...types, { code: form.qualification_type, years: null }] : types)
    .map((type) => ({
      code: type.code,
      label: typeLabel(t, type.code, ''),
      hint: type.years ? t(`${KEY}form.expiry_hint`, { years: type.years }) : ''
    }));
  return res.status(status).render('volunteering/my-qualification-form', {
    title: editing ? t(`${KEY}form.title_edit`) : t(`${KEY}form.title_add`),
    activeNav: 'volunteering',
    editing,
    form,
    options,
    limits: LIMITS,
    errors: list,
    fieldErrors: byField,
    csrfToken: res.req && res.req.csrfToken ? res.req.csrfToken() : ''
  });
}

const OUTCOMES = {
  saved: ['success', 'form.saved'],
  withdrawn: ['success', 'withdraw.done'],
  'withdraw-failed': ['error', 'form.save_error']
};

router.get('/qualifications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  let register;
  let loadError = '';
  try {
    register = await loadRegister(token);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return res.status(403).render('errors/403', { title: t('error_pages.403_title') });
    register = { items: [], types: [], counts: {} };
    loadError = t(`${KEY}load_error`);
  }

  const items = register.items.map((row) => present(row, t)).filter((item) => item.id);
  const groups = [
    { key: 'attention', items: items.filter((item) => item.needsAttention && item.status !== 'withdrawn') },
    { key: 'recorded', items: items.filter((item) => !item.needsAttention && item.status === 'recorded') },
    { key: 'confirmed', items: items.filter((item) => !item.needsAttention && item.status === 'confirmed') },
    { key: 'withdrawn', items: items.filter((item) => item.status === 'withdrawn') }
  ].filter((group) => group.items.length).map((group) => ({ ...group, heading: t(`${KEY}groups.${group.key}`) }));
  const outcome = OUTCOMES[trimmed(req.query.status)] || null;

  return res.render('volunteering/my-qualifications', {
    title: t(`${KEY}heading`),
    activeNav: 'volunteering',
    groups,
    hasItems: items.length > 0,
    loadError,
    outcome: outcome ? { type: outcome[0], message: t(`${KEY}${outcome[1]}`) } : null
  });
}));

router.get('/qualifications/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  try {
    const { types } = await loadRegister(token);
    return renderForm(res, { editing: null, form: formFrom({}), types });
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    throw error;
  }
}));

router.post('/qualifications', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const posted = readPosted(req.body);
  let types = [];
  try {
    if (posted.errors.length) {
      ({ types } = await loadRegister(token));
      return renderForm(res, { editing: null, form: posted.form, types, errors: posted.errors, status: 422 });
    }
    await callVolunteeringApi(token, 'POST', '/qualifications', posted.body);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (!types.length) types = await loadRegister(token).then((r) => r.types).catch(() => []);
    return renderForm(res, { editing: null, form: posted.form, types, errors: [apiError(error)], status: 422 });
  }
  return redirectTo(res, '/volunteering/qualifications?status=saved');
}));

router.get('/qualifications/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  let register;
  try {
    register = await loadRegister(token);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    throw error;
  }
  const record = register.items.find((row) => Number(row?.id) === id);
  if (!record || record.status === 'withdrawn') return notFound(res);
  return renderForm(res, {
    editing: { id, wasConfirmed: record.status === 'confirmed' },
    form: formFrom(record),
    types: register.types
  });
}));

router.post('/qualifications/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const editing = { id, wasConfirmed: req.body.was_confirmed === '1' };
  const posted = readPosted(req.body);
  let types = [];
  try {
    if (posted.errors.length) {
      ({ types } = await loadRegister(token));
      return renderForm(res, { editing, form: posted.form, types, errors: posted.errors, status: 422 });
    }
    await callVolunteeringApi(token, 'PUT', `/qualifications/${encodeURIComponent(id)}`, posted.body);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 404)) return notFound(res);
    if (!types.length) types = await loadRegister(token).then((r) => r.types).catch(() => []);
    return renderForm(res, { editing, form: posted.form, types, errors: [apiError(error)], status: 422 });
  }
  return redirectTo(res, '/volunteering/qualifications?status=saved');
}));

router.get('/qualifications/:id(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const id = Number(req.params.id);
  let register;
  try {
    register = await loadRegister(token);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    throw error;
  }
  const record = register.items.find((row) => Number(row?.id) === id);
  if (!record || record.status === 'withdrawn') return notFound(res);
  return res.render('volunteering/my-qualification-withdraw', {
    title: t(`${KEY}withdraw.title`),
    activeNav: 'volunteering',
    qualification: present(record, t),
    reasons: REASONS.map((value) => ({ value, label: t(`${KEY}withdraw.reasons.${value}`) })),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/qualifications/:id(\\d+)/withdraw', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const reason = REASONS.includes(trimmed(req.body.reason)) ? trimmed(req.body.reason) : REASONS[0];
  try {
    await callVolunteeringApi(token, 'POST', `/qualifications/${encodeURIComponent(Number(req.params.id))}/withdraw`, { reason });
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    return redirectTo(res, '/volunteering/qualifications?status=withdraw-failed');
  }
  return redirectTo(res, '/volunteering/qualifications?status=withdrawn');
}));

module.exports = router;
