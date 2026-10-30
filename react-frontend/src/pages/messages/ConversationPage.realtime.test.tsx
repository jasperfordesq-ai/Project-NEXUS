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
import type {
  MessageDeletedEvent,
  MessageReactionEvent,
  MessageReadEvent,
  MessageUpdatedEvent,
  NewMessageEvent,
  TypingEvent,
} from '@/contexts/PusherContext';

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
  const updatedListeners = new Set<Listener<unknown>>();
  const deletedListeners = new Set<Listener<unknown>>();
  const reactionListeners = new Set<Listener<unknown>>();
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
      onMessageUpdated: register(updatedListeners),
      onMessageDeleted: register(deletedListeners),
      onMessageReaction: register(reactionListeners),
      onUnreadCount: register(new Set<Listener<unknown>>()),
      onFeedPost: register(new Set<Listener<unknown>>()),
      sendTyping: vi.fn(),
    },
    emitNewMessage: (event: unknown) => messageListeners.forEach((cb) => cb(event)),
    emitTyping: (event: unknown) => typingListeners.forEach((cb) => cb(event)),
    emitMessageRead: (event: unknown) => readListeners.forEach((cb) => cb(event)),
    emitMessageUpdated: (event: unknown) => updatedListeners.forEach((cb) => cb(event)),
    emitMessageDeleted: (event: unknown) => deletedListeners.forEach((cb) => cb(event)),
    emitMessageReaction: (event: unknown) => reactionListeners.forEach((cb) => cb(event)),
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
// can assert on it: body, own-ness, read state, attachment count, edited and
// deleted flags, and the reaction counts.
vi.mock('./components/MessageBubble', () => ({
  MessageBubble: ({ message, isOwn, autoTranslatedText }: {
    message: {
      id: number; body: string; is_read?: boolean; read_at?: string | null; attachments?: unknown[];
      is_edited?: boolean; is_deleted?: boolean; reactions?: Record<string, number>;
    };
    isOwn: boolean;
    autoTranslatedText?: string | null;
  }) => (
    <div
      data-testid="message-bubble"
      data-auto-translation={autoTranslatedText ?? ''}
      data-id={message.id}
      data-own={String(isOwn)}
      data-read={String(Boolean(message.is_read || message.read_at))}
      data-attachments={message.attachments?.length ?? 0}
      data-edited={String(Boolean(message.is_edited))}
      data-deleted={String(Boolean(message.is_deleted))}
      data-reactions={JSON.stringify(message.reactions ?? {})}
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

const INITIAL_SYNCED_AT = '2026-10-17T10:03:00.000000Z';

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
    synced_at: INITIAL_SYNCED_AT,
  },
};

function updatedEvent(id: number, body: string, overrides: Partial<MessageUpdatedEvent> = {}): MessageUpdatedEvent {
  return {
    id,
    body,
    is_edited: true,
    edited_at: '2026-10-17T10:07:00Z',
    sender_id: OTHER_USER_ID,
    receiver_id: 1,
    conversation_id: 4242,
    timestamp: 1760695620,
    ...overrides,
  };
}

function deletedEvent(id: number, scope: 'everyone' | 'self', actorId: number): MessageDeletedEvent {
  return {
    id,
    scope,
    actor_id: actorId,
    sender_id: actorId === 1 ? 1 : OTHER_USER_ID,
    receiver_id: actorId === 1 ? OTHER_USER_ID : 1,
    conversation_id: 4242,
    deleted_at: '2026-10-17T10:08:00Z',
    timestamp: 1760695680,
  };
}

function reactionEvent(messageId: number, counts: Record<string, number>): MessageReactionEvent {
  return {
    message_id: messageId,
    emoji: '👍',
    action: 'added',
    actor_id: OTHER_USER_ID,
    counts,
    sender_id: 1,
    receiver_id: OTHER_USER_ID,
    conversation_id: 4242,
    timestamp: 1760695740,
  };
}

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

  it('replaces the body and marks the row edited on message.updated', async () => {
    await renderLoaded();
    expect(bubble(2).dataset.edited).toBe('false');

    act(() => {
      fakePusher.emitMessageUpdated(updatedEvent(2, 'Hi Alice! (fixed the typo)'));
    });

    expect(bubble(2)).toHaveTextContent('Hi Alice! (fixed the typo)');
    expect(bubble(2).dataset.edited).toBe('true');
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(3);
  });

  it('ignores a message.updated for a conversation with someone else', async () => {
    await renderLoaded();

    act(() => {
      fakePusher.emitMessageUpdated(updatedEvent(2, 'Not for this thread', { sender_id: 99, receiver_id: 1 }));
    });

    expect(bubble(2)).toHaveTextContent('Hi Alice!');
    expect(bubble(2).dataset.edited).toBe('false');
  });

  it('shows the tombstone on message.deleted for everyone', async () => {
    await renderLoaded();

    act(() => {
      fakePusher.emitMessageDeleted(deletedEvent(2, 'everyone', OTHER_USER_ID));
    });

    expect(bubble(2).dataset.deleted).toBe('true');
    expect(bubble(2)).toHaveTextContent('message_deleted_placeholder');
    expect(bubble(2).dataset.reactions).toBe('{}');
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(3);
  });

  it('removes the row on my own "delete for me" from another device, never on someone else\'s', async () => {
    await renderLoaded();

    // The other member's self-delete should never reach us; if it did, nothing changes.
    act(() => {
      fakePusher.emitMessageDeleted(deletedEvent(2, 'self', OTHER_USER_ID));
    });
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(3);
    expect(bubble(2).dataset.deleted).toBe('false');

    act(() => {
      fakePusher.emitMessageDeleted(deletedEvent(1, 'self', 1));
    });
    expect(screen.getAllByTestId('message-bubble')).toHaveLength(2);
    expect(screen.queryByText('Hello Bob!')).toBeNull();
  });

  it('sets the reaction counts from message.reaction instead of counting', async () => {
    await renderLoaded();
    expect(bubble(1).dataset.reactions).toBe('{}');

    act(() => {
      fakePusher.emitMessageReaction(reactionEvent(1, { '👍': 2, '❤️': 1 }));
    });
    expect(JSON.parse(bubble(1).dataset.reactions ?? '{}')).toEqual({ '👍': 2, '❤️': 1 });

    // A later event with fewer counts wins outright: no local arithmetic.
    act(() => {
      fakePusher.emitMessageReaction({ ...reactionEvent(1, { '❤️': 1 }), action: 'removed' });
    });
    expect(JSON.parse(bubble(1).dataset.reactions ?? '{}')).toEqual({ '❤️': 1 });
  });

  it('translates an edited message again when auto-translate is on', async () => {
    window.localStorage.setItem('nexus_auto_translate_test', JSON.stringify({ [String(OTHER_USER_ID)]: 'fr' }));
    mockApi.post.mockImplementation((url: string) => {
      if (url.endsWith('/translate')) {
        return Promise.resolve({ success: true, data: { translated_text: 'Salut Alice !' } });
      }
      return Promise.resolve({ success: true });
    });
    try {
      await renderLoaded();
      const translateCalls = () => mockApi.post.mock.calls.filter(([url]) => url === '/v2/messages/2/translate').length;
      await waitFor(() => expect(translateCalls()).toBe(1));

      act(() => {
        fakePusher.emitMessageUpdated(updatedEvent(2, 'Hi Alice! (edited)'));
      });

      // The cached translation is for the old text; the edited body is fetched afresh.
      await waitFor(() => expect(translateCalls()).toBe(2));
    } finally {
      window.localStorage.removeItem('nexus_auto_translate_test');
    }
  });

  // AWID re-audit (30 Oct 2026): an edit arriving while that message's
  // translation is still in flight. The late reply is for the OLD text and must
  // never be shown for the edited one; the edit is then translated afresh.
  it('never shows a translation of the old text when the edit lands mid-translation', async () => {
    window.localStorage.setItem('nexus_auto_translate_test', JSON.stringify({ [String(OTHER_USER_ID)]: 'fr' }));
    let resolveOld!: (value: unknown) => void;
    mockApi.post
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockImplementation((url: string) => (url.endsWith('/translate')
        ? Promise.resolve({ success: true, data: { translated_text: 'Salut Alice ! (modifié)' } })
        : Promise.resolve({ success: true })));
    try {
      await renderLoaded();
      const translateCalls = () => mockApi.post.mock.calls.filter(([url]) => url === '/v2/messages/2/translate').length;
      await waitFor(() => expect(translateCalls()).toBe(1));

      act(() => {
        fakePusher.emitMessageUpdated(updatedEvent(2, 'Hi Alice! (edited)'));
      });
      await act(async () => { resolveOld({ success: true, data: { translated_text: 'Salut Alice !' } }); });

      expect(bubble(2).dataset.autoTranslation).not.toBe('Salut Alice !');
      await waitFor(() => expect(translateCalls()).toBe(2));
      await waitFor(() => expect(bubble(2).dataset.autoTranslation).toBe('Salut Alice ! (modifié)'));
    } finally {
      window.localStorage.removeItem('nexus_auto_translate_test');
    }
  });

  it('polls with updated_since and replaces edited or deleted rows in place', async () => {
    // Only the poll interval is faked: load-time waits and the 100 ms scroll
    // timeout keep real timers so renderLoaded's waitFor still resolves.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await renderLoaded();
    const pollUrls: string[] = [];
    mockApi.get.mockImplementation((url: string) => {
      if (url.startsWith('/v2/messages/restriction-status')) {
        return Promise.resolve({ success: true, data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null } });
      }
      if (url.includes('direction=newer')) {
        pollUrls.push(url);
        return Promise.resolve({
          success: true,
          data: [
            { ...mockMessages[1], body: 'Hi Alice! (edited while you were away)', is_edited: true },
            { ...mockMessages[2], body: '[Message deleted]', is_deleted: true },
            { id: 9, body: 'And a new one', sender_id: OTHER_USER_ID, is_own: false, created_at: '2026-10-17T10:09:00Z', is_read: false, is_deleted: false, is_edited: false, is_voice: false, attachments: [], reactions: {} },
          ],
          meta: { conversation: mockConversationResponse.meta.conversation, cursor: null, has_more: false, synced_at: '2026-10-17T10:09:30.000000Z' },
        });
      }
      return Promise.resolve(mockConversationResponse);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(pollUrls).toHaveLength(1);
    expect(pollUrls[0]).toContain(`cursor=${btoa('5')}`);
    expect(pollUrls[0]).toContain(`updated_since=${encodeURIComponent(INITIAL_SYNCED_AT)}`);

    // In place, in order: 1 (tombstoned), 2 (edited), 5 (untouched), 9 (new).
    const ids = screen.getAllByTestId('message-bubble').map((node) => node.dataset.id);
    expect(ids).toEqual(['1', '2', '5', '9']);
    expect(bubble(2)).toHaveTextContent('Hi Alice! (edited while you were away)');
    expect(bubble(2).dataset.edited).toBe('true');
    expect(bubble(1).dataset.deleted).toBe('true');
    expect(bubble(1).dataset.own).toBe('true');

    // Next poll carries the new cursor and the newer watermark.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(pollUrls).toHaveLength(2);
    expect(pollUrls[1]).toContain(`cursor=${btoa('9')}`);
    expect(pollUrls[1]).toContain(`updated_since=${encodeURIComponent('2026-10-17T10:09:30.000000Z')}`);
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
