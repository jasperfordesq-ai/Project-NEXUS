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
import { initRealtime, getRealtimeClient, type PusherConfig } from '@/lib/realtime';
import { registerForPushNotifications, registerRefreshCallback, syncPushBadge, unregisterRefreshCallback } from '@/lib/notifications';
import { useAuthContext } from '@/lib/context/AuthContext';
import type { Message } from '@/lib/api/messages';
import type { NotificationCounts } from '@/lib/api/notifications';

type MessageHandler = (msg: Message) => void;

interface RealtimeContextValue {
  /** Current unread message count (seeded from API, bumped by Pusher). */
  unreadMessages: number;
  /** Total unread notification count (all categories). Single source of truth. */
  unreadNotifications: number;
  /** Call when the user opens the Messages tab — resets the message badge. */
  resetUnread: () => void;
  /** Manually trigger a count refresh (e.g. after marking notifications read). */
  refreshCounts: () => void;
  /**
   * Subscribe to incoming Pusher messages for a specific conversation.
   * Returns an unsubscribe function — call it in a useEffect cleanup.
   */
  subscribeToMessages: (conversationId: number, handler: MessageHandler) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  unreadMessages: 0,
  unreadNotifications: 0,
  resetUnread: () => undefined,
  refreshCounts: () => undefined,
  subscribeToMessages: () => () => undefined,
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

/** Minimum interval between foreground-resume refreshes (ms). */
const REFRESH_THROTTLE_MS = 30_000;
const PUSH_REGISTRATION_REFRESH_MS = 30 * 60_000;

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthContext();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const channelRef = useRef<Channel | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  /** conversation_id → set of handlers listening for new messages */
  const messageListenersRef = useRef<Map<number, Set<MessageHandler>>>(new Map());
  /** Track whether the refresh callback is currently registered */
  const refreshCallbackRegisteredRef = useRef(false);
  /** Cached Pusher config — avoids re-fetching on every auth state change */
  const pusherConfigRef = useRef<PusherConfig | null>(null);
  /** Timestamp of last successful count refresh — throttles foreground resume calls */
  const lastRefreshRef = useRef(0);
  const lastPushRegistrationRefreshRef = useRef(0);

  // Single function to fetch all notification counts — the ONLY place this
  // endpoint is called. HomeScreen and TabsLayout read from context instead.
  const refreshCounts = useCallback(() => {
    if (!isAuthenticated) return;
    const now = Date.now();
    if (now - lastRefreshRef.current < REFRESH_THROTTLE_MS) return;
    lastRefreshRef.current = now;

    api
      .get<{ data: NotificationCounts }>(`${API_V2}/notifications/counts`)
      .then((res) => {
        setUnreadMessages(res.data.messages);
        setUnreadNotifications(res.data.total);
      })
      .catch(() => { /* non-critical — badges stay at previous value */ });
  }, [isAuthenticated]);

  // Seed counts from REST API on initial auth
  useEffect(() => {
    if (!isAuthenticated) {
      setUnreadMessages(0);
      setUnreadNotifications(0);
      return;
    }
    // Force immediate refresh (bypass throttle for initial seed)
    lastRefreshRef.current = 0;
    refreshCounts();
  }, [isAuthenticated, refreshCounts]);

  // The API count is authoritative; mirror it to the launcher badge and clear
  // the badge immediately on logout rather than leaving stale OS chrome behind.
  useEffect(() => {
    void syncPushBadge(isAuthenticated ? unreadNotifications : 0);
  }, [isAuthenticated, unreadNotifications]);

  // Connect to Pusher — uses cached config to avoid redundant network calls.
  // Only fetches fresh config on first connect or when cache is empty.
  useEffect(() => {
    if (!isAuthenticated) return;

    let mounted = true;

    async function connectPusher() {
      try {
        let config = pusherConfigRef.current;

        // Only fetch Pusher config if we don't have it cached.
        // NOTE: this route lives OUTSIDE the /v2 prefix on the backend —
        // /api/v2/pusher/config does not exist (404) and would silently kill realtime.
        if (!config) {
          config = await api.get<PusherConfig>('/api/pusher/config');
          if (!mounted) return;
          pusherConfigRef.current = config;
        }

        if (!config.enabled || !config.key) return;

        const client = initRealtime(config);
        if (!client) return;

        const channelName = config.channels?.user;
        if (!channelName) return;

        const ch = client.subscribe(channelName);
        channelRef.current = ch;

        // Bump the unread badge and notify any open thread screens
        ch.bind('new-message', (rawPayload: unknown) => {
          if (!mounted) return;

          let hasActiveListener = false;
          if (isMessagePayload(rawPayload)) {
            const listeners = messageListenersRef.current;
            // Dispatch by conversation ID
            const convListeners = listeners.get(rawPayload.conversation_id);
            if (convListeners && convListeners.size > 0) {
              hasActiveListener = true;
              convListeners.forEach((handler) => handler(rawPayload.message));
            }
            // Also dispatch by sender's user ID — the thread screen subscribes
            // using the other user's ID (not the conversation row ID)
            const senderId = rawPayload.message.sender?.id;
            if (senderId) {
              const senderListeners = listeners.get(senderId);
              if (senderListeners && senderListeners.size > 0) {
                hasActiveListener = true;
                senderListeners.forEach((handler) => handler(rawPayload.message));
              }
            }
          }

          // Only bump badge if no thread screen is actively viewing this conversation
          if (!hasActiveListener) {
            setUnreadMessages((prev) => prev + 1);
          }
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
    };
  }, [isAuthenticated]);

  // Clear Pusher config cache on logout so next login gets fresh config
  useEffect(() => {
    if (!isAuthenticated) {
      pusherConfigRef.current = null;
    }
  }, [isAuthenticated]);

  // Foreground resume: refresh counts + reconnect Pusher.
  // Throttled to prevent rapid fire on quick background/foreground cycling.
  useEffect(() => {
    if (!isAuthenticated) {
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
      lastRefreshRef.current = 0;
      refreshCounts();
    });
    refreshCallbackRegisteredRef.current = true;

    return () => {
      appStateSubscription.remove();
      unregisterRefreshCallback();
      refreshCallbackRegisteredRef.current = false;
    };
  }, [isAuthenticated, refreshCounts]);

  const resetUnread = useCallback(() => setUnreadMessages(0), []);

  const subscribeToMessages = useCallback(
    (conversationId: number, handler: MessageHandler): (() => void) => {
      const map = messageListenersRef.current;
      if (!map.has(conversationId)) map.set(conversationId, new Set());
      map.get(conversationId)!.add(handler);
      return () => {
        map.get(conversationId)?.delete(handler);
      };
    },
    [],
  );

  return (
    <RealtimeContext.Provider
      value={{ unreadMessages, unreadNotifications, resetUnread, refreshCounts, subscribeToMessages }}
    >
      {children}
    </RealtimeContext.Provider>
  );
}
