// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * schema.org Event structured data for a public event page (/whats-on/:id).
 *
 * Written to Google's Event rich-result requirements (2026-10-23 SEO audit).
 * Until then the page emitted `"name": ""` for an untitled event, a timestamp
 * with no offset when the server sent one, a relative image address, an online
 * location with no `url` (required for VirtualLocation), an online event's
 * location named after the community, and the organising member's first name
 * as an "Organization". Every field is now either valid or left out: Google
 * reports an empty or malformed value as an error, an absent optional one only
 * as a missed enhancement.
 */

import type { PublicEventDetail } from '@/lib/public-events-api';

export interface EventStructuredDataContext {
  /** Absolute address of this event page (the canonical). */
  pageUrl: string;
  /** Absolute address of the event's picture, if it has one. */
  imageUrl?: string;
  /** The community running the platform the event is published on. */
  organizer: { name: string; url: string };
}

/** Whole-hour/minute UTC offset of a zone at an instant, as "+01:00". */
function zoneOffset(instant: Date, timeZone: string): string | null {
  try {
    // locale-exempt: machine format, never displayed. 'en-US' with numeric
    // parts and h23 is read back by part type to compute the zone's UTC
    // offset for schema.org dates; no member sees this output.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const minutes = Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
    const sign = minutes < 0 ? '-' : '+';
    const abs = Math.abs(minutes);
    return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

/**
 * Parse the server's timestamp. Event times are stored in UTC; a value with no
 * zone designator ("2026-12-14 18:00:00") is therefore UTC, not browser-local.
 */
function parseUtc(value: string | null | undefined): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  let iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(iso)) iso = `${iso}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * ISO 8601 in the event's own time zone with its offset
 * ("2026-12-14T18:00:00+00:00"), or the calendar date for an all-day event.
 * Falls back to UTC ("…Z") when the zone is unknown or invalid.
 */
export function eventDateTime(value: string | null | undefined, timeZone: string | null | undefined, allDay = false): string | undefined {
  const instant = parseUtc(value);
  if (!instant) return undefined;
  const zone = timeZone?.trim() || 'UTC';
  const offset = zoneOffset(instant, zone);
  if (offset === null) {
    return allDay ? instant.toISOString().slice(0, 10) : instant.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const sign = offset.startsWith('-') ? -1 : 1;
  const [h, m] = offset.slice(1).split(':').map(Number);
  const local = new Date(instant.getTime() + sign * ((h ?? 0) * 60 + (m ?? 0)) * 60000);
  const localIso = local.toISOString();
  if (allDay) return localIso.slice(0, 10);
  return `${localIso.slice(0, 19)}${offset}`;
}

/** Organiser text is plain text (the page shows it as text), so only tidy spacing. */
function plainText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

const ATTENDANCE_MODE = {
  in_person: 'https://schema.org/OfflineEventAttendanceMode',
  online: 'https://schema.org/OnlineEventAttendanceMode',
  hybrid: 'https://schema.org/MixedEventAttendanceMode',
} as const;

const EVENT_STATUS: Record<string, string> = {
  cancelled: 'https://schema.org/EventCancelled',
  postponed: 'https://schema.org/EventPostponed',
};

/**
 * The Event JSON-LD object, or null when the event lacks what Google requires
 * (a name and a start date) — no block is better than an invalid one.
 */
export function buildEventStructuredData(
  event: PublicEventDetail,
  context: EventStructuredDataContext,
): Record<string, unknown> | null {
  const name = plainText(event.title);
  const startDate = eventDateTime(event.start_time, event.timezone, event.all_day);
  if (!name || !startDate) return null;

  const endDate = eventDateTime(event.end_time, event.timezone, event.all_day);
  const mode = ATTENDANCE_MODE[event.attendance_mode] ? event.attendance_mode : 'in_person';
  const venue = plainText(event.location);

  const place = venue
    ? {
        '@type': 'Place',
        name: venue,
        address: venue,
        ...(typeof event.latitude === 'number' && typeof event.longitude === 'number'
          && Number.isFinite(event.latitude) && Number.isFinite(event.longitude)
          && !(event.latitude === 0 && event.longitude === 0)
          ? { geo: { '@type': 'GeoCoordinates', latitude: event.latitude, longitude: event.longitude } }
          : {}),
      }
    : null;
  // The joining link is private (members only), so the online location is the
  // public event page, which is where a visitor learns how to take part.
  const virtual = { '@type': 'VirtualLocation', url: context.pageUrl };

  const locations = mode === 'online'
    ? [virtual]
    : mode === 'hybrid'
      ? [place, virtual].filter(Boolean)
      : [place].filter(Boolean);

  const description = plainText(event.description);

  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name,
    url: context.pageUrl,
    startDate,
    ...(endDate ? { endDate } : {}),
    eventStatus: EVENT_STATUS[event.operational_status] ?? 'https://schema.org/EventScheduled',
    eventAttendanceMode: ATTENDANCE_MODE[mode],
    ...(locations.length === 1 ? { location: locations[0] } : locations.length > 1 ? { location: locations } : {}),
    ...(context.imageUrl ? { image: [context.imageUrl] } : {}),
    ...(description ? { description } : {}),
    ...(context.organizer.name && context.organizer.url
      ? { organizer: { '@type': 'Organization', name: context.organizer.name, url: context.organizer.url } }
      : {}),
  };
}
