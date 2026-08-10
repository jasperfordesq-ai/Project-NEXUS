// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  callGamificationApi,
  claimDailyReward,
  claimGamificationChallenge,
  purchaseGamificationShopItem,
  updateGamificationShowcase,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function payloadFrom(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, 'data')) {
    return result.data;
  }
  return result || {};
}

function objectFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nestedData(result, key) {
  const payload = payloadFrom(result);
  if (Array.isArray(payload)) {
    return payload;
  }
  const object = objectFrom(payload);
  if (Array.isArray(object[key])) {
    return object[key];
  }
  if (object.data && Array.isArray(object.data)) {
    return object.data;
  }
  return [];
}

function textFrom(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
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
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  return false;
}

function percentFrom(value) {
  return Math.max(0, Math.min(100, Math.round(numberFrom(value))));
}

function formatInteger(value) {
  return intFrom(value).toLocaleString(getRequestIntlLocale());
}

function capitalizeLabel(value) {
  const text = textFrom(value);
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
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

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function badgeKeysFrom(body) {
  const raw = body.badge_keys || body['badge_keys[]'] || [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizeProfile(result, earnedBadgesCount) {
  const profile = objectFrom(payloadFrom(result));
  const levelProgress = objectFrom(profile.level_progress);
  const level = intFrom(profile.level);
  const levelName = textFrom(profile.level_name);
  const progressPercent = percentFrom(levelProgress.progress_percentage);
  const hasNextLevel = Object.prototype.hasOwnProperty.call(levelProgress, 'xp_for_next_level');

  return {
    level,
    levelName,
    levelLabel: `${level}${levelName ? ` - ${levelName}` : ''}`,
    xpLabel: formatInteger(profile.xp),
    badgesCountLabel: formatInteger(profile.badges_count ?? earnedBadgesCount),
    progressPercent,
    atMaxLevel: hasNextLevel && levelProgress.xp_for_next_level === null
  };
}

function normalizeBadges(result) {
  return nestedData(result, 'badges').map((badge) => {
    const object = objectFrom(badge);
    return {
      name: textFrom(object.name ?? object.badge_name),
      icon: textFrom(object.icon),
      message: textFrom(object.msg ?? object.description)
    };
  }).filter((badge) => badge.name || badge.message);
}

function normalizeBadgeProgress(result) {
  return nestedData(result, 'progress').map((row) => {
    const object = objectFrom(row);
    const badge = objectFrom(object.badge);
    return {
      name: textFrom(badge.name ?? object.name),
      icon: textFrom(badge.icon ?? object.icon),
      remaining: intFrom(object.remaining),
      percent: percentFrom(object.percent ?? object.progress_percent ?? object.progress_percentage)
    };
  }).filter((row) => row.name);
}

function normalizeDailyReward(result) {
  const data = objectFrom(payloadFrom(result));
  const status = objectFrom(data.status);
  const source = Object.keys(status).length ? status : data;
  const canClaim = Object.prototype.hasOwnProperty.call(source, 'can_claim')
    ? boolFrom(source.can_claim)
    : !boolFrom(source.claimed ?? source.claimed_today);

  return {
    canClaim,
    streak: intFrom(source.streak ?? source.current_streak),
    nextXp: intFrom(source.next_xp ?? source.reward_xp ?? source.today_xp ?? source.base_xp ?? 5),
    rewardXp: intFrom(source.base_xp ?? source.reward_xp ?? source.today_xp ?? source.next_xp ?? 5)
  };
}

function normalizeChallenges(result) {
  return nestedData(result, 'challenges').map((challenge) => {
    const object = objectFrom(challenge);
    const reward = objectFrom(object.reward);
    const progress = objectFrom(object.progress);
    const id = positiveInteger(object.id);
    const completed = boolFrom(object.is_completed ?? object.completed);
    const claimed = boolFrom(object.reward_claimed ?? object.claimed);

    return {
      id,
      title: textFrom(object.name ?? object.title),
      description: textFrom(object.description),
      percent: percentFrom(object.progress_percent ?? object.progress_percentage ?? progress.percent),
      current: intFrom(object.user_progress ?? object.current ?? progress.current),
      target: intFrom(object.target_count ?? object.target ?? progress.target),
      rewardXp: intFrom(object.reward_xp ?? object.xp_reward ?? reward.xp),
      daysRemaining: intFrom(object.days_remaining),
      completed,
      claimed,
      claimable: completed && !claimed && id !== null
    };
  }).filter((challenge) => challenge.title);
}

function normalizeShop(result, t) {
  const payload = payloadFrom(result);
  const object = objectFrom(payload);
  const meta = objectFrom(result && result.meta);
  const items = Array.isArray(payload) ? payload : nestedData(result, 'items');
  const userXp = intFrom(object.user_xp ?? object.xp ?? meta.user_xp);

  return {
    userXp,
    userXpLabel: t('govuk_alpha_gamification.shop.balance_value', { xp: formatInteger(userXp) }),
    items: items.map((item) => {
      const objectItem = objectFrom(item);
      const cost = intFrom(objectItem.cost_xp ?? objectItem.xp_cost);
      const owned = intFrom(objectItem.user_purchases) > 0 || boolFrom(objectItem.owned);
      const canPurchase = boolFrom(objectItem.can_purchase ?? objectItem.can_buy);
      const itemType = ['badge', 'perk', 'feature', 'cosmetic'].includes(textFrom(objectItem.item_type))
        ? textFrom(objectItem.item_type)
        : 'perk';

      return {
        id: positiveInteger(objectItem.id),
        name: textFrom(objectItem.name),
        description: textFrom(objectItem.description),
        cost,
        costLabel: t('govuk_alpha_gamification.shop.cost', { xp: formatInteger(cost) }),
        itemType,
        typeLabel: {
          badge: t('govuk_alpha_gamification.shop.type_badge'),
          perk: t('govuk_alpha_gamification.shop.type_perk'),
          feature: t('govuk_alpha_gamification.shop.type_feature'),
          cosmetic: t('govuk_alpha_gamification.shop.type_cosmetic')
        }[itemType],
        owned,
        canPurchase: canPurchase && !owned,
        unavailableLabel: cost > userXp
          ? t('govuk_alpha_gamification.shop.cannot_afford')
          : t('govuk_alpha_gamification.shop.out_of_stock')
      };
    }).filter((item) => item.name)
  };
}

function normalizeCollections(result) {
  return nestedData(result, 'collections').map((collection) => {
    const object = objectFrom(collection);
    return {
      name: textFrom(object.name),
      description: textFrom(object.description),
      earnedCount: intFrom(object.earned_count),
      totalCount: intFrom(object.total_count),
      progressPercent: percentFrom(object.progress_percent),
      rewardXp: intFrom(object.bonus_xp ?? object.reward_xp),
      rewardLabel: `${formatInteger(object.bonus_xp ?? object.reward_xp)} XP`,
      completed: boolFrom(object.is_completed ?? object.completed),
      bonusClaimed: boolFrom(object.bonus_claimed),
      badges: nestedData({ data: object.badges || [] }, 'badges').map((badge) => {
        const badgeObject = objectFrom(badge);
        const key = textFrom(badgeObject.key ?? badgeObject.badge_key);
        return {
          key,
          name: textFrom(badgeObject.name),
          earned: boolFrom(badgeObject.earned),
          href: key ? `/achievements/badges/${encodeURIComponent(key)}` : ''
        };
      }).filter((badge) => badge.name)
    };
  }).filter((collection) => collection.name);
}

function normalizeEngagementHistory(result, tc) {
  return nestedData(result, 'history').map((row) => {
    const object = objectFrom(row);
    const activityCount = intFrom(object.activity_count);
    return {
      month: textFrom(object.year_month ?? object.month),
      wasActive: boolFrom(object.was_active ?? object.active),
      activityCount,
      activityCountLabel: tc('govuk_alpha_gamification.engagement.activities_count', activityCount)
    };
  }).filter((row) => row.month);
}

function normalizeShowcaseBadges(result) {
  return nestedData(result, 'badges').map((badge) => {
    const object = objectFrom(badge);
    const key = textFrom(object.badge_key ?? object.key);
    return {
      key,
      name: textFrom(object.name, key),
      description: textFrom(object.description ?? object.msg),
      isShowcased: boolFrom(object.is_showcased ?? object.showcased)
    };
  }).filter((badge) => badge.key);
}

function normalizeBadgeDetail(result, key) {
  const badge = objectFrom(payloadFrom(result));
  const tier = objectFrom(badge.tier);
  const earnedAt = textFrom(badge.earned_at);
  const xpValue = intFrom(badge.xp_value);
  return {
    key,
    name: textFrom(badge.name, key),
    icon: textFrom(badge.icon),
    description: textFrom(badge.description ?? badge.msg),
    earned: boolFrom(badge.earned),
    earnedAtLabel: earnedAt ? formatDateLabel(earnedAt) : '',
    rarityLabel: capitalizeLabel(badge.rarity),
    xpValue,
    xpValueLabel: formatInteger(xpValue),
    tierLabel: capitalizeLabel(tier.name ?? badge.tier),
    typeLabel: capitalizeLabel(badge.type),
    isShowcased: boolFrom(badge.is_showcased ?? badge.showcased)
  };
}

async function safeGamificationCall(token, pathValue, fallback) {
  try {
    return await callGamificationApi(token, 'GET', pathValue);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      throw error;
    }
    return fallback;
  }
}

function statusMessages(status, t) {
  return {
    dailyRewardStatus: status,
    challengeStatus: status,
    dailySuccess: status === 'daily-reward-claimed'
      ? t('polish_gamify.daily_reward_success', { xp: 0 })
      : '',
    dailyError: status === 'daily-reward-failed'
      ? t('polish_gamify.daily_reward_failed')
      : '',
    challengeSuccess: status === 'challenge-claimed' ? t('polish_gamify.challenge_claim_success') : '',
    challengeError: status === 'challenge-claim-failed' ? t('polish_gamify.challenge_claim_failed') : ''
  };
}

function redirectAuthIfNeeded(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let profilePayload;
  let badgesPayload;
  let progressPayload;
  let dailyPayload;
  let challengesPayload;

  try {
    [profilePayload, badgesPayload, progressPayload, dailyPayload, challengesPayload] = await Promise.all([
      safeGamificationCall(token, '/profile', { data: {} }),
      safeGamificationCall(token, '/badges', { data: [] }),
      safeGamificationCall(token, '/achievements/progress', { data: { progress: [] } }),
      safeGamificationCall(token, '/daily-reward', { data: {} }),
      safeGamificationCall(token, '/challenges', { data: [] })
    ]);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    profilePayload = { data: {} };
    badgesPayload = { data: [] };
    progressPayload = { data: { progress: [] } };
    dailyPayload = { data: {} };
    challengesPayload = { data: [] };
  }

  const earnedBadges = normalizeBadges(badgesPayload);
  const dailyReward = normalizeDailyReward(dailyPayload);
  const status = statusMessages(textFrom(req.query.status), res.locals.t);

  return res.render('achievements/index', {
    title: res.locals.t('achievements.title'),
    activeNav: 'achievements',
    achievements: {
      profile: normalizeProfile(profilePayload, earnedBadges.length),
      earnedBadges,
      badgeProgress: normalizeBadgeProgress(progressPayload),
      dailyReward,
      challenges: normalizeChallenges(challengesPayload),
      status: {
        ...status,
        dailySuccessMessage: status.dailySuccess
          ? res.locals.t('polish_gamify.daily_reward_success', { xp: dailyReward.rewardXp })
          : ''
      }
    }
  });
}));

router.get('/shop', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let shopPayload;
  try {
    shopPayload = await callGamificationApi(token, 'GET', '/shop');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    shopPayload = { data: { items: [], user_xp: 0 } };
  }

  const status = textFrom(req.query.status);
  return res.render('achievements/shop', {
    title: res.locals.t('govuk_alpha_gamification.shop.title'),
    activeNav: 'achievements',
    shop: {
      ...normalizeShop(shopPayload, res.locals.t),
      status,
      successMessage: status === 'purchased'
        ? res.locals.t('govuk_alpha_gamification.shop.states.purchased')
        : '',
      errorMessage: status === 'purchase-failed'
        ? res.locals.t('govuk_alpha_gamification.shop.states.purchase-failed')
        : ''
    }
  });
}));

router.get('/collections', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let collectionsPayload;
  try {
    collectionsPayload = await callGamificationApi(token, 'GET', '/collections');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    collectionsPayload = { data: [] };
  }

  return res.render('achievements/collections', {
    title: res.locals.t('govuk_alpha_gamification.collections.title'),
    activeNav: 'achievements',
    collections: normalizeCollections(collectionsPayload)
  });
}));

router.get('/engagement', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let historyPayload;
  try {
    historyPayload = await callGamificationApi(token, 'GET', '/engagement-history');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    historyPayload = { data: [] };
  }

  return res.render('achievements/engagement', {
    title: res.locals.t('govuk_alpha_gamification.engagement.title'),
    activeNav: 'achievements',
    engagementHistory: normalizeEngagementHistory(historyPayload, res.locals.tc)
  });
}));

router.get('/showcase', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let badgesPayload;
  try {
    badgesPayload = await callGamificationApi(token, 'GET', '/badges');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    badgesPayload = { data: [] };
  }

  return res.render('achievements/showcase', {
    title: res.locals.t('govuk_alpha_gamification.showcase.title'),
    activeNav: 'achievements',
    earnedBadges: normalizeShowcaseBadges(badgesPayload),
    status: textFrom(req.query.status)
  });
}));

router.get('/badges/:key', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const key = textFrom(req.params.key);
  let badgePayload;
  try {
    badgePayload = await callGamificationApi(token, 'GET', `/badges/${encodeURIComponent(key)}`);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    throw error;
  }

  const badge = normalizeBadgeDetail(badgePayload, key);
  return res.render('achievements/badge', {
    title: badge.name || res.locals.t('govuk_alpha_gamification.badge.title'),
    activeNav: 'achievements',
    badge
  });
}));

router.post('/daily-reward', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let status = 'daily-reward-claimed';
  try {
    await claimDailyReward(token);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'daily-reward-failed';
  }

  return redirectTo(res, `/achievements?status=${status}`);
}));

router.post('/challenges/:id(\\d+)/claim', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let status = 'challenge-claimed';
  try {
    await claimGamificationChallenge(token, Number(req.params.id));
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'challenge-claim-failed';
  }

  return redirectTo(res, `/achievements?status=${status}`);
}));

router.post('/shop/purchase', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const itemId = positiveInteger(req.body.item_id);
  let status = 'purchase-failed';
  if (itemId !== null) {
    try {
      await purchaseGamificationShopItem(token, itemId);
      status = 'purchased';
    } catch (error) {
      if (redirectAuthIfNeeded(error, res)) return undefined;
    }
  }

  return redirectTo(res, `/achievements/shop?status=${status}`);
}));

router.post('/showcase', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  const badgeKeys = badgeKeysFrom(req.body);
  let status = 'showcase-failed';
  if (badgeKeys.length > 5) {
    status = 'showcase-too-many';
  } else {
    try {
      await updateGamificationShowcase(token, badgeKeys);
      status = 'showcase-updated';
    } catch (error) {
      if (redirectAuthIfNeeded(error, res)) return undefined;
      if (error instanceof ApiError && error.status === 400) {
        status = 'showcase-not-owned';
      }
    }
  }

  return redirectTo(res, `/achievements/showcase?status=${status}`);
}));

module.exports = router;
