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

// ---------------------------------------------------------------------------
// Time, and date+time together (for former `type="datetime-local"` fields).
// ---------------------------------------------------------------------------

/**
 * The GOV.UK "asking for times" pattern uses ONE free-text field, not hour/minute
 * spinners: "Let users enter the time in a way they're familiar with." So a single
 * `{name}-time` field is parsed liberally and normalised to 24-hour `HH:MM` — the
 * back half of the `YYYY-MM-DDTHH:MM` string these fields already post natively.
 *
 * Accepts: "9:30", "09:30", "9.30", "9:30am", "9:30 pm", "9am", "2 pm", "14:30", "0:00".
 * Rejects anything ambiguous or out of range rather than guessing.
 */
function parseTime(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (text === '') return null;
  const m = text.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3];
  if (minute > 59) return null;
  if (meridiem) {
    // 12-hour clock: 1–12 only. 12am = 00:00, 12pm = 12:00.
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'am') hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hour)}:${pad(minute)}`;
}

/** Read the single posted time part for a field name (raw, for re-populating the form). */
function timePart(body, name) {
  const source = body && typeof body === 'object' ? body : {};
  return digitsOnly(source[`${name}-time`]);
}

/**
 * @returns {{value: string|null, error: string|null, errorFields: string[], parts: {time: string}}}
 *   `value` is `HH:MM`; `error` is a translation-key suffix under `web_uk.date_input`.
 */
function composeTime(body, name, { required = false } = {}) {
  const raw = timePart(body, name);
  if (raw === '') {
    return required
      ? { value: null, error: 'time_required', errorFields: ['time'], parts: { time: '' } }
      : { value: null, error: null, errorFields: [], parts: { time: '' } };
  }
  const value = parseTime(raw);
  if (value === null) {
    return { value: null, error: 'time_invalid', errorFields: ['time'], parts: { time: raw } };
  }
  return { value, error: null, errorFields: [], parts: { time: raw } };
}

/** Split a stored ISO/`YYYY-MM-DDTHH:MM` value into the 24-hour `HH:MM` text, for re-render. */
function splitTime(value) {
  const text = String(value ?? '').trim();
  const match = text.match(/[T\s](\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const bare = text.match(/^(\d{1,2}):(\d{2})/);
  return bare ? `${bare[1].padStart(2, '0')}:${bare[2]}` : '';
}

/** Split a stored `YYYY-MM-DDTHH:MM` (or ISO) into date fields + time text for a form. */
function splitDateTime(value) {
  return { ...splitDate(value), time: splitTime(value) };
}

/**
 * Compose the three date fields plus the one time field into `YYYY-MM-DDTHH:MM` — the
 * exact shape the former native `datetime-local` input posted, so nothing downstream
 * changes. Date errors take precedence over time errors (a member reads top-to-bottom).
 */
function composeDateTime(body, name, { required = false } = {}) {
  const date = composeDate(body, name, { required });
  const time = composeTime(body, name, { required });
  if (date.error) {
    return { value: null, error: date.error, errorFields: date.errorFields, parts: { ...date.parts, time: time.parts.time } };
  }
  if (time.error) {
    return { value: null, error: time.error, errorFields: time.errorFields, parts: { ...date.parts, time: time.parts.time } };
  }
  // Both empty and optional: absent, not invalid.
  if (date.value === null && time.value === null) {
    return { value: null, error: null, errorFields: [], parts: { ...date.parts, time: time.parts.time } };
  }
  // One side filled, the other empty (and not required) is still incomplete — a datetime
  // needs both halves. Point at whichever half is missing.
  if (date.value === null) {
    return { value: null, error: 'day_required', errorFields: [...FIELD_SUFFIXES], parts: { ...date.parts, time: time.parts.time } };
  }
  if (time.value === null) {
    return { value: null, error: 'time_required', errorFields: ['time'], parts: { ...date.parts, time: time.parts.time } };
  }
  return { value: `${date.value}T${time.value}`, error: null, errorFields: [], parts: { ...date.parts, time: time.parts.time } };
}

/**
 * Read a datetime from EITHER shape, so a conversion cannot break existing callers.
 * Prefers a single `YYYY-MM-DDTHH:MM` value (an unconverted form, a client posting the
 * API shape, a bookmarked link) and otherwise reads the four GOV.UK fields.
 */
function readDateTime(body, name, options = {}) {
  const source = body && typeof body === 'object' ? body : {};
  const single = String(source[name] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(single)) {
    return { value: single.slice(0, 16), error: null, errorFields: [], parts: splitDateTime(single) };
  }
  if (single !== '' && !dateParts(source, name).day && timePart(source, name) === '') {
    return { value: null, error: 'date_invalid', errorFields: [...FIELD_SUFFIXES], parts: { day: '', month: '', year: '', time: '' } };
  }
  return composeDateTime(source, name, options);
}

module.exports = {
  composeDate, splitDate, dateParts, readDate, FIELD_SUFFIXES,
  parseTime, composeTime, splitTime, composeDateTime, splitDateTime, readDateTime,
};
