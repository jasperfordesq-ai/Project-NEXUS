// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Strip auth material from Sentry payloads before they leave the device.
 *
 * These two hooks are the last thing between a member's bearer token and a
 * third-party service. They were inline callbacks inside `Sentry.init()` in
 * `app/_layout.tsx`, which meant the one piece of code in the app whose failure
 * would leak credentials had no test at all — and a silent failure here looks
 * exactly like success, because Sentry keeps working either way.
 *
 * A token can ride along in two places: a request header captured on an event, and
 * the `data` bag of a breadcrumb (the API client attaches request context there).
 * Both are handled.
 *
 * 🔴 Header names are matched CASE-INSENSITIVELY. The original deleted only
 * `Authorization`/`authorization` and `Cookie`/`cookie` by exact key, so a header
 * arriving as `AUTHORIZATION` — which HTTP permits, and which intermediaries do
 * produce — would have been sent verbatim.
 */

/** Header and data keys that must never leave the device. */
const SENSITIVE_KEYS = ['authorization', 'cookie', 'set-cookie', 'x-auth-token', 'proxy-authorization'];

function isSensitive(key: string): boolean {
  return SENSITIVE_KEYS.includes(key.toLowerCase());
}

/**
 * Delete sensitive keys from a plain object, in place, regardless of the case they
 * arrived in. Returns the number removed so callers can assert on it.
 */
function deleteSensitiveKeys(bag: Record<string, unknown>): number {
  let removed = 0;
  for (const key of Object.keys(bag)) {
    if (isSensitive(key)) {
      delete bag[key];
      removed += 1;
    }
  }
  return removed;
}

/**
 * Minimal shapes — deliberately NOT Sentry's own types, so these stay unit-testable
 * without importing the SDK.
 *
 * 🔴 No index signature. An `[key: string]: unknown` member looks harmless and makes
 * Sentry's concrete `ErrorEvent`/`Breadcrumb` types un-assignable ("Index signature
 * for type 'string' is missing"), so the hooks would not compile where they are
 * actually used.
 */
export interface ScrubbableEvent {
  request?: { headers?: Record<string, unknown> } | undefined;
}

export interface ScrubbableBreadcrumb {
  data?: Record<string, unknown> | undefined;
}

/**
 * `beforeSend`. Returns the same event object (Sentry expects the event back, and
 * returning null would drop the report entirely — we want the report, minus the
 * credentials).
 */
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const headers = event.request?.headers;
  if (headers && typeof headers === 'object') {
    deleteSensitiveKeys(headers as Record<string, unknown>);
  }
  return event;
}

/** `beforeBreadcrumb`. Same contract: return the breadcrumb, minus credentials. */
export function scrubSentryBreadcrumb<T extends ScrubbableBreadcrumb>(breadcrumb: T): T {
  const data = breadcrumb.data;
  if (data && typeof data === 'object') {
    deleteSensitiveKeys(data as Record<string, unknown>);
  }
  return breadcrumb;
}
