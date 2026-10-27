// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Wall-clock times typed in an EVENT's own time zone, and the instants the API wants.
 *
 * 🔴 The event APIs do not convert a bare local `YYYY-MM-DDTHH:MM` any more. Every
 * organiser write that carries a time now requires seconds AND a zone
 * (`EventRegistrationFoundationSupport::inputInstant`, `EventSessionService::inputInstant`,
 * `EventTicketingSupport::inputInstant`, `ScheduleEventBroadcastRequest`), and refuses
 * an offset that does not match the event's own zone at that moment. The form fields
 * still post the wall clock the organiser typed, so the conversion happens here.
 *
 * Extracted from routes/event-organiser-tools.js (tickets, team) so every organiser
 * form converts the same way.
 */

function trimmed(value) {
  return String(value ?? '').trim();
}

/** A real IANA zone name, or 'UTC'. */
function safeTimeZone(value) {
  const zone = trimmed(value).slice(0, 64) || 'UTC';
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone }).format(new Date(0));
    return zone;
  } catch {
    return 'UTC';
  }
}

function zoneParts(epoch, timeZone) {
  // Numeric parts only (Latin digits), never shown to a member.
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    numberingSystem: 'latn',
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(epoch)).map((part) => [part.type, part.value]));
}

/** `YYYY-MM-DDTHH:MM` in the given zone for a stored instant, for prefilling a form. */
function wallClockInZone(iso, timeZone) {
  const epoch = Date.parse(trimmed(iso));
  if (!Number.isFinite(epoch)) return '';
  const parts = zoneParts(epoch, safeTimeZone(timeZone));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Epoch milliseconds of a wall clock in a zone, or null (malformed, or inside a clock-change gap). */
function wallClockEpoch(local, timeZone) {
  const zone = safeTimeZone(timeZone);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(trimmed(local));
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zoneParts(guess, zone);
    const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const next = target - (shown - guess);
    if (next === guess) break;
    guess = next;
  }
  if (wallClockInZone(new Date(guess).toISOString(), zone) !== trimmed(local)) return null;
  return guess;
}

/**
 * The UTC instant (`YYYY-MM-DDTHH:MM:SSZ`) of a wall-clock time typed in the event's
 * zone. For fields the API accepts as explicit UTC (`*_utc`). Null when the time does
 * not exist (inside a clock-change gap) or is malformed.
 */
function wallClockToUtc(local, timeZone) {
  const epoch = wallClockEpoch(local, timeZone);
  return epoch === null ? null : new Date(epoch).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The same wall clock with seconds and the event zone's own offset at that moment,
 * e.g. `2026-07-01T19:00:00+01:00` for Europe/Dublin. This is the shape the API's
 * offset check accepts for fields that are read in the event's zone. Null when the
 * time does not exist or is malformed.
 */
function wallClockToOffsetIso(local, timeZone) {
  const zone = safeTimeZone(timeZone);
  const epoch = wallClockEpoch(local, zone);
  if (epoch === null) return null;
  const parts = zoneParts(epoch, zone);
  const shown = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  const offsetMinutes = Math.round((shown - epoch) / 60000);
  const sign = offsetMinutes < 0 ? '-' : '+';
  const absolute = Math.abs(offsetMinutes);
  const pad = (n) => String(n).padStart(2, '0');
  return `${trimmed(local)}:00${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

module.exports = { safeTimeZone, zoneParts, wallClockInZone, wallClockToUtc, wallClockToOffsetIso };
