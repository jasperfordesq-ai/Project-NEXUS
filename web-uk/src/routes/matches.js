// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { callMatchesApi, dismissMatch, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();
const MATCH_REASONS = new Set(['not_relevant', 'too_far', 'already_done', 'not_my_skills', 'not_interested', 'other']);
const BOARD_SOURCES = new Set(['all', 'listing', 'group', 'volunteering', 'event']);

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function reasonFrom(body) {
  const reason = String(body.reason || '').trim();
  return MATCH_REASONS.has(reason) ? reason : 'not_relevant';
}

function sourceFrom(body) {
  const source = String(body.source || '').trim();
  return BOARD_SOURCES.has(source) ? source : 'all';
}

function sourceFromQuery(query) {
  const source = String(query.source || '').trim();
  return BOARD_SOURCES.has(source) ? source : 'all';
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function dataFrom(result) {
  return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

function payloadFrom(result) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.matches)) {
    throw new ApiError('Laravel did not return the matches response envelope', 502, result);
  }

  return {
    matches: data.matches,
    meta: data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta) ? data.meta : {}
  };
}

function percentFrom(value) {
  const score = Number(value || 0);
  if (!Number.isFinite(score) || score <= 0) return 0;
  return score > 1 ? Math.min(100, Math.round(score)) : Math.round(score * 100);
}

function moduleKey(value) {
  const module = String(value || 'listing').trim();
  if (module === 'listings') return 'listing';
  if (module === 'groups') return 'group';
  if (module === 'events') return 'event';
  return BOARD_SOURCES.has(module) && module !== 'all' ? module : 'listing';
}

function trimmed(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function truncated(value, limit) {
  const text = trimmed(value);
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3))}...` : text;
}

function normalizeReasons(value) {
  return Array.isArray(value)
    ? value.map((reason) => trimmed(reason)).filter(Boolean)
    : [];
}

function normalizeMatch(match = {}, t, board = false, formatRelativeTime = () => '') {
  const module = moduleKey(match.module || match.source_type || match.sourceType);
  const listingId = Number(match.listing_id || match.listingId || (module === 'listing' ? match.id : 0)) || 0;
  const groupId = Number(match.group_id || match.groupId || (module === 'group' ? match.id : 0)) || 0;
  const eventId = Number(match.event_id || match.eventId || (module === 'event' ? match.id : 0)) || 0;
  const organizationId = Number(match.organization_id || match.organizationId || 0) || 0;
  const pct = percentFrom(match.pct ?? match.match_score ?? match.matchScore ?? match.score);

  const href = module === 'listing' && listingId
    ? `/listings/${listingId}`
    : module === 'group' && groupId
      ? `/groups/${groupId}`
      : module === 'event' && eventId
        ? `/events/${eventId}`
        : module === 'volunteering' && organizationId
          ? `/organisations/${organizationId}`
          : '';

  return {
    id: match.id || listingId || groupId || eventId || organizationId,
    module,
    moduleLabel: t(board
      ? `govuk_alpha_connections.matches.module_${module}`
      : `polish_listings.matches_module_${module}`),
    listingId,
    groupId,
    eventId,
    organizationId,
    href,
    title: trimmed(match.title, t(board ? 'govuk_alpha_connections.matches.view_match' : 'matches.view_listing')),
    description: board ? truncated(match.description, 160) : '',
    type: match.type === 'request' ? 'request' : 'offer',
    typeLabel: t(board
      ? `govuk_alpha_connections.matches.type_${match.type === 'request' ? 'request' : 'offer'}`
      : `matches.type_${match.type === 'request' ? 'request' : 'offer'}`),
    category: trimmed(match.category_name || match.categoryName || match.category),
    userName: trimmed(
      match.user_name || match.userName || match.name,
      t(board ? 'govuk_alpha_connections.common.unknown_member' : 'members.unknown_member')
    ),
    pct,
    reasons: normalizeReasons(match.match_reasons || match.matchReasons || match.reasons),
    createdAt: match.created_at || match.createdAt || '',
    matchedWhen: board ? formatRelativeTime(match.created_at || match.createdAt || '') : ''
  };
}

function statsFor(matches) {
  const total = matches.length;
  const avgScore = total > 0
    ? Math.round(matches.reduce((sum, item) => sum + item.pct, 0) / total)
    : 0;
  const sourceCounts = { listing: 0, group: 0, volunteering: 0, event: 0 };
  matches.forEach((match) => {
    if (Object.prototype.hasOwnProperty.call(sourceCounts, match.module)) {
      sourceCounts[match.module] += 1;
    }
  });

  return {
    total,
    avgScore,
    hotMatches: matches.filter((item) => item.pct >= 80).length,
    sourceTypes: Object.values(sourceCounts).filter((count) => count > 0).length,
    sourceCounts
  };
}

function matchesApiQuery(limit) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return params.toString();
}

function visibleMatches(matches, source) {
  return source === 'all' ? matches : matches.filter((match) => match.module === source);
}

function statusMessage(status, t) {
  if (status === 'match-dismissed') {
    return { type: 'success', text: t('govuk_alpha_connections.matches_states.dismissed') };
  }
  if (status === 'match-dismiss-failed') {
    return { type: 'error', text: t('govuk_alpha_connections.matches_states.dismiss_failed') };
  }
  return null;
}

function sourceLabels(t, board = false) {
  const prefix = board ? 'govuk_alpha_connections.matches.source_' : 'polish_listings.matches_source_';
  return {
    all: t(`${prefix}all`),
    listing: t(`${prefix}listing`),
    group: t(`${prefix}group`),
    volunteering: t(`${prefix}volunteering`),
    event: t(`${prefix}event`)
  };
}

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const activeSource = sourceFromQuery(req.query);
  let matches = [];
  let matchMeta = {};
  let errorMessage = null;

  try {
    const payload = payloadFrom(await callMatchesApi(req.token, 'GET', `/all?${matchesApiQuery(30)}`));
    matches = visibleMatches(payload.matches.map((match) => normalizeMatch(match, res.locals.t)), activeSource);
    matchMeta = payload.meta;
  } catch (error) {
    if (isAuthError(error)) throw error;
    errorMessage = res.locals.t('error_pages.503_body');
  }
  const stats = statsFor(matches);

  res.render('matches/index', {
    title: 'Your matches',
    titleKey: 'matches.title',
    activeSource,
    sourceLabels: sourceLabels(res.locals.t),
    matches,
    matchMeta,
    errorMessage,
    stats,
    statusMessage: statusMessage(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: '/login?status=auth-required' }));

router.get('/board', requireAuth, asyncRoute(async (req, res) => {
  const activeSource = sourceFromQuery(req.query);
  let matches = [];
  let matchMeta = {};
  let errorMessage = null;

  try {
    const payload = payloadFrom(await callMatchesApi(req.token, 'GET', `/all?${matchesApiQuery(50)}`));
    matches = payload.matches.map((match) => normalizeMatch(match, res.locals.t, true, res.locals.formatLocaleRelativeTime));
    matchMeta = payload.meta;
  } catch (error) {
    if (isAuthError(error)) throw error;
    errorMessage = res.locals.t('error_pages.503_body');
  }
  const stats = statsFor(matches);
  const filteredMatches = visibleMatches(matches, activeSource);

  res.render('matches/board', {
    title: 'Your matches',
    titleKey: 'govuk_alpha_connections.matches.title',
    activeSource,
    sourceLabels: sourceLabels(res.locals.t, true),
    matches: filteredMatches,
    matchMeta,
    errorMessage,
    stats,
    statusMessage: statusMessage(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: '/login?status=auth-required' }));

router.post('/:id(\\d+)/dismiss', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  let status = 'match-dismissed';

  try {
    await dismissMatch(req.token, id, reasonFrom(req.body));
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-dismiss-failed';
  }

  return redirectTo(res, `/matches?status=${status}`);
}, { redirectOn401: '/login?status=auth-required' }));

router.post('/board/:listingId(\\d+)/dismiss', requireAuth, asyncRoute(async (req, res) => {
  const listingId = Number(req.params.listingId);
  let status = 'match-dismissed';

  try {
    await dismissMatch(req.token, listingId, reasonFrom(req.body));
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-dismiss-failed';
  }

  return redirectTo(res, `/matches/board?source=${sourceFrom(req.body)}&status=${status}#matches-top`);
}, { redirectOn401: '/login?status=auth-required' }));

module.exports = router;
