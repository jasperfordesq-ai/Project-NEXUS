// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * An organisation reviews the expense claims its volunteers have made (gap B7, part 1,
 * 7 Oct 2026). The accessible site let a volunteer claim an expense but gave the
 * organisation nowhere to see, approve, reject or pay it; the website has had this
 * (OrgExpensesTab.tsx) and these pages follow its rules.
 *
 *   GET   /volunteering/organisations/:orgId/expenses                          the claims
 *   POST  /volunteering/organisations/:orgId/expenses/:expenseId/review        approve / reject / paid
 *   GET   /volunteering/organisations/:orgId/expenses/:expenseId/receipt       the receipt file
 *
 * API: GET|PUT /v2/volunteering/organisations/{id}/expenses[/{expenseId}] and
 * GET .../{expenseId}/receipt. The API decides who may see and act (the organisation's
 * owner and administrators) and refuses a reviewer acting on their own claim; this page
 * also offers only the next steps the API accepts: pending → approve / reject,
 * approved → mark as paid. Rejected and paid are final.
 */

const express = require('express');
const { ApiError, callVolunteeringApi, downloadOrgExpenseReceipt } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.org_expenses.';
const EXPENSE_KEY = 'govuk_alpha_volunteering.expenses.';
const LOGIN = '/login?status=auth-required';
const FILTERS = ['pending', 'approved', 'paid', 'rejected', 'all'];
const STATUSES = ['pending', 'approved', 'rejected', 'paid'];
const TYPES = ['travel', 'meals', 'supplies', 'equipment', 'parking', 'other'];
const STATUS_TAGS = {
  pending: 'govuk-tag--yellow',
  approved: 'govuk-tag--blue',
  paid: 'govuk-tag--green',
  rejected: 'govuk-tag--red'
};
/** What the API accepts next for a claim in each state. */
const NEXT_STEPS = { pending: ['approved', 'rejected'], approved: ['paid'], rejected: [], paid: [] };
const DOWNLOAD_HEADERS = ['content-type', 'content-disposition', 'content-length', 'cache-control', 'pragma', 'expires'];
const MAX_NOTE = 1000;
const MAX_REFERENCE = 255;

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

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function apiCode(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed((errors[0] && errors[0].code) || (error && error.data && error.data.code)).toUpperCase();
}

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function errorPage(res, status) {
  const titles = { 403: 'error_pages.403_title', 404: 'error_pages.404_title', 429: 'error_pages.429_title', 503: 'error_pages.503_title' };
  return res.status(status).render(`errors/${status}`, { title: res.locals.t(titles[status]) });
}

function expensesPath(orgId, show, outcome) {
  const query = new URLSearchParams();
  if (show && show !== 'pending') query.set('show', show);
  if (outcome) query.set('status', outcome);
  const text = query.toString();
  return `/volunteering/organisations/${orgId}/expenses${text ? `?${text}` : ''}`;
}

function moneyLabel(amount, currency) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : '';
  const plain = () => new Intl.NumberFormat(getRequestIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  if (!code) return plain();
  try {
    return new Intl.NumberFormat(getRequestIntlLocale(), { style: 'currency', currency: code }).format(value);
  } catch {
    // A currency code Intl does not know: the amount, in the reader's own number format.
    return plain();
  }
}

function dateLabel(value) {
  const text = trimmed(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
}

function presentClaim(row, t, selfId) {
  const claim = row && typeof row === 'object' ? row : {};
  const status = STATUSES.includes(claim.status) ? claim.status : 'pending';
  const type = TYPES.includes(claim.expense_type) ? claim.expense_type : 'other';
  const isOwn = selfId !== null && positiveInteger(claim.user_id) === selfId;
  return {
    id: positiveInteger(claim.id),
    volunteerName: trimmed(claim.volunteer_name) || t(`${KEY}unknown_volunteer`),
    typeLabel: t(`${EXPENSE_KEY}type_${type}`),
    amountLabel: moneyLabel(claim.amount, claim.currency),
    description: trimmed(claim.description, 2000),
    submittedLabel: dateLabel(claim.submitted_at),
    status,
    statusLabel: t(`${EXPENSE_KEY}status_${status}`),
    statusClass: STATUS_TAGS[status],
    reviewNotes: trimmed(claim.review_notes, MAX_NOTE),
    paymentReference: trimmed(claim.payment_reference, MAX_REFERENCE),
    hasReceipt: claim.has_receipt === true,
    isOwn,
    nextSteps: isOwn ? [] : NEXT_STEPS[status]
  };
}

const OUTCOMES = {
  'expense-approved': ['success', 'approved_done'],
  'expense-rejected': ['success', 'rejected_done'],
  'expense-paid': ['success', 'paid_done'],
  'expense-already-handled': ['error', 'already_handled'],
  'expense-forbidden': ['error', 'review_forbidden'],
  'expense-failed': ['error', 'review_failed']
};

router.get('/organisations/:orgId(\\d+)/expenses', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const orgId = Number(req.params.orgId);
  const show = FILTERS.includes(trimmed(req.query.show)) ? trimmed(req.query.show) : 'pending';
  const cursor = trimmed(req.query.cursor, 500);

  const params = new URLSearchParams({ per_page: '20' });
  if (show !== 'all') params.set('status', show);
  if (cursor) params.set('cursor', cursor);

  let data;
  let orgName = '';
  let selfId = null;
  try {
    // The API works its totals out over the same status filter as the list, so on the
    // "Pending" view "Approved" and "Paid" would read 0. The totals always describe every
    // claim, so a filtered view asks once more, unfiltered, for one row and the totals.
    const [expenses, overall, stats, profile] = await Promise.all([
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/expenses?${params.toString()}`),
      show === 'all'
        ? Promise.resolve(null)
        : callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/expenses?per_page=1`).catch(() => null),
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/stats`).catch(() => null),
      getRequestProfile(req, token).catch(() => null)
    ]);
    data = dataOf(expenses) || {};
    const overallData = dataOf(overall);
    if (overallData && overallData.stats && typeof overallData.stats === 'object') {
      data = { ...data, stats: overallData.stats };
    }
    const statsData = dataOf(stats) || {};
    orgName = trimmed(statsData.org_name ?? statsData.orgName);
    const self = dataOf(profile) || {};
    selfId = positiveInteger(self.id);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return errorPage(res, 403);
    if (isStatus(error, 404)) return errorPage(res, 404);
    throw error;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const stats = data.stats && typeof data.stats === 'object' ? data.stats : {};
  const currency = trimmed(items[0]?.currency);
  const outcome = OUTCOMES[trimmed(req.query.status)] || null;

  return res.render('volunteering/org-expenses', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    orgId,
    orgName,
    show,
    filters: FILTERS.map((value) => ({
      value,
      label: value === 'all' ? t(`${KEY}filter_all`) : t(`${EXPENSE_KEY}status_${value}`),
      href: expensesPath(orgId, value),
      current: value === show
    })),
    stats: [
      { label: t(`${KEY}stat_pending`), value: moneyLabel(stats.pending_review, currency) },
      { label: t(`${KEY}stat_approved`), value: moneyLabel(stats.approved_total, currency) },
      { label: t(`${KEY}stat_paid`), value: moneyLabel(stats.paid_total, currency) },
      { label: t(`${KEY}stat_total`), value: moneyLabel(stats.total_submitted, currency) }
    ],
    claims: items.map((row) => presentClaim(row, t, selfId)).filter((claim) => claim.id),
    nextHref: data.has_more && data.cursor
      ? `/volunteering/organisations/${orgId}/expenses?${new URLSearchParams({ ...(show !== 'pending' ? { show } : {}), cursor: String(data.cursor) }).toString()}`
      : '',
    outcome: outcome ? { type: outcome[0], message: t(`${KEY}${outcome[1]}`) } : null,
    maxNote: MAX_NOTE,
    maxReference: MAX_REFERENCE,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/organisations/:orgId(\\d+)/expenses/:expenseId(\\d+)/review', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const orgId = Number(req.params.orgId);
  const expenseId = Number(req.params.expenseId);
  const show = FILTERS.includes(trimmed(req.body.show)) ? trimmed(req.body.show) : 'pending';
  const decision = trimmed(req.body.decision);
  if (!['approved', 'rejected', 'paid'].includes(decision)) {
    return redirectTo(res, expensesPath(orgId, show, 'expense-failed'));
  }

  const body = { status: decision };
  const notes = trimmed(req.body.review_notes, MAX_NOTE);
  const reference = trimmed(req.body.payment_reference, MAX_REFERENCE);
  if (decision === 'rejected' && notes) body.review_notes = notes;
  if (decision === 'paid' && reference) body.payment_reference = reference;

  try {
    await callVolunteeringApi(token, 'PUT', `/organisations/${encodeURIComponent(orgId)}/expenses/${encodeURIComponent(expenseId)}`, body);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    // 409 INVALID_STATE: someone else dealt with it first. 404: not this organisation's.
    if (isStatus(error, 409) || apiCode(error) === 'INVALID_STATE' || isStatus(error, 404)) {
      return redirectTo(res, expensesPath(orgId, show, 'expense-already-handled'));
    }
    if (isStatus(error, 403)) return redirectTo(res, expensesPath(orgId, show, 'expense-forbidden'));
    return redirectTo(res, expensesPath(orgId, show, 'expense-failed'));
  }
  return redirectTo(res, expensesPath(orgId, show, `expense-${decision}`));
}));

router.get('/organisations/:orgId(\\d+)/expenses/:expenseId(\\d+)/receipt', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  let download;
  try {
    download = await downloadOrgExpenseReceipt(token, Number(req.params.orgId), Number(req.params.expenseId));
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    if (isStatus(error, 403)) return errorPage(res, 403);
    if (isStatus(error, 404)) return errorPage(res, 404);
    if (isStatus(error, 429)) return errorPage(res, 429);
    return errorPage(res, 503);
  }
  res.status(download.status || 200);
  for (const header of DOWNLOAD_HEADERS) {
    if (download.headers && download.headers[header]) res.set(header, download.headers[header]);
  }
  // A receipt is a file a volunteer uploaded. Never let it render on this site's own
  // origin: the API already sends it as an attachment (Storage::download), and this
  // holds even if that ever stops being true.
  const disposition = String(res.get('content-disposition') || '');
  if (!/^attachment\b/i.test(disposition)) {
    res.set('Content-Disposition', `attachment; filename="receipt-${Number(req.params.expenseId)}"`);
  }
  res.set('X-Content-Type-Options', 'nosniff');
  return res.send(Buffer.isBuffer(download.body) ? download.body : Buffer.from(download.body || ''));
}));

module.exports = router;
