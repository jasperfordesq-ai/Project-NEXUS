// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for useApiErrorHandler hook
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useApiErrorHandler } from './useApiErrorHandler';
import { API_ERROR_EVENT } from '@/lib/api';

// Mock ToastContext
const mockError = vi.fn();
vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({
    error: mockError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    toasts: [],
    addToast: vi.fn(),
    removeToast: vi.fn(),
  }),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

describe('useApiErrorHandler', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows toast for network error', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Network error', code: 'NETWORK_ERROR' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledWith(
      "That didn't work",
      "We can't connect. Check your internet connection and try again."
    );
  });

  it('deduplicates identical API error toasts during request cascades', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Network error', code: 'NETWORK_ERROR' },
        })
      );
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Network error', code: 'NETWORK_ERROR' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledTimes(1);
  });

  it('shows toast for HTTP 404', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Not found', code: 'HTTP_404' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledWith(
      "That didn't work",
      "We can't find that. It may have been moved or removed."
    );
  });

  it('shows toast for HTTP 500', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Server error', code: 'HTTP_500' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledWith(
      "That didn't work",
      "We hit a problem on our side. Please try again in a little while."
    );
  });

  it('shows toast for rate limiting (HTTP 429)', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Rate limited', code: 'HTTP_429' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledWith(
      "That didn't work",
      "Too many tries at once. Please wait a moment and try again."
    );
  });

  it('does NOT show toast for SESSION_EXPIRED', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Session expired', code: 'SESSION_EXPIRED' },
        })
      );
    });

    expect(mockError).not.toHaveBeenCalled();
  });

  it.each(['CANCELLED', 'UPLOAD_ABORTED'])('does NOT show toast for intentional %s control flow', (code) => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Cancelled', code },
        })
      );
    });

    expect(mockError).not.toHaveBeenCalled();
  });

  it('uses the localized generic message for an unknown error code', () => {
    renderHook(() => useApiErrorHandler());

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Something weird happened', code: 'UNKNOWN_CODE' },
        })
      );
    });

    expect(mockError).toHaveBeenCalledWith(
      "That didn't work",
      "We couldn't do that just now. Please try again."
    );
  });

  it('cleans up event listener on unmount', () => {
    const { unmount } = renderHook(() => useApiErrorHandler());
    unmount();

    act(() => {
      window.dispatchEvent(
        new CustomEvent(API_ERROR_EVENT, {
          detail: { message: 'Test', code: 'HTTP_500' },
        })
      );
    });

    expect(mockError).not.toHaveBeenCalled();
  });
});
