// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// REPORTING — one call, two destinations, neither of which can be silently off
//
// 🔴 The problem this solves, measured 2026-08-19. The app produced 13 different
// kinds of diagnostic — a crash boundary, push-registration failures, an
// unexpected feed shape, and ten API "contract drift" warnings — and every one
// of them went to Sentry alone. Sentry is disabled in ALL SIX build profiles
// (`EXPO_PUBLIC_SENTRY_DSN` appears in none of them), so every one of those
// reports went precisely nowhere.
//
// It was worse than a missing account. `lib/env.ts` announces "crash reporting is
// disabled" through `note()`, which is silent unless __DEV__ — so in a real
// release build the app did not even say that it had no way to tell anyone
// anything. The one warning about the missing warnings was itself suppressed.
//
// So this sends to BOTH:
//
//   1. Sentry, if a DSN was ever supplied. Harmless no-op when it was not.
//   2. Our own API — `POST /api/app/log`, which already existed, is rate-limited
//      server-side, and writes at warning level into the Laravel log where PHP
//      Sentry IS enabled and IS triaged nightly.
//
// Destination 2 is the point: it needs no account, no DSN, and no action from
// anyone. A crash on a member's phone reaches the owner's server log today.
//
// 🔴 Never route this through `lib/api/client.ts`. That module reports failures,
// and reporting a failure through the thing that failed is how you turn one
// error into a loop. Raw fetch, no retries, no throwing.
// ---------------------------------------------------------------------------

import * as Sentry from '@sentry/react-native';

import { API_BASE_URL, APP_VERSION, DEFAULT_TENANT, STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';
import { registerReporter } from './reportSink';

/** Context attached to a report. Values are stringified and scrubbed. */
export type ReportContext = Record<string, unknown>;

/**
 * Budgets. A diagnostic that floods the API is worse than one that is lost: it
 * would rate-limit the member's real requests and bury the signal it carries.
 *
 * Contract-drift warnings in particular can fire on EVERY response from an
 * affected endpoint, so deduplication is not an optimisation here — without it a
 * single drifted endpoint would post on every scroll.
 */
const MAX_REPORTS_PER_SESSION = 20;
const MIN_INTERVAL_MS = 2_000;

let sentThisSession = 0;
let lastSentAt = 0;
const seenKeys = new Set<string>();

/**
 * Values that must never leave the device, matched against string content.
 *
 * 🔴 The deep-link case is the reason this exists. `navigateToLink` reported
 * `[DeepLink] Unhandled link: ${link}` with the WHOLE url — and one of the links
 * this app handles is a password-reset link, whose token is in the url. That
 * would have put a live credential into a third-party service.
 */
/**
 * 🔴 Two FAMILIES, handled differently, and conflating them was a real bug caught by
 * this module's own tests. A single replacement of the form `${name}=[redacted]` — where
 * `name` was the text before the first `=` or space — works for `token=abc` but is
 * actively harmful for a bare JWT: a JWT contains neither `=` nor a space, so `name`
 * became the entire token and the output was `eyJhbGci…sig=[redacted]`. The credential
 * survived, with a redaction marker glued to it, which is worse than no scrubbing at all
 * because it looks handled.
 */

/** `key=value` — keep the key, so the report still says WHAT was redacted. */
const KEYED_SECRET_PATTERNS: readonly RegExp[] = [
  /\b(token|secret|password|passwd|pwd|otp|code|signature|key|api[_-]?key|auth)=[^&\s]+/gi,
];

/** Standalone credentials — the whole match goes, because none of it is safe. */
const BARE_SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  // A JWT, wherever it appears — including with no surrounding key.
  /\beyJ[A-Za-z0-9._-]{10,}/g,
];

/** Removes anything that looks like a credential, and caps length. */
export function scrubForReport(value: string): string {
  let out = value;

  for (const pattern of KEYED_SECRET_PATTERNS) {
    out = out.replace(pattern, (_match, key: string) => `${key}=[redacted]`);
  }

  for (const pattern of BARE_SECRET_PATTERNS) {
    out = out.replace(pattern, '[redacted]');
  }

  return out.slice(0, 500);
}

/**
 * Reduces a URL to something safe to report: origin plus the FIRST path segment.
 *
 * Anything more can carry an identifier or a token. Knowing that "an unhandled
 * link to /volunteering arrived" is the useful part; the rest is risk.
 */
export function safeLinkSummary(link: string): string {
  const withoutQuery = link.split(/[?#]/)[0] ?? '';
  const match = withoutQuery.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]+)?\/?([^/]*)/i);
  const host = match?.[1] ?? '';
  const firstSegment = match?.[2] ?? '';
  return scrubForReport(`${host}/${firstSegment}`);
}

/** Whether this report should be sent, updating the budget if so. */
function admit(key: string, now: number): boolean {
  if (seenKeys.has(key)) return false;
  if (sentThisSession >= MAX_REPORTS_PER_SESSION) return false;
  if (now - lastSentAt < MIN_INTERVAL_MS) return false;

  seenKeys.add(key);
  sentThisSession += 1;
  lastSentAt = now;
  return true;
}

/**
 * 🔴 A test run must never post to the real API, and it was doing exactly that.
 *
 * `postToServer` uses raw `fetch` by design (see the header note), and under Jest
 * `fetch` is a working global while `API_BASE_URL` still points at production. So
 * `ErrorBoundary.test.tsx` — which deliberately throws `render exploded` seven
 * times and mocks only `@sentry/react-native` — sent seven unauthenticated POSTs
 * to `https://api.project-nexus.ie/api/app/log` on every run, from developer
 * machines AND from GitHub Actions runners. 77 fake crashes reached the owner's
 * production error log in three days, one group escalating, burying real reports.
 *
 * Gating on the runner rather than on `NODE_ENV`, because `JEST_WORKER_ID` is set
 * by Jest itself and cannot be inherited from a stray shell variable. The one
 * suite that legitimately exercises the sender opts back in explicitly, so the
 * guard cannot quietly disable the tests that prove reporting works.
 */
function isTestRunner(): boolean {
  return typeof process !== 'undefined' && process.env?.JEST_WORKER_ID !== undefined;
}

let serverReportsAllowedInTests = false;

/**
 * Test-only: permit `postToServer` to run under Jest. Only `report.test.ts`
 * should call this, and only with a mocked `global.fetch`.
 */
export function __allowServerReportsForTests(allow = true): void {
  serverReportsAllowedInTests = allow;
}

/**
 * Post to our own API. Fire-and-forget: no await at the call site, no retry, and
 * every failure swallowed. This is diagnostics — it must never be able to affect
 * what the member is doing, or to become the error it is trying to report.
 */
async function postToServer(event: string, context: ReportContext): Promise<void> {
  if (isTestRunner() && !serverReportsAllowedInTests) return;

  try {
    // 🔴 Guarded, because one of the things being reported is storage FAILING. If a
    // broken read could throw out of this function, storage errors would be the single
    // class of problem that can never be reported. A default rather than an abort: the
    // report matters more than the tenant tag.
    //
    // Note this import is one-way now. storage.ts does NOT import this module — it goes
    // through `reportSink`, which imports nothing — so there is no cycle to work around
    // and no need for the dynamic import that silently broke under Jest.
    let tenant = DEFAULT_TENANT;
    try {
      tenant = (await storage.get(STORAGE_KEYS.TENANT_SLUG)) || DEFAULT_TENANT;
    } catch {
      // Keep the default and carry on.
    }

    const safeContext: Record<string, string> = {};
    for (const [k, v] of Object.entries(context)) {
      safeContext[k] = scrubForReport(typeof v === 'string' ? v : safeStringify(v));
    }

    await fetch(`${API_BASE_URL}/api/app/log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Tenant-Slug': tenant,
        'X-Nexus-Mobile': '1',
        'X-Nexus-Mobile-Version': APP_VERSION,
      },
      body: JSON.stringify({
        event,
        version: APP_VERSION,
        platform: 'mobile',
        data: safeContext,
      }),
    });
  } catch {
    // Deliberate: a diagnostic that throws is worse than one that is lost.
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[unserialisable]';
  }
}

/**
 * Report something that went wrong but did not crash — a drifted contract, a
 * refused permission, an unhandled link.
 *
 * `key` controls deduplication: the same key is reported once per session.
 */
export function reportMessage(message: string, context: ReportContext = {}, key?: string): void {
  const safeMessage = scrubForReport(message);

  try {
    Sentry.captureMessage(safeMessage, { extra: context } as Parameters<typeof Sentry.captureMessage>[1]);
  } catch {
    // Sentry being unavailable must not stop the server report below.
  }

  if (!admit(key ?? safeMessage, Date.now())) return;
  void postToServer('mobile_warning', { message: safeMessage, ...context });
}

/**
 * Report a genuine error or crash.
 */
export function reportException(error: unknown, context: ReportContext = {}, key?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const safeMessage = scrubForReport(message);
  const name = error instanceof Error ? error.name : 'UnknownError';

  try {
    Sentry.captureException(error, { extra: context } as Parameters<typeof Sentry.captureException>[1]);
  } catch {
    // As above.
  }

  if (!admit(key ?? `${name}:${safeMessage}`, Date.now())) return;
  void postToServer('mobile_error', {
    name,
    message: safeMessage,
    stack: error instanceof Error ? scrubForReport(error.stack ?? '') : '',
    ...context,
  });
}

/**
 * Drop-in replacement for `Sentry.captureMessage` that also reaches our own server.
 *
 * 🔴 Exists so the ten API "contract drift" reporters could be redirected by renaming
 * the call rather than by rewriting each one's payload. They all pass Sentry's own
 * options object (`{ level, tags, extra }`), and rewriting ten different payload
 * shapes by hand is exactly the kind of mechanical edit that introduces a mistake in
 * the tenth file — so this takes the same arguments and forwards them unchanged.
 *
 * Those reporters mattered more than their obscurity suggests: contract drift means
 * the API has started returning a shape the app rejects, which shows up to a member
 * as a screen that simply refuses to load. Ten separate detectors for that condition
 * were all reporting into a disabled service.
 *
 * Deduplicated by module + endpoint, because drift fires on EVERY affected response.
 */
export function reportSentryMessage(
  message: string,
  options?: Parameters<typeof Sentry.captureMessage>[1]
): void {
  const safeMessage = scrubForReport(message);

  try {
    Sentry.captureMessage(safeMessage, options);
  } catch {
    // As elsewhere: Sentry's absence must not stop the server report.
  }

  const tags =
    options && typeof options === 'object' && 'tags' in options
      ? ((options as { tags?: Record<string, unknown> }).tags ?? {})
      : {};
  const extra =
    options && typeof options === 'object' && 'extra' in options
      ? ((options as { extra?: Record<string, unknown> }).extra ?? {})
      : {};

  const module = typeof tags.module === 'string' ? tags.module : 'unknown';
  const endpoint = typeof tags.endpoint === 'string' ? tags.endpoint : '';

  if (!admit(`${safeMessage}:${module}:${endpoint}`, Date.now())) return;
  void postToServer('mobile_warning', {
    message: safeMessage,
    module,
    endpoint,
    detail: safeStringify(extra),
  });
}

/** Whether Sentry actually has somewhere to send events. */
export function isSentryConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN);
}

/**
 * Announce, once per session, that Sentry has no DSN.
 *
 * 🔴 This is deliberately NOT a dev-only console line. `lib/env.ts` already had one
 * of those, and being silent in release builds is exactly how "crash reporting is
 * off" survived unnoticed in all six profiles. Reported through the server sink,
 * which works precisely because it does not depend on Sentry.
 */
export function reportSentryDisabledIfNeeded(): void {
  if (isSentryConfigured()) return;

  reportMessage(
    'Crash reporting is disabled: EXPO_PUBLIC_SENTRY_DSN is not set for this build',
    { severity: 'configuration' },
    'sentry-disabled'
  );
}

/** Test-only reset so suites don't inherit one another's budget. */
export function __resetReportBudgetForTests(): void {
  sentThisSession = 0;
  lastSentAt = 0;
  seenKeys.clear();
}

// Register with the dependency-free sink so `lib/storage.ts` — which must not import
// this module directly — can report through it. Runs at module load; `lib/env.ts`
// imports this file during startup, so it is registered before anything interesting
// happens. If it never ran, reports are dropped rather than crashing.
registerReporter((error, context) => reportException(error, context));
