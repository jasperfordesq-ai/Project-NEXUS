// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NotificationsContext
 *
 * The first block scans the source text — it dates from when the context
 * imported pusher-js statically and loading it OOM-ed the worker. pusher-js is
 * now a dynamic import inside PusherContext, and the second block renders the
 * provider against a fake Pusher context to drive the realtime handlers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import * as fs from 'fs';
import * as path from 'path';
import type { MessageReadEvent, NewMessageEvent } from './PusherContext';

type Listener<T> = (event: T) => void;

const fakePusher = vi.hoisted(() => {
  const userMessageListeners = new Set<Listener<unknown>>();
  const readListeners = new Set<Listener<unknown>>();
  const register = (set: Set<Listener<unknown>>) => (cb: Listener<unknown>) => {
    set.add(cb);
    return () => { set.delete(cb); };
  };
  return {
    context: {
      isConnected: true,
      isNotificationChannelReady: true,
      onNotification: register(new Set<Listener<unknown>>()),
      onUserMessage: register(userMessageListeners),
      onTransaction: register(new Set<Listener<unknown>>()),
      onMessageRead: register(readListeners),
    },
    emitUserMessage: (event: unknown) => userMessageListeners.forEach((cb) => cb(event)),
    emitMessageRead: (event: unknown) => readListeners.forEach((cb) => cb(event)),
  };
});

const toastSpy = vi.hoisted(() => ({ info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, tenant_id: 2 }, isAuthenticated: true }),
}));

vi.mock('./TenantContext', () => ({
  useTenant: () => ({ hasModule: () => true }),
}));

vi.mock('./PusherContext', () => ({
  usePusherOptional: () => fakePusher.context,
}));

vi.mock('./ToastContext', () => ({
  useToast: () => toastSpy,
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn((url: string) => {
      if (url === '/v2/notifications/counts') {
        return Promise.resolve({ success: true, data: { total: 0, listings: 0, transactions: 0, connections: 0, events: 0, groups: 0, achievements: 0, system: 0 } });
      }
      if (url === '/v2/messages/unread-count') {
        return Promise.resolve({ success: true, data: { count: 4 } });
      }
      return Promise.resolve({ success: false });
    }),
    post: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('i18next', () => ({
  default: { t: (key: string) => key },
}));

import { NotificationsProvider, useNotifications } from './NotificationsContext';

function CountsConsumer() {
  const { counts, unreadCount } = useNotifications();
  return (
    <div>
      <span data-testid="messages">{counts.messages}</span>
      <span data-testid="unread">{unreadCount}</span>
    </div>
  );
}

async function renderCounts() {
  render(
    <NotificationsProvider>
      <CountsConsumer />
    </NotificationsProvider>
  );
  // Initial refreshCounts lands the server's unread message count.
  await waitFor(() => expect(screen.getByTestId('messages')).toHaveTextContent('4'));
}

describe('NotificationsContext realtime', () => {
  beforeEach(() => {
    toastSpy.info.mockClear();
  });

  it('toasts the message body when the event carries the full message object', async () => {
    await renderCounts();

    const event: NewMessageEvent = {
      id: 9,
      sender_id: 20,
      receiver_id: 1,
      body: '',
      created_at: '2026-10-17T10:05:00Z',
      timestamp: 1760695500,
      conversation_id: 4242,
      message: {
        id: 9,
        body: 'Here is the photo',
        sender_id: 20,
        receiver_id: 1,
        sender: { id: 20, name: 'Bob' },
        created_at: '2026-10-17T10:05:00Z',
        is_own: false,
        is_read: false,
        is_edited: false,
        is_deleted: false,
        is_voice: false,
        audio_url: null,
        audio_duration: null,
        reactions: {},
        attachments: [],
        listing_id: null,
        context_type: null,
        context_id: null,
      },
    };

    act(() => {
      fakePusher.emitUserMessage(event);
    });

    expect(toastSpy.info).toHaveBeenCalledWith('realtime.new_message', 'Here is the photo');
    expect(screen.getByTestId('messages')).toHaveTextContent('5');
  });

  it('sets the messages badge from message.read when this user is the reader', async () => {
    await renderCounts();

    const readEvent: MessageReadEvent = {
      reader_id: 1,
      sender_id: 20,
      conversation_id: 4242,
      up_to_message_id: 9,
      read_count: 3,
      read_at: '2026-10-17T10:06:00Z',
      reader_unread_messages: 1,
      timestamp: 1760695560,
    };

    act(() => {
      fakePusher.emitMessageRead(readEvent);
    });

    expect(screen.getByTestId('messages')).toHaveTextContent('1');
  });

  it('leaves the messages badge alone when someone else is the reader', async () => {
    await renderCounts();

    act(() => {
      fakePusher.emitMessageRead({
        reader_id: 20,
        sender_id: 1,
        conversation_id: 4242,
        up_to_message_id: 9,
        read_count: 3,
        read_at: '2026-10-17T10:06:00Z',
        reader_unread_messages: 0,
        timestamp: 1760695560,
      } satisfies MessageReadEvent);
    });

    expect(screen.getByTestId('messages')).toHaveTextContent('4');
  });
});

describe('NotificationsContext', () => {
  const filePath = path.resolve(__dirname, './NotificationsContext.tsx');

  it('source file exists', () => {
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('exports NotificationsProvider', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('export function NotificationsProvider');
  });

  it('exports useNotifications hook', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('export function useNotifications');
  });

  it('creates NotificationsContext with createContext', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('createContext');
  });

  it('has notification count tracking', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('unreadCount');
    expect(content).toContain('counts');
  });

  it('has mark-as-read functionality', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('markAsRead');
    expect(content).toContain('markAllAsRead');
  });

  it('consumes the canonical Pusher context without constructing a client', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('usePusherOptional');
    expect(content).not.toContain("import('pusher-js')");
    expect(content).not.toContain('new PusherClient');
  });

  it('uses auth context for user state', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('useAuth');
    expect(content).toContain('isAuthenticated');
  });

  it('fetches notification counts from API', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('/notifications/counts');
  });

  it('throws error when used outside provider', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('useNotifications must be used within');
  });
});
