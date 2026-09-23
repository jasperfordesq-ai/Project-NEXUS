// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ─────────────────────────────────────────────────────────────────────────────
// Eviction-aware localStorage helpers
//
// A raw `localStorage.setItem` throws `QuotaExceededError` once storage is full
// — and an unguarded write turns that into a crashed page render. (The i18next
// translation cache, namespaced per build commit, was the historical culprit
// that filled storage; see i18n.ts.) Every localStorage write in the app should
// go through `safeLocalStorageSet` (or the JSON wrapper) so that:
//   1. a full/blocked store can never crash the caller, and
//   2. hitting quota triggers two-stage eviction that reclaims space and lets
//      the write succeed, instead of silently failing forever.
//
// This is the single source of truth for the eviction policy; `lib/api.ts`
// (token writes) and `lib/helpers.ts` (the `storage` JSON helper) both delegate
// here.
// ─────────────────────────────────────────────────────────────────────────────

// Keys/prefixes that are safe to evict first when storage is full — ordered
// cheapest first. Auth tokens and tenant config are NOT here; they must survive.
// `i18n_` is this app's real i18next-localstorage-backend prefix (configured in
// i18n.ts as `i18n_<buildCommit>_`); `i18next_res_` is the library default and
// is kept only for safety. The translation cache is the largest evictable
// consumer, so it must be matched here for quota self-healing to work.
const EVICTABLE_PREFIXES = ['i18n_', 'i18next_res_', 'nexus_connection_dismissed_'];
const EVICTABLE_KEYS = [
  'nexus_performance_metrics',
  'nexus_recent_searches',
  'nexus_recent_pages',
  'nexus_proximity',
];

// Last-resort allowlist: anything NOT in this set is wiped if storage is still
// full after the soft eviction above. Auth tokens, tenant identity, and a few
// cheap user-preference keys survive; everything else (drafts, caches, UI
// state) is sacrificed so the user can keep using the app.
const CRITICAL_KEYS = new Set([
  'nexus_access_token',
  'nexus_refresh_token',
  'nexus_auth_session_generation',
  'nexus_tenant_id',
  'nexus_tenant_slug',
  'nexus_theme',
  'nexus_language_user_chosen',
  'userId',
]);
const CRITICAL_PREFIXES = ['nexus_auth_session:'];

function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22);
}

function evictNonCriticalStorage(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (EVICTABLE_KEYS.includes(key) || EVICTABLE_PREFIXES.some((p) => key.startsWith(p))) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

function evictAllNonCritical(): void {
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (!CRITICAL_KEYS.has(key) && !CRITICAL_PREFIXES.some((prefix) => key.startsWith(prefix))) toRemove.push(key);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

/**
 * Write a string to localStorage without ever throwing. On QuotaExceededError,
 * performs two-stage eviction (soft caches first, then everything non-critical)
 * and retries. Returns true if the value was ultimately stored, false otherwise.
 */
export function safeLocalStorageSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (isQuotaError(e)) {
      // Stage 1: soft eviction (caches + dismissed banners only).
      evictNonCriticalStorage();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e2) {
        if (!isQuotaError(e2)) {
          // A non-quota failure (e.g. blocked storage) — nothing eviction can
          // do. Swallow so a preference write can never crash the caller.
          return false;
        }
      }
      // Stage 2: aggressive eviction — wipe everything except the critical
      // allowlist. Sacrifices drafts/UI state to keep the user signed in.
      evictAllNonCritical();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        // Still full after wiping non-critical keys means the value itself
        // exceeds quota (e.g. an oversized token). Log so we can investigate.
        console.error(`[NEXUS] localStorage quota exceeded storing "${key}" — even after full eviction. Value size: ${value.length} chars.`);
        return false;
      }
    }
    // Non-quota error on the first attempt (private mode / disabled storage):
    // never let it propagate to the caller.
    return false;
  }
}

/** Read a string from localStorage without throwing (returns null on failure). */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remove a key from localStorage without throwing. */
export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable — nothing to do */
  }
}

/** JSON-serialize and store a value via {@link safeLocalStorageSet}. */
export function safeLocalStorageSetJSON<T>(key: string, value: T): boolean {
  try {
    return safeLocalStorageSet(key, JSON.stringify(value));
  } catch {
    // JSON.stringify can throw on circular structures — never crash the caller.
    return false;
  }
}

/** Read and JSON-parse a value, returning `fallback` on any failure. */
export function safeLocalStorageGetJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
