// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callGamificationApi, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const TIERS = [
  { key: 'novice', min: 0 },
  { key: 'beginner', min: 200 },
  { key: 'developing', min: 300 },
  { key: 'intermediate', min: 400 },
  { key: 'proficient', min: 500 },
  { key: 'advanced', min: 600 },
  { key: 'expert', min: 700 },
  { key: 'elite', min: 800 },
  { key: 'legendary', min: 900 }
];

const BREAKDOWN_CATEGORIES = ['engagement', 'quality', 'volunteer', 'activity', 'badges', 'impact'];

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

function intFrom(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function numberFrom(value) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function textFrom(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function formatInteger(value) {
  return intFrom(value).toLocaleString(getRequestIntlLocale());
}

function clampPercentage(value) {
  return Math.max(0, Math.min(100, Math.round(numberFrom(value))));
}

function labelFromInsight(value) {
  if (typeof value === 'string') {
    return value.trim();
  }

  const insight = objectFrom(value);
  return textFrom(insight.message ?? insight.text ?? insight.tip);
}

function normalizeBreakdownRows(breakdown, t) {
  const object = objectFrom(breakdown);
  return BREAKDOWN_CATEGORIES.map((key) => {
    const row = objectFrom(object[key]);
    if (!Object.keys(row).length) {
      return null;
    }

    const score = Math.round(numberFrom(row.score));
    const max = Math.round(numberFrom(row.max));
    const percentage = clampPercentage(row.percentage);

    const label = t(`nexus_score.categories.${key}`);
    return {
      label,
      scoreLabel: `${formatInteger(score)} / ${formatInteger(max)}`,
      percentage,
      progressLabel: `${label}: ${percentage}%`
    };
  }).filter(Boolean);
}

function normalizeScoreOverview(result, t) {
  const payload = objectFrom(payloadFrom(result));
  const hasScore = Object.prototype.hasOwnProperty.call(payload, 'total_score') && payload.total_score !== null;
  const total = Math.round(numberFrom(payload.total_score));
  const max = intFrom(payload.max_score) || 1000;
  const tier = objectFrom(payload.tier);
  const tierName = textFrom(tier.name) || (typeof payload.tier === 'string' ? textFrom(payload.tier) : '');
  const tierIcon = textFrom(tier.icon);
  const scoreLabel = `${tierIcon ? `${tierIcon} ` : ''}${t('nexus_score.out_of', { score: formatInteger(total), max: formatInteger(max) })}`;
  const hasPercentile = payload.percentile !== null && payload.percentile !== undefined && payload.percentile !== '';
  const insights = (Array.isArray(payload.insights) ? payload.insights : []).map(labelFromInsight).filter(Boolean);

  return {
    hasScore,
    scoreLabel,
    tierName,
    percentileLabel: hasPercentile ? t('nexus_score.percentile', { percent: intFrom(payload.percentile) }) : '',
    breakdownRows: normalizeBreakdownRows(payload.breakdown, t),
    insights
  };
}

function normalizeTierScore(result, t) {
  const payload = objectFrom(payloadFrom(result));
  const hasScore = Object.prototype.hasOwnProperty.call(payload, 'total_score') && payload.total_score !== null;
  const total = Math.round(numberFrom(payload.total_score));
  const max = intFrom(payload.max_score) || 1000;
  const tier = objectFrom(payload.tier);
  const currentTierName = textFrom(tier.name) || (typeof payload.tier === 'string' ? textFrom(payload.tier) : '');
  let currentIndex = 0;

  TIERS.forEach((tierRow, index) => {
    if (total >= tierRow.min) {
      currentIndex = index;
    }
  });

  const nextTier = TIERS[currentIndex + 1] || null;
  const pointsToNext = nextTier ? Math.max(0, nextTier.min - total) : 0;

  return {
    hasScore,
    scoreLabel: t('govuk_alpha_gamification.tiers.your_score', { score: formatInteger(total), max: formatInteger(max) }),
    currentTierLabel: currentTierName ? t('govuk_alpha_gamification.tiers.current_tier', { tier: currentTierName }) : '',
    nextTierLabel: nextTier
      ? t('govuk_alpha_gamification.tiers.points_to_next', {
        points: formatInteger(pointsToNext),
        tier: t(`govuk_alpha_gamification.tiers.names.${nextTier.key}`)
      })
      : t('govuk_alpha_gamification.tiers.top_tier'),
    rows: TIERS.map((tierRow, index) => {
      const isCurrent = index === currentIndex;
      const isReached = total >= tierRow.min;
      const statusKey = isCurrent ? 'status_current' : (isReached ? 'status_reached' : 'status_locked');
      const statusClass = isCurrent ? 'govuk-tag--blue' : (isReached ? 'govuk-tag--green' : 'govuk-tag--grey');

      return {
        name: t(`govuk_alpha_gamification.tiers.names.${tierRow.key}`),
        thresholdLabel: formatInteger(tierRow.min),
        isCurrent,
        statusLabel: t(`govuk_alpha_gamification.tiers.${statusKey}`),
        statusClass
      };
    })
  };
}

function redirectAuthIfNeeded(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

router.get('/tiers', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let scorePayload;
  try {
    scorePayload = await callGamificationApi(token, 'GET', '/nexus-score');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    scorePayload = { data: {} };
  }

  return res.render('nexus-score/tiers', {
    title: res.locals.t('govuk_alpha_gamification.tiers.title'),
    activeNav: 'nexus_score',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    tierScore: normalizeTierScore(scorePayload, res.locals.t)
  });
}));

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  let scorePayload;
  try {
    scorePayload = await callGamificationApi(token, 'GET', '/nexus-score');
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    scorePayload = { data: {} };
  }

  return res.render('nexus-score/index', {
    title: res.locals.t('nexus_score.title'),
    activeNav: 'nexus_score',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    nexusScore: normalizeScoreOverview(scorePayload, res.locals.t)
  });
}));

module.exports = router;
