// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * "November in {community}": what everyone has shared so far this month, from
 * GET /api/v2/community/this-month (FeedSidebarController::thisMonth) — the
 * React dashboard's CommunityMonthHighlight, as a GOV.UK summary list (AWID
 * feedback, Nov 2026: "energy, warmth, and community").
 *
 * Community-wide totals only (hours shared, members who joined, offers and
 * requests posted); nothing about any one member. As in React, a figure that is
 * zero is left out, the offers row only shows while listings are on, and with
 * nothing to show there is no section at all.
 */

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * @returns {{ title: string, rows: Array<{ key: { text: string }, value: { text: string } }> } | null}
 */
function communityMonthHighlight(payload, { listings = true, locale = 'en-GB', t, community = '' } = {}) {
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object'
    ? payload.data
    : payload;
  if (!data || typeof data !== 'object' || typeof t !== 'function') return null;
  const month = /^(\d{4})-(\d{2})$/.exec(String(data.month || ''));
  if (!month) return null;

  const figures = [
    ['hours', positive(data.hours_shared)],
    ['members', positive(data.new_members)],
    ...(listings ? [['listings', positive(data.new_listings)]] : [])
  ].filter(([, value]) => value > 0);
  if (figures.length === 0) return null;

  const monthName = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1))
    .toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });
  const title = String(t('dashboard.month_highlight_title', { month: monthName, community }));
  return {
    // A heading starts with a capital even where month names do not ("novembre à …").
    title: title.charAt(0).toLocaleUpperCase(locale) + title.slice(1),
    rows: figures.map(([key, value]) => ({
      key: { text: t(`dashboard.month_highlight_${key}`) },
      value: { text: value.toLocaleString(locale, { maximumFractionDigits: 1 }) }
    }))
  };
}

module.exports = { communityMonthHighlight };
