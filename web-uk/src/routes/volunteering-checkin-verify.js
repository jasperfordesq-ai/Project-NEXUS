// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The people who run a shift check a volunteer in and out from the volunteer's
 * check-in code (parity gap 6, 21 Oct 2026). The website's page for this is
 * CheckInVerifyPage.tsx at /volunteering/checkin/{token}; this is the same address on
 * the accessible site.
 *
 *   GET   /volunteering/checkin/:token             what happens next, and the result
 *   POST  /volunteering/checkin/:token/verify      confirm they have arrived
 *   POST  /volunteering/checkin/:token/checkout    check them out
 *
 * API: POST /v2/volunteering/checkin/verify/{token} → { user: { name }, ... } and
 * POST /v2/volunteering/checkin/checkout/{token}. The API decides who may do this
 * (the opportunity's managers; never the volunteer on their own code) and when (a
 * check-out is refused before the shift starts); its refusal is shown in its words.
 *
 * Nothing changes on GET: link checkers and scanners fetch addresses, and a check-in is
 * a change someone must choose, exactly as on the website.
 *
 * The volunteer's QR code still encodes the API's qr_url, the website's address for
 * this page (decided 7 Oct 2026, gap B6). This page serves a coordinator who uses the
 * accessible site and opens the same path here.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.checkin_verify.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'checkinVerify';

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

function refusalMessage(error, t) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  const message = trimmed(errors[0] && errors[0].message, 500);
  if (message) return message;
  if (isStatus(error, 404)) return t(`${KEY}invalid`);
  if (isStatus(error, 403)) return t(`${KEY}forbidden`);
  return t(`${KEY}error`);
}

function pagePath(code) {
  return `/volunteering/checkin/${code}`;
}

router.get('/checkin/:code([A-Za-z0-9]{16,128})', asyncRoute(async (req, res) => {
  if (!tokenFrom(req)) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const code = req.params.code;
  const outcome = consumeFormReplay(req, REPLAY, code) || {};
  const state = ['checked_in', 'checked_out', 'error'].includes(outcome.state) ? outcome.state : 'confirm';
  const name = trimmed(outcome.name);
  let heading = t(`${KEY}title`);
  if (state === 'checked_in') heading = name ? t(`${KEY}checked_in`, { name }) : t(`${KEY}checked_in_unnamed`);
  if (state === 'checked_out') heading = name ? t(`${KEY}checked_out`, { name }) : t(`${KEY}checked_out_unnamed`);

  return res.render('volunteering/checkin-verify', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    code,
    state,
    name,
    heading,
    errorMessage: state === 'error' ? trimmed(outcome.message, 500) || t(`${KEY}error`) : ''
  });
}, { redirectOn401: LOGIN }));

router.post('/checkin/:code([A-Za-z0-9]{16,128})/verify', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const code = req.params.code;
  let outcome;
  try {
    const result = await callVolunteeringApi(token, 'POST', `/checkin/verify/${encodeURIComponent(code)}`);
    const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
    outcome = { state: 'checked_in', name: trimmed(data && data.user && data.user.name) };
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    outcome = { state: 'error', message: refusalMessage(error, res.locals.t) };
  }
  rememberFormReplay(req, REPLAY, code, outcome);
  return redirectTo(res, pagePath(code));
}, { redirectOn401: LOGIN }));

router.post('/checkin/:code([A-Za-z0-9]{16,128})/checkout', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const code = req.params.code;
  let outcome;
  try {
    await callVolunteeringApi(token, 'POST', `/checkin/checkout/${encodeURIComponent(code)}`);
    // The name came back with the check-in; the form carries it on.
    outcome = { state: 'checked_out', name: trimmed(req.body && req.body.name) };
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    outcome = { state: 'error', message: refusalMessage(error, res.locals.t) };
  }
  rememberFormReplay(req, REPLAY, code, outcome);
  return redirectTo(res, pagePath(code));
}, { redirectOn401: LOGIN }));

module.exports = router;
