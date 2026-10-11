// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ApiErrorDetail } from './api';

/**
 * The server's own, translated explanation of a refusal, or null.
 *
 * The events API attaches a `reason` to an error only when its `message`
 * says specifically what is wrong (a date without the event's offset, a
 * cancellation deadline that has passed). Other refusals carry a generic
 * message, so callers keep their own, more helpful, local fallback for those.
 */
export function explainedApiError(
  response: { errors?: ApiErrorDetail[] } | null | undefined,
): string | null {
  const first = response?.errors?.[0];
  if (!first || typeof first.reason !== 'string') return null;
  const message = typeof first.message === 'string' ? first.message.trim() : '';

  return message === '' ? null : message;
}
