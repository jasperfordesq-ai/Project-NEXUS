// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { dateLocale } from './dateLocale';

export interface EventScheduleIdentity {
  start_at: string | null;
  end_at: string | null;
  timezone: string;
  all_day: boolean;
}

export interface FormattedEventSchedule {
  allDay: boolean;
  dateLabel: string | null;
  startDateLabel: string | null;
  endDateLabel: string | null;
  timeLabel: string | null;
  monthLabel: string | null;
  dayLabel: string | null;
  weekdayLabel: string | null;
}

interface ZonedDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedDateTimeParts {
  // locale-exempt: machine format, never displayed. 'en-CA' is chosen because
  // it yields zero-padded YYYY-MM-DD parts, which are read structurally below
  // for timezone arithmetic. A member-facing locale here would break
  // eventIsoToLocalInput / eventLocalInputToIso.
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

export function localEventTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return safeTimeZone(timeZone || 'UTC');
}

export function eventIsoToLocalInput(value: string | null | undefined, timeZone: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    const parts = zonedParts(date, timeZone);
    return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

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
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const rendered = zonedParts(new Date(candidate), timeZone);
      candidate -= Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
      ) - wallClockAsUtc;
    }
    const roundTrip = zonedParts(new Date(candidate), timeZone);
    if (roundTrip.year !== desired.year
      || roundTrip.month !== desired.month
      || roundTrip.day !== desired.day
      || roundTrip.hour !== desired.hour
      || roundTrip.minute !== desired.minute) {
      return null;
    }

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
    return candidates.size === 1 ? new Date(candidate).toISOString() : null;
  } catch {
    return null;
  }
}

export function shiftEventLocalDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeTimeZone(timeZone: string): string {
  try {
    // locale-exempt: validity probe for the IANA zone; output is discarded.
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function formatEventSchedule(
  schedule: EventScheduleIdentity,
  // Defaults to the app's own locale so a caller cannot accidentally supply a
  // bare language code, which would format as US English. Production callers
  // pass nothing; tests pass an explicit tag to keep timezone assertions
  // deterministic.
  locale: string = dateLocale(),
): FormattedEventSchedule {
  const start = validDate(schedule.start_at);
  const end = validDate(schedule.end_at);
  const timeZone = safeTimeZone(schedule.timezone);
  if (!start) {
    return {
      allDay: schedule.all_day,
      dateLabel: null,
      startDateLabel: null,
      endDateLabel: null,
      timeLabel: null,
      monthLabel: null,
      dayLabel: null,
      weekdayLabel: null,
    };
  }

  // locale-exempt: `locale` is the parameter above, which defaults to
  // dateLocale(). The three formatters in this function all read it.
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
  const startDateLabel = dateFormatter.format(start);
  // locale-exempt: see the dateFormatter above.
  const calendarParts = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone,
  }).formatToParts(start);
  const part = (type: 'month' | 'day' | 'weekday'): string | null => (
    calendarParts.find((item) => item.type === type)?.value ?? null
  );

  if (schedule.all_day) {
    // All-day end_at is exclusive. One millisecond before the boundary lands
    // on the final local calendar day even when a DST transition changes its
    // UTC offset, unlike subtracting a fixed 24 hours.
    const inclusiveEnd = end && end.getTime() > start.getTime()
      ? new Date(end.getTime() - 1)
      : null;
    const endDateLabel = inclusiveEnd ? dateFormatter.format(inclusiveEnd) : null;
    const visibleEnd = endDateLabel && endDateLabel !== startDateLabel ? endDateLabel : null;

    return {
      allDay: true,
      dateLabel: visibleEnd ? `${startDateLabel} – ${visibleEnd}` : startDateLabel,
      startDateLabel,
      endDateLabel: visibleEnd,
      timeLabel: null,
      monthLabel: part('month'),
      dayLabel: part('day'),
      weekdayLabel: part('weekday'),
    };
  }

  // locale-exempt: see the dateFormatter above.
  const timeLabel = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  }).format(start);

  return {
    allDay: false,
    dateLabel: startDateLabel,
    startDateLabel,
    endDateLabel: end ? dateFormatter.format(end) : null,
    timeLabel,
    monthLabel: part('month'),
    dayLabel: part('day'),
    weekdayLabel: part('weekday'),
  };
}
