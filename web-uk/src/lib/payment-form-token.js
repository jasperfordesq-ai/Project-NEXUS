// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { randomUUID, timingSafeEqual } = require('crypto');
const { URL } = require('url');

/**
 * Single-use form tokens for the forms that start a card payment (26 Oct 2026).
 *
 * A double click, a back-button resubmit or an impatient retry must not open two
 * payments. `data-prevent-double-click` needs JavaScript, and this site must work
 * without it, so the guard is server-side, modelled on the marketplace direct-buy
 * and listing exchange-request forms: mint a token when the form is shown, and
 * consume it on submit with a constant-time comparison. A second submission of
 * the same page can never match.
 *
 * Tokens are kept per purpose ("donation", "identity-fee", "dues:8") so two
 * payment pages open in two tabs do not invalidate each other.
 */

function sessionKey(purpose) {
  return `cardPaymentFormToken:${purpose}`;
}

function issuePaymentFormToken(req, purpose) {
  if (!req || !req.session) return '';
  const token = randomUUID();
  req.session[sessionKey(purpose)] = token;
  return token;
}

/** Consumes the token; true only for the one matching submission. */
function consumePaymentFormToken(req, purpose, submitted) {
  if (!req || !req.session) return false;
  const key = sessionKey(purpose);
  const expected = String(req.session[key] || '').trim();
  delete req.session[key];
  const actual = String(submitted || '').trim();
  if (expected === '' || actual === '') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * A payment page address from the API, only when it is an absolute https URL.
 * The member is redirected there, so nothing else (a relative path, javascript:,
 * an http page) is ever followed.
 */
function safeCheckoutUrl(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^https:\/\/[^\s/]+/i.test(text)) return '';
  try {
    return new URL(text).protocol === 'https:' ? text : '';
  } catch {
    return '';
  }
}

/**
 * A Stripe-hosted payment page address: https on checkout.stripe.com only. The
 * three card payments (identity fee, donations, club dues) are always Stripe
 * Checkout, so anything else the API returned is refused rather than followed.
 * (The identity CHECK itself may use another provider, so the start step keeps
 * safeCheckoutUrl.)
 */
function safeStripeCheckoutUrl(value) {
  const url = safeCheckoutUrl(value);
  if (!url) return '';
  try {
    return new URL(url).hostname.toLowerCase() === 'checkout.stripe.com' ? url : '';
  } catch {
    return '';
  }
}

const RECENT_CHECKOUT_MS = 15 * 60 * 1000;

function recentKey(purpose) {
  return `cardPaymentRecentCheckout:${purpose}`;
}

/**
 * Remember the payment page just opened, so a second submission of the same form
 * (a double click whose first response the browser abandoned) is sent to the SAME
 * page rather than told the form expired or starting a second payment.
 */
function rememberCheckoutUrl(req, purpose, url) {
  if (!req || !req.session || !url) return;
  req.session[recentKey(purpose)] = { url, at: Date.now() };
}

function recentCheckoutUrl(req, purpose) {
  const entry = req && req.session ? req.session[recentKey(purpose)] : null;
  if (!entry || typeof entry !== 'object') return '';
  if (!Number.isFinite(entry.at) || Date.now() - entry.at > RECENT_CHECKOUT_MS) return '';
  return safeCheckoutUrl(entry.url);
}

module.exports = {
  safeStripeCheckoutUrl,
  consumePaymentFormToken,
  issuePaymentFormToken,
  recentCheckoutUrl,
  rememberCheckoutUrl,
  safeCheckoutUrl
};
