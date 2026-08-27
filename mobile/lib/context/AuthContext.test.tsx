// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';

// --- Mocks (hoisted before imports) ---

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: {
    AUTH_TOKEN: 'auth_token',
    REFRESH_TOKEN: 'refresh_token',
    TENANT_SLUG: 'tenant_slug',
    USER_DATA: 'user_data',
  },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

const mockStorageGet = jest.fn();
const mockStorageSet = jest.fn().mockResolvedValue(undefined);
const mockStorageRemove = jest.fn().mockResolvedValue(undefined);
const mockStorageGetJson = jest.fn();
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

const mockApiLogin = jest.fn();
const mockApiLogout = jest.fn();
const mockGetMe = jest.fn();
const mockPurgeOfflineCheckin = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/eventOfflineCheckinStore', () => ({
  purgeAllMobileOfflineCheckinData: () => mockPurgeOfflineCheckin(),
}));

jest.mock('@/lib/api/auth', () => ({
  login: (...args: unknown[]) => mockApiLogin(...args),
  logout: (...args: unknown[]) => mockApiLogout(...args),
  getMe: (...args: unknown[]) => mockGetMe(...args),
  extractToken: jest.fn((r: { access_token?: string }) => r.access_token ?? ''),
  buildDisplayName: jest.fn((u: { first_name?: string | null }) => u.first_name ?? 'Member'),
}));

jest.mock('@/lib/api/client', () => ({
  registerUnauthorizedCallback: jest.fn(),
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
}));

const mockRegisterForPushNotifications = jest.fn().mockResolvedValue('registered');
const mockUnregisterPushNotifications = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/notifications', () => ({
  registerForPushNotifications: (...args: unknown[]) => mockRegisterForPushNotifications(...args),
  unregisterPushNotifications: (...args: unknown[]) => mockUnregisterPushNotifications(...args),
}));

// --- Tests ---

import { AuthProvider, useAuthContext } from './AuthContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

const mockUser = {
  id: 1,
  first_name: 'Jane',
  last_name: 'Smith',
  email: 'jane@example.com',
  avatar_url: null,
  tenant_id: 1,
  role: 'member',
  is_admin: false,
  onboarding_completed: true,
};

const mockFullUser = {
  ...mockUser,
  name: 'Jane Smith',
  bio: null,
  location: null,
  phone: null,
  balance: 10,
  created_at: null,
};

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageGet.mockResolvedValue(null);
    mockStorageGetJson.mockResolvedValue(null);
    mockApiLogout.mockResolvedValue(undefined);
  });

  it('starts in loading state', () => {
    // storage.get hangs — isLoading stays true
    mockStorageGet.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuthContext(), { wrapper });
    expect(result.current.isLoading).toBe(true);
  });

  it('becomes unauthenticated when no token is stored', async () => {
    mockStorageGet.mockResolvedValue(null);
    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('restores session when token and getMe both succeed', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.token).toBe('stored-token');
  });

  it('registers push notifications when restoring a cached session', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    await waitFor(() => expect(mockRegisterForPushNotifications).toHaveBeenCalledTimes(1));
  });

  it('clears session when stored token is invalid (getMe rejects)', async () => {
    mockStorageGet.mockResolvedValue('bad-token');
    mockStorageGetJson.mockResolvedValue(null);
    mockGetMe.mockRejectedValue(new Error('Unauthorized'));

    const { result } = renderHook(() => useAuthContext(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(mockStorageRemove).toHaveBeenCalled();
    expect(mockPurgeOfflineCheckin).toHaveBeenCalledTimes(1);
  });

  it('login() sets user and token', async () => {
    mockStorageGet.mockResolvedValue(null);
    mockApiLogin.mockResolvedValue({
      access_token: 'new-token',
      refresh_token: 'ref-token',
      user: mockUser,
    });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'jane@example.com', password: 'secret' });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(mockStorageSet).toHaveBeenCalledWith('auth_token', 'new-token');
    expect(mockStorageSet).toHaveBeenCalledWith('refresh_token', 'ref-token');
  });

  it('logout() clears user and token', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(mockStorageRemove).toHaveBeenCalled();
    expect(mockPurgeOfflineCheckin).toHaveBeenCalledTimes(1);
  });

  it('refreshUser() updates in-memory user without a network call', async () => {
    mockStorageGet.mockResolvedValue('stored-token');
    mockStorageGetJson.mockResolvedValue(mockUser);
    mockGetMe.mockResolvedValue({ data: mockFullUser });

    const { result } = renderHook(() => useAuthContext(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    const updated = { ...mockFullUser, first_name: 'Updated' };
    act(() => { result.current.refreshUser(updated); });

    expect(result.current.user).toEqual(updated);
    // getMe should only have been called once (during restore), not again
    expect(mockGetMe).toHaveBeenCalledTimes(1);
  });
});
