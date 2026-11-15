// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * The React dashboard's three "moments" as plain text on the accessible
 * dashboard (warmth phase 6, E8), each from data the API already returns:
 *
 *  - membershipAnniversary: React pages/dashboard/MembershipAnniversary.tsx —
 *    the week after the day the member joined, one year on or more, from
 *    their own `created_at` (GET /v2/users/me). Only they see it.
 *  - communityAnniversary: React CommunityAnniversary.tsx — the server sends
 *    `anniversary_years` with GET /v2/community/this-month (no date reaches
 *    the page); 1 or more means "is N this month".
 *  - communityMilestone: React CommunityMilestone.tsx — the largest round
 *    number the community's own shared hours have passed, from
 *    GET /v2/platform/stats, and only when its `scope` is "tenant", never a
 *    platform-wide figure.
 *
 * Community totals and the member's own date only: nothing about any other
 * member. React lets a member close each card and remembers that in the
 * browser; these are short lines of text with no close control.
 */

const DAY_MS = 86400000;
const SHOW_FOR_DAYS = 7;
const MILESTONES = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

function dataFrom(payload) {
  return payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
}

/**
 * Same rule as React's anniversaryThisWeek, on calendar dates in UTC (the
 * server has no member time zone; React uses the browser's).
 */
function membershipAnniversary(joinedAt, { now = new Date(), t, locale = 'en-GB', community = '' } = {}) {
  if (!joinedAt || typeof t !== 'function') return null;
  const joined = new Date(joinedAt);
  if (Number.isNaN(joined.getTime())) return null;
  const year = now.getUTCFullYear();
  const anniversary = Date.UTC(year, joined.getUTCMonth(), joined.getUTCDate());
  if (year - joined.getUTCFullYear() < 1) return null;
  const today = Date.UTC(year, now.getUTCMonth(), now.getUTCDate());
  const daysSince = Math.round((today - anniversary) / DAY_MS);
  if (daysSince < 0 || daysSince >= SHOW_FOR_DAYS) return null;
  const date = joined.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return {
    title: String(t('dashboard.anniversary_title')),
    body: String(t('dashboard.anniversary_body', { community, date }))
  };
}

function communityAnniversary(payload, { t, tc, community = '' } = {}) {
  const data = dataFrom(payload);
  if (!data || typeof data !== 'object' || typeof t !== 'function' || typeof tc !== 'function') return null;
  const years = data.anniversary_years;
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 1) return null;
  return {
    title: String(tc('dashboard.community_birthday_title', years, { count: years, community })),
    body: String(t('dashboard.community_birthday_body'))
  };
}

function milestoneReached(hours) {
  if (typeof hours !== 'number' || !Number.isFinite(hours)) return null;
  let reached = null;
  for (const milestone of MILESTONES) {
    if (hours >= milestone) reached = milestone;
  }
  return reached;
}

function communityMilestone(payload, { t, locale = 'en-GB', community = '' } = {}) {
  const data = dataFrom(payload);
  if (!data || typeof data !== 'object' || typeof t !== 'function') return null;
  if (data.scope !== 'tenant') return null;
  const milestone = milestoneReached(Number(data.hours_exchanged ?? 0));
  if (!milestone) return null;
  const hours = milestone.toLocaleString(locale);
  return {
    title: String(t('dashboard.milestone_title', { hours })),
    body: String(t('dashboard.milestone_body', { community, hours }))
  };
}

module.exports = { membershipAnniversary, communityAnniversary, communityMilestone, milestoneReached, MILESTONES };
