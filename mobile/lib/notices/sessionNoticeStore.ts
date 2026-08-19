// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// SESSION NOTICE STORE
//
// One-shot notices that infrastructure needs to SAY to the member, published
// without infrastructure knowing how they get shown.
//
// 🔴 Why this exists, because the first two attempts were both wrong.
//
// `AuthProvider` needs to explain a sign-out: being dropped on the login screen
// with no message is indistinguishable from a crash, and that is exactly how
// members describe it when they report it.
//
// Attempt 1 called `useAppToast()` directly in AuthProvider. Eight test suites
// died immediately with "useToast must be used within a ToastProvider", because
// they render AuthProvider on its own.
//
// Attempt 2 wrapped that call in try/catch as `useOptionalAppToast()`. The tests
// went green and it shipped — but `react-hooks/rules-of-hooks` failed the lint
// gate on it, correctly: heroui-native's `useToast` throws from inside, so the
// hooks after the throw never run and the hook COUNT differs between a tree with
// a provider and one without. It happened to work only because provider presence
// never changes for a given component instance. That is a latent render-order
// bug, not a style complaint, and no amount of comment could make it safe.
//
// This is attempt 3, and it removes the dependency instead of hiding it.
// Infrastructure calls `publish()` — a plain function, no hooks, no provider, no
// React at all. A component mounted INSIDE the provider tree subscribes and does
// the showing. Same shape as `themeStore`, for the same reason: ~200 components
// and their tests must not need a provider to work.
//
// Deliberately holds only the LATEST notice. These are interruptions ("you have
// been signed out"), not a feed; queueing them would mean a member who was
// offline briefly gets a stack of stale warnings when they return.
// ---------------------------------------------------------------------------

export type SessionNoticeVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

export interface SessionNotice {
  title: string;
  description?: string;
  variant?: SessionNoticeVariant;
  /**
   * Distinguishes two notices with identical text, so a second sign-out still shows.
   * Monotonic rather than a timestamp: `Date.now()` can repeat inside one millisecond.
   */
  id: number;
}

let current: SessionNotice | null = null;
let nextId = 1;

const listeners = new Set<() => void>();

export const sessionNoticeStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * The notice awaiting display, or null. Referentially stable between changes, as
   * `useSyncExternalStore` requires — returning a fresh object each call would loop.
   */
  getSnapshot(): SessionNotice | null {
    return current;
  },

  /**
   * Say something to the member. Safe to call from anywhere: a queue worker, an API
   * client, a provider, a test. If nothing is listening the notice is simply dropped,
   * which is the correct degradation — a missing toast must never take a screen down.
   */
  publish(notice: Omit<SessionNotice, 'id'>): void {
    current = { ...notice, id: nextId++ };
    listeners.forEach((listener) => listener());
  },

  /** Called once a notice has been shown, so it is not re-shown on the next render. */
  consume(): void {
    if (current === null) return;
    current = null;
    listeners.forEach((listener) => listener());
  },

  /** Test-only reset so suites don't leak notices into one another. */
  __resetForTests(): void {
    current = null;
    nextId = 1;
    listeners.clear();
  },
};
