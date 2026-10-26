// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Optional identity verification (React `/verify-identity-optional`), 26 Oct 2026.
 *
 * The journey, step by step, with no JavaScript:
 *   1. status — a member who already holds the ID Verified badge is told so;
 *   2. date of birth, when the profile has none (GOV.UK three-field date);
 *   3. the one-time fee, when the community charges one and it is unpaid: the Pay
 *      button posts here, Laravel creates a Stripe-hosted payment page and the
 *      member is sent to it (303). Stripe sends them back with
 *      `?checkout=success&session_id=…` or `?checkout=cancelled`;
 *   4. the ID check itself: the Start button posts here, Laravel creates a Stripe
 *      Identity session and the member is sent to its hosted page, which returns
 *      them to `/verify-identity-optional/callback`.
 *
 * 🔴 The return address is NEVER proof of anything. `checkout=success` only
 * chooses the wording ("we are confirming your payment") while the status
 * endpoint — which asks Stripe — still says unpaid. Payment and verification are
 * only ever confirmed by the server. There is no polling: the member gets a
 * "Check again" link, which re-reads the status.
 */

const express = require('express');
const {
  ApiError,
  getIdentityVerificationStatus,
  saveIdentityDateOfBirth,
  createIdentityFeeCheckout,
  startIdentityVerification
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { composeDate } = require('../lib/date-input');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { absoluteUrl } = require('../lib/absolute-url');
const {
  consumePaymentFormToken,
  issuePaymentFormToken,
  recentCheckoutUrl,
  rememberCheckoutUrl,
  safeCheckoutUrl,
  safeStripeCheckoutUrl
} = require('../lib/payment-form-token');

const router = express.Router();

const PAGE = '/verify-identity-optional';
const CALLBACK = '/verify-identity-optional/callback';
const FEE_PURPOSE = 'identity-fee';
const START_PURPOSE = 'identity-start';
const LOGIN = '/login?status=auth-required';

const STATUS_MESSAGES = Object.freeze({
  paid: { type: 'success', key: 'govuk_alpha_settings.identity.payment_received' },
  'payment-in-progress': { type: 'error', key: 'govuk_alpha_settings.card_payment.in_progress' },
  'payment-failed': { type: 'error', key: 'govuk_alpha_settings.card_payment.start_failed' },
  'start-failed': { type: 'error', key: 'govuk_alpha_settings.identity.error_start_verification' },
  'form-expired': { type: 'error', key: 'govuk_alpha_settings.card_payment.form_expired' }
});

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function urlFor(res, pathname) {
  return typeof res.locals.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
}

function redirectTo(res, pathname) {
  return res.redirect(urlFor(res, pathname));
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : (result || {});
}

function apiErrorCode(error) {
  const data = error && error.data && typeof error.data === 'object' ? error.data : {};
  const first = Array.isArray(data.errors) && data.errors[0] && typeof data.errors[0] === 'object' ? data.errors[0] : {};
  return String(first.code || data.code || '').toUpperCase();
}

function rethrowAuth(error) {
  if (error instanceof ApiError && error.status === 401) throw error;
}

function forbidden(res) {
  return res.status(403).render('errors/403', {
    title: res.locals.t('govuk_alpha.error_pages.403_title'),
    reason: 'feature-disabled'
  });
}

function isFeatureOff(error) {
  return error instanceof ApiError && error.status === 403;
}

/** The step the member is on, read the way React reads the same status. */
function identityStep(status, { returnedFromCheck = false } = {}) {
  if (status.has_id_verified_badge === true) return 'verified';
  const session = status.latest_session && typeof status.latest_session === 'object' ? status.latest_session : null;
  const sessionStatus = session ? String(session.status || '') : '';
  if (sessionStatus === 'passed') return 'verified';
  if (sessionStatus === 'started' || sessionStatus === 'processing') return 'in_progress';
  // A session Stripe created but that has not moved yet: just back from the check,
  // it is "in progress"; otherwise the member has not begun and may start.
  if (sessionStatus === 'created') return returnedFromCheck ? 'in_progress' : 'start';
  if (sessionStatus === 'failed') return 'failed';
  if (status.user_has_dob !== true) return 'dob';
  if (Number(status.fee_cents) > 0 && status.payment_completed !== true) return 'payment';
  return 'start';
}

function feeLabel(res, cents, currency) {
  const code = /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'EUR';
  const amount = Number(cents);
  try {
    return res.locals.formatLocaleNumber(Number.isFinite(amount) ? amount / 100 : 0, { style: 'currency', currency: code });
  } catch {
    // An unrecognised code must not take the page down; the server still charges.
    return `${code} ${(Number.isFinite(amount) ? amount / 100 : 0).toLocaleString(getRequestIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function routeStatus(req, t) {
  const key = typeof req.query.status === 'string' ? req.query.status : '';
  const entry = STATUS_MESSAGES[key];
  return entry ? { key, type: entry.type, message: t(entry.key) } : null;
}

function checkoutReturn(req) {
  const value = typeof req.query.checkout === 'string' ? req.query.checkout : '';
  return value === 'success' || value === 'cancelled' ? value : '';
}

async function renderJourney(req, res, { returnedFromCheck = false, dob = null } = {}) {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;

  let status;
  try {
    status = dataFrom(await getIdentityVerificationStatus(token));
  } catch (error) {
    rethrowAuth(error);
    if (isFeatureOff(error)) return forbidden(res);
    return res.status(503).render('identity/verify', {
      title: t('govuk_alpha_settings.identity.page_title'),
      activeNav: 'account',
      step: 'error',
      loadError: t('govuk_alpha_settings.identity.error_check_status')
    });
  }

  const step = dob ? 'dob' : identityStep(status, { returnedFromCheck });
  const feeCents = Number(status.fee_cents) || 0;
  const checkout = checkoutReturn(req);
  const titles = {
    verified: 'page_title_verified',
    failed: 'page_title_failed',
    dob: 'page_title_dob',
    payment: 'page_title_payment'
  };
  const totalSteps = feeCents > 0 ? 3 : 2;
  const stepNumber = { dob: 1, payment: 2, start: totalSteps }[step] || null;
  const session = status.latest_session && typeof status.latest_session === 'object' ? status.latest_session : {};

  return res.status(dob ? 422 : 200).render('identity/verify', {
    title: t(`govuk_alpha_settings.identity.${titles[step] || 'page_title'}`),
    activeNav: 'account',
    step,
    stepLabel: stepNumber ? t('govuk_alpha_settings.identity.step_indicator', { current: stepNumber, total: totalSteps }) : '',
    feeLabel: feeCents > 0 ? feeLabel(res, feeCents, status.fee_currency) : '',
    failureReason: step === 'failed' ? String(session.failure_reason || '').trim().slice(0, 300) : '',
    // Back from Stripe with "success" while the server has not yet seen the money.
    confirmingPayment: step === 'payment' && checkout === 'success',
    paymentCancelled: step === 'payment' && checkout === 'cancelled',
    paymentReceived: checkout === 'success' && step !== 'payment',
    checkAgainHref: returnedFromCheck ? urlFor(res, CALLBACK) : urlFor(res, `${PAGE}${checkout === 'success' ? '?checkout=success' : ''}`),
    returnedFromCheck,
    status: routeStatus(req, t),
    dob,
    feeFormToken: step === 'payment' ? issuePaymentFormToken(req, FEE_PURPOSE) : '',
    startFormToken: ['start', 'failed', 'in_progress'].includes(step) ? issuePaymentFormToken(req, START_PURPOSE) : '',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

const authRedirect = { redirectOn401: LOGIN };

router.get('/', asyncRoute((req, res) => renderJourney(req, res), authRedirect));

// Where Stripe Identity sends the member back to. The status endpoint asks Stripe.
router.get('/callback', asyncRoute((req, res) => renderJourney(req, res, { returnedFromCheck: true }), authRedirect));

router.post('/date-of-birth', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;

  const date = composeDate(req.body, 'date_of_birth', { required: true });
  if (date.error) {
    return renderJourney(req, res, {
      dob: { parts: date.parts, error: t(`web_uk.date_input.${date.error}`), errorFields: date.errorFields }
    });
  }

  try {
    await saveIdentityDateOfBirth(token, date.value);
  } catch (error) {
    rethrowAuth(error);
    if (isFeatureOff(error) && apiErrorCode(error) === 'FEATURE_DISABLED') return forbidden(res);
    const code = apiErrorCode(error);
    const message = code === 'DATE_OF_BIRTH_UNDER_MINIMUM_AGE'
      ? t('govuk_alpha_settings.identity.dob_under_minimum_age')
      : (code === 'VALIDATION_INVALID_FORMAT' ? t('web_uk.date_input.date_invalid') : t('govuk_alpha_settings.identity.error_save_dob'));
    return renderJourney(req, res, {
      dob: { parts: date.parts, error: message, errorFields: ['day', 'month', 'year'] }
    });
  }

  return redirectTo(res, PAGE);
}, authRedirect));

router.post('/pay', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);

  if (!consumePaymentFormToken(req, FEE_PURPOSE, req.body.form_token)) {
    // A second press of the same Pay button: back to the page that was opened.
    const recent = recentCheckoutUrl(req, FEE_PURPOSE);
    if (recent) return res.redirect(303, recent);
    return redirectTo(res, `${PAGE}?status=form-expired`);
  }

  let result;
  try {
    result = dataFrom(await createIdentityFeeCheckout(token, absoluteUrl(req, res, PAGE)));
  } catch (error) {
    rethrowAuth(error);
    if (isFeatureOff(error)) return forbidden(res);
    if (error instanceof ApiError && error.status === 409) return redirectTo(res, `${PAGE}?status=payment-in-progress`);
    return redirectTo(res, `${PAGE}?status=payment-failed`);
  }

  if (result.already_paid === true || result.payment_required === false) {
    return redirectTo(res, `${PAGE}?status=paid`);
  }
  const checkoutUrl = safeStripeCheckoutUrl(result.checkout_url);
  if (!checkoutUrl) return redirectTo(res, `${PAGE}?status=payment-failed`);
  rememberCheckoutUrl(req, FEE_PURPOSE, checkoutUrl);
  return res.redirect(303, checkoutUrl);
}, authRedirect));

router.post('/start', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);

  if (!consumePaymentFormToken(req, START_PURPOSE, req.body.form_token)) {
    const recent = recentCheckoutUrl(req, START_PURPOSE);
    if (recent) return res.redirect(303, recent);
    return redirectTo(res, `${PAGE}?status=form-expired`);
  }

  let result;
  try {
    result = dataFrom(await startIdentityVerification(token, absoluteUrl(req, res, CALLBACK)));
  } catch (error) {
    rethrowAuth(error);
    const code = apiErrorCode(error);
    if (isFeatureOff(error) && code === 'FEATURE_DISABLED') return forbidden(res);
    // A missing step: the page works out which one from the status.
    if (code === 'DOB_REQUIRED' || code === 'PAYMENT_REQUIRED') return redirectTo(res, PAGE);
    return redirectTo(res, `${PAGE}?status=start-failed`);
  }

  if (result.already_verified === true) return redirectTo(res, PAGE);
  const redirectUrl = safeCheckoutUrl(result.redirect_url);
  if (!redirectUrl) return redirectTo(res, `${PAGE}?status=start-failed`);
  rememberCheckoutUrl(req, START_PURPOSE, redirectUrl);
  return res.redirect(303, redirectUrl);
}, authRedirect));

module.exports = router;
module.exports.identityStep = identityStep;
