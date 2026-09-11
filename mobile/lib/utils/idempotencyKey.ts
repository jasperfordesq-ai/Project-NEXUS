// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One id per movement of credits the member confirms.
 *
 * 🔴 Why this is shared rather than copied. An idempotency key only protects a member if
 * it is generated ONCE per intended movement and reused across retries — a key minted per
 * button press protects nothing, because the retry carries a different one and the server
 * books a second transfer. That discipline lives at the call site; this file exists so the
 * key itself is made the same way everywhere, and so a new money screen has something
 * obvious to reach for instead of `Date.now()`.
 *
 * Random rather than derived from the amount and recipient: two genuinely separate
 * transfers that happen to look identical must both go through.
 *
 * Call sites include credit movements, job and job-alert creation, and volunteer
 * organisation registration. Each call site owns the content/attempt lifetime.
 */
export function mutationIdempotencyKey(prefix = 'mobile-mutation'): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
