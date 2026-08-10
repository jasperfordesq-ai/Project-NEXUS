// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callGroupExchangeApi, searchUsers } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatHours(value) {
  return numberValue(value).toFixed(2);
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function itemFrom(result) {
  const data = dataFrom(result);
  if (data && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function compactQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = trimmed(value);
    if (text !== '') query.append(key, text);
  }
  return query.toString();
}

function headline(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusDetails(status, t) {
  const normalized = trimmed(status).toLowerCase();
  const classes = {
    draft: 'govuk-tag--grey',
    pending: 'govuk-tag--yellow',
    approved: 'govuk-tag--blue',
    active: 'govuk-tag--turquoise',
    completed: 'govuk-tag--green',
    cancelled: 'govuk-tag--red',
    pending_participants: 'govuk-tag--yellow',
    pending_broker: 'govuk-tag--yellow',
    pending_confirmation: 'govuk-tag--yellow',
    disputed: 'govuk-tag--orange'
  };
  const localizedStatuses = new Set(['draft', 'pending', 'approved', 'active', 'completed', 'cancelled']);
  const key = classes[normalized] ? normalized : 'draft';
  const label = localizedStatuses.has(key) ? t(`group_exchanges.statuses.${key}`) : headline(key);
  return { key, label, className: classes[key] };
}

function normalizeExchange(item, t) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const status = statusDetails(row.status, t);
  return {
    ...row,
    id,
    title: trimmed(row.title) || t('group_exchanges.title'),
    description: trimmed(row.description),
    statusKey: status.key,
    statusLabel: status.label,
    statusClass: status.className,
    totalHours: formatHours(row.total_hours ?? row.totalHours),
    organizerId: positiveInteger(row.organizer_id ?? row.organizerId),
    participants: Array.isArray(row.participants) ? row.participants.map((participant) => normalizeParticipant(participant, t)) : [],
    calculatedSplit: Array.isArray(row.calculated_split ?? row.calculatedSplit)
      ? (row.calculated_split ?? row.calculatedSplit)
      : []
  };
}

function normalizeParticipant(item, t) {
  const row = item && typeof item === 'object' ? item : {};
  const userId = positiveInteger(row.user_id ?? row.userId ?? row.id);
  const role = trimmed(row.role) === 'receiver' ? 'receiver' : 'provider';
  const name = trimmed(row.name)
    || [row.first_name, row.last_name].map(trimmed).filter(Boolean).join(' ')
    || t('members.unknown_member');
  return {
    ...row,
    userId,
    name,
    role,
    roleLabel: t(role === 'receiver' ? 'group_exchanges.role_receiver' : 'group_exchanges.role_provider'),
    hours: formatHours(row.hours),
    confirmed: row.confirmed === true,
    confirmedLabel: t(row.confirmed === true ? 'group_exchanges.confirmed_yes' : 'group_exchanges.confirmed_no')
  };
}

function normalizeCandidate(item, t) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id ?? row.user_id ?? row.userId);
  const name = trimmed(row.name)
    || [row.first_name, row.last_name].map(trimmed).filter(Boolean).join(' ')
    || t('members.unknown_member');
  return { id, name };
}

function profileId(profileResult) {
  const profile = itemFrom(profileResult);
  return positiveInteger(profile.id ?? profile.user_id ?? profile.userId);
}

function stateMessage(status, t) {
  const key = trimmed(status);
  return ['created', 'participant-added', 'participant-removed', 'confirmed', 'completed', 'cancelled'].includes(key)
    ? t(`group_exchanges.states.${key}`)
    : '';
}

function errorMessage(status, t) {
  const key = trimmed(status);
  if (['create-invalid', 'create-failed'].includes(key)) return t('group_exchanges.states.failed');
  return ['add-failed', 'complete-failed', 'failed'].includes(key)
    ? t(`group_exchanges.states.${key}`)
    : '';
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const state = ['draft', 'pending', 'active', 'completed', 'cancelled'].includes(trimmed(req.query.state))
    ? trimmed(req.query.state)
    : '';
  const query = compactQuery({ limit: 50, status: state });
  const result = await callGroupExchangeApi(token, 'GET', `?${query}`);
  const exchanges = collectionFrom(result)
    .map((exchange) => normalizeExchange(exchange, res.locals.t))
    .filter((exchange) => exchange.id !== null);
  const status = trimmed(req.query.status);

  return res.render('group-exchanges/index', {
    title: 'Group exchanges',
    titleKey: 'group_exchanges.title',
    activeNav: 'group_exchanges',
    exchanges,
    exchangeState: state,
    status,
    successMessage: stateMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect() }));

router.get('/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const status = trimmed(req.query.status);
  return res.render('group-exchanges/create', {
    title: 'Start a group exchange',
    titleKey: 'group_exchanges.create_title',
    activeNav: 'group_exchanges',
    status,
    errorMessage: errorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect() }));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const [profileResult, exchangeResult] = await Promise.all([
    getRequestProfile(req, token),
    callGroupExchangeApi(token, 'GET', `/${id}`)
  ]);
  const viewerId = profileId(profileResult);
  const exchange = normalizeExchange({ id, ...itemFrom(exchangeResult) }, res.locals.t);
  const splitByUser = new Map(exchange.calculatedSplit.map((row) => [
    positiveInteger(row.user_id ?? row.userId),
    formatHours(row.hours)
  ]));
  const participants = exchange.participants.map((participant) => ({
    ...participant,
    hours: splitByUser.get(participant.userId) || participant.hours
  }));
  const isOrganizer = exchange.organizerId !== null && exchange.organizerId === viewerId;
  const viewerRow = participants.find((participant) => participant.userId === viewerId) || null;
  const isParticipant = viewerRow !== null;
  const isClosed = ['completed', 'cancelled'].includes(exchange.statusKey);
  const editable = isOrganizer && ['draft', 'pending', 'approved'].includes(exchange.statusKey);
  const allConfirmed = participants.length > 0 && participants.every((participant) => participant.confirmed);
  const participantQuery = trimmed(req.query.participant_q);
  let participantResults = [];

  if (editable && participantQuery !== '') {
    const existingIds = new Set(participants.map((participant) => participant.userId));
    participantResults = collectionFrom(await searchUsers(token, participantQuery, { limit: 20 }))
      .map((candidate) => normalizeCandidate(candidate, res.locals.t))
      .filter((candidate) => candidate.id !== null && !existingIds.has(candidate.id));
  }

  const status = trimmed(req.query.status);
  return res.render('group-exchanges/detail', {
    title: exchange.title,
    activeNav: 'group_exchanges',
    exchange,
    participants,
    isOrganizer,
    isParticipant,
    isClosed,
    editable,
    viewerConfirmed: viewerRow ? viewerRow.confirmed : false,
    allConfirmed,
    participantQuery,
    participantResults,
    status,
    successMessage: stateMessage(status, res.locals.t),
    errorMessage: errorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Group exchange not found' }));

module.exports = router;
