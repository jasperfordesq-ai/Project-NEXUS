// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { randomUUID } = require('node:crypto');
const {
  getUsers,
  getUser,
  getUserV2,
  getMemberVerificationBadges,
  getUserListings,
  getUserSkills,
  getUserAvailability,
  getUserActivityDashboard,
  getUserBlockStatus,
  getMembersV2,
  getMembersNearby,
  getMemberConnectionStatus,
  sendMemberConnectionRequest,
  acceptMemberConnection,
  declineMemberConnection,
  removeMemberConnection,
  blockMember,
  unblockMember,
  endorseMemberSkill,
  removeMemberEndorsement,
  transferWalletCredits,
  createReview,
  getGamificationProfileByUserId,
  getAllBadges,
  getUserReviews,
  getMemberEndorsements,
  ApiError
} = require('../lib/api');
const { requireAuth, withTokenRefresh } = require('../middleware/auth');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');
const { flagEnabled } = require('../lib/accessible-shell');

const router = express.Router();

const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';
const MEMBERS_PATH = '/members';
const BLOCKED_MEMBERS_PATH = '/profile/blocked?status=member-unblocked';
const MEMBER_CONNECTION_ACTIONS = new Set(['connect', 'accept', 'decline', 'cancel', 'remove']);
const MEMBER_ENDORSEMENT_ACTIONS = new Set(['endorse', 'remove']);
const MEMBER_DIRECTORY_SORTS = new Set(['name', 'joined', 'rating', 'hours_given']);

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function memberUrl(id, status) {
  return `${MEMBERS_PATH}/${id}?status=${encodeURIComponent(status)}`;
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function reviewsEnabledFor(req, res) {
  const tenant = req.accessibleRouting?.tenant || res.locals.tenant || {};
  return flagEnabled(tenant, 'reviews', 'features', true);
}

function profileStatusMessage(req) {
  const statuses = {
    'review-submitted': { type: 'success', key: 'polish_members.write_review_success' },
    'review-invalid': { type: 'error', key: 'reviews_page.submit_invalid' },
    'review-duplicate': { type: 'error', key: 'reviews_page.submit_duplicate' },
    'review-failed': { type: 'error', key: 'reviews_page.submit_failed' },
    'transfer-sent': { type: 'success', key: 'polish_members.send_credits_success' },
    'transfer-failed': { type: 'error', key: 'polish_members.send_credits_error_failed' },
    'transfer-self': { type: 'error', key: 'polish_members.send_credits_error_self' },
    'transfer-insufficient': { type: 'error', key: 'polish_members.send_credits_error_insufficient' },
    'connection-sent': { type: 'success', key: 'states.connection-sent' },
    'connection-accepted': { type: 'success', key: 'states.connection-accepted' },
    'connection-declined': { type: 'success', key: 'states.connection-declined' },
    'connection-cancelled': { type: 'success', key: 'states.connection-cancelled' },
    'connection-removed': { type: 'success', key: 'states.connection-removed' },
    'connection-failed': { type: 'error', key: 'states.connection-failed' },
    'endorsement-added': { type: 'success', key: 'states.endorsement-added' },
    'endorsement-removed': { type: 'success', key: 'states.endorsement-removed' },
    'endorsement-failed': { type: 'error', key: 'states.endorsement-failed' },
    'member-blocked': { type: 'success', key: 'profile.block.status_member_blocked' },
    'member-unblocked': { type: 'success', key: 'profile.block.status_member_unblocked' },
    'block-self': { type: 'error', key: 'profile.block.status_block_self' },
    'block-failed': { type: 'error', key: 'profile.block.status_block_failed' }
  };
  const status = statuses[String(req.query.status || '')];
  if (!status) return null;
  return {
    type: status.type,
    text: typeof req.t === 'function' ? req.t(status.key) : status.key
  };
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function isNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boundedInteger(value, fallback, min = 0, max = 1000) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function connectionIdFrom(current) {
  return positiveInteger(current.connection_id || current.connectionId || current.id);
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  return [];
}

function metaFrom(result) {
  return result && result.meta && typeof result.meta === 'object' ? result.meta : {};
}

function memberConnectionFrom(result) {
  const current = dataFrom(result);
  if (!current || typeof current !== 'object') return null;

  const state = String(current.status || 'none');
  const connectionId = connectionIdFrom(current);
  if (state === 'connected' || state === 'accepted') {
    return {
      id: connectionId,
      status: 'accepted',
      isRequester: false,
      is_requester: false
    };
  }
  if (state === 'pending_sent' || state === 'pending_received' || state === 'pending') {
    const isRequester = state === 'pending_sent';
    return {
      id: connectionId,
      status: 'pending',
      isRequester,
      is_requester: isRequester
    };
  }
  return null;
}

async function connectionMapForMembers(token, users) {
  let failed = false;
  const pairs = await Promise.all(users.map(async (user) => {
    const memberId = positiveInteger(user.id);
    if (memberId === null) return null;

    try {
      const connection = memberConnectionFrom(await getMemberConnectionStatus(token, memberId));
      return connection ? [memberId, connection] : null;
    } catch (error) {
      if (isAuthError(error)) throw error;
      failed = true;
      return null;
    }
  }));

  return {
    connectionMap: Object.fromEntries(pairs.filter(Boolean)),
    failed
  };
}

function gamificationFrom(result, user = {}) {
  const data = dataFrom(result);
  let profile = null;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    profile = Object.prototype.hasOwnProperty.call(data, 'profile') ? data.profile : data;
  } else if (result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'profile')) {
    profile = result.profile;
  }

  if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
    const hasProfileFields = Object.prototype.hasOwnProperty.call(profile, 'level')
      && Object.prototype.hasOwnProperty.call(profile, 'xp');
    if (hasProfileFields) return profile;
  }

  const hasUserGamification = ['level', 'xp'].some((key) => Object.prototype.hasOwnProperty.call(user, key));
  return hasUserGamification
    ? {
        level: user.level,
        xp: user.xp,
        badges_count: Array.isArray(user.badges) ? user.badges.length : 0
      }
    : null;
}

function gamificationBadgesFrom(result, user = {}) {
  const apiBadges = rowsFrom(result);
  const source = apiBadges.length > 0
    ? apiBadges
    : (Array.isArray(user.badges) ? user.badges : []);

  return source.map((badge) => ({
    key: String(badge.badge_key || badge.key || '').trim(),
    name: String(badge.name || '').trim(),
    description: String(badge.description || badge.msg || '').trim(),
    icon: String(badge.icon || '').trim(),
    earnedAt: badge.earned_at || badge.awarded_at || null
  })).filter((badge) => badge.key && badge.name).slice(0, 12);
}

function reviewSummaryFrom(result) {
  if (result && typeof result === 'object' && result.summary) return result.summary;
  const data = dataFrom(result);
  return data && typeof data === 'object' && !Array.isArray(data) ? (data.summary || null) : null;
}

function memberName(member, t = () => 'A community member') {
  const explicit = String(member.name || '').trim();
  if (explicit) return explicit;
  const first = String(member.first_name || member.firstName || '').trim();
  const last = String(member.last_name || member.lastName || '').trim();
  return `${first} ${last}`.trim() || t('members.unknown_member');
}

function connectionLabel(state, t) {
  const labels = {
    connected: t('members.connection_connected'),
    pending_sent: t('members.connection_request_sent'),
    pending_received: t('members.connection_request_received')
  };
  return labels[state] || '';
}

function connectionTagClass(state) {
  const classes = {
    connected: 'govuk-tag--blue',
    pending_sent: 'govuk-tag--yellow',
    pending_received: 'govuk-tag--purple'
  };
  return classes[state] || '';
}

function normalizeDiscoverMember(member, t) {
  const score = Number(member.community_rank_score);
  const rankPercent = Number.isFinite(score) ? Math.round(score * 100) : null;
  const level = boundedInteger(member.level, 0, 0, 1000);
  const rating = Number(member.rating);
  const given = boundedInteger(member.total_hours_given ?? member.hours_given, 0, 0, Number.MAX_SAFE_INTEGER);
  const received = boundedInteger(member.total_hours_received ?? member.hours_received, 0, 0, Number.MAX_SAFE_INTEGER);

  const name = memberName(member, t);
  return {
    id: positiveInteger(member.id) || 0,
    name,
    initial: name.slice(0, 1).toUpperCase() || 'M',
    avatar: String(member.avatar || member.avatar_url || member.avatarUrl || '').trim(),
    tagline: String(member.tagline || '').trim(),
    rankPercent,
    location: String(member.location || '').trim(),
    hoursGivenLabel: t('members.hours_given', { count: given }),
    hoursReceivedLabel: t('members.hours_received', { count: received }),
    ratingLabel: Number.isFinite(rating) && rating > 0 ? t('members.rating', { rating: rating.toFixed(1) }) : '',
    isVerified: !!(member.is_verified || member.identity_verified),
    level,
    levelLabel: level > 0 ? t('polish_members.member_level_label', { n: level }) : '',
    connectionLabel: connectionLabel(member.connection_state || member.connectionState, t),
    connectionTagClass: connectionTagClass(member.connection_state || member.connectionState)
  };
}

function numericCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeNearbyMember(member, t, formatNumber) {
  const normalized = normalizeDiscoverMember(member, t);
  const distance = Number(member.distance);
  return {
    ...normalized,
    distanceLabel: Number.isFinite(distance)
      ? t('govuk_alpha_members.nearby.distance', { distance: formatNumber(distance, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
      : ''
  };
}

function titleLabel(value) {
  const raw = String(value || '').replace(/_/g, ' ').trim();
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
}

function profileStatsFrom(user, activityResult, listings, reviewSummary, gamification, formatNumber) {
  const userStats = user && typeof user.stats === 'object' && user.stats !== null ? user.stats : {};
  const activity = dataFrom(activityResult) || {};
  const hours = activity.hours_summary && typeof activity.hours_summary === 'object'
    ? activity.hours_summary
    : {};
  const numberOr = (values, fallback = 0) => {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return fallback;
  };

  const hoursGiven = numberOr([user.total_hours_given, user.hours_given, userStats.total_hours_given, userStats.given_count, hours.hours_given]);
  const hoursReceived = numberOr([user.total_hours_received, user.hours_received, userStats.total_hours_received, userStats.received_count, hours.hours_received]);
  const listingsCount = numberOr([userStats.listings_count], listings.length);
  const rating = numberOr([user.rating, userStats.average_rating, reviewSummary?.average_rating], null);
  const level = numberOr([gamification?.level, user.level], 1);
  const xp = numberOr([gamification?.xp, gamification?.total_xp, gamification?.totalXp, user.xp], 0);
  return {
    hoursGivenLabel: formatNumber(hoursGiven, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    hoursReceivedLabel: formatNumber(hoursReceived, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    listingsCountLabel: formatNumber(listingsCount),
    ratingLabel: rating === null ? '' : formatNumber(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    levelLabel: formatNumber(level),
    xpLabel: formatNumber(xp)
  };
}

function profileAvailabilityFrom(result, t) {
  const data = dataFrom(result);
  const source = data && Array.isArray(data.weekly) ? data.weekly : (Array.isArray(data) ? data : []);
  const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  return source.map((slot) => {
    const day = boundedInteger(slot.day_of_week ?? slot.dayOfWeek, -1, -1, 6);
    const specificDate = dateLabel(slot.specific_date || slot.specificDate);
    const start = String(slot.start_time || slot.startTime || '').slice(0, 5);
    const end = String(slot.end_time || slot.endTime || '').slice(0, 5);
    return {
      label: specificDate || (day >= 0 ? t(`profile.days.${dayKeys[day]}`) : ''),
      time: start && end ? `${start} - ${end}` : '',
      note: String(slot.note || '').trim()
    };
  }).filter((slot) => slot.label || slot.time || slot.note).slice(0, 12);
}

function profileActivityFrom(result, t) {
  const data = dataFrom(result);
  const timeline = data && Array.isArray(data.timeline) ? data.timeline : [];
  const knownTypes = new Set(['post', 'comment', 'gave_hours', 'received_hours', 'connection', 'event_rsvp']);
  const classes = {
    post: 'govuk-tag--blue',
    comment: 'govuk-tag--blue',
    gave_hours: 'govuk-tag--green',
    received_hours: 'govuk-tag--turquoise',
    connection: 'govuk-tag--purple',
    event_rsvp: 'govuk-tag--yellow'
  };
  return timeline.map((item) => {
    const type = String(item.activity_type || item.activityType || 'post');
    return {
      type,
      label: knownTypes.has(type) ? t(`profile.activity_types.${type}`) : titleLabel(type),
      tagClass: classes[type] || 'govuk-tag--grey',
      description: String(item.description || '').trim().slice(0, 160),
      date: dateLabel(item.created_at || item.createdAt)
    };
  }).slice(0, 30);
}

function profileEndorsementsFrom(result, viewerId) {
  const data = dataFrom(result) || {};
  const rows = Array.isArray(data.endorsements) ? data.endorsements : [];
  const bySkill = {};
  rows.forEach((row) => {
    const skillName = String(row.skill_name || row.skillName || '').trim();
    if (!skillName) return;
    const viewerIds = String(row.endorsed_by_ids || row.endorsedByIds || '')
      .split(',')
      .map((value) => positiveInteger(value))
      .filter(Boolean);
    bySkill[skillName] = {
      count: boundedInteger(row.count, 0, 0, Number.MAX_SAFE_INTEGER),
      viewerEndorsed: viewerIds.includes(positiveInteger(viewerId))
    };
  });
  return bySkill;
}

function profileSkillsFrom(result, user) {
  const rows = rowsFrom(result);
  const source = rows.length > 0
    ? rows
    : (Array.isArray(user.skills) ? user.skills : []);
  return source.map((skill) => {
    if (typeof skill === 'string') {
      return { name: skill.trim(), isOffering: true, isRequesting: false };
    }
    return {
      name: String(skill.skill_name || skill.name || '').trim(),
      isOffering: !!(skill.is_offering ?? skill.isOffering),
      isRequesting: !!(skill.is_requesting ?? skill.isRequesting)
    };
  }).filter((skill) => skill.name).slice(0, 20);
}

function translatedOrFallback(t, key, fallback, replacements = {}) {
  const translated = t(key, replacements);
  return translated === key ? fallback : translated;
}

function normalizeInsightsProfile(profile, t, formatNumber) {
  const stats = profile && typeof profile.stats === 'object' && profile.stats !== null ? profile.stats : {};
  const nexusScore = profile && typeof profile.nexus_score === 'object' && profile.nexus_score !== null
    ? profile.nexus_score
    : null;
  const badges = Array.isArray(profile.badges)
    ? profile.badges
    : (Array.isArray(profile.showcased_badges) ? profile.showcased_badges : []);
  const score = Number(nexusScore?.total_score);
  const displayName = String(profile?.name || '').trim()
    || `${String(profile?.first_name || profile?.firstName || '').trim()} ${String(profile?.last_name || profile?.lastName || '').trim()}`.trim()
    || t('govuk_alpha_members.insights.unknown_member');

  return {
    displayName,
    nexusScore: nexusScore
      ? {
          scoreLabel: Number.isFinite(score)
            ? formatNumber(score, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
            : '',
          tierLabel: translatedOrFallback(
            t,
            `govuk_alpha_members.insights.tier_${String(nexusScore.tier || '').trim().toLowerCase().replaceAll(' ', '_')}`,
            titleLabel(nexusScore.tier)
          ),
          percentile: boundedInteger(nexusScore.percentile, 0, 0, 100)
        }
      : null,
    stats: {
      hoursGiven: formatNumber(Number(profile.total_hours_given ?? stats.total_hours_given) || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      hoursReceived: formatNumber(Number(profile.total_hours_received ?? stats.total_hours_received) || 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      listingsCount: formatNumber(Number(stats.listings_count) || 0, { maximumFractionDigits: 0 }),
      groupsCount: formatNumber(Number(profile.groups_count ?? stats.groups_count) || 0, { maximumFractionDigits: 0 }),
      eventsAttended: formatNumber(Number(profile.events_attended ?? stats.events_attended) || 0, { maximumFractionDigits: 0 }),
      connectionsCount: formatNumber(Number(stats.connections_count) || 0, { maximumFractionDigits: 0 }),
      reviewsCount: formatNumber(Number(stats.reviews_count) || 0, { maximumFractionDigits: 0 }),
      rating: profile.rating ?? stats.average_rating,
      ratingLabel: Number.isFinite(Number(profile.rating ?? stats.average_rating))
        ? formatNumber(profile.rating ?? stats.average_rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : '',
      level: formatNumber(Number(profile.level) || 1, { maximumFractionDigits: 0 }),
      xp: formatNumber(Number(profile.xp) || 0, { maximumFractionDigits: 0 })
    },
    badges: badges.slice(0, 12).map((badge) => ({
      name: String(badge.name || badge.badge_name || badge.badge_key || '').trim(),
      icon: String(badge.icon || '').trim()
    })).filter((badge) => badge.name)
  };
}

function normalizeVerificationBadges(result, t) {
  return rowsFrom(result).map((badge) => {
    const type = String(badge.badge_type || badge.type || '').trim();
    return {
      label: translatedOrFallback(
        t,
        `govuk_alpha_members.insights.verification_type_${type}`,
        String(badge.label || titleLabel(type) || t('members.verified')).trim()
      ),
      grantedLabel: dateLabel(badge.granted_at || badge.created_at || badge.verified_at)
    };
  }).filter((badge) => badge.label);
}

function redirectAuthIfNeeded(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
    return true;
  }
  return false;
}

function transferFailureStatus(error) {
  const message = error instanceof Error ? error.message : '';
  const code = error instanceof ApiError && error.data && typeof error.data === 'object'
    ? String(error.data.error || error.data.code || '')
    : '';

  if (code === 'INSUFFICIENT_FUNDS' || message.includes('Insufficient')) {
    return 'transfer-insufficient';
  }
  if (message.includes('yourself')) {
    return 'transfer-self';
  }
  return 'transfer-failed';
}

router.post('/:id(\\d+)/connection', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const action = String(req.body.action || '').trim();
  let status = 'connection-failed';

  if (MEMBER_CONNECTION_ACTIONS.has(action)) {
    try {
      const current = dataFrom(await getMemberConnectionStatus(token, id)) || {};
      const currentStatus = String(current.status || 'none');
      const connectionId = connectionIdFrom(current);

      if (action === 'connect' && currentStatus === 'none') {
        await sendMemberConnectionRequest(token, id);
        status = 'connection-sent';
      } else if (action === 'accept' && currentStatus === 'pending_received' && connectionId !== null) {
        await acceptMemberConnection(token, connectionId);
        status = 'connection-accepted';
      } else if (action === 'decline' && currentStatus === 'pending_received' && connectionId !== null) {
        await declineMemberConnection(token, connectionId);
        status = 'connection-declined';
      } else if (action === 'cancel' && currentStatus === 'pending_sent' && connectionId !== null) {
        await removeMemberConnection(token, connectionId);
        status = 'connection-cancelled';
      } else if (action === 'remove' && currentStatus === 'connected' && connectionId !== null) {
        await removeMemberConnection(token, connectionId);
        status = 'connection-removed';
      }
    } catch (error) {
      if (redirectAuthIfNeeded(error, res)) return undefined;
      if (isNotFound(error)) throw error;
      status = 'connection-failed';
    }
  }

  return redirectTo(res, memberUrl(id, status));
}));

router.post('/:id(\\d+)/endorse', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const skillName = String(req.body.skill_name || '').trim();
  const action = String(req.body.action || '').trim();
  let status = 'endorsement-failed';

  if (skillName !== '' && MEMBER_ENDORSEMENT_ACTIONS.has(action)) {
    try {
      if (action === 'endorse') {
        await endorseMemberSkill(token, id, { skill_name: skillName });
        status = 'endorsement-added';
      } else {
        await removeMemberEndorsement(token, id, skillName);
        status = 'endorsement-removed';
      }
    } catch (error) {
      if (redirectAuthIfNeeded(error, res)) return undefined;
      if (isNotFound(error)) throw error;
      status = 'endorsement-failed';
    }
  }

  return redirectTo(res, memberUrl(id, status));
}));

router.post('/:id(\\d+)/block', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  let status = 'member-blocked';
  try {
    await blockMember(token, id, String(req.body.reason || '').trim());
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    if (isNotFound(error)) throw error;
    status = error instanceof ApiError && error.status === 400 ? 'block-self' : 'block-failed';
  }

  return redirectTo(res, status === 'member-blocked'
    ? '/profile/blocked?status=member-blocked'
    : memberUrl(id, status));
}));

router.post('/:id(\\d+)/unblock', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  try {
    await unblockMember(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    if (isNotFound(error)) throw error;
  }

  if (String(req.body.from || '').trim() === 'list') {
    return redirectTo(res, BLOCKED_MEMBERS_PATH);
  }
  return redirectTo(res, memberUrl(id, 'member-unblocked'));
}));

router.post('/:id(\\d+)/review', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  if (!reviewsEnabledFor(req, res)) {
    return res.status(403).render('errors/403', {
      title: 'Forbidden',
      message: 'This feature is not enabled for this community.'
    });
  }

  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return redirectTo(res, memberUrl(id, 'review-invalid'));
  }

  let status = 'review-submitted';
  try {
    const member = dataFrom(await getUser(token, id));
    if (!member || typeof member !== 'object') {
      throw new ApiError('Member not found', 404);
    }
    await createReview(token, {
      receiver_id: id,
      rating,
      comment: String(req.body.comment || '').trim() || null
    });
  } catch (error) {
    if (isAuthError(error)) {
      handleApiError(error, req, res, { redirectOn401: LOGIN_AUTH_REQUIRED_PATH });
      return undefined;
    }
    if (isNotFound(error)) throw error;
    if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
      status = 'review-invalid';
    } else if (error instanceof ApiError && error.status === 409) {
      status = 'review-duplicate';
    } else {
      status = 'review-failed';
    }
  }

  return redirectTo(res, memberUrl(id, status));
}));

router.post('/:id(\\d+)/transfer', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const amount = Number(req.body.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return redirectTo(res, memberUrl(id, 'transfer-failed'));
  }

  let status = 'transfer-sent';
  try {
    await transferWalletCredits(token, {
      recipient: id,
      amount,
      description: String(req.body.note || '').trim().slice(0, 255),
      idempotency_key: String(req.body.idempotency_key || '').trim()
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    if (isNotFound(error)) throw error;
    status = transferFailureStatus(error);
  }

  return redirectTo(res, memberUrl(id, status));
}));

router.get('/discover', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const search = String(req.query.q || '').trim().slice(0, 100);
  const limit = boundedInteger(req.query.limit, 20, 1, 100);
  const offset = boundedInteger(req.query.offset, 0, 0, 100000);

  let members = [];
  let totalItems = 0;
  let hasMore = false;
  let errorMessage = null;

  try {
    const result = await getMembersV2(token, {
      q: search,
      sort: 'communityrank',
      limit,
      offset
    });
    const meta = metaFrom(result);
    members = rowsFrom(result).map((member) => normalizeDiscoverMember(member, res.locals.t)).filter((member) => member.id > 0);
    totalItems = boundedInteger(meta.total_items, members.length, 0, Number.MAX_SAFE_INTEGER);
    hasMore = !!meta.has_more;
  } catch {
    errorMessage = res.locals.t('govuk_alpha_members.discover.error_detail');
  }

  res.render('members/discover', {
    title: res.locals.t('govuk_alpha_members.discover.title'),
    activeNav: 'members',
    alphaActiveNav: 'members',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    members,
    search,
    totalItems,
    totalItemsLabel: res.locals.tc('members.result_count', totalItems, { count: totalItems }),
    hasMore,
    nextHref: hasMore ? `/members/discover${search ? `?q=${encodeURIComponent(search)}&` : '?'}offset=${offset + limit}` : '',
    errorMessage
  });
}));

router.get('/nearby', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const search = String(req.query.q || '').trim().slice(0, 100);
  const radius = boundedInteger(req.query.radius, 25, 5, 100);
  const limit = boundedInteger(req.query.limit, 24, 1, 100);
  const offset = boundedInteger(req.query.offset, 0, 0, 100000);

  let members = [];
  let hasMore = false;
  let errorMessage = null;
  let hasLocation = false;

  try {
    const profile = dataFrom(await getRequestProfile(req, token)) || {};
    const lat = numericCoordinate(profile.latitude ?? profile.lat);
    const lon = numericCoordinate(profile.longitude ?? profile.lon ?? profile.lng);

    if (lat !== null && lon !== null) {
      hasLocation = true;
      const result = await getMembersNearby(token, {
        lat,
        lon,
        q: search,
        radius_km: radius,
        limit,
        offset
      });
      const meta = metaFrom(result);
      members = rowsFrom(result)
        .map((member) => normalizeNearbyMember(member, res.locals.t, res.locals.formatLocaleNumber))
        .filter((member) => member.id > 0);
      hasMore = !!meta.has_more;
    }
  } catch {
    errorMessage = res.locals.t('govuk_alpha_members.nearby.error_detail');
  }

  res.render('members/nearby', {
    title: res.locals.t('govuk_alpha_members.nearby.title'),
    activeNav: 'members',
    alphaActiveNav: 'members',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    members,
    search,
    radius,
    radiusOptions: [5, 10, 25, 50, 100],
    hasLocation,
    hasMore,
    nextHref: hasMore ? `/members/nearby${search ? `?q=${encodeURIComponent(search)}&` : '?'}radius=${radius}&offset=${offset + limit}` : '',
    errorMessage
  });
}));

router.get('/:id(\\d+)/insights', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  try {
    const [viewerResult, profileResult, verificationResult] = await Promise.all([
      getRequestProfile(req, token),
      getUserV2(token, id),
      getMemberVerificationBadges(token, id).catch(() => ({ data: [] }))
    ]);
    const viewer = dataFrom(viewerResult) || {};
    const profile = dataFrom(profileResult) || {};
    const normalized = normalizeInsightsProfile(profile, res.locals.t, res.locals.formatLocaleNumber);
    const isOwnProfile = Number(viewer.id) === id;

    res.render('members/insights', {
      title: res.locals.t('govuk_alpha_members.insights.title', { name: normalized.displayName }),
      activeNav: isOwnProfile ? 'profile' : 'members',
      alphaActiveNav: isOwnProfile ? 'profile' : 'members',
      memberId: id,
      isOwnProfile,
      displayName: normalized.displayName,
      nexusScore: normalized.nexusScore,
      insightsStats: normalized.stats,
      verificationBadges: normalizeVerificationBadges(verificationResult, res.locals.t),
      earnedBadges: normalized.badges
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    throw error;
  }
}));

// Members directory - list all users in tenant
router.get('/', asyncRoute(withTokenRefresh(async (req, res) => {
  const token = tokenFrom(req);
  const requestedPage = boundedInteger(req.query.page, 1, 1, 100000);
  const limit = 20;
  const requestedOffset = req.query.offset === undefined
    ? (requestedPage - 1) * limit
    : boundedInteger(req.query.offset, 0, 0, 1000000);
  const searchQuery = String(req.query.q || req.query.search || '').trim().slice(0, 120);
  const requestedSort = String(req.query.sort || 'name').trim();
  const sort = MEMBER_DIRECTORY_SORTS.has(requestedSort) ? requestedSort : 'name';
  const requestedOrder = String(req.query.order || 'ASC').trim().toUpperCase();
  const order = requestedOrder === 'DESC' ? 'DESC' : 'ASC';
  let memberErrorMessage = null;

  let usersResult = {
    data: [],
    meta: { total_items: 0, per_page: limit, offset: requestedOffset, has_more: false }
  };
  if (token) {
    try {
      usersResult = await getUsers(token, {
        q: searchQuery,
        sort,
        order,
        limit,
        offset: requestedOffset
      });
    } catch (error) {
      if (isAuthError(error)) throw error;
      memberErrorMessage = res.locals.t('members.error_detail');
    }
  }

  const rawUsers = rowsFrom(usersResult);
  const directoryMeta = metaFrom(usersResult);
  const total = boundedInteger(directoryMeta.total_items, rawUsers.length, 0, Number.MAX_SAFE_INTEGER);
  const perPage = boundedInteger(directoryMeta.per_page, limit, 1, 100);
  const offset = boundedInteger(directoryMeta.offset, requestedOffset, 0, Number.MAX_SAFE_INTEGER);
  const page = Math.floor(offset / perPage) + 1;
  const totalPages = Math.ceil(total / perPage);
  const { connectionMap, failed: connectionStatusFailed } = token
    ? await connectionMapForMembers(token, rawUsers)
    : { connectionMap: {}, failed: false };
  if (connectionStatusFailed && !memberErrorMessage) {
    memberErrorMessage = res.locals.t('members.error_detail');
  }
  const users = rawUsers.map((member) => {
    const normalized = normalizeDiscoverMember(member, res.locals.t);
    const connection = connectionMap[normalized.id];
    if (!normalized.connectionLabel && connection) {
      const state = connection.status === 'accepted'
        ? 'connected'
        : (connection.status === 'pending' ? (connection.is_requester ? 'pending_sent' : 'pending_received') : 'none');
      normalized.connectionLabel = connectionLabel(state, res.locals.t);
      normalized.connectionTagClass = connectionTagClass(state);
    }
    normalized.badges = (Array.isArray(member.badges) ? member.badges : []).slice(0, 5).map((badge) => ({
      name: String(badge.name || badge.badge_name || '').trim(),
      icon: String(badge.icon || '').trim()
    })).filter((badge) => badge.name);
    return normalized;
  }).filter((member) => member.id > 0);
  const hasFilters = !!searchQuery || sort !== 'name' || order !== 'ASC';

  res.render('members/index', {
    title: res.locals.t('members.title'),
    requiresAuth: !token,
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    users,
    connectionMap,
    searchQuery,
    sort,
    order,
    hasFilters,
    totalItemsLabel: res.locals.tc('members.result_count', total, { count: total }),
    nextHref: directoryMeta.has_more
      ? `/members?q=${encodeURIComponent(searchQuery)}&sort=${encodeURIComponent(sort)}&order=${encodeURIComponent(order)}&offset=${offset + perPage}`
      : '',
    pagination: {
      page,
      limit: perPage,
      total,
      totalPages,
      offset,
      hasMore: !!directoryMeta.has_more
    },
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    successMessage: req.flash ? req.flash('success')[0] : null,
    errorMessage: memberErrorMessage || (req.flash ? req.flash('error')[0] : null)
  });
}, { redirectOn401: LOGIN_AUTH_REQUIRED_PATH })));

// View single user profile
router.get('/:id(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const { id } = req.params;
  let connectionErrorMessage = null;

  const tenant = req.accessibleRouting?.tenant || res.locals.tenant || {};
  const listingsEnabled = flagEnabled(tenant, 'listings', 'modules', true);
  const [
    userResult,
    connectionResult,
    gamificationResult,
    gamificationBadgesResult,
    reviewsResult,
    currentProfileResult,
    listingsResult,
    skillsResult,
    availabilityResult,
    activityResult,
    blockStatusResult,
    endorsementsResult
  ] = await Promise.all([
    getUser(req.token, id),
    getMemberConnectionStatus(req.token, id).catch((error) => {
      if (isAuthError(error)) throw error;
      connectionErrorMessage = res.locals.t('states.connection-failed');
      return { data: { status: 'none' } };
    }),
    getGamificationProfileByUserId(req.token, Number(id)).catch(() => ({ data: null })),
    getAllBadges(req.token, { user_id: Number(id) }).catch(() => ({ data: [], meta: { total: 0, available_types: [] } })),
    getUserReviews(req.token, id).catch(() => ({ data: [], summary: null })),
    getRequestProfile(req, req.token).catch(() => null),
    listingsEnabled ? getUserListings(req.token, id, { limit: 6 }).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    getUserSkills(req.token, id).catch(() => ({ data: [] })),
    getUserAvailability(req.token, id).catch(() => ({ data: { weekly: [] } })),
    getUserActivityDashboard(req.token, id).catch(() => ({ data: { timeline: [] } })),
    getUserBlockStatus(req.token, id).catch(() => ({ data: { is_blocked: false, is_blocked_by: false } })),
    getMemberEndorsements(req.token, Number(id)).catch(() => ({ data: { endorsements: [] } }))
  ]);
  const publicUser = dataFrom(userResult);

  if (!publicUser || typeof publicUser !== 'object') {
    return res.status(404).render('errors/404', { title: 'User not found' });
  }

  const connection = memberConnectionFrom(connectionResult);
  const currentProfile = dataFrom(currentProfileResult);
  const isOwnProfile = !!currentProfile && Number(currentProfile.id) === Number(id);
  const user = isOwnProfile ? { ...publicUser, ...currentProfile } : publicUser;
  const displayName = memberName(user, res.locals.t);
  const viewerId = positiveInteger(currentProfile?.id);
  const profileListings = rowsFrom(listingsResult).slice(0, 6);
  const profileSkills = profileSkillsFrom(skillsResult, user);
  const reviewSummary = reviewSummaryFrom(reviewsResult);
  const gamification = gamificationFrom(gamificationResult, user);
  const blockStatus = dataFrom(blockStatusResult) || {};
  const profileStatus = profileStatusMessage(req);
  const flashedSuccess = req.flash ? req.flash('success')[0] : null;
  const flashedError = req.flash ? req.flash('error')[0] : null;

  res.render('members/profile', {
    title: displayName,
    user,
    displayName,
    communityName: res.locals.tenantName || res.locals.serviceName || '',
    identityVerified: !!(user.identity_verified || user.id_verified),
    profileType: String(user.profile_type || 'individual') === 'organisation' ? 'organisation' : 'individual',
    joinedLabel: dateLabel(user.created_at || user.createdAt),
    connection,
    connectionState: isOwnProfile
      ? null
      : (!connection
      ? 'none'
      : (connection.status === 'accepted' ? 'connected' : (connection.is_requester ? 'pending_sent' : 'pending_received'))),
    isOwnProfile,
    gamification,
    gamificationBadges: gamificationBadgesFrom(gamificationBadgesResult, user),
    reviews: rowsFrom(reviewsResult),
    reviewSummary,
    profileStats: profileStatsFrom(user, activityResult, profileListings, reviewSummary, gamification, res.locals.formatLocaleNumber),
    profileListings,
    profileSkills,
    profileAvailability: profileAvailabilityFrom(availabilityResult, res.locals.t),
    profileActivity: profileActivityFrom(activityResult, res.locals.t),
    profileEndorsements: profileEndorsementsFrom(endorsementsResult, viewerId),
    isBlocked: !isOwnProfile && !!blockStatus.is_blocked,
    isBlockedBy: !isOwnProfile && !!blockStatus.is_blocked_by,
    reviewsEnabled: reviewsEnabledFor(req, res),
    directMessagingEnabled: flagEnabled(tenant, 'direct_messaging', 'features', true),
    walletEnabled: flagEnabled(tenant, 'wallet', 'modules', true),
    transferIdempotencyKey: randomUUID(),
    successMessage: profileStatus?.type === 'success' ? profileStatus.text : flashedSuccess,
    errorMessage: connectionErrorMessage || (profileStatus?.type === 'error' ? profileStatus.text : flashedError)
  });
}, { redirectOn401: LOGIN_AUTH_REQUIRED_PATH, notFoundTitle: 'User not found' }));

module.exports = router;
