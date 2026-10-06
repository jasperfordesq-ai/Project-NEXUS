// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Shift management for the people who run a volunteering opportunity.
 *
 * Until 2026-10-06 an organiser on the accessible site could not create, change or
 * remove a shift at all: their own opportunity page showed the volunteer "Apply" form
 * and "No scheduled shifts". The React website gained the same controls the same day
 * (react-frontend/src/components/volunteering/ShiftManager.tsx and ShiftRosterModal.tsx),
 * and these pages follow their behaviour and wording, laid out as GOV.UK pages: one
 * thing per page, a confirmation page before anything destructive, and an error summary
 * that links to the field.
 *
 *   GET       /volunteering/opportunities/:id/shifts                          the list
 *   GET|POST  /volunteering/opportunities/:id/shifts/new                      add a shift
 *   GET|POST  /volunteering/opportunities/:id/shifts/:shiftId/edit            change it
 *   GET|POST  /volunteering/opportunities/:id/shifts/:shiftId/remove          remove it
 *   GET       /volunteering/opportunities/:id/shifts/:shiftId/roster          who's coming
 *   GET|POST  /volunteering/opportunities/:id/repeating/new                   set up a pattern
 *   GET|POST  /volunteering/opportunities/:id/repeating/:patternId/stop       stop a pattern
 *
 * Who may see these pages is decided by the API: the opportunity's `can_manage` (its
 * creator, the organisation's owner or administrators, a community admin) or `is_owner`.
 * Anyone else gets the 403 page, the same refusal the organisation safeguarding pages
 * give. Every write is refused by the API for a non-manager too, whatever this file does.
 *
 * Times: shifts are stored and sent as the platform's wall-clock time
 * ("YYYY-MM-DD HH:mm:ss", Laravel's application timezone, which is UTC). They are read
 * and shown here without any timezone conversion, so 09:00 typed is 09:00 shown.
 *
 * Mounted before routes/volunteering-actions.js, which owns the volunteer's shift
 * sign-up and cancel actions under the same opportunity path.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { composeDate, splitDate, parseTime } = require('../lib/date-input');
const { formatRequestList } = require('../lib/list-format');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.shift_manager.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'volunteeringShifts';
const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly'];
/** Frequencies that repeat on chosen weekdays; the API refuses them without any. */
const WEEKDAY_FREQUENCIES = ['weekly', 'biweekly'];
/** ISO weekday numbers, Monday first, as the API stores them. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
/** Upper bounds that keep a typo (an extra zero or five) from reaching the API. */
const MAX_PLACES = 100000;
const MAX_OCCURRENCES = 1000;

// ── Small helpers ────────────────────────────────────────────────────────────

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

function wholeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function isApiStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function apiFirstError(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return errors[0] && typeof errors[0] === 'object' ? errors[0] : {};
}

function apiErrorCode(error) {
  const first = apiFirstError(error);
  return trimmed(first.code || (error && error.data && error.data.code)).toUpperCase();
}

function shiftsPath(opportunityId) {
  return `/volunteering/opportunities/${opportunityId}/shifts`;
}

function manageRedirect(opportunityId, status, count = null) {
  const query = new URLSearchParams({ status });
  if (count !== null) query.set('count', String(wholeNumber(count)));
  return `${shiftsPath(opportunityId)}?${query.toString()}`;
}

function forbidden(res) {
  return res.status(403).render('errors/403', { title: res.locals.t('error_pages.403_title') });
}

function notFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
}

/**
 * The refusals every page and action answers the same way. Returns true when it has
 * responded. 401 → sign in again; 403 → the refusal page; 404 → not found.
 */
function answerRefusal(error, res) {
  if (isApiStatus(error, 401)) {
    redirectTo(res, LOGIN);
    return true;
  }
  if (isApiStatus(error, 403) && apiErrorCode(error) !== 'FEATURE_DISABLED') {
    forbidden(res);
    return true;
  }
  if (isApiStatus(error, 404)) {
    notFound(res);
    return true;
  }
  return false;
}

// ── Dates and times ──────────────────────────────────────────────────────────

/**
 * A shift time as a UTC epoch, read as wall-clock time. The API sends naive
 * "YYYY-MM-DD HH:mm:ss" in its application timezone (UTC); a value that carries its
 * own zone or offset is honoured instead.
 */
function parseShiftTime(value) {
  const text = String(value ?? '').trim();
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text) && text.includes('T')) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0));
}

function dayLabel(epoch) {
  if (epoch === null) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(epoch));
}

function dateOnlyLabel(value) {
  const parts = splitDate(value);
  if (!parts.year) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

function clockLabel(epoch) {
  if (epoch === null) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
  }).format(new Date(epoch));
}

/** "09:00:00" (a repeating pattern's clock time) as the member's own clock. */
function patternClockLabel(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return clockLabel(Date.UTC(2024, 0, 1, Number(match[1]), Number(match[2])));
}

/** 1 = Monday … 7 = Sunday, in the member's language. 1 January 2024 was a Monday. */
function weekdayLabel(iso) {
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(2024, 0, iso)));
}

function pad(number) {
  return String(number).padStart(2, '0');
}

/** "HH:MM" of a shift time, for pre-filling the change form. */
function clockValue(epoch) {
  if (epoch === null) return '';
  const date = new Date(epoch);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function datePartsOf(epoch) {
  if (epoch === null) return { day: '', month: '', year: '' };
  const date = new Date(epoch);
  return { day: String(date.getUTCDate()), month: String(date.getUTCMonth() + 1), year: String(date.getUTCFullYear()) };
}

function todayIso() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

// ── What the pages show ──────────────────────────────────────────────────────

function presentShift(raw, t, now) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const start = parseShiftTime(row.start_time);
  const end = parseShiftTime(row.end_time);
  const capacity = positiveInteger(row.capacity);
  const signedUp = wholeNumber(row.signup_count);
  const taken = signedUp + wholeNumber(row.reserved_count);
  return {
    id: positiveInteger(row.id) || 0,
    start,
    end,
    dayLabel: dayLabel(start),
    timeLabel: t(`${KEY}time_range`, { start: clockLabel(start), end: clockLabel(end) }),
    placesLabel: capacity
      ? t(`${KEY}places_of`, { taken, capacity })
      : t(`${KEY}signed_up`, { count: taken }),
    capacity,
    signedUp,
    isRepeating: Boolean(positiveInteger(row.recurring_pattern_id)),
    hasStarted: start === null || start <= now
  };
}

function presentPattern(raw, t) {
  const row = raw && typeof raw === 'object' ? raw : {};
  const frequency = FREQUENCIES.includes(row.frequency) ? row.frequency : 'weekly';
  const days = (Array.isArray(row.days_of_week) ? row.days_of_week : [])
    .map(Number)
    .filter((day) => WEEKDAYS.includes(day))
    .sort((a, b) => a - b);
  return {
    id: positiveInteger(row.id) || 0,
    isActive: row.is_active === true || row.is_active === 1 || row.is_active === '1',
    frequencyLabel: t(`${KEY}frequency_${frequency}`),
    daysLabel: WEEKDAY_FREQUENCIES.includes(frequency) && days.length
      ? formatRequestList(days.map(weekdayLabel))
      : '',
    timeLabel: t(`${KEY}time_range`, {
      start: patternClockLabel(row.start_time),
      end: patternClockLabel(row.end_time)
    }),
    capacity: wholeNumber(row.capacity),
    fromLabel: dateOnlyLabel(row.start_date),
    untilLabel: row.end_date ? dateOnlyLabel(row.end_date) : t(`${KEY}no_end_date`),
    maxOccurrences: positiveInteger(row.max_occurrences),
    generated: wholeNumber(row.occurrences_generated)
  };
}

function presentRoster(raw, hasStarted, t) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const summary = data.summary && typeof data.summary === 'object' ? data.summary : {};
  const personName = (person) => trimmed(person && person.name, 200);

  const volunteers = (Array.isArray(data.volunteers) ? data.volunteers : []).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    const status = item.check_in_status;
    let label;
    let tagClass;
    if (status === 'checked_in' && item.checked_in_at) {
      label = t(`${KEY}status_checked_in_at`, { time: clockLabel(parseShiftTime(item.checked_in_at)) });
      tagClass = 'govuk-tag--green';
    } else if (status === 'checked_in') {
      label = t(`${KEY}status_checked_in`);
      tagClass = 'govuk-tag--green';
    } else if (status === 'checked_out') {
      label = t(`${KEY}status_checked_out`);
      tagClass = 'govuk-tag--grey';
    } else if (status === 'no_show') {
      label = t(`${KEY}status_no_show`);
      tagClass = 'govuk-tag--red';
    } else if (hasStarted) {
      // Once the shift has started, someone without a check-in is worth noticing.
      label = t(`${KEY}status_not_checked_in`);
      tagClass = 'govuk-tag--yellow';
    } else {
      // Before it starts nobody is "missing" yet.
      label = t(`${KEY}status_coming`);
      tagClass = 'govuk-tag--blue';
    }
    return { name: personName(item.user), statusLabel: label, tagClass };
  }).filter((volunteer) => volunteer.name);

  const groups = (Array.isArray(data.groups) ? data.groups : []).map((entry) => {
    const item = entry && typeof entry === 'object' ? entry : {};
    return {
      name: trimmed(item.group_name, 200),
      places: wholeNumber(item.reserved_slots),
      leaderName: personName(item.leader),
      members: (Array.isArray(item.members) ? item.members : []).map(personName).filter(Boolean)
    };
  });

  const waitlist = (Array.isArray(data.waitlist) ? data.waitlist : [])
    .map((entry) => ({
      name: personName(entry && entry.user),
      position: wholeNumber(entry && entry.position)
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.position - b.position);

  return {
    summary: {
      signedUp: wholeNumber(summary.signed_up),
      checkedIn: wholeNumber(summary.checked_in),
      noShow: wholeNumber(summary.no_show),
      groupPlaces: wholeNumber(summary.group_places),
      waiting: wholeNumber(summary.waiting)
    },
    volunteers,
    groups,
    waitlist,
    isEmpty: volunteers.length === 0 && groups.length === 0 && waitlist.length === 0
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * The opportunity, and whether the signed-in member may manage it. Responds itself
 * (sign-in, 403, 404) and returns null when the page must not go on.
 */
async function managedOpportunity(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, LOGIN);
    return null;
  }
  const id = Number(req.params.id);
  let opportunity;
  try {
    opportunity = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(id)}`));
  } catch (error) {
    if (answerRefusal(error, res)) return null;
    throw error;
  }
  const item = opportunity && typeof opportunity === 'object' ? opportunity : {};
  if (item.can_manage !== true && item.is_owner !== true) {
    forbidden(res);
    return null;
  }
  return { token, id, title: trimmed(item.title, 300) };
}

async function loadShifts(token, opportunityId) {
  const data = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(opportunityId)}/shifts`));
  if (Array.isArray(data)) return data;
  return data && Array.isArray(data.shifts) ? data.shifts : [];
}

/**
 * The opportunity's repeating patterns. A community that has switched repeating
 * shifts off answers 403 FEATURE_DISABLED: that half of the page is then hidden
 * quietly, exactly as the website does.
 */
async function loadPatterns(token, opportunityId) {
  try {
    const data = dataOf(await callVolunteeringApi(token, 'GET', `/opportunities/${encodeURIComponent(opportunityId)}/recurring-patterns`));
    const rows = Array.isArray(data) ? data : (data && Array.isArray(data.patterns) ? data.patterns : []);
    return { available: true, failed: false, rows };
  } catch (error) {
    if (isApiStatus(error, 401)) throw error;
    if (isApiStatus(error, 403) && apiErrorCode(error) === 'FEATURE_DISABLED') {
      return { available: false, failed: false, rows: [] };
    }
    return { available: true, failed: true, rows: [] };
  }
}

/** One shift of this opportunity, from its shift list (the API has no single-shift read). */
async function findShift(token, opportunityId, shiftId) {
  const rows = await loadShifts(token, opportunityId);
  return rows.find((row) => Number(row && row.id) === shiftId) || null;
}

// ── Form errors ──────────────────────────────────────────────────────────────

/**
 * Errors travel through the one-shot session stash as `{ field, key }` (a message this
 * service owns) or `{ field, message }` (a message the API wrote, already in the
 * member's language). `field` is the id the error summary links to.
 */
function presentErrors(stored, t) {
  return (Array.isArray(stored) ? stored : [])
    .map((error) => ({
      field: typeof error.field === 'string' ? error.field : '',
      href: typeof error.href === 'string' ? error.href : (error.field ? `#${error.field}` : ''),
      text: typeof error.message === 'string' && error.message
        ? error.message
        : t(error.key, error.replacements || {}),
      parts: Array.isArray(error.parts) ? error.parts : []
    }))
    .filter((error) => error.text);
}

function errorsByField(errors) {
  const byField = {};
  for (const error of errors) {
    if (error.field && !byField[error.field]) byField[error.field] = error;
  }
  return byField;
}

function dateError(field, result, requiredKey) {
  const allEmpty = result.parts.day === '' && result.parts.month === '' && result.parts.year === '';
  const firstPart = result.errorFields[0] || 'day';
  return {
    field,
    href: `#${field}-${firstPart}`,
    key: allEmpty ? requiredKey : `web_uk.date_input.${result.error}`,
    parts: result.errorFields
  };
}

/**
 * What the API said, placed on the field it named. A 400/422 carries a message the
 * API has already written in the member's language; anything else gets this
 * service's own "could not be saved".
 */
function serverError(error, fieldMap, fallbackKey) {
  if (isApiStatus(error, 400) || isApiStatus(error, 422)) {
    const first = apiFirstError(error);
    const message = trimmed(first.message, 500);
    const field = fieldMap[trimmed(first.field)] || '';
    if (message) return { field, href: field ? `#${field}` : '', message };
  }
  return { field: '', key: fallbackKey };
}

// ── One-off shift form ───────────────────────────────────────────────────────

function readPlaces(raw, { required = false } = {}) {
  if (raw === '') return { value: null, error: required ? 'required' : null };
  if (!/^\d+$/.test(raw)) return { value: null, error: 'invalid' };
  const number = Number(raw);
  if (number < 1 || number > MAX_PLACES) return { value: null, error: 'invalid' };
  return { value: number, error: null };
}

/** Check a shift form locally, before anything reaches the API. */
function readShiftForm(body) {
  const source = body && typeof body === 'object' ? body : {};
  const date = composeDate(source, 'date', { required: true });
  const startRaw = trimmed(source.start_time, 20);
  const endRaw = trimmed(source.end_time, 20);
  const capacityRaw = trimmed(source.capacity, 20);
  const values = { date: date.parts, startTime: startRaw, endTime: endRaw, capacity: capacityRaw };
  const errors = [];

  if (date.error) errors.push(dateError('date', date, `${KEY}date_required`));

  const start = parseTime(startRaw);
  if (startRaw === '') errors.push({ field: 'start_time', key: `${KEY}start_required` });
  else if (start === null) errors.push({ field: 'start_time', key: `${KEY}start_invalid` });

  const end = parseTime(endRaw);
  if (endRaw === '') errors.push({ field: 'end_time', key: `${KEY}end_required` });
  else if (end === null) errors.push({ field: 'end_time', key: `${KEY}end_invalid` });

  if (start !== null && end !== null && end <= start) {
    errors.push({ field: 'end_time', key: `${KEY}end_before_start` });
  }

  const places = readPlaces(capacityRaw);
  if (places.error) errors.push({ field: 'capacity', key: `${KEY}places_invalid` });

  let payload = null;
  if (errors.length === 0) {
    const startTime = `${date.value} ${start}:00`;
    if (parseShiftTime(startTime) <= Date.now()) {
      errors.push({ field: 'date', href: '#date-day', key: `${KEY}start_in_past`, parts: [] });
    } else {
      payload = { start_time: startTime, end_time: `${date.value} ${end}:00`, capacity: places.value };
    }
  }

  return { values, errors, payload };
}

const SHIFT_FIELDS = { start_time: 'start_time', end_time: 'end_time', capacity: 'capacity' };

function renderShiftForm(res, { context, mode, shiftId = 0, values, errors, shift = null }) {
  const t = res.locals.t;
  const presented = presentErrors(errors, t);
  const action = mode === 'edit'
    ? `${shiftsPath(context.id)}/${shiftId}/edit`
    : `${shiftsPath(context.id)}/new`;
  return res.render('volunteering/shift-form', {
    title: t(`${KEY}${mode === 'edit' ? 'edit_shift_title' : 'new_shift_title'}`),
    activeNav: 'volunteering',
    mode,
    opportunityId: context.id,
    opportunityTitle: context.title,
    shift,
    action,
    values,
    errors: presented,
    fieldErrors: errorsByField(presented)
  });
}

router.get('/opportunities/:id(\\d+)/shifts', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const t = res.locals.t;
  const now = Date.now();

  let shifts = [];
  let loadError = false;
  try {
    shifts = (await loadShifts(context.token, context.id))
      .map((row) => presentShift(row, t, now))
      .filter((shift) => shift.id);
  } catch (error) {
    if (isApiStatus(error, 401)) return redirectTo(res, LOGIN);
    loadError = true;
  }

  const patterns = await loadPatterns(context.token, context.id);
  const upcoming = shifts.filter((shift) => !shift.hasStarted).sort((a, b) => a.start - b.start);
  const past = shifts.filter((shift) => shift.hasStarted).sort((a, b) => (b.start || 0) - (a.start || 0));

  const statuses = {
    'shift-created': ['success', 'shift_created'],
    'shift-updated': ['success', 'shift_updated'],
    'shift-removed': ['success', 'shift_removed'],
    'pattern-created': ['success', 'pattern_created'],
    'pattern-stopped': ['success', 'pattern_stopped'],
    'remove-failed': ['error', 'remove_failed'],
    'stop-failed': ['error', 'stop_failed'],
    'shift-started': ['error', 'shift_started'],
    'shift-missing': ['error', 'shift_missing'],
    'pattern-missing': ['error', 'pattern_missing'],
    'repeating-off': ['error', 'repeating_off']
  };
  const statusKey = typeof req.query.status === 'string' ? req.query.status : '';
  const known = Object.hasOwn(statuses, statusKey) ? statuses[statusKey] : null;
  const count = wholeNumber(req.query.count);
  const flash = consumeFormReplay(req, REPLAY, `manage-${context.id}`) || {};
  let status = null;
  if (known) {
    let messageKey = known[1];
    if (statusKey === 'shift-removed' && count > 0) messageKey = 'shift_removed_told';
    status = {
      type: known[0],
      // A refusal the API explained (a shift that started a moment ago) reads better
      // in its own words than in a generic "could not".
      message: known[0] === 'error' && typeof flash.message === 'string' && flash.message
        ? flash.message
        : t(KEY + messageKey, { count })
    };
  }

  return res.render('volunteering/shift-manage', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    opportunityId: context.id,
    opportunityTitle: context.title,
    upcoming,
    past,
    loadError,
    repeatingAvailable: patterns.available,
    patternsFailed: patterns.failed,
    patterns: patterns.rows.map((row) => presentPattern(row, t)).filter((pattern) => pattern.id && pattern.isActive),
    status
  });
}, { redirectOn401: LOGIN }));

router.get('/opportunities/:id(\\d+)/shifts/new', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const replay = consumeFormReplay(req, REPLAY, `shift-new-${context.id}`) || {};
  let errors = replay.errors || [];
  if (errors.length === 0 && req.query.status === 'invalid') errors = [{ field: '', key: `${KEY}save_failed` }];
  return renderShiftForm(res, {
    context,
    mode: 'new',
    values: replay.values || { date: { day: '', month: '', year: '' }, startTime: '', endTime: '', capacity: '' },
    errors
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/shifts/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const form = readShiftForm(req.body);
  const failed = (errors) => {
    rememberFormReplay(req, REPLAY, `shift-new-${id}`, { values: form.values, errors });
    return redirectTo(res, `${shiftsPath(id)}/new?status=invalid`);
  };
  if (form.errors.length) return failed(form.errors);

  try {
    await callVolunteeringApi(token, 'POST', `/opportunities/${encodeURIComponent(id)}/shifts`, form.payload);
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    return failed([serverError(error, SHIFT_FIELDS, `${KEY}save_failed`)]);
  }
  return redirectTo(res, manageRedirect(id, 'shift-created'));
}, { redirectOn401: LOGIN }));

router.get('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/edit', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const shiftId = Number(req.params.shiftId);
  const raw = await findShift(context.token, context.id, shiftId);
  if (!raw) return redirectTo(res, manageRedirect(context.id, 'shift-missing'));
  const shift = presentShift(raw, res.locals.t, Date.now());
  if (shift.hasStarted) return redirectTo(res, manageRedirect(context.id, 'shift-started'));

  const replay = consumeFormReplay(req, REPLAY, `shift-edit-${shiftId}`) || {};
  let errors = replay.errors || [];
  if (errors.length === 0 && req.query.status === 'invalid') errors = [{ field: '', key: `${KEY}save_failed` }];
  return renderShiftForm(res, {
    context,
    mode: 'edit',
    shiftId,
    shift,
    values: replay.values || {
      date: datePartsOf(shift.start),
      startTime: clockValue(shift.start),
      endTime: clockValue(shift.end),
      capacity: shift.capacity ? String(shift.capacity) : ''
    },
    errors
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const form = readShiftForm(req.body);
  const failed = (errors) => {
    rememberFormReplay(req, REPLAY, `shift-edit-${shiftId}`, { values: form.values, errors });
    return redirectTo(res, `${shiftsPath(id)}/${shiftId}/edit?status=invalid`);
  };
  if (form.errors.length) return failed(form.errors);

  try {
    await callVolunteeringApi(token, 'PUT', `/shifts/${encodeURIComponent(shiftId)}`, form.payload);
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    return failed([serverError(error, SHIFT_FIELDS, `${KEY}save_failed`)]);
  }
  return redirectTo(res, manageRedirect(id, 'shift-updated'));
}, { redirectOn401: LOGIN }));

router.get('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/remove', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const t = res.locals.t;
  const shiftId = Number(req.params.shiftId);
  const raw = await findShift(context.token, context.id, shiftId);
  if (!raw) return redirectTo(res, manageRedirect(context.id, 'shift-missing'));
  const shift = presentShift(raw, t, Date.now());
  if (shift.hasStarted) return redirectTo(res, manageRedirect(context.id, 'shift-started'));

  return res.render('volunteering/shift-remove', {
    title: t(`${KEY}remove_title`),
    activeNav: 'volunteering',
    opportunityId: context.id,
    opportunityTitle: context.title,
    shift,
    holdersMessage: shift.signedUp > 0
      ? t(`${KEY}remove_holders`, { count: shift.signedUp })
      : t(`${KEY}remove_holders_none`)
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);

  let result;
  try {
    result = dataOf(await callVolunteeringApi(token, 'DELETE', `/shifts/${encodeURIComponent(shiftId)}`));
  } catch (error) {
    if (isApiStatus(error, 404)) return redirectTo(res, manageRedirect(id, 'shift-missing'));
    if (answerRefusal(error, res)) return undefined;
    const problem = serverError(error, {}, `${KEY}remove_failed`);
    if (problem.message) rememberFormReplay(req, REPLAY, `manage-${id}`, { message: problem.message });
    return redirectTo(res, manageRedirect(id, 'remove-failed'));
  }
  const affected = result && typeof result === 'object' ? wholeNumber(result.affected_volunteers) : 0;
  return redirectTo(res, manageRedirect(id, 'shift-removed', affected));
}, { redirectOn401: LOGIN }));

router.get('/opportunities/:id(\\d+)/shifts/:shiftId(\\d+)/roster', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const t = res.locals.t;
  const shiftId = Number(req.params.shiftId);
  const raw = await findShift(context.token, context.id, shiftId);
  if (!raw) return notFound(res);
  const shift = presentShift(raw, t, Date.now());

  let roster = null;
  let loadError = false;
  try {
    roster = presentRoster(
      dataOf(await callVolunteeringApi(context.token, 'GET', `/shifts/${encodeURIComponent(shiftId)}/roster`)),
      shift.hasStarted,
      t
    );
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    loadError = true;
  }

  return res.render('volunteering/shift-roster', {
    title: t(`${KEY}roster_title`),
    activeNav: 'volunteering',
    opportunityId: context.id,
    opportunityTitle: context.title,
    shift,
    roster,
    loadError
  });
}, { redirectOn401: LOGIN }));

// ── Repeating shifts ─────────────────────────────────────────────────────────

/** Check a repeating-shifts form locally, before anything reaches the API. */
function readPatternForm(body) {
  const source = body && typeof body === 'object' ? body : {};
  const frequencyRaw = trimmed(source.frequency, 20);
  const frequency = FREQUENCIES.includes(frequencyRaw) ? frequencyRaw : '';
  const rawDays = Array.isArray(source.days_of_week) ? source.days_of_week : [source.days_of_week];
  const days = [...new Set(rawDays.map(Number).filter((day) => WEEKDAYS.includes(day)))].sort((a, b) => a - b);
  const startRaw = trimmed(source.start_time, 20);
  const endRaw = trimmed(source.end_time, 20);
  const capacityRaw = trimmed(source.capacity, 20);
  const maxRaw = trimmed(source.max_occurrences, 20);
  const startDate = composeDate(source, 'start_date', { required: true });
  const endDate = composeDate(source, 'end_date');

  const values = {
    frequency: frequencyRaw,
    days: days.map(String),
    startTime: startRaw,
    endTime: endRaw,
    capacity: capacityRaw,
    startDate: startDate.parts,
    endDate: endDate.parts,
    maxOccurrences: maxRaw
  };
  const errors = [];

  if (!frequency) errors.push({ field: 'frequency', key: `${KEY}frequency_required` });
  if (WEEKDAY_FREQUENCIES.includes(frequency) && days.length === 0) {
    errors.push({ field: 'days_of_week', key: `${KEY}days_required` });
  }

  const start = parseTime(startRaw);
  if (startRaw === '') errors.push({ field: 'start_time', key: `${KEY}start_required` });
  else if (start === null) errors.push({ field: 'start_time', key: `${KEY}start_invalid` });
  const end = parseTime(endRaw);
  if (endRaw === '') errors.push({ field: 'end_time', key: `${KEY}end_required` });
  else if (end === null) errors.push({ field: 'end_time', key: `${KEY}end_invalid` });
  if (start !== null && end !== null && end <= start) {
    errors.push({ field: 'end_time', key: `${KEY}end_before_start` });
  }

  const places = readPlaces(capacityRaw, { required: true });
  if (places.error === 'required') errors.push({ field: 'capacity', key: `${KEY}pattern_places_required` });
  else if (places.error) errors.push({ field: 'capacity', key: `${KEY}places_invalid` });

  if (startDate.error) {
    errors.push(dateError('start_date', startDate, `${KEY}start_date_required`));
  } else if (startDate.value < todayIso()) {
    errors.push({ field: 'start_date', href: '#start_date-day', key: `${KEY}start_date_past`, parts: [] });
  }
  if (endDate.error) {
    errors.push(dateError('end_date', endDate, `${KEY}start_date_required`));
  } else if (endDate.value && startDate.value && endDate.value < startDate.value) {
    errors.push({ field: 'end_date', href: '#end_date-day', key: `${KEY}end_date_before_start`, parts: [] });
  }

  let maxOccurrences = null;
  if (maxRaw !== '') {
    const number = /^\d+$/.test(maxRaw) ? Number(maxRaw) : 0;
    if (number < 1 || number > MAX_OCCURRENCES) errors.push({ field: 'max_occurrences', key: `${KEY}max_invalid` });
    else maxOccurrences = number;
  }

  let payload = null;
  if (errors.length === 0) {
    payload = {
      frequency,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      capacity: places.value,
      start_date: startDate.value
    };
    if (WEEKDAY_FREQUENCIES.includes(frequency)) payload.days_of_week = days;
    if (endDate.value) payload.end_date = endDate.value;
    if (maxOccurrences !== null) payload.max_occurrences = maxOccurrences;
  }

  return { values, errors, payload };
}

const PATTERN_FIELDS = {
  frequency: 'frequency',
  days_of_week: 'days_of_week',
  start_time: 'start_time',
  end_time: 'end_time',
  capacity: 'capacity',
  max_occurrences: 'max_occurrences'
};

router.get('/opportunities/:id(\\d+)/repeating/new', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const t = res.locals.t;
  const patterns = await loadPatterns(context.token, context.id);
  if (!patterns.available) return redirectTo(res, manageRedirect(context.id, 'repeating-off'));

  const replay = consumeFormReplay(req, REPLAY, `pattern-new-${context.id}`) || {};
  let stored = replay.errors || [];
  if (stored.length === 0 && req.query.status === 'invalid') stored = [{ field: '', key: `${KEY}pattern_failed` }];
  const errors = presentErrors(stored, t);
  const values = replay.values || {
    frequency: 'weekly',
    days: [],
    startTime: '',
    endTime: '',
    capacity: '1',
    startDate: splitDate(todayIso()),
    endDate: { day: '', month: '', year: '' },
    maxOccurrences: ''
  };
  const chosenDays = Array.isArray(values.days) ? values.days.map(String) : [];

  return res.render('volunteering/shift-pattern-form', {
    title: t(`${KEY}pattern_title`),
    activeNav: 'volunteering',
    opportunityId: context.id,
    opportunityTitle: context.title,
    action: `/volunteering/opportunities/${context.id}/repeating/new`,
    frequencyItems: FREQUENCIES.map((value) => ({
      value,
      text: t(`${KEY}frequency_${value}`),
      checked: values.frequency === value
    })),
    dayItems: WEEKDAYS.map((value) => ({
      value: String(value),
      text: weekdayLabel(value),
      checked: chosenDays.includes(String(value))
    })),
    values,
    errors,
    fieldErrors: errorsByField(errors)
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/repeating/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const form = readPatternForm(req.body);
  const failed = (errors) => {
    rememberFormReplay(req, REPLAY, `pattern-new-${id}`, { values: form.values, errors });
    return redirectTo(res, `/volunteering/opportunities/${id}/repeating/new?status=invalid`);
  };
  if (form.errors.length) return failed(form.errors);

  let result;
  try {
    result = dataOf(await callVolunteeringApi(token, 'POST', `/opportunities/${encodeURIComponent(id)}/recurring-patterns`, form.payload));
  } catch (error) {
    if (isApiStatus(error, 403) && apiErrorCode(error) === 'FEATURE_DISABLED') {
      return redirectTo(res, manageRedirect(id, 'repeating-off'));
    }
    if (answerRefusal(error, res)) return undefined;
    return failed([serverError(error, PATTERN_FIELDS, `${KEY}pattern_failed`)]);
  }
  const generated = result && typeof result === 'object' ? wholeNumber(result.shifts_generated) : 0;
  return redirectTo(res, manageRedirect(id, 'pattern-created', generated));
}, { redirectOn401: LOGIN }));

router.get('/opportunities/:id(\\d+)/repeating/:patternId(\\d+)/stop', asyncRoute(async (req, res) => {
  const context = await managedOpportunity(req, res);
  if (!context) return undefined;
  const t = res.locals.t;
  const patternId = Number(req.params.patternId);
  const patterns = await loadPatterns(context.token, context.id);
  if (!patterns.available) return redirectTo(res, manageRedirect(context.id, 'repeating-off'));
  const pattern = patterns.rows
    .map((row) => presentPattern(row, t))
    .find((item) => item.id === patternId && item.isActive);
  if (!pattern) return redirectTo(res, manageRedirect(context.id, 'pattern-missing'));

  return res.render('volunteering/shift-pattern-stop', {
    title: t(`${KEY}stop_title`),
    activeNav: 'volunteering',
    opportunityId: context.id,
    opportunityTitle: context.title,
    pattern
  });
}, { redirectOn401: LOGIN }));

router.post('/opportunities/:id(\\d+)/repeating/:patternId(\\d+)/stop', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const id = Number(req.params.id);
  const patternId = Number(req.params.patternId);

  let result;
  try {
    result = dataOf(await callVolunteeringApi(token, 'DELETE', `/recurring-patterns/${encodeURIComponent(patternId)}`));
  } catch (error) {
    if (isApiStatus(error, 404)) return redirectTo(res, manageRedirect(id, 'pattern-missing'));
    if (isApiStatus(error, 403) && apiErrorCode(error) === 'FEATURE_DISABLED') {
      return redirectTo(res, manageRedirect(id, 'repeating-off'));
    }
    if (answerRefusal(error, res)) return undefined;
    const problem = serverError(error, {}, `${KEY}stop_failed`);
    if (problem.message) rememberFormReplay(req, REPLAY, `manage-${id}`, { message: problem.message });
    return redirectTo(res, manageRedirect(id, 'stop-failed'));
  }
  const removed = result && typeof result === 'object' ? wholeNumber(result.future_shifts_removed) : 0;
  return redirectTo(res, manageRedirect(id, 'pattern-stopped', removed));
}, { redirectOn401: LOGIN }));

module.exports = router;
// Exposed for unit tests of the pure form readers.
module.exports.readShiftForm = readShiftForm;
module.exports.readPatternForm = readPatternForm;
