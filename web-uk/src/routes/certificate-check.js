// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Public "check a volunteering certificate" page — no account needed (gap C1).
 *
 * The accessible twin of the website's CertificateCheckPage. Someone a
 * certificate was shown to enters the code printed on it and the volunteer's
 * name, and is told only whether they match:
 *   POST /api/v2/volunteering/certificates/check { code, name } → { valid, … }
 *
 * - A code in the address only prefills the box. Nothing is looked up until a
 *   name is entered, because the code alone must disclose nothing.
 * - The result is rendered straight from the POST, never redirected: the name
 *   would otherwise have to sit in the session or the query string.
 * - Gated on the tenant's `volunteering` feature. Off answers 404, not 403, for
 *   the same reason What's On does: a public page should not admit it exists.
 */

const express = require('express');
const { ApiError, checkVolunteerCertificate } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { flagEnabled } = require('../lib/accessible-shell');

const router = express.Router();

const PATH = '/verify-certificate';
const K = 'govuk_alpha_volunteering.certificate_check.';
// The API's own limits (VolunteerCertificateController::checkCertificate).
const MAX_CODE = 64;
const MAX_NAME = 200;

function asString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function volunteeringEnabled(req) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return true;
  return flagEnabled(tenant, 'volunteering', 'features', true);
}

function notFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
}

function dateLabel(res, value) {
  const text = asString(value);
  if (!text || typeof res.locals.formatLocaleDate !== 'function') return text;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = dateOnly
    ? new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])))
    : new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return res.locals.formatLocaleDate(date, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function numberLabel(res, value) {
  const number = Number.isFinite(Number(value)) ? Number(value) : 0;
  return typeof res.locals.formatLocaleNumber === 'function'
    ? res.locals.formatLocaleNumber(number, { maximumFractionDigits: 2 })
    : String(number);
}

/** Only what the certificate itself prints; anything else the API sends is dropped. */
function presentMatch(res, data) {
  const range = data.date_range && typeof data.date_range === 'object' ? data.date_range : {};
  const organisations = Array.isArray(data.organizations) ? data.organizations : [];
  const t = res.locals.t;
  return {
    name: asString(data.name),
    hoursLabel: numberLabel(res, data.total_hours),
    startLabel: dateLabel(res, range.start),
    endLabel: dateLabel(res, range.end),
    issuedLabel: dateLabel(res, data.generated_at),
    organisations: organisations.map((organisation) => t(`${K}organisation_hours`, {
      name: asString(organisation?.name) || t(`${K}independent`),
      hours: numberLabel(res, organisation?.hours)
    }))
  };
}

function render(res, view, status = 200) {
  return res.status(status).render('certificate-check', {
    title: res.locals.t(`${K}title`),
    errors: {},
    values: { code: '', name: '' },
    outcome: '',
    match: null,
    ...view
  });
}

function showForm(req, res) {
  if (!volunteeringEnabled(req)) return notFound(res);
  const fromAddress = asString(req.params.code);
  const code = fromAddress.length <= MAX_CODE ? fromAddress : '';
  return render(res, { values: { code, name: '' } });
}

router.get(PATH, showForm);
// Constrained inline (F-113/F-306 route guard): only a code-shaped value matches.
router.get(`${PATH}/:code([A-Za-z0-9-]+)`, showForm);

router.post(PATH, asyncRoute(async (req, res) => {
  if (!volunteeringEnabled(req)) return notFound(res);
  const t = res.locals.t;
  const values = { code: asString(req.body.code), name: asString(req.body.name) };

  const errors = {};
  if (!values.code) errors.code = t(`${K}code_required`);
  else if (values.code.length > MAX_CODE) errors.code = t(`${K}code_too_long`);
  if (!values.name) errors.name = t(`${K}name_required`);
  else if (values.name.length > MAX_NAME) errors.name = t(`${K}name_too_long`);
  if (Object.keys(errors).length > 0) {
    return render(res, { values, errors }, 400);
  }

  let response;
  try {
    response = await checkVolunteerCertificate(values.code, values.name);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return notFound(res);
    }
    const outcome = error instanceof ApiError && error.status === 429 ? 'rate-limited' : 'error';
    return render(res, { values, outcome }, outcome === 'rate-limited' ? 429 : 502);
  }

  const data = response && typeof response.data === 'object' && response.data !== null ? response.data : null;
  if (!data || typeof data.valid !== 'boolean') {
    return render(res, { values, outcome: 'error' }, 502);
  }
  if (!data.valid) {
    return render(res, { values, outcome: 'invalid' });
  }
  return render(res, { values, outcome: 'valid', match: presentMatch(res, data) });
}));

module.exports = router;
