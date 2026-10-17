// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PusherContext - Real-time messaging via Pusher
 *
 * Provides WebSocket connectivity for real-time features:
 * - New message notifications
 * - Typing indicators
 * - Read receipts
 * - Presence (online status)
 * - Unread count updates
 *
 * Automatically subscribes to user-specific and conversation channels.
 *
 * Realtime contract (must match PusherService / MessageSent on the Laravel side):
 *
 *   private-tenant.{T}.user.{userId}
 *     new-message   {id, sender_id, receiver_id, body, created_at, timestamp,
 *                    conversation_id, message: BroadcastMessage} — recipient only
 *     message.read  MessageReadEvent — sent to BOTH the sender's and the reader's
 *                    user channel
 *     message.updated  MessageUpdatedEvent — both participants
 *     message.deleted  MessageDeletedEvent — both participants for scope
 *                    'everyone'; the ACTOR only for scope 'self'
 *     message.reaction MessageReactionEvent — both participants; `counts` are
 *                    the authoritative totals after the toggle (set, never add)
 *     typing        {user_id, is_typing, timestamp} — recipient only
 *     unread-count  {notifications, messages, timestamp}
 *     notification / notification.created / new-notification, transaction
 *
 *   private-tenant.{T}.chat.{min}-{max}
 *     new-message   same payload as above, so the sender's other tabs get an echo
 *
 * The same message id can therefore arrive on both channels; `emitNewMessage`
 * dedupes by id before fanning out to `onNewMessage` listeners. The server never
 * emits anything on the sender's own user channel for a new message.
 */

import { createContext, use, useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import type Pusher from 'pusher-js';
import type { Channel } from 'pusher-js';
import { useAuth } from './AuthContext';
import { api, tokenManager } from '@/lib/api';
import { logError, logWarn } from '@/lib/logger';
import type { Notification } from '@/types';
import type { MessageAttachment } from '@/types/api';

interface PusherConfig {
  key: string;
  cluster: string;
  authEndpoint: string;
  enabled: boolean;
}

interface PusherContextValue {
  /** Whether Pusher is connected */
  isConnected: boolean;
  /** Whether the authenticated user's private channel is subscribed and healthy. */
  isNotificationChannelReady: boolean;
  /** Raw Pusher client for subscribing to arbitrary channels */
  client: Pusher | null;
  /** Current tenant ID (needed for channel names) */
  tenantId: number | string | null;
  /** Subscribe to a conversation channel */
  subscribeToConversation: (otherUserId: number) => void;
  /** Unsubscribe from a conversation channel */
  unsubscribeFromConversation: (otherUserId: number) => void;
  /** Register a callback for new messages */
  onNewMessage: (callback: (message: NewMessageEvent) => void) => () => void;
  /** Register a callback for messages received on the authenticated user's channel. */
  onUserMessage: (callback: (message: NewMessageEvent) => void) => () => void;
  /** Register a callback for notifications received on the authenticated user's channel. */
  onNotification: (callback: (notification: Notification) => void) => () => void;
  /** Register a callback for transactions received on the authenticated user's channel. */
  onTransaction: (callback: (event: TransactionEvent) => void) => () => void;
  /** Register a callback for typing indicators */
  onTyping: (callback: (event: TypingEvent) => void) => () => void;
  /** Register a callback for read receipts (message.read on the user channel) */
  onMessageRead: (callback: (event: MessageReadEvent) => void) => () => void;
  /** Register a callback for edited messages (message.updated on the user channel) */
  onMessageUpdated: (callback: (event: MessageUpdatedEvent) => void) => () => void;
  /** Register a callback for deleted messages (message.deleted on the user channel) */
  onMessageDeleted: (callback: (event: MessageDeletedEvent) => void) => () => void;
  /** Register a callback for reaction toggles (message.reaction on the user channel) */
  onMessageReaction: (callback: (event: MessageReactionEvent) => void) => () => void;
  /** Register a callback for unread count updates */
  onUnreadCount: (callback: (event: UnreadCountEvent) => void) => () => void;
  /** Register a callback for new feed posts broadcast to the tenant channel */
  onFeedPost: (callback: (event: FeedPostEvent) => void) => () => void;
  /** Send typing indicator */
  sendTyping: (toUserId: number, isTyping: boolean) => void;
}

export interface BroadcastMessageSender {
  id: number;
  name: string;
  first_name?: string;
  avatar_url?: string;
}

/**
 * The full message row carried inside a `new-message` event. It is built from
 * the recipient's perspective, so `is_own` is always false on the wire — derive
 * own-ness from `sender_id === user.id` instead.
 */
export interface BroadcastMessage {
  id: number;
  body: string;
  sender_id: number;
  receiver_id: number;
  sender: BroadcastMessageSender;
  created_at: string;
  is_own: boolean;
  is_read: boolean;
  is_edited: boolean;
  is_deleted: boolean;
  is_voice: boolean;
  audio_url: string | null;
  audio_duration: number | null;
  reactions: Record<string, number>;
  attachments: MessageAttachment[];
  listing_id: number | null;
  context_type: string | null;
  context_id: number | null;
  /** True when the server shortened `body` for the wire; fetch the canonical row. */
  is_truncated?: boolean;
}

export interface NewMessageEvent {
  id: number;
  sender_id: number;
  receiver_id: number;
  body: string;
  created_at: string;
  timestamp: number;
  /** crc32 pair id for the conversation, not a database id */
  conversation_id?: number;
  /** The full message row (attachments, voice, sender) when the server includes it */
  message?: BroadcastMessage;
  /** Backend may send from_user_id instead of sender_id in some event payloads */
  from_user_id?: number;
  /** Some event payloads include a preview field instead of body */
  preview?: string;
}

export interface MessageReadEvent {
  reader_id: number;
  sender_id: number;
  conversation_id: number;
  up_to_message_id: number;
  read_count: number;
  /** ISO 8601 */
  read_at: string;
  /** The reader's remaining unread message count after this read */
  reader_unread_messages: number;
  timestamp: number;
}

/** `message.updated`: the sender changed the text. Replace the body; mark edited. */
export interface MessageUpdatedEvent {
  id: number;
  body: string;
  is_edited: boolean;
  /** ISO 8601 */
  edited_at: string;
  /** True when the server shortened `body` for the wire; fetch the canonical row. */
  is_truncated?: boolean;
  sender_id: number;
  receiver_id: number;
  conversation_id: number;
  timestamp: number;
}

/**
 * `message.deleted`. For scope 'everyone' show the tombstone. For scope 'self'
 * the server sends it to the actor's own channel only (their other devices);
 * a client that is not the actor must ignore it.
 */
export interface MessageDeletedEvent {
  id: number;
  scope: 'everyone' | 'self';
  actor_id: number;
  sender_id: number;
  receiver_id: number;
  conversation_id: number;
  /** ISO 8601 */
  deleted_at: string;
  timestamp: number;
}

/** `message.reaction`: `counts` are the server's totals after the toggle. */
export interface MessageReactionEvent {
  message_id: number;
  emoji: string;
  action: 'added' | 'removed';
  actor_id: number;
  counts: Record<string, number>;
  sender_id: number;
  receiver_id: number;
  conversation_id: number;
  timestamp: number;
}

export interface TransactionEvent {
  type: string;
  amount: number;
}

export interface TypingEvent {
  user_id: number;
  is_typing: boolean;
  timestamp?: number;
}

export interface UnreadCountEvent {
  notifications: number;
  messages: number;
  timestamp: number;
}

export interface FeedPostEvent {
  post: import('@/components/feed/types').FeedItem;
  timestamp: number;
}

// M15: Runtime guard for FeedPostEvent payloads received from Pusher
function isFeedPostEvent(data: unknown): data is FeedPostEvent {
  return (
    typeof data === 'object' &&
    data !== null &&
    'post' in data &&
    typeof (data as Record<string, unknown>).post === 'object'
  );
}

const PusherContext = createContext<PusherContextValue | null>(null);

interface PusherProviderProps {
  children: ReactNode;
}

export function PusherProvider({ children }: PusherProviderProps) {
  const { user, isAuthenticated } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isNotificationChannelReady, setIsNotificationChannelReady] = useState(false);
  const [config, setConfig] = useState<PusherConfig | null>(null);

  const pusherRef = useRef<Pusher | null>(null);
  const userChannelRef = useRef<Channel | null>(null);
  const conversationChannelsRef = useRef<Map<string, Channel>>(new Map());

  // Event listeners
  const messageListenersRef = useRef<Set<(message: NewMessageEvent) => void>>(new Set());
  const userMessageListenersRef = useRef<Set<(message: NewMessageEvent) => void>>(new Set());
  const notificationListenersRef = useRef<Set<(notification: Notification) => void>>(new Set());
  const transactionListenersRef = useRef<Set<(event: TransactionEvent) => void>>(new Set());
  const typingListenersRef = useRef<Set<(event: TypingEvent) => void>>(new Set());
  const messageReadListenersRef = useRef<Set<(event: MessageReadEvent) => void>>(new Set());
  const messageUpdatedListenersRef = useRef<Set<(event: MessageUpdatedEvent) => void>>(new Set());
  const messageDeletedListenersRef = useRef<Set<(event: MessageDeletedEvent) => void>>(new Set());
  const messageReactionListenersRef = useRef<Set<(event: MessageReactionEvent) => void>>(new Set());
  const unreadListenersRef = useRef<Set<(event: UnreadCountEvent) => void>>(new Set());
  const feedPostListenersRef = useRef<Set<(event: FeedPostEvent) => void>>(new Set());
  const seenNotificationIdsRef = useRef<Set<number>>(new Set());
  // A new message arrives on the recipient's user channel AND on the pair's chat
  // channel; conversation listeners must see it once.
  const seenMessageIdsRef = useRef<Set<number>>(new Set());

  const emitNewMessage = useCallback((data: NewMessageEvent) => {
    const seen = seenMessageIdsRef.current;
    if (seen.has(data.id)) return;
    seen.add(data.id);
    if (seen.size > 500) {
      const oldestId = seen.values().next().value;
      if (oldestId !== undefined) seen.delete(oldestId);
    }
    messageListenersRef.current.forEach((listener) => listener(data));
  }, []);

  // Tenant feed channel ref (unsubscribed on cleanup alongside user channel)
  const feedChannelRef = useRef<Channel | null>(null);

  // Load Pusher config from API (only when authenticated)
  useEffect(() => {
    if (!isAuthenticated) {
      setConfig(null);
      return;
    }

    let didCancel = false;

    async function loadConfig() {
      try {
        const response = await api.get<PusherConfig>('/v2/realtime/config');
        if (!didCancel && response.success && response.data?.enabled) {
          setConfig(response.data);
        }
      } catch (error) {
        // Pusher not configured - this is fine, real-time features just won't work
        logError('Pusher config not available', error);
      }
    }

    void loadConfig();
    return () => {
      didCancel = true;
    };
  }, [isAuthenticated]);

  // Initialize Pusher when authenticated and config is available
  useEffect(() => {
    if (!isAuthenticated || !user?.id || !config?.enabled || !config.key) {
      return;
    }

    // Initialize Pusher with Bearer token auth (matching NotificationsContext)
    const accessToken = tokenManager.getAccessToken();
    if (!accessToken) return;

    let didCancel = false;
    let reconnectAttempts = 0;
    const reconnectTimeouts: ReturnType<typeof setTimeout>[] = [];
    const seenNotificationIds = seenNotificationIdsRef.current;
    const seenMessageIds = seenMessageIdsRef.current;

    void import('pusher-js')
      .then(({ default: PusherClient }) => {
    if (didCancel) return;

    const pusher = new PusherClient(config.key, {
      cluster: config.cluster,
      // Use a custom authorizer instead of authEndpoint so that the request
      // goes through our api client, which handles CORS, content-type, and
      // token refresh — avoiding the 405 error that occurs when Pusher's
      // built-in XHR POST hits the backend without proper CORS headers.
      authorizer: (channel) => ({
        authorize: (socketId, callback) => {
          // Use raw fetch instead of api.post to avoid triggering SESSION_EXPIRED_EVENT
          // on Pusher auth 401s — a transient Pusher auth failure during a network blip
          // should NOT log the user out of the entire application.
          const token = tokenManager.getAccessToken();
          // Use user.tenant_id (from JWT) to match the channel name, not localStorage
          // which may point to a different tenant when admins navigate cross-tenant.
          const tenantId = user?.tenant_id ? String(user.tenant_id) : (tokenManager.getTenantId?.() ?? '');
          const csrfToken = tokenManager.getCsrfToken?.() ?? '';
          fetch(`${import.meta.env.VITE_API_BASE || '/api'}/pusher/auth`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              ...(tenantId ? { 'X-Tenant-ID': String(tenantId) } : {}),
              ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
            },
            body: JSON.stringify({ socket_id: socketId, channel_name: channel.name }),
          })
            .then(async (res) => {
              if (!res.ok) {
                callback(new Error(`Pusher auth failed: ${res.status}`), null as never);
                return;
              }
              const data = await res.json();
              // Handle both direct response and wrapped {success, data} format
              const authData = data?.data ?? data;
              if (authData?.auth) {
                callback(null, authData as { auth: string });
              } else {
                callback(new Error('Pusher auth: no auth token in response'), null as never);
              }
            })
            .catch((err) => {
              callback(err instanceof Error ? err : new Error('Pusher auth failed'), null as never);
            });
        },
      }),
    });

    pusher.connection.bind('connected', () => {
      reconnectAttempts = 0; // Reset on successful connection
      setIsConnected(true);
    });

    pusher.connection.bind('disconnected', () => {
      setIsConnected(false);
      setIsNotificationChannelReady(false);
    });

    pusher.connection.bind('error', (err: unknown) => {
      // Pusher's connection 'error' fires for transient, auto-recovered transport
      // drops (network switch, laptop sleep/wake, mobile handoff, socket close
      // 1006) as well as permanent failures. Only the non-recoverable 4000-4099
      // class (app-not-found / unauthorized / over-quota) warrants an error-level
      // Sentry event; routine drops are dev-only warnings so flaky connections
      // don't fill Sentry / page on-call (Sentry React 130296692).
      const code = (err as { data?: { code?: number } } | null)?.data?.code;
      if (typeof code === 'number' && code >= 4000 && code <= 4099) {
        logError('Pusher connection error', err);
      } else {
        logWarn('Pusher connection dropped (transient)', err);
      }
      setIsConnected(false);
      setIsNotificationChannelReady(false);

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s, max 60s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60000);
      reconnectAttempts++;

      const t = setTimeout(() => {
        if (pusherRef.current) {
          pusherRef.current.connect();
        }
      }, delay);
      reconnectTimeouts.push(t);
    });

    pusherRef.current = pusher;

    // Expose a disconnect helper on window so the SW update banner can tear
    // down the WebSocket before postMessage(SKIP_WAITING). Android Chrome
    // refuses to terminate the old SW while it has active fetches/streams,
    // so the long-lived Pusher connection deadlocks SW activation otherwise.
    (window as NexusWindow).__nexus_disconnectPusher = () => {
      try { pusher.disconnect(); } catch { /* non-blocking */ }
    };

    // Subscribe to user's personal channel (must match backend PusherService::getUserChannel format)
    const tenantId = user?.tenant_id || tokenManager.getTenantId();
    if (!tenantId) {
      logError('Cannot subscribe to Pusher: no tenant_id available');
      return;
    }
    const userChannel = pusher.subscribe(`private-tenant.${tenantId}.user.${user.id}`);

    userChannel.bind('pusher:subscription_succeeded', () => {
      setIsNotificationChannelReady(true);
    });

    userChannel.bind('pusher:subscription_error', (error: unknown) => {
      logError('Pusher user channel subscription error', error);
      setIsNotificationChannelReady(false);
    });

    userChannel.bind('new-message', (data: NewMessageEvent) => {
      emitNewMessage(data);
      // Badge / toast path: the user channel only ever carries messages addressed
      // to this user, and each arrives here once, so no dedupe is needed.
      userMessageListenersRef.current.forEach((listener) => listener(data));
    });

    userChannel.bind('typing', (data: TypingEvent) => {
      typingListenersRef.current.forEach((listener) => listener(data));
    });

    userChannel.bind('message.read', (data: MessageReadEvent) => {
      messageReadListenersRef.current.forEach((listener) => listener(data));
    });

    // Changes to existing messages. Each arrives on the user channel only, once.
    userChannel.bind('message.updated', (data: MessageUpdatedEvent) => {
      messageUpdatedListenersRef.current.forEach((listener) => listener(data));
    });

    userChannel.bind('message.deleted', (data: MessageDeletedEvent) => {
      messageDeletedListenersRef.current.forEach((listener) => listener(data));
    });

    userChannel.bind('message.reaction', (data: MessageReactionEvent) => {
      messageReactionListenersRef.current.forEach((listener) => listener(data));
    });

    userChannel.bind('unread-count', (data: UnreadCountEvent) => {
      unreadListenersRef.current.forEach((listener) => listener(data));
    });

    const emitNotification = (data: Notification) => {
      // The backend has used several event aliases over time. If more than one
      // alias is emitted for the same notification, dispatch it only once.
      if (seenNotificationIds.has(data.id)) return;
      seenNotificationIds.add(data.id);
      if (seenNotificationIds.size > 500) {
        const oldestId = seenNotificationIds.values().next().value;
        if (oldestId !== undefined) seenNotificationIds.delete(oldestId);
      }
      notificationListenersRef.current.forEach((listener) => listener(data));
    };

    userChannel.bind('notification', emitNotification);
    userChannel.bind('notification.created', emitNotification);
    userChannel.bind('new-notification', emitNotification);

    userChannel.bind('transaction', (data: TransactionEvent) => {
      transactionListenersRef.current.forEach((listener) => listener(data));
    });

    userChannelRef.current = userChannel;

    // Subscribe to the tenant-wide feed channel to receive real-time new post events.
    // Channel name must match PusherService::getTenantFeedChannel() on the PHP side.
    const feedChannel = pusher.subscribe(`private-tenant.${tenantId}.feed`);
    feedChannel.bind('feed.post_created', (data: unknown) => {
      if (!isFeedPostEvent(data)) {
        console.warn('[Pusher] Invalid FeedPostEvent payload', data);
        return;
      }
      feedPostListenersRef.current.forEach((listener) => listener(data));
    });
    feedChannelRef.current = feedChannel;
      })
      .catch((error) => {
        logError('Pusher client failed to load', error);
        setIsConnected(false);
      });

    // Cleanup on unmount — unbind all handlers first, then disconnect().
    // Do NOT call unsubscribe() before disconnect() — it queues an async send
    // that fires after disconnect starts closing the socket, causing
    // "WebSocket is already in CLOSING or CLOSED state" warnings.
    // Copy ref values into local variables for the cleanup function
    const currentConversationChannels = conversationChannelsRef.current;
    return () => {
      didCancel = true;
      // H7: Clear any pending reconnect timeouts
      reconnectTimeouts.forEach(clearTimeout);
      if (userChannelRef.current) {
        userChannelRef.current.unbind_all();
      }
      if (feedChannelRef.current) {
        feedChannelRef.current.unbind_all();
      }
      currentConversationChannels.forEach((ch) => ch.unbind_all());
      pusherRef.current?.disconnect();
      pusherRef.current = null;
      userChannelRef.current = null;
      feedChannelRef.current = null;
      currentConversationChannels.clear();
      seenNotificationIds.clear();
      seenMessageIds.clear();
      setIsConnected(false);
      setIsNotificationChannelReady(false);
      try { delete (window as NexusWindow).__nexus_disconnectPusher; } catch { /* non-blocking */ }
    };
  }, [isAuthenticated, user?.id, config, user?.tenant_id, emitNewMessage]);

  /**
   * Subscribe to a conversation channel for real-time messages and typing
   */
  const subscribeToConversation = useCallback((otherUserId: number) => {
    if (!pusherRef.current || !user?.id) return;

    // Create deterministic channel ID (smaller ID first)
    const chatId = user.id < otherUserId
      ? `${user.id}-${otherUserId}`
      : `${otherUserId}-${user.id}`;

    // Must match backend PusherService::getChatChannel format (tenant-scoped)
    const tenantId = user?.tenant_id || tokenManager.getTenantId();
    const channelName = `private-tenant.${tenantId}.chat.${chatId}`;

    // Already subscribed?
    if (conversationChannelsRef.current.has(channelName)) {
      return;
    }

    const channel = pusherRef.current.subscribe(channelName);

    // The chat channel only carries the sender-side echo of `new-message`;
    // typing and read receipts travel on the user channel.
    channel.bind('new-message', emitNewMessage);

    conversationChannelsRef.current.set(channelName, channel);
  }, [user?.id, user?.tenant_id, emitNewMessage]);

  /**
   * Unsubscribe from a conversation channel
   */
  const unsubscribeFromConversation = useCallback((otherUserId: number) => {
    if (!pusherRef.current || !user?.id) return;

    const chatId = user.id < otherUserId
      ? `${user.id}-${otherUserId}`
      : `${otherUserId}-${user.id}`;

    // Must match backend PusherService::getChatChannel format (tenant-scoped)
    const tenantId = user?.tenant_id || tokenManager.getTenantId();
    const channelName = `private-tenant.${tenantId}.chat.${chatId}`;

    const channel = conversationChannelsRef.current.get(channelName);
    if (channel) {
      channel.unbind_all();
      // Only send unsubscribe over the wire if the connection is still open;
      // otherwise disconnect() will clean up and sending would trigger
      // "WebSocket is already in CLOSING or CLOSED state" warnings.
      const state = pusherRef.current.connection.state;
      if (state === 'connected') {
        pusherRef.current.unsubscribe(channelName);
      }
      conversationChannelsRef.current.delete(channelName);
    }
  }, [user?.id, user?.tenant_id]);

  /**
   * Register a callback for new messages
   * Returns an unsubscribe function
   */
  const onNewMessage = useCallback((callback: (message: NewMessageEvent) => void) => {
    messageListenersRef.current.add(callback);
    return () => {
      messageListenersRef.current.delete(callback);
    };
  }, []);

  /** Register for messages delivered specifically on the user's private channel. */
  const onUserMessage = useCallback((callback: (message: NewMessageEvent) => void) => {
    userMessageListenersRef.current.add(callback);
    return () => {
      userMessageListenersRef.current.delete(callback);
    };
  }, []);

  /** Register for notification events delivered on the user's private channel. */
  const onNotification = useCallback((callback: (notification: Notification) => void) => {
    notificationListenersRef.current.add(callback);
    return () => {
      notificationListenersRef.current.delete(callback);
    };
  }, []);

  /** Register for transaction events delivered on the user's private channel. */
  const onTransaction = useCallback((callback: (event: TransactionEvent) => void) => {
    transactionListenersRef.current.add(callback);
    return () => {
      transactionListenersRef.current.delete(callback);
    };
  }, []);

  /**
   * Register a callback for typing indicators
   * Returns an unsubscribe function
   */
  const onTyping = useCallback((callback: (event: TypingEvent) => void) => {
    typingListenersRef.current.add(callback);
    return () => {
      typingListenersRef.current.delete(callback);
    };
  }, []);

  /**
   * Register a callback for read receipts
   * Returns an unsubscribe function
   */
  const onMessageRead = useCallback((callback: (event: MessageReadEvent) => void) => {
    messageReadListenersRef.current.add(callback);
    return () => {
      messageReadListenersRef.current.delete(callback);
    };
  }, []);

  /** Register a callback for edited messages. Returns an unsubscribe function. */
  const onMessageUpdated = useCallback((callback: (event: MessageUpdatedEvent) => void) => {
    messageUpdatedListenersRef.current.add(callback);
    return () => {
      messageUpdatedListenersRef.current.delete(callback);
    };
  }, []);

  /** Register a callback for deleted messages. Returns an unsubscribe function. */
  const onMessageDeleted = useCallback((callback: (event: MessageDeletedEvent) => void) => {
    messageDeletedListenersRef.current.add(callback);
    return () => {
      messageDeletedListenersRef.current.delete(callback);
    };
  }, []);

  /** Register a callback for reaction toggles. Returns an unsubscribe function. */
  const onMessageReaction = useCallback((callback: (event: MessageReactionEvent) => void) => {
    messageReactionListenersRef.current.add(callback);
    return () => {
      messageReactionListenersRef.current.delete(callback);
    };
  }, []);

  /**
   * Register a callback for unread count updates
   * Returns an unsubscribe function
   */
  const onUnreadCount = useCallback((callback: (event: UnreadCountEvent) => void) => {
    unreadListenersRef.current.add(callback);
    return () => {
      unreadListenersRef.current.delete(callback);
    };
  }, []);

  /**
   * Register a callback for new feed posts on the tenant feed channel
   * Returns an unsubscribe function
   */
  const onFeedPost = useCallback((callback: (event: FeedPostEvent) => void) => {
    feedPostListenersRef.current.add(callback);
    return () => {
      feedPostListenersRef.current.delete(callback);
    };
  }, []);

  /**
   * Send typing indicator to another user
   */
  const sendTyping = useCallback(async (toUserId: number, isTyping: boolean) => {
    try {
      await api.post('/v2/messages/typing', {
        recipient_id: toUserId,
        is_typing: isTyping,
      });
    } catch {
      // Silent fail - typing indicators are not critical
    }
  }, []);

  const tenantIdValue = user?.tenant_id || tokenManager.getTenantId() || null;

  const value = useMemo<PusherContextValue>(
    () => ({
      isConnected,
      isNotificationChannelReady,
      client: pusherRef.current,
      tenantId: tenantIdValue,
      subscribeToConversation,
      unsubscribeFromConversation,
      onNewMessage,
      onUserMessage,
      onNotification,
      onTransaction,
      onTyping,
      onMessageRead,
      onMessageUpdated,
      onMessageDeleted,
      onMessageReaction,
      onUnreadCount,
      onFeedPost,
      sendTyping,
    }),
    [isConnected, isNotificationChannelReady, tenantIdValue, subscribeToConversation, unsubscribeFromConversation, onNewMessage, onUserMessage, onNotification, onTransaction, onTyping, onMessageRead, onMessageUpdated, onMessageDeleted, onMessageReaction, onUnreadCount, onFeedPost, sendTyping]
  );

  return (
    <PusherContext.Provider value={value}>
      {children}
    </PusherContext.Provider>
  );
}

/**
 * Hook to access Pusher context
 */
export function usePusher(): PusherContextValue {
  const context = use(PusherContext);
  if (!context) {
    throw new Error('usePusher must be used within a PusherProvider');
  }
  return context;
}

/**
 * Hook to optionally access Pusher context (returns null if not available)
 */
export function usePusherOptional(): PusherContextValue | null {
  return use(PusherContext);
}
