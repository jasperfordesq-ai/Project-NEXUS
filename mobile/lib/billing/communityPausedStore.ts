// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// COMMUNITY-PAUSED STORE
//
// Which community the server has said is paused, learned from a refusal.
//
// A community paused for non-payment is refused on every member-side request
// with `403 { code: "COMMUNITY_PAUSED" }` (App\Http\Middleware\CheckBillingLock).
// The tenant bootstrap also says `billing_paused: true`, but the app may be
// running on a cached bootstrap from before the pause, so the refusal is the
// signal that cannot be stale. `lib/api/client.ts` records it here and
// `components/CommunityPausedGate.tsx` shows the paused screen.
//
// A plain module store, not a context, for the same reason as
// `lib/updates/updateRequiredStore.ts`: the API client has no provider above it.
//
// Keyed by community slug rather than a boolean, so choosing another community
// in the picker leaves the pause behind without anyone having to clear it.
// Unlike the update store this one can be cleared: a community is restored when
// it pays, and the gate clears the record when a fresh bootstrap no longer says
// paused.
// ---------------------------------------------------------------------------

let pausedSlug: string | null = null;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export const communityPausedStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** A string, so it is stable between changes as `useSyncExternalStore` requires. */
  getSnapshot(): string | null {
    return pausedSlug;
  },

  /**
   * Record that the server refused a request because this community is paused.
   *
   * Idempotent: every request in flight is refused the same way, and only the first
   * may cause a re-render.
   */
  markPaused(slug: string): void {
    const next = slug.trim();
    if (next === '' || next === pausedSlug) return;
    pausedSlug = next;
    notify();
  },

  /** Forget the pause, but only for the community it was recorded for. */
  clear(slug: string): void {
    if (pausedSlug === null || pausedSlug !== slug.trim()) return;
    pausedSlug = null;
    notify();
  },

  /** Test-only reset so suites don't leak a paused state into one another. */
  __resetForTests(): void {
    pausedSlug = null;
    listeners.clear();
  },
};
