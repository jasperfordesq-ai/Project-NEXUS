// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePushNotifications } from './usePushNotifications';

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Mock TenantContext
const mockTenantPath = vi.fn((p: string) => `/test${p}`);
// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: mockTenantPath,
  }),
}));

// Mock api
const mockApiPost = vi.fn().mockResolvedValue({ success: true });
vi.mock('@/lib/api', () => ({
  api: {
    post: (...args: unknown[]) => mockApiPost(...args),
  },
}));

describe('usePushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // By default, window.Capacitor is not defined (web browser)
    delete ((window as unknown as Record<string, unknown>)).Capacitor;
  });

  afterEach(() => {
    delete ((window as unknown as Record<string, unknown>)).Capacitor;
  });

  it('does not throw when called with null userId', () => {
    expect(() => {
      renderHook(() => usePushNotifications(null));
    }).not.toThrow();
  });

  it('does not throw when called with a valid userId on web', () => {
    expect(() => {
      renderHook(() => usePushNotifications(42));
    }).not.toThrow();
  });

  it('does not call api.post when running in a web browser (no Capacitor)', () => {
    renderHook(() => usePushNotifications(1));
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('does not register when userId is null even if Capacitor is present', () => {
    ((window as unknown as Record<string, unknown>)).Capacitor = { isNativePlatform: () => true };
    renderHook(() => usePushNotifications(null));
    // No API call should be made because userId is null
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('returns undefined (hook has no return value)', () => {
    const { result } = renderHook(() => usePushNotifications(1));
    expect(result.current).toBeUndefined();
  });

  it('does not navigate when not in native app', () => {
    renderHook(() => usePushNotifications(1));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('handles cleanup without errors on unmount', () => {
    const { unmount } = renderHook(() => usePushNotifications(1));
    expect(() => unmount()).not.toThrow();
  });

  it('does not re-register when userId stays the same across rerenders', () => {
    const { rerender } = renderHook(
      ({ userId }) => usePushNotifications(userId),
      { initialProps: { userId: 1 as number | null } }
    );
    rerender({ userId: 1 });
    rerender({ userId: 1 });
    // On web, no registration happens, so api.post should never be called
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});
