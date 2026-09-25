// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS API Client
 * Handles all HTTP communication with the PHP backend
 *
 * Features:
 * - Automatic token refresh on 401
 * - Tenant ID header injection
 * - Session expiration events
 * - Request queuing during refresh
 */

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { validateResponse } from '@/lib/api-validation';
import { apiResponseSchema } from '@/lib/api-schemas';
import { recordApiDiagnostic } from '@/lib/supportDiagnostics';
import { safeLocalStorageSet } from '@/lib/safeStorage';
import { queueSentryApiCall, queueSentryBreadcrumb, queueSentryMessage } from '@/lib/telemetryQueue';
import i18n, { SUPPORTED_LOCALE_CODES } from '@/i18n';
import { ACCOUNT_UNDER_MINIMUM_AGE, serverMessageFor } from '@/lib/minimum-age';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
// Browser access credentials stay in this process; the server owns the
// HttpOnly refresh cookie. Web Storage contains only non-secret coordination.
const TOKEN_KEY = 'nexus_access_token';
const REFRESH_TOKEN_KEY = 'nexus_refresh_token';
const TENANT_ID_KEY = 'nexus_tenant_id';
const TENANT_SLUG_KEY = 'nexus_tenant_slug';
const CSRF_TOKEN_KEY = 'nexus_csrf_token';
const AUTH_SESSION_GENERATION_KEY = 'nexus_auth_session_generation';
const AUTH_SESSION_RECORD_PREFIX = 'nexus_auth_session:';
const AUTH_SESSION_BINDING_PREFIX = 'nexus_auth_binding:';

interface StoredAuthSession {
  accessToken: string;
  refreshToken: string | null;
  tenantId: string | null;
}

const memoryAuthRecords = new Map<string, StoredAuthSession>();

// Older bundles persisted bearer and refresh credentials. Retire every such
// record on startup; a previous session signs in again rather than leaving a
// 30-day bearer credential readable by scripts after this migration.
function purgeLegacyBrowserCredentials(): void {
  if (typeof window === 'undefined') return;
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      const store = window[kind];
      for (let index = store.length - 1; index >= 0; index--) {
        const key = store.key(index);
        if (key?.startsWith(AUTH_SESSION_RECORD_PREFIX)) store.removeItem(key);
      }
      store.removeItem(TOKEN_KEY);
      store.removeItem(REFRESH_TOKEN_KEY);
    } catch { /* Storage may be unavailable in private mode. */ }
  }
}
purgeLegacyBrowserCredentials();

// Default tenant ID - only used if nothing is in localStorage
// In production, tenant is detected from subdomain during bootstrap
// This fallback is for development only
const DEFAULT_TENANT_ID = import.meta.env.VITE_DEFAULT_TENANT_ID || null;

// Custom events
export const SESSION_EXPIRED_EVENT = 'nexus:session_expired';
/**
 * Why a session ended: plain expiry, the server now requiring a second factor,
 * or the account being under the platform's minimum age (adults-only decision
 * 2026-09-25) — which no sign-in can fix.
 */
export type SessionEndReason = 'expired' | 'mfa_required' | 'under_minimum_age';
export interface SessionExpiredDetail {
  reason: SessionEndReason;
  sessionGeneration?: string | null;
  /** The server's own translated explanation, when it sent one. */
  message?: string;
}
export const SESSION_EXPIRING_EVENT = 'nexus:session_expiring';
export const SESSION_REPLACED_EVENT = 'nexus:session_replaced';
export interface SessionReplacedDetail {
  previousSessionGeneration: string | null;
}
export const API_ERROR_EVENT = 'nexus:api_error';

function captureTelemetryApiCall(
  method: string,
  endpoint: string,
  status: number,
  duration: number,
): void {
  queueSentryApiCall(method, endpoint, status, duration);
}

function addTelemetryBreadcrumb(
  message: string,
  category: string,
  data: Record<string, unknown>,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  queueSentryBreadcrumb(message, category, data, level);
}

function captureTelemetryMessage(
  message: string,
  level: 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug',
  context?: Record<string, unknown>,
): void {
  queueSentryMessage(message, level, context);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stale-client gate
// ─────────────────────────────────────────────────────────────────────────────
// Every API response carries `X-Build: <sha>` (set by SecurityHeaders middleware
// on the server). If that doesn't match this client's __BUILD_COMMIT__, the
// client is running older code than the server. We give the silent recovery
// paths (NetworkFirst HTML refetch on next nav, SW skipWaiting +
// clientsClaim + controllerchange auto-reload from main.tsx) a 10-minute
// grace window to bring the client into sync. If the mismatch persists past
// the window, we force-redirect to /api/sw-reset — that URL bypasses every
// SW we've ever shipped (matches the long-standing /^\/api\// denylist) and
// the nginx response unregisters the SW + clears CacheStorage.
//
// No UI is fired during the grace window. The user-facing update banner has
// been removed; the wait is silent because the natural propagation path is
// expected to resolve >99% of mismatches without intervention.

const BUILD_HEADER = 'x-build';
const BUILD_MISMATCH_KEY = 'nexus_build_mismatch_since';
const BUILD_MISMATCH_GRACE_MS = 10 * 60 * 1000;
const RECOVERY_URL = '/api/sw-reset';

let staleRedirectFired = false;

function checkStaleBuild(response: Response): void {
  if (staleRedirectFired) return;

  const serverBuild = response.headers.get(BUILD_HEADER);
  if (!serverBuild) return; // server pre-dates the gate; treat as match

  // __BUILD_COMMIT__ is injected as a 12-char short SHA. Server may send
  // either short or full — compare on the prefix to stay tolerant.
  const clientBuild = __BUILD_COMMIT__;
  if (!clientBuild || clientBuild === 'dev') return;

  const matches =
    serverBuild === clientBuild ||
    serverBuild.startsWith(clientBuild) ||
    clientBuild.startsWith(serverBuild);

  if (matches) {
    // Healed (we caught up — likely after a soft-update reload). Clear tracker.
    try { localStorage.removeItem(BUILD_MISMATCH_KEY); } catch { /* non-blocking */ }
    return;
  }

  // First detection of this mismatch in the window — record the timestamp so
  // we can decide later whether the soft-update path has had enough chances.
  let firstSeen = 0;
  try {
    const raw = localStorage.getItem(BUILD_MISMATCH_KEY);
    if (raw) firstSeen = parseInt(raw, 10) || 0;
  } catch { /* non-blocking */ }

  const now = Date.now();
  if (firstSeen === 0) {
    // Silently start the grace timer. Within the next 10 minutes either
    // (a) the new SW activates + controllerchange auto-reloads,
    // (b) a user-initiated navigation hits NetworkFirst and pulls in the
    //     fresh shell, or (c) the timer below fires the hard recovery.
    safeLocalStorageSet(BUILD_MISMATCH_KEY, String(now));
    addTelemetryBreadcrumb(
      'Stale client detected',
      'pwa',
      { client_build: clientBuild, server_build: serverBuild },
      'warning',
    );
    return;
  }

  if (now - firstSeen >= BUILD_MISMATCH_GRACE_MS) {
    // Soft path has had 10 minutes and the client is still running old code.
    // Force-recover: nginx /api/sw-reset returns Clear-Site-Data + an inline
    // script that unregisters the SW and wipes CacheStorage, then redirects
    // to / where the browser fetches the fresh shell from network.
    staleRedirectFired = true;
    try { localStorage.removeItem(BUILD_MISMATCH_KEY); } catch { /* non-blocking */ }
    // Capture as a message (not just a breadcrumb) so we can count
    // force-recoveries in Sentry's discover/issues UI. This event is rare
    // by design — every occurrence means the soft-update path failed for
    // 10+ minutes, which is worth investigating.
    captureTelemetryMessage(
      'Stale client force-recovered via /api/sw-reset',
      'warning',
      {
        client_build: clientBuild,
        server_build: serverBuild,
        mismatch_age_ms: now - firstSeen,
      },
    );
    redirectToRecovery();
  }
}

function redirectToRecovery(): void {
  try {
    window.location.replace(RECOVERY_URL);
  } catch {
    window.location.href = RECOVERY_URL;
  }
}

/**
 * True once a response has carried a server build that differs from this bundle's
 * (recorded by `checkStaleBuild`; cleared when the two agree again). Callers use it to
 * tell "this page is out of date" apart from a genuine server fault before forcing a
 * recovery — a client that IS current must never be sent round the recovery loop.
 */
export function isClientBuildStale(): boolean {
  try {
    return localStorage.getItem(BUILD_MISMATCH_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Force the stale-client recovery now instead of after the ten-minute grace. Used when
 * an out-of-date bundle meets an answer it cannot act on — a sign-in answer of a shape
 * it does not know is the case seen on 12 September 2026, when the old bundle read the
 * new two-factor enrolment answer as "Sign-in failed" until the browser was restarted.
 */
export function recoverStaleClient(reason: string): void {
  if (staleRedirectFired) return;
  staleRedirectFired = true;
  try { localStorage.removeItem(BUILD_MISMATCH_KEY); } catch { /* non-blocking */ }
  captureTelemetryMessage('Stale client force-recovered via /api/sw-reset', 'warning', { reason });
  redirectToRecovery();
}

// Debounce SESSION_EXPIRED dispatches to prevent 401 cascade loops.
// If multiple in-flight requests all get 401 simultaneously, only one
// SESSION_EXPIRED event fires per 5-second window.
let lastSessionExpiredTime = 0;

// Event payload types
export interface ApiErrorEventDetail {
  message: string;
  code: string;
  endpoint: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  code?: string;
  errors?: ApiErrorDetail[];
  meta?: PaginationMeta;
}

export interface ApiErrorDetail {
  code?: string;
  message?: string;
  field?: string;
  [key: string]: unknown;
}

export interface ApiError {
  message: string;
  code: string;
  status: number;
  fieldErrors?: Record<string, string[]>;
}

export type TokenRefreshOutcome = 'refreshed' | 'invalid' | 'transient' | 'context_changed';

interface AuthContextSnapshot {
  sessionGeneration: string | null;
  tenantId: string | null;
}

interface TokenGenerationSnapshot {
  accessToken: string | null;
  refreshToken: string | null;
  refreshAttempt: string | null;
  logoutGeneration: string | null;
  tenantId: string | null;
  sessionGeneration: string | null;
}

interface PendingRefreshWaiter {
  accessTokenAtWait: string | null;
  tenantIdAtWait: string | null;
  resolve: (outcome: TokenRefreshOutcome) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

function hasApiErrorCode(payload: unknown, expectedCode: string): boolean {
  if (typeof payload !== 'object' || payload === null || !('errors' in payload)) {
    return false;
  }

  const errors = payload.errors;
  return Array.isArray(errors) && errors.some((error) => (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === expectedCode
  ));
}

export interface PaginationMeta {
  per_page: number;
  has_more: boolean;
  cursor?: string | null;
  next_cursor?: string | null;
  previous_cursor?: string | null;
  current_page?: number;
  total_items?: number;
  total_pages?: number;
  total?: number;
  from?: number;
  to?: number;
  last_page?: number;
  has_next_page?: boolean;
  has_previous_page?: boolean;
  path?: string;
  pagination_scope?: 'internal_partners' | 'external_partner' | string;
  cursor_scope?: 'internal_partners' | 'external_partner' | string;
  load_more_scope?: 'internal_partners' | 'external_partner' | 'none' | string;
  external_pagination_scope?: 'first_page_enrichment' | 'single_partner_result_set' | 'none' | string;
  external_results_paginated?: boolean;
  external_results_included?: boolean;
  source_counts?: {
    internal_returned?: number;
    internal_total_items?: number;
    external_returned?: number;
    returned_total?: number;
  };
  // Gamification API returns available badge types in meta
  available_types?: string[];
  // Member directory (/v2/users) reports how much of the community it is able
  // to list, so the page can explain the gap instead of looking half-empty.
  // Both counts exclude the viewer, so they are directly comparable.
  community_total?: number;
  directory_total?: number;
  /** Visibility rules in force for this tenant, e.g. 'directory_opt_in'. */
  directory_criteria?: string[];
  // Admin performance summary states whether recording is switched on, so an
  // empty report can say WHY it is empty instead of implying the platform is fast
  recording_enabled?: boolean;
  retention_days?: number;
  // Messages API returns conversation details in meta
  conversation?: {
    id: number;
    other_user: {
      id: number;
      name: string;
      first_name?: string;
      last_name?: string;
      avatar_url?: string | null;
      is_online?: boolean;
    };
    unread_count?: number;
    message_count?: number;
    // Server-authoritative safeguarding preflight state for a 1:1 conversation.
    // Present with restricted=true when direct contact with other_user is gated;
    // null/absent when contact is permitted. Rendering it never alerts staff.
    safeguarding?: {
      restricted: boolean;
      code: string;
      title?: string | null;
      message?: string | null;
      detail?: string | null;
      action_label?: string | null;
      required_vetting_types?: string[];
      required_vetting_labels?: string[];
      can_request_coordinator?: boolean;
    } | null;
  };
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  skipAuth?: boolean;
  skipTenant?: boolean;
  skipCsrf?: boolean;
  body?: unknown;
  timeout?: number; // Request timeout in ms (default 30000)
  responseType?: 'json' | 'blob' | 'text';
  /**
   * Optional in-memory GET cache TTL. When omitted, only known public static
   * endpoints such as tenant bootstrap and category metadata get a short TTL.
   */
  cacheTtlMs?: number;
  /** When provided, the upload is sent via XHR so byte progress (0-100) is reported. */
  onUploadProgress?: (percent: number) => void;
}

// localStorage writes go through `safeLocalStorageSet` (imported from
// lib/safeStorage) so a full store triggers eviction instead of throwing.

// ─────────────────────────────────────────────────────────────────────────────
// Token Management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Impersonated sessions live in sessionStorage, which is per-tab; every other
 * session lives in localStorage, which is shared by every tab on the origin.
 *
 * That split is the whole reason impersonation can work at all. Writing an
 * impersonated session into localStorage overwrites the admin's own credentials
 * in their original tab, and — worse — a 401 in the impersonated tab then
 * recovers using the ADMIN's refresh token, quietly turning the "member" tab
 * back into an admin session. Keeping the two in separate stores means neither
 * tab can see or clobber the other.
 */
export const IMPERSONATION_FLAG_KEY = 'nexus_impersonation_active';
export const IMPERSONATION_CONTEXT_KEY = 'nexus_impersonation_context';

export function isImpersonatedTab(): boolean {
  try {
    return sessionStorage.getItem(IMPERSONATION_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/** The auth store for THIS tab: per-tab while impersonating, shared otherwise. */
function authStore(): Storage {
  return isImpersonatedTab() ? sessionStorage : localStorage;
}

function authStoreSet(key: string, value: string): boolean {
  if (isImpersonatedTab()) {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      // Quota/private-mode failures must not throw mid-request.
      return false;
    }
  }
  return safeLocalStorageSet(key, value);
}

function createAuthSessionGeneration(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function authSessionRecordKey(generation: string): string {
  return `${AUTH_SESSION_RECORD_PREFIX}${generation}`;
}

function authSessionBindingKey(generation: string): string {
  return `${AUTH_SESSION_BINDING_PREFIX}${generation}`;
}

function readAuthSessionRecord(_store: Storage, generation: string): StoredAuthSession | null {
  return memoryAuthRecords.get(generation) ?? null;
}

function writeAuthSessionRecord(_store: Storage, generation: string, record: StoredAuthSession): boolean {
  memoryAuthRecords.set(generation, { ...record, refreshToken: null });
  return true;
}

function withIndexedDbAuthAdoptionLock<T>(commit: () => T): Promise<T | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const open = indexedDB.open('nexus-auth-coordination-v1', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('locks')) {
        open.result.createObjectStore('locks');
      }
    };
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      const database = open.result;
      let result: T | null = null;
      const transaction = database.transaction('locks', 'readwrite');
      const request = transaction.objectStore('locks').put(Date.now(), 'session-adoption');
      request.onsuccess = () => {
        result = commit();
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onerror = () => {
        database.close();
        resolve(null);
      };
      transaction.onabort = () => {
        database.close();
        resolve(null);
      };
    };
  });
}

export const tokenManager = {
  getSessionGeneration(): string | null {
    return authStore().getItem(AUTH_SESSION_GENERATION_KEY);
  },

  getSessionRecordKey(): string | null {
    const generation = this.getSessionGeneration();
    return generation ? authSessionRecordKey(generation) : null;
  },

  getGenerationForRecordKey(key: string | null): string | null {
    return key?.startsWith(AUTH_SESSION_RECORD_PREFIX)
      ? key.slice(AUTH_SESSION_RECORD_PREFIX.length) || null
      : null;
  },

  adoptSession(accessToken: string, _refreshToken?: string | null, tenantId?: string | number | null,
    sessionBinding?: string | null): string | null {
    const store = authStore();
    const previousGeneration = store.getItem(AUTH_SESSION_GENERATION_KEY);
    const previousRecord = previousGeneration ? readAuthSessionRecord(store, previousGeneration) : null;
    const committedTenantId = tenantId !== undefined && tenantId !== null
      ? String(tenantId)
      : previousRecord?.tenantId ?? store.getItem(TENANT_ID_KEY) ?? DEFAULT_TENANT_ID;
    const generation = createAuthSessionGeneration();
    if (!isImpersonatedTab() && !sessionBinding) return null;
    if (!writeAuthSessionRecord(store, generation, {
      accessToken,
      refreshToken: null,
      tenantId: committedTenantId,
    })) return null;
    if (sessionBinding && !authStoreSet(authSessionBindingKey(generation), sessionBinding)) {
      memoryAuthRecords.delete(generation);
      return null;
    }
    // Cross-tab commit marker: written last after the complete record exists.
    if (!authStoreSet(AUTH_SESSION_GENERATION_KEY, generation)) {
      memoryAuthRecords.delete(generation);
      store.removeItem(authSessionBindingKey(generation));
      return null;
    }
    // Fixed-name keys are migration-only. Remove them after commit so a failed
    // adoption cannot damage the previously active legacy session.
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
    if (committedTenantId !== null) authStoreSet(TENANT_ID_KEY, committedTenantId);
    if (previousGeneration) {
      memoryAuthRecords.delete(previousGeneration);
      store.removeItem(authSessionBindingKey(previousGeneration));
    }
    if (previousGeneration !== generation && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<SessionReplacedDetail>(SESSION_REPLACED_EVENT, {
        detail: { previousSessionGeneration: previousGeneration },
      }));
    }
    return generation;
  },

  /**
   * Serialize credential adoption across the origin and re-check ownership
   * inside the lock. IndexedDB write transactions provide the compatibility
   * lock where Web Locks are unavailable; if neither exists, fail closed.
   */
  async adoptSessionIfCurrent(
    expectedGeneration: string | null,
    accessToken: string,
    refreshToken?: string | null,
    tenantId?: string | number | null,
    sessionBinding?: string | null,
  ): Promise<string | null> {
    return this.runIfSessionCurrent(
      expectedGeneration,
      () => this.adoptSession(accessToken, refreshToken, tenantId, sessionBinding),
    );
  },

  async runIfSessionCurrent<T>(
    expectedGeneration: string | null,
    commit: () => T,
  ): Promise<T | null> {
    const guardedCommit = () => this.getSessionGeneration() === expectedGeneration
      ? commit()
      : null;
    if (typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function') {
      return navigator.locks.request(
        'nexus-auth-session-adoption',
        { mode: 'exclusive' },
        guardedCommit,
      );
    }
    return withIndexedDbAuthAdoptionLock(guardedCommit);
  },

  sessionGenerationIsCurrent(expected: string | null): boolean {
    return authStore().getItem(AUTH_SESSION_GENERATION_KEY) === expected;
  },

  getAccessToken(): string | null {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    return generation ? readAuthSessionRecord(store, generation)?.accessToken ?? null : null;
  },

  setAccessToken(token: string): void {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    const record = generation ? readAuthSessionRecord(store, generation) : null;
    if (generation && record) {
      writeAuthSessionRecord(store, generation, { ...record, accessToken: token });
      return;
    }
    const nextGeneration = generation ?? createAuthSessionGeneration();
    writeAuthSessionRecord(store, nextGeneration, {
      accessToken: token,
      refreshToken: null,
      tenantId: store.getItem(TENANT_ID_KEY),
    });
    if (!generation) authStoreSet(AUTH_SESSION_GENERATION_KEY, nextGeneration);
  },

  getRefreshToken(): string | null {
    return null;
  },

  getSessionBinding(): string | null {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    return generation ? store.getItem(authSessionBindingKey(generation)) : null;
  },

  setRefreshToken(_token: string): void {
    // Browser refresh credentials must only be set by the server cookie.
  },

  updateSessionTokens(
    expectedGeneration: string | null,
    accessToken: string,
    _refreshToken?: string | null,
  ): void {
    const store = authStore();
    const record = expectedGeneration ? readAuthSessionRecord(store, expectedGeneration) : null;
    if (expectedGeneration && record) {
      // Write only the record captured by the refresh request. A replacement
      // session may become active after the response check; it has a different
      // key and therefore cannot receive these stale credentials.
      writeAuthSessionRecord(store, expectedGeneration, {
        accessToken,
        refreshToken: null,
        tenantId: record.tenantId,
      });
      return;
    }
    if (expectedGeneration !== null) {
      writeAuthSessionRecord(store, expectedGeneration, {
        accessToken,
        refreshToken: null,
        tenantId: store.getItem(TENANT_ID_KEY),
      });
      return;
    }
    this.adoptSession(accessToken);
  },

  getTenantId(): string | null {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    const record = generation ? readAuthSessionRecord(store, generation) : null;
    if (record?.tenantId) return record.tenantId;
    // First check storage (set during login or tenant bootstrap)
    const storedTenantId = store.getItem(TENANT_ID_KEY);
    if (storedTenantId) {
      return storedTenantId;
    }
    // Fall back to environment variable (development only)
    return DEFAULT_TENANT_ID;
  },

  setTenantId(id: string | number): void {
    const value = String(id);
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    const record = generation ? readAuthSessionRecord(store, generation) : null;
    if (generation && record) {
      writeAuthSessionRecord(store, generation, { ...record, tenantId: value });
    }
    authStoreSet(TENANT_ID_KEY, value);
  },

  getTenantSlug(): string | null {
    return authStore().getItem(TENANT_SLUG_KEY);
  },

  setTenantSlug(slug: string): void {
    authStoreSet(TENANT_SLUG_KEY, slug);
  },

  clearTokens(): void {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    if (generation) memoryAuthRecords.delete(generation);
    if (generation) store.removeItem(authSessionBindingKey(generation));
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
  },

  clearSession(expectedGeneration: string | null): void {
    const store = authStore();
    if (expectedGeneration) {
      // This key belongs exclusively to the captured session. No compare then
      // delete sequence is needed, so another tab can adopt a replacement at
      // any point without its credentials being touched.
      memoryAuthRecords.delete(expectedGeneration);
      store.removeItem(authSessionBindingKey(expectedGeneration));
      return;
    }
    // Migration path for a pre-generation session. A concurrent new adoption
    // uses its own record, so removing these legacy keys cannot erase it.
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
  },

  clearAll(): void {
    const store = authStore();
    const generation = store.getItem(AUTH_SESSION_GENERATION_KEY);
    if (generation) memoryAuthRecords.delete(generation);
    if (generation) store.removeItem(authSessionBindingKey(generation));
    store.removeItem(TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
    store.removeItem(TENANT_ID_KEY);
    store.removeItem(TENANT_SLUG_KEY);
    // Impersonated sessions use tab-private sessionStorage, so removing their
    // pointer cannot race with another tab's replacement login.
    if (isImpersonatedTab()) store.removeItem(AUTH_SESSION_GENERATION_KEY);
    // Preserve trusted device token across logouts — it's meant to persist for 30 days
  },

  hasAccessToken(): boolean {
    return !!this.getAccessToken();
  },

  hasRefreshToken(): boolean {
    return !isImpersonatedTab() && !!this.getSessionBinding();
  },

  // CSRF Token management
  getCsrfToken(): string | null {
    return localStorage.getItem(CSRF_TOKEN_KEY);
  },

  setCsrfToken(token: string): void {
    safeLocalStorageSet(CSRF_TOKEN_KEY, token);
  },

  clearCsrfToken(): void {
    localStorage.removeItem(CSRF_TOKEN_KEY);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// API Client Class
// ─────────────────────────────────────────────────────────────────────────────

export class ApiClient {
  private baseUrl: string;
  private isRefreshing = false;
  private refreshPromise: Promise<TokenRefreshOutcome> | null = null;
  /**
   * Set when the refresh endpoint refused the account as under the minimum
   * age, so the session that then ends is explained rather than "expired".
   * Reset at the start of every refresh; read by handleTokenRefresh and by
   * request(), which hands the caller the refusal instead of "expired".
   */
  private minimumAgeRefusal: { message?: string } | null = null;
  private pendingRefreshWaiters = new Set<PendingRefreshWaiter>();

  // Request deduplication: track in-flight GET requests
  private inflightRequests: Map<string, Promise<ApiResponse<unknown>>> = new Map();
  private responseCache: Map<string, { expiresAt: number; response: ApiResponse<unknown> }> = new Map();

  // Cross-tab token refresh coordination. Web Locks are origin-scoped and
  // remain exclusively held until their callback settles, so a slow refresh
  // cannot outlive its ownership as it could with a time-based lease.
  private static readonly REFRESH_WEB_LOCK_NAME = 'nexus-token-refresh';
  private static readonly REFRESH_COORDINATION_TIMEOUT = 60_000;
  private static readonly REFRESH_ATTEMPT_KEY = 'nexus_token_refresh_attempt';
  private static readonly LOGOUT_GENERATION_KEY = 'nexus_logout_generation';
  private static readonly LOGOUT_IN_PROGRESS_KEY = 'nexus_logout_in_progress';
  private static readonly LOGOUT_IN_PROGRESS_TTL = 120_000;

  // Compatibility fallback only: localStorage has no atomic compare-and-set,
  // so this lease reduces duplicate refreshes but cannot guarantee exclusion
  // in browsers that do not implement the Web Locks API.
  private static readonly REFRESH_LOCK_KEY = 'nexus_token_refresh_lock';
  private static readonly REFRESH_FALLBACK_LEASE_TTL = 15_000;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;

    // Coordinate fallback refresh attempts when Web Locks are unavailable.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (e) => {
        // The impersonated tab never uses the admin's refresh cookie.
        if (isImpersonatedTab()) return;

        if (
          e.key === ApiClient.REFRESH_LOCK_KEY &&
          e.newValue === null &&
          this.pendingRefreshWaiters.size > 0
        ) {
          // Another tab's access token is private to that tab. Releasing the
          // lease only wakes this tab so it can use the rotated cookie itself.
          for (const waiter of [...this.pendingRefreshWaiters]) {
            this.resolvePendingRefreshWaiter(waiter, 'transient');
          }
        }
      });
    }
  }

  private resolvePendingRefreshWaiter(
    waiter: PendingRefreshWaiter,
    outcome: TokenRefreshOutcome,
  ): void {
    if (!this.pendingRefreshWaiters.delete(waiter)) return;
    clearTimeout(waiter.timeoutId);
    waiter.resolve(outcome);
  }

  private waitForExternalTokenRefresh(
    generationAtWait: TokenGenerationSnapshot,
  ): Promise<TokenRefreshOutcome> {
    return new Promise<TokenRefreshOutcome>((resolve) => {
      const waiter = {} as PendingRefreshWaiter;
      waiter.accessTokenAtWait = generationAtWait.accessToken;
      waiter.tenantIdAtWait = generationAtWait.tenantId;
      waiter.resolve = resolve;
      waiter.timeoutId = setTimeout(() => {
        this.resolvePendingRefreshWaiter(waiter, 'transient');
      }, ApiClient.REFRESH_FALLBACK_LEASE_TTL);
      this.pendingRefreshWaiters.add(waiter);

      // Close the gap between observing a held lock and registering this
      // waiter. The other tab may already have written its token and released
      // the lock before our storage listener was ready.
      const currentTenantId = tokenManager.getTenantId();
      if (currentTenantId !== generationAtWait.tenantId) {
        this.resolvePendingRefreshWaiter(waiter, 'transient');
      } else if (localStorage.getItem(ApiClient.REFRESH_LOCK_KEY) === null) {
        this.resolvePendingRefreshWaiter(waiter, 'transient');
      }
    });
  }

  private expireSession(
    reason: SessionEndReason = 'expired',
    expectedGeneration: string | null = tokenManager.getSessionGeneration(),
    message?: string,
  ): void {
    tokenManager.clearSession(expectedGeneration);
    this.dispatchSessionExpired(reason, expectedGeneration, message);
  }

  /**
   * The response a caller receives when the server refused the account as
   * under the minimum age. It keeps the stable code so pages can recognise it.
   */
  private minimumAgeRefusalResponse<T>(message?: string): ApiResponse<T> {
    return {
      success: false,
      error: message ?? i18n.t('login.under_minimum_age', { ns: 'auth' }),
      code: ACCOUNT_UNDER_MINIMUM_AGE,
      errors: [{ code: ACCOUNT_UNDER_MINIMUM_AGE, ...(message ? { message } : {}) }],
    };
  }

  /**
   * 🔴 `401 AUTH_MFA_REQUIRED` is not an expired session. It is the server refusing a
   * live session because the account now needs a second factor (mandatory
   * administrator two-factor went live on 12 September 2026, and every signed-in
   * administrator met this answer). A refresh cannot help — the new token carries
   * no two-factor claims either — so it is not attempted, and the member is told
   * why they were signed out instead of "your session has expired". Reading the
   * body here is safe: every path out of the 401 branch returns without it.
   */
  private async isTwoFactorRequiredRefusal(response: Response): Promise<boolean> {
    try {
      const body = await response.json();
      return body?.code === 'AUTH_MFA_REQUIRED'
        || (Array.isArray(body?.errors) && body.errors.some((e: { code?: string }) => e?.code === 'AUTH_MFA_REQUIRED'));
    } catch {
      return false;
    }
  }

  private isLogoutInProgress(
    expectedGeneration: string | null = tokenManager.getSessionGeneration(),
  ): boolean {
    const marker = localStorage.getItem(ApiClient.LOGOUT_IN_PROGRESS_KEY);
    if (!marker) return false;

    let startedAt = Number.NaN;
    let markerGeneration: string | null = null;
    try {
      const parsed = JSON.parse(marker) as { startedAt?: unknown; sessionGeneration?: unknown };
      startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : Number.NaN;
      markerGeneration = typeof parsed.sessionGeneration === 'string' ? parsed.sessionGeneration : null;
    } catch {
      // Compatibility with a marker left by the previous bundle.
      startedAt = Number.parseInt(marker.split(':', 1)[0] ?? '', 10);
      // The old marker was not session-bound. It can safely suppress only a
      // legacy, ungenerated session; it must never be attributed to a new B.
      markerGeneration = null;
    }
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > ApiClient.LOGOUT_IN_PROGRESS_TTL) {
      // A tab can disappear mid-logout. Expire its marker so that a later,
      // independent login is never permanently prevented from refreshing.
      if (localStorage.getItem(ApiClient.LOGOUT_IN_PROGRESS_KEY) === marker) {
        localStorage.removeItem(ApiClient.LOGOUT_IN_PROGRESS_KEY);
      }
      return false;
    }

    return markerGeneration === expectedGeneration;
  }

  private sessionExpiredResponse<T>(reason: SessionEndReason = 'expired'): ApiResponse<T> {
    if (reason === 'mfa_required') {
      return {
        success: false,
        error: i18n.t('session_mfa_required_message', { ns: 'errors' }),
        code: 'AUTH_MFA_REQUIRED',
      };
    }
    return {
      success: false,
      error: i18n.t('session_expired_message', { ns: 'errors' }),
      code: 'SESSION_EXPIRED',
    };
  }

  private refreshUnavailableResponse<T>(): ApiResponse<T> {
    return { success: false, code: 'AUTH_REFRESH_UNAVAILABLE' };
  }

  private tenantContextChangedResponse<T>(): ApiResponse<T> {
    return { success: false, code: 'TENANT_CONTEXT_CHANGED' };
  }

  private authContextChangedResponse<T>(): ApiResponse<T> {
    return { success: false, code: 'AUTH_CONTEXT_CHANGED' };
  }

  private captureAuthContext(): AuthContextSnapshot {
    return {
      sessionGeneration: tokenManager.getSessionGeneration(),
      tenantId: tokenManager.getTenantId(),
    };
  }

  private authContextIsUnchanged(expected: AuthContextSnapshot): boolean {
    const current = this.captureAuthContext();
    return current.sessionGeneration === expected.sessionGeneration
      && current.tenantId === expected.tenantId;
  }

  private changedContextResponse<T>(expected: AuthContextSnapshot): ApiResponse<T> {
    return tokenManager.getTenantId() !== expected.tenantId
      ? this.tenantContextChangedResponse<T>()
      : this.authContextChangedResponse<T>();
  }

  private contextChangedDownloadError(): Error {
    const error = new Error(i18n.t('session_expired_message', { ns: 'errors' }));
    error.name = 'AuthContextChangedError';
    return error;
  }

  /**
   * Clear all in-flight request cache (call on tenant switch)
   */
  clearInflightRequests(): void {
    this.inflightRequests.clear();
    this.responseCache.clear();
  }

  /**
   * Dispatch session expired event (debounced — fires at most once per 5 seconds)
   */
  private dispatchSessionExpired(
    reason: SessionEndReason = 'expired',
    sessionGeneration: string | null = tokenManager.getSessionGeneration(),
    message?: string,
  ): void {
    const now = Date.now();
    if (now - lastSessionExpiredTime > 5000) {
      lastSessionExpiredTime = now;
      window.dispatchEvent(new CustomEvent<SessionExpiredDetail>(SESSION_EXPIRED_EVENT, {
        detail: message === undefined
          ? { reason, sessionGeneration }
          : { reason, sessionGeneration, message },
      }));
    }
  }

  /**
   * Dispatch API error event for toast notifications
   */
  private dispatchApiError(message: string, code: string, endpoint: string): void {
    window.dispatchEvent(
      new CustomEvent<ApiErrorEventDetail>(API_ERROR_EVENT, {
        detail: { message, code, endpoint },
      })
    );
  }

  /**
   * Generate a cache key for request deduplication
   */
  private getCacheKey(endpoint: string, options: RequestOptions): string {
    // Include tenant id so an in-flight GET dispatched under tenant A
    // cannot be reused to serve a second caller under tenant B after a
    // rapid tenant switch. Without this, identical URLs share a cache
    // entry across tenants and leak the wrong tenant's data.
    const tenantId = tokenManager.getTenantId() ?? '-';
    const sessionGeneration = options.skipAuth ? '-' : tokenManager.getSessionGeneration() ?? '-';
    return `${options.method || 'GET'}:${endpoint}#t=${tenantId}#s=${sessionGeneration}`;
  }

  private getResponseCacheTtl(endpoint: string, options: RequestOptions): number {
    if (options.cacheTtlMs !== undefined) {
      return Math.max(0, options.cacheTtlMs);
    }

    const path = endpoint.split('?')[0] ?? endpoint;
    if (
      path === '/v2/tenant/bootstrap' ||
      path === '/v2/tenants' ||
      path === '/v2/platform/stats' ||
      path === '/v2/categories' ||
      path === '/v2/marketplace/categories' ||
      /^\/v2\/marketplace\/categories\/\d+\/template$/.test(path)
    ) {
      return 5 * 60 * 1000;
    }

    return 0;
  }

  /**
   * Build headers for API requests
   */
  private buildHeaders(options: RequestOptions = {}): Headers {
    const headers = new Headers(options.headers);

    // Set content type for JSON body
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    // Accept JSON
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    this.applyLanguageHeader(headers);

    // Add auth token unless explicitly skipped
    if (!options.skipAuth) {
      const token = tokenManager.getAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    // Add tenant ID unless explicitly skipped
    if (!options.skipTenant) {
      const tenantId = tokenManager.getTenantId();
      if (tenantId) {
        headers.set('X-Tenant-ID', tenantId);
      }
    }


    // Add CSRF token for state-changing requests (POST, PUT, PATCH, DELETE)
    const method = options.method?.toUpperCase() || 'GET';
    if (!options.skipCsrf && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrfToken = tokenManager.getCsrfToken();
      if (csrfToken) {
        headers.set('X-CSRF-Token', csrfToken);
      }
    }

    return headers;
  }

  /**
   * Tell the server which language the app is actually being read in.
   *
   * The backend resolves a request's locale from, in order: an explicit
   * `?locale=`, the signed-in member's saved preference, this header, then the
   * platform default. Sending it therefore cannot override anybody's saved
   * choice — it only replaces the *browser's* Accept-Language, which is what the
   * server had to guess from before, and which is frequently not the language
   * the member picked in the app.
   *
   * It matters most where there is no saved preference to read: registration,
   * password reset, email verification, and every other request made before
   * signing in. Those were served in the browser's language no matter what the
   * visitor had selected.
   *
   * The region subtag is dropped (`pt-BR` → `pt`) because the backend's locale
   * directories are language-only, and an unrecognised code is not sent at all
   * rather than being sent for the server to discard.
   */
  private applyLanguageHeader(headers: Headers): void {
    // A caller that set the header deliberately outranks this.
    if (headers.has('Accept-Language')) return;

    const language = (i18n.language || '').split('-')[0] ?? '';
    if (!(SUPPORTED_LOCALE_CODES as readonly string[]).includes(language)) return;

    headers.set('Accept-Language', language);
  }

  /**
   * Attempt to refresh the access token
   */
  private async refreshAccessToken(signal?: AbortSignal): Promise<TokenRefreshOutcome> {
    this.minimumAgeRefusal = null;
    const logoutGenerationAtStart = localStorage.getItem(ApiClient.LOGOUT_GENERATION_KEY);
    const authContextAtStart = this.captureAuthContext();
    if (this.isLogoutInProgress(authContextAtStart.sessionGeneration)) {
      return 'invalid';
    }

    const sessionBinding = tokenManager.getSessionBinding();
    if (!tokenManager.hasRefreshToken() || !sessionBinding) {
      return 'invalid';
    }

    try {
      const refreshHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Nexus-Session-Binding': sessionBinding,
      };
      const tenantId = tokenManager.getTenantId();
      if (tenantId) {
        refreshHeaders['X-Tenant-ID'] = tenantId;
      }

      const response = await fetch(`${this.baseUrl}/auth/refresh-token`, {
        method: 'POST',
        headers: refreshHeaders,
        body: '{}',
        credentials: 'include',
        signal,
      });

      if (!this.authContextIsUnchanged(authContextAtStart)) {
        return 'context_changed';
      }

      if (!response.ok) {
        // Credential and account-policy rejections are authoritative. Server,
        // rate-limit, and transport failures are temporary and must not delete
        // an otherwise valid refresh token.
        if (response.status === 409) {
          const conflict = await response.json().catch(() => null);
          if (!this.authContextIsUnchanged(authContextAtStart)) {
            return 'context_changed';
          }
          if (hasApiErrorCode(conflict, 'AUTH_REFRESH_SUPERSEDED')) {
            // Another request already consumed and rotated this token. Preserve
            // the locally stored credentials; cross-tab generation checks stop
            // queued Web Lock owners from presenting the old token again.
            return 'transient';
          }
        }
        if (response.status === 403) {
          const refusal = await response.json().catch(() => null) as { errors?: ApiErrorDetail[] } | null;
          if (hasApiErrorCode(refusal, ACCOUNT_UNDER_MINIMUM_AGE)) {
            this.minimumAgeRefusal = { message: serverMessageFor(refusal?.errors, ACCOUNT_UNDER_MINIMUM_AGE) };
          }
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
          return 'invalid';
        }
        return 'transient';
      }

      const data = await response.json();

      if (
        signal?.aborted
        || !this.authContextIsUnchanged(authContextAtStart)
        || this.isLogoutInProgress(authContextAtStart.sessionGeneration)
        || localStorage.getItem(ApiClient.LOGOUT_GENERATION_KEY) !== logoutGenerationAtStart
      ) {
        return 'transient';
      }

      if (data.success && data.access_token) {
        if (typeof data.session_binding !== 'string' || !data.session_binding) {
          return 'invalid';
        }
        if (authContextAtStart.sessionGeneration !== null
            && tokenManager.getSessionBinding() !== data.session_binding) {
          // A delayed issuer response can replace the browser cookie before
          // this tab can reject it. Never adopt another session on refresh.
          return 'invalid';
        }
        // The response rotated the HttpOnly cookie. Keep its short-lived
        // access credential only in this tab's process memory.
        if (authContextAtStart.sessionGeneration === null) {
          const generation = await tokenManager.adoptSessionIfCurrent(
            null,
            data.access_token,
            null,
            authContextAtStart.tenantId,
            data.session_binding,
          );
          return generation ? 'refreshed' : 'context_changed';
        }
        tokenManager.updateSessionTokens(authContextAtStart.sessionGeneration, data.access_token);

        if (!this.authContextIsUnchanged(authContextAtStart)) {
          tokenManager.clearSession(authContextAtStart.sessionGeneration);
          return 'context_changed';
        }
        return 'refreshed';
      }

      return 'invalid';
    } catch {
      return 'transient';
    }
  }

  private captureTokenGeneration(): TokenGenerationSnapshot {
    return {
      accessToken: tokenManager.getAccessToken(),
      refreshToken: tokenManager.getRefreshToken(),
      refreshAttempt: localStorage.getItem(ApiClient.REFRESH_ATTEMPT_KEY),
      logoutGeneration: localStorage.getItem(ApiClient.LOGOUT_GENERATION_KEY),
      tenantId: tokenManager.getTenantId(),
      sessionGeneration: tokenManager.getSessionGeneration(),
    };
  }

  /**
   * Return the shared outcome when another tab changed the token generation
   * while this request was queued, or null when this tab still needs to refresh.
   */
  private outcomeAfterGenerationChange(
    generationAtQueueTime: TokenGenerationSnapshot,
  ): TokenRefreshOutcome | null {
    const current = this.captureTokenGeneration();
    if (current.logoutGeneration !== generationAtQueueTime.logoutGeneration) {
      return 'invalid';
    }
    if (current.sessionGeneration !== generationAtQueueTime.sessionGeneration) {
      return 'context_changed';
    }
    if (current.tenantId !== generationAtQueueTime.tenantId) {
      // Never refresh or retry work from one tenant with another tenant's
      // credentials. The caller receives a non-authoritative transient result.
      return 'transient';
    }
    const tokensChanged = current.accessToken !== generationAtQueueTime.accessToken
      || current.refreshToken !== generationAtQueueTime.refreshToken;
    if (tokensChanged) {
      return current.accessToken ? 'refreshed' : 'invalid';
    }

    // A prior lock owner may have received a transient response (notably the
    // server's AUTH_REFRESH_SUPERSEDED conflict) without receiving replacement
    // credentials. Queued owners must inherit that outcome rather than retrying
    // the same single-use token immediately.
    if (current.refreshAttempt !== generationAtQueueTime.refreshAttempt) {
      return 'transient';
    }

    return null;
  }

  private publishTransientRefreshAttempt(): void {
    safeLocalStorageSet(
      ApiClient.REFRESH_ATTEMPT_KEY,
      `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    );
  }

  private tokenGenerationIsUnchanged(
    generationAtQueueTime: TokenGenerationSnapshot,
  ): boolean {
    const current = this.captureTokenGeneration();
    if (
      current.accessToken === generationAtQueueTime.accessToken
      && current.refreshToken === generationAtQueueTime.refreshToken
      && current.refreshAttempt === generationAtQueueTime.refreshAttempt
      && current.logoutGeneration === generationAtQueueTime.logoutGeneration
      && current.tenantId === generationAtQueueTime.tenantId
      && current.sessionGeneration === generationAtQueueTime.sessionGeneration
    ) {
      return true;
    }

    return false;
  }

  private supportsWebLocks(): boolean {
    return typeof navigator !== 'undefined'
      && typeof navigator.locks?.request === 'function';
  }

  /**
   * Atomically coordinate refresh across tabs with the browser Web Locks API.
   * The abort signal bounds both time spent queued and the owned refresh. The
   * exclusive lock remains held for the full refresh callback, regardless of
   * whether it exceeds the compatibility fallback's historical 15-second lease.
   */
  private async refreshWithWebLock(
    generationAtQueueTime: TokenGenerationSnapshot,
  ): Promise<TokenRefreshOutcome> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      ApiClient.REFRESH_COORDINATION_TIMEOUT,
    );

    try {
      return await navigator.locks.request(
        ApiClient.REFRESH_WEB_LOCK_NAME,
        { mode: 'exclusive', signal: controller.signal },
        async () => {
          // A queued request must re-read shared storage only after acquiring
          // the lock. If the prior owner rotated, presenting the old single-use
          // refresh token would be treated as replay by the server.
          const queuedOutcome = this.outcomeAfterGenerationChange(generationAtQueueTime);
          if (queuedOutcome !== null) {
            return queuedOutcome;
          }

          const outcome = await this.refreshAccessToken(controller.signal);
          if (outcome === 'transient' && this.tokenGenerationIsUnchanged(generationAtQueueTime)) {
            this.publishTransientRefreshAttempt();
          } else if (outcome === 'invalid') {
            // Publish the invalid generation before releasing the Web Lock so
            // the next queued owner cannot submit the same rejected token.
            tokenManager.clearSession(generationAtQueueTime.sessionGeneration);
          }

          return outcome;
        },
      );
    } catch {
      // Lock-wait timeouts and Web Locks failures are transient. Keep the
      // credentials so a later request can retry safely.
      return 'transient';
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Compatibility fallback for browsers without Web Locks. localStorage does
   * not provide atomic lock acquisition, so this is best-effort coordination
   * only and must not be treated as equivalent to an exclusive Web Lock.
   */
  private acquireRefreshLock(): boolean {
    const now = Date.now();
    const existing = localStorage.getItem(ApiClient.REFRESH_LOCK_KEY);
    if (existing) {
      const lockTime = parseInt(existing, 10);
      if (now - lockTime < ApiClient.REFRESH_FALLBACK_LEASE_TTL) {
        return false; // Another tab holds a valid lock
      }
    }
    safeLocalStorageSet(ApiClient.REFRESH_LOCK_KEY, String(now));
    return true;
  }

  private releaseRefreshLock(): void {
    localStorage.removeItem(ApiClient.REFRESH_LOCK_KEY);
  }

  private async refreshWithCompatibilityFallback(
    generationAtQueueTime: TokenGenerationSnapshot,
  ): Promise<TokenRefreshOutcome> {
    if (!this.acquireRefreshLock()) {
      await this.waitForExternalTokenRefresh(generationAtQueueTime);
      const queuedOutcome = this.outcomeAfterGenerationChange(generationAtQueueTime);
      if (queuedOutcome !== null) return queuedOutcome;
      if (!this.acquireRefreshLock()) return 'transient';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      ApiClient.REFRESH_COORDINATION_TIMEOUT,
    );

    try {
      const queuedOutcome = this.outcomeAfterGenerationChange(generationAtQueueTime);
      return queuedOutcome ?? await this.refreshAccessToken(controller.signal);
    } finally {
      clearTimeout(timeoutId);
      this.releaseRefreshLock();
    }
  }

  /**
   * Handle token refresh with request queuing and cross-tab coordination
   */
  private async handleTokenRefresh(): Promise<TokenRefreshOutcome> {
    const generationAtQueueTime = this.captureTokenGeneration();
    if (this.isLogoutInProgress(generationAtQueueTime.sessionGeneration)) {
      this.expireSession('expired', generationAtQueueTime.sessionGeneration);
      return 'invalid';
    }

    // If this tab is already refreshing, wait for the result
    if (this.isRefreshing && this.refreshPromise) {
      return this.refreshPromise;
    }

    this.isRefreshing = true;
    this.refreshPromise = this.supportsWebLocks()
      ? this.refreshWithWebLock(generationAtQueueTime)
      : this.refreshWithCompatibilityFallback(generationAtQueueTime);

    try {
      const outcome = await this.refreshPromise;

      if (outcome === 'refreshed') {
        // Clear the in-flight request cache so retries after token refresh
        // get a fresh response with the new token rather than the cached 401.
        this.inflightRequests.clear();
      } else if (outcome === 'invalid') {
        const refusal = this.minimumAgeRefusal;
        if (refusal) {
          this.expireSession('under_minimum_age', generationAtQueueTime.sessionGeneration, refusal.message);
        } else {
          this.expireSession('expired', generationAtQueueTime.sessionGeneration);
        }
      }

      return outcome;
    } finally {
      this.isRefreshing = false;
      this.refreshPromise = null;
    }
  }

  /**
   * Refresh the shared login session through the same single-flight and
   * cross-tab coordinator used by automatic 401 recovery.
   *
   * Interactive callers must use this entrypoint instead of posting a refresh
   * token directly. Rotating refresh tokens are single-use, so parallel
   * refresh requests are correctly treated by the server as credential replay.
   */
  async refreshSession(): Promise<TokenRefreshOutcome> {
    return this.handleTokenRefresh();
  }

  /**
   * Revoke and clear a session without allowing a delayed refresh response to
   * resurrect it. The origin-wide marker stops writes immediately; Web Locks
   * then orders the logout request with every modern-browser refresh owner.
   * The server accepts any tracked generation from the family for revocation,
   * so the compatibility path remains safe when Web Locks are unavailable.
   */
  async logoutSession(
    _refreshToken: string | null = tokenManager.getRefreshToken(),
    expectedSessionGeneration: string | null = tokenManager.getSessionGeneration(),
  ): Promise<ApiResponse<unknown>> {
    const authContextAtStart = this.captureAuthContext();
    const sessionBindingAtStart = tokenManager.getSessionBinding();
    const marker = JSON.stringify({
      startedAt: Date.now(),
      sessionGeneration: expectedSessionGeneration,
      nonce: Math.random().toString(36).slice(2),
    });
    safeLocalStorageSet(ApiClient.LOGOUT_IN_PROGRESS_KEY, marker);
    safeLocalStorageSet(ApiClient.LOGOUT_GENERATION_KEY, marker);

    const performLogout = async (): Promise<ApiResponse<unknown>> => {
      let response: ApiResponse<unknown>;
      try {
        response = await this.request<unknown>(
          '/auth/logout',
          {
            method: 'POST',
            body: {},
            headers: sessionBindingAtStart
              ? { 'X-Nexus-Session-Binding': sessionBindingAtStart }
              : undefined,
          },
          false,
          authContextAtStart,
        );
      } catch {
        response = { success: false, code: 'AUTH_LOGOUT_UNAVAILABLE' };
      } finally {
        // Clear while the logout marker is still active. An already-running
        // refresh compares the persistent generation before any token write.
        tokenManager.clearSession(expectedSessionGeneration);
        if (!tokenManager.getAccessToken()) {
          this.inflightRequests.clear();
          this.responseCache.clear();
          for (const waiter of [...this.pendingRefreshWaiters]) {
            this.resolvePendingRefreshWaiter(waiter, 'invalid');
          }
        }
      }

      return response;
    };

    try {
      if (this.supportsWebLocks()) {
        return await navigator.locks.request(
          ApiClient.REFRESH_WEB_LOCK_NAME,
          { mode: 'exclusive' },
          performLogout,
        );
      }
      return await performLogout();
    } catch {
      // A browser lock implementation failure must not prevent local logout or
      // the best-effort family-revocation request.
      return await performLogout();
    } finally {
      if (localStorage.getItem(ApiClient.LOGOUT_IN_PROGRESS_KEY) === marker) {
        localStorage.removeItem(ApiClient.LOGOUT_IN_PROGRESS_KEY);
      }
    }
  }

  /**
   * Make an API request with automatic retry on 401
   */
  async request<T>(
    endpoint: string,
    options: RequestOptions = {},
    retryOnUnauthorized = true,
    expectedAuthContext?: AuthContextSnapshot,
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    const authContextAtRequestStart = expectedAuthContext ?? this.captureAuthContext();
    if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
      return this.changedContextResponse<T>(authContextAtRequestStart);
    }
    const headers = this.buildHeaders(options);
    const body = options.body ? JSON.stringify(options.body) : undefined;
    const method = options.method?.toUpperCase() || 'GET';

    // Track request timing for Sentry
    const startTime = performance.now();

    // Request timeout (default 30s, configurable per-request)
    const timeout = options.timeout ?? 30000;
    const controller = new AbortController();
    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeout);

    // Combine timeout signal with caller-provided signal (if any) so that
    // either aborting the timeout OR the caller's AbortController cancels the fetch.
    const callerSignal = options.signal as AbortSignal | undefined;
    let combinedSignal: AbortSignal = controller.signal;
    if (callerSignal) {
      // AbortSignal.any() is supported in Chrome 116+, Safari 17.4+, Firefox 124+.
      // Fall back to linking signals manually for older browsers.
      if ('any' in AbortSignal) {
        combinedSignal = AbortSignal.any([controller.signal, callerSignal]);
      } else {
        // Legacy fallback: when the caller aborts, abort our controller too
        if (callerSignal.aborted) {
          controller.abort(callerSignal.reason);
        } else {
          callerSignal.addEventListener('abort', () => controller.abort(callerSignal.reason), { once: true });
        }
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        body,
        credentials: 'include',
        signal: combinedSignal,
      });
      clearTimeout(timeoutId);

      if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
        return this.changedContextResponse<T>(authContextAtRequestStart);
      }

      // Capture API call in Sentry (success or error)
      const duration = performance.now() - startTime;
      captureTelemetryApiCall(method, endpoint, response.status, duration);
      recordApiDiagnostic({ method, endpoint, status: response.status, durationMs: duration });

      // Stale-client gate — every response carries the server's build SHA.
      // Triggers the soft-update path on first mismatch and force-redirects
      // to /api/sw-reset if the mismatch persists past the grace window.
      checkStaleBuild(response);

      // Handle 401 Unauthorized with exactly one token refresh and retry.
      if (response.status === 401 && !options.skipAuth) {
        const isTwoFactorRequired = await this.isTwoFactorRequiredRefusal(response);
        if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
        if (isTwoFactorRequired) {
          this.expireSession('mfa_required', authContextAtRequestStart.sessionGeneration);
          return this.sessionExpiredResponse<T>('mfa_required');
        }
        if (retryOnUnauthorized) {
          // A response from tenant A must never be retried after the user has
          // switched to tenant B; that could replay a state-changing body in
          // the wrong community with B's newly stored credentials.
          if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
            return this.changedContextResponse<T>(authContextAtRequestStart);
          }

          const outcome = await this.handleTokenRefresh();

          if (outcome === 'refreshed') {
            if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
              return this.changedContextResponse<T>(authContextAtRequestStart);
            }
            return this.request<T>(endpoint, options, false, authContextAtRequestStart);
          }
          if (outcome === 'context_changed') {
            return this.changedContextResponse<T>(authContextAtRequestStart);
          }
          if (outcome === 'transient') {
            return this.refreshUnavailableResponse<T>();
          }
          if (this.minimumAgeRefusal) {
            return this.minimumAgeRefusalResponse<T>(this.minimumAgeRefusal.message);
          }
          return this.sessionExpiredResponse<T>();
        }

        // A freshly-issued access token was explicitly rejected. Do not enter
        // another refresh cycle; deterministically expire the session.
        this.expireSession('expired', authContextAtRequestStart.sessionGeneration);
        return this.sessionExpiredResponse<T>();
      }

      // Handle 503 Service Unavailable (maintenance mode — body may be HTML, not JSON)
      if (response.status === 503) {
        try {
          const maintenanceData = await response.json() as Record<string, unknown>;
          if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
            return this.changedContextResponse<T>(authContextAtRequestStart);
          }
          const errors = Array.isArray(maintenanceData.errors)
            ? maintenanceData.errors as ApiErrorDetail[]
            : undefined;
          const firstError = errors?.[0];
          const code = maintenanceData.code ?? firstError?.code;
          if (code === 'MAINTENANCE_MODE') {
            return {
              success: false,
              error: (maintenanceData.error ?? firstError?.message ?? maintenanceData.message) as string | undefined,
              code,
            };
          }
        } catch {
          // Apache/proxies may return an HTML 503. Use the generic retryable
          // service-unavailable result below in that case.
        }
        return {
          success: false,
          error: i18n.t('api.service_unavailable', { ns: 'errors' }),
          code: 'SERVICE_UNAVAILABLE',
        };
      }

      if (response.ok && options.responseType === 'blob') {
        const data = await response.blob();
        if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
        return { success: true, data: data as T };
      }

      if (response.ok && options.responseType === 'text') {
        const data = await response.text();
        if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
        return { success: true, data: data as T };
      }

      // Parse JSON response
      let data;
      try {
        data = await response.json();
        if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
      } catch {
        if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
        if (response.ok) {
          return { success: true, data: undefined as T };
        }
        return {
          success: false,
          error: i18n.t('api.invalid_response', { ns: 'errors' }),
          code: 'PARSE_ERROR',
        };
      }

      // Handle successful response
      if (response.ok) {
        // Handle null/empty body (e.g. 204 No Content)
        if (data === null || data === undefined) {
          return { success: true, data: undefined as T };
        }

        if (typeof data === 'object' && data !== null && 'success' in data && data.success === false) {
          // 2FA-required is a partial success: HTTP 200 with success:false but
          // requires_2fa:true or requires_2fa_setup:true. Pass the payload through so the caller
          // (AuthContext) can branch on requires_2fa instead of treating it as
          // a login error.
          if (data.requires_2fa === true || data.requires_2fa_setup === true) {
            return { success: true, data: data as T, message: data.message, meta: data.meta };
          }

          const errors = Array.isArray(data.errors) ? data.errors as ApiErrorDetail[] : undefined;
          const firstError = errors && errors.length > 0 ? errors[0] : null;
          const result: ApiResponse<T> = {
            success: false,
            error: data.error ?? firstError?.message ?? data.message ?? i18n.t('api.request_failed', { ns: 'errors' }),
            code: data.code ?? firstError?.code ?? 'REQUEST_FAILED',
            errors,
            meta: data.meta,
          };

          validateResponse(apiResponseSchema, result, `${options.method || 'GET'} ${endpoint}`);

          return result;
        }

        const result: ApiResponse<T> = {
          success: true,
          data: typeof data === 'object' && data !== null && 'data' in data ? data.data : data,
          message: data.message,
          meta: data.meta,
        };

        // Dev-only: validate the response envelope structure
        validateResponse(apiResponseSchema, result, `${options.method || 'GET'} ${endpoint}`);

        return result;
      }

      // Handle error response (v2 API uses {errors: [{code, message}]}, v1 uses {error, code})
      const errors = Array.isArray(data.errors) ? data.errors as ApiErrorDetail[] : undefined;
      const firstError = errors && errors.length > 0 ? errors[0] : null;
      const errorMessage = data.error ?? firstError?.message ?? data.message ?? i18n.t('api.request_failed', { ns: 'errors' });
      const errorCode = data.code ?? firstError?.code ?? `HTTP_${response.status}`;

      // Adults-only decision 2026-09-25: the server refuses every authenticated
      // request from an account whose recorded date of birth is under 18. No
      // refresh or retry can change that, so the session ends here, for every
      // page at once, with the server's explanation. Sign-in calls (skipAuth)
      // carry no session and are explained by their caller instead.
      if (
        response.status === 403
        && !options.skipAuth
        && (errorCode === ACCOUNT_UNDER_MINIMUM_AGE || hasApiErrorCode(data, ACCOUNT_UNDER_MINIMUM_AGE))
      ) {
        const message = serverMessageFor(errors, ACCOUNT_UNDER_MINIMUM_AGE);
        this.expireSession('under_minimum_age', authContextAtRequestStart.sessionGeneration, message);
        return this.minimumAgeRefusalResponse<T>(message);
      }

      // Dispatch global error for server errors (5xx) so useApiErrorHandler can show toasts.
      // Client errors (4xx) are typically handled by the calling component.
      if (response.status >= 500) {
        this.dispatchApiError(errorMessage, errorCode, endpoint);
      }

      return {
        success: false,
        error: errorMessage,
        code: errorCode,
        errors,
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
        return this.changedContextResponse<T>(authContextAtRequestStart);
      }

      // Caller cancellation is an expected control-flow outcome and must not
      // be surfaced as a timeout or dispatched to the global error UI.
      if (isAbortError(error)) {
        if (callerSignal?.aborted && !didTimeout) {
          return { success: false, code: 'CANCELLED' };
        }

        const duration = performance.now() - startTime;
        captureTelemetryApiCall(method, endpoint, 408, duration); // 408 Request Timeout
        recordApiDiagnostic({ method, endpoint, status: 408, durationMs: duration });
        const message = i18n.t('api.request_timeout', { ns: 'errors' });
        this.dispatchApiError(message, 'TIMEOUT', endpoint);
        return { success: false, error: message, code: 'TIMEOUT' };
      }

      // Network or other error - sanitize for production
      const message = i18n.t('api.network_error', { ns: 'errors' });
      this.dispatchApiError(message, 'NETWORK_ERROR', endpoint);
      return {
        success: false,
        error: message,
        code: 'NETWORK_ERROR',
      };
    }
  }

  /**
   * GET request with deduplication
   * Concurrent identical GET requests will return the same promise
   */
  async get<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    // Abortable GET requests should not share an in-flight promise, because one caller
    // cancelling its request would poison every other caller that reused the same promise.
    if (options?.signal) {
      return this.request<T>(endpoint, { ...options, method: 'GET' });
    }

    const requestOptions = { ...options, method: 'GET' };
    const cacheKey = this.getCacheKey(endpoint, requestOptions);
    const cacheTtl = this.getResponseCacheTtl(endpoint, requestOptions);

    if (cacheTtl > 0) {
      const cached = this.responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.response as ApiResponse<T>;
      }
      if (cached) {
        this.responseCache.delete(cacheKey);
      }
    }

    // Check for in-flight request
    const inflight = this.inflightRequests.get(cacheKey);
    if (inflight) {
      return inflight as Promise<ApiResponse<T>>;
    }

    // Create new request
    const promise = this.request<T>(endpoint, requestOptions).then((response) => {
      if (cacheTtl > 0 && response.success) {
        this.responseCache.set(cacheKey, {
          expiresAt: Date.now() + cacheTtl,
          response: response as ApiResponse<unknown>,
        });
      }
      return response;
    });

    // Store in-flight request
    this.inflightRequests.set(cacheKey, promise as Promise<ApiResponse<unknown>>);

    // Clean up after completion
    promise.finally(() => {
      this.inflightRequests.delete(cacheKey);
    });

    return promise;
  }

  /**
   * POST request
   */
  async post<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body });
  }

  /**
   * PUT request
   */
  async put<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body });
  }

  /**
   * PATCH request
   */
  async patch<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body });
  }

  /**
   * DELETE request
   */
  async delete<T>(endpoint: string, options?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Download a file (blob response) with full auth/tenant handling.
   * Returns the Blob on success, throws on failure.
   * Handles 401 with automatic token refresh + retry.
   */
  async download(
    endpoint: string,
    options: RequestOptions & { filename?: string } = {}
  ): Promise<Blob> {
    return this.downloadWithRetry(endpoint, options, true);
  }

  private async downloadWithRetry(
    endpoint: string,
    options: RequestOptions & { filename?: string },
    retryOnUnauthorized: boolean,
    expectedAuthContext?: AuthContextSnapshot,
  ): Promise<Blob> {
    const authContextAtRequestStart = expectedAuthContext ?? this.captureAuthContext();
    if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
      throw this.contextChangedDownloadError();
    }
    const url = `${this.baseUrl}${endpoint}`;
    const headers = this.buildHeaders(options);
    // Override Accept to allow any content type from the server
    headers.delete('Accept');

    const response = await fetch(url, {
      ...options,
      method: options.method?.toUpperCase() || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: 'include',
    });

    if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
      throw this.contextChangedDownloadError();
    }

    // Stale-client gate — same check as request(), gates blob downloads too.
    checkStaleBuild(response);

    // Handle 401 with exactly one token refresh and retry.
    if (response.status === 401 && !options.skipAuth) {
      const isTwoFactorRequired = await this.isTwoFactorRequiredRefusal(response);
      if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
        throw this.contextChangedDownloadError();
      }
      if (isTwoFactorRequired) {
        this.expireSession('mfa_required', authContextAtRequestStart.sessionGeneration);
        throw new Error(i18n.t('session_mfa_required_message', { ns: 'errors' }));
      }
      if (retryOnUnauthorized) {
        const outcome = await this.handleTokenRefresh();
        if (outcome === 'refreshed') {
          if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
            throw this.contextChangedDownloadError();
          }
          return this.downloadWithRetry(endpoint, options, false, authContextAtRequestStart);
        }
        if (outcome === 'context_changed') throw this.contextChangedDownloadError();
        if (outcome === 'transient') {
          throw new Error(i18n.t('api.download_failed_status', { ns: 'errors', status: response.status }));
        }
      } else {
        this.expireSession('expired', authContextAtRequestStart.sessionGeneration);
      }
      throw new Error(i18n.t('session_expired_message', { ns: 'errors' }));
    }

    if (!response.ok) {
      throw new Error(i18n.t('api.download_failed_status', { ns: 'errors', status: response.status }));
    }

    const blob = await response.blob();
    if (!options.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
      throw this.contextChangedDownloadError();
    }

    // Auto-trigger download if filename is provided
    if (options.filename) {
      // Try to get filename from Content-Disposition header first
      const disposition = response.headers.get('Content-Disposition');
      let resolvedFilename = options.filename;
      if (disposition) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match?.[1]) {
          resolvedFilename = match[1].replace(/['"]/g, '');
        }
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = resolvedFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }

    return blob;
  }

  /**
   * Upload file(s) - multipart form data
   */
  async upload<T>(
    endpoint: string,
    files: File | File[] | FormData,
    fieldName = 'file',
    options?: RequestOptions
  ): Promise<ApiResponse<T>> {
    return this.uploadWithRetry<T>(endpoint, files, fieldName, options, true);
  }

  private async uploadWithRetry<T>(
    endpoint: string,
    files: File | File[] | FormData,
    fieldName: string,
    options: RequestOptions | undefined,
    retryOnUnauthorized: boolean,
    expectedAuthContext?: AuthContextSnapshot,
  ): Promise<ApiResponse<T>> {
    const authContextAtRequestStart = expectedAuthContext ?? this.captureAuthContext();
    if (!options?.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
      return this.changedContextResponse<T>(authContextAtRequestStart);
    }
    let formData: FormData;

    if (files instanceof FormData) {
      formData = files;
    } else {
      formData = new FormData();
      const fileArray = Array.isArray(files) ? files : [files];
      fileArray.forEach((file, index) => {
        const name = fileArray.length === 1 ? fieldName : `${fieldName}[${index}]`;
        formData.append(name, file);
      });
    }

    // H9/L10: Build headers WITHOUT Content-Type — browser must set it with the multipart boundary.
    // Explicitly delete it to guard against inherited values from options.headers.
    const headers = new Headers(options?.headers);
    headers.delete('Content-Type'); // L10: force-remove in case it was inherited
    headers.set('Accept', 'application/json');

    // Uploads build their own headers rather than going through buildHeaders(),
    // so the language has to be attached here too — an upload can be refused,
    // and its refusal is read by the member like any other.
    this.applyLanguageHeader(headers);

    if (!options?.skipAuth) {
      const token = tokenManager.getAccessToken();
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    }

    if (!options?.skipTenant) {
      const tenantId = tokenManager.getTenantId();
      if (tenantId) {
        headers.set('X-Tenant-ID', tenantId);
      }
    }

    // Add CSRF token for file uploads (state-changing request)
    const csrfToken = tokenManager.getCsrfToken();
    if (csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }

    // Progress-aware uploads use XHR — fetch() exposes no upload progress events.
    if (options?.onUploadProgress) {
      return this.xhrUpload<T>(
        endpoint,
        formData,
        headers,
        options,
        options.onUploadProgress,
        retryOnUnauthorized,
        authContextAtRequestStart,
      );
    }

    // Uploads should not be subject to the 30s default timeout — use 2 minutes
    const uploadController = new AbortController();
    let uploadTimedOut = false;
    const uploadTimeoutId = setTimeout(() => {
      uploadTimedOut = true;
      uploadController.abort();
    }, 120000);

    // H9: Combine upload timeout signal with optional caller AbortSignal
    const callerSignal = options?.signal as AbortSignal | undefined;
    let uploadSignal: AbortSignal = uploadController.signal;
    if (callerSignal) {
      if ('any' in AbortSignal) {
        uploadSignal = AbortSignal.any([uploadController.signal, callerSignal]);
      } else {
        if (callerSignal.aborted) {
          uploadController.abort(callerSignal.reason);
        } else {
          callerSignal.addEventListener('abort', () => uploadController.abort(callerSignal.reason), { once: true });
        }
      }
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData,
        credentials: 'include',
        signal: uploadSignal,
      });
      clearTimeout(uploadTimeoutId);

      if (!options?.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
        return this.changedContextResponse<T>(authContextAtRequestStart);
      }

      // Stale-client gate — uploads count as API calls too.
      checkStaleBuild(response);

      if (response.status === 401 && !options?.skipAuth) {
        const isTwoFactorRequired = await this.isTwoFactorRequiredRefusal(response);
        if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
          return this.changedContextResponse<T>(authContextAtRequestStart);
        }
        if (isTwoFactorRequired) {
          this.expireSession('mfa_required', authContextAtRequestStart.sessionGeneration);
          return this.sessionExpiredResponse<T>('mfa_required');
        }
        if (retryOnUnauthorized) {
          const outcome = await this.handleTokenRefresh();
          if (outcome === 'refreshed') {
            if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
              return this.changedContextResponse<T>(authContextAtRequestStart);
            }
            return this.uploadWithRetry<T>(endpoint, files, fieldName, options, false, authContextAtRequestStart);
          }
          if (outcome === 'context_changed') {
            return this.changedContextResponse<T>(authContextAtRequestStart);
          }
          if (outcome === 'transient') {
            return this.refreshUnavailableResponse<T>();
          }
        } else {
          this.expireSession('expired', authContextAtRequestStart.sessionGeneration);
        }
        return this.sessionExpiredResponse<T>();
      }

      const data = await response.json();

      if (!options?.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
        return this.changedContextResponse<T>(authContextAtRequestStart);
      }

      if (response.ok) {
        if (data === null || data === undefined) {
          return { success: true, data: undefined as T };
        }
        if (typeof data === 'object' && data !== null && 'success' in data && data.success === false) {
          const errors = Array.isArray(data.errors) ? data.errors as ApiErrorDetail[] : undefined;
          const firstError = errors && errors.length > 0 ? errors[0] : null;
          return {
            success: false,
            error: data.error ?? firstError?.message ?? data.message ?? i18n.t('api.upload_failed', { ns: 'errors' }),
            code: data.code ?? firstError?.code ?? 'UPLOAD_ERROR',
            errors,
            meta: data.meta,
          };
        }
        return { success: true, data: typeof data === 'object' && 'data' in data ? data.data : data, meta: data.meta };
      }

      // Handle error response (v2 API uses {errors: [{code, message}]}, v1 uses {error, code})
      const errors = Array.isArray(data.errors) ? data.errors as ApiErrorDetail[] : undefined;
      const firstError = errors && errors.length > 0 ? errors[0] : null;
      return {
        success: false,
        error: data.error ?? firstError?.message ?? data.message ?? i18n.t('api.upload_failed', { ns: 'errors' }),
        code: data.code ?? firstError?.code ?? 'UPLOAD_ERROR',
        errors,
      };
    } catch (error) {
      clearTimeout(uploadTimeoutId);
      if (!options?.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
        return this.changedContextResponse<T>(authContextAtRequestStart);
      }
      if (isAbortError(error)) {
        if (callerSignal?.aborted && !uploadTimedOut) {
          return { success: false, error: i18n.t('api.upload_cancelled', { ns: 'errors' }), code: 'UPLOAD_ABORTED' };
        }
        return { success: false, error: i18n.t('api.upload_timeout', { ns: 'errors' }), code: 'UPLOAD_TIMEOUT' };
      }
      const message = i18n.t('api.upload_failed_retry', { ns: 'errors' });
      return { success: false, error: message, code: 'NETWORK_ERROR' };
    }
  }

  /**
   * XHR-based multipart upload that reports byte progress (0-100). fetch()
   * cannot surface upload progress, so progress-aware callers (e.g. large
   * podcast audio uploads) route here. Mirrors upload()'s auth/tenant/CSRF
   * headers, credentials, 401-refresh-retry, and response shaping. The
   * stale-build gate is intentionally skipped here — ordinary API calls cover it.
   */
  private xhrUpload<T>(
    endpoint: string,
    formData: FormData,
    headers: Headers,
    options: RequestOptions | undefined,
    onProgress: (percent: number) => void,
    retryOnUnauthorized: boolean,
    authContextAtRequestStart: AuthContextSnapshot,
  ): Promise<ApiResponse<T>> {
    return new Promise<ApiResponse<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${this.baseUrl}${endpoint}`);
      xhr.withCredentials = true;
      xhr.timeout = options?.timeout ?? 300000; // 5 min default for media uploads
      headers.forEach((value, key) => {
        // Content-Type must be set by the browser with the multipart boundary.
        if (key.toLowerCase() !== 'content-type') xhr.setRequestHeader(key, value);
      });

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        }
      };

      const callerSignal = options?.signal as AbortSignal | undefined;
      if (callerSignal) {
        if (callerSignal.aborted) {
          xhr.abort();
        } else {
          callerSignal.addEventListener('abort', () => xhr.abort(), { once: true });
        }
      }

      const parse = (): Record<string, unknown> | null => {
        try {
          return xhr.responseText ? (JSON.parse(xhr.responseText) as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      };

      xhr.onload = () => {
        if (!options?.skipAuth && !this.authContextIsUnchanged(authContextAtRequestStart)) {
          resolve(this.changedContextResponse<T>(authContextAtRequestStart));
          return;
        }
        if (xhr.status === 401 && !options?.skipAuth) {
          if (!retryOnUnauthorized) {
            this.expireSession('expired', authContextAtRequestStart.sessionGeneration);
            resolve(this.sessionExpiredResponse<T>());
            return;
          }

          void this.handleTokenRefresh().then((outcome) => {
            if (outcome === 'refreshed') {
              if (!this.authContextIsUnchanged(authContextAtRequestStart)) {
                resolve(this.changedContextResponse<T>(authContextAtRequestStart));
                return;
              }
              resolve(this.uploadWithRetry<T>(endpoint, formData, 'file', options, false, authContextAtRequestStart));
            } else if (outcome === 'context_changed') {
              resolve(this.changedContextResponse<T>(authContextAtRequestStart));
            } else if (outcome === 'transient') {
              resolve(this.refreshUnavailableResponse<T>());
            } else {
              resolve(this.sessionExpiredResponse<T>());
            }
          });
          return;
        }

        const data = parse();
        const errors = data && Array.isArray(data.errors) ? (data.errors as ApiErrorDetail[]) : undefined;
        const firstError = errors && errors.length > 0 ? errors[0] : null;
        const meta = (data?.meta ?? undefined) as PaginationMeta | undefined;

        if (xhr.status >= 200 && xhr.status < 300) {
          if (data === null) {
            resolve({ success: true, data: undefined as T });
            return;
          }
          if ('success' in data && data.success === false) {
            resolve({
              success: false,
              error: (data.error as string) ?? firstError?.message ?? (data.message as string) ?? i18n.t('api.upload_failed', { ns: 'errors' }),
              code: (data.code as string) ?? firstError?.code ?? 'UPLOAD_ERROR',
              errors,
              meta,
            });
            return;
          }
          resolve({ success: true, data: ('data' in data ? data.data : data) as T, meta });
          return;
        }

        resolve({
          success: false,
          error: (data?.error as string) ?? firstError?.message ?? (data?.message as string) ?? i18n.t('api.upload_failed', { ns: 'errors' }),
          code: (data?.code as string) ?? firstError?.code ?? 'UPLOAD_ERROR',
          errors,
        });
      };

      xhr.onerror = () => resolve({
        success: false,
        error: i18n.t('api.upload_failed_retry', { ns: 'errors' }),
        code: 'NETWORK_ERROR',
      });
      xhr.ontimeout = () => resolve({ success: false, error: i18n.t('api.upload_timeout', { ns: 'errors' }), code: 'UPLOAD_TIMEOUT' });
      xhr.onabort = () => resolve({ success: false, error: i18n.t('api.upload_cancelled', { ns: 'errors' }), code: 'UPLOAD_ABORTED' });

      xhr.send(formData);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

export const api = new ApiClient();

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build query string from params object
 */
export function buildQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

/**
 * Check backend health
 */
export async function checkBackendHealth(): Promise<{
  healthy: boolean;
  database: boolean;
  phpVersion?: string;
}> {
  try {
    const response = await fetch('/health.php');
    const data = await response.json();
    return {
      healthy: data.status === 'healthy',
      database: data.database === 'connected',
      phpVersion: data.php_version,
    };
  } catch {
    return { healthy: false, database: false };
  }
}

/**
 * Fetch and store CSRF token from the backend
 * Should be called once on app initialization
 */
export async function fetchCsrfToken(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await api.get<{ csrf_token: string }>('/csrf-token', { skipCsrf: true });
      // Backend returns { data: { csrf_token: "..." } }, unwrapped to { csrf_token: "..." }
      const token = response.data?.csrf_token;
      if (response.success && token) {
        tokenManager.setCsrfToken(token);
        return token;
      }
      return null;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Menu API
// ─────────────────────────────────────────────────────────────────────────────

import type { ApiMenu, MenusByLocation } from '@/types/menu';

export const menuApi = {
  /** Get all menus for the current tenant, optionally filtered by location */
  getMenus: (location?: string) => {
    const params = location ? `?location=${encodeURIComponent(location)}` : '';
    return api.get<ApiMenu[] | MenusByLocation>(`/menus${params}`);
  },
  /** Get mobile-optimized menu */
  getMobileMenu: () => api.get<ApiMenu[]>('/menus/mobile'),
};

export default api;
