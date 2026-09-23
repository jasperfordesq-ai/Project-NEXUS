// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ─────────────────────────────────────────────────────────────────────────────
// Per-member browser storage (F-109)
//
// Compose drafts and recent searches are private to the member who typed them.
// On a shared browser they used to survive sign-out under a key that named
// neither the member nor (for most compose tabs) the community, so the next
// person to sign in saw — and could publish — the previous member's draft.
//
// Every such key is now suffixed with the tenant and the member id, and every
// key under these prefixes is removed on sign-out.
// ─────────────────────────────────────────────────────────────────────────────

/** Key prefixes that hold one member's private drafts or search history. */
export const USER_SCOPED_STORAGE_PREFIXES = [
  'compose-',
  'marketplace-listing-draft',
  'nexus:recent-searches:',
] as const;

/** Exact keys that hold one member's private search history. */
export const USER_SCOPED_STORAGE_KEYS = ['nexus_recent_searches'] as const;

type ScopeId = string | number | null | undefined;

function scopePart(value: ScopeId, fallback: string): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

/**
 * Build a storage key that belongs to one member of one community, e.g.
 * `compose-draft-event:t2:u17`. The base must keep one of
 * {@link USER_SCOPED_STORAGE_PREFIXES} so that sign-out clears it.
 */
export function userScopedStorageKey(base: string, tenantId: ScopeId, userId: ScopeId): string {
  return `${base}:t${scopePart(tenantId, '-')}:u${scopePart(userId, 'anon')}`;
}

/** True when a localStorage key holds member-private drafts or search history. */
export function isUserScopedStorageKey(key: string): boolean {
  return (
    (USER_SCOPED_STORAGE_KEYS as readonly string[]).includes(key) ||
    USER_SCOPED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

/**
 * Remove every member-private draft and recent-search entry from localStorage.
 * Called on sign-out. Never throws: blocked storage must not hold sign-out up.
 */
export function clearUserScopedStorage(): void {
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isUserScopedStorageKey(key)) toRemove.push(key);
    }
    for (const key of toRemove) localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode / blocked) — nothing to clear.
  }
}
