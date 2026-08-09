// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, callGroupExchangeApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();
const GROUP_EXCHANGES_PATH = '/group-exchanges';

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

function exchangePayload(body) {
  const splitType = trimmed(body.split_type) === 'custom' ? 'custom' : 'equal';
  return {
    title: trimmed(body.title, 150),
    description: trimmed(body.description, 2000),
    total_hours: decimalNumber(body.total_hours),
    split_type: splitType,
    status: 'draft'
  };
}

function participantPayload(body) {
  const role = trimmed(body.role) === 'receiver' ? 'receiver' : 'provider';
  const hours = decimalNumber(body.hours);
  return {
    user_id: positiveInteger(body.participant_id || body.user_id) || 0,
    role,
    hours: Math.max(0, hours),
    weight: 1
  };
}

router.post('/new', asyncRoute(async (req, res) => {
  if (!tokenFrom(req)) return redirectTo(res, loginRedirect());
  const payload = exchangePayload(req.body);
  if (payload.title === '' || payload.total_hours <= 0) {
    return redirectTo(res, exchangeCreateRedirect('create-invalid'));
  }

  return runAction(
    req,
    res,
    'POST',
    '',
    payload,
    exchangeCreatedRedirect,
    exchangeCreateRedirect('create-failed')
  );
}));

router.post('/:id(\\d+)/participants', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/${id}/participants`,
    participantPayload(req.body),
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

router.post('/:id(\\d+)/confirm', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/${id}/confirm`,
    undefined,
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
