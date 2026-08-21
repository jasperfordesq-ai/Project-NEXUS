// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn a thrown API error into something worth showing a member.
 *
 * 🔴 Why this exists. `ApiResponseError` already carries the server's own message —
 * `lib/api/client.ts` extracts it from `{ errors: [{ code, message }] }` — and the app
 * throws it away. The overwhelming majority of call sites are written as:
 *
 *     } catch {
 *       showToast({ title: t('errors.alertTitle'), description: t('somethingFailed') });
 *     }
 *
 * `catch {` with no binding cannot see the error at all, so a precise, actionable
 * sentence becomes "Could not log these hours."
 *
 * Measured on 2026-08-20: **186 such sites across 57 files.** Found by walking the
 * volunteering journey on two devices — logging hours failed and the app said only
 * "Could not log these hours", while the server had answered "You have already logged
 * hours for this organization and date". The member is told nothing and retries; the
 * information needed to stop them existed and was discarded.
 *
 * 🔴 This is deliberately NOT applied to all 186 sites in one sweep. Each one needs a
 * judgement about whether the server's wording is fit to show, and a blind replacement
 * across 57 files would be a large untested change. It is applied on the paths that have
 * actually been walked; the rest is recorded in PRODUCTION_READINESS.md §9.9 as a known
 * pattern with the helper ready.
 */

import { ApiResponseError } from '@/lib/api/client';

/**
 * Error codes whose server wording should NOT be shown as-is, because the app has a
 * better response than a sentence — a dedicated screen, or a specific instruction.
 * Keeping them here means a call site cannot leak internal phrasing by accident.
 */
const CODES_WITH_OWN_HANDLING = new Set([
  'ONBOARDING_REQUIRED',
  'LEGAL_ACCEPTANCE_REQUIRED',
  'UNAUTHENTICATED',
]);

/** The longest a server message may be before the fallback is used instead. */
const MAX_MESSAGE_LENGTH = 200;

/**
 * The server's explanation when there is a usable one, otherwise the caller's fallback.
 *
 * @param error    whatever was caught
 * @param fallback the translated, already-user-facing sentence to use when the server
 *                 gave nothing worth showing
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiResponseError)) return fallback;
  if (error.code && CODES_WITH_OWN_HANDLING.has(error.code)) return fallback;

  const message = error.message?.trim();
  if (!message) return fallback;

  // A 500's message is an internal failure description, never an instruction to a member.
  if (error.status >= 500) return fallback;
  // Guard against a stack trace or an HTML error page arriving as "the message".
  if (message.length > MAX_MESSAGE_LENGTH || message.includes('<')) return fallback;

  return message;
}
