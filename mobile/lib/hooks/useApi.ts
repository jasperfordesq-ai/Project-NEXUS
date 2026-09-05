// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '@/lib/api/client';

import i18n from 'i18next';
/** HTTP status codes worth retrying (transient server/network errors). */
const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);

/** Delay before a single retry attempt (ms). */
const RETRY_DELAY_MS = 2000;

interface UseApiOptions {
  /** When false, the fetch is skipped entirely. Defaults to true. */
  enabled?: boolean;
}

interface UseApiState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  /** Re-trigger the API call */
  refresh: () => void;
}

/**
 * Generic hook for data-fetching API calls.
 *
 * Usage:
 *   const { data, isLoading, error, refresh } = useApi(() => getMembers(page));
 *   const { data } = useApi(() => getEvent(id), [id], { enabled: id > 0 });
 *
 * - Automatically called on mount and whenever `deps` change.
 * - Pass `{ enabled: false }` to skip the fetch (useful for invalid IDs).
 * - Call `refresh()` to manually re-fetch (e.g. on pull-to-refresh).
 * - Cancelled automatically on unmount to avoid state-update-on-unmounted-component.
 */
export function useApi<T>(
  fetchFn: () => Promise<T>,
  deps: unknown[] = [],
  options?: UseApiOptions,
): UseApiState<T> {
  const enabled = options?.enabled ?? true;
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const isMountedRef = useRef(true);

  // Always track the latest fetchFn to avoid stale closure issues.
  // Call sites pass inline arrows (e.g. `useApi(() => getFeed(), [])`) whose
  // identity changes every render. Storing in a ref means the effect always
  // invokes the most recent version without needing it in the dep array.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    async function run(isRetry: boolean) {
      if (!isRetry) {
        setIsLoading(true);
        setError(null);
      }
      try {
        const result = await fetchFnRef.current();
        if (!cancelled && isMountedRef.current) {
          setData(result);
          setIsLoading(false);
        }
      } catch (err) {
        if (cancelled || !isMountedRef.current) return;

        // Determine if the error is transient and worth retrying
        const isTransient =
          (err instanceof ApiResponseError && RETRYABLE_STATUSES.has(err.status)) ||
          !(err instanceof ApiResponseError); // network errors, timeouts, etc.

        if (isTransient && !isRetry) {
          // Schedule a single retry
          retryTimer = setTimeout(() => {
            if (!cancelled && isMountedRef.current) {
              void run(true);
            }
          }, RETRY_DELAY_MS);
          return;
        }

        // No more retries — surface the error. Translated at the moment it is set,
        // like lib/api/client.ts does: this string is shown verbatim by ~a dozen
        // screens, and it used to be English in every locale (audit 2026-09-05, F07).
        if (err instanceof ApiResponseError) {
          setError(err.message);
        } else {
          setError(i18n.t('common:errors.generic'));
        }
        setIsLoading(false);
      }
    }

    void run(false);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, refreshToken, enabled]);

  const refresh = useCallback(() => setRefreshToken((n) => n + 1), []);

  return { data, isLoading, error, refresh };
}
