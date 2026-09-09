// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NotificationsContext
 * Covers: initial state, count fetching, markAsRead, markAllAsRead, Pusher events, unauthenticated cleanup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { ReactNode } from 'react';

vi.mock('@/lib/motion');
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Pusher mock
// ─────────────────────────────────────────────────────────────────────────────

// We capture the channel's bound event handlers so tests can trigger them.
type EventHandler = (data: unknown) => void;
const channelEventHandlers: Record<string, EventHandler> = {};
const connectionHandlers: Record<string, () => void> = {};

// All Pusher mock functions and the MockPusher constructor must live in
// vi.hoisted() so they are available inside the vi.mock('pusher-js', ...) factory
// before module-level const declarations are initialized.
// MockPusher is used as the default export directly (not wrapped in an arrow
// function) because arrow functions cannot be called with `new`.
const {
  MockPusher,
  mockChannel,
  mockPusherSubscribe,
  mockPusherDisconnect,
  mockChannelBind,
  mockChannelUnbindAll,
  mockConnectionBind,
} = vi.hoisted(() => {
  // Set VITE_PUSHER_KEY before NotificationsContext is imported so getPusherKey()
  // returns a non-empty string. vi.stubEnv() in beforeEach runs too late.
  // @ts-expect-error vitest allows mutating import.meta.env in tests
  import.meta.env.VITE_PUSHER_KEY = 'test-pusher-key';

  const mockChannelUnbindAll = vi.fn();
  const mockChannelBind = vi.fn();
  const mockChannel = { bind: mockChannelBind, unbind_all: mockChannelUnbindAll };
  const mockConnectionBind = vi.fn();
  const mockPusherDisconnect = vi.fn();
  const mockPusherSubscribe = vi.fn().mockReturnValue(mockChannel);
  const MockPusher = vi.fn().mockImplementation(() => ({
    subscribe: mockPusherSubscribe,
    disconnect: mockPusherDisconnect,
    connection: { bind: mockConnectionBind },
  }));
  return { MockPusher, mockChannel, mockPusherSubscribe, mockPusherDisconnect, mockChannelBind, mockChannelUnbindAll, mockConnectionBind };
});

vi.mock('pusher-js', () => ({
  // MockPusher is a vi.fn() (not an arrow function) — safe to call with `new`.
  default: MockPusher,
}));

// ─────────────────────────────────────────────────────────────────────────────
// API mock
// ─────────────────────────────────────────────────────────────────────────────

// Use vi.hoisted so these are available in the hoisted vi.mock factory
const { mockApiGet, mockApiPost, mockTokenManager } = vi.hoisted(() => {
  const mockApiGet = vi.fn();
  const mockApiPost = vi.fn();
  const mockTokenManager = {
    getAccessToken: vi.fn().mockReturnValue('test-token'),
    getTenantId: vi.fn().mockReturnValue('2'),
  };
  return { mockApiGet, mockApiPost, mockTokenManager };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  tokenManager: mockTokenManager,
  API_BASE: '/api',
}));

// ─────────────────────────────────────────────────────────────────────────────
// Logger mock
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// AuthContext mock
// ─────────────────────────────────────────────────────────────────────────────

const mockUseAuth = vi.fn();
const disabledModules = new Set<string>();
// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('../TenantContext', () => ({
  useTenant: () => ({ hasModule: (module: string) => !disabledModules.has(module), hasFeature: vi.fn((_key: string) => true) }),
}));

vi.mock('../AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// ToastContext mock
// ─────────────────────────────────────────────────────────────────────────────

const mockToastInfo = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
const mockToastWarning = vi.fn();
const mockToastAddToast = vi.fn();
const mockToastRemoveToast = vi.fn();

// IMPORTANT: must be a stable constant — NOT a new object on every call.
// NotificationsContext uses useCallback([toast]) and useEffect([handleNewNotification]).
// If useToast() returns a new object each render, toast reference changes every render,
// which recreates handleNewNotification, which re-fires the useEffect → infinite loop → OOM.
const stableToastValue = {
  info: mockToastInfo,
  success: mockToastSuccess,
  error: mockToastError,
  warning: mockToastWarning,
  addToast: mockToastAddToast,
  removeToast: mockToastRemoveToast,
  toasts: [] as unknown[],
};

vi.mock('../ToastContext', () => ({
  useToast: () => stableToastValue,
}));

const { mockRealtime } = vi.hoisted(() => ({
  mockRealtime: {
    isConnected: false,
    isNotificationChannelReady: false,
    onNotification: vi.fn(),
    onUserMessage: vi.fn(),
    onTransaction: vi.fn(),
  },
}));

vi.mock('../PusherContext', () => ({
  usePusherOptional: () => mockRealtime,
}));

import { NotificationsProvider, useNotifications } from '../NotificationsContext';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const mockUser = {
  id: 42,
  name: 'Test User',
  tenant_id: 2,
};

const mockCounts = {
  total: 5,
  messages: 2,
  listings: 1,
  transactions: 1,
  connections: 0,
  events: 0,
  groups: 0,
  achievements: 1,
  system: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// Wrappers
// ─────────────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  // UI provider omitted — these tests don't render UI components.
  return <>{children}</>;
}

function notificationsWrapper({ children }: { children: ReactNode }) {
  // UI provider is intentionally omitted here — NotificationsProvider does not
  // render any HeroUI components, and including it would inject CSS into JSDOM on
  // every test, accumulating hundreds of MB per test and causing OOM in the worker.
  return <NotificationsProvider>{children}</NotificationsProvider>;
}

describe('NotificationsContext', () => {
  beforeEach(() => {
    disabledModules.clear();
    vi.clearAllMocks();
    // Reset channel handlers
    Object.keys(channelEventHandlers).forEach((k) => delete channelEventHandlers[k]);
    Object.keys(connectionHandlers).forEach((k) => delete connectionHandlers[k]);

    // vi.clearAllMocks() wipes mockImplementation() set at module scope — restore them.
    // mockChannelBind and mockConnectionBind must capture handlers into their maps.
    mockChannelBind.mockImplementation((event: string, handler: EventHandler) => {
      channelEventHandlers[event] = handler;
    });
    mockConnectionBind.mockImplementation((event: string, handler: () => void) => {
      connectionHandlers[event] = handler;
    });
    mockPusherSubscribe.mockReturnValue(mockChannel);
    MockPusher.mockImplementation(() => ({
      subscribe: mockPusherSubscribe,
      disconnect: mockPusherDisconnect,
      connection: { bind: mockConnectionBind },
    }));

    mockRealtime.isConnected = false;
    mockRealtime.isNotificationChannelReady = false;
    mockRealtime.onNotification.mockImplementation((handler: EventHandler) => {
      channelEventHandlers.notification = handler;
      channelEventHandlers['new-notification'] = handler;
      return () => {
        delete channelEventHandlers.notification;
        delete channelEventHandlers['new-notification'];
      };
    });
    mockRealtime.onUserMessage.mockImplementation((handler: EventHandler) => {
      channelEventHandlers['new-message'] = handler;
      return () => {
        delete channelEventHandlers['new-message'];
      };
    });
    mockRealtime.onTransaction.mockImplementation((handler: EventHandler) => {
      channelEventHandlers.transaction = handler;
      return () => {
        delete channelEventHandlers.transaction;
      };
    });

    // Default: authenticated
    mockUseAuth.mockReturnValue({
      user: mockUser,
      isAuthenticated: true,
    });

    // Default API responses
    mockApiGet.mockImplementation((url: string) => {
      if (url === '/v2/notifications/counts') {
        return Promise.resolve({ success: true, data: mockCounts });
      }
      if (url === '/v2/messages/unread-count') {
        return Promise.resolve({ success: true, data: { count: 3 } });
      }
      return Promise.resolve({ success: false });
    });
    mockApiPost.mockResolvedValue({ success: true });

    mockTokenManager.getAccessToken.mockReturnValue('test-token');
    mockTokenManager.getTenantId.mockReturnValue('2');
  });

  afterEach(() => {
    cleanup(); // Unmount React trees, triggering useEffect cleanups → clearInterval on polling ref
    vi.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hook guard
  // ─────────────────────────────────────────────────────────────────────────

  describe('useNotifications() outside provider', () => {
    it('throws a descriptive error when used outside NotificationsProvider', () => {
      expect(() => {
        renderHook(() => useNotifications(), { wrapper });
      }).toThrowError('useNotifications must be used within a NotificationsProvider');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Initial state
  // ─────────────────────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('does not request counts or write notifications when both modules are off', async () => {
      disabledModules.add('notifications');
      disabledModules.add('messages');
      const { result } = renderHook(() => useNotifications(), { wrapper: notificationsWrapper });
      await act(async () => { await result.current.refreshCounts(); });
      expect(mockApiGet).not.toHaveBeenCalled();
      await act(async () => {
        expect(await result.current.markAsRead(1)).toBe(false);
        expect(await result.current.markAllAsRead()).toBe(false);
      });
      expect(mockApiPost).not.toHaveBeenCalled();
    });
    it('starts with unreadCount 0 and empty counts', () => {
      // Prevent API from resolving during this test
      mockApiGet.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      expect(result.current.unreadCount).toBe(0);
      expect(result.current.counts.total).toBe(0);
      expect(result.current.counts.messages).toBe(0);
      expect(result.current.counts.listings).toBe(0);
    });

    it('starts with isConnected false', () => {
      mockApiGet.mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      expect(result.current.isConnected).toBe(false);
    });

    it('exposes refreshCounts, markAsRead and markAllAsRead functions', () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      expect(typeof result.current.refreshCounts).toBe('function');
      expect(typeof result.current.markAsRead).toBe('function');
      expect(typeof result.current.markAllAsRead).toBe('function');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fetching counts on mount
  // ─────────────────────────────────────────────────────────────────────────

  describe('loading notification counts on mount', () => {
    it('calls /v2/notifications/counts when user is authenticated', async () => {
      renderHook(() => useNotifications(), { wrapper: notificationsWrapper });

      await waitFor(() => {
        expect(mockApiGet).toHaveBeenCalledWith('/v2/notifications/counts');
      });
    });

    it('sets unreadCount from counts.total after successful fetch', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(5);
      });
    });

    it('populates per-category counts correctly', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => {
        expect(result.current.counts.achievements).toBe(1);
        expect(result.current.counts.listings).toBe(1);
        expect(result.current.counts.transactions).toBe(1);
      });
    });

    it('uses the messages unread count from /v2/messages/unread-count (not notification count)', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => {
        // mockCounts.messages = 2, but /v2/messages/unread-count returns count: 3
        expect(result.current.counts.messages).toBe(3);
      });
    });

    it('does NOT call the API when user is not authenticated', async () => {
      mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });

      renderHook(() => useNotifications(), { wrapper: notificationsWrapper });

      // Give a tick for effects to fire
      await new Promise((r) => setTimeout(r, 10));

      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // refreshCounts
  // ─────────────────────────────────────────────────────────────────────────

  describe('refreshCounts()', () => {
    it('re-fetches notification counts and updates state', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      const updatedCounts = { ...mockCounts, total: 10 };
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/v2/notifications/counts') {
          return Promise.resolve({ success: true, data: updatedCounts });
        }
        return Promise.resolve({ success: true, data: { count: 3 } });
      });

      await act(async () => {
        await result.current.refreshCounts();
      });

      expect(result.current.unreadCount).toBe(10);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // markAsRead
  // ─────────────────────────────────────────────────────────────────────────

  describe('markAsRead(id)', () => {
    it('decrements unreadCount by 1 after successfully marking a notification read', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      await act(async () => {
        await result.current.markAsRead(101);
      });

      expect(result.current.unreadCount).toBe(4);
      expect(mockApiPost).toHaveBeenCalledWith('/v2/notifications/101/read');
    });

    it('does not go below 0 when marking read on already-zero count', async () => {
      // Override to return 0 counts
      mockApiGet.mockImplementation((url: string) => {
        if (url === '/v2/notifications/counts') {
          return Promise.resolve({ success: true, data: { ...mockCounts, total: 0 } });
        }
        return Promise.resolve({ success: true, data: { count: 0 } });
      });

      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(0));

      await act(async () => {
        await result.current.markAsRead(999);
      });

      expect(result.current.unreadCount).toBe(0);
    });

    it('does not change unreadCount when API call fails', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      mockApiPost.mockResolvedValueOnce({ success: false });

      await act(async () => {
        await result.current.markAsRead(101);
      });

      expect(result.current.unreadCount).toBe(5); // unchanged
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // markAllAsRead
  // ─────────────────────────────────────────────────────────────────────────

  describe('markAllAsRead()', () => {
    it('resets unreadCount to 0 and zeroes all category counts', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(0);
      expect(result.current.counts.total).toBe(0);
      expect(result.current.counts.listings).toBe(0);
      expect(result.current.counts.achievements).toBe(0);
      expect(mockApiPost).toHaveBeenCalledWith('/v2/notifications/read-all');
    });

    it('leaves state unchanged when API returns success false', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      mockApiPost.mockResolvedValueOnce({ success: false });

      await act(async () => {
        await result.current.markAllAsRead();
      });

      expect(result.current.unreadCount).toBe(5); // unchanged
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Pusher real-time events
  // ─────────────────────────────────────────────────────────────────────────

  describe('Pusher real-time events', () => {
    beforeEach(() => {
      // Ensure VITE_PUSHER_KEY is set so Pusher initializes
      vi.stubEnv('VITE_PUSHER_KEY', 'test-pusher-key');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('increments unreadCount when a notification event arrives via Pusher', async () => {
      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      // Simulate Pusher firing a 'notification' event
      act(() => {
        const handler = channelEventHandlers['notification'];
        if (handler) {
          handler({
            id: 200,
            type: 'achievement',
            title: 'Badge Earned',
            message: 'You earned a badge!',
            read: false,
          });
        }
      });

      expect(result.current.unreadCount).toBe(6);
    });

    it('shows a toast when a notification arrives', async () => {
      vi.stubEnv('VITE_PUSHER_KEY', 'test-pusher-key');

      renderHook(() => useNotifications(), { wrapper: notificationsWrapper });

      await waitFor(() => {
        expect(channelEventHandlers['notification']).toBeDefined();
      });

      act(() => {
        channelEventHandlers['notification']({
          id: 201,
          type: 'connection',
          title: 'Connection Request',
          message: 'Jane wants to connect',
          read: false,
        });
      });

      expect(mockToastInfo).toHaveBeenCalledWith('Connection Request', 'Jane wants to connect');
    });

    it('increments unreadCount and messages count when a new-message event arrives', async () => {
      vi.stubEnv('VITE_PUSHER_KEY', 'test-pusher-key');

      const { result } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));
      const initialMessages = result.current.counts.messages;

      act(() => {
        const handler = channelEventHandlers['new-message'];
        if (handler) {
          handler({ body: 'Hello there!' });
        }
      });

      expect(result.current.unreadCount).toBe(6);
      expect(result.current.counts.messages).toBe(initialMessages + 1);
    });

    it('shows toast for new-message event', async () => {
      vi.stubEnv('VITE_PUSHER_KEY', 'test-pusher-key');

      renderHook(() => useNotifications(), { wrapper: notificationsWrapper });

      await waitFor(() => {
        expect(channelEventHandlers['new-message']).toBeDefined();
      });

      act(() => {
        channelEventHandlers['new-message']({ body: 'Hey, how are you?' });
      });

      expect(mockToastInfo).toHaveBeenCalledWith('New Message', 'Hey, how are you?');
    });

    it('registers notification bindings with the shared realtime owner', async () => {
      renderHook(() => useNotifications(), { wrapper: notificationsWrapper });

      await waitFor(() => {
        expect(mockRealtime.onNotification).toHaveBeenCalledOnce();
        expect(mockRealtime.onUserMessage).toHaveBeenCalledOnce();
        expect(mockRealtime.onTransaction).toHaveBeenCalledOnce();
      });

      expect(MockPusher).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Unauthenticated cleanup
  // ─────────────────────────────────────────────────────────────────────────

  describe('unauthenticated state', () => {
    it('resets unreadCount to 0 when user logs out', async () => {
      // Start authenticated
      const { result, rerender } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      // Switch to unauthenticated
      mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });

      act(() => {
        rerender();
      });

      await waitFor(() => {
        expect(result.current.unreadCount).toBe(0);
      });
    });

    it('sets isConnected false when user logs out', async () => {
      const { result, rerender } = renderHook(() => useNotifications(), {
        wrapper: notificationsWrapper,
      });

      await waitFor(() => expect(result.current.unreadCount).toBe(5));

      mockUseAuth.mockReturnValue({ user: null, isAuthenticated: false });

      act(() => {
        rerender();
      });

      await waitFor(() => {
        expect(result.current.isConnected).toBe(false);
      });
    });
  });
});
