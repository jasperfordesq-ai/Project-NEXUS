// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  ApiError,
  getMyVereinDues,
  createVereinDuesCheckout,
  getVereinDuesCheckoutStatus
} = require('../lib/api');
const { absoluteUrl } = require('../lib/absolute-url');
const {
  consumePaymentFormToken,
  issuePaymentFormToken,
  recentCheckoutUrl,
  rememberCheckoutUrl,
  safeStripeCheckoutUrl
} = require('../lib/payment-form-token');
const { asyncRoute } = require('../lib/routeHelpers');
const {
  DUES_TAGS,
  dateLabel,
  duesStatusLabel,
  forbidden,
  isForbidden,
  itemsFrom,
  money,
  positiveInt,
  rethrowAuth,
  trimmed,
  v
} = require('../lib/verein-shared');

/**
 * Clubs (Verein): a member's own dues (`/me/verein-dues`), and paying them by
 * card on Stripe's hosted payment page (26 Oct 2026).
 *
 * "Pay now" posts here; Laravel creates the payment page and the member is sent
 * to it (303). Stripe sends them back with `?checkout=success&dues=ID` or
 * `?checkout=cancelled&dues=ID`. 🔴 The address is never proof of payment: the
 * banner comes from `GET /me/verein-dues/{id}/checkout-status`, which asks
 * Stripe. The amount is never posted — the server charges its own record.
 */

const PAGE = '/me/verein-dues';

function duesPurpose(id) {
  return `dues:${id}`;
}

function payStatusMessage(t, status) {
  const messages = {
    'payment-in-progress': 'govuk_alpha_settings.card_payment.in_progress',
    'payment-failed': 'govuk_alpha_settings.card_payment.start_failed',
    'form-expired': 'govuk_alpha_settings.card_payment.form_expired'
  };
  return messages[status] ? t(messages[status]) : '';
}

/** What Stripe's return means, once the server has asked Stripe. */
async function checkoutOutcome(req) {
  const checkout = trimmed(req.query.checkout, 16);
  const duesId = positiveInt(req.query.dues);
  if (!['success', 'cancelled'].includes(checkout) || !duesId) return null;
  if (checkout === 'cancelled') return { state: 'cancelled', duesId };

  let status = '';
  try {
    const data = (await getVereinDuesCheckoutStatus(req.token, duesId)) || {};
    status = trimmed((data.data && data.data.status) || data.status, 32);
  } catch (error) {
    rethrowAuth(error);
    status = '';
  }
  if (status === 'paid') return { state: 'paid', duesId };
  if (status === 'pending' || status === 'overdue' || status === '') return { state: 'confirming', duesId };
  return { state: 'not-completed', duesId };
}

const router = express.Router();

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  let rows = [];
  let loadFailed = false;
  try {
    rows = itemsFrom(await getMyVereinDues(req.token)).map((row) => {
      const status = trimmed(row?.status, 32);
      return {
        id: positiveInt(row?.id),
        organisation: trimmed(row?.organization_name) || v(t, 'unnamed_club'),
        year: positiveInt(row?.membership_year),
        amountLabel: money(res, row?.amount_cents, row?.currency),
        status,
        statusLabel: duesStatusLabel(t, status),
        statusTag: DUES_TAGS[status] || 'govuk-tag--grey',
        dueLabel: dateLabel(res, row?.due_date),
        paidLabel: dateLabel(res, row?.paid_at),
        owed: status === 'pending' || status === 'overdue'
      };
    });
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    loadFailed = true;
  }

  const outcome = loadFailed ? null : await checkoutOutcome(req);
  // The list was read before Stripe was asked; show the row as paid once it is.
  if (outcome && outcome.state === 'paid') {
    rows = rows.map((row) => (row.id === outcome.duesId && row.owed
      ? { ...row, status: 'paid', statusLabel: duesStatusLabel(t, 'paid'), statusTag: DUES_TAGS.paid || 'govuk-tag--green', owed: false }
      : row));
  }
  for (const row of rows) {
    row.formToken = row.owed && row.id ? issuePaymentFormToken(req, duesPurpose(row.id)) : '';
  }

  return res.render('verein/my-dues', {
    title: v(t, 'dues.my_title'),
    activeNav: 'account',
    rows,
    anyOwed: rows.some((row) => row.owed),
    loadFailed,
    outcome,
    checkAgainHref: outcome ? res.locals.urlFor(`${PAGE}?checkout=success&dues=${outcome.duesId}`) : '',
    payError: payStatusMessage(t, trimmed(req.query.status, 40)),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:id(\\d+)/pay', asyncRoute(async (req, res) => {
  const id = positiveInt(req.params.id);
  const purpose = duesPurpose(id);
  const back = (status) => res.redirect(`${res.locals.urlFor(PAGE)}?status=${status}`);

  if (!consumePaymentFormToken(req, purpose, req.body.form_token)) {
    // A second press of the same button goes to the page the first one opened.
    const recent = recentCheckoutUrl(req, purpose);
    if (recent) return res.redirect(303, recent);
    return back('form-expired');
  }

  let data;
  try {
    const result = (await createVereinDuesCheckout(req.token, id, absoluteUrl(req, res, PAGE))) || {};
    data = result.data && typeof result.data === 'object' ? result.data : result;
  } catch (error) {
    rethrowAuth(error);
    if (isForbidden(error)) return forbidden(res);
    if (error instanceof ApiError && error.status === 409) return back('payment-in-progress');
    return back('payment-failed');
  }

  if (data.already_paid === true) {
    return res.redirect(`${res.locals.urlFor(PAGE)}?checkout=success&dues=${id}`);
  }
  const checkoutUrl = safeStripeCheckoutUrl(data.checkout_url);
  if (!checkoutUrl) return back('payment-failed');
  rememberCheckoutUrl(req, purpose, checkoutUrl);
  return res.redirect(303, checkoutUrl);
}));


module.exports = router;
