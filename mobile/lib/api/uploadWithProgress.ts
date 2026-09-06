// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { API_BASE_URL, APP_VERSION, DEFAULT_TENANT, STORAGE_KEYS } from '@/lib/constants';
import { ApiResponseError } from '@/lib/api/client';
import { storage } from '@/lib/storage';
import i18n from 'i18next';

/**
 * Multipart upload with byte-level progress and caller-driven cancellation.
 *
 * 🔴 Why this exists alongside `api.upload()` in `client.ts`, rather than being folded
 * into it. The shared client is built on `fetch`, and React Native's `fetch` reports
 * NOTHING while a request body is being sent — no progress events, and its
 * AbortController is wired to the client's own timeout, not to the caller. That is
 * survivable for a 2 MB photo. It is not survivable for a podcast episode: the API
 * accepts audio up to the tenant's configured ceiling (250 MB by default), which on a
 * phone connection is minutes of upload during which the member would see a spinner
 * with no number, no estimate, and no way out except force-quitting the app.
 *
 * `XMLHttpRequest` — which React Native implements natively and which `fetch` is itself
 * built on here — does expose `upload.onprogress` and a real `abort()`. So the one
 * screen that needs both uses it directly.
 *
 * Everything security-relevant is deliberately copied from `client.ts` and must stay in
 * step with it: the Authorization and X-Tenant-Slug headers are resolved ONLY from
 * trusted app storage and can never be supplied by the caller, and Content-Type is left
 * unset so React Native writes its own multipart boundary.
 */

/** Progress callback. `percent` is 0–100, integral, and monotonic. */
export type UploadProgressCallback = (percent: number) => void;

export interface UploadWithProgressOptions {
  /** Called as bytes go out. Not called at all when the platform cannot measure length. */
  onProgress?: UploadProgressCallback;
  /**
   * Abort handle. Call `signal.abort()` to cancel; the promise then rejects with an
   * `ApiResponseError` carrying code `UPLOAD_ABORTED`, which callers use to keep the
   * form intact for a retry rather than showing a failure.
   */
  signal?: AbortSignal;
  /**
   * Milliseconds of total inactivity before giving up. Defaults to 15 minutes — an
   * audio file at the 250 MB ceiling over a slow mobile connection legitimately takes
   * longer than the 60 s the shared client allows for an upload.
   */
  timeout?: number;
}

/** Raised on cancel, so callers can tell "the member stopped it" from "it broke". */
export const UPLOAD_ABORTED = 'UPLOAD_ABORTED';

const DEFAULT_UPLOAD_TIMEOUT_MS = 15 * 60_000;

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function messageFrom(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === 'object') {
    const body = parsed as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
    // The v2 API also answers with `errors: [{ code, message }]`.
    if (Array.isArray(body.errors)) {
      const first = body.errors[0] as { message?: unknown } | undefined;
      if (first && typeof first.message === 'string' && first.message) return first.message;
    }
  }
  return status === 0 ? i18n.t('common:errors.network') : i18n.t('common:errors.generic');
}

function fieldErrorsFrom(parsed: unknown): Record<string, string[]> | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const errors = (parsed as { errors?: unknown }).errors;
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) return undefined;
  return errors as Record<string, string[]>;
}

/**
 * POST a `FormData` body to `endpoint` (a path such as `/v2/podcasts/1/episodes`),
 * resolving to the parsed JSON response.
 */
export async function uploadWithProgress<T>(
  endpoint: string,
  form: FormData,
  options: UploadWithProgressOptions = {},
): Promise<T> {
  const { onProgress, signal, timeout = DEFAULT_UPLOAD_TIMEOUT_MS } = options;

  if (signal?.aborted) {
    throw new ApiResponseError(0, i18n.t('common:errors.generic'), undefined, UPLOAD_ABORTED);
  }

  const [token, tenantSlug] = await Promise.all([
    storage.get(STORAGE_KEYS.AUTH_TOKEN),
    storage.get(STORAGE_KEYS.TENANT_SLUG),
  ]);

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener?.('abort', onAbort);
      fn();
    };

    function onAbort(): void {
      // `xhr.abort()` fires xhr.onabort, which settles the promise. Guard anyway so a
      // signal that aborts after completion cannot reject an already-resolved upload.
      if (!settled) xhr.abort();
    }

    xhr.open('POST', `${API_BASE_URL}${endpoint}`, true);
    xhr.timeout = timeout;
    xhr.responseType = 'text';

    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-Nexus-Mobile', '1');
    xhr.setRequestHeader('X-Nexus-Mobile-Version', APP_VERSION);
    // Identity headers come from trusted storage only — never from a caller.
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-Tenant-Slug', tenantSlug?.trim() || DEFAULT_TENANT);
    // Content-Type is deliberately NOT set: React Native appends the multipart boundary.

    if (onProgress && xhr.upload) {
      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable || event.total <= 0) return;
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      };
    }

    xhr.onload = () => {
      const parsed = parseBody(typeof xhr.responseText === 'string' ? xhr.responseText : '');
      if (xhr.status >= 200 && xhr.status < 300) {
        finish(() => resolve(parsed as T));
        return;
      }
      finish(() => reject(new ApiResponseError(
        xhr.status,
        messageFrom(parsed, xhr.status),
        fieldErrorsFrom(parsed),
      )));
    };

    xhr.onerror = () => {
      finish(() => reject(new ApiResponseError(0, i18n.t('common:errors.network'))));
    };

    xhr.ontimeout = () => {
      finish(() => reject(new ApiResponseError(0, i18n.t('common:errors.timeout'))));
    };

    xhr.onabort = () => {
      finish(() => reject(new ApiResponseError(
        0,
        i18n.t('common:errors.generic'),
        undefined,
        UPLOAD_ABORTED,
      )));
    };

    signal?.addEventListener?.('abort', onAbort);
    xhr.send(form);
  });
}

/** True when a rejection was the member cancelling, not a failure worth reporting. */
export function isUploadAborted(error: unknown): boolean {
  return error instanceof ApiResponseError && error.code === UPLOAD_ABORTED;
}
