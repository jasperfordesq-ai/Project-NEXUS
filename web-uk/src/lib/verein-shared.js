// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { ApiError } = require('./api');

/**
 * Shared helpers for the Clubs (Verein) pages: `routes/verein.js` (organiser
 * dues and import), `routes/verein-invitations.js` and `routes/verein-my-dues.js`.
 * Split from one file so the route matrix can see every route (it scans each
 * route file's `router.` declarations).
 */

const DUES_STATUSES = Object.freeze(['pending', 'paid', 'overdue', 'waived', 'refunded']);
const BILLING_CYCLES = Object.freeze(['annual', 'biennial', 'monthly']);
const CURRENCIES = Object.freeze(['CHF', 'EUR', 'GBP', 'USD']);
const DUES_TAGS = Object.freeze({
  paid: 'govuk-tag--green',
  waived: 'govuk-tag--green',
  pending: 'govuk-tag--yellow',
  overdue: 'govuk-tag--red'
});
const INVITE_TAGS = Object.freeze({
  sent: 'govuk-tag--blue',
  accepted: 'govuk-tag--green',
  declined: 'govuk-tag--red',
  expired: 'govuk-tag--yellow'
});
const IMPORT_SESSION_KEY = 'vereinImportCsv';
const CSV_MAX_BYTES = 1024 * 1024;

function v(t, key, params) {
  return t(`govuk_alpha_organisations.verein.${key}`, params);
}

function unwrap(result) {
  return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

function itemsFrom(result) {
  const data = unwrap(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function trimmed(value, limit = 255) {
  return String(value ?? '').trim().slice(0, limit);
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function decimal(value) {
  const text = trimmed(value, 16).replace(',', '.');
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? Number(text) : null;
}

function money(res, cents, currency) {
  const value = Number(cents);
  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? currency : 'CHF';
  return res.locals.formatLocaleNumber(Number.isFinite(value) ? value / 100 : 0, { style: 'currency', currency: code });
}

function dateLabel(res, value) {
  const text = trimmed(value, 40);
  return text ? res.locals.formatLocaleDate(text, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function forbidden(res) {
  return res.status(403).render('errors/403', {
    title: res.locals.t('govuk_alpha.error_pages.403_title'),
    reason: 'feature-disabled'
  });
}

function isForbidden(error) {
  return error instanceof ApiError && error.status === 403;
}

function rethrowAuth(error) {
  if (error instanceof ApiError && error.status === 401) throw error;
}

function withStatus(res, path, status, extra = {}) {
  const query = new URLSearchParams({ status, ...extra }).toString();
  return res.redirect(`${res.locals.urlFor(path)}?${query}`);
}

function duesStatusLabel(t, status) {
  return DUES_STATUSES.includes(status) ? v(t, `dues.status.${status}`) : trimmed(status, 32);
}

module.exports = {
  BILLING_CYCLES,
  CSV_MAX_BYTES,
  CURRENCIES,
  DUES_STATUSES,
  DUES_TAGS,
  IMPORT_SESSION_KEY,
  INVITE_TAGS,
  dateLabel,
  decimal,
  duesStatusLabel,
  forbidden,
  isForbidden,
  itemsFrom,
  money,
  positiveInt,
  rethrowAuth,
  trimmed,
  unwrap,
  v,
  withStatus
};
