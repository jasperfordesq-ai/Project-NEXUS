// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reading and writing the typed date fields this app uses.
 *
 * 🔴 Why they are typed at all. The web forms use `<input type="datetime-local">`, which
 * always hands over `YYYY-MM-DDTHH:MM`. A phone has no such control and this app has no
 * native date picker — adding one is a native dependency, and therefore a new store build,
 * which several of these screens do not otherwise need. So members type the value, and the
 * app's job is to make that safe: one accepted shape, checked before anything is sent, and
 * a refusal that says what was wrong.
 *
 * 🔴 `new Date('2026-09-08 18:30')` is implementation-defined and Hermes and V8 disagree
 * about it, so the space is normalised to `T` before parsing. That single line is the
 * difference between a slot saved at the right time and one saved an hour out, or not at
 * all. The rule was discovered in the podcast studio; this module is where it lives now so
 * the marketplace forms cannot rediscover it the hard way.
 */

/** `YYYY-MM-DD HH:MM` or `YYYY-MM-DDTHH:MM`, with optional seconds. */
const DATE_TIME_SHAPE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;
/** `YYYY-MM-DD`. */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A typed local date-and-time as an ISO instant, or null when it is not a date at all.
 *
 * Null covers both "wrong shape" (`next Tuesday`, `12/09/2026`) and "right shape, not a
 * real date" (`2026-02-31`), because a caller has to refuse both the same way.
 */
export function parseLocalDateTimeInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !DATE_TIME_SHAPE.test(trimmed)) return null;
  const date = new Date(trimmed.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return null;
  // `2026-02-31T10:00` parses in some engines by rolling into March. A date that rolled is
  // not the date the member typed, so it is refused rather than quietly moved.
  const [datePart] = trimmed.split(/[T ]/);
  if (formatLocalDateInput(date.toISOString()) !== datePart) return null;
  return date.toISOString();
}

/** A typed local date (no time) as an ISO instant at local midnight, or null. */
export function parseLocalDateInput(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !DATE_SHAPE.test(trimmed)) return null;
  return parseLocalDateTimeInput(`${trimmed} 00:00`);
}

/** Local `YYYY-MM-DD HH:MM` for an editor field, from whatever the API stored. */
export function formatLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
  return local.toISOString().slice(0, 16).replace('T', ' ');
}

/** Local `YYYY-MM-DD` for an editor field. */
export function formatLocalDateInput(value: string | null | undefined): string {
  return formatLocalDateTimeInput(value).slice(0, 10);
}

/**
 * A round-hour starting point for a quick-fill button: the next whole hour, `daysAhead`
 * days from now, as `YYYY-MM-DD HH:MM` in the member's own time zone.
 *
 * Quick fill is the point of this module for the member: the commonest pickup slot is
 * "later today" or "tomorrow morning", and typing sixteen characters for it invites the
 * typo the validation then has to refuse.
 */
export function nextWholeHourInput(daysAhead = 0, now: Date = new Date()): string {
  const start = new Date(now.getTime());
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  start.setDate(start.getDate() + daysAhead);
  return formatLocalDateTimeInput(start.toISOString());
}

/** `input` shifted by whole hours, keeping the same `YYYY-MM-DD HH:MM` shape. */
export function addHoursToInput(input: string, hours: number): string {
  const iso = parseLocalDateTimeInput(input);
  if (!iso) return input;
  return formatLocalDateTimeInput(new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString());
}
