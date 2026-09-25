// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Project NEXUS is for adults only (owner decision, 25 September 2026).
 *
 * The server refuses sign-in, and every request from an existing session, for
 * an account whose recorded date of birth is under 18, and refuses to record a
 * date of birth under 18. These are the stable codes it uses, and the one rule
 * the frontend applies itself: a date picker never offers a date of birth that
 * would make the member younger than the minimum age.
 */

export const MINIMUM_AGE = 18;

/** 403 on sign-in, and on any authenticated request, for an under-18 account. */
export const ACCOUNT_UNDER_MINIMUM_AGE = 'ACCOUNT_UNDER_MINIMUM_AGE';

/** 422 (field `date_of_birth`) when a date of birth under 18 is submitted. */
export const DATE_OF_BIRTH_UNDER_MINIMUM_AGE = 'DATE_OF_BIRTH_UNDER_MINIMUM_AGE';

interface ErrorLike {
  code?: string;
  message?: string;
}

/**
 * The server's own translated explanation for a refusal with `code`, when it
 * sent one. Callers fall back to their own translated wording otherwise; the
 * generic envelope `error` is deliberately not used, because the API client
 * fills it with a "request failed" placeholder when the server sent no text.
 */
export function serverMessageFor(
  errors: readonly ErrorLike[] | undefined,
  code: string,
): string | undefined {
  const message = errors?.find((error) => error?.code === code)?.message;
  return typeof message === 'string' && message.trim() !== '' ? message : undefined;
}

/**
 * The latest date of birth an adult can have today, as `YYYY-MM-DD` in the
 * member's local calendar. A member born on this day turns 18 today. On
 * 29 February, when that date does not exist 18 years earlier, the latest date
 * is 28 February (never 1 March, which would admit someone a day too young).
 */
export function latestAdultDateOfBirth(today: Date = new Date()): string {
  const year = today.getFullYear() - MINIMUM_AGE;
  let latest = new Date(year, today.getMonth(), today.getDate());
  if (latest.getMonth() !== today.getMonth()) {
    latest = new Date(year, today.getMonth() + 1, 0);
  }
  const month = String(latest.getMonth() + 1).padStart(2, '0');
  const day = String(latest.getDate()).padStart(2, '0');
  return `${latest.getFullYear()}-${month}-${day}`;
}
