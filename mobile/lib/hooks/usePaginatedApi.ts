// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { ApiResponseError } from '@/lib/api/client';
import i18n from 'i18next';

/** HTTP status codes worth retrying (transient server/network errors). */
/**
 * Statuses worth one automatic retry.
 *
 * 🔴 `0` is in here for a reason that is easy to lose: `lib/api/client.ts` wraps every
 * network failure and every timeout as `new ApiResponseError(0, ...)`. The transient test
 * below reads "a retryable status, OR not an ApiResponseError at all" — and a dropped
 * mobile connection satisfies neither, because it IS an ApiResponseError and its status
 * was not in this set. So the one failure the automatic retry most obviously exists for
 * was the one case it never covered, on every screen using these hooks. Found by the
 * 2026-09-06 audit (F07).
 */
const RETRYABLE_STATUSES = new Set([0, 500, 502, 503, 504]);

/** Delay before a single retry attempt (ms). */
const RETRY_DELAY_MS = 2000;

export interface PaginatedApiState<TItem> {
  items: TItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  /**
   * HTTP status of the failure, when the server answered at all. `null` for a
   * network error or timeout, which carry no status the caller can reason about.
   */
  errorStatus: number | null;
  /**
   * The API's machine-readable code (`FORBIDDEN`, `FEDERATION_NOT_ENABLED`, …).
   *
   * 🔴 Added 2026-09-08 because `error` alone is not something a screen can branch
   * on. `error` is the SERVER'S TRANSLATED SENTENCE, so any screen deciding what to
   * show by matching words in it only works in the language that screen was written
   * in. The federation directory did exactly that and offered a German member a
   * Retry button for a refusal no amount of retrying could clear. `useApi` has
   * carried both of these for a while; this hook did not, which is the only reason
   * the paginated screens were still reading sentences.
   */
  errorCode: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

interface UsePaginatedApiOptions<TItem> {
  /** When false, the initial fetch and later refresh/load-more calls are skipped. Defaults to true. */
  enabled?: boolean;
  /**
   * How to identify a row, so the same one cannot appear twice. Defaults to `item.id`.
   *
   * Pass this when rows have no `id`, or when identity is a pair — the feed keys on
   * `type` and `id` together, because a post and a listing can share a number.
   */
  getKey?: (item: TItem) => string | number | null | undefined;
}

/** Default identity: the `id` field almost every row in this API carries. */
function defaultKey(item: unknown): string | number | null | undefined {
  return (item as { id?: string | number } | null)?.id;
}

/**
 * Append `incoming` to `existing`, dropping any row already on the list.
 *
 * 🔴 Why this is needed, and why nobody saw it. Pagination here is by cursor over a list
 * the server keeps re-ordering: a post written between two page fetches, or a refresh
 * racing a load-more, hands the same row to the app twice. React then finds two children
 * with the same key, warns, and renders one of them unpredictably — a row that appears
 * twice, or one that vanishes when its twin arrives.
 *
 * The warning that would have made this obvious was in `LogBox.ignoreLogs` in
 * app/_layout.tsx, alongside a second one for the same fault, so the only signal the
 * platform gives was switched off. Both suppressions are gone. Audit 2026-09-09, item 5.
 *
 * A row whose key is null or undefined cannot be judged and is always kept: dropping rows
 * because we cannot identify them would be a worse bug than showing one twice.
 */
function appendUnique<TItem>(
  existing: readonly TItem[],
  incoming: readonly TItem[],
  getKey: (item: TItem) => string | number | null | undefined,
): TItem[] {
  const seen = new Set<string | number>();
  for (const item of existing) {
    const key = getKey(item);
    if (key !== null && key !== undefined) seen.add(key);
  }

  const added: TItem[] = [];
  for (const item of incoming) {
    const key = getKey(item);
    if (key === null || key === undefined) {
      added.push(item);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(item);
  }

  return added.length === 0 ? (existing as TItem[]) : [...existing, ...added];
}

/**
 * Generic hook for paginated/infinite-scroll API calls.
 *
 * Supports both cursor-based and offset-based pagination by delegating
 * the pagination logic to the caller via `fetchFn` and `extractor`.
 *
 * Usage (cursor-based):
 *   const { items, isLoading, hasMore, loadMore, refresh } = usePaginatedApi(
 *     (cursor) => getFeed(cursor),
 *     (response) => ({
 *       items: response.data,
 *       cursor: response.meta.cursor,
 *       hasMore: response.meta.has_more,
 *     }),
 *   );
 *
 * Usage (page/offset-based — pass the page number as cursor):
 *   const pageRef = useRef(1);
 *   const { items, isLoading, hasMore, loadMore, refresh } = usePaginatedApi(
 *     (cursor) => getExchanges(cursor ? Number(cursor) : 1),
 *     (response) => ({
 *       items: response.data,
 *       cursor: response.meta.current_page < response.meta.last_page
 *         ? String(response.meta.current_page + 1)
 *         : null,
 *       hasMore: response.meta.current_page < response.meta.last_page,
 *     }),
 *   );
 *
 * @param fetchFn   Function that accepts the current cursor (null on first page)
 *                  and returns a Promise of the raw API response.
 * @param extractor Function that maps the raw API response to a normalised shape
 *                  containing `items`, the next `cursor`, and `hasMore`.
 * @param deps      Optional dependency list. When any dep changes, the hook
 *                  resets to page 1 and re-fetches. Useful when the fetchFn
 *                  closes over reactive values (e.g. a search query).
 */
export function usePaginatedApi<TItem, TResponse>(
  fetchFn: (cursor: string | null) => Promise<TResponse>,
  extractor: (response: TResponse) => {
    items: TItem[];
    cursor: string | null;
    hasMore: boolean;
  },
  deps?: DependencyList,
  options?: UsePaginatedApiOptions<TItem>,
): PaginatedApiState<TItem> {
  const enabled = options?.enabled ?? true;
  /*
    Held in a ref so a caller passing an inline arrow — which almost every caller does —
    cannot change the identity of `fetchPage` on every render and restart the list.
  */
  const getKeyRef = useRef(options?.getKey ?? defaultKey);
  getKeyRef.current = options?.getKey ?? defaultKey;
  const [items, setItems] = useState<TItem[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Tracks the cursor for the next page. null means "start from the beginning".
  const cursorRef = useRef<string | null>(null);

  // Guards against concurrent fetches (e.g. rapid loadMore taps or re-renders).
  const isFetchingRef = useRef(false);

  // Set to false when the component unmounts so we never set state after unmount.
  const isMountedRef = useRef(true);

  // Tracks whether the initial load has already been retried (max 1 retry).
  const retryCountRef = useRef(0);

  // Holds the retry timer so it can be cancelled on unmount.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Every user-initiated fetch gets a generation. A refresh is allowed to supersede an
  // in-flight initial request, so the older response must not be able to replace the newer
  // page merely because it arrived last.
  const requestVersionRef = useRef(0);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /** Internal fetch helper. `isInitial` replaces items; otherwise appends. */
  const fetchPage = useCallback(
    async (cursor: string | null, isInitial: boolean, existingVersion?: number) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      const requestVersion = existingVersion ?? ++requestVersionRef.current;
      let retryScheduled = false;

      if (isInitial) {
        setIsLoading(true);
        setError(null);
        setErrorStatus(null);
        setErrorCode(null);
      } else {
        setIsLoadingMore(true);
      }

      try {
        const response = await fetchFn(cursor);

        if (!isMountedRef.current || requestVersion !== requestVersionRef.current) return;

        const { items: newItems, cursor: nextCursor, hasMore: more } = extractor(response);

        cursorRef.current = nextCursor;

        if (isInitial) {
          // A first page can repeat a row within itself just as an appended one can.
          setItems(appendUnique([], newItems, getKeyRef.current));
        } else {
          setItems((prev) => appendUnique(prev, newItems, getKeyRef.current));
        }

        setHasMore(more);
        setError(null);
        setErrorStatus(null);
        setErrorCode(null);
      } catch (err) {
        if (!isMountedRef.current || requestVersion !== requestVersionRef.current) return;

        // On transient errors during initial load, retry once after a delay
        if (isInitial && retryCountRef.current < 1) {
          const isTransient =
            (err instanceof ApiResponseError && RETRYABLE_STATUSES.has(err.status)) ||
            !(err instanceof ApiResponseError);

          if (isTransient) {
            retryCountRef.current += 1;
            retryScheduled = true;
            isFetchingRef.current = false; // allow the retry fetch to proceed
            retryTimerRef.current = setTimeout(() => {
              if (isMountedRef.current) {
                void fetchPage(cursor, true, requestVersion);
              }
            }, RETRY_DELAY_MS);
            return;
          }
        }

        if (err instanceof ApiResponseError) {
          setError(err.message);
          setErrorStatus(err.status);
          setErrorCode(err.code ?? null);
        } else {
          // Translated at the moment it is set, like useApi and lib/api/client.ts
          // (audit 2026-09-05, F07: this was English in every locale).
          setError(i18n.t('common:errors.generic'));
          setErrorStatus(null);
          setErrorCode(null);
        }
      } finally {
        const isCurrentRequest = requestVersion === requestVersionRef.current;
        if (isMountedRef.current && isCurrentRequest && !retryScheduled) {
          if (isInitial) {
            setIsLoading(false);
          } else {
            setIsLoadingMore(false);
          }
        }
        if (isCurrentRequest && !retryScheduled) {
          isFetchingRef.current = false;
        }
      }
    },
    [fetchFn, extractor],
  );

  // Initial load on mount, and reset + re-fetch when deps change.
  useEffect(() => {
    // Invalidate any response from the previous dependency set before starting over.
    requestVersionRef.current += 1;
    cursorRef.current = null;
    retryCountRef.current = 0;
    isFetchingRef.current = false;
    setIsLoadingMore(false);

    if (!enabled) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      isFetchingRef.current = false;
      setItems([]);
      setIsLoading(false);
      setIsLoadingMore(false);
      setError(null);
      setErrorStatus(null);
      setErrorCode(null);
      setHasMore(false);
      return;
    }

    // The previous dependency set's rows are not this one's. Leaving them on screen until
    // the response arrived made a tab switch look like nothing had happened, then jump
    // (audit 2026-09-07, C/F-18). `refresh()` deliberately does NOT do this: a pull to
    // refresh keeps what is loaded until the new page replaces it.
    setItems([]);
    void fetchPage(null, true);

    return () => {
      // Cancel any pending retry when deps change or component unmounts
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ? [...deps, enabled] : [enabled]);

  /** Append the next page to the list. No-op if already fetching, still loading, or no more pages. */
  const loadMore = useCallback(() => {
    if (!enabled || !hasMore || isFetchingRef.current || isLoadingMore || isLoading) return;
    void fetchPage(cursorRef.current, false);
  }, [enabled, hasMore, isLoadingMore, isLoading, fetchPage]);

  /** Reset to the first page and replace the item list. */
  const refresh = useCallback(() => {
    if (!enabled) return;
    cursorRef.current = null;
    retryCountRef.current = 0; // allow retry again on manual refresh
    // Allow refresh to proceed even if a previous fetch is in-flight
    isFetchingRef.current = false;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    void fetchPage(null, true);
  }, [enabled, fetchPage]);

  return { items, isLoading, isLoadingMore, error, errorStatus, errorCode, hasMore, loadMore, refresh };
}
