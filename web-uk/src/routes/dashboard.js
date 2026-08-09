// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getBalance,
  getListings,
  getFeedPosts,
  getMyEvents,
  getGamificationProfile,
  getMyBadges,
  getOnboardingStatus,
  getExchangeAttentionCount,
  getMemberEndorsements,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { flagEnabled } = require('../lib/accessible-shell');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

router.use(requireAuth);

function dataFrom(result) {
  if (!result || typeof result !== 'object') return result;
  return result.data !== undefined ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.items)) return data.items;
  if (Array.isArray(data && data.data)) return data.data;
  if (Array.isArray(result && result.items)) return result.items;
  if (Array.isArray(result && result.data)) return result.data;
  return [];
}

function numberFrom(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerFrom(value, fallback = 0) {
  return Math.trunc(numberFrom(value, fallback));
}

function formatOneDecimal(value) {
  return new Intl.NumberFormat(getRequestIntlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(numberFrom(value));
}

function formatInteger(value) {
  return new Intl.NumberFormat(getRequestIntlLocale()).format(integerFrom(value));
}

function displayName(profile, t = (key) => key) {
  const first = String(profile && (profile.first_name || profile.firstName || '')).trim();
  const last = String(profile && (profile.last_name || profile.lastName || '')).trim();
  const combined = [first, last].filter(Boolean).join(' ').trim();
  return combined
    || String(profile && (profile.display_name || profile.displayName || profile.name || '')).trim()
    || t('members.unknown_member');
}

function profileId(profile) {
  const id = Number(profile && (profile.id ?? profile.user_id ?? profile.userId));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function firstName(profile, t) {
  return String(profile && (profile.first_name || profile.firstName || '')).trim() || displayName(profile, t);
}

function profileStats(profile) {
  const stats = (profile && (profile.stats || profile.profile_stats || profile.profileStats)) || {};
  const hoursGiven = numberFrom(
    profile.total_hours_given
      ?? profile.totalHoursGiven
      ?? stats.total_hours_given
      ?? stats.totalHoursGiven
      ?? stats.given_count
      ?? stats.givenCount
      ?? stats.hours_given
      ?? stats.hoursGiven
      ?? profile.hours_given
      ?? profile.hoursGiven
  );
  const hoursReceived = numberFrom(
    profile.total_hours_received
      ?? profile.totalHoursReceived
      ?? stats.total_hours_received
      ?? stats.totalHoursReceived
      ?? stats.received_count
      ?? stats.receivedCount
      ?? stats.hours_received
      ?? stats.hoursReceived
      ?? profile.hours_received
      ?? profile.hoursReceived
  );
  const listingsCount = integerFrom(stats.listings_count ?? stats.listingsCount ?? profile.listings_count ?? profile.listingsCount);

  return {
    hoursGiven,
    hoursGivenLabel: formatOneDecimal(hoursGiven),
    hoursReceived,
    hoursReceivedLabel: formatOneDecimal(hoursReceived),
    listingsCount,
    listingsCountLabel: formatInteger(listingsCount)
  };
}

function walletBalance(result) {
  const data = dataFrom(result);
  if (typeof data === 'number') return data;
  return numberFrom(data && (data.balance ?? data.available_balance ?? data.availableBalance));
}

function onboardingCompleted(result) {
  const data = dataFrom(result) || {};
  if (data.onboarding_completed !== undefined) return Boolean(data.onboarding_completed);
  if (data.onboardingCompleted !== undefined) return Boolean(data.onboardingCompleted);
  if (data.completed !== undefined) return Boolean(data.completed);
  return true;
}

function normalizedGamification(result, badges, t = (key) => key) {
  const data = dataFrom(result);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const profile = data.profile || data.gamification || data;
  const hasLevelProgress = Object.prototype.hasOwnProperty.call(profile, 'level_progress')
    || Object.prototype.hasOwnProperty.call(profile, 'levelProgress');
  const hasProfile = Object.prototype.hasOwnProperty.call(profile, 'xp')
    && Object.prototype.hasOwnProperty.call(profile, 'level')
    && hasLevelProgress
    && (Object.prototype.hasOwnProperty.call(profile, 'badges_count')
      || Object.prototype.hasOwnProperty.call(profile, 'badgesCount'));
  if (!hasProfile) return null;
  const levelProgress = profile.level_progress || profile.levelProgress || {};
  const progressPct = Math.max(0, Math.min(100, integerFrom(
    levelProgress.progress_percentage ?? levelProgress.progressPercentage ?? profile.progress_percentage ?? profile.progressPercentage
  )));

  const level = integerFrom(profile.level);
  const xp = integerFrom(profile.xp ?? profile.total_xp ?? profile.totalXp);
  const badgesCount = integerFrom(profile.badges_count ?? profile.badgesCount ?? badges.length, badges.length);

  return {
    level,
    levelLabel: formatInteger(level),
    levelName: String(profile.level_name || profile.levelName || '').trim(),
    xp,
    xpLabel: formatInteger(xp),
    progressPct,
    progressLabel: t('dashboard.progress_to_next', { percent: formatInteger(progressPct) }),
    badgesCount,
    badgesCountLabel: formatInteger(badgesCount)
  };
}

function feedItemType(item, t = (key) => key) {
  const type = String(item && item.type ? item.type : 'post').toLowerCase();
  const key = `feed.item_types.${type}`;
  const translated = t(key);
  return translated === key ? t('feed.item_types.activity') : translated;
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalizeFeedItem(item, t = (key) => key) {
  const type = String(item && item.type ? item.type : 'post').toLowerCase();
  const id = Number(item && item.id);
  const typeLabel = feedItemType(item, t);
  return {
    id: item && item.id,
    href: type === 'post' && Number.isInteger(id) && id > 0 ? `/feed/posts/${id}` : '/feed',
    typeLabel,
    title: String(item && (item.title || item.heading || typeLabel)).trim(),
    content: stripTags(item && (item.content || item.body)),
    authorName: String(item && ((item.author && item.author.name) || item.author_name || item.authorName || t('feed.unknown_author'))).trim(),
    imageUrl: item && (item.image_url || item.imageUrl || (item.media && item.media[0] && (item.media[0].thumbnail_url || item.media[0].file_url)))
  };
}

function normalizeListing(listing, t = (key) => key) {
  const type = String(listing && listing.type ? listing.type : 'offer').toLowerCase() === 'request' ? 'request' : 'offer';
  return {
    id: listing && listing.id,
    title: String(listing && (listing.title || listing.name || t('feed.item_types.listing'))).trim(),
    type,
    description: stripTags(listing && listing.description),
    imageUrl: listing && (listing.image_url || listing.imageUrl)
  };
}

function normalizeEvent(event, t = (key) => key) {
  return {
    id: event && event.id,
    title: String(event && (event.title || event.name || t('feed.item_types.event'))).trim(),
    start: event && (event.start_time || event.startTime || event.starts_at || event.startsAt || event.start_date || event.startDate),
    location: String(event && (event.location || event.venue || '')).trim()
  };
}

function normalizeExchangeAttention(result, tc = (key) => key) {
  const data = dataFrom(result) || {};
  const count = integerFrom(data.count ?? data.total);
  const items = collectionFrom(data.items ? { data: data.items } : data)
    .slice(0, 5)
    .map((item) => ({
      id: item && item.id,
      title: String(item && (item.listing_title || item.listingTitle || item.title || item.description || '')).trim()
    }));

  return {
    count,
    items,
    body: tc('dashboard.pending_reviews_body', count)
  };
}

function normalizeEndorsements(result, tc = (key) => key) {
  const data = dataFrom(result) || {};
  const endorsements = Array.isArray(data.endorsements)
    ? data.endorsements
    : collectionFrom(data);

  return endorsements
    .map((endorsement) => {
      const skillName = String(endorsement && (endorsement.skill_name || endorsement.skillName || endorsement.name || endorsement.skill || '')).trim();
      const count = integerFrom(endorsement && (endorsement.count ?? endorsement.endorsement_count ?? endorsement.endorsements_count));
      return {
        skillName,
        count,
        countLabel: tc('dashboard.endorsement_count', count)
      };
    })
    .filter((endorsement) => endorsement.skillName && endorsement.count > 0)
    .slice(0, 6);
}

function isGoingEvent(event) {
  const rsvp = event && (event.my_rsvp || event.myRsvp);
  if (!rsvp) return true;
  if (typeof rsvp === 'string') return rsvp.toLowerCase() === 'going';
  return String(rsvp.status || '').toLowerCase() === 'going';
}

router.get('/', asyncRoute(async (req, res) => {
  const tenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : (res.locals.tenant || {});
  const t = typeof req.t === 'function' ? req.t : res.locals.t;
  const tc = typeof req.tc === 'function' ? req.tc : res.locals.tc;
  const dashboardFeatures = {
    listings: flagEnabled(tenant, 'listings', 'modules', true),
    messages: flagEnabled(tenant, 'messages', 'modules', true),
    connections: flagEnabled(tenant, 'connections', 'features', true),
    events: flagEnabled(tenant, 'events', 'features', true),
    volunteering: flagEnabled(tenant, 'volunteering', 'features', true),
    exchangeWorkflow: flagEnabled(tenant, 'exchange_workflow', 'features', true)
  };
  const [
    profile,
    balanceData,
    onboardingData,
    gamificationData,
    badgesData,
    listingsData,
    feedData,
    eventsData
  ] = await Promise.all([
    getRequestProfile(req, req.token),
    getBalance(req.token).catch(() => ({ balance: 0 })),
    getOnboardingStatus(req.token).catch(() => ({ data: { onboarding_completed: true } })),
    getGamificationProfile(req.token).catch(() => ({ data: null })),
    getMyBadges(req.token).catch(() => ({ data: [], meta: { total: 0, available_types: [] } })),
    dashboardFeatures.listings
      ? getListings(req.token, { limit: 5 }).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),
    getFeedPosts(req.token, { per_page: 5 }).catch((error) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      return { data: [] };
    }),
    dashboardFeatures.events
      ? getMyEvents(req.token).catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] })
  ]);

  const safeProfile = dataFrom(profile) || {};
  const gamificationBadges = collectionFrom(badgesData);
  const profileBadges = Array.isArray(safeProfile.badges) ? safeProfile.badges : [];
  const badges = (gamificationBadges.length > 0 ? gamificationBadges : profileBadges).slice(0, 8);
  const balance = walletBalance(balanceData);
  const currentProfileId = profileId(safeProfile);
  const [exchangeAttentionData, endorsementsData] = await Promise.all([
    dashboardFeatures.listings && dashboardFeatures.exchangeWorkflow
      ? getExchangeAttentionCount(req.token).catch(() => ({ data: { count: 0, items: [] } }))
      : Promise.resolve({ data: { count: 0, items: [] } }),
    currentProfileId
      ? getMemberEndorsements(req.token, currentProfileId).catch(() => ({ data: { endorsements: [] } }))
      : Promise.resolve({ data: { endorsements: [] } })
  ]);

  res.render('dashboard/index', {
    title: t('dashboard.title'),
    titleKey: 'dashboard.title',
    activeNav: 'dashboard',
    profile: safeProfile,
    displayName: displayName(safeProfile, t),
    firstName: firstName(safeProfile, t),
    profileStats: profileStats(safeProfile),
    balance,
    balanceLabel: t('dashboard.hours_value', { value: formatOneDecimal(balance) }),
    onboardingCompleted: onboardingCompleted(onboardingData),
    exchangeAttention: normalizeExchangeAttention(exchangeAttentionData, tc),
    endorsements: normalizeEndorsements(endorsementsData, tc),
    gamification: normalizedGamification(gamificationData, badges, t),
    badges,
    listings: collectionFrom(listingsData).slice(0, 5).map((listing) => normalizeListing(listing, t)),
    feedItems: collectionFrom(feedData).slice(0, 5).map((item) => normalizeFeedItem(item, t)),
    upcomingEvents: collectionFrom(eventsData).filter(Boolean).filter(isGoingEvent).slice(0, 3).map((event) => normalizeEvent(event, t)),
    communityName: res.locals.tenantName || res.locals.serviceName || 'Project NEXUS Accessible',
    dashboardFeatures,
    status: String(req.query.status || ''),
    successMessage: req.flash ? req.flash('success')[0] : null
  });
}));

module.exports = router;
