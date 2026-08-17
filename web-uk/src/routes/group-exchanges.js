// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callGroupExchangeApi, searchUsers } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

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
  return numberValue(value).toLocaleString(getRequestIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// 🔴 The real `group_exchanges.status` enum is exactly: draft, pending_participants,
// pending_broker, active, pending_confirmation, completed, cancelled, disputed.
// `pending` and `approved` were invented here and are NOT statuses — they were in this
// map and in the `editable` list, which is why an exchange sitting in the real
// `pending_participants` state could not be edited. They are gone.
//
// Every status now has a translated label. Four of them used to fall through to
// headline(), which produced English ("Pending Confirmation") in all eleven languages;
// three reuse the reviewed wording already written for one-to-one exchanges, so the two
// exchange types describe the same state the same way.
const STATUS_TAG_CLASSES = {
  draft: 'govuk-tag--grey',
  pending_participants: 'govuk-tag--yellow',
  pending_broker: 'govuk-tag--yellow',
  active: 'govuk-tag--turquoise',
  pending_confirmation: 'govuk-tag--yellow',
  completed: 'govuk-tag--green',
  cancelled: 'govuk-tag--red',
  disputed: 'govuk-tag--orange'
};

const STATUS_LABEL_KEYS = {
  draft: 'group_exchanges.statuses.draft',
  pending_participants: 'group_exchanges.statuses.pending_participants',
  pending_broker: 'exchanges.statuses.pending_broker',
  active: 'group_exchanges.statuses.active',
  pending_confirmation: 'exchanges.statuses.pending_confirmation',
  completed: 'group_exchanges.statuses.completed',
  cancelled: 'group_exchanges.statuses.cancelled',
  disputed: 'exchanges.statuses.disputed'
};

/** Statuses in which the organiser may still change who is taking part, and start. */
const OPEN_STATUSES = ['draft', 'pending_participants'];

function statusDetails(status, t) {
  const normalized = trimmed(status).toLowerCase();
  const key = STATUS_TAG_CLASSES[normalized] ? normalized : 'draft';
  return {
    key,
    label: t(STATUS_LABEL_KEYS[key]) || headline(key),
    className: STATUS_TAG_CLASSES[key]
  };
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
  return ['created', 'participant-added', 'participant-removed', 'started', 'confirmed', 'completed', 'cancelled'].includes(key)
    ? t(`group_exchanges.states.${key}`)
    : '';
}

function errorMessage(status, t) {
  const key = trimmed(status);
  if (['create-invalid', 'create-failed'].includes(key)) return t('group_exchanges.states.failed');
  // `start-failed` names the two things start() actually rejects for — a role with nobody
  // in it, and a split that does not balance — so the organiser can act on it rather than
  // being told "something went wrong".
  return ['add-failed', 'start-failed', 'complete-failed', 'failed'].includes(key)
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
  // 🔴 A DISPUTED exchange must not be completable from here. The API refuses only
  // `completed` and `cancelled` and otherwise just requires every participant to have
  // confirmed — so with all confirmations in place, completing a disputed exchange
  // MOVED THE CREDITS. React requires `pending_confirmation`. `disputed` is not added
  // to `isClosed` because Cancel lives in the same block and cancelling a disputed
  // exchange is a legitimate thing for an organiser to do.
  const isDisputed = exchange.statusKey === 'disputed';
  const editable = isOrganizer && OPEN_STATUSES.includes(exchange.statusKey);
  const allConfirmed = participants.length > 0 && participants.every((participant) => participant.confirmed);

  // 🔴 The exchange could not be STARTED from here at all — there was no /start route and
  // no button. That left the workflow stuck: the status never left `draft`, so
  // GroupExchangeService::start() never ran, and start is the ONLY caller of
  // notifyParticipantsToConfirm(). Participants were therefore asked to confirm with no
  // notification of any kind, and a React participant looking at the same exchange saw no
  // Confirm button at all (React requires `pending_confirmation`), so it deadlocked.
  //
  // Gating mirrors React exactly: start needs at least one giver and one receiver, and
  // confirm/complete require the exchange to have actually started. Offering Confirm on a
  // draft — which this page did — asked people to confirm something not yet under way.
  const providerCount = participants.filter((participant) => participant.role === 'provider').length;
  const receiverCount = participants.filter((participant) => participant.role === 'receiver').length;
  const canStart = isOrganizer
    && OPEN_STATUSES.includes(exchange.statusKey)
    && providerCount >= 1
    && receiverCount >= 1;
  // Shown when the organiser cannot start yet, so the reason is visible rather than the
  // button silently missing.
  const startNeedsParticipants = isOrganizer
    && OPEN_STATUSES.includes(exchange.statusKey)
    && !(providerCount >= 1 && receiverCount >= 1);
  const isStarted = exchange.statusKey === 'pending_confirmation';
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
    isDisputed,
    isStarted,
    canStart,
    startNeedsParticipants,
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
