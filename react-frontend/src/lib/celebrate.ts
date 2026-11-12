// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * First-time celebrations (warmth phase 5).
 *
 * When a member creates their very first offer or request, event or group in
 * a community, the server says so in the create response's `meta`
 * (`celebrate: first_listing | first_event | first_group`,
 * App\Support\FirstTimeCelebration). The form that saved it calls
 * `celebrateFromMeta(response.meta)`; `CelebrationHost`, which lives in the
 * page layout and so survives the form navigating away, shows a short burst
 * of confetti in the community's colours and a line of thanks.
 *
 * A window event carries it, not React context: the forms sit under many
 * different providers (pages, pop-ups, the compose hub) and need nothing but
 * one function call.
 */
export const CELEBRATION_KINDS = ['first_listing', 'first_event', 'first_group'] as const;
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

export const CELEBRATE_EVENT = 'nexus:celebrate';

/** One of our own names from a response's `meta`, or null. */
export function celebrationFromMeta(meta: unknown): CelebrationKind | null {
  if (meta === null || typeof meta !== 'object') return null;
  const value = (meta as { celebrate?: unknown }).celebrate;
  return typeof value === 'string' && (CELEBRATION_KINDS as readonly string[]).includes(value)
    ? (value as CelebrationKind)
    : null;
}

/** Ask the page to celebrate. Safe to call anywhere; does nothing without a window. */
export function celebrate(kind: CelebrationKind): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<CelebrationKind>(CELEBRATE_EVENT, { detail: kind }));
}

/** Celebrate if a create response's `meta` says this was a first. */
export function celebrateFromMeta(meta: unknown): void {
  const kind = celebrationFromMeta(meta);
  if (kind) celebrate(kind);
}
