// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from './useApi';
// The i18next singleton src/test/setup.ts initialises from public/locales/en, so the expected text
// below resolves from the same key useApi uses rather than being hard-coded English.
import i18next from 'i18next';

const mockGet = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: { get: mockGet },
}));

describe('useApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not report a null endpoint as loading', () => {
    const { result } = renderHook(() => useApi<string>(null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('loads data and pagination metadata immediately', async () => {
    mockGet.mockResolvedValue({
      success: true,
      data: ['one'],
      meta: { current_page: 1, total_pages: 3, total: 3 },
    });

    const { result } = renderHook(() => useApi<string[]>('/v2/items'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(['one']);
    expect(result.current.meta?.total_pages).toBe(3);
  });

  it('retains a resolved API failure as an explicit error state', async () => {
    mockGet.mockResolvedValue({ success: false, error: 'Unavailable' });

    const { result } = renderHook(() => useApi('/v2/items'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    // useApi replaces the API's raw error with one localized message via t('api.request_failed'),
    // so this resolves the expected text through the same key instead of pinning English.
    expect(result.current.error).toBe(i18next.t('errors:api.request_failed'));
  });

  it('supports deliberate manual execution', async () => {
    mockGet.mockResolvedValue({ success: true, data: 'loaded' });
    const { result } = renderHook(() => (
      useApi<string>('/v2/manual', { immediate: false })
    ));

    expect(mockGet).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toBe('loaded');
    expect(mockGet).toHaveBeenCalledWith('/v2/manual');
  });

  it('supports local data updates and reset without a request', () => {
    const { result } = renderHook(() => (
      useApi<string>('/v2/manual', { immediate: false })
    ));

    act(() => result.current.setData('local'));
    expect(result.current.data).toBe('local');

    act(() => result.current.reset());
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('refetches when caller dependencies change', async () => {
    mockGet
      .mockResolvedValueOnce({ success: true, data: 'first' })
      .mockResolvedValueOnce({ success: true, data: 'second' });

    const { result, rerender } = renderHook(
      ({ version }) => useApi<string>('/v2/items', { deps: [version] }),
      { initialProps: { version: 1 } },
    );

    await waitFor(() => expect(result.current.data).toBe('first'));
    rerender({ version: 2 });
    await waitFor(() => expect(result.current.data).toBe('second'));
    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
