// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { API_BASE_URL, APP_VERSION, DEFAULT_TENANT, STORAGE_KEYS, TIMEOUTS } from '@/lib/constants';
import i18n from 'i18next';
import { storage } from '@/lib/storage';
import { updateRequiredStore } from '@/lib/updates/updateRequiredStore';

/**
 * Generic API client for the Project NEXUS PHP backend.
 *
 * Every request automatically:
 *  - Prepends API_BASE_URL
 *  - Attaches Authorization: Bearer <token> when a token is stored
 *  - Attaches X-Tenant-Slug header for multi-tenant routing
 *  - Applies a configurable request timeout
 *  - Handles 401 responses by clearing credentials (logout is signalled
 *    via the onUnauthorized callback, which AuthContext sets at startup)
 */

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiError {
  status: number;
  message: string;
  errors?: Record<string, string[]>;
}

export class ApiResponseError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly errors?: Record<string, string[]>,
    /**
     * The API's machine-readable error code, when it sent one.
     *
     * 🔴 The v2 API answers a failed precondition with
     * `{ errors: [{ code, message }], success: false }` — `ONBOARDING_REQUIRED`,
     * `LEGAL_ACCEPTANCE_REQUIRED`, and others. Only the MESSAGE was being kept, so
     * the app could tell that something was refused but never WHY, and could not
     * respond by showing the right screen. Every one of those refusals looked like
     * a generic error.
     */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiResponseError';
  }
}

/** The first machine code in a v2 error envelope, if there is one. */
function extractErrorCode(data: unknown): string | undefined {
  const body = data as { errors?: unknown; code?: unknown } | null;

  if (typeof body?.code === 'string' && body.code !== '') {
    return body.code;
  }

  if (Array.isArray(body?.errors)) {
    const found = (body.errors as { code?: unknown }[]).find(
      (error) => typeof error?.code === 'string' && error.code !== '',
    );
    if (found) {
      return String(found.code);
    }
  }

  return undefined;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  const body = data as {
    message?: string;
    errors?: Record<string, string[]> | { message?: string }[];
  } | null;

  if (body?.message) {
    return body.message;
  }

  if (Array.isArray(body?.errors)) {
    const firstMessage = body.errors.find((error) => error.message)?.message;
    if (firstMessage) {
      return firstMessage;
    }
  }

  return fallback;
}

/** Called when the API returns 401 and refresh has failed — registered by AuthContext */
let onUnauthorizedCallback: (() => void) | null = null;

export function registerUnauthorizedCallback(cb: () => void): void {
  onUnauthorizedCallback = cb;
}

/**
 * Called when the API refuses a request with `LEGAL_ACCEPTANCE_REQUIRED` — the
 * root layout registers a handler that opens the acceptance screen.
 *
 * 🔴 Mirrors the 401 callback deliberately rather than making every one of the
 * app's 562 call sites handle this. A refusal that only some screens knew about
 * would surface as a generic error on all the others, which is precisely the
 * failure this is meant to prevent.
 *
 * The error is still THROWN as well, so a caller that wants to handle it locally
 * can, and a caller that does not is not left thinking the request succeeded.
 */
let onLegalAcceptanceRequiredCallback: (() => void) | null = null;

export function registerLegalAcceptanceRequiredCallback(cb: () => void): void {
  onLegalAcceptanceRequiredCallback = cb;
}

/** Build headers for native media players/downloaders without exposing tokens in URLs. */
export async function authenticatedMediaRequest(path: string): Promise<{ uri: string; headers: Record<string, string> }> {
  const base = new URL(API_BASE_URL);
  const resolved = new URL(path, `${base.origin}/`);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith('/api/v2/messages/')) {
    throw new ApiResponseError(400, i18n.t('common:errors.requestFailed'));
  }
  const [token, tenantSlug] = await Promise.all([
    storage.get(STORAGE_KEYS.AUTH_TOKEN),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);
  if (!token) throw new ApiResponseError(401, i18n.t('common:errors.unauthorized'));
  return {
    uri: resolved.toString(),
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Tenant-Slug': tenantSlug?.trim() || DEFAULT_TENANT,
      'X-Nexus-Mobile': '1',
      'X-Nexus-Mobile-Version': APP_VERSION,
    },
  };
}

/**
 * Silently refresh the access token using the stored refresh token.
 * Concurrent refresh attempts are collapsed into a single request —
 * the first 401 starts the refresh, all others wait for the same promise.
 * Once the refresh resolves, EVERY waiter receives the new token and
 * retries its original request (handled by the caller in `request()`).
 *
 * A short grace window (_refreshPromise stays populated for 2 s after
 * completion) prevents a second refresh attempt when a late 401 arrives
 * just after the refresh finished but before the retry response returns.
 */
/**
 * The outcome of a refresh attempt.
 *
 * 🔴 Why this is a THREE-way result and not `string | null`. It used to return `null` for
 * both "the server rejected the refresh token" and "the request never completed", so the
 * caller could not tell an expired session from a dropped connection — and treated both as
 * expiry. The consequence was not cosmetic: a member on a bad train connection was signed
 * out, and `AuthContext` responds to sign-out by PURGING the offline event check-in queue.
 * An organiser standing in a hall with no signal could lose the attendance roster they had
 * just collected, with no message explaining why.
 *
 * - `refreshed`   — a new token; retry the request.
 * - `rejected`    — the server refused the refresh token. The session really is over.
 * - `unreachable` — the attempt threw, timed out, or the server could not answer. Keep the
 *   session, keep the queue, say nothing, and let the next request try again.
 */
export type TokenRefreshResult =
  | { status: 'refreshed'; token: string }
  | { status: 'rejected' }
  | { status: 'unreachable' };

let _refreshPromise: Promise<TokenRefreshResult> | null = null;
let _refreshGraceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Test-only reset of the in-flight refresh and its grace window.
 *
 * 🔴 Needed because the grace window is deliberate module-level state: `_refreshPromise`
 * stays populated for 2s AFTER a refresh settles so a late 401 reuses the new token rather
 * than starting a second doomed refresh. Across a suite that is a cross-test leak — a later
 * test receives an earlier test's cached result and asserts against the wrong outcome, which
 * is exactly what happened when this three-way result was introduced (16 tests "failed"
 * while the code was correct). Mirrors `themeStore.__resetForTests`.
 */
export function __resetRefreshStateForTests(): void {
  if (_refreshGraceTimer) clearTimeout(_refreshGraceTimer);
  _refreshGraceTimer = null;
  _refreshPromise = null;
}

export async function attemptTokenRefresh(): Promise<TokenRefreshResult> {
  // If a refresh is in progress (or recently completed), reuse its promise
  if (_refreshPromise) {
    return _refreshPromise;
  }

  _refreshPromise = (async (): Promise<TokenRefreshResult> => {
    try {
      const [storedRefresh, tenantSlug] = await Promise.all([
        storage.get(STORAGE_KEYS.REFRESH_TOKEN),
        storage.get(STORAGE_KEYS.TENANT_SLUG),
      ]);
      // Nothing stored to renew with: a genuine end-of-session, not a failure to reach.
      if (!storedRefresh) return { status: 'rejected' };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Nexus-Mobile': '1',
        'X-Nexus-Mobile-Version': APP_VERSION,
      };
      headers['X-Tenant-Slug'] = tenantSlug || DEFAULT_TENANT;

      const res = await fetch(`${API_BASE_URL}/api/auth/refresh-token`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refresh_token: storedRefresh }),
      });

      // 🔴 Only an AUTH refusal ends the session. A 5xx or a 429 means the server could not
      // answer right now — treating those as expiry signs people out during an incident,
      // the worst possible moment to also wipe their queued check-ins.
      if (!res.ok) {
        return res.status === 401 || res.status === 403
          ? { status: 'rejected' }
          : { status: 'unreachable' };
      }

      const data = await res.json() as { access_token?: string; token?: string; refresh_token?: string };
      const newToken = data.access_token ?? data.token ?? null;
      // A 200 carrying no token is the server contradicting itself — not a reason to
      // destroy anything.
      if (!newToken) return { status: 'unreachable' };

      const saves: Promise<void>[] = [storage.set(STORAGE_KEYS.AUTH_TOKEN, newToken)];
      if (data.refresh_token) saves.push(storage.set(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token));
      await Promise.all(saves);

      return { status: 'refreshed', token: newToken };
    } catch {
      // Thrown = never reached the server (offline, DNS, TLS, abort).
      return { status: 'unreachable' };
    }
  })();

  // After the promise settles, keep it cached briefly so that late 401s
  // arriving right after the refresh still get the new token instead of
  // triggering a second (doomed) refresh.
  _refreshPromise.finally(() => {
    if (_refreshGraceTimer) clearTimeout(_refreshGraceTimer);
    _refreshGraceTimer = setTimeout(() => {
      _refreshPromise = null;
      _refreshGraceTimer = null;
    }, 2000);
  });

  return _refreshPromise;
}

/** Resolve the appropriate timeout for a given HTTP method */
function getTimeoutForMethod(method: RequestMethod, isUpload = false): number {
  if (isUpload) return TIMEOUTS.API_UPLOAD;
  if (method === 'GET') return TIMEOUTS.API_GET;
  return TIMEOUTS.API_MUTATION;
}

export interface RequestOptions {
  params?: Record<string, string>;
  /** Additional request headers. Auth and tenant headers remain authoritative. */
  headers?: Record<string, string>;
  /** Override the default per-method timeout (ms) */
  timeout?: number;
  /** Mark as file upload to use the longer upload timeout */
  isUpload?: boolean;
  /**
   * Send the request WITHOUT the stored token. Only for endpoints that are public by
   * design, and only where sending a token can make a working request fail.
   *
   * 🔴 The community list is the case that forced this, measured on a device on
   * 2026-08-24. A member who had switched to a community their account is not in got
   * `403 "Token tenant does not match requested tenant"` on every request — including
   * `GET /v2/tenants`, the public list the community picker is built from. So the one
   * screen that could have put them back in their own community showed "Could not load
   * communities" instead. The escape hatch was locked from the inside.
   *
   * This never ADDS credentials: a caller-supplied Authorization header is still
   * stripped below. It only omits the stored one.
   */
  anonymous?: boolean;
  /**
   * Request body for `api.delete()`, which is the one verb helper with no positional
   * body parameter.
   *
   * 🔴 It was previously impossible to send a body on a DELETE at all: the helper
   * hardcoded `undefined`, so an options object containing data was silently dropped.
   * `cancelExchangeRequest` works around that by putting its `reason` in the query
   * string, which is fine for a reason and unacceptable for the case that forced this
   * field — `DELETE /v2/users/me` requires the member's password, and a password in a
   * URL ends up in server logs, proxy logs and crash reports.
   *
   * POST/PUT/PATCH must keep using their positional body. Passing `body` in their
   * options is an excess-property error on an object literal, which is the intended
   * outcome: it would be silently ignored.
   */
  body?: unknown;
}

async function request<T>(
  method: RequestMethod,
  endpoint: string,
  body?: unknown,
  paramsOrOptions?: Record<string, string> | RequestOptions,
): Promise<T> {
  // Support both legacy params-only signature and new options object
  const options: RequestOptions =
    paramsOrOptions && ('timeout' in paramsOrOptions || 'isUpload' in paramsOrOptions || 'params' in paramsOrOptions || 'headers' in paramsOrOptions || 'anonymous' in paramsOrOptions || 'body' in paramsOrOptions)
      ? (paramsOrOptions as RequestOptions)
      : { params: paramsOrOptions as Record<string, string> | undefined };

  const requestTimeout = options.timeout ?? getTimeoutForMethod(method, options.isUpload);
  // Build URL with optional query params
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  if (options.params) {
    Object.entries(options.params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  // Gather auth token and active tenant
  const [token, tenantSlug] = await Promise.all([
    storage.get(STORAGE_KEYS.AUTH_TOKEN),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);

  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Nexus-Mobile': '1',
    'X-Nexus-Mobile-Version': APP_VERSION,
    ...options.headers,
  };

  // Per-request negotiation headers must never impersonate another user or
  // tenant. Those values are resolved exclusively from trusted app storage.
  Object.keys(headers).forEach((key) => {
    const normalized = key.toLowerCase();
    if (normalized === 'authorization' || normalized === 'x-tenant-slug') delete headers[key];
  });

  // Do NOT set Content-Type for FormData — React Native sets the multipart
  // boundary automatically. For all other requests use JSON.
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (token && !options.anonymous) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resolvedTenantSlug = tenantSlug?.trim() || DEFAULT_TENANT;
  if (resolvedTenantSlug) {
    // The PHP API resolves the tenant from this header on non-subdomain routes
    headers['X-Tenant-Slug'] = resolvedTenantSlug;
  }

  // Abort controller for timeout support
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body !== undefined ? (isFormData ? (body as BodyInit) : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiResponseError(0, i18n.t('common:errors.timeout'));
    }
    throw new ApiResponseError(0, i18n.t('common:errors.network'));
  }

  clearTimeout(timeoutId);

  // Handle 401: try silent token refresh, then retry once
  if (response.status === 401 && endpoint !== '/api/auth/login') {
    const refresh = await attemptTokenRefresh();
    if (refresh.status === 'refreshed') {
      // Retry the original request with the refreshed token
      const retryHeaders: Record<string, string> = { ...headers, Authorization: `Bearer ${refresh.token}` };
      // For FormData, ensure Content-Type is not set (let React Native set multipart boundary)
      if (isFormData) delete retryHeaders['Content-Type'];
      const retryController = new AbortController();
      const retryTimeoutId = setTimeout(() => retryController.abort(), requestTimeout);
      let retryRes: Response;
      try {
        retryRes = await fetch(url.toString(), {
          method,
          headers: retryHeaders,
          body: body !== undefined ? (isFormData ? (body as BodyInit) : JSON.stringify(body)) : undefined,
          signal: retryController.signal,
        });
      } catch (retryErr) {
        clearTimeout(retryTimeoutId);
        throw retryErr instanceof Error && retryErr.name === 'AbortError'
          ? new ApiResponseError(0, i18n.t('common:errors.timeout'))
          : new ApiResponseError(0, i18n.t('common:errors.network'));
      }
      clearTimeout(retryTimeoutId);

      // If the retry succeeded (not another 401), process and return it
      if (retryRes.status !== 401) {
        const retryContentType = retryRes.headers.get('content-type') ?? '';
        const retryData: unknown =
          retryContentType.includes('application/json') && retryRes.status !== 204
            ? await retryRes.json()
            : null;
        if (!retryRes.ok) {
          const eb = retryData as { errors?: Record<string, string[]> } | null;
          throw new ApiResponseError(
            retryRes.status,
            extractErrorMessage(
              retryData,
              i18n.t('common:errors.requestFailedWithStatus', { status: retryRes.status }),
            ),
            eb?.errors,
            extractErrorCode(retryData),
          );
        }
        return retryData as T;
      }
    }

    // 🔴 The server could not be reached to renew the token. NOT an expiry: leave the
    // stored tokens alone, do not fire the sign-out callback (which purges the offline
    // check-in queue), and surface it as the network failure it is so the screen can offer
    // a retry. The next request will attempt the refresh again.
    if (refresh.status === 'unreachable') {
      throw new ApiResponseError(0, i18n.t('common:errors.network'));
    }

    // The refresh token was refused, or the retry came back 401 again: the session is
    // genuinely over. Clear it and tell the app, which signs the member out.
    await Promise.all([
      storage.remove(STORAGE_KEYS.AUTH_TOKEN),
      storage.remove(STORAGE_KEYS.REFRESH_TOKEN),
      storage.remove(STORAGE_KEYS.USER_DATA),
    ]);
    onUnauthorizedCallback?.();
    throw new ApiResponseError(401, i18n.t('common:errors.unauthorized'));
  }

  // Parse response body (some endpoints return no body on 204)
  let data: unknown;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json') && response.status !== 204) {
    data = await response.json();
  } else {
    data = null;
  }

  if (!response.ok) {
    const errBody = data as { errors?: Record<string, string[]> } | null;
    const code = extractErrorCode(data);

    // The acceptance gate refused this. Surface the screen once, centrally, then
    // still throw so the caller does not mistake the refusal for success.
    if (code === 'LEGAL_ACCEPTANCE_REQUIRED') {
      onLegalAcceptanceRequiredCallback?.();
    }

    // 🔴 The client half of the force-update lever. The server refuses a build below
    // its minimum with 426 Upgrade Required (App\Http\Middleware\EnforceMobileMinimumVersion),
    // and this is the code that makes that refusal mean something to the member instead
    // of appearing as an unexplained failure on every screen.
    //
    // Matched on the STATUS, not on the error code: 426 is unambiguous and reserved for
    // exactly this, whereas a code string can be lost by an intermediary that rewrites
    // the body. Published to a store rather than shown from here, because this module is
    // infrastructure with no provider above it — see lib/updates/updateRequiredStore.ts.
    //
    // Still throws afterwards, deliberately. The request genuinely did not succeed, and a
    // caller that treated a refusal as success would render an empty screen behind the
    // blocking one.
    if (response.status === 426) {
      updateRequiredStore.require(updateRequiredStore.fromResponseBody(data));
    }

    throw new ApiResponseError(
      response.status,
      extractErrorMessage(
        data,
        i18n.t('common:errors.requestFailedWithStatus', { status: response.status }),
      ),
      errBody?.errors,
      code,
    );
  }

  return data as T;
}

/**
 * Typed API client — thin wrapper around fetch with auth & tenant headers.
 * Usage:
 *   const users = await api.get<User[]>('/api/v2/users');
 *   const result = await api.post<CreateResult>('/api/v2/exchanges', payload);
 */
export const api = {
  get<T>(endpoint: string, params?: Record<string, string>, options?: RequestOptions): Promise<T> {
    return request<T>('GET', endpoint, undefined, { ...options, params });
  },

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', endpoint, body, options);
  },

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PUT', endpoint, body, options);
  },

  patch<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PATCH', endpoint, body, options);
  },

  delete<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    // `options.body` — not `undefined`. See RequestOptions.body: this helper used to
    // discard every body it was given.
    return request<T>('DELETE', endpoint, options?.body, options);
  },

  /** POST with file-upload timeout (60s) for large payloads */
  upload<T>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', endpoint, body, { ...options, isUpload: true });
  },
};
