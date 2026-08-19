// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// REPORT SINK — a deliberately empty module, and the reason it exists
//
// This file imports NOTHING. That is its entire purpose.
//
// 🔴 The problem it solves, in the order the wrong answers were tried.
//
// `lib/storage.ts` needs to report a failed write (the "random logouts"
// symptom), and `lib/observability/report.ts` needs to read the tenant slug from
// storage to tag the report. So the two modules need each other.
//
//  * **Attempt 1 — static imports both ways.** A real cycle
//    (storage -> report -> storage) and, worse, it dragged
//    `@sentry/react-native` and `expo-constants` into every module that touches
//    storage. That broke 10 tests in `lib/storage.test.ts` immediately with
//    "An error occurred while requiring the 'ExponentConstants' module", because
//    that suite loads storage in a deliberately minimal module registry.
//
//  * **Attempt 2 — `await import()` on both sides.** Looked elegant, and was
//    silently dead where it mattered most: Jest cannot execute a native dynamic
//    import without `--experimental-vm-modules`, so the report never fired under
//    test and the `.catch()` swallowed the reason. The test that was supposed to
//    prove storage failures are reported passed with ZERO calls, and a second
//    test appeared to pass only because the fallback tenant happens to equal the
//    mocked one. Two false green results from one clever idea.
//
//  * **Attempt 3 — this.** A module with no imports can be depended on by
//    anything, in any direction, in any environment. `storage.ts` imports only
//    this. `report.ts` registers itself here at startup and imports storage
//    normally — one-way, no cycle, no dynamic import, and both halves testable
//    without a native environment.
//
// If nothing has registered, reports are dropped. That is the correct
// degradation: diagnostics must never be load-bearing.
// ---------------------------------------------------------------------------

/** What a registered reporter must provide. */
export type SinkReporter = (error: unknown, context: Record<string, unknown>) => void;

let reporter: SinkReporter | null = null;

/**
 * Point the sink at a real reporter. Called once, at startup, by
 * `lib/observability/report.ts`.
 */
export function registerReporter(next: SinkReporter): void {
  reporter = next;
}

/**
 * Report an error without knowing or caring who is listening.
 *
 * Never throws: a reporter that fails must not become the failure. Safe to call
 * from anywhere, including modules that run before the app has started.
 */
export function reportToSink(error: unknown, context: Record<string, unknown> = {}): void {
  if (!reporter) return;

  try {
    reporter(error, context);
  } catch {
    // A diagnostic that throws is worse than one that is lost.
  }
}

/** Whether anything is listening. Exposed for tests and for honest reporting. */
export function hasReporter(): boolean {
  return reporter !== null;
}

/** Test-only reset so suites don't inherit one another's reporter. */
export function __resetSinkForTests(): void {
  reporter = null;
}
