// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared journey for reporting a member, or a direct message, to the community's
 * coordinators. Both reports take the same body — { category, details? } — and fail
 * the same ways, so the form, validation, error mapping and result pages live here
 * and the two routes only say what is being reported and where "back" goes.
 *
 * API: POST /api/v2/users/{id}/report and POST /api/v2/messages/{id}/report.
 * - 201 { data: { reported: true, report_id } }
 * - 422 VALIDATION_ERROR with `field` (category | details), or CANNOT_REPORT_SELF
 * - 404 NOT_FOUND, 409 ALREADY_REPORTED, 429 too many reports
 * `error.message` from the API is already translated into the member's language.
 */

const { ApiError } = require('./api');
const { handleApiError } = require('./routeHelpers');

const CATEGORIES = Object.freeze([
  'safeguarding_concern',
  'harassment',
  'inappropriate',
  'scam_or_fraud',
  'spam',
  'other'
]);
const DETAILS_MAX = 2000;
const KEY = 'govuk_alpha_members.concern_report';
const FIELDS = new Set(['category', 'details']);

function characterLength(value) {
  return Array.from(String(value || '')).length;
}

/** Read and check the submitted answers before anything is sent to the API. */
function readAnswers(body, t) {
  const source = body && typeof body === 'object' ? body : {};
  const category = String(source.category || '').trim();
  const details = String(source.details || '').trim();
  const errors = [];

  if (!CATEGORIES.includes(category)) {
    errors.push({ field: 'category', text: t(`${KEY}.errors.category_required`) });
  }
  if (characterLength(details) > DETAILS_MAX) {
    errors.push({ field: 'details', text: t(`${KEY}.errors.details_too_long`, { max: DETAILS_MAX }) });
  } else if (category === 'other' && details === '') {
    errors.push({ field: 'details', text: t(`${KEY}.errors.details_required`) });
  }

  return {
    values: { category: CATEGORIES.includes(category) ? category : '', details },
    payload: { category, ...(details ? { details } : {}) },
    errors
  };
}

function firstApiError(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const first = errors[0] && typeof errors[0] === 'object' ? errors[0] : {};
  return {
    code: String(first.code || data.code || '').trim().toUpperCase(),
    message: typeof first.message === 'string' ? first.message.trim() : '',
    field: FIELDS.has(first.field) ? first.field : null
  };
}

/**
 * Turn an API refusal into what the member should see. `kind` is one of
 * 'already' (an information page), 'form' (the form again with errors), or
 * 'handled' (auth/not-found/offline already answered by handleApiError).
 */
function classifyFailure(error, t) {
  if (!(error instanceof ApiError)) {
    return { kind: 'form', status: 502, errors: [{ field: 'category', text: t(`${KEY}.errors.failed`) }] };
  }
  const { code, message, field } = firstApiError(error);
  if (error.status === 409 || code === 'ALREADY_REPORTED') {
    return { kind: 'already' };
  }
  if (error.status === 422) {
    return {
      kind: 'form',
      status: 422,
      errors: [{ field: field || 'category', text: message || t(`${KEY}.errors.failed`) }]
    };
  }
  if (error.status === 429) {
    return { kind: 'form', status: 429, errors: [{ field: 'category', text: message || t(`${KEY}.errors.rate_limited`) }] };
  }
  return { kind: 'form', status: 502, errors: [{ field: 'category', text: t(`${KEY}.errors.failed`) }] };
}

function summaryList(errors) {
  return errors.map((error) => ({ text: error.text, href: `#${error.field}` }));
}

function fieldError(errors, field) {
  const match = errors.find((error) => error.field === field);
  return match ? match.text : '';
}

/**
 * @param {object} subject
 *   - formAction: path the form posts to (before urlFor)
 *   - backHref: path back to where the member came from (before urlFor)
 *   - backText: link text for that path (already translated)
 *   - doneHref: path the result pages link back to (before urlFor)
 */
function renderForm(req, res, subject, heading, { values = {}, errors = [], status = 200 } = {}) {
  return res.status(status).render('members/report', {
    title: heading,
    heading,
    formAction: subject.formAction,
    backHref: subject.backHref,
    backText: subject.backText,
    categories: CATEGORIES,
    detailsMax: DETAILS_MAX,
    values,
    errors: summaryList(errors),
    categoryError: fieldError(errors, 'category'),
    detailsError: fieldError(errors, 'details'),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

function renderResult(res, subject, result) {
  const t = res.locals.t;
  const already = result.kind === 'already';
  return res.status(200).render('members/report-result', {
    title: t(already ? `${KEY}.already_title` : `${KEY}.sent_title`),
    already,
    reportId: result.reportId || null,
    doneHref: subject.doneHref,
    doneText: subject.backText
  });
}

/**
 * Validate, send and answer a report. `send(token, payload)` calls the API.
 * `headingFor()` resolves the form heading (it may look the member up); it is only
 * awaited when the form has to be shown again, so a successful report costs one call.
 */
async function submitReport(req, res, { token, send, subject, headingFor, loginPath }) {
  const t = res.locals.t;
  const answers = readAnswers(req.body, t);
  if (answers.errors.length) {
    return renderForm(req, res, subject, await headingFor(), { values: answers.values, errors: answers.errors, status: 422 });
  }

  let result;
  try {
    result = await send(token, answers.payload);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) {
      handleApiError(error, req, res, { redirectOn401: loginPath });
      return undefined;
    }
    const failure = classifyFailure(error, t);
    if (failure.kind === 'already') {
      return renderResult(res, subject, { kind: 'already' });
    }
    return renderForm(req, res, subject, await headingFor(), { values: answers.values, errors: failure.errors, status: failure.status });
  }

  const data = result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : {};
  return renderResult(res, subject, { kind: 'sent', reportId: data.report_id });
}

module.exports = {
  CATEGORIES,
  DETAILS_MAX,
  KEY,
  readAnswers,
  classifyFailure,
  renderForm,
  submitReport
};
