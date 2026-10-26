// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, getMunicipalityCalendar } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

/**
 * Municipality events calendar (React `municipality-calendar`): events every
 * federated club in one municipality has agreed to share, a month at a time.
 *
 * React draws a month grid; here the same month is a list of days that have
 * events, which reads in order for a screen reader and needs no JavaScript.
 * Gated on `caring_community` (tenant-feature-gates.js), as React and Laravel are.
 */

const CODE_PATTERN = /^[A-Za-z0-9 _-]{1,32}$/;

function trimmed(value, limit = 64) {
  return String(value ?? '').trim().slice(0, limit);
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function monthFrom(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed(value));
  const now = new Date();
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12) return { year, month };
  }
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function shiftMonth({ year, month }, delta) {
  const index = (year * 12) + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function monthKey({ year, month }) {
  return `${year}-${pad(month)}`;
}

function firstDay({ year, month }) {
  return `${year}-${pad(month)}-01`;
}

function bucketsFrom(data) {
  const buckets = data && data.buckets;
  if (!buckets || typeof buckets !== 'object' || Array.isArray(buckets)) return [];
  return Object.keys(buckets)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(buckets[date]) && buckets[date].length)
    .sort()
    .map((date) => ({ date, events: buckets[date] }));
}

router.get('/', asyncRoute(async (req, res) => {
  const t = res.locals.t;
  const code = trimmed(req.query.code, 32);
  const validCode = CODE_PATTERN.test(code) ? code : '';
  const month = monthFrom(req.query.month);
  const next = shiftMonth(month, 1);
  const previous = shiftMonth(month, -1);

  let days = [];
  let loadFailed = false;
  if (validCode) {
    try {
      const result = await getMunicipalityCalendar(validCode, firstDay(month), firstDay(next));
      const data = result && result.data && typeof result.data === 'object' ? result.data : result;
      days = bucketsFrom(data).map(({ date, events }) => ({
        date,
        label: res.locals.formatLocaleDate(`${date}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' }),
        events: events.map((event) => ({
          id: Number(event && event.id) || 0,
          title: trimmed(event && event.title, 255),
          organisation: trimmed(event && event.organization_name, 255),
          time: trimmed(event && event.start_time, 32)
            ? res.locals.formatLocaleDate(event.start_time, { day: undefined, month: undefined, year: undefined, hour: '2-digit', minute: '2-digit' })
            : ''
        }))
      }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      loadFailed = true;
    }
  }

  const codeQuery = validCode ? `code=${encodeURIComponent(validCode)}&` : '';
  return res.render('municipality-calendar/index', {
    title: t('govuk_alpha_events.municipality_calendar.title'),
    activeNav: 'events',
    code,
    validCode,
    invalidCode: code !== '' && !validCode,
    monthLabel: res.locals.formatLocaleDate(`${firstDay(month)}T12:00:00Z`, { day: undefined, month: 'long', year: 'numeric' }),
    previousHref: `/municipality-calendar?${codeQuery}month=${monthKey(previous)}`,
    nextHref: `/municipality-calendar?${codeQuery}month=${monthKey(next)}`,
    days,
    loadFailed
  });
}));

module.exports = router;
