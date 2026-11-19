// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { callMatchesApi, dismissMatch, toggleBookmark, joinGroup, ApiError } = require('../lib/api');
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

// When an event match starts, in the reader's language. Laravel stores and sends
// event times in UTC and names the event's own time zone, so the date and time
// shown are the ones the organiser meant, never the server's local reading.
function eventDateLabel(value, formatDate, timezone, allDay) {
  const text = trimmed(value);
  if (!text || typeof formatDate !== 'function') return '';

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  let instant = text;
  if (dateOnly) {
    instant = `${text}T00:00:00Z`;
  } else if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    // No zone on it: it is UTC.
    instant = `${text.replace(' ', 'T')}Z`;
  }
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return '';

  const day = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  const options = allDay || dateOnly ? day : { ...day, hour: 'numeric', minute: '2-digit' };
  const zone = dateOnly ? 'UTC' : (trimmed(timezone) || 'UTC');
  try {
    return formatDate(date, { ...options, timeZone: zone });
  } catch {
    // An unknown zone name: fall back to UTC rather than show nothing.
    return formatDate(date, { ...options, timeZone: 'UTC' });
  }
}

/**
 * The line under a match's title. Only a LISTING match has a member behind it;
 * a group, a volunteering opportunity and an event do not, so each says what is
 * useful for its own kind instead of "by Unknown member".
 */
function metaPartsFor(module, match, userName, category, context) {
  const { t, tc, board, formatDate } = context;
  const parts = [];

  if (module === 'listing') {
    parts.push(t(board ? 'govuk_alpha_connections.matches.by_label' : 'matches.by_label', { name: userName }));
    if (category) parts.push(category);
  } else if (module === 'group') {
    const memberCount = Number(match.member_count ?? match.memberCount);
    if (Number.isInteger(memberCount) && memberCount > 0 && typeof tc === 'function') {
      parts.push(tc('groups.members_count', memberCount, { count: memberCount }));
    }
  } else if (module === 'volunteering') {
    const organisation = trimmed(match.organization_name || match.organizationName);
    if (organisation) parts.push(organisation);
    const place = trimmed(match.location);
    if (place) parts.push(place);
  } else if (module === 'event') {
    const when = eventDateLabel(match.event_date || match.eventDate, formatDate, match.timezone, match.all_day === true);
    if (when) parts.push(when);
    const place = trimmed(match.location);
    if (place) parts.push(place);
  }

  return parts;
}

function normalizeMatch(match = {}, context = {}) {
  const { t, board = false, formatRelativeTime = () => '' } = context;
  const module = moduleKey(match.module || match.source_type || match.sourceType);
  const listingId = Number(match.listing_id || match.listingId || (module === 'listing' ? match.id : 0)) || 0;
  const groupId = Number(match.group_id || match.groupId || (module === 'group' ? match.id : 0)) || 0;
  const eventId = Number(match.event_id || match.eventId || (module === 'event' ? match.id : 0)) || 0;
  const opportunityId = Number(match.opportunity_id || match.opportunityId || 0) || 0;
  const organizationId = Number(match.organization_id || match.organizationId || 0) || 0;
  const pct = percentFrom(match.pct ?? match.match_score ?? match.matchScore ?? match.score);

  // A volunteering match is an OPPORTUNITY (Laravel CrossModuleMatchingService), so
  // it links to the opportunity page. The organisation page is only the fallback
  // for an answer that names no opportunity.
  const href = module === 'listing' && listingId
    ? `/listings/${listingId}`
    : module === 'group' && groupId
      ? `/groups/${groupId}`
      : module === 'event' && eventId
        ? `/events/${eventId}`
        : module === 'volunteering' && opportunityId
          ? `/volunteering/opportunities/${opportunityId}`
          : module === 'volunteering' && organizationId
            ? `/organisations/${organizationId}`
            : '';

  const entityId = { listing: listingId, group: groupId, event: eventId, volunteering: opportunityId }[module] || 0;
  const category = trimmed(match.category_name || match.categoryName || match.category);
  const userName = trimmed(
    match.user_name || match.userName || match.name,
    t(board ? 'govuk_alpha_connections.common.unknown_member' : 'members.unknown_member')
  );
  const matchedWhen = board ? formatRelativeTime(match.created_at || match.createdAt || '') : '';
  const metaParts = metaPartsFor(module, match, userName, category, context);
  if (matchedWhen) metaParts.push(t('govuk_alpha_connections.matches.matched_when', { when: matchedWhen }));

  return {
    id: match.id || listingId || groupId || eventId || opportunityId || organizationId,
    module,
    moduleLabel: t(board
      ? `govuk_alpha_connections.matches.module_${module}`
      : `polish_listings.matches_module_${module}`),
    listingId,
    groupId,
    eventId,
    opportunityId,
    organizationId,
    entityId,
    // Lets a notification link (`?highlight=listing-7`) point at one card.
    anchorId: entityId ? `match-${module}-${entityId}` : '',
    highlighted: false,
    href,
    title: trimmed(match.title, t(board ? 'govuk_alpha_connections.matches.view_match' : 'matches.view_listing')),
    description: board ? truncated(match.description, 160) : '',
    type: match.type === 'request' ? 'request' : 'offer',
    typeLabel: t(board
      ? `govuk_alpha_connections.matches.type_${match.type === 'request' ? 'request' : 'offer'}`
      : `matches.type_${match.type === 'request' ? 'request' : 'offer'}`),
    category,
    // CrossModuleMatchingService marks matches that go both ways.
    isMutual: match.is_mutual === true || match.isMutual === true,
    // A cold-start match is a suggestion made before there is enough to score
    // properly, so it is never presented as an "N% match".
    isSuggestion: trimmed(match.match_type || match.matchType) === 'cold_start',
    userName,
    metaLine: metaParts.join(' - '),
    pct,
    reasons: normalizeReasons(match.match_reasons || match.matchReasons || match.reasons),
    createdAt: match.created_at || match.createdAt || '',
    matchedWhen
  };
}

function statsFor(matches, formatNumber) {
  const total = matches.length;
  // Suggestions carry no meaningful score, so they stay out of the average.
  const scored = matches.filter((item) => !item.isSuggestion);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((sum, item) => sum + item.pct, 0) / scored.length)
    : 0;
  const sourceCounts = { listing: 0, group: 0, volunteering: 0, event: 0 };
  matches.forEach((match) => {
    if (Object.prototype.hasOwnProperty.call(sourceCounts, match.module)) {
      sourceCounts[match.module] += 1;
    }
  });

  // Intl's percent style owns the digits AND the sign placement — the template
  // previously appended a literal "%", which is wrong for Arabic and Japanese.
  const percent = typeof formatNumber === 'function'
    ? (value) => formatNumber(value / 100, { style: 'percent', maximumFractionDigits: 0 })
    : (value) => `${value}%`;

  return {
    total,
    avgScore,
    avgScoreLabel: percent(avgScore),
    hotMatches: scored.filter((item) => item.pct >= 80).length,
    sourceTypes: Object.values(sourceCounts).filter((count) => count > 0).length,
    sourceCounts
  };
}

// Match alerts are worked out from a member's top 50, so the list asks for 50:
// at 30, an alert for a match ranked 31st or lower opened this page without it.
const MATCHES_SHOWN = 50;

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
  // Save a listing match / join a group match from the card (React MatchCard).
  if (status === 'match-saved') return { type: 'success', text: t('feed_t1.status_save_added') };
  if (status === 'match-unsaved') return { type: 'success', text: t('feed_t1.status_save_removed') };
  if (status === 'match-save-failed') return { type: 'error', text: t('feed_t1.status_save_failed') };
  if (status === 'match-joined') return { type: 'success', text: t('groups.states.group-joined') };
  // A group that approves its members answers "pending": the member has asked, not joined.
  if (status === 'match-join-requested') return { type: 'success', text: t('groups.states.group-requested') };
  if (status === 'match-join-failed') return { type: 'error', text: t('groups.states.group-failed') };
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

/**
 * Why the page may have nothing to show, read from Laravel's `meta`:
 * the community has switched matching off, the member has paused it, the member
 * has no location, or the member has no offers or requests yet.
 */
function matchingState(meta = {}) {
  return {
    matchingDisabled: meta.disabled === true,
    matchingPaused: meta.paused === true,
    noCoordinates: meta.needs_location === true || meta.degraded_reason === 'no_coordinates',
    noActiveListings: meta.has_active_listings === false
  };
}

function normalizeContext(res, board = false) {
  return {
    t: res.locals.t,
    tc: res.locals.tc,
    board,
    formatDate: res.locals.formatLocaleDate,
    formatRelativeTime: board && typeof res.locals.formatLocaleRelativeTime === 'function'
      ? res.locals.formatLocaleRelativeTime
      : () => ''
  };
}

// Notification links name one match: `/matches?highlight=listing-7`.
function highlightFrom(query) {
  const found = String(query.highlight || '').trim().match(/^(listing|group|volunteering|event)-(\d{1,12})$/);
  return found ? { module: found[1], entityId: Number(found[2]) } : null;
}

/**
 * Puts the match a notification pointed at first and marks it, so it is the
 * first card read out and the page can link straight to it. Needs no script.
 */
function highlightFirst(matches, highlight) {
  if (!highlight) return { matches, highlighted: null };
  const index = matches.findIndex((match) => match.module === highlight.module && match.entityId === highlight.entityId);
  if (index < 0) return { matches, highlighted: null };

  const highlighted = { ...matches[index], highlighted: true };
  return {
    matches: [highlighted, ...matches.slice(0, index), ...matches.slice(index + 1)],
    highlighted
  };
}

// An id may appear once in a page: a repeated match keeps its card but loses the anchor.
function uniqueAnchors(matches) {
  const seen = new Set();
  return matches.map((match) => {
    if (!match.anchorId) return match;
    if (seen.has(match.anchorId)) return { ...match, anchorId: '' };
    seen.add(match.anchorId);
    return match;
  });
}

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const activeSource = sourceFromQuery(req.query);
  let matches = [];
  let matchMeta = {};
  let errorMessage = null;

  try {
    const payload = payloadFrom(await callMatchesApi(req.token, 'GET', `/all?${matchesApiQuery(MATCHES_SHOWN)}`));
    const context = normalizeContext(res);
    matches = visibleMatches(payload.matches.map((match) => normalizeMatch(match, context)), activeSource);
    matchMeta = payload.meta;
  } catch (error) {
    if (isAuthError(error)) throw error;
    errorMessage = res.locals.t('error_pages.503_body');
  }
  // React's "Mutual matches only" filter. Notification links ask for it as
  // `type=mutual`; the page's own filter link uses `mutual=1`.
  const mutualOnly = String(req.query.mutual || '') === '1' || String(req.query.type || '') === 'mutual';
  if (mutualOnly) matches = matches.filter((match) => match.isMutual);
  const highlight = highlightFirst(uniqueAnchors(matches), highlightFrom(req.query));
  matches = highlight.matches;
  const stats = statsFor(matches, res.locals.formatLocaleNumber);

  res.render('matches/index', {
    title: 'Your matches',
    titleKey: 'matches.title',
    activeSource,
    sourceLabels: sourceLabels(res.locals.t),
    matches,
    matchMeta,
    // React d2ba1b237: the community's safeguarding setup is unfinished, so
    // matches involving protected members are hidden. Explain it; never a CTA.
    safeguardingDegraded: matchMeta.degraded_reason === 'safeguarding_policy_unavailable',
    // Why there may be nothing to show (React MatchesPage empty variants).
    ...matchingState(matchMeta),
    mutualOnly,
    highlightedMatch: highlight.highlighted,
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
    const context = normalizeContext(res, true);
    matches = payload.matches.map((match) => normalizeMatch(match, context));
    matchMeta = payload.meta;
  } catch (error) {
    if (isAuthError(error)) throw error;
    errorMessage = res.locals.t('error_pages.503_body');
  }
  const stats = statsFor(matches, res.locals.formatLocaleNumber);
  const filteredMatches = visibleMatches(matches, activeSource);

  res.render('matches/board', {
    title: 'Your matches',
    titleKey: 'govuk_alpha_connections.matches.title',
    activeSource,
    sourceLabels: sourceLabels(res.locals.t, true),
    matches: filteredMatches,
    matchMeta,
    // React d2ba1b237: the community's safeguarding setup is unfinished, so
    // matches involving protected members are hidden. Explain it; never a CTA.
    safeguardingDegraded: matchMeta.degraded_reason === 'safeguarding_policy_unavailable',
    // The same reasons the list view gives for having nothing to show.
    ...matchingState(matchMeta),
    errorMessage,
    stats,
    statusMessage: statusMessage(req.query.status, res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: '/login?status=auth-required' }));

// Save a listing match (a toggle on the bookmarks store, as React's MatchCard).
router.post('/listing/:listingId(\\d+)/save', requireAuth, asyncRoute(async (req, res) => {
  let status = 'match-saved';
  try {
    const result = await toggleBookmark(req.token, 'listing', Number(req.params.listingId));
    const data = result && typeof result === 'object' && result.data && typeof result.data === 'object' ? result.data : {};
    status = data.bookmarked === false ? 'match-unsaved' : 'match-saved';
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-save-failed';
  }
  return redirectToMatches(res, status);
}));

// Join a group match straight from the card (React MatchCard: POST /v2/groups/{id}/join).
router.post('/group/:groupId(\\d+)/join', requireAuth, asyncRoute(async (req, res) => {
  let status = 'match-joined';
  try {
    // 🔴 A group that approves its members answers {"status":"pending","action":"requested"}.
    // That is a request, not a membership, so the page must not say "joined".
    const joined = dataFrom(await joinGroup(req.token, Number(req.params.groupId))) || {};
    const membershipState = trimmed(joined.status || joined.membership?.status || joined.membership?.state);
    if (membershipState === 'pending' || trimmed(joined.action) === 'requested') status = 'match-join-requested';
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-join-failed';
  }
  return redirectToMatches(res, status);
}));

function redirectToMatches(res, status) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(`/matches?status=${encodeURIComponent(status)}`));
}

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

// React MatchCard also hides GROUP matches: POST /v2/matches/group/{id}/dismiss.
async function dismissGroupMatch(token, groupId, reason) {
  return callMatchesApi(token, 'POST', `/group/${encodeURIComponent(groupId)}/dismiss`, { reason });
}

router.post('/group/:groupId(\\d+)/dismiss', requireAuth, asyncRoute(async (req, res) => {
  let status = 'match-dismissed';
  try {
    await dismissGroupMatch(req.token, Number(req.params.groupId), reasonFrom(req.body));
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-dismiss-failed';
  }
  return redirectTo(res, `/matches?status=${status}`);
}, { redirectOn401: '/login?status=auth-required' }));

router.post('/board/group/:groupId(\\d+)/dismiss', requireAuth, asyncRoute(async (req, res) => {
  let status = 'match-dismissed';
  try {
    await dismissGroupMatch(req.token, Number(req.params.groupId), reasonFrom(req.body));
  } catch (error) {
    if (isAuthError(error)) throw error;
    status = 'match-dismiss-failed';
  }
  return redirectTo(res, `/matches/board?source=${sourceFrom(req.body)}&status=${status}#matches-top`);
}, { redirectOn401: '/login?status=auth-required' }));

module.exports = router;
