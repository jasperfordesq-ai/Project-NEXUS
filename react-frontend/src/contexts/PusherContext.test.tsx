// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PusherContext
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import {
  PusherProvider,
  usePusher,
  usePusherOptional,
  type MessageDeletedEvent,
  type MessageReactionEvent,
  type MessageReadEvent,
  type MessageUpdatedEvent,
  type NewMessageEvent,
  type TypingEvent,
} from './PusherContext';

// Mock Pusher. Every subscribed channel records its `bind` handlers by event
// name so a test can replay a server event and watch what the context does.
type BoundHandler = (data: unknown) => void;
const channelBindings = new Map<string, Map<string, BoundHandler[]>>();

function emitOnChannel(channelName: string, eventName: string, data: unknown) {
  const handlers = channelBindings.get(channelName)?.get(eventName) ?? [];
  handlers.forEach((handler) => handler(data));
}

const mockSubscribe = vi.fn((channelName: string) => {
  const bindings = new Map<string, BoundHandler[]>();
  channelBindings.set(channelName, bindings);
  return {
    name: channelName,
    bind: vi.fn((eventName: string, handler: BoundHandler) => {
      const list = bindings.get(eventName) ?? [];
      list.push(handler);
      bindings.set(eventName, list);
    }),
    unbind_all: vi.fn(),
  };
});
const mockUnsubscribe = vi.fn();
const mockDisconnect = vi.fn();
const mockConnectionBind = vi.fn();

vi.mock('pusher-js', () => {
  // A plain `function` so the context's `new PusherClient(...)` works: a
  // vi.fn with an arrow-function implementation is not constructible.
  return {
    default: vi.fn(function MockPusher() {
      return {
        subscribe: mockSubscribe,
        unsubscribe: mockUnsubscribe,
        disconnect: mockDisconnect,
        connection: {
          bind: mockConnectionBind,
          state: 'connected',
        },
      };
    }),
  };
});

// Mock api
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  tokenManager: {
    getTenantId: vi.fn().mockReturnValue(2),
    getAccessToken: vi.fn().mockReturnValue('test-token'),
    getCsrfToken: vi.fn().mockReturnValue(''),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock AuthContext
let mockIsAuthenticated = false;
let mockUser: { id: number; tenant_id: number } | null = null;

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    isAuthenticated: mockIsAuthenticated,
    user: mockUser,
  }),
}));

function TestConsumer() {
  const { isConnected, onNewMessage, onTyping, onUnreadCount, sendTyping } = usePusher();

  return (
    <div>
      <div data-testid="connected">{String(isConnected)}</div>
      <button onClick={() => sendTyping(2, true)}>Send Typing</button>
      <button onClick={() => {
        const unsub = onNewMessage(() => {});
        // Store for later cleanup
        (window as unknown as Record<string, unknown>).__testUnsub = unsub;
      }}>Subscribe Messages</button>
      <button onClick={() => {
        const unsub = onTyping(() => {});
        (window as unknown as Record<string, unknown>).__testTypingUnsub = unsub;
      }}>Subscribe Typing</button>
      <button onClick={() => {
        const unsub = onUnreadCount(() => {});
        (window as unknown as Record<string, unknown>).__testUnreadUnsub = unsub;
      }}>Subscribe Unread</button>
    </div>
  );
}

describe('PusherContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAuthenticated = false;
    mockUser = null;

    // Default: Pusher config not available
    mockApiGet.mockResolvedValue({ success: false });
  });

  it('provides initial disconnected state', () => {
    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    expect(screen.getByTestId('connected')).toHaveTextContent('false');
  });

  it('sends typing indicator via API', async () => {
    mockApiPost.mockResolvedValue({ success: true });

    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    await act(async () => {
      screen.getByRole('button', { name: 'Send Typing' }).click();
    });

    expect(mockApiPost).toHaveBeenCalledWith('/v2/messages/typing', {
      recipient_id: 2,
      is_typing: true,
    });
  });

  it('registers and unregisters message listeners', () => {
    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'Subscribe Messages' }).click();
    });

    // Unsubscribe returns a function
    expect(typeof (window as unknown as Record<string, unknown>).__testUnsub).toBe('function');

    // Calling it should not throw
    expect(() => (window as unknown as Record<string, unknown>).__testUnsub()).not.toThrow();
  });

  it('registers typing listeners', () => {
    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'Subscribe Typing' }).click();
    });

    expect(typeof (window as unknown as Record<string, unknown>).__testTypingUnsub).toBe('function');
  });

  it('registers unread count listeners', () => {
    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    act(() => {
      screen.getByRole('button', { name: 'Subscribe Unread' }).click();
    });

    expect(typeof (window as unknown as Record<string, unknown>).__testUnreadUnsub).toBe('function');
  });

  it('throws error when usePusher is outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow('usePusher must be used within a PusherProvider');

    spy.mockRestore();
  });

  it('handles typing send failure silently', async () => {
    mockApiPost.mockRejectedValue(new Error('Network error'));

    render(
      <PusherProvider>
        <TestConsumer />
      </PusherProvider>
    );

    // Should not throw
    await act(async () => {
      screen.getByRole('button', { name: 'Send Typing' }).click();
    });
  });
});

/**
 * The realtime contract the Laravel server emits (see PusherContext header):
 *   user channel  private-tenant.{T}.user.{id}      → new-message, typing, message.read, unread-count
 *   chat channel  private-tenant.{T}.chat.{min}-{max} → new-message (echo for the sender's other tabs)
 */
describe('PusherContext realtime contract', () => {
  const USER_CHANNEL = 'private-tenant.2.user.1';
  const CHAT_CHANNEL = 'private-tenant.2.chat.1-5';

  const receivedMessages: NewMessageEvent[] = [];
  const receivedTyping: TypingEvent[] = [];
  const receivedReads: MessageReadEvent[] = [];
  const receivedUpdates: MessageUpdatedEvent[] = [];
  const receivedDeletes: MessageDeletedEvent[] = [];
  const receivedReactions: MessageReactionEvent[] = [];

  function ContractConsumer() {
    const {
      onNewMessage, onTyping, onMessageRead, onMessageUpdated, onMessageDeleted, onMessageReaction,
      subscribeToConversation, isConnected,
    } = usePusher();
    useEffect(() => onNewMessage((event) => { receivedMessages.push(event); }), [onNewMessage]);
    useEffect(() => onTyping((event) => { receivedTyping.push(event); }), [onTyping]);
    useEffect(() => onMessageRead((event) => { receivedReads.push(event); }), [onMessageRead]);
    useEffect(() => onMessageUpdated((event) => { receivedUpdates.push(event); }), [onMessageUpdated]);
    useEffect(() => onMessageDeleted((event) => { receivedDeletes.push(event); }), [onMessageDeleted]);
    useEffect(() => onMessageReaction((event) => { receivedReactions.push(event); }), [onMessageReaction]);
    return (
      <div>
        <div data-testid="connected">{String(isConnected)}</div>
        <button onClick={() => subscribeToConversation(5)}>Open Chat</button>
      </div>
    );
  }

  async function renderConnected() {
    mockIsAuthenticated = true;
    mockUser = { id: 1, tenant_id: 2 };
    mockApiGet.mockResolvedValue({
      success: true,
      data: { enabled: true, key: 'test-key', cluster: 'eu', authEndpoint: '/pusher/auth' },
    });

    render(
      <PusherProvider>
        <ContractConsumer />
      </PusherProvider>
    );

    // Config load → dynamic pusher-js import → subscribe; wait for the user channel.
    await waitFor(() => expect(channelBindings.has(USER_CHANNEL)).toBe(true));
  }

  function makeMessage(id: number): NewMessageEvent {
    return {
      id,
      sender_id: 5,
      receiver_id: 1,
      body: 'hello',
      created_at: '2026-10-17T10:00:00Z',
      timestamp: 1760695200,
      conversation_id: 123,
    };
  }

  beforeEach(() => {
    channelBindings.clear();
    receivedMessages.length = 0;
    receivedTyping.length = 0;
    receivedReads.length = 0;
    receivedUpdates.length = 0;
    receivedDeletes.length = 0;
    receivedReactions.length = 0;
  });

  it('binds new-message, typing, message.read and the three mutation events on the user channel', async () => {
    await renderConnected();

    const userBindings = channelBindings.get(USER_CHANNEL)!;
    expect(userBindings.has('new-message')).toBe(true);
    expect(userBindings.has('typing')).toBe(true);
    expect(userBindings.has('message.read')).toBe(true);
    expect(userBindings.has('message.updated')).toBe(true);
    expect(userBindings.has('message.deleted')).toBe(true);
    expect(userBindings.has('message.reaction')).toBe(true);
    expect(userBindings.has('unread-count')).toBe(true);
  });

  it('delivers message.updated, message.deleted and message.reaction to their listeners', async () => {
    await renderConnected();

    const updated: MessageUpdatedEvent = {
      id: 77, body: 'corrected', is_edited: true, edited_at: '2026-10-17T10:06:00Z',
      sender_id: 5, receiver_id: 1, conversation_id: 123, timestamp: 1760695560,
    };
    const deleted: MessageDeletedEvent = {
      id: 78, scope: 'everyone', actor_id: 5, sender_id: 5, receiver_id: 1,
      conversation_id: 123, deleted_at: '2026-10-17T10:07:00Z', timestamp: 1760695620,
    };
    const reaction: MessageReactionEvent = {
      message_id: 77, emoji: '👍', action: 'added', actor_id: 1, counts: { '👍': 1 },
      sender_id: 5, receiver_id: 1, conversation_id: 123, timestamp: 1760695680,
    };

    act(() => {
      emitOnChannel(USER_CHANNEL, 'message.updated', updated);
      emitOnChannel(USER_CHANNEL, 'message.deleted', deleted);
      emitOnChannel(USER_CHANNEL, 'message.reaction', reaction);
    });

    expect(receivedUpdates).toEqual([updated]);
    expect(receivedDeletes).toEqual([deleted]);
    expect(receivedReactions).toEqual([reaction]);
  });

  it('delivers one onNewMessage call when the same id arrives on the user and chat channels', async () => {
    await renderConnected();

    act(() => {
      screen.getByRole('button', { name: 'Open Chat' }).click();
    });
    expect(channelBindings.has(CHAT_CHANNEL)).toBe(true);

    act(() => {
      emitOnChannel(USER_CHANNEL, 'new-message', makeMessage(77));
      emitOnChannel(CHAT_CHANNEL, 'new-message', makeMessage(77));
    });

    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0]?.id).toBe(77);

    // A different id is still delivered.
    act(() => {
      emitOnChannel(CHAT_CHANNEL, 'new-message', makeMessage(78));
    });
    expect(receivedMessages).toHaveLength(2);
  });

  it('typing on the user channel reaches onTyping listeners', async () => {
    await renderConnected();

    act(() => {
      emitOnChannel(USER_CHANNEL, 'typing', { user_id: 5, is_typing: true, timestamp: 1760695200 });
    });

    expect(receivedTyping).toEqual([{ user_id: 5, is_typing: true, timestamp: 1760695200 }]);
  });

  it('onMessageRead listeners receive message.read', async () => {
    await renderConnected();

    const readEvent: MessageReadEvent = {
      reader_id: 5,
      sender_id: 1,
      conversation_id: 123,
      up_to_message_id: 77,
      read_count: 2,
      read_at: '2026-10-17T10:05:00Z',
      reader_unread_messages: 0,
      timestamp: 1760695500,
    };

    act(() => {
      emitOnChannel(USER_CHANNEL, 'message.read', readEvent);
    });

    expect(receivedReads).toEqual([readEvent]);
  });

  it('chat channel binds new-message and not typing', async () => {
    await renderConnected();

    act(() => {
      screen.getByRole('button', { name: 'Open Chat' }).click();
    });

    const chatBindings = channelBindings.get(CHAT_CHANNEL)!;
    expect(chatBindings.has('new-message')).toBe(true);
    expect(chatBindings.has('typing')).toBe(false);
    expect(chatBindings.has('message')).toBe(false);
    // Mutations arrive on the user channel only; a chat-channel copy would double-deliver.
    expect(chatBindings.has('message.updated')).toBe(false);
    expect(chatBindings.has('message.deleted')).toBe(false);
    expect(chatBindings.has('message.reaction')).toBe(false);
  });
});

describe('usePusherOptional', () => {
  it('returns null when outside provider', () => {
    function OptionalConsumer() {
      const context = usePusherOptional();
      return <div data-testid="optional">{context === null ? 'null' : 'exists'}</div>;
    }

    render(<OptionalConsumer />);
    expect(screen.getByTestId('optional')).toHaveTextContent('null');
  });

  it('returns context when inside provider', () => {
    function OptionalConsumer() {
      const context = usePusherOptional();
      return <div data-testid="optional">{context === null ? 'null' : 'exists'}</div>;
    }

    render(
      <PusherProvider>
        <OptionalConsumer />
      </PusherProvider>
    );

    expect(screen.getByTestId('optional')).toHaveTextContent('exists');
  });
});
