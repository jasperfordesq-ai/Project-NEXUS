// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

// Write a review of a volunteering organisation (React OrganisationDetailPage).
// The organisation detail page itself is served from server.js; this module
// holds only the review form's submit handler and the status it reports back.
//
// POST /v2/volunteering/reviews { target_type: 'organization', target_id, rating,
// comment? }. The API decides who may review (a member who has volunteered with
// the organisation, once) and says why when it refuses; that reason is shown.

const { ApiError, callVolunteeringApi } = require('../lib/api');

const REVIEW_STATUS_KEYS = Object.freeze({
  'review-saved': { type: 'success', key: 'govuk_alpha_organisations.reviews.saved' },
  'review-failed': { type: 'error', key: 'govuk_alpha_organisations.reviews.failed' },
  'review-rating-required': { type: 'error', key: 'govuk_alpha_organisations.reviews.rating_required' }
});

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function refusalReason(error) {
  if (!(error instanceof ApiError)) return '';
  const data = error.data && typeof error.data === 'object' ? error.data : {};
  const first = Array.isArray(data.errors) && data.errors[0] && typeof data.errors[0] === 'object' ? data.errors[0] : {};
  return trimmed(first.message || data.message || '', 500);
}

async function submitOrganisationReview(req, res, next) {
  try {
    const token = (req.signedCookies && req.signedCookies.token) || '';
    if (!token) return redirectTo(res, '/login?status=auth-required');

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return next();

    const rating = Number(req.body && req.body.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return redirectTo(res, `/organisations/${id}?status=review-rating-required#write-review`);
    }

    const payload = { target_type: 'organization', target_id: id, rating };
    const comment = trimmed(req.body && req.body.comment, 2000);
    if (comment) payload.comment = comment;

    try {
      await callVolunteeringApi(token, 'POST', '/reviews', payload);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return redirectTo(res, '/login?status=auth-required');
      }
      const reason = refusalReason(error);
      if (reason && typeof req.flash === 'function') req.flash('organisationReviewRefusal', reason);
      return redirectTo(res, `/organisations/${id}?status=review-failed#write-review`);
    }

    return redirectTo(res, `/organisations/${id}?status=review-saved#reviews`);
  } catch (error) {
    return next(error);
  }
}

// The review form's state for the organisation page: which status to report and
// in what words. An API refusal reason (kept in the flash) wins over the generic
// failure message.
function organisationReviewView(req, res) {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const entry = REVIEW_STATUS_KEYS[status];
  const t = typeof res.locals.t === 'function' ? res.locals.t : (key) => key;
  const refusals = typeof req.flash === 'function' ? req.flash('organisationReviewRefusal') : [];
  const refusal = status === 'review-failed' && refusals.length > 0 ? trimmed(refusals[0], 500) : '';

  return {
    status: entry ? status : '',
    successText: entry && entry.type === 'success' ? t(entry.key) : '',
    errorText: entry && entry.type === 'error' ? (refusal || t(entry.key)) : '',
    reviewErrorText: refusal
  };
}

module.exports = { submitOrganisationReview, organisationReviewView };
