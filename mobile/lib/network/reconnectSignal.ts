// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * App-wide "connectivity came back" signal.
 *
 * useNetworkStatus (mounted once, by OfflineBanner) emits when the app goes from offline
 * to online. The shared data hooks listen and retry a screen that failed with nothing to
 * show, so a member does not have to find a Retry button after the connection returns.
 * Kept as plain JS, deliberately: importing NetInfo into every data hook would load the
 * native module into every test that renders a screen.
 */
const listeners = new Set<() => void>();

export function onReconnect(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitReconnect(): void {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* one screen's retry must not stop the others */ }
  }
}
