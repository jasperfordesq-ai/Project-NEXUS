// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { renderHook, waitFor, act } from '@testing-library/react-native';
import { useApi } from './useApi';
import { ApiResponseError } from '@/lib/api/client';

describe('useApi', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts in loading state with null data and no error', () => {
    const fetchFn = jest.fn(() => new Promise<never>(() => {})); // never resolves
    const { result } = renderHook(() => useApi(fetchFn));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets data and clears loading on success', async () => {
    const payload = { items: [1, 2, 3] };
    const fetchFn = jest.fn().mockResolvedValue(payload);
    const { result } = renderHook(() => useApi(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(payload);
    expect(result.current.error).toBeNull();
  });

  it('sets ApiResponseError message on API failure', async () => {
    const fetchFn = jest.fn().mockRejectedValue(
      new ApiResponseError(422, 'Unprocessable entity'),
    );
    const { result } = renderHook(() => useApi(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Unprocessable entity');
  });

  it('sets generic message on unexpected error', async () => {
    jest.useFakeTimers();
    const fetchFn = jest.fn().mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useApi(fetchFn));

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    // A translation key, not English prose: the hook no longer hard-codes the message.
    expect(result.current.error).toBe('common:errors.generic');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('refresh() re-triggers the fetch and updates data', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ value: 'first' });
    const { result } = renderHook(() => useApi(fetchFn));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ value: 'first' });

    fetchFn.mockResolvedValue({ value: 'second' });
    act(() => result.current.refresh());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual({ value: 'second' });
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('re-runs when deps change', async () => {
    let dep = 1;
    const fetchFn = jest.fn().mockResolvedValue({ dep });
    const { result, rerender } = renderHook(() => useApi(fetchFn, [dep]));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);

    dep = 2;
    fetchFn.mockResolvedValue({ dep });
    rerender({});

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });
});

// The hook translates its fallback error; return the key so the assertion is locale-free.
jest.mock('i18next', () => ({ __esModule: true, default: { t: (key: string) => key } }));
