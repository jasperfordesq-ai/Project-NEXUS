// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getExchangeConfig,
  getExchanges,
  getExchange,
  getExchangeRatings,
  performExchangeAction,
  rateExchange,
  ApiError,
  ApiOfflineError
} = require('../lib/api');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

router.use(requireAuth);

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function unwrapObject(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
  if (payload.data && Array.isArray(payload.data.data)) return payload.data.data;
  return [];
}

function unwrapMeta(payload) {
  if (!payload || typeof payload !== 'object') return {};
  return payload.meta || payload.pagination || payload.data?.meta || {};
}

function unwrapRatings(payload) {
  const data = unwrapObject(payload);
  if (Array.isArray(data)) return { ratings: data, hasRated: false };
  return {
    ratings: Array.isArray(data.ratings) ? data.ratings : [],
    hasRated: !!firstPresent(data.has_rated, data.hasRated, false)
  };
}

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function confirmationHours(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0.25 && number <= 24 ? number : null;
}

function normalizeRating(rating = {}, t = (key) => key) {
  const rater = rating.rater && typeof rating.rater === 'object' ? rating.rater : {};
  const fullName = [rating.rater_first_name, rating.rater_last_name]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return {
    ...rating,
    raterName: firstPresent(fullName, rater.name, rating.rater_username, t('members.unknown_member'))
  };
}

function labelFromKey(value, fallback = '') {
  const key = String(value || fallback || '').replace(/_/g, ' ').trim();
  const lower = key.toLowerCase();
  return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : '';
}

function statusTagClass(status) {
  switch (status) {
    case 'completed':
      return 'govuk-tag--green';
    case 'in_progress':
      return 'govuk-tag--blue';
    case 'accepted':
      return 'govuk-tag--turquoise';
    case 'pending_provider':
    case 'pending_broker':
    case 'pending_confirmation':
      return 'govuk-tag--yellow';
    case 'disputed':
      return 'govuk-tag--red';
    case 'cancelled':
    case 'expired':
    case 'declined':
      return 'govuk-tag--grey';
    default:
      return 'govuk-tag--grey';
  }
}

function normalizeExchange(exchange = {}, currentUserId = null, t = (key) => key) {
  const listing = exchange.listing && typeof exchange.listing === 'object' ? exchange.listing : {};
  const requester = exchange.requester && typeof exchange.requester === 'object' ? exchange.requester : {};
  const provider = exchange.provider && typeof exchange.provider === 'object' ? exchange.provider : {};
  const requesterId = toNumber(firstPresent(exchange.requester_id, requester.id), 0);
  const providerId = toNumber(firstPresent(exchange.provider_id, provider.id), 0);
  const status = firstPresent(exchange.status, 'pending_provider');
  const isRequester = currentUserId !== null && requesterId === Number(currentUserId);
  const isProvider = currentUserId !== null && providerId === Number(currentUserId);
  const hasRequesterConfirmed = !!exchange.requester_confirmed_at;
  const hasProviderConfirmed = !!exchange.provider_confirmed_at;
  const viewerConfirmed = (isRequester && hasRequesterConfirmed) || (isProvider && hasProviderConfirmed);
  const actionNeeded = status === 'pending_provider' && isProvider
    ? 'respond'
    : (['in_progress', 'pending_confirmation'].includes(status) && !viewerConfirmed ? 'confirm' : null);

  const localizedStatuses = new Set([
    'active', 'pending_provider', 'pending_broker', 'accepted', 'in_progress',
    'pending_confirmation', 'completed', 'disputed', 'cancelled', 'expired'
  ]);
  const riskLevel = firstPresent(exchange.risk_level, 'unknown');

  return {
    ...exchange,
    id: exchange.id,
    listingId: firstPresent(exchange.listing_id, listing.id),
    listingTitle: firstPresent(exchange.listing_title, listing.title, t('exchanges.detail_title')),
    requesterId,
    providerId,
    requesterName: firstPresent(exchange.requester_name, requester.name, t('members.unknown_member')),
    providerName: firstPresent(exchange.provider_name, provider.name, t('members.unknown_member')),
    proposedHours: toNumber(exchange.proposed_hours, 0),
    prepTime: toNumber(exchange.prep_time, null),
    finalHours: toNumber(exchange.final_hours, null),
    riskLevel,
    riskLabel: ['low', 'medium', 'high', 'critical', 'unknown'].includes(riskLevel)
      ? t(`exchanges.risk_values.${riskLevel}`)
      : labelFromKey(riskLevel, t('exchanges.risk_values.unknown')),
    message: firstPresent(exchange.message, exchange.requester_notes),
    status,
    statusLabel: localizedStatuses.has(status)
      ? t(`exchanges.statuses.${status}`)
      : labelFromKey(status, t('exchanges.statuses.pending_provider')),
    statusClass: statusTagClass(status),
    isRequester,
    isProvider,
    roleText: t(isRequester ? 'exchanges.role_requester' : 'exchanges.role_provider'),
    otherUserId: isRequester ? providerId : requesterId,
    otherName: isRequester
      ? firstPresent(exchange.provider_name, provider.name, t('members.unknown_member'))
      : firstPresent(exchange.requester_name, requester.name, t('members.unknown_member')),
    hasRequesterConfirmed,
    hasProviderConfirmed,
    canAccept: isProvider && status === 'pending_provider',
    canDecline: isProvider && status === 'pending_provider',
    canStart: isProvider && status === 'accepted',
    canComplete: isProvider && status === 'in_progress',
    canConfirm: (isRequester || isProvider) && ['in_progress', 'pending_confirmation'].includes(status) && !viewerConfirmed,
    canCancel: (isRequester || isProvider) && ['pending_provider', 'pending_broker', 'accepted'].includes(status),
    actionNeeded,
    createdAt: exchange.created_at,
    history: Array.isArray(exchange.status_history)
      ? exchange.status_history.map(entry => ({
        ...entry,
        statusLabel: localizedStatuses.has(firstPresent(entry.new_status, entry.old_status, status))
          ? t(`exchanges.statuses.${firstPresent(entry.new_status, entry.old_status, status)}`)
          : labelFromKey(firstPresent(entry.new_status, entry.old_status, status), status),
        actorName: firstPresent(entry.actor_name, entry.actor?.name)
      }))
      : []
  };
}

function statusForTab(tab) {
  switch (tab) {
    case 'active':
      return 'active';
    case 'needs_confirmation':
      return 'needs_confirmation';
    case 'completed':
      return 'completed';
    case 'all':
    default:
      return '';
  }
}

function flashValue(req, key) {
  return req.flash ? req.flash(key)[0] : null;
}

function statusMessage(status, t) {
  switch (status) {
    case 'exchange-created':
      return t('exchanges.created');
    case 'exchange-updated':
      return t('exchanges.updated');
    case 'rating-submitted':
      return t('exchanges.rating_submitted');
    case 'exchange-action-failed':
      return t('exchanges.failed');
    case 'rating-failed':
      return t('exchanges.rating_failed');
    case 'rating-invalid':
      return t('exchanges.rating_invalid');
    case 'exchange-hours-invalid':
      return t('exchanges.confirm_hours_hint');
    default:
      return '';
  }
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

router.get('/', asyncRoute(async (req, res) => {
  const tab = ['all', 'active', 'needs_confirmation', 'completed'].includes(req.query.tab) ? req.query.tab : 'all';
  const cursor = typeof req.query.cursor === 'string' ? req.query.cursor.trim() : '';
  const status = statusForTab(tab);

  let workflowEnabled = false;
  let workflowAvailable = false;
  let exchanges = [];
  let meta = {};
  let errorMessage = null;
  let currentUserId = null;

  const currentUser = await getRequestProfile(req, req.token).catch(() => null);
  currentUserId = toNumber(firstPresent(currentUser?.id, currentUser?.data?.id), null);

  try {
    const configPayload = await getExchangeConfig(req.token);
    workflowAvailable = true;
    workflowEnabled = unwrapObject(configPayload).exchange_workflow_enabled === true;
    if (workflowEnabled) {
      const exchangesPayload = await getExchanges(req.token, { status, per_page: 20, cursor });
      exchanges = unwrapList(exchangesPayload).map(exchange => normalizeExchange(exchange, currentUserId, res.locals.t));
      meta = unwrapMeta(exchangesPayload);
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (error instanceof ApiError || error instanceof ApiOfflineError) {
      errorMessage = res.locals.t('error_pages.503_body');
    } else {
      throw error;
    }
  }

  res.render('exchanges/index', {
    title: res.locals.t('exchanges.title'),
    workflowEnabled,
    workflowAvailable,
    activeTab: tab,
    exchanges,
    items: exchanges,
    meta,
    errorMessage,
    successMessage: flashValue(req, 'success'),
    statusMessage: statusMessage(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const [exchangePayload, profilePayload, ratingsPayload] = await Promise.all([
    getExchange(req.token, id),
    getRequestProfile(req, req.token).catch(() => null),
    getExchangeRatings(req.token, id).catch(() => ({ data: { ratings: [], has_rated: false } }))
  ]);
  const currentUserId = toNumber(firstPresent(profilePayload?.id, profilePayload?.data?.id), null);
  const exchange = normalizeExchange(unwrapObject(exchangePayload), currentUserId, res.locals.t);
  const ratings = unwrapRatings(ratingsPayload);

  res.render('exchanges/detail', {
    title: exchange.listingTitle,
    exchange,
    ratings: ratings.ratings.map(rating => normalizeRating(rating, res.locals.t)),
    canReview: exchange.status === 'completed' && !ratings.hasRated,
    status: req.query.status || '',
    successMessage: flashValue(req, 'success'),
    statusMessage: statusMessage(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/:id', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const action = String(req.body.action || '').trim();
  const hours = action === 'confirm' ? confirmationHours(req.body.hours) : null;
  if (action === 'confirm' && hours === null) {
    return redirectTo(res, `/exchanges/${id}?status=exchange-hours-invalid#hours`);
  }
  const actionPayload = (() => {
    switch (action) {
      case 'decline':
      case 'cancel':
        return { reason: String(req.body.reason || '').trim() };
      case 'confirm':
        return { hours };
      default:
        return {};
    }
  })();

  try {
    if (!['accept', 'decline', 'start', 'complete', 'confirm', 'cancel'].includes(action)) {
      return redirectTo(res, `/exchanges/${id}?status=exchange-action-failed`);
    }

    await performExchangeAction(req.token, id, action, actionPayload);
    return redirectTo(res, `/exchanges/${id}?status=exchange-updated`);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ApiOfflineError) {
      if (handleApiError(error, req, res, { redirectOn401: '/login' })) return undefined;
      return redirectTo(res, `/exchanges/${id}?status=exchange-action-failed`);
    }
    throw error;
  }
}));

router.post('/:id/rate', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const rating = parseInt(req.body.rating, 10);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return redirectTo(res, `/exchanges/${id}?status=rating-invalid#rating`);
  }

  try {
    await rateExchange(req.token, id, {
      rating,
      comment: String(req.body.comment || '').trim()
    });
    return redirectTo(res, `/exchanges/${id}?status=rating-submitted`);
  } catch (error) {
    if (error instanceof ApiError || error instanceof ApiOfflineError) {
      if (handleApiError(error, req, res, { redirectOn401: '/login' })) return undefined;
      return redirectTo(res, `/exchanges/${id}?status=rating-failed#rating`);
    }
    throw error;
  }
}));

module.exports = router;
