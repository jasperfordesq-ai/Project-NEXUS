// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    // `code` mirrors the real class in lib/api/client.ts. It was missing from this
    // fake, which is part of why nothing noticed that the hook dropped it.
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
      this.name = 'ApiResponseError';
    }
  },
}));

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { usePaginatedApi } from './usePaginatedApi';
import { ApiResponseError } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeResponse { data: string[]; meta: { cursor: string | null; has_more: boolean } }

function makeResponse(items: string[], cursor: string | null, hasMore: boolean): FakeResponse {
  return { data: items, meta: { cursor, has_more: hasMore } };
}

function extractor(r: FakeResponse) {
  return { items: r.data, cursor: r.meta.cursor, hasMore: r.meta.has_more };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('usePaginatedApi', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts loading and calls fetchFn with null cursor on mount', async () => {
    const fetchFn = jest.fn().mockResolvedValue(makeResponse(['a', 'b'], null, false));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchFn).toHaveBeenCalledWith(null);
    expect(result.current.items).toEqual(['a', 'b']);
    expect(result.current.error).toBeNull();
  });

  it('skips the initial fetch when disabled', async () => {
    const fetchFn = jest.fn().mockResolvedValue(makeResponse(['a', 'b'], null, false));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor, [], { enabled: false }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets hasMore from the extractor response', async () => {
    const fetchFn = jest.fn().mockResolvedValue(makeResponse(['a'], 'cursor_1', true));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(true);
  });

  it('loadMore appends next page using the cursor from the previous response', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(makeResponse(['a', 'b'], 'cur_1', true))
      .mockResolvedValueOnce(makeResponse(['c', 'd'], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => { result.current.loadMore(); });
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(fetchFn).toHaveBeenCalledWith('cur_1');
    expect(result.current.items).toEqual(['a', 'b', 'c', 'd']);
    expect(result.current.hasMore).toBe(false);
  });

  it('refresh resets cursor to null and replaces items', async () => {
    const fetchFn = jest.fn()
      .mockResolvedValueOnce(makeResponse(['a', 'b'], 'cur_1', true))
      .mockResolvedValueOnce(makeResponse(['x', 'y'], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual(['a', 'b']);

    act(() => { result.current.refresh(); });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.items).toEqual(['x', 'y']);
    });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenLastCalledWith(null);
  });

  it('does not let an older initial response overwrite a completed refresh', async () => {
    let resolveInitial!: (value: FakeResponse) => void;
    let resolveRefresh!: (value: FakeResponse) => void;
    const initialRequest = new Promise<FakeResponse>((resolve) => {
      resolveInitial = resolve;
    });
    const refreshRequest = new Promise<FakeResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    const fetchFn = jest.fn()
      .mockReturnValueOnce(initialRequest)
      .mockReturnValueOnce(refreshRequest);

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.refresh();
    });
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveRefresh(makeResponse(['fresh'], null, false));
      await refreshRequest;
    });
    await waitFor(() => expect(result.current.items).toEqual(['fresh']));

    await act(async () => {
      resolveInitial(makeResponse(['stale'], null, false));
      await initialRequest;
    });

    expect(result.current.items).toEqual(['fresh']);
    expect(result.current.isLoading).toBe(false);
  });

  it('starts the new dependency request while the previous request is still in flight', async () => {
    let resolveOld!: (value: FakeResponse) => void;
    let resolveNew!: (value: FakeResponse) => void;
    const oldRequest = new Promise<FakeResponse>((resolve) => {
      resolveOld = resolve;
    });
    const newRequest = new Promise<FakeResponse>((resolve) => {
      resolveNew = resolve;
    });
    const fetchFn = jest.fn()
      .mockReturnValueOnce(oldRequest)
      .mockReturnValueOnce(newRequest);
    let filter = 'all';

    const { result, rerender } = renderHook(() => usePaginatedApi(fetchFn, extractor, [filter]));
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    filter = 'saved';
    rerender({});
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveNew(makeResponse(['saved'], null, false));
      await newRequest;
    });
    await act(async () => {
      resolveOld(makeResponse(['all'], null, false));
      await oldRequest;
    });

    expect(result.current.items).toEqual(['saved']);
    expect(result.current.isLoading).toBe(false);
  });

  it('sets ApiResponseError message on API failure', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new ApiResponseError(422, 'Server error'));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Server error');
    expect(result.current.items).toEqual([]);
  });

  it('sets generic error message on unexpected failure', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A translation key, not English prose: the hook no longer hard-codes the message.
    expect(result.current.error).toBe('common:errors.generic');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('keeps initial loading active while a transient retry is pending', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn()
      .mockRejectedValueOnce(new ApiResponseError(500, 'Server error'))
      .mockResolvedValueOnce(makeResponse(['recovered'], null, false));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual(['recovered']);
    expect(result.current.error).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('retries a dropped connection on the first page, which the client reports as status 0', async () => {
    // 🔴 Audit F07, same predicate gap as `useApi`. A timeout or a lost connection is
    // an `ApiResponseError(0)`, so it matched neither arm of the transient test and the
    // list gave up on its first page without the retry the hook advertises.
    jest.useFakeTimers();
    const fetchFn = jest.fn()
      .mockRejectedValueOnce(new ApiResponseError(0, 'Request timed out'))
      .mockResolvedValueOnce(makeResponse(['recovered'], null, false));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => { jest.advanceTimersByTime(2000); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual(['recovered']);
    expect(result.current.error).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('loadMore is a no-op when hasMore is false', async () => {
    const fetchFn = jest.fn().mockResolvedValue(makeResponse(['a'], null, false));
    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasMore).toBe(false);

    act(() => { result.current.loadMore(); });

    // Still only the initial call — loadMore is a no-op
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// errorStatus / errorCode
//
// A screen cannot branch on `error`: that is the server's sentence in the
// member's own language. Every screen that tried ended up matching English words
// and behaving differently in the other six locales. These pin the machine-
// readable pair that replaces that.
// ---------------------------------------------------------------------------

describe('usePaginatedApi — machine-readable failure detail', () => {
  it('reports the status and the code the API sent', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValue(
        new ApiResponseError(403, 'Federation feature disabled for this tenant', undefined, 'FORBIDDEN'),
      );

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Federation feature disabled for this tenant');
    expect(result.current.errorStatus).toBe(403);
    expect(result.current.errorCode).toBe('FORBIDDEN');
    // A 403 is not retryable, so the hook must not have burned its one retry on it.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('still reports the status when the API sent no code', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new ApiResponseError(404, 'Not found'));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.errorStatus).toBe(404);
    expect(result.current.errorCode).toBeNull();
  });

  it('reports no status or code for a dropped connection', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new TypeError('Network request failed'));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    // One automatic retry, then the generic message.
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 8000 });

    expect(result.current.errorStatus).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });

  it('clears the status and code once a later attempt succeeds', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new ApiResponseError(403, 'Refused', undefined, 'FORBIDDEN'))
      .mockResolvedValue(makeResponse(['a'], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, extractor));

    await waitFor(() => expect(result.current.errorCode).toBe('FORBIDDEN'));

    act(() => { result.current.refresh(); });

    await waitFor(() => expect(result.current.items).toEqual(['a']));
    expect(result.current.error).toBeNull();
    expect(result.current.errorStatus).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });
});

// The hook translates its fallback error; return the key so the assertion is locale-free.
jest.mock('i18next', () => ({ __esModule: true, default: { t: (key: string) => key } }));

// ---------------------------------------------------------------------------
// De-duplication — audit 2026-09-09, item 5
// ---------------------------------------------------------------------------

/**
 * 🔴 Pages were appended with `[...prev, ...newItems]` and nothing checked whether a row
 * was already on the list. Cursor pagination runs over a list the server keeps re-ordering,
 * so a post written between two page fetches — or a refresh racing a load-more — hands the
 * same row over twice. React then finds two children with the same key and renders one of
 * them unpredictably: a row shown twice, or one that disappears when its twin arrives.
 *
 * Nothing reported it because the platform's two warnings for exactly this were both in
 * `LogBox.ignoreLogs` in app/_layout.tsx. Those suppressions are gone; `app/_layout.test.tsx`
 * keeps them gone.
 */
describe('usePaginatedApi — a row cannot appear twice', () => {
  interface Row { id: number; label: string }

  function rowsResponse(rows: Row[], cursor: string | null, hasMore: boolean) {
    return { data: rows, meta: { cursor, has_more: hasMore } };
  }

  function rowExtractor(r: { data: Row[]; meta: { cursor: string | null; has_more: boolean } }) {
    return { items: r.data, cursor: r.meta.cursor, hasMore: r.meta.has_more };
  }

  it('drops a row the next page repeats', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(rowsResponse([{ id: 1, label: 'a' }, { id: 2, label: 'b' }], 'c1', true))
      // The server has re-ordered since page one, so row 2 arrives again.
      .mockResolvedValueOnce(rowsResponse([{ id: 2, label: 'b' }, { id: 3, label: 'c' }], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, rowExtractor));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    expect(result.current.items.map((row) => row.id)).toEqual([1, 2, 3]);
  });

  it('drops a row a single page repeats within itself', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValue(rowsResponse([{ id: 1, label: 'a' }, { id: 1, label: 'a' }], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, rowExtractor));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(1);
  });

  it('keeps rows that carry no id, rather than throwing them away', async () => {
    // Losing a row because we cannot identify it would be worse than showing one twice.
    const fetchFn = jest
      .fn()
      .mockResolvedValue(rowsResponse([{ label: 'x' } as Row, { label: 'y' } as Row], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, rowExtractor));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toHaveLength(2);
  });

  it('uses a caller-supplied key when id alone is not identity', async () => {
    // The feed's case: a post and a listing can share a number, so the pair is the key.
    interface FeedRow { id: number; type: string }
    const page = {
      data: [
        { id: 1, type: 'post' },
        { id: 1, type: 'listing' },
        { id: 1, type: 'post' },
      ] as FeedRow[],
      meta: { cursor: null, has_more: false },
    };
    const fetchFn = jest.fn().mockResolvedValue(page);

    const { result } = renderHook(() =>
      usePaginatedApi<FeedRow, typeof page>(
        fetchFn,
        (r) => ({ items: r.data, cursor: r.meta.cursor, hasMore: r.meta.has_more }),
        undefined,
        { getKey: (item) => `${item.type}-${item.id}` },
      ),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The duplicate post goes; the listing that merely shares a number stays.
    expect(result.current.items).toEqual([{ id: 1, type: 'post' }, { id: 1, type: 'listing' }]);
  });

  it('leaves the list untouched when an appended page is entirely duplicates', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(rowsResponse([{ id: 1, label: 'a' }], 'c1', true))
      .mockResolvedValueOnce(rowsResponse([{ id: 1, label: 'a' }], null, false));

    const { result } = renderHook(() => usePaginatedApi(fetchFn, rowExtractor));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const before = result.current.items;

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.isLoadingMore).toBe(false));

    // Same array reference: a page of nothing new must not re-render every row.
    expect(result.current.items).toBe(before);
  });
});
