// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('@/lib/constants', () => ({
  DEFAULT_TENANT: 'hour-timebank',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'auth_token',
    REFRESH_TOKEN: 'refresh_token',
    TENANT_SLUG: 'tenant_slug',
    USER_DATA: 'user_data',
  },
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  TIMEOUTS: { API_REQUEST: 15_000 },
}));

const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn().mockResolvedValue(undefined);
const mockStorageRemove = jest.fn().mockResolvedValue(undefined);
const mockStorageGetJson = jest.fn().mockResolvedValue(null);
const mockStorageSetJson = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/storage', () => ({
  storage: {
    get: (...args: unknown[]) => mockStorageGet(...args),
    set: (...args: unknown[]) => mockStorageSet(...args),
    remove: (...args: unknown[]) => mockStorageRemove(...args),
    getJson: (...args: unknown[]) => mockStorageGetJson(...args),
    setJson: (...args: unknown[]) => mockStorageSetJson(...args),
  },
}));

const mockGetTenantConfig = jest.fn();

jest.mock('@/lib/api/tenant', () => ({
  getTenantConfig: (...args: unknown[]) => mockGetTenantConfig(...args),
}));

// --- Test data ---

const mockTenant = {
  id: 1,
  name: 'Hour Timebank',
  slug: 'hour-timebank',
  branding: { primary_color: '#4CAF50', logo_url: null },
  features: { events: true, marketplace: false, blog: true },
  modules: { wallet: true, blog: false },
};

// --- Tests ---

import { TenantProvider, useTenantContext } from './TenantContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <TenantProvider>{children}</TenantProvider>
);

describe('TenantContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageGetJson.mockResolvedValue(null);
    mockGetTenantConfig.mockResolvedValue({ data: mockTenant });
  });

  it('uses default tenant config without remembering it before first-install selection', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { result } = renderHook(() => useTenantContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockStorageSet).not.toHaveBeenCalledWith('tenant_slug', 'hour-timebank');
    expect(result.current.tenant).toEqual(mockTenant);
    expect(result.current.tenantSlug).toBe('hour-timebank');
    expect(result.current.hasSelectedTenant).toBe(false);
  });

  it('restores tenant from stored slug', async () => {
    mockStorageGet.mockResolvedValue('my-community');
    const { result } = renderHook(() => useTenantContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tenantSlug).toBe('my-community');
    expect(result.current.hasSelectedTenant).toBe(true);
    expect(mockStorageSet).toHaveBeenCalledWith('tenant_slug', 'my-community');
  });

  it('forgets a removed remembered community and returns a signed-out install to the picker', async () => {
    mockStorageGet.mockResolvedValue('removed-community');
    mockGetTenantConfig
      .mockRejectedValueOnce(Object.assign(new Error('Community not found'), { status: 404 }))
      .mockResolvedValueOnce({ data: mockTenant });

    const { result } = renderHook(() => useTenantContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockStorageRemove).toHaveBeenCalledWith('tenant_slug');
    expect(result.current.hasSelectedTenant).toBe(false);
    expect(result.current.tenantSlug).toBe('hour-timebank');
    expect(result.current.tenant).toEqual(mockTenant);
  });

  it('ignores cached config for a different tenant slug', async () => {
    mockStorageGet.mockResolvedValue('hour-timebank');
    mockStorageGetJson.mockResolvedValue({
      ...mockTenant,
      slug: 'other-community',
      features: { events: false, marketplace: false, blog: false },
    });

    const { result } = renderHook(() => useTenantContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockStorageGetJson).toHaveBeenCalledWith('nexus_tenant_config_hour-timebank');
    expect(mockStorageRemove).toHaveBeenCalledWith('nexus_tenant_config_hour-timebank');
    expect(result.current.tenant?.slug).toBe('hour-timebank');
    expect(result.current.hasFeature('events')).toBe(true);
  });

  // 🔴 Expo SecureStore throws on any key outside [A-Za-z0-9._-], and this key was
  // built with a colon, so the cache silently never worked on a real device.
  // storage.ts swallows the throw, so nothing but this assertion can catch it.
  it('only ever uses SecureStore-legal characters in the tenant config cache key', async () => {
    // A slug carrying characters SecureStore rejects. It is read back out of
    // storage, so this module cannot assume it is well-formed.
    mockStorageGet.mockResolvedValue('café:tea/2 timebank');

    const { result } = renderHook(() => useTenantContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const keys = [
      ...mockStorageGetJson.mock.calls.map((call) => call[0]),
      ...mockStorageSetJson.mock.calls.map((call) => call[0]),
      ...mockStorageRemove.mock.calls.map((call) => call[0]),
    ].filter((key): key is string => typeof key === 'string');

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('hasFeature returns true for an enabled feature', async () => {
    const { result } = renderHook(() => useTenantContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasFeature('events')).toBe(true);
  });

  it('hasFeature returns false for a disabled feature', async () => {
    const { result } = renderHook(() => useTenantContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasFeature('marketplace')).toBe(false);
  });

  it('hasFeature returns false when tenant is null (graceful degradation)', async () => {
    mockGetTenantConfig.mockRejectedValue(new Error('Network error'));
    const { result } = renderHook(() => useTenantContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tenant).toBeNull();
    expect(result.current.hasFeature('events')).toBe(false);
  });

  it('setTenantSlug updates the slug and reloads config', async () => {
    const newTenant = { ...mockTenant, slug: 'new-bank', name: 'New Bank' };
    mockGetTenantConfig
      .mockResolvedValueOnce({ data: mockTenant })
      .mockResolvedValueOnce({ data: newTenant });

    const { result } = renderHook(() => useTenantContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.setTenantSlug('new-bank');
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tenantSlug).toBe('new-bank');
    expect(result.current.tenant?.name).toBe('New Bank');
    expect(result.current.hasSelectedTenant).toBe(true);
    expect(mockGetTenantConfig).toHaveBeenCalledTimes(2);
  });
});
