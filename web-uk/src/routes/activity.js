// Copyright (C) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callProfileApi, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');

const router = express.Router();

const ACTIVITY_TYPE_KEYS = {
  post: 'type_post',
  gave_hours: 'type_gave_hours',
  received_hours: 'type_received_hours',
  comment: 'type_comment',
  connection: 'type_connection',
  event_rsvp: 'type_event_rsvp',
  event: 'type_event_rsvp',
  listing: 'type_listing',
  message: 'type_message',
  review: 'type_review',
  activity: 'type_activity'
};
const ACTIVITY_TYPE_TAGS = {
  gave_hours: 'govuk-tag--green',
  received_hours: 'govuk-tag--turquoise',
  exchange: 'govuk-tag--green',
  post: 'govuk-tag--pink',
  comment: 'govuk-tag--blue',
  connection: 'govuk-tag--light-blue',
  event_rsvp: 'govuk-tag--purple',
  event: 'govuk-tag--purple',
  listing: 'govuk-tag--blue',
  message: 'govuk-tag--turquoise',
  review: 'govuk-tag--yellow',
  activity: 'govuk-tag--grey'
};

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
  if (result && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    return result.data;
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result;
  }
  return {};
}

function arrayFrom(value) {
  return Array.isArray(value) ? value : [];
}

function numberFrom(value) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function intFrom(value) {
  const numeric = Number.parseInt(value, 10);
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

function formatNumber(value, fractionDigits = 1) {
  return numberFrom(value).toLocaleString(getRequestIntlLocale(), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

function formatInteger(value) {
  return intFrom(value).toLocaleString(getRequestIntlLocale());
}

function textFrom(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleDateString(getRequestIntlLocale(), {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function truncate(value, maxLength = 160) {
  const text = textFrom(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function normalizeSkill(skill, t) {
  const name = textFrom(skill.skill_name ?? skill.name);
  const endorsements = intFrom(skill.endorsements ?? skill.endorsements_count);
  return {
    name,
    isOffering: boolFrom(skill.is_offering ?? skill.offering),
    isRequesting: boolFrom(skill.is_requesting ?? skill.requesting),
    endorsements,
    endorsementsLabel: endorsements > 0
      ? t('govuk_alpha_activity.insights.skill_endorsements', { count: formatInteger(endorsements) })
      : ''
  };
}

function normalizeMonthly(monthly) {
  const rows = arrayFrom(monthly).map((row) => {
    const given = numberFrom(row.given ?? row.hours_given);
    const received = numberFrom(row.received ?? row.hours_received);
    return {
      label: textFrom(row.label ?? row.month),
      given,
      received,
      total: given + received,
      givenLabel: formatNumber(given),
      receivedLabel: formatNumber(received),
      totalLabel: formatNumber(given + received),
      percent: 0,
      givenPercent: 0,
      receivedPercent: 0
    };
  }).filter((row) => row.label);

  const maxTotal = rows.reduce((max, row) => Math.max(max, row.total), 0);
  const maxBar = rows.reduce((max, row) => Math.max(max, row.given, row.received), 0);
  return rows.map((row) => ({
    ...row,
    percent: maxTotal > 0 ? Math.round((row.total / maxTotal) * 100) : 0,
    givenPercent: maxBar > 0 ? Math.round((row.given / maxBar) * 100) : 0,
    receivedPercent: maxBar > 0 ? Math.round((row.received / maxBar) * 100) : 0
  }));
}

function normalizeTimelineItem(item, t) {
  const type = textFrom(item.activity_type, 'activity') || 'activity';
  const text = truncate(item.description ?? item.title ?? item.message ?? item.content);
  const dateLabel = formatDate(item.created_at ?? item.date);
  return {
    type,
    typeLabel: t(`govuk_alpha_activity.insights.${ACTIVITY_TYPE_KEYS[type] || ACTIVITY_TYPE_KEYS.activity}`),
    tagClass: ACTIVITY_TYPE_TAGS[type] || ACTIVITY_TYPE_TAGS.activity,
    text,
    dateLabel
  };
}

function netBalanceInsight(netBalance, t) {
  const absolute = formatNumber(Math.abs(netBalance));
  if (netBalance > 0) {
    return {
      label: t('govuk_alpha_activity.insights.net_balance_positive', { value: absolute }),
      tagClass: 'govuk-tag--green',
      meaning: t('govuk_alpha_activity.insights.net_balance_positive_meaning')
    };
  }
  if (netBalance < 0) {
    return {
      label: t('govuk_alpha_activity.insights.net_balance_negative', { value: `-${absolute}` }),
      tagClass: 'govuk-tag--red',
      meaning: t('govuk_alpha_activity.insights.net_balance_negative_meaning')
    };
  }
  return {
    label: t('govuk_alpha_activity.insights.net_balance_negative', { value: absolute }),
    tagClass: 'govuk-tag--grey',
    meaning: t('govuk_alpha_activity.insights.net_balance_even_meaning')
  };
}

function normalizeActivity(payload, t) {
  const data = payloadFrom(payload);
  const hours = data.hours_summary && typeof data.hours_summary === 'object' ? data.hours_summary : {};
  const connections = data.connection_stats && typeof data.connection_stats === 'object' ? data.connection_stats : {};
  const engagement = data.engagement && typeof data.engagement === 'object' ? data.engagement : {};
  const skillsBreakdown = data.skills_breakdown && typeof data.skills_breakdown === 'object' ? data.skills_breakdown : {};
  const netBalance = Object.prototype.hasOwnProperty.call(hours, 'net_balance') ? numberFrom(hours.net_balance) : null;
  const monthly = normalizeMonthly(data.monthly_hours);
  const skills = arrayFrom(skillsBreakdown.skills)
    .map((skill) => normalizeSkill(skill, t))
    .filter((skill) => skill.name);
  const offeringCount = intFrom(skillsBreakdown.offering_count);
  const requestingCount = intFrom(skillsBreakdown.requesting_count);

  return {
    hoursGivenLabel: formatNumber(hours.hours_given),
    hoursReceivedLabel: formatNumber(hours.hours_received),
    connectionsLabel: formatInteger(connections.total_connections),
    groupsJoinedLabel: formatInteger(connections.groups_joined),
    exchangesLabel: formatInteger(intFrom(hours.transactions_given) + intFrom(hours.transactions_received)),
    engagement: {
      postsLabel: formatInteger(engagement.posts_count),
      commentsLabel: formatInteger(engagement.comments_count),
      likesGivenLabel: formatInteger(engagement.likes_given),
      likesReceivedLabel: formatInteger(engagement.likes_received)
    },
    hasEngagement: Object.keys(engagement).length > 0,
    netBalanceLabel: netBalance === null
      ? ''
      : t('polish_discovery.activity_net_hours', { value: formatNumber(netBalance) }),
    netBalanceInsight: netBalanceInsight(netBalance || 0, t),
    skills,
    skillsSummaryLabel: t('govuk_alpha_activity.insights.skills_summary', {
      offering: formatInteger(offeringCount),
      requesting: formatInteger(requestingCount)
    }),
    monthly,
    chartMonths: monthly.filter((row) => row.given > 0 || row.received > 0),
    hasChart: monthly.some((row) => row.given > 0 || row.received > 0),
    timeline: arrayFrom(data.timeline)
      .map((item) => normalizeTimelineItem(item, t))
      .filter((item) => item.text || item.dateLabel)
  };
}

async function activityContext(req, res, title) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return null;
  }

  let payload = {};
  try {
    payload = await callProfileApi(token, 'GET', '/users/me/activity/dashboard');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      redirectTo(res, loginRedirect());
      return null;
    }
    payload = {};
  }

  return {
    title,
    activeNav: 'activity',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    activity: normalizeActivity(payload, res.locals.t)
  };
}

router.get('/insights', asyncRoute(async (req, res) => {
  const context = await activityContext(req, res, res.locals.t('govuk_alpha_activity.insights.title'));
  if (!context) {
    return null;
  }
  return res.render('activity/insights', context);
}));

router.get('/', asyncRoute(async (req, res) => {
  const context = await activityContext(req, res, res.locals.t('activity.title'));
  if (!context) {
    return null;
  }
  return res.render('activity/index', context);
}));

module.exports = router;
