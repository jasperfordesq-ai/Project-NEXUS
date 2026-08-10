// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, getPublicEvents, getPublicEvent } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { flagEnabled } = require('../lib/accessible-shell');
const { formatLocaleDate, localeForIntl } = require('../lib/localization');

const router = express.Router();

const WHEN_OPTIONS = Object.freeze(['upcoming', 'past', 'all']);
const PER_PAGE = 20;

/**
 * Gate parity with the Blade controller (PublicEventsParity): BOTH the `events`
 * and `public_events` tenant features must be on, and a disabled page answers
 * 404 rather than 403.
 *
 * The 404 is deliberate and must not be "corrected" to 403: a public page that
 * admits it exists but is forbidden invites probing for tenants that have
 * turned public advertising off. This is gated here, in the handler, rather
 * than in the shared FEATURE_ROUTE_GATES table, because that table renders 403
 * and carries one feature key per entry.
 */
function whatsOnEnabled(req) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') return true;
  return flagEnabled(tenant, 'events', 'features', true)
    && flagEnabled(tenant, 'public_events', 'features', true);
}

function notFound(res) {
  return res.status(404).render('errors/404', {
    title: res.locals.t('govuk_alpha_whats_on.index.title')
  });
}

function allowed(value, options, fallback) {
  const candidate = typeof value === 'string' ? value : '';
  return options.includes(candidate) ? candidate : fallback;
}

/**
 * Blade renders event times with `translatedFormat('j F Y, g:ia')` — or
 * `'j F Y'` for an all-day event — after `setTimezone($event['timezone'] ?: 'UTC')`.
 *
 * Two details are easy to lose and both change what a visitor reads:
 *   - the timezone comes from the EVENT, not the server or the viewer, so a
 *     listing shows the time the event actually starts where it is held;
 *   - an all-day event must not print a time at all, or every all-day entry
 *     reads as starting at midnight.
 *
 * `g:ia` is a lowercase am/pm with no separating space, so the day period is
 * lowercased and joined directly — the same shaping the shared
 * `formatBladeDateTime` Nunjucks filter performs for authenticated pages.
 */
function formatEventMoment(value, locale, timezone, allDay) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const timeZone = typeof timezone === 'string' && timezone.trim() !== '' ? timezone.trim() : 'UTC';
  const dateOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone };

  try {
    if (allDay) {
      return formatLocaleDate(date, locale, dateOptions);
    }

    const parts = new Intl.DateTimeFormat(localeForIntl(locale), {
      ...dateOptions,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    }).formatToParts(date);
    const value_ = (type) => parts.find((part) => part.type === type)?.value || '';
    const dayPeriod = value_('dayPeriod').replace(/\s+/g, '').toLocaleLowerCase(localeForIntl(locale));
    return `${value_('day')} ${value_('month')} ${value_('year')}, ${value_('hour')}:${value_('minute')}${dayPeriod}`;
  } catch {
    // An unknown IANA zone must not take the page down; fall back to the
    // date-only label rather than rendering nothing.
    return formatLocaleDate(date, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  }
}

router.get('/', asyncRoute(async (req, res) => {
  if (!whatsOnEnabled(req)) return notFound(res);

  const when = allowed(req.query.when, WHEN_OPTIONS, 'upcoming');
  const search = String(req.query.q ?? '').trim();
  const cursor = String(req.query.cursor ?? '').trim();

  const params = { per_page: PER_PAGE, when };
  if (search !== '') params.q = search;
  if (cursor !== '') params.cursor = cursor;

  let result;
  try {
    result = await getPublicEvents(params);
  } catch (error) {
    // Parity with the Blade controller's ValidationException catch: a garbled
    // cursor is a fresh first page, not an error page. Only a rejected cursor
    // is recovered this way — any other failure still surfaces.
    if (error instanceof ApiError && error.status === 422 && params.cursor) {
      const withoutCursor = { ...params };
      delete withoutCursor.cursor;
      result = await getPublicEvents(withoutCursor);
    } else {
      throw error;
    }
  }

  const meta = result?.meta && typeof result.meta === 'object' ? result.meta : {};
  const locale = res.locals.locale || 'en';
  const events = (Array.isArray(result?.data) ? result.data : []).map((event) => ({
    ...event,
    whenLabel: formatEventMoment(event?.start_time, locale, event?.timezone, Boolean(event?.all_day))
  }));

  return res.render('whats-on/index', {
    title: res.locals.t('govuk_alpha_whats_on.index.title'),
    activeNav: 'whats_on',
    events,
    when,
    whenOptions: WHEN_OPTIONS,
    search,
    // Blade publishes a next cursor only when the API says more remain.
    nextCursor: meta.has_more ? (meta.cursor || null) : null
  });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  if (!whatsOnEnabled(req)) return notFound(res);

  // Blade constrains the segment with whereNumber, so a non-numeric id is a
  // routing miss there rather than an API call. Match that.
  if (!/^\d+$/.test(String(req.params.id))) return notFound(res);

  let result;
  try {
    result = await getPublicEvent(req.params.id);
  } catch (error) {
    // The API answers 404 both for "no such event" and "not publicly
    // visible", so this page cannot be used to probe for private or draft
    // events. Keep those two indistinguishable.
    if (error instanceof ApiError && error.status === 404) return notFound(res);
    throw error;
  }

  const event = result?.data && typeof result.data === 'object' ? result.data : result;
  if (!event || typeof event !== 'object') return notFound(res);

  const locale = res.locals.locale || 'en';
  const allDay = Boolean(event.all_day);

  return res.render('whats-on/detail', {
    title: res.locals.t('govuk_alpha_whats_on.show.title'),
    activeNav: 'whats_on',
    event,
    startsAt: formatEventMoment(event.start_time, locale, event.timezone, allDay),
    endsAt: formatEventMoment(event.end_time, locale, event.timezone, allDay)
  });
}));

module.exports = router;
