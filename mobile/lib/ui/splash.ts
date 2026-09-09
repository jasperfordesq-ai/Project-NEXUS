// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Holds the native splash screen up until the app has a real screen to show.
 *
 * 🔴 What this replaces. `expo-splash-screen` was not installed, so the native splash hid
 * itself the moment React rendered anything — and the first thing React renders is
 * `app/index.tsx`, a bare spinner on the background colour, which sits there while the
 * stored session and the community configuration load and the redirect is decided. A cold
 * start was therefore three screens: branded splash, blank spinner, then the real screen.
 * Audit 2026-09-09, item 7.
 *
 * 🔴 The backstop is the important part of this module. Holding a splash open is a promise
 * to close it, and the code that closes it lives inside the provider tree — so anything
 * that stops `RootNavigator` reaching its effect (a provider that throws, a session check
 * that never settles) would leave the member looking at a splash screen for ever, with no
 * error and no way out. That is a far worse failure than the flash being fixed, so the hold
 * expires on its own after {@link SPLASH_MAX_HOLD_MS} whatever else happens, and
 * `ErrorBoundary` releases it too.
 */

import * as SplashScreen from 'expo-splash-screen';

/**
 * How long the splash may stay up before it is dismissed regardless.
 *
 * Five seconds is longer than a cold start with a warm cache and shorter than a member's
 * patience with a screen that is not moving. A slow session check will now show the app
 * mid-load rather than pretending to still be starting.
 */
export const SPLASH_MAX_HOLD_MS = 5_000;

let released = false;
let backstop: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep the native splash up. Call once, at module scope, before React renders.
 *
 * Failures are swallowed: `preventAutoHideAsync` rejects when the splash has already gone
 * (a Fast Refresh, a re-import), and that is not a problem worth reporting.
 */
export function holdSplash(timeoutMs: number = SPLASH_MAX_HOLD_MS): void {
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);

  if (backstop) clearTimeout(backstop);
  backstop = setTimeout(() => {
    void releaseSplash();
  }, timeoutMs);
}

/** Let the splash go. Safe to call repeatedly and from more than one place. */
export async function releaseSplash(): Promise<void> {
  if (released) return;
  released = true;

  if (backstop) {
    clearTimeout(backstop);
    backstop = null;
  }

  await SplashScreen.hideAsync().catch(() => undefined);
}

/** Test-only: forget that the splash was released, so each case starts from a cold app. */
export function resetSplashStateForTests(): void {
  released = false;
  if (backstop) {
    clearTimeout(backstop);
    backstop = null;
  }
}
