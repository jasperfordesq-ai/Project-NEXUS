// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callGroupExchangeApi, searchUsers } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { consumeFormReplay } = require('../lib/form-replay');
const { getRequestProfile } = require('../lib/request-profile');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { createChoiceTranslator } = require('../lib/localization');

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

// Inside a sentence ("Tom pays 2 hours") a trailing ".00" reads as noise.
function formatHoursInSentence(value) {
  return numberValue(value).toLocaleString(getRequestIntlLocale(), { maximumFractionDigits: 2 });
}

// A number as it goes back into an input: 2, not 2.00.
function plainNumber(value) {
  const number = numberValue(value);
  return number > 0 ? String(number) : '';
}

// The five kinds, in the order every form offers them. Anything else (there should be
// nothing else) is shown as a headline of its stored value rather than hidden.
const KINDS = ['workshop', 'team', 'equal', 'weighted', 'custom'];
const KINDS_ASKING_HOURS_PER_PERSON = ['workshop', 'team', 'custom'];
const KINDS_PRE_FILLING_HOURS = ['workshop', 'team'];
const HOURS_LABEL_KEYS = {
  workshop: 'group_exchanges.session_length_label',
  team: 'group_exchanges.hours_per_helper_label'
};

function kindDetails(value, t) {
  const key = trimmed(value).toLowerCase();
  if (KINDS.includes(key)) return { key, label: t(`group_exchanges.kinds.${key}.title`) };
  return { key: '', label: key ? headline(key) : '' };
}

function choiceTranslatorFor(res) {
  return typeof res.locals.tc === 'function' ? res.locals.tc : createChoiceTranslator('en');
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
  const kind = kindDetails(row.split_type ?? row.splitType, t);
  return {
    ...row,
    id,
    title: trimmed(row.title) || t('group_exchanges.title'),
    description: trimmed(row.description),
    statusKey: status.key,
    statusLabel: status.label,
    statusClass: status.className,
    kindKey: kind.key,
    kindLabel: kind.label,
    hoursLabel: t(HOURS_LABEL_KEYS[kind.key] || 'group_exchanges.total_hours_label'),
    totalHours: formatHours(row.total_hours ?? row.totalHours),
    totalHoursPlain: plainNumber(row.total_hours ?? row.totalHours),
    communityFundHours: numberValue(row.community_fund_hours ?? row.communityFundHours),
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
    hoursEntered: row.hours,
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
  if (['create-invalid', 'create-failed', 'check-failed'].includes(key)) return t('group_exchanges.states.failed');
  // `start-failed` names the two things start() actually rejects for — a role with nobody
  // in it, and a split that does not balance — so the organiser can act on it rather than
  // being told "something went wrong".
  return ['add-failed', 'start-failed', 'complete-failed', 'failed'].includes(key)
    ? t(`group_exchanges.states.${key}`)
    : '';
}

/**
 * One line per person, a line for the community time fund when it gets a share, and one
 * line of totals. The same shape serves a preview from Laravel and the saved split of an
 * exchange, so the two can never be worded differently.
 *
 * `lines` are `{ role, name, hours }`; a giver earns, a receiver pays.
 */
function buildHoursSummary({ lines, fundHours }, t, tc) {
  let earned = 0;
  let paid = 0;
  const rows = lines.map((line) => {
    const hours = numberValue(line.hours);
    const earning = line.role !== 'receiver';
    if (earning) earned += hours;
    else paid += hours;
    return {
      roleLabel: t(earning ? 'group_exchanges.role_provider' : 'group_exchanges.role_receiver'),
      text: tc(
        earning ? 'group_exchanges.summary.earns' : 'group_exchanges.summary.pays',
        hours,
        // A "|" in a name would be read as a plural separator, so it is shown as "/".
        { name: String(line.name || t('group_exchanges.summary.unknown_member')).replace(/\|/g, '/'), hours: formatHoursInSentence(hours) }
      )
    };
  });

  const fund = numberValue(fundHours);
  const figures = { paid: formatHoursInSentence(paid), earned: formatHoursInSentence(earned), fund: formatHoursInSentence(fund) };
  return {
    rows,
    fund: fund > 0
      ? {
        label: t('group_exchanges.summary.fund_label'),
        text: tc('group_exchanges.summary.to_fund', fund, { hours: figures.fund })
      }
      : null,
    totals: t(fund > 0 ? 'group_exchanges.summary.totals_with_fund' : 'group_exchanges.summary.totals', figures)
  };
}

/** What Laravel's preview said, ready to show. A split that cannot go ahead has a problem and no lines. */
function previewView(stash, t, tc) {
  const result = stash && stash.result && typeof stash.result === 'object' ? stash.result : {};
  const problem = result.problem && typeof result.problem === 'object' ? trimmed(result.problem.message) : '';
  const lines = Array.isArray(result.lines) ? result.lines : [];
  return {
    problem,
    summary: problem === ''
      ? buildHoursSummary({
        lines: lines.map((line) => ({
          role: trimmed(line && line.role),
          name: trimmed(line && line.name),
          hours: line && line.hours
        })),
        fundHours: result.community_fund_hours ?? (result.totals && result.totals.to_fund)
      }, t, tc)
      : null,
    candidate: stash && stash.candidate && typeof stash.candidate === 'object' ? stash.candidate : null
  };
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
  const exchangeForm = consumeFormReplay(req, 'groupExchange', 'create');
  const replayedKind = exchangeForm ? trimmed(exchangeForm.splitType) : '';
  return res.render('group-exchanges/create', {
    title: 'Start a group exchange',
    titleKey: 'group_exchanges.create_title',
    activeNav: 'group_exchanges',
    status,
    kinds: KINDS,
    // Workshop unless the member had chosen another of the five and the form is coming back.
    selectedKind: KINDS.includes(replayedKind) ? replayedKind : KINDS[0],
    exchangeForm,
    // Laravel's own words when it refused the kind; otherwise the plain "try again".
    kindProblem: exchangeForm && exchangeForm.problem ? trimmed(exchangeForm.problem) : '',
    errorMessage: errorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect() }));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const [profileResult, exchangeResult] = await Promise.all([
    getRequestProfile(req, token),
    callGroupExchangeApi(token, 'GET', `/${encodeURIComponent(id)}`)
  ]);
  const viewerId = profileId(profileResult);
  const exchange = normalizeExchange({ id, ...itemFrom(exchangeResult) }, res.locals.t);
  const splitByUser = new Map(exchange.calculatedSplit.map((row) => [
    positiveInteger(row.user_id ?? row.userId),
    formatHours(row.hours)
  ]));
  const rawSplitByUser = new Map(exchange.calculatedSplit.map((row) => [
    positiveInteger(row.user_id ?? row.userId),
    numberValue(row.hours)
  ]));
  const participants = exchange.participants.map((participant) => ({
    ...participant,
    hours: splitByUser.get(participant.userId) || participant.hours,
    // What this person earns or pays: the split when there is one, else what was entered.
    hoursValue: rawSplitByUser.has(participant.userId)
      ? rawSplitByUser.get(participant.userId)
      : numberValue(participant.hoursEntered)
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

  // The saved split: what each person earns or pays once the exchange settles. Shown only
  // when it says something (an equal or weighted exchange with nobody in it has no lines
  // worth reading).
  const tc = choiceTranslatorFor(res);
  const savedSplit = buildHoursSummary({
    lines: participants.map((participant) => ({
      role: participant.role,
      name: participant.name,
      hours: participant.hoursValue
    })),
    fundHours: exchange.communityFundHours
  }, res.locals.t, tc);
  const savedSplitHasHours = participants.some((participant) => participant.hoursValue > 0);

  // 🔴 "You will earn / pay N hours" is the sentence that has to be right before Confirm.
  const viewerHours = viewerRow ? viewerRow.hoursValue : 0;
  const viewerWill = viewerRow && viewerHours > 0
    ? tc(
      viewerRow.role === 'receiver' ? 'group_exchanges.summary.you_pay' : 'group_exchanges.summary.you_earn',
      viewerHours,
      { hours: formatHoursInSentence(viewerHours) }
    )
    : '';

  // "Check the hours" comes back through the session, once.
  const stash = consumeFormReplay(req, 'groupExchange', `preview-${id}`);
  const check = stash ? previewView(stash, res.locals.t, tc) : null;

  // What the add-a-person form asks for depends on the kind, and nothing else:
  // hours for a workshop, a team's helpers or a typed-out exchange; a weight for a
  // weighted one; nothing at all for equal. A workshop and a team start from the number
  // already given for the exchange, so the organiser only changes the exceptions.
  const kind = exchange.kindKey;
  const addForm = {
    askHours: kind === '' || KINDS_ASKING_HOURS_PER_PERSON.includes(kind),
    hoursRequired: kind === 'custom',
    hoursPrefill: KINDS_PRE_FILLING_HOURS.includes(kind) ? exchange.totalHoursPlain : '',
    hoursHintKey: KINDS_ASKING_HOURS_PER_PERSON.includes(kind) ? `group_exchanges.add_hours_hint.${kind}` : '',
    askWeight: kind === 'weighted'
  };

  const status = trimmed(req.query.status);
  return res.render('group-exchanges/detail', {
    title: exchange.title,
    activeNav: 'group_exchanges',
    exchange,
    participants,
    savedSplit: savedSplitHasHours ? savedSplit : null,
    viewerWill,
    check,
    addForm,
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
