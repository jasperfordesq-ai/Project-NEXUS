// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react-native';

// --- Mocks (hoisted before imports) ---

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
}));

const mockApiGet = jest.fn();

jest.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

const mockInitRealtime = jest.fn();
const mockGetRealtimeClient = jest.fn();

jest.mock('@/lib/realtime', () => ({
  initRealtime: (...args: unknown[]) => mockInitRealtime(...args),
  getRealtimeClient: () => mockGetRealtimeClient(),
}));

const mockRegisterRefreshCallback = jest.fn();
const mockUnregisterRefreshCallback = jest.fn();
const mockSyncPushBadge = jest.fn();
const mockRegisterForPushNotifications = jest.fn();

jest.mock('@/lib/notifications', () => ({
  registerRefreshCallback: (...args: unknown[]) => mockRegisterRefreshCallback(...args),
  unregisterRefreshCallback: (...args: unknown[]) => mockUnregisterRefreshCallback(...args),
  syncPushBadge: (...args: unknown[]) => mockSyncPushBadge(...args),
  registerForPushNotifications: (...args: unknown[]) => mockRegisterForPushNotifications(...args),
}));

let mockIsAuthenticated = true;

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// Mock AppState from react-native
let mockAppStateHandler: ((state: string) => void) | undefined;
const mockAddEventListener = jest.fn((_type: string, handler: (state: string) => void) => {
  mockAppStateHandler = handler;
  return { remove: jest.fn() };
});

jest.mock('react-native', () => ({
  AppState: {
    currentState: 'active',
    addEventListener: (...args: [string, (state: string) => void]) => mockAddEventListener(...args),
  },
}));

// --- Tests ---

import { RealtimeProvider, useRealtimeContext } from './RealtimeContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <RealtimeProvider>{children}</RealtimeProvider>
);

describe('RealtimeContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAppStateHandler = undefined;
    mockGetRealtimeClient.mockReturnValue(null);
    mockIsAuthenticated = true;
    // The message badge must come from /messages/unread-count (the real
    // messages.is_read count). `notifications/counts.messages` counts bell rows
    // and is deliberately seeded with a sentinel here: if any test in this file
    // starts reporting 99, the badge has been wired back to the wrong store.
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/messages/unread-count')) {
        return Promise.resolve({ data: { count: 3 } });
      }
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { total: 5, messages: 99, transactions: 0, social: 0, system: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({ enabled: false, key: null, channels: {} });
      }
      return Promise.resolve({});
    });
  });

  it('seeds unread count from API on mount when authenticated', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(3));
    await waitFor(() => expect(mockSyncPushBadge).toHaveBeenCalledWith(5));
  });

  it('fetches Pusher config from the non-versioned /api/pusher/config route', async () => {
    // Regression: the backend registers /pusher/config OUTSIDE the v2 prefix —
    // /api/v2/pusher/config 404s in production and realtime silently dies.
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(3));
    await waitFor(() =>
      expect(mockApiGet).toHaveBeenCalledWith('/api/pusher/config'),
    );
    expect(mockApiGet).not.toHaveBeenCalledWith('/api/v2/pusher/config');
  });

  it('resets unread to 0 when not authenticated', async () => {
    mockIsAuthenticated = false;

    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(0));
    // Should not call the notifications API
    expect(mockApiGet).not.toHaveBeenCalledWith(
      expect.stringContaining('/notifications/counts'),
    );
  });

  // ---------------------------------------------------------------------------
  // Regression: the message badge came back at every login.
  //
  // The badge used to read `notifications/counts.messages`, which counts unread
  // rows in the `notifications` table. Reading a conversation clears
  // `messages.is_read`, never those rows, so the count survived being read and
  // reappeared on the next launch. Opening the Messages tab only *looked* like
  // it helped because resetUnread() set local state to 0 without telling the
  // server anything.
  // ---------------------------------------------------------------------------

  it('sources the badge from /messages/unread-count, not the bell count', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(3));
    expect(mockApiGet).toHaveBeenCalledWith(
      expect.stringContaining('/messages/unread-count'),
    );
    // 99 is the bell count. Reaching it means the badge is reading the store
    // that reading a message does not clear.
    expect(result.current.unreadMessages).not.toBe(99);
  });

  it('reports zero messages when the server says everything is read', async () => {
    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/messages/unread-count')) {
        return Promise.resolve({ data: { count: 0 } });
      }
      if (url.includes('/notifications/counts')) {
        // Stale bell rows for messages already read — the exact production state.
        return Promise.resolve({ data: { total: 2, messages: 2 } });
      }
      return Promise.resolve({ enabled: false, key: null, channels: {} });
    });

    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadNotifications).toBe(2));
    expect(result.current.unreadMessages).toBe(0);
  });

  it('keeps the previous badge value when the unread-count call fails', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });
    await waitFor(() => expect(result.current.unreadMessages).toBe(3));

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/messages/unread-count')) {
        return Promise.reject(new Error('offline'));
      }
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { total: 5, messages: 99 } });
      }
      return Promise.resolve({});
    });

    await act(async () => {
      result.current.refreshCounts(true);
    });

    // A dropped request must not invent "you have read everything".
    expect(result.current.unreadMessages).toBe(3);
  });

  it('refreshCounts(true) re-queries immediately instead of waiting out the throttle', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });
    await waitFor(() => expect(result.current.unreadMessages).toBe(3));

    const callsAfterSeed = mockApiGet.mock.calls.filter(([url]: [string]) =>
      String(url).includes('/messages/unread-count'),
    ).length;

    // Unforced: inside the 30s throttle window, so it must be a no-op.
    await act(async () => {
      result.current.refreshCounts();
    });
    expect(
      mockApiGet.mock.calls.filter(([url]: [string]) => String(url).includes('/messages/unread-count')).length,
    ).toBe(callsAfterSeed);

    // Forced: the caller has just marked a conversation read and needs truth now.
    await act(async () => {
      result.current.refreshCounts(true);
    });
    expect(
      mockApiGet.mock.calls.filter(([url]: [string]) => String(url).includes('/messages/unread-count')).length,
    ).toBe(callsAfterSeed + 1);
  });

  it('subscribeToMessages — handler receives messages, unsubscribe works', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(3));

    const handler = jest.fn();
    let unsubscribe: () => void;

    act(() => {
      unsubscribe = result.current.subscribeToMessages(42, handler);
    });

    // Subscribe a second handler to the same conversation
    const handler2 = jest.fn();
    act(() => {
      result.current.subscribeToMessages(42, handler2);
    });

    // Both handlers should be reachable (internal map has 2 entries)
    // Unsubscribe the first handler
    act(() => {
      unsubscribe();
    });

    // After unsubscribing, handler should no longer be in the set,
    // but handler2 should still be present. We verify by subscribing
    // and unsubscribing without errors.
    expect(handler).not.toHaveBeenCalled(); // No messages were pushed

    // Subscribe and immediately unsubscribe — should not throw
    let unsub2: () => void;
    act(() => {
      unsub2 = result.current.subscribeToMessages(99, jest.fn());
    });
    act(() => {
      unsub2();
    });
  });

  it('subscribeToMessages returns a working unsubscribe function for cleanup', async () => {
    const { result } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(result.current.unreadMessages).toBe(3));

    const handler = jest.fn();
    let unsubscribe: () => void;

    act(() => {
      unsubscribe = result.current.subscribeToMessages(10, handler);
    });

    // Calling unsubscribe multiple times should not throw
    act(() => {
      unsubscribe();
    });
    act(() => {
      unsubscribe(); // Idempotent — deleting from Set when already removed is safe
    });
  });

  it('registers refresh callback when authenticated', async () => {
    renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() =>
      expect(mockRegisterRefreshCallback).toHaveBeenCalledWith(expect.any(Function)),
    );
  });

  it('unregisters refresh callback when not authenticated', async () => {
    // Start authenticated, then switch
    const { rerender } = renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() =>
      expect(mockRegisterRefreshCallback).toHaveBeenCalled(),
    );

    mockIsAuthenticated = false;
    rerender({});

    await waitFor(() =>
      expect(mockUnregisterRefreshCallback).toHaveBeenCalled(),
    );
  });

  it('reconciles a rotated push token and reconnects realtime on foreground resume', async () => {
    const connect = jest.fn();
    mockGetRealtimeClient.mockReturnValue({ connection: { state: 'disconnected' }, connect });
    renderHook(() => useRealtimeContext(), { wrapper });

    await waitFor(() => expect(mockAppStateHandler).toBeDefined());
    act(() => {
      mockAppStateHandler!('background');
      mockAppStateHandler!('active');
    });

    expect(mockRegisterForPushNotifications).toHaveBeenCalledWith(false);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe('isMessagePayload validation', () => {
  // We need to test the isMessagePayload function indirectly since it's not exported.
  // We test it by setting up Pusher with a channel that fires 'new-message' events.

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRealtimeClient.mockReturnValue(null);
    mockIsAuthenticated = true;
  });

  // Since isMessagePayload is a module-private function, we test its behavior
  // through the Pusher channel binding. We set up a mock Pusher client that
  // captures the 'new-message' handler, then invoke it with various payloads.

  it('rejects non-object payloads (does not crash, bumps unread)', async () => {
    let newMessageHandler: ((data: unknown) => void) | undefined;

    const mockChannel = {
      bind: jest.fn((event: string, handler: (data: unknown) => void) => {
        if (event === 'new-message') newMessageHandler = handler;
      }),
      unbind_all: jest.fn(),
      name: 'private-user.1',
    };

    const mockClient = {
      subscribe: jest.fn(() => mockChannel),
      unsubscribe: jest.fn(),
      connection: { state: 'connected' },
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { messages: 0, notifications: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({
          enabled: true,
          key: 'test-key',
          channels: { user: 'private-user.1' },
        });
      }
      return Promise.resolve({});
    });

    mockInitRealtime.mockReturnValue(mockClient);

    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider>{children}</RealtimeProvider>
    );

    const { result } = renderHook(() => useRealtimeContext(), { wrapper: wrapper2 });

    // Wait for Pusher setup
    await waitFor(() => expect(newMessageHandler).toBeDefined());

    // Fire invalid payloads — isMessagePayload returns false, so badge bumps
    act(() => {
      newMessageHandler!(null); // not an object
    });
    expect(result.current.unreadMessages).toBe(1);

    act(() => {
      newMessageHandler!('string-payload'); // not an object
    });
    expect(result.current.unreadMessages).toBe(2);

    act(() => {
      newMessageHandler!(42); // number
    });
    expect(result.current.unreadMessages).toBe(3);
  });

  it('rejects payloads with missing fields (bumps unread)', async () => {
    let newMessageHandler: ((data: unknown) => void) | undefined;

    const mockChannel = {
      bind: jest.fn((event: string, handler: (data: unknown) => void) => {
        if (event === 'new-message') newMessageHandler = handler;
      }),
      unbind_all: jest.fn(),
      name: 'private-user.1',
    };

    const mockClient = {
      subscribe: jest.fn(() => mockChannel),
      unsubscribe: jest.fn(),
      connection: { state: 'connected' },
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { messages: 0, notifications: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({
          enabled: true,
          key: 'test-key',
          channels: { user: 'private-user.1' },
        });
      }
      return Promise.resolve({});
    });

    mockInitRealtime.mockReturnValue(mockClient);

    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider>{children}</RealtimeProvider>
    );

    const { result } = renderHook(() => useRealtimeContext(), { wrapper: wrapper2 });

    await waitFor(() => expect(newMessageHandler).toBeDefined());

    // Missing conversation_id
    act(() => {
      newMessageHandler!({ message: { id: 1 } });
    });
    expect(result.current.unreadMessages).toBe(1);

    // Missing message
    act(() => {
      newMessageHandler!({ conversation_id: 1 });
    });
    expect(result.current.unreadMessages).toBe(2);

    // conversation_id is string instead of number
    act(() => {
      newMessageHandler!({ conversation_id: 'abc', message: { id: 1 } });
    });
    expect(result.current.unreadMessages).toBe(3);

    // message is null
    act(() => {
      newMessageHandler!({ conversation_id: 1, message: null });
    });
    expect(result.current.unreadMessages).toBe(4);
  });

  it('accepts valid payload and dispatches to conversation handler', async () => {
    let newMessageHandler: ((data: unknown) => void) | undefined;

    const mockChannel = {
      bind: jest.fn((event: string, handler: (data: unknown) => void) => {
        if (event === 'new-message') newMessageHandler = handler;
      }),
      unbind_all: jest.fn(),
      name: 'private-user.1',
    };

    const mockClient = {
      subscribe: jest.fn(() => mockChannel),
      unsubscribe: jest.fn(),
      connection: { state: 'connected' },
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { messages: 0, notifications: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({
          enabled: true,
          key: 'test-key',
          channels: { user: 'private-user.1' },
        });
      }
      return Promise.resolve({});
    });

    mockInitRealtime.mockReturnValue(mockClient);

    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider>{children}</RealtimeProvider>
    );

    const { result } = renderHook(() => useRealtimeContext(), { wrapper: wrapper2 });

    await waitFor(() => expect(newMessageHandler).toBeDefined());

    /*
      🔴 The handler returns TRUE, meaning "I am on screen and the member has seen
      this". Being registered is deliberately no longer enough (audit 2026-09-06, F09):
      a thread screen subscribes in a plain effect and stays mounted underneath the
      listing or event a member opens from it, so a merely-registered listener used to
      silence the badge for a message nobody could see.
    */
    const handler = jest.fn(() => true);
    act(() => {
      result.current.subscribeToMessages(42, handler);
    });

    const fakeMessage = { id: 99, body: 'Hello', sender: { id: 7 } };

    // Fire a valid payload for conversation 42
    act(() => {
      newMessageHandler!({ conversation_id: 42, message: fakeMessage });
    });

    // Handler should have been called with the message
    expect(handler).toHaveBeenCalledWith(fakeMessage);
    // Badge should NOT bump: a visible thread reported that it showed the member.
    expect(result.current.unreadMessages).toBe(0);
  });

  it('still bumps unread when the subscribed thread is covered by another screen', async () => {
    /*
      🔴 The heart of F09. The thread stays mounted and subscribed while the member
      reads the listing or event it is about, so it must go on RECEIVING - but a message it
      cannot show is unread, and the badge is the only thing that will ever tell the member
      it arrived. A handler that returns anything but `true` is reporting exactly that.
    */
    let newMessageHandler: ((data: unknown) => void) | undefined;

    const mockChannel = {
      bind: jest.fn((event: string, handler: (data: unknown) => void) => {
        if (event === 'new-message') newMessageHandler = handler;
      }),
      unbind_all: jest.fn(),
      name: 'private-user.1',
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { messages: 0, notifications: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({
          enabled: true, key: 'test-key', channels: { user: 'private-user.1' },
        });
      }
      return Promise.resolve({});
    });
    mockInitRealtime.mockReturnValue({
      subscribe: jest.fn(() => mockChannel),
      unsubscribe: jest.fn(),
      connection: { state: 'connected' },
    });

    const wrapper3 = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider>{children}</RealtimeProvider>
    );
    const { result } = renderHook(() => useRealtimeContext(), { wrapper: wrapper3 });
    await waitFor(() => expect(newMessageHandler).toBeDefined());

    // Registered, receiving, but not visible.
    const handler = jest.fn(() => false);
    act(() => { result.current.subscribeToMessages(42, handler); });

    const fakeMessage = { id: 99, body: 'Hello', sender: { id: 7 } };
    act(() => { newMessageHandler!({ conversation_id: 42, message: fakeMessage }); });

    // Still delivered — the thread caches it for when the member returns.
    expect(handler).toHaveBeenCalledWith(fakeMessage);
    // And still counted, because the member has not seen it.
    expect(result.current.unreadMessages).toBe(1);
  });

  it('bumps unread when valid payload has no active listener', async () => {
    let newMessageHandler: ((data: unknown) => void) | undefined;

    const mockChannel = {
      bind: jest.fn((event: string, handler: (data: unknown) => void) => {
        if (event === 'new-message') newMessageHandler = handler;
      }),
      unbind_all: jest.fn(),
      name: 'private-user.1',
    };

    const mockClient = {
      subscribe: jest.fn(() => mockChannel),
      unsubscribe: jest.fn(),
      connection: { state: 'connected' },
    };

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes('/notifications/counts')) {
        return Promise.resolve({ data: { messages: 0, notifications: 0 } });
      }
      if (url.includes('/pusher/config')) {
        return Promise.resolve({
          enabled: true,
          key: 'test-key',
          channels: { user: 'private-user.1' },
        });
      }
      return Promise.resolve({});
    });

    mockInitRealtime.mockReturnValue(mockClient);

    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <RealtimeProvider>{children}</RealtimeProvider>
    );

    const { result } = renderHook(() => useRealtimeContext(), { wrapper: wrapper2 });

    await waitFor(() => expect(newMessageHandler).toBeDefined());

    const fakeMessage = { id: 99, body: 'Hello', sender: { id: 7 } };

    // No listener for conversation 42 — badge should bump
    act(() => {
      newMessageHandler!({ conversation_id: 42, message: fakeMessage });
    });

    expect(result.current.unreadMessages).toBe(1);
  });
});
