// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMenus } from './useMenus';
// The i18next singleton src/test/setup.ts initialises from public/locales/en. useMenus deliberately
// discards the API's raw error text and surfaces one localized message instead, so these assertions
// resolve the expected text through the same key rather than pinning English. Both previously
// asserted the raw API strings and broke when the hook started localizing.
import i18next from 'i18next';

vi.mock('@/lib/api', () => ({
  menuApi: {
    getMenus: vi.fn(),
  },
}));

import { menuApi } from '@/lib/api';
const mockMenuApi = menuApi as unknown as { getMenus: ReturnType<typeof vi.fn> };

const realMenu = {
  id: 1,
  slug: 'main-nav',
  location: 'header',
  items: [{ id: 10, label: 'Home', url: '/' }],
};

const defaultMenu = {
  id: 'default-main',
  slug: 'default-main-nav',
  location: 'header',
  items: [],
};

describe('useMenus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts in loading state', () => {
    mockMenuApi.getMenus.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMenus(false));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('loads menus as object by location', async () => {
    mockMenuApi.getMenus.mockResolvedValue({
      success: true,
      data: { header: [realMenu] },
    });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.menus).toEqual({ header: [realMenu] });
    expect(result.current.error).toBeNull();
  });

  it('groups menus when API returns an array', async () => {
    mockMenuApi.getMenus.mockResolvedValue({
      success: true,
      data: [realMenu],
    });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.menus.header).toBeDefined();
    expect(result.current.menus.header![0].id).toBe(1);
  });

  it('sets hasCustomMenus true when real menus with items present', async () => {
    mockMenuApi.getMenus.mockResolvedValue({
      success: true,
      data: { header: [realMenu] },
    });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasCustomMenus).toBe(true);
  });

  it('sets hasCustomMenus false for default menus', async () => {
    mockMenuApi.getMenus.mockResolvedValue({
      success: true,
      data: { header: [defaultMenu] },
    });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasCustomMenus).toBe(false);
  });

  it('sets error when API returns success false', async () => {
    mockMenuApi.getMenus.mockResolvedValue({ success: false, error: 'Not found' });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(i18next.t('errors:api.request_failed'));
    expect(result.current.hasCustomMenus).toBe(false);
  });

  it('sets error on network failure', async () => {
    mockMenuApi.getMenus.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe(i18next.t('errors:api.request_failed'));
  });

  it('re-fetches when isAuthenticated changes', async () => {
    mockMenuApi.getMenus.mockResolvedValue({ success: true, data: {} });

    let isAuthenticated = false;
    const { rerender } = renderHook(() => useMenus(isAuthenticated));
    await waitFor(() => expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(1));

    isAuthenticated = true;
    rerender();
    await waitFor(() => expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(2));
  });

  it('re-fetches when tenantId changes', async () => {
    mockMenuApi.getMenus.mockResolvedValue({ success: true, data: {} });

    let tenantId: number | null = 1;
    const { rerender } = renderHook(() => useMenus(true, tenantId));
    await waitFor(() => expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(1));

    tenantId = 2;
    rerender();
    await waitFor(() => expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(2));
  });

  it('refresh function triggers a re-fetch', async () => {
    mockMenuApi.getMenus.mockResolvedValue({ success: true, data: {} });

    const { result } = renderHook(() => useMenus(true));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockMenuApi.getMenus).toHaveBeenCalledTimes(2);
  });
});
