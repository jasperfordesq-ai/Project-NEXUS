// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ApiErrorDetail } from '@/lib/api';
import { explainedApiError } from '@/lib/explained-api-error';

/** Refusal reasons this screen can explain itself when the server sends no message. */
export const KNOWN_REASONS = [
  'schedule_in_past',
  'post_event_too_early',
  'audience_empty',
  'channel_empty',
  'body_invalid',
  'version_conflict',
  'transition_invalid',
  'cancel_after_send_forbidden',
  'idempotency_conflict',
  'authorization_denied',
] as const;

export type BroadcastFailure =
  | { kind: 'explained'; message: string; conflict: boolean }
  | { kind: 'reason'; reason: (typeof KNOWN_REASONS)[number]; conflict: boolean }
  | { kind: 'conflict' }
  | { kind: 'rate_limited' }
  | { kind: 'timeout' }
  | { kind: 'drift' }
  | { kind: 'generic' };

interface FailedResponse {
  code?: string;
  errors?: ApiErrorDetail[];
}

export function isConflict(response: FailedResponse): boolean {
  return response.code === 'EVENT_BROADCAST_CONFLICT'
    || response.errors?.[0]?.code === 'EVENT_BROADCAST_CONFLICT';
}

/**
 * Order (E-106): the server's own translated explanation → this screen's line
 * for a known reason → a line for the kind of failure → a generic line.
 */
export function describeFailure(response: FailedResponse): BroadcastFailure {
  if (response.code === 'EVENTS_CONTRACT_DRIFT') return { kind: 'drift' };
  const conflict = isConflict(response);
  const explained = explainedApiError(response);
  if (explained) return { kind: 'explained', message: explained, conflict };
  const rawReason = response.errors?.[0]?.reason;
  if (typeof rawReason === 'string') {
    const reason = rawReason.replace(/^event_broadcast_/, '');
    const known = KNOWN_REASONS.find((candidate) => candidate === reason);
    if (known) return { kind: 'reason', reason: known, conflict };
  }
  if (conflict) return { kind: 'conflict' };
  if (response.code === 'rate_limited' || response.errors?.[0]?.code === 'rate_limited'
    || response.code === 'RATE_LIMITED') {
    return { kind: 'rate_limited' };
  }
  if (response.code === 'TIMEOUT') return { kind: 'timeout' };
  return { kind: 'generic' };
}
