// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, callGroupExchangeApi, previewGroupExchange } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay } = require('../lib/form-replay');

const router = express.Router();
const GROUP_EXCHANGES_PATH = '/group-exchanges';

// The five kinds, in the order every form offers them. A new form starts on the first.
// This list only decides which number box on the create form belongs to the chosen kind -
// it is NOT a validator. Laravel is the one that refuses a kind it does not know.
const KINDS = ['workshop', 'team', 'equal', 'weighted', 'custom'];
const DEFAULT_KIND = KINDS[0];

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function decimalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function localUrl(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return urlFor(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(localUrl(res, pathname));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function resultId(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' ? positiveInteger(data.id) : null;
}

async function callApi(token, method, path, data = undefined) {
  if (data === undefined) {
    return callGroupExchangeApi(token, method, path);
  }

  return callGroupExchangeApi(token, method, path, data);
}

async function runAction(req, res, method, path, data, successRedirect, failureRedirect) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    const result = await callApi(token, method, path, data);
    const redirect = typeof successRedirect === 'function'
      ? successRedirect(result)
      : successRedirect;
    return redirectTo(res, redirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, failureRedirect);
  }
}

function exchangeRedirect(id, status) {
  return `${GROUP_EXCHANGES_PATH}/${id}?status=${encodeURIComponent(status)}#group-exchange-top`;
}

function exchangeCreateRedirect(status) {
  return `${GROUP_EXCHANGES_PATH}/new?status=${encodeURIComponent(status)}`;
}

function exchangeCreatedRedirect(result) {
  return `${GROUP_EXCHANGES_PATH}/${resultId(result) || 'new'}?status=created`;
}

/** The kind the member chose, exactly as chosen. A blank value is the form's own default. */
function kindFrom(body) {
  return trimmed(body.split_type) || DEFAULT_KIND;
}

// 🔴 Every kind has its OWN number box on the create form (`total_hours_workshop`,
// `total_hours_team`, ...) because the question differs - session length, hours per
// helper, or one total - and without JavaScript all five boxes are in the page at once.
// Reading the chosen kind's box is what stops a number typed for one kind being used for
// another. `total_hours` stays as the fallback for any caller that still posts it.
function totalHoursFrom(body, kind) {
  const own = KINDS.includes(kind) ? trimmed(body[`total_hours_${kind}`]) : '';
  const raw = own !== '' ? own : trimmed(body.total_hours);
  return { raw, number: decimalNumber(raw) };
}

function exchangePayload(body) {
  const kind = kindFrom(body);
  return {
    title: trimmed(body.title, 150),
    description: trimmed(body.description, 2000),
    total_hours: totalHoursFrom(body, kind).number,
    // 🔴 This used to be `custom` or else `equal`, which would have saved a workshop or a
    // team as "equal" without telling anyone. The kind goes to Laravel as chosen; it
    // answers 422 SPLIT_TYPE_INVALID for one it does not know.
    split_type: kind,
    status: 'draft'
  };
}

// Laravel's message for a kind it refuses is already in the member's language, so it is
// shown as it arrives rather than replaced by "something went wrong".
function kindRefusal(error) {
  if (!(error instanceof ApiError) || error.status !== 422) return '';
  const errors = error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  const refusal = errors.find((item) => item && item.code === 'SPLIT_TYPE_INVALID');
  return refusal ? trimmed(refusal.message || error.message) : '';
}

// 🔴 `hours` and `weight` mean different things in different kinds, and the add-a-person
// form only asks for the one that applies. What is sent:
//   workshop / custom  each person's own hours
//   team               helpers' own hours; the person helped pays the total, so a
//                      receiver's hours are not asked for and are sent as 0
//   equal              nothing per person (hours are sent only if somebody typed them)
//   weighted           a weight: 1 is a normal share, 2 is twice as much.
//                      GroupExchangeService shares the total by `weight`, so hours play no
//                      part. (This used to send the hours AS the weight, because there
//                      was no weight box.)
function participantPayload(body, splitType = 'equal') {
  const role = trimmed(body.role) === 'receiver' ? 'receiver' : 'provider';
  const typedHours = Math.max(0, decimalNumber(body.hours));
  const typedWeight = decimalNumber(body.weight);
  return {
    user_id: positiveInteger(body.participant_id || body.user_id) || 0,
    role,
    hours: splitType === 'team' && role === 'receiver' ? 0 : typedHours,
    weight: splitType === 'weighted' && typedWeight > 0 ? typedWeight : 1
  };
}

function splitTypeOf(result) {
  const data = dataFrom(result);
  const value = trimmed(data && typeof data === 'object' ? data.split_type : '');
  return KINDS.includes(value) ? value : 'equal';
}

router.post('/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());
  const payload = exchangePayload(req.body);
  // The single validation gate is title-or-hours, and it used to throw away the
  // 2,000-character description along with them.
  const replay = {
    title: trimmed(req.body.title, 150),
    description: trimmed(req.body.description, 2000),
    totalHours: totalHoursFrom(req.body, payload.split_type).raw,
    splitType: trimmed(req.body.split_type)
  };
  rememberFormReplay(req, 'groupExchange', 'create', replay);

  if (payload.title === '' || payload.total_hours <= 0) {
    return redirectTo(res, exchangeCreateRedirect('create-invalid'));
  }

  try {
    const result = await callApi(token, 'POST', '', payload);
    return redirectTo(res, exchangeCreatedRedirect(result));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    const problem = kindRefusal(error);
    if (problem) rememberFormReplay(req, 'groupExchange', 'create', { ...replay, problem });
    return redirectTo(res, exchangeCreateRedirect('create-failed'));
  }
}));

// What the preview needs from a person already in the exchange.
function previewParticipantOf(row) {
  const item = row && typeof row === 'object' ? row : {};
  const weight = decimalNumber(item.weight);
  return {
    user_id: positiveInteger(item.user_id ?? item.userId ?? item.id) || 0,
    role: trimmed(item.role) === 'receiver' ? 'receiver' : 'provider',
    hours: Math.max(0, decimalNumber(item.hours)),
    weight: weight > 0 ? weight : 1
  };
}

// "Check the hours". Laravel works out what everyone would earn or pay; nothing is saved.
// The people already in the exchange are sent together with the person being added (if
// the organiser has typed one), so the answer is what the exchange WOULD look like.
//
// Like every form here it answers with a redirect, and the result rides the session to the
// page that shows it (consumed once), so a refresh never re-asks and a back button never
// resubmits. What the organiser typed for the person comes back in the same stash.
async function checkTheHours(req, res, id, token, exchange) {
  const kind = splitTypeOf(exchange);
  const participants = (Array.isArray(exchange.participants) ? exchange.participants : [])
    .map(previewParticipantOf)
    .filter((participant) => participant.user_id > 0);

  const candidate = participantPayload(req.body, kind);
  if (candidate.user_id > 0) {
    const at = participants.findIndex((participant) => participant.user_id === candidate.user_id);
    if (at >= 0) participants[at] = candidate;
    else participants.push(candidate);
  }

  let result;
  try {
    result = await previewGroupExchange(token, {
      split_type: kind,
      total_hours: decimalNumber(exchange.total_hours),
      participants
    });
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, exchangeRedirect(id, 'check-failed'));
  }

  const query = trimmed(req.body.participant_q, 100);
  rememberFormReplay(req, 'groupExchange', `preview-${id}`, {
    result: dataFrom(result),
    candidate: candidate.user_id > 0
      ? {
        id: candidate.user_id,
        role: candidate.role,
        hours: trimmed(req.body.hours, 12),
        weight: trimmed(req.body.weight, 12)
      }
      : null
  });
  const search = query === '' ? '' : `&participant_q=${encodeURIComponent(query)}`;
  return redirectTo(res, `${GROUP_EXCHANGES_PATH}/${id}?status=checked${search}#hours-check`);
}

router.post('/:id(\\d+)/participants', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const checking = trimmed(req.body.action) === 'preview';
  let exchange = null;
  try {
    exchange = dataFrom(await callApi(token, 'GET', `/${encodeURIComponent(id)}`));
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    return redirectTo(res, exchangeRedirect(id, checking ? 'check-failed' : 'add-failed'));
  }
  exchange = exchange && typeof exchange === 'object' ? exchange : {};

  if (checking) return checkTheHours(req, res, id, token, exchange);

  return runAction(
    req,
    res,
    'POST',
    `/${id}/participants`,
    participantPayload(req.body, splitTypeOf(exchange)),
    exchangeRedirect(id, 'participant-added'),
    exchangeRedirect(id, 'add-failed')
  );
}));

router.post('/:id(\\d+)/participants/:participantUserId(\\d+)/remove', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const participantUserId = Number(req.params.participantUserId);
  return runAction(
    req,
    res,
    'DELETE',
    `/${id}/participants/${participantUserId}`,
    undefined,
    exchangeRedirect(id, 'participant-removed'),
    exchangeRedirect(id, 'failed')
  );
}));

// 🔴 This route DID NOT EXIST, which stalled the whole group-exchange workflow. Without
// it the status never left `draft`, so GroupExchangeService::start() never ran — and start
// is the ONLY caller of notifyParticipantsToConfirm(), so participants were expected to
// confirm having been told nothing. React only shows its Confirm button on
// `pending_confirmation`, so a React participant saw no way to act and the exchange
// deadlocked. Nothing was broken in Laravel: POST /v2/group-exchanges/{id}/start has been
// there all along (routes/api.php:3587).
router.post('/:id(\\d+)/start', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/${id}/start`,
    undefined,
    exchangeRedirect(id, 'started'),
    exchangeRedirect(id, 'start-failed')
  );
}));

router.post('/:id(\\d+)/confirm', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/${id}/confirm`,
    { terms_token: typeof req.body.terms_token === 'string' ? req.body.terms_token : '' },
    exchangeRedirect(id, 'confirmed'),
    exchangeRedirect(id, 'failed')
  );
}));

router.post('/:id(\\d+)/complete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/${id}/complete`,
    undefined,
    exchangeRedirect(id, 'completed'),
    exchangeRedirect(id, 'complete-failed')
  );
}));

router.post('/:id(\\d+)/cancel', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/${id}`,
    undefined,
    exchangeRedirect(id, 'cancelled'),
    exchangeRedirect(id, 'failed')
  );
}));

module.exports = router;
