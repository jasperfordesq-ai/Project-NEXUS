// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  // locale-exempt: machine format, never displayed. 'en-CA' is chosen because it
  // yields zero-padded YYYY-MM-DD parts for the arithmetic below; the parts are
  // read structurally via formatToParts, so a member-facing locale here would
  // break eventIsoToLocalInput/eventLocalInputToIso.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)])) as Partial<ZonedDateTimeParts>;

  return {
    year: values.year ?? 0,
    month: values.month ?? 0,
    day: values.day ?? 0,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  };
}

/** Format an absolute instant as a browser datetime-local value in an IANA zone. */
export function eventIsoToLocalInput(value: string | null, timeZone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  let parts: ZonedDateTimeParts;
  try {
    parts = zonedParts(date, timeZone);
  } catch {
    return '';
  }
  if (!parts.year || !parts.month || !parts.day) return '';

  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

/**
 * Resolve a browser datetime-local wall clock in an IANA zone to an instant.
 * DST gaps and other non-round-trippable local times fail closed.
 */
export function eventLocalInputToIso(value: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const desired = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
  };
  const wallClockAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  let candidate = wallClockAsUtc;
  let roundTrip: ZonedDateTimeParts;
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const rendered = zonedParts(new Date(candidate), timeZone);
      const renderedAsUtc = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
      );
      candidate -= renderedAsUtc - wallClockAsUtc;
    }
    roundTrip = zonedParts(new Date(candidate), timeZone);
  } catch {
    return null;
  }
  if (roundTrip.year !== desired.year
    || roundTrip.month !== desired.month
    || roundTrip.day !== desired.day
    || roundTrip.hour !== desired.hour
    || roundTrip.minute !== desired.minute) {
    return null;
  }

  // A fall-back transition can map one wall clock to two distinct instants.
  // Sample both sides of the transition, derive each observed UTC offset, and
  // reject the input unless exactly one candidate round-trips.
  const offsets = new Set<number>();
  for (const probe of [candidate - 36 * 60 * 60 * 1000, candidate, candidate + 36 * 60 * 60 * 1000]) {
    const rendered = zonedParts(new Date(probe), timeZone);
    offsets.add(Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    ) - probe);
  }
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const instant = wallClockAsUtc - offset;
    const rendered = zonedParts(new Date(instant), timeZone);
    if (rendered.year === desired.year
      && rendered.month === desired.month
      && rendered.day === desired.day
      && rendered.hour === desired.hour
      && rendered.minute === desired.minute) {
      candidates.add(instant);
    }
  }
  if (candidates.size !== 1) return null;

  return new Date(candidate).toISOString();
}
