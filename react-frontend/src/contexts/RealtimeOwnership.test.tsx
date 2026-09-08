// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

type EventHandler = (data?: unknown) => void;

const realtimeMock = vi.hoisted(() => {
  const channels = new Map<string, {
    name: string;
    handlers: Map<string, Set<EventHandler>>;
    bind: ReturnType<typeof vi.fn>;
    unbind: ReturnType<typeof vi.fn>;
    unbind_all: ReturnType<typeof vi.fn>;
    emit: (event: string, data?: unknown) => void;
  }>();
  const connectionHandlers = new Map<string, Set<EventHandler>>();
  const clients: Array<{
    subscribe: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    connection: {
      state: string;
      bind: ReturnType<typeof vi.fn>;
    };
  }> = [];

  const createChannel = (name: string) => {
    const handlers = new Map<string, Set<EventHandler>>();
    const channel = {
      name,
      handlers,
      bind: vi.fn((event: string, handler: EventHandler) => {
        const listeners = handlers.get(event) ?? new Set<EventHandler>();
        listeners.add(handler);
        handlers.set(event, listeners);
      }),
      unbind: vi.fn((event: string, handler: EventHandler) => {
        handlers.get(event)?.delete(handler);
      }),
      unbind_all: vi.fn(() => handlers.clear()),
      emit: (event: string, data?: unknown) => {
        handlers.get(event)?.forEach((handler) => handler(data));
      },
    };
    channels.set(name, channel);
    return channel;
  };

  const createClient = () => {
    const connection = {
      state: 'connecting',
      bind: vi.fn((event: string, handler: EventHandler) => {
        const listeners = connectionHandlers.get(event) ?? new Set<EventHandler>();
        listeners.add(handler);
        connectionHandlers.set(event, listeners);
      }),
    };
    const client = {
      subscribe: vi.fn((name: string) => channels.get(name) ?? createChannel(name)),
      unsubscribe: vi.fn((name: string) => channels.delete(name)),
      disconnect: vi.fn(() => {
        connection.state = 'disconnected';
      }),
      connect: vi.fn(() => {
        connection.state = 'connecting';
      }),
      connection,
    };
    clients.push(client);
    return client;
  };
  const MockPusher = vi.fn().mockImplementation(createClient);

  const emitConnection = (event: string, data?: unknown) => {
    connectionHandlers.get(event)?.forEach((handler) => handler(data));
  };

  return { channels, connectionHandlers, clients, MockPusher, createClient, emitConnection };
});

vi.mock('pusher-js', () => ({ default: realtimeMock.MockPusher }));

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  tenantId: '2',
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => apiMock.get(...args),
    post: (...args: unknown[]) => apiMock.post(...args),
  },
  tokenManager: {
    getAccessToken: () => 'access-token',
    getTenantId: () => apiMock.tenantId,
    getCsrfToken: () => 'csrf-token',
  },
}));

const loggerMock = vi.hoisted(() => ({ logError: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: loggerMock.logError }));

const authMock = vi.hoisted(() => ({
  current: {
    isAuthenticated: true,
    user: { id: 42, tenant_id: 2 },
  } as {
    isAuthenticated: boolean;
    user: { id: number; tenant_id: number } | null;
  },
}));

vi.mock('./AuthContext', () => ({ useAuth: () => authMock.current }));

/*
 * NotificationsContext began calling `useTenant()` when module gating landed, so this
 * suite — which renders the real provider tree without a TenantProvider — started failing
 * with "useTenant must be used within a TenantProvider". Everything is on: this test is
 * about realtime client ownership, not about which modules a community has switched off.
 */
vi.mock('./TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    isLoading: false,
  }),
  useFeature: vi.fn((_key: string) => true),
  useModule: vi.fn((_key: string) => true),
}));

const toastMock = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
}));

vi.mock('./ToastContext', () => ({
  useToast: () => ({
    info: toastMock.info,
    success: toastMock.success,
    error: vi.fn(),
    warning: vi.fn(),
    addToast: vi.fn(),
    removeToast: vi.fn(),
    toasts: [],
  }),
}));

vi.mock('@/contexts/PresenceContext', () => ({
  PresenceProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/contexts/MenuContext', () => ({
  MenuProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/contexts/PodcastPlayerContext', () => ({
  PodcastPlayerProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/security/IdleLogoutGuard', () => ({
  IdleLogoutGuard: () => null,
}));

import TenantAppProviders from '@/components/routing/TenantAppProviders';
import { useNotifications } from './NotificationsContext';

function Probe() {
  const notifications = useNotifications();
  return (
    <div>
      <output data-testid="unread">{notifications.unreadCount}</output>
      <output data-testid="connected">{String(notifications.isConnected)}</output>
    </div>
  );
}

function RealtimeTree({ children }: { children?: ReactNode }) {
  return (
    <TenantAppProviders>
      <Probe />
      {children}
    </TenantAppProviders>
  );
}

describe('authenticated realtime ownership', () => {
  let activeIntervals: Map<number, () => void>;
  let nextIntervalId: number;

  beforeEach(() => {
    vi.clearAllMocks();
    realtimeMock.channels.clear();
    realtimeMock.connectionHandlers.clear();
    realtimeMock.clients.length = 0;
    realtimeMock.MockPusher.mockImplementation(realtimeMock.createClient);
    authMock.current = {
      isAuthenticated: true,
      user: { id: 42, tenant_id: 2 },
    };
    apiMock.tenantId = '2';
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/v2/realtime/config') {
        return Promise.resolve({
          success: true,
          data: {
            key: 'shared-key',
            cluster: 'eu',
            authEndpoint: '/pusher/auth',
            enabled: true,
          },
        });
      }
      if (url === '/v2/notifications/counts') {
        return Promise.resolve({
          success: true,
          data: {
            total: 5,
            messages: 0,
            listings: 1,
            transactions: 1,
            connections: 0,
            events: 0,
            groups: 0,
            achievements: 1,
            system: 0,
          },
        });
      }
      if (url === '/v2/messages/unread-count') {
        return Promise.resolve({ success: true, data: { count: 3 } });
      }
      return Promise.resolve({ success: false });
    });
    apiMock.post.mockResolvedValue({ success: true });

    activeIntervals = new Map();
    nextIntervalId = -1;
    const nativeSetInterval = globalThis.setInterval.bind(globalThis);
    const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (timeout !== 60_000) {
        return nativeSetInterval(handler, timeout, ...args);
      }
      const id = nextIntervalId--;
      activeIntervals.set(id, handler as () => void);
      return id;
    }) as typeof setInterval);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: number) => {
      if (typeof id === 'number' && activeIntervals.has(id)) {
        activeIntervals.delete(id);
        return;
      }
      nativeClearInterval(id);
    }) as typeof clearInterval);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('uses one client, shares notification bindings, and switches polling with health', async () => {
    render(<RealtimeTree />);

    await act(async () => {
      await vi.dynamicImportSettled();
    });

    await waitFor(() => {
      expect(loggerMock.logError).not.toHaveBeenCalled();
      expect(realtimeMock.MockPusher).toHaveBeenCalledOnce();
    });
    await waitFor(() => expect(screen.getByTestId('unread')).toHaveTextContent('5'));

    const userChannelName = 'private-tenant.2.user.42';
    const userChannel = realtimeMock.channels.get(userChannelName);
    expect(userChannel).toBeDefined();
    expect(realtimeMock.MockPusher).toHaveBeenCalledTimes(1);
    expect(activeIntervals.size).toBe(1);

    act(() => {
      realtimeMock.emitConnection('connected');
      userChannel?.emit('pusher:subscription_succeeded');
    });

    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('true');
      expect(activeIntervals.size).toBe(0);
    });

    const notification = {
      id: 900,
      type: 'achievement',
      title: 'Achievement',
      body: 'Completed',
      created_at: '2026-07-10T12:00:00Z',
    };
    act(() => {
      userChannel?.emit('notification', notification);
      userChannel?.emit('new-notification', notification);
    });

    expect(screen.getByTestId('unread')).toHaveTextContent('6');
    expect(toastMock.info).toHaveBeenCalledOnce();
    expect(realtimeMock.MockPusher).toHaveBeenCalledTimes(1);

    act(() => realtimeMock.emitConnection('disconnected'));
    await waitFor(() => {
      expect(screen.getByTestId('connected')).toHaveTextContent('false');
      expect(activeIntervals.size).toBe(1);
    });

    const countRequestsBeforePoll = apiMock.get.mock.calls.filter(
      ([url]) => url === '/v2/notifications/counts'
    ).length;
    await act(async () => {
      activeIntervals.values().next().value?.();
      await Promise.resolve();
    });
    expect(
      apiMock.get.mock.calls.filter(([url]) => url === '/v2/notifications/counts').length
    ).toBe(countRequestsBeforePoll + 1);

    act(() => {
      realtimeMock.emitConnection('connected');
      userChannel?.emit('pusher:subscription_succeeded');
    });
    await waitFor(() => expect(activeIntervals.size).toBe(0));
  });

  it('tears down safely on logout and creates one replacement client on re-auth', async () => {
    const rendered = render(<RealtimeTree />);

    await act(async () => {
      await vi.dynamicImportSettled();
    });

    await waitFor(() => {
      expect(loggerMock.logError).not.toHaveBeenCalled();
      expect(realtimeMock.MockPusher).toHaveBeenCalledOnce();
    });
    const firstClient = realtimeMock.clients[0];
    const firstUserChannel = realtimeMock.channels.get('private-tenant.2.user.42');

    authMock.current = { isAuthenticated: false, user: null };
    rendered.rerender(<RealtimeTree />);

    await waitFor(() => {
      expect(firstClient?.disconnect).toHaveBeenCalledOnce();
      expect(firstUserChannel?.unbind_all).toHaveBeenCalledOnce();
      expect(screen.getByTestId('unread')).toHaveTextContent('0');
      expect(activeIntervals.size).toBe(0);
    });

    authMock.current = {
      isAuthenticated: true,
      user: { id: 77, tenant_id: 7 },
    };
    apiMock.tenantId = '7';
    rendered.rerender(<RealtimeTree />);

    await act(async () => {
      await vi.dynamicImportSettled();
    });

    await waitFor(() => expect(realtimeMock.MockPusher).toHaveBeenCalledTimes(2));
    expect(realtimeMock.clients).toHaveLength(2);
    expect(realtimeMock.channels.has('private-tenant.7.user.77')).toBe(true);
    expect(firstClient?.disconnect).toHaveBeenCalledOnce();

    act(() => {
      firstUserChannel?.emit('notification', {
        id: 901,
        type: 'system',
        title: 'Old tenant',
        body: 'Should not deliver',
        created_at: '2026-07-10T12:00:00Z',
      });
    });
    expect(toastMock.info).not.toHaveBeenCalled();
  });
});
