// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessagesPage — realtime read receipts.
 *
 * When this user reads a thread on another device, the server sends
 * `message.read` with `reader_id === user.id`; the inbox clears that
 * conversation's unread badge locally instead of waiting for a reload.
 */

import { render, screen, waitFor } from '@/test/test-utils';
import { act } from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { MessageReadEvent } from '@/contexts/PusherContext';

type Listener<T> = (event: T) => void;

const fakePusher = vi.hoisted(() => {
  const readListeners = new Set<Listener<unknown>>();
  const register = (set: Set<Listener<unknown>>) => (cb: Listener<unknown>) => {
    set.add(cb);
    return () => { set.delete(cb); };
  };
  return {
    context: {
      isConnected: true,
      isNotificationChannelReady: true,
      onNewMessage: register(new Set<Listener<unknown>>()),
      onUnreadCount: register(new Set<Listener<unknown>>()),
      onMessageRead: register(readListeners),
    },
    emitMessageRead: (event: unknown) => readListeners.forEach((cb) => cb(event)),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
  useTenant: () => ({
    tenantPath: (p: string) => `/t/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
    tenantSlug: 'test',
  }),
}));

vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => fakePusher.context,
}));

vi.mock('@/contexts/PresenceContext', () => ({
  usePresenceOptional: () => null,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/social/PresenceIndicator', () => ({
  PresenceIndicator: () => null,
}));

vi.mock('./components/CreateGroupModal', () => ({
  CreateGroupModal: () => null,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn(), language: 'en' },
  }),
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_: object, prop: string) => {
      const { createElement, forwardRef } = require('react');
      return forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) =>
        createElement(prop as string, { ...props, ref }, children)
      );
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/t/test/messages' }),
  };
});

import { api } from '@/lib/api';
import { MessagesPage } from './MessagesPage';

const mockApi = api as unknown as { get: ReturnType<typeof vi.fn> };

const conversations = [
  {
    id: 20,
    other_user: { id: 20, name: 'Bob', avatar_url: null },
    unread_count: 2,
    last_message: { id: 9, body: 'Here is the photo', sender_id: 20, created_at: '2026-10-17T10:05:00Z' },
  },
  {
    id: 30,
    other_user: { id: 30, name: 'Carol', avatar_url: null },
    unread_count: 1,
    last_message: { id: 8, body: 'See you then', sender_id: 30, created_at: '2026-10-17T09:05:00Z' },
  },
];

function conversationLink(name: string): HTMLElement {
  const link = screen.getAllByRole('link').find((el) => el.textContent?.includes(name));
  if (!link) throw new Error(`no conversation link for ${name}`);
  return link;
}

async function renderInbox() {
  mockApi.get.mockImplementation((url: string) => {
    if (url === '/v2/messages') return Promise.resolve({ success: true, data: conversations });
    if (url.startsWith('/v2/messages/restriction-status')) {
      return Promise.resolve({ success: true, data: { messaging_disabled: false } });
    }
    return Promise.resolve({ success: false });
  });

  render(<MessagesPage />);
  await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
}

describe('MessagesPage realtime read receipts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears a conversation\'s unread badge when this user reads it elsewhere', async () => {
    await renderInbox();
    expect(conversationLink('Bob')).toHaveAttribute('aria-label', 'aria_conversation_unread');
    const listLoads = mockApi.get.mock.calls.filter(([url]) => url === '/v2/messages').length;

    const readEvent: MessageReadEvent = {
      reader_id: 1,
      sender_id: 20,
      conversation_id: 4242,
      up_to_message_id: 9,
      read_count: 2,
      read_at: '2026-10-17T10:06:00Z',
      reader_unread_messages: 1,
      timestamp: 1760695560,
    };

    act(() => {
      fakePusher.emitMessageRead(readEvent);
    });

    expect(conversationLink('Bob')).toHaveAttribute('aria-label', 'aria_conversation');
    // The other thread keeps its badge, and no reload was needed.
    expect(conversationLink('Carol')).toHaveAttribute('aria-label', 'aria_conversation_unread');
    expect(mockApi.get.mock.calls.filter(([url]) => url === '/v2/messages').length).toBe(listLoads);
  });

  it('ignores a message.read where someone else is the reader', async () => {
    await renderInbox();

    act(() => {
      fakePusher.emitMessageRead({
        reader_id: 20,
        sender_id: 1,
        conversation_id: 4242,
        up_to_message_id: 9,
        read_count: 1,
        read_at: '2026-10-17T10:06:00Z',
        reader_unread_messages: 0,
        timestamp: 1760695560,
      } satisfies MessageReadEvent);
    });

    expect(conversationLink('Bob')).toHaveAttribute('aria-label', 'aria_conversation_unread');
  });
});
