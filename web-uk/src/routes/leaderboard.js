// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callGamificationApi, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const LEADERBOARD_TYPES = [
  'credits_earned',
  'credits_spent',
  'vol_hours',
  'badges',
  'xp',
  'connections',
  'reviews',
  'posts',
  'streak'
];

const LEADERBOARD_PERIODS = ['all_time', 'month', 'week'];

const COMPETITIVE_TYPES = ['xp', 'volunteer_hours', 'credits_earned', 'nexus_score'];

const COMPETITIVE_PERIODS = ['all', 'season', 'month', 'week'];

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function urlFor(res, pathname) {
  return typeof res.locals?.urlFor === 'function' ? res.locals.urlFor(pathname) : pathname;
}

function redirectTo(res, pathname) {
  return res.redirect(urlFor(res, pathname));
}

function objectFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function payloadFrom(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result || {};
}

function metaFrom(result) {
  return objectFrom(result && result.meta);
}

function intFrom(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numberFrom(value) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function boolFrom(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  return false;
}

function textFrom(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function formatInteger(value) {
  return intFrom(value).toLocaleString(getRequestIntlLocale());
}

function formatDecimal(value) {
  return numberFrom(value).toLocaleString(getRequestIntlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatDateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London'
  }).format(date);
}

function formatScore(value, type) {
  if (type === 'volunteer_hours') {
    return formatDecimal(value);
  }
  return formatInteger(Math.round(numberFrom(value)));
}

function selectedOption(options, requested, fallback) {
  return options.includes(requested) ? requested : fallback;
}

function boundedLimit(value) {
  const pageSize = 20;
  const maxLimit = 200;
  const requested = intFrom(value);
  const minimum = requested < pageSize ? pageSize : requested;
  return Math.min(maxLimit, Math.ceil(minimum / pageSize) * pageSize);
}

function normalizeRows(result, t) {
  const payload = payloadFrom(result);
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => {
    const object = objectFrom(row);
    const user = objectFrom(object.user);
    const userId = intFrom(user.id ?? object.user_id);
    const scoreDisplay = textFrom(object.score_display ?? object.formatted_score);

    return {
      rank: intFrom(object.rank ?? object.position),
      userId,
      name: textFrom(user.name ?? object.name ?? `${textFrom(object.first_name)} ${textFrom(object.last_name)}`.trim())
        || t('govuk_alpha_gamification.common.unknown_member'),
      href: userId > 0 ? `/members/${userId}` : '',
      isCurrentUser: boolFrom(object.is_current_user),
      scoreLabel: scoreDisplay || formatInteger(object.score)
    };
  }).filter((row) => row.rank > 0);
}

function normalizeImpact(result) {
  const impact = objectFrom(payloadFrom(result));
  return {
    hasValues: Object.keys(impact).length > 0,
    totalMembers: formatInteger(impact.total_members),
    totalExchanges: formatInteger(impact.total_exchanges),
    totalVolunteerHours: formatDecimal(impact.total_volunteer_hours),
    totalListings: formatInteger(impact.total_listings),
    totalConnections: formatInteger(impact.total_connections),
    totalBadgesAwarded: formatInteger(impact.total_badges_awarded)
  };
}

function countLabel(count, tc) {
  return tc('govuk_alpha_gamification.competitive.showing_count', count, { count: formatInteger(count) });
}

function daysRemainingLabel(count, tc, key) {
  return tc(key, count, { count: formatInteger(count) });
}

function participantsLabel(count, tc, key) {
  return tc(key, count, { count: formatInteger(count) });
}

function dateRangeLabel(startDate, endDate, t) {
  const start = formatDateLabel(startDate);
  const end = formatDateLabel(endDate);
  return start && end ? t('govuk_alpha_gamification.seasons.date_range', { start, end }) : '';
}

function rewardValueLabel(value) {
  if (Array.isArray(value)) {
    return value.map(rewardValueLabel).filter(Boolean).join(', ');
  }

  if (value && typeof value === 'object') {
    return Object.values(value).map(rewardValueLabel).filter(Boolean).join(', ');
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

function normalizeCompetitiveRows(result, type, t) {
  const payload = payloadFrom(result);
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => {
    const object = objectFrom(row);
    const user = objectFrom(object.user);
    const userId = intFrom(user.id ?? object.user_id);
    const scoreDisplay = textFrom(object.score_display ?? object.formatted_score);

    return {
      rank: intFrom(object.rank ?? object.position),
      userId,
      name: textFrom(user.name ?? object.name ?? `${textFrom(object.first_name)} ${textFrom(object.last_name)}`.trim())
        || t('govuk_alpha_gamification.common.unknown_member'),
      href: userId > 0 ? `/members/${userId}` : '',
      isCurrentUser: boolFrom(object.is_current_user),
      scoreLabel: scoreDisplay || formatScore(object.score, type)
    };
  }).filter((row) => row.rank > 0);
}

function normalizeCompetitiveSeason(result, tc) {
  const payload = objectFrom(payloadFrom(result));
  const season = objectFrom(payload.season);
  const userData = objectFrom(payload.user_data);
  const daysRemaining = intFrom(payload.days_remaining);
  const participants = intFrom(payload.total_participants);
  const seasonName = textFrom(season.name);

  return {
    hasSeason: Object.keys(season).length > 0,
    seasonName,
    daysRemainingLabel: daysRemainingLabel(daysRemaining, tc, 'govuk_alpha_gamification.competitive.season_days_remaining'),
    participantsLabel: participantsLabel(participants, tc, 'govuk_alpha_gamification.competitive.season_participants'),
    xpLabel: formatInteger(userData.xp_earned),
    hasUserData: Object.keys(userData).length > 0
  };
}

function normalizeSeasonTopMembers(rows, t) {
  return (Array.isArray(rows) ? rows : []).map((row, index) => {
    const object = objectFrom(row);
    const fullName = `${textFrom(object.first_name)} ${textFrom(object.last_name)}`.trim();
    const name = fullName || textFrom(object.name) || t('govuk_alpha_gamification.common.unknown_member');

    return {
      rank: index + 1,
      name,
      xpLabel: formatInteger(object.season_xp ?? object.xp_earned ?? object.xp)
    };
  }).filter((member) => member.name);
}

function normalizeSeasonRewards(rewards, t) {
  if (!rewards || typeof rewards !== 'object') {
    return [];
  }

  return Object.entries(rewards).map(([rank, reward]) => ({
    rank,
    rankLabel: t('govuk_alpha_gamification.seasons.reward_row', { rank: Number.isFinite(Number(rank)) ? intFrom(rank) : rank }),
    rewardLabel: rewardValueLabel(reward)
  })).filter((reward) => reward.rewardLabel);
}

function normalizeCurrentSeason(result, t, tc) {
  const payload = objectFrom(payloadFrom(result));
  const season = objectFrom(payload.season);
  const userData = objectFrom(payload.user_data);
  const daysRemaining = intFrom(payload.days_remaining);
  const participants = intFrom(payload.total_participants);
  const dateRange = dateRangeLabel(season.start_date, season.end_date, t);

  return {
    hasCurrent: Object.keys(season).length > 0,
    name: textFrom(season.name, t('govuk_alpha_gamification.seasons.current_heading')),
    dateRange,
    daysRemainingLabel: daysRemainingLabel(daysRemaining, tc, 'govuk_alpha_gamification.seasons.days_remaining'),
    participantsLabel: participantsLabel(participants, tc, 'govuk_alpha_gamification.seasons.participants'),
    endingSoon: boolFrom(payload.is_ending_soon),
    hasUserData: Object.keys(userData).length > 0,
    userRank: intFrom(userData.rank),
    hasUserRank: Object.prototype.hasOwnProperty.call(userData, 'rank') && userData.rank !== null,
    userXpLabel: formatInteger(userData.xp_earned),
    rewards: normalizeSeasonRewards(payload.rewards, t),
    topMembers: normalizeSeasonTopMembers(payload.leaderboard, t)
  };
}

function normalizeAllSeasons(result, t) {
  const payload = payloadFrom(result);
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => {
    const object = objectFrom(row);
    return {
      name: textFrom(object.name, t('govuk_alpha_gamification.seasons.season_name_column')),
      dateRange: dateRangeLabel(object.start_date, object.end_date, t)
    };
  }).filter((season) => season.name);
}

function humanizeSummaryKey(key) {
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function isJourneyScalar(value) {
  return ['string', 'number', 'boolean'].includes(typeof value);
}

function formatJourneyScalar(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString(getRequestIntlLocale(), {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
      maximumFractionDigits: 1
    });
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) {
        return numeric.toLocaleString(getRequestIntlLocale(), {
          minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
          maximumFractionDigits: 1
        });
      }
    }
    return trimmed;
  }

  return String(value);
}

function labelFromJourneyItem(item) {
  if (typeof item === 'string') {
    return item.trim();
  }

  const object = objectFrom(item);
  return textFrom(object.label ?? object.title ?? object.name ?? object.description ?? object.badge_key);
}

function normalizeJourney(result) {
  const payload = objectFrom(payloadFrom(result));
  const summary = objectFrom(payload.summary);
  const milestones = Array.isArray(payload.milestones) ? payload.milestones : [];
  const monthly = Array.isArray(payload.monthly_activity) ? payload.monthly_activity : [];
  const badges = Array.isArray(payload.badge_progression) ? payload.badge_progression : [];

  const summaryRows = Object.entries(summary).map(([key, value]) => {
    if (!isJourneyScalar(value)) return null;
    return {
      key: humanizeSummaryKey(key),
      value: formatJourneyScalar(value)
    };
  }).filter(Boolean);

  const milestoneRows = milestones.map(labelFromJourneyItem).filter(Boolean);
  const activityRows = monthly.map((row) => {
    const object = objectFrom(row);
    return {
      month: textFrom(object.month ?? object.label ?? object.year_month),
      countLabel: formatInteger(object.activity_count ?? object.count ?? object.activities)
    };
  }).filter((row) => row.month);
  const badgeRows = badges.map(labelFromJourneyItem).filter(Boolean);

  return {
    isEmpty: summaryRows.length === 0 && milestoneRows.length === 0 && activityRows.length === 0 && badgeRows.length === 0,
    summaryRows,
    milestoneRows,
    activityRows,
    badgeRows
  };
}

function normalizeSpotlightMembers(result, t) {
  const payload = payloadFrom(result);
  const rows = Array.isArray(payload) ? payload : [];

  return rows.map((row) => {
    const object = objectFrom(row);
    const id = intFrom(object.id);
    const fullName = `${textFrom(object.first_name)} ${textFrom(object.last_name)}`.trim();

    return {
      id,
      name: fullName || textFrom(object.name) || t('govuk_alpha_gamification.common.unknown_member'),
      bio: textFrom(object.bio),
      levelLabel: t('govuk_alpha_gamification.spotlight.level', { level: Math.max(1, intFrom(object.level) || 1) }),
      xpLabel: t('govuk_alpha_gamification.spotlight.xp', { xp: formatInteger(object.xp) }),
      memberSince: textFrom(object.member_since),
      recentActivity: textFrom(object.recent_activity),
      href: id > 0 ? `/members/${id}` : ''
    };
  }).filter((member) => member.name);
}

function redirectAuthIfNeeded(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

router.get('/competitive', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const selectedType = selectedOption(COMPETITIVE_TYPES, textFrom(req.query.type), 'xp');
  const selectedPeriod = selectedOption(COMPETITIVE_PERIODS, textFrom(req.query.period), 'all');
  const limit = boundedLimit(req.query.limit);

  let leaderboardPayload;
  let seasonPayload;
  try {
    [leaderboardPayload, seasonPayload] = await Promise.all([
      callGamificationApi(token, 'GET', `/leaderboard?type=${encodeURIComponent(selectedType)}&period=${encodeURIComponent(selectedPeriod)}&limit=${limit}`),
      callGamificationApi(token, 'GET', '/seasons/current')
    ]);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    leaderboardPayload = { data: [], meta: { has_more: false, your_position: null } };
    seasonPayload = { data: { season: null } };
  }

  const meta = metaFrom(leaderboardPayload);
  const rows = normalizeCompetitiveRows(leaderboardPayload, selectedType, res.locals.t);

  return res.render('leaderboard/competitive', {
    title: res.locals.t('govuk_alpha_gamification.competitive.title'),
    activeNav: 'leaderboard',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    competitive: {
      rows,
      type: selectedType,
      period: selectedPeriod,
      types: COMPETITIVE_TYPES.map((value) => ({ value, label: res.locals.t(`govuk_alpha_gamification.competitive.metrics.${value}`) })),
      periods: COMPETITIVE_PERIODS.map((value) => ({ value, label: res.locals.t(`govuk_alpha_gamification.competitive.periods.${value}`) })),
      season: normalizeCompetitiveSeason(seasonPayload, res.locals.tc),
      yourRank: intFrom(meta.your_position),
      hasYourRank: intFrom(meta.your_position) > 0,
      hasMore: boolFrom(meta.has_more),
      nextLimit: Math.min(200, limit + 20),
      countLabel: countLabel(rows.length, res.locals.tc)
    }
  });
}));

router.get('/journey', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let journeyPayload;
  try {
    journeyPayload = await callGamificationApi(token, 'GET', '/personal-journey');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    journeyPayload = { data: {} };
  }

  return res.render('leaderboard/journey', {
    title: res.locals.t('govuk_alpha_gamification.journey.title'),
    activeNav: 'leaderboard',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    journey: normalizeJourney(journeyPayload)
  });
}));

router.get('/spotlight', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let spotlightPayload;
  try {
    spotlightPayload = await callGamificationApi(token, 'GET', '/member-spotlight?limit=3');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    spotlightPayload = { data: [] };
  }

  return res.render('leaderboard/spotlight', {
    title: res.locals.t('govuk_alpha_gamification.spotlight.title'),
    activeNav: 'leaderboard',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    spotlightMembers: normalizeSpotlightMembers(spotlightPayload, res.locals.t)
  });
}));

router.get('/seasons', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let currentPayload;
  let seasonsPayload;
  try {
    [currentPayload, seasonsPayload] = await Promise.all([
      callGamificationApi(token, 'GET', '/seasons/current'),
      callGamificationApi(token, 'GET', '/seasons')
    ]);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    currentPayload = { data: { season: null } };
    seasonsPayload = { data: [] };
  }

  return res.render('leaderboard/seasons', {
    title: res.locals.t('govuk_alpha_gamification.seasons.title'),
    activeNav: 'leaderboard',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    seasons: {
      current: normalizeCurrentSeason(currentPayload, res.locals.t, res.locals.tc),
      history: normalizeAllSeasons(seasonsPayload, res.locals.t)
    }
  });
}));

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const selectedType = selectedOption(LEADERBOARD_TYPES, textFrom(req.query.type), 'credits_earned');
  const selectedPeriod = selectedOption(LEADERBOARD_PERIODS, textFrom(req.query.period), 'all_time');

  let leaderboardPayload;
  let impactPayload;
  try {
    [leaderboardPayload, impactPayload] = await Promise.all([
      callGamificationApi(token, 'GET', `/leaderboard?type=${encodeURIComponent(selectedType)}&period=${encodeURIComponent(selectedPeriod)}&limit=20`),
      callGamificationApi(token, 'GET', '/community-dashboard')
    ]);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    leaderboardPayload = { data: [] };
    impactPayload = { data: {} };
  }

  return res.render('leaderboard/index', {
    title: res.locals.t('leaderboard.title'),
    activeNav: 'leaderboard',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    leaderboard: {
      rows: normalizeRows(leaderboardPayload, res.locals.t),
      type: selectedType,
      period: selectedPeriod,
      types: LEADERBOARD_TYPES.map((value) => ({ value, label: res.locals.t(`leaderboard.metrics.${value}`) })),
      periods: LEADERBOARD_PERIODS.map((value) => ({ value, label: res.locals.t(`leaderboard.periods.${value}`) })),
      impact: normalizeImpact(impactPayload)
    }
  });
}));

module.exports = router;
