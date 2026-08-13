// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Recent-activity and availability sections, shared by a member's OWN profile
 * (`/profile`) and another member's profile (`/members/:id`).
 *
 * 🔴 Extracted 2026-08-13 because the two had diverged: `/members/:id` rendered both
 * sections and `/profile` rendered NEITHER, while Blade's own-profile page
 * (profile.blade.php:406 and :484) shows both. So a member could see everyone's
 * recent activity and availability except their own — and could not tell what the
 * availability they had published actually looked like to other people.
 *
 * These mappers are the single source for that shaping. Do not re-inline them into a
 * route; that is exactly how the two pages drifted apart in the first place.
 */
const { getRequestIntlLocale } = require('./request-intl-locale');

function dataFrom(result) {
  return result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'data')
    ? result.data
    : result;
}

function boundedInteger(value, fallback, min = 0, max = 1000) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
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

const ACTIVITY_TAG_CLASSES = {
  post: 'govuk-tag--blue',
  comment: 'govuk-tag--blue',
  gave_hours: 'govuk-tag--green',
  received_hours: 'govuk-tag--turquoise',
  connection: 'govuk-tag--purple',
  event_rsvp: 'govuk-tag--yellow'
};

const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function profileAvailabilityFrom(result, t) {
  const data = dataFrom(result);
  const source = data && Array.isArray(data.weekly) ? data.weekly : (Array.isArray(data) ? data : []);
  return source.map((slot) => {
    const day = boundedInteger(slot.day_of_week ?? slot.dayOfWeek, -1, -1, 6);
    const specificDate = dateLabel(slot.specific_date || slot.specificDate);
    const start = String(slot.start_time || slot.startTime || '').slice(0, 5);
    const end = String(slot.end_time || slot.endTime || '').slice(0, 5);
    return {
      label: specificDate || (day >= 0 ? t(`profile.days.${DAY_KEYS[day]}`) : ''),
      time: start && end ? `${start} - ${end}` : '',
      note: String(slot.note || '').trim()
    };
  }).filter((slot) => slot.label || slot.time || slot.note).slice(0, 12);
}

function profileActivityFrom(result, t) {
  const data = dataFrom(result);
  const timeline = data && Array.isArray(data.timeline) ? data.timeline : [];
  const knownTypes = new Set(Object.keys(ACTIVITY_TAG_CLASSES));
  return timeline.map((item) => {
    const type = String(item.activity_type || item.activityType || 'post');
    return {
      type,
      label: knownTypes.has(type) ? t(`profile.activity_types.${type}`) : titleLabel(type),
      tagClass: ACTIVITY_TAG_CLASSES[type] || 'govuk-tag--grey',
      description: String(item.description || '').trim().slice(0, 160),
      date: dateLabel(item.created_at || item.createdAt)
    };
  }).slice(0, 30);
}

module.exports = { profileAvailabilityFrom, profileActivityFrom };
