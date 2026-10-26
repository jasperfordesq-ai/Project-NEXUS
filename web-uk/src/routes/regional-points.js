// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const crypto = require('node:crypto');
const express = require('express');
const {
  ApiError,
  getRegionalPointsSummary,
  getRegionalPointsHistory,
  transferRegionalPoints,
  searchUsers,
  getUser
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

/**
 * Regional points — the community's third currency (React `wallet/regional-points`).
 *
 * Balance, recent activity and a member-to-member transfer, all from Laravel's
 * `/v2/caring-community/regional-points/*` endpoints. Gated on `caring_community`
 * (tenant-feature-gates.js) exactly as React's FeatureGate; Laravel also refuses
 * with FEATURE_DISABLED, and a community that has not switched the programme on
 * sees the same "not enabled here" message React shows.
 *
 * The transfer is HTML-first and mirrors React's F-225 rule: the recipient is
 * chosen by name from the member search (never a typed id), and the sender
 * confirms the recipient's name, read back from Laravel, before anything is sent.
 * The endpoint takes no idempotency key, so a one-time confirmation nonce in the
 * session stops a double submit sending twice.
 */

const HISTORY_LIMIT = 50;
const MESSAGE_MAX = 500;
const KNOWN_TYPES = new Set([
  'earned_for_hours', 'transfer_in', 'transfer_out', 'admin_issue',
  'admin_adjustment', 'redemption', 'reversal'
]);
const STATUS_KEYS = Object.freeze({
  sent: 'transfer.success',
  'choose-recipient': 'transfer.errors.choose_recipient',
  'invalid-amount': 'transfer.errors.invalid_amount',
  failed: 'errors.transfer_failed'
});

function unwrap(result) {
  return result && result.data && typeof result.data === 'object' ? result.data : (result || {});
}

function trimmed(value, limit = null) {
  const text = String(value ?? '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function positiveAmount(value) {
  const text = trimmed(value);
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return 0;
  const amount = Number(text.replace(',', '.'));
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function asList(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (value && Array.isArray(value.items)) return value.items;
  if (value && Array.isArray(value.data)) return value.data;
  return [];
}

function rp(t, key, params) {
  return t(`govuk_alpha_wallet.regional_points.${key}`, params);
}

function redirectWithStatus(res, status) {
  return res.redirect(`${res.locals.urlFor('/wallet/regional-points')}?status=${encodeURIComponent(status)}`);
}

function isUnavailable(error) {
  return error instanceof ApiError && [403, 404].includes(error.status);
}

/** Summary, or null when the programme is not enabled for this community. */
async function loadSummary(token) {
  try {
    const summary = unwrap(await getRegionalPointsSummary(token));
    if (summary.enabled === false || !summary.account) return null;
    return summary;
  } catch (error) {
    if (isUnavailable(error)) return null;
    throw error;
  }
}

function symbolFor(summary, t) {
  return trimmed(summary?.config?.symbol) || rp(t, 'default_symbol');
}

function formatPoints(res, value) {
  const number = Number(value);
  return res.locals.formatLocaleNumber(Number.isFinite(number) ? number : 0, { maximumFractionDigits: 2 });
}

function normalizeTransaction(item, res) {
  const t = res.locals.t;
  const type = trimmed(item?.type);
  const direction = item?.direction === 'out' ? 'out' : 'in';
  const createdAt = trimmed(item?.created_at);
  return {
    id: positiveInt(item?.id),
    typeLabel: KNOWN_TYPES.has(type) ? rp(t, `history.types.${type}`) : type.replace(/_/g, ' '),
    description: trimmed(item?.description),
    amountLabel: `${direction === 'out' ? '-' : '+'}${formatPoints(res, Math.abs(Number(item?.points) || 0))}`,
    direction,
    balanceAfterLabel: formatPoints(res, item?.balance_after),
    dateLabel: createdAt ? res.locals.formatLocaleDate(createdAt, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  };
}

function rethrowAuth(error) {
  if (error instanceof ApiError && error.status === 401) throw error;
  return null;
}

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const summary = await loadSummary(req.token);

  if (!summary) {
    return res.render('wallet/regional-points', {
      title: rp(t, 'title'),
      activeNav: 'wallet',
      unavailable: true
    });
  }

  let history = [];
  let historyFailed = false;
  try {
    history = asList(unwrap(await getRegionalPointsHistory(req.token, HISTORY_LIMIT)), 'items')
      .map((item) => normalizeTransaction(item, res));
  } catch (error) {
    rethrowAuth(error);
    historyFailed = true;
  }

  const ownId = positiveInt(summary.account.user_id);
  const transfersEnabled = summary.config?.member_transfers_enabled !== false;
  const query = trimmed(req.query.q, 100);
  let results = [];
  let searchTooShort = false;
  if (transfersEnabled && query !== '') {
    if (query.length < 2) {
      searchTooShort = true;
    } else {
      const found = await searchUsers(req.token, query, { limit: 8 }).catch(rethrowAuth);
      results = asList(unwrap(found), 'users')
        .map((user) => ({
          id: positiveInt(user?.id),
          name: trimmed(user?.name || `${user?.first_name || ''} ${user?.last_name || ''}`)
        }))
        .filter((user) => user.id > 0 && user.id !== ownId);
    }
  }

  const status = typeof req.query.status === 'string' && Object.hasOwn(STATUS_KEYS, req.query.status)
    ? req.query.status
    : '';
  const flashedError = req.session && typeof req.session.regionalPointsError === 'string'
    ? req.session.regionalPointsError
    : '';
  if (req.session) delete req.session.regionalPointsError;

  const chosenId = positiveInt(req.query.recipient);
  return res.render('wallet/regional-points', {
    title: rp(t, 'title'),
    activeNav: 'wallet',
    unavailable: false,
    label: trimmed(summary.config?.label) || rp(t, 'title'),
    symbol: symbolFor(summary, t),
    balanceLabel: formatPoints(res, summary.account.balance),
    earnedLabel: formatPoints(res, summary.account.lifetime_earned),
    spentLabel: formatPoints(res, summary.account.lifetime_spent),
    history,
    historyFailed,
    transfersEnabled,
    query,
    searched: query !== '' && !searchTooShort,
    searchTooShort,
    results,
    chosen: chosenId > 0 && chosenId !== ownId
      ? { id: chosenId, name: trimmed(req.query.recipient_name, 200) }
      : null,
    statusMessage: status
      ? { type: status === 'sent' ? 'success' : 'error', text: (status !== 'sent' && flashedError) || rp(t, STATUS_KEYS[status]) }
      : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * Check your answers. The recipient's name is read back from Laravel by id, so
 * the name the sender confirms is the account the points will reach.
 */
router.post('/review', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const recipientId = positiveInt(req.body?.recipient_user_id);
  const amount = positiveAmount(req.body?.points);
  const message = trimmed(req.body?.message, MESSAGE_MAX);

  if (recipientId <= 0) return redirectWithStatus(res, 'choose-recipient');
  if (amount <= 0) return redirectWithStatus(res, 'invalid-amount');

  const summary = await loadSummary(req.token);
  if (!summary) return redirectWithStatus(res, 'failed');
  if (positiveInt(summary.account.user_id) === recipientId) return redirectWithStatus(res, 'choose-recipient');

  let recipientName = '';
  try {
    const user = unwrap(await getUser(req.token, recipientId));
    recipientName = trimmed(user.name || `${user.first_name || ''} ${user.last_name || ''}`);
  } catch (error) {
    rethrowAuth(error);
    return redirectWithStatus(res, 'choose-recipient');
  }
  if (!recipientName) return redirectWithStatus(res, 'choose-recipient');
  // The profile hides a surname from other members, while the search the member
  // picked from shows the full name. Show that fuller name only when it agrees
  // with (begins with) the name Laravel returned for this id; otherwise the
  // profile name alone is shown.
  const chosenName = trimmed(req.body?.recipient_name, 200);
  if (chosenName && chosenName !== recipientName && chosenName.startsWith(`${recipientName} `)) {
    recipientName = chosenName;
  }

  const nonce = crypto.randomUUID();
  if (req.session) req.session.regionalPointsNonce = nonce;

  const symbol = symbolFor(summary, t);
  return res.render('wallet/regional-points-confirm', {
    title: rp(t, 'transfer.confirm_title', { points: formatPoints(res, amount), symbol, name: recipientName }),
    activeNav: 'wallet',
    recipientId,
    recipientName,
    amount: String(amount),
    amountLabel: formatPoints(res, amount),
    symbol,
    message,
    nonce,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/transfer', asyncRoute(async (req, res) => {
  const recipientId = positiveInt(req.body?.recipient_user_id);
  const amount = positiveAmount(req.body?.points);
  const message = trimmed(req.body?.message, MESSAGE_MAX);
  const nonce = trimmed(req.body?.nonce);
  const expected = req.session ? req.session.regionalPointsNonce : '';

  // A replayed or double-submitted confirmation is refused before the API: the
  // nonce is spent on first use. No outcome is claimed — on a double click the
  // browser shows this second response while the first may have succeeded, so
  // the member is returned to the page, where the activity list is the record.
  if (!nonce || !expected || nonce !== expected) {
    return res.redirect(res.locals.urlFor('/wallet/regional-points'));
  }
  delete req.session.regionalPointsNonce;

  if (recipientId <= 0) return redirectWithStatus(res, 'choose-recipient');
  if (amount <= 0) return redirectWithStatus(res, 'invalid-amount');

  try {
    await transferRegionalPoints(req.token, {
      recipient_user_id: recipientId,
      points: amount,
      message: message || null
    });
  } catch (error) {
    rethrowAuth(error);
    // Laravel's refusal is already in the member's language (insufficient
    // balance, transfers switched off, a safeguarding restriction).
    if (error instanceof ApiError && error.status < 500 && req.session && typeof error.message === 'string') {
      req.session.regionalPointsError = error.message.slice(0, 300);
    }
    return redirectWithStatus(res, 'failed');
  }

  return redirectWithStatus(res, 'sent');
}));

module.exports = router;
