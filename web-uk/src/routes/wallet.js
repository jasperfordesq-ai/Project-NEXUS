// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { randomUUID } = require('crypto');
const { requireAuth } = require('../middleware/auth');
const {
  getBalance,
  getTransactions,
  transferWalletCredits,
  donateCredits,
  callWalletApi,
  callWalletDownload,
  ApiError
} = require('../lib/api');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { audit } = require('../lib/auditLogger');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

function dataFrom(result) {
  if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result;
}

function itemsFrom(result, key = 'items') {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data[key])) return data[key];
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function hoursValue(value) {
  return new Intl.NumberFormat(getRequestIntlLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(numberValue(value));
}

function monthYear(value, style = 'long') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { month: style, year: 'numeric' }).format(date);
}

function normalizeWallet(raw) {
  const wallet = dataFrom(raw) || {};
  const pendingIn = numberValue(wallet.pending_in ?? wallet.pending_incoming ?? wallet.pendingIn ?? wallet.pendingIncoming);
  const pendingOut = numberValue(wallet.pending_out ?? wallet.pending_outgoing ?? wallet.pendingOut ?? wallet.pendingOutgoing);
  return {
    balance: numberValue(wallet.balance),
    earned: numberValue(wallet.total_earned ?? wallet.totalEarned),
    spent: numberValue(wallet.total_spent ?? wallet.totalSpent),
    pendingIn,
    pendingOut,
    pendingTotal: pendingIn + pendingOut
  };
}

function normalizeFund(raw) {
  const fund = dataFrom(raw) || {};
  return {
    balance: numberValue(fund.balance),
    donated: numberValue(fund.total_donated ?? fund.totalDonated)
  };
}

function normalizeRecipient(row, t = (key) => key) {
  const recipient = row && typeof row === 'object' ? row : {};
  const id = Number.parseInt(recipient.id, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    name: String(recipient.name || [recipient.first_name, recipient.last_name].filter(Boolean).join(' ')).trim()
      || t('members.unknown_member'),
    location: String(recipient.location || '').trim(),
    since: String(recipient.since || '').trim() || monthYear(recipient.created_at ?? recipient.createdAt, 'short'),
    memberSince: monthYear(recipient.created_at ?? recipient.createdAt, 'long')
  };
}

function walletManageStatus(status, transferError = '', donateError = '', t = (key) => key) {
  const errors = {
    invalid: t('govuk_alpha_wallet.errors.invalid'),
    insufficient: t('govuk_alpha_wallet.errors.insufficient'),
    'not-found': t('govuk_alpha_wallet.errors.not_found'),
    self: t('govuk_alpha_wallet.errors.self'),
    inactive: t('govuk_alpha_wallet.errors.inactive'),
    'too-large': t('govuk_alpha_wallet.errors.too_large'),
    decimals: t('govuk_alpha_wallet.errors.decimals'),
    failed: t('govuk_alpha_wallet.errors.failed')
  };

  if (status === 'transfer-failed') {
    return { type: 'error', href: '#transfer', message: errors[transferError] || errors.failed };
  }
  if (status === 'donate-failed') {
    return { type: 'error', href: '#donate', message: errors[donateError] || errors.failed };
  }
  if (status === 'transfer-sent') {
    return { type: 'success', message: t('govuk_alpha_wallet.states.transfer_sent') };
  }
  if (status === 'donate-sent') {
    return { type: 'success', message: t('govuk_alpha_wallet.states.donate_sent') };
  }
  return null;
}

function transactionDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(date);
}

function transferRecipients(recipients) {
  return recipients.map((recipient) => ({
    ...recipient,
    idempotencyKey: randomUUID()
  }));
}

function firstApiError(error) {
  if (!(error instanceof ApiError) || !error.data || typeof error.data !== 'object') {
    return { code: '', message: error instanceof Error ? error.message : '' };
  }

  const errors = Array.isArray(error.data.errors) ? error.data.errors : [];
  const first = errors.find((item) => item && typeof item === 'object') || {};
  return {
    code: String(first.code || error.data.code || error.data.error || '').trim().toUpperCase(),
    message: String(first.message || error.message || '').trim()
  };
}

function transferFailureKey(error) {
  const { code, message } = firstApiError(error);

  if (code === 'INSUFFICIENT_FUNDS' || /insufficient/i.test(message)) return 'insufficient';
  if (code === 'NOT_FOUND' || error?.status === 404) return 'not-found';
  if (code === 'VALIDATION_ERROR' && /yourself/i.test(message)) return 'self';
  if (code === 'TRANSFER_FAILED' && /not active|inactive/i.test(message)) return 'inactive';
  if (code === 'VALIDATION_ERROR') return 'invalid';
  return 'failed';
}

function transferPayload(body = {}) {
  const recipient = Number(body.recipient_id);
  const amountText = String(body.amount ?? '').trim();
  const amount = Number(amountText);

  if (!Number.isInteger(recipient) || recipient <= 0 || !amountText || !Number.isFinite(amount) || amount <= 0) {
    return { error: 'invalid' };
  }
  if (amount > 1000) {
    return { error: 'too-large' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(amountText)) {
    return { error: 'decimals' };
  }

  return {
    payload: {
      recipient,
      amount,
      description: String(body.note || body.description || '').trim().slice(0, 255),
      idempotency_key: String(body.idempotency_key || '').trim()
    }
  };
}

function transferFailurePath(error) {
  return `/wallet?status=transfer-failed&error=${encodeURIComponent(error)}#transfer`;
}

function walletSearchQuery(query) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('limit', '10');
  return params.toString();
}

async function walletRecipientsFor(token, query, t) {
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return [];
  return itemsFrom(await callWalletApi(token, 'GET', `/user-search?${walletSearchQuery(trimmed)}`), 'users')
    .map((recipient) => normalizeRecipient(recipient, t))
    .filter(Boolean);
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

// Wallet overview
router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const txFilter = ['earned', 'spent', 'pending'].includes(String(req.query.filter || ''))
    ? String(req.query.filter)
    : 'all';
  const txType = txFilter === 'earned' ? 'received' : (txFilter === 'spent' ? 'sent' : (txFilter === 'pending' ? 'pending' : undefined));
  const txCursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
  const recipientQuery = String(req.query.recipient_q || '').trim();
  const [balanceData, transactionsData, fundData, recipients] = await Promise.all([
    getBalance(req.token),
    getTransactions(req.token, {
      per_page: 20,
      ...(txType ? { type: txType } : {}),
      ...(txCursor ? { cursor: txCursor } : {})
    }),
    callWalletApi(req.token, 'GET', '/community-fund'),
    walletRecipientsFor(req.token, recipientQuery, res.locals.t)
  ]);

  const wallet = normalizeWallet(balanceData);
  const transactions = itemsFrom(transactionsData).map((transaction) => {
    const otherUser = transaction.other_user || transaction.otherUser || {};
    return {
      ...transaction,
      isCredit: transaction.type === 'credit',
      otherName: String(otherUser.name || [otherUser.first_name, otherUser.last_name].filter(Boolean).join(' ')).trim()
        || res.locals.t('members.unknown_member'),
      dateLabel: transactionDate(transaction.created_at || transaction.createdAt),
      amountLabel: hoursValue(Math.abs(numberValue(transaction.amount))),
      descriptionLabel: String(transaction.description || '').trim()
    };
  });
  const txMeta = transactionsData?.meta || dataFrom(transactionsData)?.meta || {};

  res.render('wallet/index', {
    title: res.locals.t('wallet.title'),
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    wallet,
    fund: normalizeFund(fundData),
    recipients: transferRecipients(recipients),
    recipientQuery,
    transactions,
    txFilter,
    txNextCursor: txMeta.has_more && txMeta.cursor ? String(txMeta.cursor) : '',
    status: typeof req.query.status === 'string' ? req.query.status : '',
    transferError: typeof req.query.error === 'string' ? req.query.error : '',
    donateError: typeof req.query.donate_error === 'string' ? req.query.donate_error : '',
    hoursValue,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/export.csv', requireAuth, asyncRoute(async (req, res) => {
  const result = await callWalletDownload(req.token, '/statement');
  res.status(result.status || 200);
  const headers = result.headers || {};
  res.set('Content-Type', headers['content-type'] || 'text/csv; charset=utf-8');
  res.set('Content-Disposition', headers['content-disposition'] || 'attachment; filename="wallet_statement.csv"');
  if (headers['cache-control']) res.set('Cache-Control', headers['cache-control']);
  if (headers.pragma) res.set('Pragma', headers.pragma);
  if (headers.expires) res.set('Expires', headers.expires);
  return res.send(result.body);
}));

router.get('/recipients', asyncRoute(async (req, res) => {
  const token = req.signedCookies && req.signedCookies.token ? req.signedCookies.token : '';
  if (!token) {
    return res.status(401).json({ results: [] });
  }

  let recipients;
  try {
    recipients = await walletRecipientsFor(token, req.query.q, res.locals.t);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return res.status(401).json({ results: [] });
    }
    throw error;
  }
  return res.json({
    results: recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      location: recipient.location || null,
      since: recipient.since || null
    }))
  });
}));

router.get('/manage', requireAuth, asyncRoute(async (req, res) => {
  const recipientQuery = String(req.query.recipient_q || '').trim();
  const donateTarget = req.query.donate_target === 'user' ? 'user' : 'community_fund';
  const [walletRaw, fundRaw, recipients] = await Promise.all([
    callWalletApi(req.token, 'GET', '/balance'),
    callWalletApi(req.token, 'GET', '/community-fund'),
    walletRecipientsFor(req.token, recipientQuery, res.locals.t)
  ]);

  res.render('wallet/manage', {
    title: res.locals.t('govuk_alpha_wallet.manage.title'),
    wallet: normalizeWallet(walletRaw),
    fund: normalizeFund(fundRaw),
    recipients: transferRecipients(recipients),
    recipientQuery,
    donateTarget,
    status: walletManageStatus(req.query.status, req.query.error, req.query.donate_error, res.locals.t),
    hoursValue,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// Process transfer
router.post('/transfer', requireAuth, audit.walletTransfer(), asyncRoute(async (req, res) => {
  const normalized = transferPayload(req.body);
  if (normalized.error) {
    return redirectTo(res, transferFailurePath(normalized.error));
  }

  try {
    await transferWalletCredits(req.token, normalized.payload);
    return redirectTo(res, '/wallet?status=transfer-sent#transactions');
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;

    const { code } = firstApiError(error);
    if (error.status === 401) {
      handleApiError(error, req, res, { redirectOn401: '/login?status=auth-required' });
      return undefined;
    }
    if (error.status === 403 && code === 'ONBOARDING_REQUIRED') {
      return redirectTo(res, '/onboarding');
    }
    return redirectTo(res, transferFailurePath(transferFailureKey(error)));
  }
}));

function walletDonateFailure(error) {
  const encoded = encodeURIComponent(error || 'failed');
  return `/wallet?status=donate-failed&donate_error=${encoded}#donate`;
}

function walletDonationPayload(body) {
  const target = String(body.target || body.recipient_type || 'community_fund');
  const recipientId = String(body.recipient_id || '').trim();
  const amount = Number(body.amount);
  return {
    amount,
    message: String(body.message || '').trim().slice(0, 255),
    recipient_type: target === 'user' ? 'user' : 'community_fund',
    recipient_id: recipientId
  };
}

router.post('/donate', requireAuth, asyncRoute(async (req, res) => {
  const payload = walletDonationPayload(req.body);

  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    return redirectTo(res, walletDonateFailure('invalid'));
  }
  if (Math.round(payload.amount) !== payload.amount) {
    return redirectTo(res, walletDonateFailure('decimals'));
  }
  if (payload.amount > 1000) {
    return redirectTo(res, walletDonateFailure('too-large'));
  }
  if (payload.recipient_type === 'user' && (!payload.recipient_id || Number(payload.recipient_id) <= 0)) {
    return redirectTo(res, walletDonateFailure('invalid'));
  }

  try {
    await donateCredits(req.token, {
      recipient_type: payload.recipient_type,
      recipient_id: payload.recipient_type === 'user' ? Number(payload.recipient_id) : undefined,
      amount: payload.amount,
      message: payload.message
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    const message = String(error.message || '');
    if (/insufficient/i.test(message)) {
      return redirectTo(res, walletDonateFailure('insufficient'));
    }
    if (/not found|recipient/i.test(message)) {
      return redirectTo(res, walletDonateFailure('not-found'));
    }
    return redirectTo(res, walletDonateFailure('failed'));
  }

  return redirectTo(res, '/wallet?status=donate-sent#transactions');
}));

module.exports = router;
