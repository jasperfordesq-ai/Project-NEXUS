// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, getMyAdCampaigns, createMyAdCampaign } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDate } = require('../lib/date-input');

const router = express.Router();

/**
 * Self-serve ad campaigns (React `advertise/campaigns`, feature `local_advertising`).
 *
 * A member lists their own campaigns and submits a new one for review. There is
 * no payment step: Laravel stores the campaign as `pending_review` and an admin
 * approves it. Push campaigns are deliberately absent from this frontend.
 *
 * Contract notes, from the Laravel controller rather than the React page:
 * - the placement field is `placement` (React posts `type`, which Laravel ignores);
 * - Laravel does not read a targeting radius, so this form does not ask for one.
 */

const PLACEMENTS = Object.freeze(['feed', 'discovery']);
const STATUS_TAGS = Object.freeze({
  pending_review: { key: 'status_pending', tag: 'govuk-tag--yellow' },
  active: { key: 'status_active', tag: 'govuk-tag--green' },
  paused: { key: 'status_paused', tag: 'govuk-tag--grey' },
  completed: { key: 'status_ended', tag: 'govuk-tag--grey' },
  rejected: { key: 'status_rejected', tag: 'govuk-tag--red' }
});

function ad(t, key, params) {
  return t(`govuk_alpha_settings.advertise.${key}`, params);
}

function trimmed(value, limit = 255) {
  return String(value ?? '').trim().slice(0, limit);
}

function money(res, cents) {
  const value = Number(cents);
  return res.locals.formatLocaleNumber(Number.isFinite(value) ? value / 100 : 0, {
    style: 'currency', currency: 'EUR'
  });
}

function normalizeCampaign(campaign, res) {
  const t = res.locals.t;
  const status = STATUS_TAGS[campaign?.status] || { key: null, tag: 'govuk-tag--grey' };
  const placement = PLACEMENTS.includes(campaign?.placement) ? campaign.placement : '';
  const impressions = Number(campaign?.impression_count) || 0;
  const clicks = Number(campaign?.click_count) || 0;
  const start = trimmed(campaign?.start_date, 32);
  const end = trimmed(campaign?.end_date, 32);
  const dateOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return {
    id: Number(campaign?.id) || 0,
    name: trimmed(campaign?.name),
    placementLabel: placement ? ad(t, `type_${placement}`) : trimmed(campaign?.placement, 32),
    statusLabel: status.key ? ad(t, status.key) : trimmed(campaign?.status, 32),
    statusTag: status.tag,
    budgetLabel: money(res, campaign?.budget_cents),
    datesLabel: start && end
      ? ad(t, 'date_range', {
        start: res.locals.formatLocaleDate(`${start.slice(0, 10)}T12:00:00Z`, dateOptions),
        end: res.locals.formatLocaleDate(`${end.slice(0, 10)}T12:00:00Z`, dateOptions)
      })
      : '',
    impressionsLabel: res.locals.formatLocaleNumber(impressions),
    clicksLabel: res.locals.formatLocaleNumber(clicks),
    ctrLabel: impressions > 0
      ? res.locals.formatLocaleNumber(clicks / impressions, { style: 'percent', maximumFractionDigits: 2 })
      : res.locals.formatLocaleNumber(0, { style: 'percent' })
  };
}

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  let campaigns = [];
  let loadFailed = false;
  let disabled = false;
  try {
    const result = await getMyAdCampaigns(req.token);
    const data = result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
    campaigns = (Array.isArray(data) ? data : []).map((campaign) => normalizeCampaign(campaign, res));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (error instanceof ApiError && error.status === 403) disabled = true;
    else loadFailed = true;
  }

  return res.render('advertise/campaigns', {
    title: ad(t, 'page_title'),
    activeNav: 'account',
    campaigns,
    loadFailed,
    disabled,
    created: req.query.status === 'created'
  });
}));

function renderForm(req, res, values = {}, errors = []) {
  const t = res.locals.t;
  return res.render('advertise/new', {
    title: ad(t, 'create_campaign'),
    activeNav: 'account',
    values,
    errors,
    errorFor: Object.fromEntries(errors.map((error) => [error.field, error.text])),
    placements: PLACEMENTS,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}

router.get('/new', asyncRoute(async (req, res) => renderForm(req, res, { placement: 'feed' })));

router.post('/new', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const body = req.body || {};
  const name = trimmed(body.name);
  const placement = PLACEMENTS.includes(body.placement) ? body.placement : '';
  const budgetText = trimmed(body.budget, 16).replace(',', '.');
  const budget = /^\d+(?:\.\d{1,2})?$/.test(budgetText) ? Number(budgetText) : 0;
  const start = readDate(body, 'start_date', { required: true });
  const end = readDate(body, 'end_date', { required: true });

  const errors = [];
  if (!name) errors.push({ field: 'name', href: '#ad-name', text: ad(t, 'validation_required') });
  if (!placement) errors.push({ field: 'placement', href: '#ad-placement', text: ad(t, 'validation_required') });
  if (start.error) errors.push({ field: 'start_date', href: '#start_date-day', text: t(`web_uk.date_input.${start.error}`), fields: start.errorFields });
  if (end.error) errors.push({ field: 'end_date', href: '#end_date-day', text: t(`web_uk.date_input.${end.error}`), fields: end.errorFields });
  if (!start.error && !end.error && end.value < start.value) {
    errors.push({ field: 'end_date', href: '#end_date-day', text: ad(t, 'end_before_start'), fields: ['day', 'month', 'year'] });
  }
  if (budget < 1) errors.push({ field: 'budget', href: '#ad-budget', text: ad(t, 'validation_budget') });

  const values = {
    name,
    placement: placement || 'feed',
    budget: trimmed(body.budget, 16),
    startParts: start.parts,
    endParts: end.parts,
    startErrorFields: start.errorFields || [],
    endErrorFields: (errors.find((error) => error.field === 'end_date') || {}).fields || []
  };
  if (errors.length) return renderForm(req, res.status(422), values, errors);

  try {
    await createMyAdCampaign(req.token, {
      name,
      placement,
      start_date: start.value,
      end_date: end.value,
      budget_cents: Math.round(budget * 100)
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return renderForm(req, res.status(error instanceof ApiError && error.status < 500 ? 422 : 503), values, [
      { field: 'form', href: '#ad-name', text: ad(t, 'create_error') }
    ]);
  }

  return res.redirect(`${res.locals.urlFor('/advertise/campaigns')}?status=created`);
}));

module.exports = router;
