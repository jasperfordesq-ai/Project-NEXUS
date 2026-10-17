// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ConversationPage — realtime behaviour against the Pusher contract.
 *
 * ConversationPage.test.tsx mocks PusherContext to null at module level, so
 * these cases live in a sibling file with a controllable fake context: the
 * tests replay the server's `new-message`, `typing` and `message.read` events
 * and assert on what the thread does with them.
 */

import { render, screen, waitFor } from '@/test/test-utils';
import { act, type FormEventHandler } from 'react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { MessageReadEvent, NewMessageEvent, TypingEvent } from '@/contexts/PusherContext';

const stableMocks = vi.hoisted(() => ({
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  navigate: vi.fn(),
  refreshCounts: vi.fn(() => Promise.resolve()),
  setSearchParams: vi.fn(),
  tenantPath: vi.fn((p: string) => `/t/test${p}`),
  t: vi.fn((key: string) => key),
}));

type Listener<T> = (event: T) => void;

const fakePusher = vi.hoisted(() => {
  const messageListeners = new Set<Listener<unknown>>();
  const typingListeners = new Set<Listener<unknown>>();
  const readListeners = new Set<Listener<unknown>>();
  const register = (set: Set<Listener<unknown>>) => (cb: Listener<unknown>) => {
    set.add(cb);
    return () => { set.delete(cb); };
  };
  return {
    context: {
      isConnected: true,
      isNotificationChannelReady: true,
      client: null,
      tenantId: 2,
      subscribeToConversation: vi.fn(),
      unsubscribeFromConversation: vi.fn(),
      onNewMessage: register(messageListeners),
      onUserMessage: register(new Set<Listener<unknown>>()),
      onNotification: register(new Set<Listener<unknown>>()),
      onTransaction: register(new Set<Listener<unknown>>()),
      onTyping: register(typingListeners),
      onMessageRead: register(readListeners),
      onUnreadCount: register(new Set<Listener<unknown>>()),
      onFeedPost: register(new Set<Listener<unknown>>()),
      sendTyping: vi.fn(),
    },
    emitNewMessage: (event: unknown) => messageListeners.forEach((cb) => cb(event)),
    emitTyping: (event: unknown) => typingListeners.forEach((cb) => cb(event)),
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

vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string) => url,
  formatDate: (value: string) => new Date(value).toDateString(),
}));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Alice' }, isAuthenticated: true }),
  useToast: () => ({ showToast: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() }),
  useTenant: () => ({
    tenantPath: stableMocks.tenantPath,
    hasFeature: stableMocks.hasFeature,
    hasModule: stableMocks.hasModule,
    tenantSlug: 'test',
  }),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn(), refreshCounts: stableMocks.refreshCounts }),
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

// The page reads usePusherOptional from its DIRECT path; this is the fake.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: () => fakePusher.context,
  usePusher: () => fakePusher.context,
}));

vi.mock('@/contexts/PresenceContext', () => ({
  usePresenceOptional: () => null,
  usePresence: () => ({ fetchPresence: vi.fn(), getPresence: vi.fn(() => null) }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: stableMocks.t,
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

vi.mock('@/components/feedback', () => ({
  LoadingScreen: () => <div data-testid="loading-screen">Loading...</div>,
}));

vi.mock('@/components/messages/MessageContextCard', () => ({
  MessageContextCard: () => <div data-testid="context-card" />,
}));

vi.mock('@/components/verification/VerificationBadge', () => ({
  VerificationBadgeRow: () => <div data-testid="verification-badge-row" />,
  useVerificationBadges: () => ({ badges: [], isLoaded: true }),
}));

// Expose exactly what the realtime handlers change on a message so each case
// can assert on it: body, own-ness, read state and attachment count.
vi.mock('./components/MessageBubble', () => ({
  MessageBubble: ({ message, isOwn }: {
    message: { id: number; body: string; is_read?: boolean; read_at?: string | null; attachments?: unknown[] };
    isOwn: boolean;
  }) => (
    <div
      data-testid="message-bubble"
      data-id={message.id}
      data-own={String(isOwn)}
      data-read={String(Boolean(message.is_read || message.read_at))}
      data-attachments={message.attachments?.length ?? 0}
    >
      {message.body}
    </div>
  ),
}));

vi.mock('./components/MessageInputArea', () => ({
  MessageInputArea: ({ onSendMessage }: { onSendMessage: FormEventHandler<HTMLFormElement> }) => (
    <form data-testid="message-input-area" onSubmit={onSendMessage} />
  ),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '20' }),
    useSearchParams: () => [new URLSearchParams(), stableMocks.setSearchParams],
    useNavigate: () => stableMocks.navigate,
  };
});

import { api } from '@/lib/api';
import { ConversationPage } from './ConversationPage';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const OTHER_USER_ID = 20;

// The API returns newest first; the page reverses into chronological order.
const mockMessages = [
  { id: 5, body: 'Did you get it?', sender_id: 1, is_own: true, created_at: '2026-10-17T10:02:00Z', is_read: false, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
  { id: 2, body: 'Hi Alice!', sender_id: OTHER_USER_ID, is_own: false, created_at: '2026-10-17T10:01:00Z', is_read: true, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
  { id: 1, body: 'Hello Bob!', sender_id: 1, is_own: true, created_at: '2026-10-17T10:00:00Z', is_read: false, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
];

const mockConversationResponse = {
  success: true,
  data: mockMessages,
  meta: {
    conversation: {
      id: OTHER_USER_ID,
      other_user: { id: OTHER_USER_ID, name: 'Bob', avatar_url: null },
      safeguarding: null,
    },
    cursor: null,
    has_more: false,
  },
};

function broadcastMessage(overrides: Partial<NewMessageEvent['message']> & { id: number; sender_id: number; receiver_id: number; body: string }) {
  return {
    sender: { id: overrides.sender_id, name: overrides.sender_id === 1 ? 'Alice' : 'Bob' },
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
    ...overrides,
  };
}

function newMessageEvent(message: ReturnType<typeof broadcastMessage>): NewMessageEvent {
  return {
    id: message.id,
    sender_id: message.sender_id,
    receiver_id: message.receiver_id,
    body: message.body,
    created_at: message.created_at,
    timestamp: 1760695500,
    conversation_id: 4242,
    message,
  };
}

function bubble(id: number): HTMLElement {
  const el = screen.getAllByTestId('message-bubble').find((node) => node.dataset.id === String(id));
  if (!el) throw new Error(`no bubble for message ${id}`);
  return el;
}

async function renderLoaded() {
  mockApi.get.mockImplementation((url: string) => {
    if (url.startsWith('/v2/messages/restriction-status')) {
      return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
    }
    return Promise.resolve(mockConversationResponse);
  });
  mockApi.put.mockResolvedValue({ success: true });

  render(<ConversationPage />);
  await waitFor(() => expect(screen.getByText('Hello Bob!')).toBeInTheDocument());
}

function readCallsTo(path: string): number {
  return mockApi.put.mock.calls.filter(([url]) => url === path).length;
}

describe('ConversationPage realtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('appends an incoming message from the other user and marks the thread read', async () => {
    await renderLoaded();
    const readsBefore = readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`);

    const incoming = broadcastMessage({
      id: 9,
      sender_id: OTHER_USER_ID,
      receiver_id: 1,
      body: 'Here is the photo',
      attachments: [{ id: 1, url: '/files/photo.jpg', type: 'image', name: 'photo.jpg', size: 1234 }],
    });

    act(() => {
      fakePusher.emitNewMessage(newMessageEvent(incoming));
    });

    const appended = bubble(9);
    expect(appended).toHaveTextContent('Here is the photo');
    expect(appended.dataset.own).toBe('false');
    // The full row came off the wire, so the attachment renders live.
    expect(appended.dataset.attachments).toBe('1');

    // The handler marks the thread read; the page's unread-messages effect may
    // issue a second call for the same row, so assert on "at least one".
    await waitFor(() => {
      expect(readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`)).toBeGreaterThanOrEqual(readsBefore + 1);
    });
  });

  it('ignores a new-message from a third user', async () => {
    await renderLoaded();
    const readsBefore = readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`);

    act(() => {
      fakePusher.emitNewMessage(newMessageEvent(broadcastMessage({
        id: 10,
        sender_id: 99,
        receiver_id: 1,
        body: 'Wrong thread',
      })));
    });

    expect(screen.queryByText('Wrong thread')).toBeNull();
    expect(readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`)).toBe(readsBefore);
  });

  it('appends an own message echoed from another device as is_own', async () => {
    await renderLoaded();
    const readsBefore = readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`);

    act(() => {
      fakePusher.emitNewMessage(newMessageEvent(broadcastMessage({
        id: 11,
        sender_id: 1,
        receiver_id: OTHER_USER_ID,
        body: 'Sent from my phone',
      })));
    });

    const echo = bubble(11);
    expect(echo).toHaveTextContent('Sent from my phone');
    expect(echo.dataset.own).toBe('true');
    // Our own message is not something we need to mark as read.
    expect(readCallsTo(`/v2/messages/${OTHER_USER_ID}/read`)).toBe(readsBefore);

    // A second copy of the same echo (chat channel after user channel) is not duplicated.
    act(() => {
      fakePusher.emitNewMessage(newMessageEvent(broadcastMessage({
        id: 11,
        sender_id: 1,
        receiver_id: OTHER_USER_ID,
        body: 'Sent from my phone',
      })));
    });
    expect(screen.getAllByText('Sent from my phone')).toHaveLength(1);
  });

  it('turns own ticks read on message.read up to up_to_message_id only', async () => {
    await renderLoaded();
    expect(bubble(1).dataset.read).toBe('false');
    expect(bubble(5).dataset.read).toBe('false');

    const readEvent: MessageReadEvent = {
      reader_id: OTHER_USER_ID,
      sender_id: 1,
      conversation_id: 4242,
      up_to_message_id: 1,
      read_count: 1,
      read_at: '2026-10-17T10:06:00Z',
      reader_unread_messages: 0,
      timestamp: 1760695560,
    };

    act(() => {
      fakePusher.emitMessageRead(readEvent);
    });

    expect(bubble(1).dataset.read).toBe('true');
    expect(bubble(5).dataset.read).toBe('false');
    // The other user's own message is untouched.
    expect(bubble(2).dataset.read).toBe('true');
  });

  it('shows the typing indicator and clears it after 5 s', async () => {
    await renderLoaded();
    vi.useFakeTimers();

    const typing: TypingEvent = { user_id: OTHER_USER_ID, is_typing: true, timestamp: 1760695500 };
    act(() => {
      fakePusher.emitTyping(typing);
    });
    expect(screen.getByText('typing_indicator')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(screen.getByText('typing_indicator')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('typing_indicator')).toBeNull();
  });
});
