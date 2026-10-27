// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Small shared pieces for the group gallery, challenges, channels and webhooks
 * pages: tenant-aware redirects, status banners from `?status=` and reading the
 * Laravel error envelope. Every outcome is a redirect to a GET page carrying a
 * status code, so the pages work without JavaScript and a refresh never repeats
 * a POST.
 */

const { ApiError } = require('./api');

function text(value, limit = null) {
  const trimmed = String(value ?? '').trim();
  return limit === null ? trimmed : trimmed.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function urlFor(res, path) {
  return typeof res?.locals?.urlFor === 'function' ? res.locals.urlFor(path) : path;
}

/** `/groups/1/gallery?status=x` through the tenant-aware URL helper. */
function statusPath(res, path, status, fragment = '') {
  const joiner = path.includes('?') ? '&' : '?';
  return `${urlFor(res, path)}${joiner}status=${encodeURIComponent(status)}${fragment}`;
}

function redirectWithStatus(res, path, status, fragment = '') {
  return res.redirect(statusPath(res, path, status, fragment));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function loginRedirect(res) {
  return res.redirect(urlFor(res, '/login?status=auth-required'));
}

function apiErrorEntries(error) {
  return error instanceof ApiError && Array.isArray(error.data?.errors)
    ? error.data.errors.filter((entry) => entry && typeof entry === 'object')
    : [];
}

function apiErrorCode(error) {
  const first = apiErrorEntries(error)[0] || {};
  return text(first.code || error?.data?.code || error?.data?.error).toUpperCase();
}

function apiErrorField(error) {
  const first = apiErrorEntries(error)[0] || {};
  return text(first.field || error?.data?.field);
}

function isSafeguardingRefusal(error) {
  const code = apiErrorCode(error);
  return code.startsWith('SAFEGUARDING_') || code === 'VETTING_REQUIRED';
}

/**
 * The banner for a `?status=` value. Unknown values show nothing, so a crafted
 * link cannot put arbitrary text on the page.
 *
 * @param {Function} t translator
 * @param {string} prefix translation key prefix, e.g. `govuk_alpha_group_media.gallery.states`
 * @param {string} status the raw query value
 * @param {Set<string>} successStates
 * @param {Set<string>} errorStates
 * @param {Object<string,string>} fieldFor status → field id, for the error-summary link
 */
function statusBanner(t, prefix, status, successStates, errorStates, fieldFor = {}) {
  const value = text(status);
  if (successStates.has(value)) {
    return {
      type: 'success',
      title: t('govuk_alpha_groups.common.success_title'),
      message: t(`${prefix}.${value}`)
    };
  }
  if (errorStates.has(value)) {
    return {
      type: 'error',
      title: t('govuk_alpha_groups.common.error_title'),
      message: t(`${prefix}.${value}`),
      field: fieldFor[value] || null
    };
  }
  return null;
}

function dateLabel(value, locale) {
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateTimeLabel(value, locale) {
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(raw.includes('T') || raw.includes('Z') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

module.exports = {
  text,
  positiveInteger,
  dataFrom,
  urlFor,
  statusPath,
  redirectWithStatus,
  isAuthError,
  loginRedirect,
  apiErrorCode,
  apiErrorField,
  isSafeguardingRefusal,
  statusBanner,
  dateLabel,
  dateTimeLabel
};
