// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Two organiser tools React has and this frontend lacked (CAPABILITY_PARITY_FINDINGS
 * Tier 2):
 *
 * 1. The event TEAM — give another member a delegated role on one event (for
 *    example check-in staff), and take it away again. API: GET/POST
 *    /api/v2/events/{id}/staff, DELETE /api/v2/events/{id}/staff/{assignmentId}.
 *    React: EventStaffWorkspace.
 * 2. TICKET TYPES — create, edit, activate, pause and archive (there is no hard
 *    delete; archiving is how a ticket type is removed). API: POST
 *    /api/v2/events/{id}/ticket-types, PUT …/{ticketTypeId}, POST
 *    …/{ticketTypeId}/{activate|pause|archive}. React: EventTicketsPanel.
 *
 * Tickets are FREE or priced in TIME CREDITS only (EventTicketKind has exactly
 * those two cases). No card money is involved anywhere on these pages.
 *
 * Every write carries an idempotency key minted when the form was rendered, so a
 * double-submit or a refresh replays rather than repeating the change.
 */

const express = require('express');
const { randomUUID } = require('node:crypto');
const { callEventApi, getEvent, getEventPermissions, getUsers, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDateTime, splitDateTime } = require('../lib/date-input');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const STAFF_ROLES = ['co_organizer', 'registration_manager', 'communications_manager', 'check_in_staff', 'finance_manager'];
const TICKET_KINDS = ['free', 'time_credit'];
const TICKET_ACTIONS = ['activate', 'pause', 'archive'];
const STAFF_STATUSES = ['assigned', 'revoked', 'assign-failed', 'revoke-failed', 'invalid', 'forbidden'];
const TICKET_STATUSES = ['created', 'updated', 'activated', 'paused', 'archived', 'action-failed'];

function tokenFrom(req) {
  return req.token || req.signedCookies?.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value ?? '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function checked(value) {
  return value === true || ['1', 'true', 'on', 'yes'].includes(String(value ?? '').toLowerCase());
}

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function eventPath(id, suffix = '') {
  return `/events/${id}${suffix}`;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function noStore(res) {
  res.set('Cache-Control', 'private, no-store');
  res.set('Pragma', 'no-cache');
}

function renderForbidden(res) {
  return res.status(403).render('errors/403', { title: res.locals.t('govuk_alpha.error_pages.403_title') });
}

function safeTimeZone(value) {
  const zone = trimmed(value, 64) || 'UTC';
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return 'UTC';
  }
}

function zoneParts(epoch, timeZone) {
  // Numeric parts only (Latin digits), never shown to a member.
  return Object.fromEntries(new Intl.DateTimeFormat(undefined, {
    timeZone,
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
}

/** `YYYY-MM-DDTHH:MM` in the event's own time zone, for prefilling a form. */
function wallClockInZone(iso, timeZone) {
  const epoch = Date.parse(trimmed(iso));
  if (!Number.isFinite(epoch)) return '';
  const parts = zoneParts(epoch, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/**
 * The UTC instant (`YYYY-MM-DDTHH:MM:SSZ`) of a wall-clock time typed in the
 * event's own time zone. The ticket API refuses a local value whose offset does
 * not match that zone, so the conversion happens here and the `_utc` field is
 * sent. A time that does not exist (inside a clock-change gap) returns null.
 */
function wallClockToUtc(local, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed(local));
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zoneParts(guess, timeZone);
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const next = target - (shown - guess);
    if (next === guess) break;
    guess = next;
  }
  if (wallClockInZone(new Date(guess).toISOString(), timeZone) !== trimmed(local)) return null;
  return new Date(guess).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function dateLabel(iso, timeZone) {
  const epoch = Date.parse(trimmed(iso));
  if (!Number.isFinite(epoch)) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone
  }).format(new Date(epoch));
}

async function loadEvent(token, id) {
  // Permissions come from the v2 contract (getEventPermissions explains why
  // that is a separate read); title and time zone from the ordinary detail.
  const [eventResult, permissionResult] = await Promise.all([getEvent(token, id), getEventPermissions(token, id)]);
  const event = dataFrom(eventResult) || {};
  const source = event.event && typeof event.event === 'object' ? event.event : event;
  return {
    id,
    title: trimmed(source.title),
    timezone: safeTimeZone(source.timezone || source.time_zone),
    permissions: permissionResult?.permissions && typeof permissionResult.permissions === 'object' ? permissionResult.permissions : {}
  };
}

async function eventMutation(token, method, path, data, idempotencyKey) {
  return callEventApi(token, method, path, data, { headers: { 'Idempotency-Key': idempotencyKey } });
}

// ---------------------------------------------------------------------------
// Event team (delegated staff roles)
// ---------------------------------------------------------------------------

function memberName(member, t) {
  const source = member && typeof member === 'object' ? member : {};
  const name = trimmed(source.name) || [trimmed(source.first_name), trimmed(source.last_name)].filter(Boolean).join(' ');
  return name || t('govuk_alpha_events.staff.member_fallback', { id: positiveInteger(source.id) || '' });
}

function staffAssignment(row, timezone, t) {
  const status = trimmed(row?.status);
  const expiresEpoch = Date.parse(trimmed(row?.expires_at));
  const expired = status === 'active' && Number.isFinite(expiresEpoch) && expiresEpoch <= Date.now();
  return {
    id: positiveInteger(row?.id),
    name: memberName(row?.member, t),
    role: STAFF_ROLES.includes(trimmed(row?.role)) ? trimmed(row.role) : '',
    status: expired ? 'expired' : (['active', 'revoked'].includes(status) ? status : 'revoked'),
    grantedLabel: dateLabel(row?.granted_at, timezone),
    expiresLabel: dateLabel(row?.expires_at, timezone),
    revokedLabel: dateLabel(row?.revoked_at, timezone)
  };
}

router.get('/:id(\\d+)/staff', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = tokenFrom(req);
  const event = await loadEvent(token, id);
  if (event.permissions.manage_staff !== true) return renderForbidden(res);

  let assignments = [];
  let loadError = false;
  try {
    assignments = collectionFrom(await callEventApi(token, 'GET', `/${encodeURIComponent(id)}/staff?include_inactive=true`))
      .map((row) => staffAssignment(row, event.timezone, res.locals.t))
      .filter((row) => row.id !== null);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status === 403) return renderForbidden(res);
    loadError = true;
  }

  const query = trimmed(req.query.q, 100);
  let searchResults = [];
  let searchError = false;
  if (query.length >= 2) {
    try {
      searchResults = collectionFrom(await getUsers(token, { q: query, limit: 10 }))
        .map((row) => ({ id: positiveInteger(row?.id), name: memberName(row, res.locals.t) }))
        .filter((row) => row.id !== null);
    } catch (error) {
      if (isAuthError(error)) throw error;
      searchError = true;
    }
  }

  noStore(res);
  return res.render('events/staff', {
    title: res.locals.t('govuk_alpha_events.staff.title'),
    activeNav: 'events',
    event,
    activeAssignments: assignments.filter((row) => row.status === 'active'),
    pastAssignments: assignments.filter((row) => row.status !== 'active'),
    loadError,
    query,
    queryTooShort: query !== '' && query.length < 2,
    searchResults,
    searchError,
    roles: STAFF_ROLES,
    status: STAFF_STATUSES.includes(trimmed(req.query.status)) ? trimmed(req.query.status) : '',
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/staff', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const userId = positiveInteger(req.body.user_id);
  const role = STAFF_ROLES.includes(trimmed(req.body.role)) ? trimmed(req.body.role) : '';
  const key = trimmed(req.body.idempotency_key, 191);
  const query = trimmed(req.body.q, 100);
  const back = (status) => `${eventPath(id, '/staff')}?status=${status}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
  if (!userId || !role || key.length < 8) return redirectTo(res, back('invalid'));

  let expiresAt = null;
  const expiry = readDateTime(req.body, 'expires_at');
  if (expiry.error) return redirectTo(res, back('invalid'));
  if (expiry.value) {
    const token = tokenFrom(req);
    const event = await loadEvent(token, id);
    expiresAt = wallClockToUtc(expiry.value, event.timezone);
    if (!expiresAt || Date.parse(expiresAt) <= Date.now()) return redirectTo(res, back('invalid'));
  }

  try {
    await eventMutation(tokenFrom(req), 'POST', `/${encodeURIComponent(id)}/staff`, { user_id: userId, role, expires_at: expiresAt }, key);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status === 403) return redirectTo(res, back('forbidden'));
    if (error instanceof ApiError && error.status < 500) return redirectTo(res, back('assign-failed'));
    throw error;
  }
  return redirectTo(res, `${eventPath(id, '/staff')}?status=assigned`);
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/staff/:assignmentId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const assignmentId = Number(req.params.assignmentId);
  const token = tokenFrom(req);
  const event = await loadEvent(token, id);
  if (event.permissions.manage_staff !== true) return renderForbidden(res);
  const assignment = collectionFrom(await callEventApi(token, 'GET', `/${encodeURIComponent(id)}/staff`))
    .map((row) => staffAssignment(row, event.timezone, res.locals.t))
    .find((row) => row.id === assignmentId && row.status !== 'revoked');
  if (!assignment) {
    return res.status(404).render('errors/404', { title: res.locals.t('govuk_alpha.error_pages.404_title') });
  }
  noStore(res);
  return res.render('events/staff-revoke', {
    title: res.locals.t('govuk_alpha_events.staff.revoke_title'),
    activeNav: 'events',
    event,
    assignment,
    status: trimmed(req.query.status) === 'revoke-failed' ? 'revoke-failed' : '',
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/staff/:assignmentId(\\d+)/revoke', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const assignmentId = Number(req.params.assignmentId);
  const key = trimmed(req.body.idempotency_key, 191);
  if (key.length < 8) return redirectTo(res, `${eventPath(id, '/staff')}?status=invalid`);
  try {
    await eventMutation(tokenFrom(req), 'DELETE', `/${encodeURIComponent(id)}/staff/${encodeURIComponent(assignmentId)}`, { idempotency_key: key }, key);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status < 500) {
      return redirectTo(res, `${eventPath(id, `/staff/${assignmentId}/revoke`)}?status=revoke-failed`);
    }
    throw error;
  }
  return redirectTo(res, `${eventPath(id, '/staff')}?status=revoked`);
}, { notFoundTitle: 'Event not found' }));

// ---------------------------------------------------------------------------
// Ticket types
// ---------------------------------------------------------------------------

async function loadCatalogue(token, id) {
  const data = dataFrom(await callEventApi(token, 'GET', `/${encodeURIComponent(id)}/tickets`)) || {};
  const catalogue = data.catalogue || data;
  return {
    ticketTypes: Array.isArray(catalogue.ticket_types) ? catalogue.ticket_types : [],
    canManage: catalogue.permissions?.manage === true,
    timeCreditSupported: catalogue.payment_gateway?.time_credit_supported === true
  };
}

function ticketTypeView(type, timezone) {
  const status = ['draft', 'active', 'paused', 'archived'].includes(trimmed(type?.status)) ? trimmed(type.status) : 'draft';
  return {
    id: positiveInteger(type?.id),
    version: positiveInteger(type?.version) || 1,
    name: trimmed(type?.name),
    description: trimmed(type?.description),
    kind: TICKET_KINDS.includes(trimmed(type?.kind)) ? trimmed(type.kind) : 'free',
    price: trimmed(type?.unit_price_credits) || '0.00',
    allocationLimit: Number(type?.allocation_limit) || 0,
    perMemberLimit: Number(type?.per_member_limit) || 0,
    remaining: Number(type?.availability?.allocation_remaining) || 0,
    salesOpenLabel: dateLabel(type?.sales_opens_at, timezone),
    salesCloseLabel: dateLabel(type?.sales_closes_at, timezone),
    status,
    canEdit: status === 'draft' || status === 'paused',
    canActivate: status === 'draft' || status === 'paused',
    canPause: status === 'active',
    canArchive: status !== 'archived',
    raw: type
  };
}

/** Form values for a new ticket type: on sale now, closing an hour before the event. */
function blankTicketForm() {
  return {
    name: '', description: '', kind: 'free', price: '', allocation_limit: '', per_member_limit: '1',
    sales_opens_at: {}, sales_closes_at: {}, refund_cutoff_at: {},
    minimum_account_age_days: '0', approved_member_required: true, required_group_ids: '',
    organizer_cancel_refundable: false
  };
}

function ticketFormFromType(type, timezone) {
  const policy = type?.eligibility_policy && typeof type.eligibility_policy === 'object' ? type.eligibility_policy : {};
  return {
    name: trimmed(type?.name),
    description: trimmed(type?.description),
    kind: TICKET_KINDS.includes(trimmed(type?.kind)) ? trimmed(type.kind) : 'free',
    price: trimmed(type?.kind) === 'time_credit' ? trimmed(type?.unit_price_credits) : '',
    allocation_limit: String(type?.allocation_limit ?? ''),
    per_member_limit: String(type?.per_member_limit ?? '1'),
    sales_opens_at: splitDateTime(wallClockInZone(type?.sales_opens_at, timezone)),
    sales_closes_at: splitDateTime(wallClockInZone(type?.sales_closes_at, timezone)),
    refund_cutoff_at: splitDateTime(wallClockInZone(type?.refund_cutoff_at, timezone)),
    minimum_account_age_days: String(policy.minimum_account_age_days ?? 0),
    approved_member_required: policy.approved_member_required !== false,
    required_group_ids: Array.isArray(policy.required_group_ids) ? policy.required_group_ids.join(',') : '',
    organizer_cancel_refundable: type?.organizer_cancel_refundable === true
  };
}

/**
 * Validate the posted form the way React's EventTicketsPanel does before the
 * API is asked; the API still has the final word.
 */
function readTicketForm(body, timezone, t) {
  const errors = [];
  const fail = (field, key) => errors.push({ href: `#${field}`, text: t(`govuk_alpha_events.ticket_types.errors.${key}`), field });
  const kind = TICKET_KINDS.includes(trimmed(body.kind)) ? trimmed(body.kind) : '';
  const opens = readDateTime(body, 'sales_opens_at', { required: true });
  const closes = readDateTime(body, 'sales_closes_at', { required: true });
  const refund = readDateTime(body, 'refund_cutoff_at');
  const values = {
    name: trimmed(body.name, 191),
    description: trimmed(body.description, 10000),
    kind: kind || 'free',
    price: trimmed(body.price, 20),
    allocation_limit: trimmed(body.allocation_limit, 10),
    per_member_limit: trimmed(body.per_member_limit, 10),
    sales_opens_at: opens.parts,
    sales_closes_at: closes.parts,
    refund_cutoff_at: refund.parts,
    minimum_account_age_days: trimmed(body.minimum_account_age_days, 10) || '0',
    approved_member_required: checked(body.approved_member_required),
    required_group_ids: trimmed(body.required_group_ids, 500),
    organizer_cancel_refundable: checked(body.organizer_cancel_refundable)
  };

  if (!values.name) fail('name', 'name_required');
  if (!kind) fail('kind', 'kind_required');
  let price = '0.00';
  if (kind === 'time_credit') {
    if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(values.price) || Number(values.price) <= 0) fail('price', 'price_invalid');
    else {
      // API decimal string with exactly two places ("1.5" -> "1.50"), not a display value.
      const [whole, fraction = ''] = values.price.split('.');
      price = `${Number(whole)}.${fraction.padEnd(2, '0')}`;
    }
  }
  const allocation = Number(values.allocation_limit);
  if (!Number.isInteger(allocation) || allocation < 1 || allocation > 1000000) fail('allocation_limit', 'allocation_invalid');
  const perMember = Number(values.per_member_limit);
  if (!Number.isInteger(perMember) || perMember < 1 || perMember > 1000
    || (Number.isInteger(allocation) && perMember > allocation)) fail('per_member_limit', 'per_member_invalid');
  const opensUtc = opens.value ? wallClockToUtc(opens.value, timezone) : null;
  const closesUtc = closes.value ? wallClockToUtc(closes.value, timezone) : null;
  if (!opensUtc) fail('sales_opens_at-day', 'sales_open_invalid');
  if (!closesUtc) fail('sales_closes_at-day', 'sales_close_invalid');
  if (opensUtc && closesUtc && Date.parse(opensUtc) >= Date.parse(closesUtc)) fail('sales_closes_at-day', 'sales_window_invalid');
  let refundUtc = null;
  if (kind === 'time_credit' && (refund.value || refund.error)) {
    refundUtc = refund.value ? wallClockToUtc(refund.value, timezone) : null;
    if (!refundUtc) fail('refund_cutoff_at-day', 'refund_invalid');
  }
  const accountAge = Number(values.minimum_account_age_days);
  if (!Number.isInteger(accountAge) || accountAge < 0 || accountAge > 3650) fail('minimum_account_age_days', 'account_age_invalid');
  const groupIds = values.required_group_ids === ''
    ? []
    : values.required_group_ids.split(',').map((part) => Number(part.trim()));
  if (groupIds.length > 20 || groupIds.some((value) => !Number.isInteger(value) || value < 1)) fail('required_group_ids', 'group_ids_invalid');

  return {
    errors,
    values,
    payload: errors.length ? null : {
      name: values.name,
      description: values.description || null,
      kind,
      unit_price_credits: price,
      allocation_limit: allocation,
      per_member_limit: perMember,
      sales_opens_at_utc: opensUtc,
      sales_closes_at_utc: closesUtc,
      refund_cutoff_at_utc: kind === 'time_credit' ? refundUtc : null,
      organizer_cancel_refundable: kind === 'time_credit' && values.organizer_cancel_refundable,
      eligibility_policy: {
        approved_member_required: values.approved_member_required,
        minimum_account_age_days: accountAge,
        required_group_ids: groupIds
      }
    }
  };
}

function renderTicketForm(req, res, { event, ticketType = null, values, errors = [], apiFailed = false }) {
  noStore(res);
  return res.status(errors.length || apiFailed ? 422 : 200).render('events/ticket-type-form', {
    title: res.locals.t(ticketType ? 'govuk_alpha_events.ticket_types.edit_title' : 'govuk_alpha_events.ticket_types.create_title'),
    activeNav: 'events',
    event,
    ticketType,
    values,
    errors,
    fieldErrors: Object.fromEntries(errors.map((error) => [error.field, error.text])),
    apiFailed,
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

async function managedTicketContext(req, res, id) {
  const token = tokenFrom(req);
  const [event, catalogue] = await Promise.all([loadEvent(token, id), loadCatalogue(token, id)]);
  if (!catalogue.canManage) {
    renderForbidden(res);
    return null;
  }
  return { token, event, catalogue };
}

function findTicketType(catalogue, ticketTypeId) {
  return catalogue.ticketTypes.find((type) => positiveInteger(type?.id) === ticketTypeId) || null;
}

function notFound(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('govuk_alpha.error_pages.404_title') });
}

router.get('/:id(\\d+)/tickets/manage', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  noStore(res);
  return res.render('events/ticket-types', {
    title: res.locals.t('govuk_alpha_events.ticket_types.title'),
    activeNav: 'events',
    event: context.event,
    ticketTypes: context.catalogue.ticketTypes.map((type) => ticketTypeView(type, context.event.timezone)).filter((type) => type.id !== null),
    timeCreditSupported: context.catalogue.timeCreditSupported,
    status: TICKET_STATUSES.includes(trimmed(req.query.status)) ? trimmed(req.query.status) : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/tickets/types/new', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  return renderTicketForm(req, res, { event: context.event, values: blankTicketForm() });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/tickets/types/new', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  const form = readTicketForm(req.body, context.event.timezone, res.locals.t);
  const key = trimmed(req.body.idempotency_key, 191);
  if (!form.payload || key.length < 8) {
    return renderTicketForm(req, res, { event: context.event, values: form.values, errors: form.errors, apiFailed: !form.errors.length });
  }
  try {
    await eventMutation(context.token, 'POST', `/${encodeURIComponent(id)}/ticket-types`, form.payload, key);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status < 500) {
      return renderTicketForm(req, res, { event: context.event, values: form.values, apiFailed: true });
    }
    throw error;
  }
  return redirectTo(res, `${eventPath(id, '/tickets/manage')}?status=created`);
}, { notFoundTitle: 'Event not found' }));

router.get('/:id(\\d+)/tickets/types/:ticketTypeId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  const type = findTicketType(context.catalogue, Number(req.params.ticketTypeId));
  if (!type || !ticketTypeView(type, context.event.timezone).canEdit) return notFound(res);
  return renderTicketForm(req, res, {
    event: context.event,
    ticketType: ticketTypeView(type, context.event.timezone),
    values: ticketFormFromType(type, context.event.timezone)
  });
}, { notFoundTitle: 'Event not found' }));

router.post('/:id(\\d+)/tickets/types/:ticketTypeId(\\d+)/edit', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ticketTypeId = Number(req.params.ticketTypeId);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  const type = findTicketType(context.catalogue, ticketTypeId);
  if (!type) return notFound(res);
  const ticketType = ticketTypeView(type, context.event.timezone);
  const form = readTicketForm(req.body, context.event.timezone, res.locals.t);
  const key = trimmed(req.body.idempotency_key, 191);
  const expectedVersion = positiveInteger(req.body.expected_version);
  if (!form.payload || key.length < 8 || !expectedVersion) {
    return renderTicketForm(req, res, { event: context.event, ticketType, values: form.values, errors: form.errors, apiFailed: !form.errors.length });
  }
  try {
    await eventMutation(context.token, 'PUT', `/${encodeURIComponent(id)}/ticket-types/${encodeURIComponent(ticketTypeId)}`, { ...form.payload, expected_version: expectedVersion }, key);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status < 500) {
      return renderTicketForm(req, res, { event: context.event, ticketType, values: form.values, apiFailed: true });
    }
    throw error;
  }
  return redirectTo(res, `${eventPath(id, '/tickets/manage')}?status=updated`);
}, { notFoundTitle: 'Event not found' }));

router.get(`/:id(\\d+)/tickets/types/:ticketTypeId(\\d+)/:action(${TICKET_ACTIONS.join('|')})`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const context = await managedTicketContext(req, res, id);
  if (!context) return undefined;
  const type = findTicketType(context.catalogue, Number(req.params.ticketTypeId));
  if (!type) return notFound(res);
  const ticketType = ticketTypeView(type, context.event.timezone);
  const action = req.params.action;
  const allowed = { activate: ticketType.canActivate, pause: ticketType.canPause, archive: ticketType.canArchive }[action];
  if (!allowed) return notFound(res);
  noStore(res);
  return res.render('events/ticket-type-action', {
    title: res.locals.t(`govuk_alpha_events.ticket_types.${action}_title`),
    activeNav: 'events',
    event: context.event,
    ticketType,
    action,
    needsReason: action !== 'activate',
    blockedByGateway: action === 'activate' && ticketType.kind === 'time_credit' && !context.catalogue.timeCreditSupported,
    status: ['failed', 'reason-required'].includes(trimmed(req.query.status)) ? trimmed(req.query.status) : '',
    idempotencyKey: randomUUID(),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Event not found' }));

router.post(`/:id(\\d+)/tickets/types/:ticketTypeId(\\d+)/:action(${TICKET_ACTIONS.join('|')})`, requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ticketTypeId = Number(req.params.ticketTypeId);
  const action = req.params.action;
  const actionPath = eventPath(id, `/tickets/types/${ticketTypeId}/${action}`);
  const key = trimmed(req.body.idempotency_key, 191);
  const expectedVersion = positiveInteger(req.body.expected_version);
  const reason = trimmed(req.body.reason, 501);
  if (!key || key.length < 8 || !expectedVersion) return redirectTo(res, `${actionPath}?status=failed`);
  if (action !== 'activate' && (!reason || reason.length > 500)) return redirectTo(res, `${actionPath}?status=reason-required`);
  try {
    await eventMutation(tokenFrom(req), 'POST', `/${encodeURIComponent(id)}/ticket-types/${encodeURIComponent(ticketTypeId)}/${encodeURIComponent(action)}`, {
      expected_version: expectedVersion,
      ...(action === 'activate' ? {} : { reason })
    }, key);
  } catch (error) {
    if (isAuthError(error)) throw error;
    if (error instanceof ApiError && error.status < 500) return redirectTo(res, `${actionPath}?status=failed`);
    throw error;
  }
  const done = { activate: 'activated', pause: 'paused', archive: 'archived' }[action];
  return redirectTo(res, `${eventPath(id, '/tickets/manage')}?status=${done}`);
}, { notFoundTitle: 'Event not found' }));

module.exports = router;
module.exports._test = { wallClockToUtc, wallClockInZone, readTicketForm };
