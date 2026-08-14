// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Server side of the GOV.UK three-field date pattern.
 *
 * 🔴 Why not `<input type="date">`: GOV.UK guidance is explicit that native date pickers
 * fail users. They behave differently in every browser, the mobile calendar cannot
 * practically reach a date years in the past, the display format is decided by the device
 * rather than the service, and validation messages cannot be presented in the service's
 * own style. GDS asks for three plain number fields instead.
 *
 * The browser posts one value from a native input; three fields post three. This turns
 * `{name}-day`, `{name}-month`, `{name}-year` back into the single `YYYY-MM-DD` string
 * every existing route and the Laravel API already expect, so nothing downstream changes.
 *
 * 🔴 Parsing is deliberately LIBERAL about form and STRICT about meaning, which is what
 * GDS asks for: "3" and "03" are both March, surrounding spaces are ignored — but 31
 * February is rejected rather than rolled forward to 3 March, which is what
 * `new Date(2026, 1, 31)` would silently do.
 */

const FIELD_SUFFIXES = ['day', 'month', 'year'];

function digitsOnly(value) {
  return String(value ?? '').trim();
}

/**
 * Read the three posted parts for a field name.
 * @returns {{day: string, month: string, year: string}} raw, for re-populating the form
 */
function dateParts(body, name) {
  const source = body && typeof body === 'object' ? body : {};
  return {
    day: digitsOnly(source[`${name}-day`]),
    month: digitsOnly(source[`${name}-month`]),
    year: digitsOnly(source[`${name}-year`]),
  };
}

/**
 * @returns {{value: string|null, error: string|null, errorFields: string[], parts: object}}
 *   `error` is a translation key suffix under `web_uk.date_input`, never a message.
 */
function composeDate(body, name, { required = false } = {}) {
  const parts = dateParts(body, name);
  const empty = FIELD_SUFFIXES.filter((f) => parts[f] === '');

  // Nothing entered at all: absent rather than invalid, unless the field is required.
  if (empty.length === FIELD_SUFFIXES.length) {
    return required
      ? { value: null, error: 'day_required', errorFields: [...FIELD_SUFFIXES], parts }
      : { value: null, error: null, errorFields: [], parts };
  }

  // 🔴 Partly filled is always an error, even when the field is optional. Silently
  // discarding a half-entered date loses what the member typed without telling them.
  if (empty.length > 0) {
    const missing = empty[0];
    return { value: null, error: `${missing}_required`, errorFields: empty, parts };
  }

  if (!/^\d{1,2}$/.test(parts.day) || !/^\d{1,2}$/.test(parts.month) || !/^\d{4}$/.test(parts.year)) {
    // A two-digit year is rejected rather than guessed: "26" could be 1926 or 2026, and
    // guessing wrong on a date of birth or a deadline is worse than asking again.
    return { value: null, error: 'date_invalid', errorFields: [...FIELD_SUFFIXES], parts };
  }

  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);

  // Round-trip through Date and compare: this is what rejects 31 February and 31 April,
  // which the constructor would otherwise roll silently into the next month.
  const candidate = new Date(Date.UTC(year, month - 1, day));
  const real = candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;

  if (!real) {
    return { value: null, error: 'date_invalid', errorFields: [...FIELD_SUFFIXES], parts };
  }

  const pad = (n) => String(n).padStart(2, '0');
  return {
    value: `${year}-${pad(month)}-${pad(day)}`,
    error: null,
    errorFields: [],
    parts,
  };
}

/**
 * Split a stored `YYYY-MM-DD` (or an ISO timestamp) back into three fields, so an edit
 * form and a re-render after a validation failure both show what is already there.
 */
function splitDate(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return { day: '', month: '', year: '' };
  return {
    // Leading zeros stripped: the fields accept either, and "3" reads more naturally to
    // someone checking what they entered.
    day: String(Number(match[3])),
    month: String(Number(match[2])),
    year: match[1],
  };
}

/**
 * Read a date from EITHER shape, so a conversion cannot break existing callers.
 *
 * Prefers a single `YYYY-MM-DD` value when one is present — which covers a form not yet
 * converted, a bookmarked GET filter URL like `?date_from=2027-03-01`, and any client
 * posting the API shape directly — and otherwise reads the three GOV.UK fields.
 *
 * 🔴 Use this in route handlers rather than `composeDate` directly. Every field converted
 * in this codebase has at least one of those older callers, and dropping them silently
 * would break shared links.
 */
function readDate(body, name, options = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const single = String(source[name] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(single)) {
    return { value: single, error: null, errorFields: [], parts: splitDate(single) };
  }
  // A single value that is present but malformed is an error, not an invitation to look
  // for three fields that are not there.
  if (single !== '' && !dateParts(source, name).day) {
    return { value: null, error: 'date_invalid', errorFields: [...FIELD_SUFFIXES], parts: { day: '', month: '', year: '' } };
  }
  return composeDate(source, name, options);
}

module.exports = { composeDate, splitDate, dateParts, readDate, FIELD_SUFFIXES };
