// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How long the app takes to become usable.
 *
 * 🔴 Journey 7.16 read "no budget exists", and behind that was something worse: no
 * measurement existed either. `adb shell am start -W` does not answer this question for a
 * React Native app — it stops at the first frame, which is the native splash, so it
 * reported 1.3s while the JavaScript had not finished loading. Sentry's own cold-start
 * measurement would answer it, and Sentry has no DSN in any build profile.
 *
 * Two numbers are recorded, and the difference between them is the point:
 *
 *   - `totalMs` — from React Native's own native `startTime` mark to the first screen.
 *     This is the number to watch. 🔴 It is NOT `performance.now()`: that counts from
 *     device boot and returned 37,101,247 on the emulator.
 *   - `bundleEvalMs` — how long evaluating the bundle took, from React Native's marks.
 *   - `jsMs` — from the bundle's entry point to the first screen: the app's whole
 *     JavaScript phase. 🔴 This only became meaningful once `index.js` existed. Imported
 *     from the root layout instead, it reported **0ms** on a device — expo-router loads
 *     the layout lazily, so by then everything expensive had already run.
 *
 * Neither is the member's full wait: the native process, the splash and any pre-JS work
 * happen before this clock is useful. See `startup-budget.json` for what is not measured.
 */

/**
 * Captured at import time. `index.js` imports this module FIRST, before
 * `expo-router/entry`, so this is the earliest moment our own code can observe.
 */
const JS_MODULE_START = Date.now();

export interface StartupTiming {
  /** Native start-up to the first screen. The number that matters. */
  totalMs: number | null;
  /** Of which, evaluating the JavaScript bundle. */
  bundleEvalMs: number | null;
  /** The JavaScript phase: bundle entry point to first screen. */
  jsMs: number;
}

let timing: StartupTiming | null = null;

interface RNPerformance {
  now?: () => number;
  /**
   * React Native's own start-up marks (RN 0.76+, Hermes). `startTime` is stamped by the
   * NATIVE side when start-up begins, which is the only honest zero for this measurement.
   */
  reactNativeStartupTiming?: {
    startTime?: number;
    initializeRuntimeStart?: number;
    executeJavaScriptBundleEntryPointStart?: number;
    executeJavaScriptBundleEntryPointEnd?: number;
  };
}

/**
 * Milliseconds from native start-up to now.
 *
 * 🔴 `performance.now()` on its own is NOT time since the app started — measured on a
 * device it returned 37,101,247, because React Native's clock counts from device boot.
 * The zero has to come from `reactNativeStartupTiming.startTime`. Returns null rather
 * than a wrong number when either half is missing.
 */
function sinceNativeStart(): number | null {
  const perf = (globalThis as { performance?: RNPerformance }).performance;
  const start = perf?.reactNativeStartupTiming?.startTime;
  if (typeof perf?.now !== 'function' || typeof start !== 'number') return null;
  return Math.round(perf.now() - start);
}

/** How long evaluating the JavaScript bundle took, if React Native recorded it. */
function bundleEvalMs(): number | null {
  const marks = (globalThis as { performance?: RNPerformance }).performance
    ?.reactNativeStartupTiming;
  const from = marks?.executeJavaScriptBundleEntryPointStart;
  const to = marks?.executeJavaScriptBundleEntryPointEnd;
  if (typeof from !== 'number' || typeof to !== 'number') return null;
  return Math.round(to - from);
}

/**
 * Called once, when the app first has a screen. Later calls return the first result, so a
 * re-render or a Fast Refresh cannot overwrite a real figure with a few milliseconds.
 */
export function markAppReady(now: number = Date.now()): StartupTiming {
  if (timing !== null) return timing;
  timing = {
    totalMs: sinceNativeStart(),
    bundleEvalMs: bundleEvalMs(),
    jsMs: now - JS_MODULE_START,
  };

  if (__DEV__) {
    // Printed so it can be read off `adb logcat` without a debugger attached.
    console.log(`nexus-startup: total ${timing.totalMs ?? 'unavailable'}ms, `
      + `bundle-eval ${timing.bundleEvalMs ?? 'unavailable'}ms, `
      + `js ${timing.jsMs}ms`);
  }

  return timing;
}

/** What was recorded at the first screen, or null if that has not happened yet. */
export function startupTiming(): StartupTiming | null {
  return timing;
}

/** Test seam. Never call this from app code. */
export function resetStartupTimingForTests(): void {
  timing = null;
}
