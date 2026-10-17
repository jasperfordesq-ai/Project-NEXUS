// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { Channel } from 'pusher-js';

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { disconnectRealtime, initRealtime, getRealtimeClient, type PusherConfig } from '@/lib/realtime';
import { registerForPushNotifications, registerRefreshCallback, syncPushBadge, unregisterRefreshCallback } from '@/lib/notifications';
import { useAuthContext } from '@/lib/context/AuthContext';
import { getUnreadMessageCount, type Message } from '@/lib/api/messages';
import type { NotificationCounts } from '@/lib/api/notifications';

/**
 * A handler for an incoming realtime message.
 *
 * 🔴 Returning `true` means "I am on screen, the member can see this, and I have
 * acknowledged it" — and ONLY that suppresses the unread badge. It used to be enough for a
 * listener merely to be REGISTERED. A thread screen subscribes in a plain effect, not a
 * focus-scoped one, so following the conversation's linked listing or event pushes another
 * screen on top while the thread stays mounted and subscribed. The message then arrived
 * behind that screen, was marked read, and the badge never rose — so a member who never saw
 * it had no way of knowing it existed. Registered is not the same as watching.
 */
type MessageHandler = (msg: Message) => boolean | void;

/**
 * `message.read` on the user channel. Sent to BOTH the sender's and the reader's channel, so
 * a thread listens for it keyed by the other member's id (= `reader_id` when they read ours).
 * Every field beyond `reader_id` is optional: mobile tolerates a server that sends less.
 */
export interface MessageReadEvent {
  reader_id: number;
  sender_id?: number;
  conversation_id?: number;
  /** Everything with an id up to and including this one is now read. */
  up_to_message_id?: number | null;
  /** Some servers list the ids instead; when present it wins over `up_to_message_id`. */
  message_ids?: number[];
  read_count?: number;
  read_at?: string;
  reader_unread_messages?: number;
  timestamp?: string | number;
}

/** `typing` on the recipient's user channel. */
export interface TypingEvent {
  user_id: number;
  is_typing: boolean;
  timestamp?: string | number;
}

/** What one open conversation wants to hear about the other member. */
export interface ConversationHandlers {
  message?: MessageHandler;
  read?: (event: MessageReadEvent) => void;
  typing?: (event: TypingEvent) => void;
}

/** What the inbox list wants to hear about every conversation. */
export interface InboxHandlers {
  message?: (otherUserId: number, message: Message) => void;
  read?: (event: MessageReadEvent) => void;
}

interface RealtimeContextValue {
  /** Changes after subscription succeeds so views can fetch events missed offline. */
  recoveryVersion: number;
  /** Current unread message count (seeded from API, bumped by Pusher). */
  unreadMessages: number;
  /** Total unread notification count (all categories). Single source of truth. */
  unreadNotifications: number;
  /**
   * Re-read the counts from the server. Pass `force` after an action that has
   * just changed them (opening a conversation marks it read server-side) so the
   * 30s throttle does not leave a stale badge on screen.
   */
  refreshCounts: (force?: boolean) => void;
  /**
   * Subscribe to incoming Pusher messages for a specific conversation.
   * Returns an unsubscribe function — call it in a useEffect cleanup.
   */
  subscribeToMessages: (conversationId: number, handler: MessageHandler) => () => void;
  /**
   * Subscribe an open conversation, keyed by the OTHER member's user id. `message` fires for
   * a message in that conversation (with `is_own` derived from the session), `read` when that
   * member reads what we sent, `typing` when they start or stop typing.
   */
  subscribeToConversation: (otherUserId: number, handlers: ConversationHandlers) => () => void;
  /** Subscribe the inbox list to every conversation's messages and read receipts. */
  subscribeToInbox: (handlers: InboxHandlers) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  recoveryVersion: 0,
  unreadMessages: 0,
  unreadNotifications: 0,
  refreshCounts: () => undefined,
  subscribeToMessages: () => () => undefined,
  subscribeToConversation: () => () => undefined,
  subscribeToInbox: () => () => undefined,
});

export function useRealtimeContext(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Validate incoming Pusher payload shape at runtime. */
function isMessagePayload(data: unknown): data is { conversation_id: number; message: Message } {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.conversation_id === 'number' && typeof obj.message === 'object' && obj.message !== null;
}

function isReadEvent(data: unknown): data is MessageReadEvent {
  if (typeof data !== 'object' || data === null) return false;
  return typeof (data as Record<string, unknown>).reader_id === 'number';
}

function isTypingEvent(data: unknown): data is TypingEvent {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return typeof obj.user_id === 'number' && typeof obj.is_typing === 'boolean';
}

/** Minimum interval between foreground-resume refreshes (ms). */
const REFRESH_THROTTLE_MS = 30_000;
const PUSH_REGISTRATION_REFRESH_MS = 30 * 60_000;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const { isAuthenticated, user } = useAuthContext();
  const sessionIdentity = isAuthenticated && user ? user.id : null;
  const activeSessionIdentityRef = useRef(sessionIdentity);
  activeSessionIdentityRef.current = sessionIdentity;
  const [messageCount, setMessageCount] = useState({ identity: sessionIdentity, count: 0 });
  const [notificationCount, setNotificationCount] = useState({ identity: sessionIdentity, count: 0 });
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  // Never expose the preceding account's count during the render in which identity
  // changes. The reset effect runs after render, which is too late for UI and OS badges.
  const unreadMessages = messageCount.identity === sessionIdentity ? messageCount.count : 0;
  const unreadNotifications = notificationCount.identity === sessionIdentity
    ? notificationCount.count
    : 0;
  const channelRef = useRef<Channel | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  /** other user id (or legacy conversation id) → handler sets for that open conversation */
  const conversationListenersRef = useRef<Map<number, Set<ConversationHandlers>>>(new Map());
  /** Inbox screens listening to every conversation. */
  const inboxListenersRef = useRef<Set<InboxHandlers>>(new Set());
  /** Track whether the refresh callback is currently registered */
  const refreshCallbackRegisteredRef = useRef(false);
  /** Cached Pusher config — avoids re-fetching on every auth state change */
  const pusherConfigRef = useRef<PusherConfig | null>(null);
  /** Timestamp of last successful count refresh — throttles foreground resume calls */
  const lastRefreshRef = useRef(0);
  const lastPushRegistrationRefreshRef = useRef(0);

  // Single function to fetch all badge counts — the ONLY place these endpoints
  // are called. HomeScreen and TabsLayout read from context instead.
  //
  // 🔴 The message badge MUST come from /messages/unread-count, not from
  // `notifications/counts.messages`. Those are two different stores: the latter
  // counts unread rows in the `notifications` table (types message /
  // new_message / message_received / federation_message), and reading a
  // conversation clears `messages.is_read`, not those rows. Sourcing the badge
  // from the bell count is why the red dot came back at every login even after
  // the member had read everything. The React frontend has always read
  // /messages/unread-count for this reason and pins it with its own test —
  // see react-frontend/src/contexts/NotificationsContext.tsx.
  const refreshCounts = useCallback((force = false) => {
    if (sessionIdentity === null) return;
    const requestedFor = sessionIdentity;
    const now = Date.now();
    if (!force && now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshRef.current = now;

    // Settled, not all-or-nothing: a failing message count must not also blank
    // the notification badge, and vice versa.
    void Promise.allSettled([
      api.get<{ data: NotificationCounts }>(`${API_V2}/notifications/counts`),
      getUnreadMessageCount(),
    ]).then(([countsResult, messagesResult]) => {
      // A valid response still belongs to the account that requested it. Account
      // replacement can keep `isAuthenticated` true throughout, so boolean auth state
      // alone cannot stop account A's late badges from appearing for account B.
      if (activeSessionIdentityRef.current !== requestedFor) return;
      if (countsResult.status === 'fulfilled') {
        const total = countsResult.value?.data?.total;
        if (typeof total === 'number') setNotificationCount({ identity: requestedFor, count: total });
      }
      if (messagesResult.status === 'fulfilled') {
        const count = messagesResult.value?.data?.count;
        if (typeof count === 'number') setMessageCount({ identity: requestedFor, count });
      }
      // On failure each badge deliberately keeps its previous value. Falling
      // back to 0 would tell the member they have read everything because the
      // network dropped, which is the same lie in the other direction.
    });
  }, [sessionIdentity]);

  // Seed counts from REST API on initial auth
  useEffect(() => {
    lastRefreshRef.current = 0;
    setMessageCount({ identity: sessionIdentity, count: 0 });
    setNotificationCount({ identity: sessionIdentity, count: 0 });
    if (sessionIdentity === null) {
      return;
    }
    refreshCounts(true);
  }, [refreshCounts, sessionIdentity]);

  // The API count is authoritative; mirror it to the launcher badge and clear
  // the badge immediately on logout rather than leaving stale OS chrome behind.
  useEffect(() => {
    void syncPushBadge(sessionIdentity !== null ? unreadNotifications : 0);
  }, [sessionIdentity, unreadNotifications]);

  // Connect to Pusher — uses cached config to avoid redundant network calls.
  // Only fetches fresh config on first connect or when cache is empty.
  useEffect(() => {
    if (sessionIdentity === null) {
      disconnectRealtime();
      return;
    }

    let mounted = true;
    pusherConfigRef.current = null;

    async function connectPusher() {
      try {
        let config = pusherConfigRef.current;

        // Only fetch Pusher config if we don't have it cached.
        // NOTE: this route lives OUTSIDE the /v2 prefix on the backend —
        // /api/v2/pusher/config does not exist (404) and would silently kill realtime.
        if (!config) {
          config = await api.get<PusherConfig>('/api/pusher/config');
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;
          pusherConfigRef.current = config;
        }

        if (!config.enabled || !config.key) return;

        const client = initRealtime(config);
        if (!client) return;

        const channelName = config.channels?.user;
        if (!channelName) return;

        const ch = client.subscribe(channelName);
        channelRef.current = ch;

        // Re-subscribing restores future events, not messages missed offline.
        ch.bind('pusher:subscription_succeeded', () => {
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;
          refreshCounts(true);
          setRecoveryVersion((version) => version + 1);
        });

        // Bump the unread badge and notify any open thread screens
        ch.bind('new-message', (rawPayload: unknown) => {
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;

          // 🔴 Set by a handler REPORTING that it showed the member the message, not by
          // one merely existing. Every registered handler is still called - a covered thread
          // must keep receiving and caching - but only a visible one silences the badge.
          let acknowledgedByViewer = false;
          let isOwn = false;
          if (isMessagePayload(rawPayload)) {
            const raw = rawPayload.message;
            /*
              🔴 `is_own` is DERIVED here, never read from the payload. The server sends the
              event to the recipient only, but a second device of the sender's, or a future
              server echo, must still land on the right side of the thread — and a payload
              flag is the server's view of its addressee, not of this phone.
            */
            const senderId = typeof raw.sender_id === 'number' ? raw.sender_id : raw.sender?.id;
            isOwn = senderId === sessionIdentity || raw.sender?.id === sessionIdentity;
            const otherUserId = isOwn ? raw.receiver_id : senderId;
            const message: Message = { ...raw, is_own: isOwn };

            const listeners = conversationListenersRef.current;
            // One delivery per subscriber, whether it registered under the conversation
            // id (legacy) or the other member's user id (the thread screen).
            const targets = new Set<ConversationHandlers>();
            listeners.get(rawPayload.conversation_id)?.forEach((handlers) => targets.add(handlers));
            if (typeof otherUserId === 'number') {
              listeners.get(otherUserId)?.forEach((handlers) => targets.add(handlers));
            }
            targets.forEach((handlers) => {
              if (handlers.message?.(message) === true) acknowledgedByViewer = true;
            });
            if (typeof otherUserId === 'number') {
              inboxListenersRef.current.forEach((handlers) => handlers.message?.(otherUserId, message));
            }
          }

          // Bump the badge unless a thread screen the member can actually see took it. A
          // message the member sent themselves (from another device) is never unread.
          if (!acknowledgedByViewer && !isOwn) {
            setMessageCount((previous) => ({
              identity: sessionIdentity,
              count: previous.identity === sessionIdentity ? previous.count + 1 : 1,
            }));
          }
        });

        // The other member read what we sent (reader = them), or we read on another
        // device (reader = us). Either way the server total may have moved.
        ch.bind('message.read', (rawPayload: unknown) => {
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;
          if (!isReadEvent(rawPayload)) return;
          conversationListenersRef.current.get(rawPayload.reader_id)?.forEach((handlers) => handlers.read?.(rawPayload));
          inboxListenersRef.current.forEach((handlers) => handlers.read?.(rawPayload));
          if (rawPayload.reader_id === sessionIdentity) refreshCounts(true);
        });

        // Only the conversation with that member hears it; a third member's typing has no
        // listener under that key, so it is dropped by construction.
        ch.bind('typing', (rawPayload: unknown) => {
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;
          if (!isTypingEvent(rawPayload)) return;
          conversationListenersRef.current.get(rawPayload.user_id)?.forEach((handlers) => handlers.typing?.(rawPayload));
        });

        // 🔴 A nudge, not a number. The payload's count is never written to state: the
        // badge is re-read from /messages/unread-count, the one store that reading clears.
        ch.bind('unread-count', () => {
          if (!mounted || activeSessionIdentityRef.current !== sessionIdentity) return;
          refreshCounts(true);
        });
      } catch {
        /* Pusher not configured — silent no-op */
      }
    }

    void connectPusher();

    return () => {
      mounted = false;
      if (channelRef.current) {
        channelRef.current.unbind_all();
        getRealtimeClient()?.unsubscribe(channelRef.current.name);
        channelRef.current = null;
      }
      disconnectRealtime();
    };
  }, [connectionAttempt, refreshCounts, sessionIdentity]);

  // Clear Pusher config cache on logout so next login gets fresh config
  useEffect(() => {
    if (sessionIdentity === null) {
      pusherConfigRef.current = null;
    }
  }, [sessionIdentity]);

  // Foreground resume: refresh counts + reconnect Pusher.
  // Throttled to prevent rapid fire on quick background/foreground cycling.
  useEffect(() => {
    if (sessionIdentity === null) {
      if (refreshCallbackRegisteredRef.current) {
        unregisterRefreshCallback();
        refreshCallbackRegisteredRef.current = false;
      }
      return;
    }

    const handleForegroundResume = () => {
      refreshCounts();

      // Expo tokens can rotate and OS permission can be revoked while the app is
      // backgrounded. Reconcile periodically without ever presenting a prompt.
      const now = Date.now();
      if (now - lastPushRegistrationRefreshRef.current >= PUSH_REGISTRATION_REFRESH_MS) {
        lastPushRegistrationRefreshRef.current = now;
        void registerForPushNotifications(false);
      }

      // Reconnect Pusher if it disconnected while backgrounded
      const client = getRealtimeClient();
      if (client && client.connection.state !== 'connected') {
        client.connect();
      } else if (!client && pusherConfigRef.current === null) {
        // A startup config request may have failed before any client existed. There is
        // nothing for `connect()` to revive in that state, so retry the full setup when
        // the member brings the app back after connectivity may have returned.
        setConnectionAttempt((attempt) => attempt + 1);
      }
    };

    const appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (prev !== 'active' && nextState === 'active') {
        handleForegroundResume();
      }
    });

    // Push notifications: silent data pushes also trigger a count refresh
    registerRefreshCallback(() => {
      // Bypass throttle for push-triggered refreshes — the server sent us
      // a signal that counts changed, so we should always honour it.
      refreshCounts(true);
    });
    refreshCallbackRegisteredRef.current = true;

    return () => {
      appStateSubscription.remove();
      unregisterRefreshCallback();
      refreshCallbackRegisteredRef.current = false;
    };
  }, [refreshCounts, sessionIdentity]);

  const subscribeToConversation = useCallback(
    (otherUserId: number, handlers: ConversationHandlers): (() => void) => {
      const map = conversationListenersRef.current;
      if (!map.has(otherUserId)) map.set(otherUserId, new Set());
      map.get(otherUserId)!.add(handlers);
      return () => {
        map.get(otherUserId)?.delete(handlers);
      };
    },
    [],
  );

  // Thin wrapper kept so existing callers and their test mocks survive unchanged.
  const subscribeToMessages = useCallback(
    (conversationId: number, handler: MessageHandler): (() => void) =>
      subscribeToConversation(conversationId, { message: handler }),
    [subscribeToConversation],
  );

  const subscribeToInbox = useCallback((handlers: InboxHandlers): (() => void) => {
    const set = inboxListenersRef.current;
    set.add(handlers);
    return () => {
      set.delete(handlers);
    };
  }, []);

  return (
    <RealtimeContext.Provider
      value={{
        unreadMessages,
        unreadNotifications,
        refreshCounts,
        subscribeToMessages,
        subscribeToConversation,
        subscribeToInbox,
        recoveryVersion,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}
