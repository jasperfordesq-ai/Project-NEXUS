// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Small shared pieces for the group collaboration tools (group-qa, group-wiki,
 * group-tasks, group-analytics routes). Kept apart from routes/groups.js, which
 * another workstream owns.
 */

const { ApiError } = require('./api');
const { getRequestIntlLocale } = require('./request-intl-locale');

const NS = 'govuk_alpha_group_tools';

function text(value, limit = null) {
  const value2 = String(value ?? '').trim();
  return limit === null ? value2 : value2.slice(0, limit);
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && String(parsed) === String(value).trim() ? parsed : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function collectionFrom(result, key = null) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && key && Array.isArray(data[key])) return data[key];
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function objectFrom(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function urlFor(res, pathname) {
  return typeof res?.locals?.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
}

function redirectWithStatus(res, pathname, status, fragment = '') {
  const separator = pathname.includes('?') ? '&' : '?';
  return res.redirect(`${urlFor(res, pathname)}${status ? `${separator}status=${encodeURIComponent(status)}` : ''}${fragment}`);
}

function loginRedirect(res) {
  return res.redirect(urlFor(res, '/login?status=auth-required'));
}

function translator(res) {
  return typeof res?.locals?.t === 'function' ? res.locals.t : (key) => key;
}

/**
 * `?status=` codes become a banner. `codes` maps each allowed code to
 * `{ type: 'success'|'error', key }`; anything else is ignored, so a crafted
 * URL cannot inject text.
 */
function statusBanner(res, status, codes) {
  const code = text(status);
  if (!code || !Object.prototype.hasOwnProperty.call(codes, code)) return null;
  const t = translator(res);
  return { type: codes[code].type, message: t(`${NS}.${codes[code].key}`), field: codes[code].field || '' };
}

function dateTimeLabel(value) {
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function dateLabel(value) {
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(date);
}

/** Copy only the safe download headers through to the browser. */
function sendDownload(res, download, fallbackName, fallbackType) {
  const headers = download?.headers || {};
  const type = text(headers['content-type']) || fallbackType;
  const disposition = text(headers['content-disposition']) || `attachment; filename="${fallbackName}"`;
  res.set('Content-Type', type);
  res.set('Content-Disposition', disposition);
  res.set('Cache-Control', 'private, no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  return res.status(200).send(download?.body ?? Buffer.alloc(0));
}

module.exports = {
  NS,
  text,
  positiveInteger,
  dataFrom,
  collectionFrom,
  objectFrom,
  isAuthError,
  urlFor,
  redirectWithStatus,
  loginRedirect,
  translator,
  statusBanner,
  dateTimeLabel,
  dateLabel,
  sendDownload
};
