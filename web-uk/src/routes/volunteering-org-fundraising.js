// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * An organisation runs fundraising campaigns (gap B7, part 2, 7 Oct 2026). The
 * accessible site had no fundraising page for an organisation; the website's
 * Fundraising tab (OrgFundraisingTab.tsx) has had one since 5 Oct, and these pages
 * follow its rules as GOV.UK pages.
 *
 *   GET       /volunteering/organisations/:orgId/fundraising                                the campaigns
 *   GET|POST  /volunteering/organisations/:orgId/fundraising/new                            start one
 *   GET       /volunteering/organisations/:orgId/fundraising/:campaignId                    gifts, hand-overs, history
 *   GET|POST  /volunteering/organisations/:orgId/fundraising/:campaignId/edit               change it
 *   POST      /volunteering/organisations/:orgId/fundraising/:campaignId/pause|resume       pause or resume
 *   GET|POST  /volunteering/organisations/:orgId/fundraising/:campaignId/end                end it, after a warning
 *   POST      /volunteering/organisations/:orgId/fundraising/:campaignId/handovers/:handoverId/confirm
 *
 * API: /v2/volunteering/organisations/{id}/campaigns[...] and .../handovers/{id}/confirm
 * (OrgFundraisingController). Owner decisions of 5 Oct 2026, kept here: a campaign goes
 * live with no approval step; gifts are held by the community and passed on; the
 * organisation confirms each hand-over; the organisation never sees donor contact or
 * Gift Aid details (the API does not send them). Who may use these pages is the API's
 * decision (the organisation's owner and administrators); the organisation is always
 * the one in the address, never one sent in a form.
 */

const express = require('express');
const { ApiError, callVolunteeringApi } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
const { readDate, splitDate, dateParts } = require('../lib/date-input');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const KEY = 'govuk_alpha_volunteering.org_fundraising.';
const LOGIN = '/login?status=auth-required';
const REPLAY = 'volunteeringOrgFundraising';
const CAMPAIGN_STATUSES = ['active', 'upcoming', 'paused', 'ended'];
const STATUS_TAGS = { active: 'govuk-tag--green', upcoming: 'govuk-tag--blue', paused: 'govuk-tag--yellow', ended: 'govuk-tag--grey' };
const GIFT_STATUSES = ['pending', 'completed', 'refunded', 'failed'];
const HANDOVER_STATUSES = ['recorded', 'confirmed', 'cancelled'];
const HANDOVER_TAGS = { recorded: 'govuk-tag--yellow', confirmed: 'govuk-tag--green', cancelled: 'govuk-tag--grey' };
const HANDOVER_METHODS = ['bank_transfer', 'cheque', 'cash', 'other'];
const ACTORS = ['community_admin', 'org_admin', 'member', 'stripe', 'system'];
const HISTORY_FIELDS = ['title', 'description', 'start_date', 'end_date', 'goal_amount', 'target_hours', 'organization_id'];
const MAX_TITLE = 255;
const MAX_DESCRIPTION = 5000;
const MAX_GOAL = 100000000;

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

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataOf(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function isStatus(error, status) {
  return error instanceof ApiError && error.status === status;
}

function apiMessage(error) {
  const errors = error && error.data && Array.isArray(error.data.errors) ? error.data.errors : [];
  return trimmed((errors[0] && errors[0].message) || (error && error.data && (error.data.message || error.data.error)), 500);
}

function errorPage(res, status) {
  const titles = { 403: 'error_pages.403_title', 404: 'error_pages.404_title' };
  return res.status(status).render(`errors/${status}`, { title: res.locals.t(titles[status]) });
}

/** 401 → sign in; 403 / 404 → their pages. True when it has responded. */
function answerRefusal(error, res) {
  if (isStatus(error, 401)) {
    redirectTo(res, LOGIN);
    return true;
  }
  if (isStatus(error, 403)) {
    errorPage(res, 403);
    return true;
  }
  if (isStatus(error, 404)) {
    errorPage(res, 404);
    return true;
  }
  return false;
}

function listPath(orgId, status) {
  return `/volunteering/organisations/${orgId}/fundraising${status ? `?status=${encodeURIComponent(status)}` : ''}`;
}

function campaignPath(orgId, campaignId, status) {
  return `/volunteering/organisations/${orgId}/fundraising/${campaignId}${status ? `?status=${encodeURIComponent(status)}` : ''}`;
}

function tenantCurrency(req) {
  const configured = trimmed(req.accessibleRouting?.tenant?.settings?.default_currency).toUpperCase();
  return /^[A-Z]{3}$/.test(configured) ? configured : 'EUR';
}

function money(amount, currency) {
  const value = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const plain = () => new Intl.NumberFormat(getRequestIntlLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  if (!/^[A-Z]{3}$/.test(String(currency || ''))) return plain();
  try {
    return new Intl.NumberFormat(getRequestIntlLocale(), { style: 'currency', currency }).format(value);
  } catch {
    return plain();
  }
}

function day(value) {
  const parts = splitDate(value);
  if (!parts.year) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day))));
}

function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

// ── Loading and presenting ───────────────────────────────────────────────────

async function loadCampaigns(token, orgId) {
  const data = dataOf(await callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/campaigns`)) || {};
  return Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
}

function campaignStatus(raw) {
  const status = trimmed(raw.status);
  if (CAMPAIGN_STATUSES.includes(status)) return status;
  return raw.is_active === true || raw.is_active === 1 || raw.is_active === '1' ? 'active' : 'ended';
}

function presentCampaign(raw, t, currency) {
  const campaign = raw && typeof raw === 'object' ? raw : {};
  const status = campaignStatus(campaign);
  const goal = Number(campaign.goal_amount ?? campaign.target_amount ?? 0) || 0;
  const raised = Number(campaign.raised_amount ?? 0) || 0;
  return {
    id: positiveInteger(campaign.id),
    title: trimmed(campaign.title ?? campaign.name, MAX_TITLE),
    description: trimmed(campaign.description, MAX_DESCRIPTION),
    startDate: trimmed(campaign.start_date, 10),
    endDate: trimmed(campaign.end_date, 10),
    goal,
    status,
    statusLabel: t(`${KEY}status.${status}`),
    statusClass: STATUS_TAGS[status],
    raisedLabel: t(`${KEY}raised_of_goal`, { raised: money(raised, currency), goal: money(goal, currency) }),
    datesLabel: t(`${KEY}dates`, { start: day(campaign.start_date), end: day(campaign.end_date) }),
    canPause: status === 'active' || status === 'upcoming',
    canResume: status === 'paused',
    canEnd: status !== 'ended'
  };
}

/**
 * The campaign, if it belongs to this organisation and the member may manage it.
 * Responds itself and returns null when the page must not go on.
 */
async function managedCampaign(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, LOGIN);
    return null;
  }
  const orgId = Number(req.params.orgId);
  const campaignId = Number(req.params.campaignId);
  let rows;
  try {
    rows = await loadCampaigns(token, orgId);
  } catch (error) {
    if (answerRefusal(error, res)) return null;
    throw error;
  }
  const raw = rows.find((row) => positiveInteger(row?.id) === campaignId);
  if (!raw) {
    errorPage(res, 404);
    return null;
  }
  const currency = tenantCurrency(req);
  return { token, orgId, campaignId, currency, campaign: presentCampaign(raw, res.locals.t, currency) };
}

function presentGift(raw, t) {
  const gift = raw && typeof raw === 'object' ? raw : {};
  const status = GIFT_STATUSES.includes(gift.status) ? gift.status : 'pending';
  const method = gift.payment_method === 'card' ? 'card' : 'pledge';
  return {
    id: positiveInteger(gift.id),
    dateLabel: day(gift.created_at),
    donor: trimmed(gift.display_name) || t(`${KEY}anonymous`),
    amountLabel: money(gift.amount, gift.currency),
    refundedLabel: Number(gift.amount_refunded) > 0 ? money(gift.amount_refunded, gift.currency) : '',
    methodLabel: t(`${KEY}method.${method}`),
    statusLabel: t(`${KEY}gift_status.${status}`)
  };
}

function presentHandover(raw, t) {
  const handover = raw && typeof raw === 'object' ? raw : {};
  const status = HANDOVER_STATUSES.includes(handover.status) ? handover.status : 'recorded';
  const method = HANDOVER_METHODS.includes(handover.method) ? handover.method : 'other';
  return {
    id: positiveInteger(handover.id),
    status,
    statusLabel: t(`${KEY}handovers.status.${status}`),
    statusClass: HANDOVER_TAGS[status],
    amountLabel: money(handover.amount, handover.currency),
    dateLabel: day(handover.handed_over_on),
    methodLabel: t(`${KEY}handovers.methods.${method}`),
    reference: trimmed(handover.reference),
    note: trimmed(handover.note, 2000),
    recordedBy: trimmed(handover.recorded_by_name),
    confirmedBy: trimmed(handover.confirmed_by_name),
    cancelledBy: trimmed(handover.cancelled_by_name),
    cancelReason: trimmed(handover.cancel_reason, 2000),
    canConfirm: status === 'recorded'
  };
}

function presentHistory(raw, t) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const actor = ACTORS.includes(item.actor_kind) ? item.actor_kind : 'system';
  const eventKey = `${KEY}history.event.${trimmed(item.event)}`;
  const eventLabel = t(eventKey);
  const changes = item.details && item.details.changes && typeof item.details.changes === 'object' ? item.details.changes : {};
  const value = (v) => (v === null || v === undefined || v === '' ? t(`${KEY}history.empty_value`) : String(v));
  return {
    id: positiveInteger(item.id),
    event: eventLabel !== eventKey ? eventLabel : trimmed(item.event),
    by: trimmed(item.actor_name) ? t(`${KEY}history.by`, { name: trimmed(item.actor_name) }) : t(`${KEY}history.actor.${actor}`),
    when: day(item.created_at),
    amountLabel: item.amount !== null && item.amount !== undefined && item.currency ? money(item.amount, item.currency) : '',
    giftNumber: positiveInteger(item.donation_id) ? t(`${KEY}history.gift_number`, { number: item.donation_id }) : '',
    changes: Object.entries(changes).map(([field, change]) => t(`${KEY}history.change`, {
      field: HISTORY_FIELDS.includes(field) ? t(`${KEY}history.field.${field}`) : field,
      from: value(change?.from_label ?? change?.from),
      to: value(change?.to_label ?? change?.to)
    })),
    reason: trimmed(item.details?.reason, 2000)
  };
}

// ── The list ─────────────────────────────────────────────────────────────────

const LIST_OUTCOMES = {
  'campaign-saved': ['success', 'saved'],
  'campaign-paused': ['success', 'paused_done'],
  'campaign-resumed': ['success', 'resumed_done'],
  'campaign-ended': ['success', 'ended_done'],
  'campaign-failed': ['error', 'change_failed']
};

router.get('/organisations/:orgId(\\d+)/fundraising', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const t = res.locals.t;
  const orgId = Number(req.params.orgId);
  const currency = tenantCurrency(req);
  let rows;
  let orgName = '';
  try {
    const [campaigns, stats] = await Promise.all([
      loadCampaigns(token, orgId),
      callVolunteeringApi(token, 'GET', `/organisations/${encodeURIComponent(orgId)}/stats`).catch(() => null)
    ]);
    rows = campaigns;
    const statsData = dataOf(stats) || {};
    orgName = trimmed(statsData.org_name ?? statsData.orgName);
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    throw error;
  }
  const outcome = LIST_OUTCOMES[trimmed(req.query.status)] || null;
  return res.render('volunteering/org-fundraising', {
    title: t(`${KEY}title`),
    activeNav: 'volunteering',
    orgId,
    orgName,
    campaigns: rows.map((row) => presentCampaign(row, t, currency)).filter((campaign) => campaign.id),
    outcome: outcome ? { type: outcome[0], message: t(`${KEY}${outcome[1]}`) } : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// ── Start or change a campaign ───────────────────────────────────────────────

function formFromCampaign(campaign) {
  return {
    title: campaign ? campaign.title : '',
    description: campaign ? campaign.description : '',
    startDateParts: splitDate(campaign ? campaign.startDate : ''),
    endDateParts: splitDate(campaign ? campaign.endDate : ''),
    goal: campaign && campaign.goal ? String(campaign.goal) : ''
  };
}

function formFromBody(body) {
  return {
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    startDateParts: dateParts(body, 'start_date'),
    endDateParts: dateParts(body, 'end_date'),
    goal: String(body.goal_amount ?? '')
  };
}

function validate(body, t) {
  const errors = [];
  const fields = {};
  const add = (field, href, key) => {
    fields[field] = t(`${KEY}${key}`);
    errors.push({ href, text: fields[field] });
  };
  const title = trimmed(body.title, 1000);
  const start = readDate(body, 'start_date', { required: true });
  const end = readDate(body, 'end_date', { required: true });
  const goalText = trimmed(body.goal_amount).replace(/[,\s]/g, '');
  const goal = /^\d+(\.\d{1,2})?$/.test(goalText) ? Number(goalText) : NaN;

  if (!title) add('title', '#title', 'error_title');
  else if (title.length > MAX_TITLE) add('title', '#title', 'error_title_long');
  if (start.error) add('startDate', '#start_date-day', 'error_start');
  if (end.error) add('endDate', '#end_date-day', 'error_end');
  else if (start.value && end.value && end.value < start.value) add('endDate', '#end_date-day', 'error_end_before_start');
  if (!(goal > 0) || goal > MAX_GOAL) add('goal', '#goal_amount', 'error_goal');

  return {
    errors,
    fields,
    payload: {
      title,
      description: trimmed(body.description, MAX_DESCRIPTION),
      start_date: start.value,
      end_date: end.value,
      goal_amount: goal
    }
  };
}

function renderForm(req, res, view) {
  const t = res.locals.t;
  return res.status(view.statusCode || 200).render('volunteering/org-fundraising-form', {
    title: t(`${KEY}${view.campaignId ? 'edit_campaign' : 'new_campaign'}`),
    activeNav: 'volunteering',
    orgId: view.orgId,
    campaignId: view.campaignId || null,
    currency: view.currency,
    form: view.form,
    errors: view.errors || [],
    fieldErrors: view.fieldErrors || {},
    failure: view.failure || '',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

async function saveCampaign(req, res, { orgId, campaignId, token, currency }) {
  const checked = validate(req.body, res.locals.t);
  if (checked.errors.length) {
    return renderForm(req, res, { statusCode: 400, orgId, campaignId, currency, form: formFromBody(req.body), errors: checked.errors, fieldErrors: checked.fields });
  }
  try {
    if (campaignId) {
      await callVolunteeringApi(token, 'PUT', `/organisations/${encodeURIComponent(orgId)}/campaigns/${encodeURIComponent(campaignId)}`, checked.payload);
    } else {
      await callVolunteeringApi(token, 'POST', `/organisations/${encodeURIComponent(orgId)}/campaigns`, checked.payload);
    }
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    // A 422 carries the API's own (translated) reason, e.g. an organisation that is not
    // approved, or dates the service will not accept.
    const failure = isStatus(error, 422) && apiMessage(error) ? apiMessage(error) : res.locals.t(`${KEY}save_failed`);
    rememberFormReplay(req, REPLAY, `${orgId}:${campaignId || 'new'}`, { form: formFromBody(req.body), failure });
    return redirectTo(res, campaignId
      ? `/volunteering/organisations/${orgId}/fundraising/${campaignId}/edit`
      : `/volunteering/organisations/${orgId}/fundraising/new`);
  }
  return redirectTo(res, listPath(orgId, 'campaign-saved'));
}

router.get('/organisations/:orgId(\\d+)/fundraising/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  const orgId = Number(req.params.orgId);
  try {
    await loadCampaigns(token, orgId); // the API decides who may run this organisation's fundraising
  } catch (error) {
    if (answerRefusal(error, res)) return undefined;
    throw error;
  }
  const replay = consumeFormReplay(req, REPLAY, `${orgId}:new`);
  return renderForm(req, res, { orgId, currency: tenantCurrency(req), form: replay?.form || formFromCampaign(null), failure: replay?.failure });
}));

router.post('/organisations/:orgId(\\d+)/fundraising/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, LOGIN);
  return saveCampaign(req, res, { orgId: Number(req.params.orgId), campaignId: null, token, currency: tenantCurrency(req) });
}));

router.get('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/edit', asyncRoute(async (req, res) => {
  const managed = await managedCampaign(req, res);
  if (!managed) return undefined;
  const replay = consumeFormReplay(req, REPLAY, `${managed.orgId}:${managed.campaignId}`);
  return renderForm(req, res, {
    orgId: managed.orgId,
    campaignId: managed.campaignId,
    currency: managed.currency,
    form: replay?.form || formFromCampaign(managed.campaign),
    failure: replay?.failure
  });
}));

router.post('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/edit', asyncRoute(async (req, res) => {
  const managed = await managedCampaign(req, res);
  if (!managed) return undefined;
  return saveCampaign(req, res, managed);
}));

// ── Pause, resume, end ───────────────────────────────────────────────────────

function campaignChange(changes, outcome) {
  return asyncRoute(async (req, res) => {
    const managed = await managedCampaign(req, res);
    if (!managed) return undefined;
    const body = typeof changes === 'function' ? changes() : changes;
    try {
      await callVolunteeringApi(managed.token, 'PUT', `/organisations/${encodeURIComponent(managed.orgId)}/campaigns/${encodeURIComponent(managed.campaignId)}`, body);
    } catch (error) {
      if (answerRefusal(error, res)) return undefined;
      return redirectTo(res, listPath(managed.orgId, 'campaign-failed'));
    }
    return redirectTo(res, listPath(managed.orgId, outcome));
  });
}

router.post('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/pause', campaignChange({ is_active: false }, 'campaign-paused'));
router.post('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/resume', campaignChange({ is_active: true }, 'campaign-resumed'));

router.get('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/end', asyncRoute(async (req, res) => {
  const managed = await managedCampaign(req, res);
  if (!managed) return undefined;
  if (!managed.campaign.canEnd) return redirectTo(res, listPath(managed.orgId));
  return res.render('volunteering/org-fundraising-end', {
    title: res.locals.t(`${KEY}end`),
    activeNav: 'volunteering',
    orgId: managed.orgId,
    campaign: managed.campaign,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// Ending = stop taking gifts and close the dates today, as the website does.
router.post('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/end', campaignChange(() => ({ is_active: false, end_date: todayIso() }), 'campaign-ended'));

// ── One campaign: gifts, hand-overs, history ─────────────────────────────────

const DETAIL_OUTCOMES = {
  'handover-confirmed': ['success', 'handovers.confirmed'],
  'handover-failed': ['error', 'handover_confirm_failed']
};

router.get('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)', asyncRoute(async (req, res) => {
  const managed = await managedCampaign(req, res);
  if (!managed) return undefined;
  const t = res.locals.t;
  // Each section loads on its own, so one failing does not take the page down. The
  // paths are written out in full: the API consumer ledger cannot resolve a path built
  // from a shared prefix.
  const section = async (load) => {
    try {
      return { ok: true, data: dataOf(await load()) || {} };
    } catch {
      return { ok: false, data: {} };
    }
  };
  const loadGifts = () => callVolunteeringApi(managed.token, 'GET', `/organisations/${encodeURIComponent(managed.orgId)}/campaigns/${encodeURIComponent(managed.campaignId)}/gifts`);
  const loadHandovers = () => callVolunteeringApi(managed.token, 'GET', `/organisations/${encodeURIComponent(managed.orgId)}/campaigns/${encodeURIComponent(managed.campaignId)}/handovers`);
  const loadHistory = () => callVolunteeringApi(managed.token, 'GET', `/organisations/${encodeURIComponent(managed.orgId)}/campaigns/${encodeURIComponent(managed.campaignId)}/history`);
  const [gifts, handovers, history] = await Promise.all([section(loadGifts), section(loadHandovers), section(loadHistory)]);
  const summary = handovers.data.summary && typeof handovers.data.summary === 'object' ? handovers.data.summary : null;
  const summaryCurrency = trimmed(summary?.currency) || managed.currency;
  const outcome = DETAIL_OUTCOMES[trimmed(req.query.status)] || null;

  return res.render('volunteering/org-fundraising-campaign', {
    title: managed.campaign.title || t(`${KEY}title`),
    activeNav: 'volunteering',
    orgId: managed.orgId,
    campaign: managed.campaign,
    gifts: (Array.isArray(gifts.data.items) ? gifts.data.items : []).map((row) => presentGift(row, t)).filter((g) => g.id),
    giftsFailed: !gifts.ok,
    handovers: (Array.isArray(handovers.data.items) ? handovers.data.items : []).map((row) => presentHandover(row, t)).filter((h) => h.id),
    handoversFailed: !handovers.ok,
    handoverTotals: summary ? [
      { label: t(`${KEY}handovers.raised`), value: money(summary.raised, summaryCurrency) },
      { label: t(`${KEY}handovers.handed_over`), value: money(summary.handed_over, summaryCurrency) },
      { label: t(`${KEY}handovers.still_held`), value: money(summary.still_held, summaryCurrency) }
    ] : [],
    history: (Array.isArray(history.data.items) ? history.data.items : []).map((row) => presentHistory(row, t)).filter((h) => h.id),
    historyFailed: !history.ok,
    outcome: outcome ? { type: outcome[0], message: t(`${KEY}${outcome[1]}`) } : null,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/organisations/:orgId(\\d+)/fundraising/:campaignId(\\d+)/handovers/:handoverId(\\d+)/confirm', asyncRoute(async (req, res) => {
  const managed = await managedCampaign(req, res);
  if (!managed) return undefined;
  try {
    await callVolunteeringApi(managed.token, 'POST', `/organisations/${encodeURIComponent(managed.orgId)}/handovers/${encodeURIComponent(Number(req.params.handoverId))}/confirm`);
  } catch (error) {
    if (isStatus(error, 401)) return redirectTo(res, LOGIN);
    return redirectTo(res, campaignPath(managed.orgId, managed.campaignId, 'handover-failed'));
  }
  return redirectTo(res, campaignPath(managed.orgId, managed.campaignId, 'handover-confirmed'));
}));

module.exports = router;
