// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PresenceContext — Global presence state provider.
 *
 * Manages heartbeat interval, caches presence data for visible users,
 * and provides hooks for reading/setting presence.
 *
 * - Sends heartbeat POST every 60 seconds while tab is focused and user is active
 * - Pauses heartbeat when tab is hidden (Page Visibility API)
 * - Stops heartbeat after 5 minutes of no user activity (mouse, keyboard, scroll, touch)
 * - Fetches bulk presence for visible user lists
 */

import {
  createContext,
  use,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { useTenant } from './TenantContext';
import { isVisitingManager } from '@/lib/access';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PresenceStatus = 'online' | 'away' | 'dnd' | 'offline';

export interface PresenceState {
  status: PresenceStatus;
  last_seen_at: string | null;
  custom_status: string | null;
  status_emoji: string | null;
}

interface PresenceContextValue {
  /** Map of user ID -> presence state for cached users */
  onlineUsers: Map<number, PresenceState>;
  /** Number of online users in the tenant */
  onlineCount: number;
  /** Set the current user's status */
  setStatus: (status: PresenceStatus, customStatus?: string, emoji?: string) => Promise<void>;
  /** Toggle the current user's presence visibility */
  setPrivacy: (hidePresence: boolean) => Promise<void>;
  /** Fetch presence for a list of user IDs (results cached in onlineUsers) */
  fetchPresence: (userIds: number[]) => Promise<void>;
  /** Get presence for a single user (from cache, returns offline if not cached) */
  getPresence: (userId: number) => PresenceState;
}

const DEFAULT_PRESENCE: PresenceState = {
  status: 'offline',
  last_seen_at: null,
  custom_status: null,
  status_emoji: null,
};

const PresenceContext = createContext<PresenceContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Heartbeat interval (ms) */
const HEARTBEAT_INTERVAL = 60_000; // 60 seconds

/** User inactivity threshold before stopping heartbeat (ms) */
const INACTIVITY_THRESHOLD = 300_000; // 5 minutes

/** Debounce for activity detection (ms) */
const ACTIVITY_DEBOUNCE = 1_000; // 1 second

/** Online count poll interval (ms) */
const ONLINE_COUNT_INTERVAL = 120_000; // 2 minutes

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface PresenceProviderProps {
  children: ReactNode;
}

export function PresenceProvider({ children }: PresenceProviderProps) {
  const { user, isAuthenticated } = useAuth();
  const { tenant } = useTenant();
  // A manager visiting from a community above is looking around, not here as a
  // member: it never shows as online, and the server refuses its heartbeat
  // anyway (E-107).
  const visiting = isAuthenticated && isVisitingManager(user, tenant?.id);
  const [onlineUsers, setOnlineUsers] = useState<Map<number, PresenceState>>(new Map());
  const [onlineCount, setOnlineCount] = useState(0);

  // Refs for heartbeat management
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const isTabVisibleRef = useRef(!document.hidden);
  const isActiveRef = useRef(true);
  const activityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Activity tracking
  // ─────────────────────────────────────────────────────────────────────────

  const handleActivity = useCallback(() => {
    if (activityDebounceRef.current) {
      clearTimeout(activityDebounceRef.current);
    }

    activityDebounceRef.current = setTimeout(() => {
      lastActivityRef.current = Date.now();
      isActiveRef.current = true;
    }, ACTIVITY_DEBOUNCE);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Heartbeat
  // ─────────────────────────────────────────────────────────────────────────

  const sendHeartbeat = useCallback(async () => {
    // Don't send if tab is hidden
    if (!isTabVisibleRef.current) return;

    // Don't send if user has been inactive for 5+ minutes
    const timeSinceActivity = Date.now() - lastActivityRef.current;
    if (timeSinceActivity > INACTIVITY_THRESHOLD) {
      isActiveRef.current = false;
      return;
    }

    try {
      await api.post('/v2/presence/heartbeat');
    } catch {
      // Silent fail — heartbeat is not critical
    }
  }, []);

  // Start/stop heartbeat based on auth state
  useEffect(() => {
    if (!isAuthenticated || !user?.id || visiting) {
      // Clear heartbeat when logged out
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    // Optimistically mark current user as online immediately so the indicator
    // shows green right away without waiting for the server round-trip.
    setOnlineUsers((prev) => {
      if (prev.has(user.id)) return prev; // keep existing cached data
      const next = new Map(prev);
      next.set(user.id, {
        status: 'online',
        last_seen_at: new Date().toISOString(),
        custom_status: null,
        status_emoji: null,
      });
      return next;
    });

    // Send initial heartbeat (server-side status syncs via subsequent heartbeats)
    sendHeartbeat();

    // Set up recurring heartbeat
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

    // Activity event listeners (debounced)
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Page visibility
    const handleVisibilityChange = () => {
      isTabVisibleRef.current = !document.hidden;
      if (!document.hidden) {
        // Tab became visible — mark activity and send heartbeat
        lastActivityRef.current = Date.now();
        isActiveRef.current = true;
        sendHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (activityDebounceRef.current) {
        clearTimeout(activityDebounceRef.current);
      }
    };
  }, [isAuthenticated, user?.id, visiting, sendHeartbeat, handleActivity]);

  // ─────────────────────────────────────────────────────────────────────────
  // Online count polling
  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchOnlineCount = async () => {
      try {
        const response = await api.get<{ online_count: number }>('/v2/presence/online-count');
        if (response.success && response.data) {
          setOnlineCount(response.data.online_count);
        }
      } catch {
        // Silent fail
      }
    };

    fetchOnlineCount();
    const interval = setInterval(fetchOnlineCount, ONLINE_COUNT_INTERVAL);

    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // ─────────────────────────────────────────────────────────────────────────
  // Public methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Fetch presence for a batch of user IDs.
   * Results are merged into the onlineUsers cache.
   */
  const fetchPresence = useCallback(async (userIds: number[]) => {
    if (userIds.length === 0) return;

    // Deduplicate
    const uniqueIds = [...new Set(userIds)];

    try {
      const response = await api.get<Record<string, PresenceState>>(
        `/v2/presence/users?user_ids=${uniqueIds.join(',')}`
      );

      if (response.success && response.data) {
        setOnlineUsers((prev) => {
          const next = new Map(prev);
          for (const [idStr, presence] of Object.entries(response.data!)) {
            next.set(Number(idStr), presence);
          }
          return next;
        });
      }
    } catch (error) {
      logError('Failed to fetch presence', error);
    }
  }, []);

  /**
   * Get cached presence for a single user.
   */
  const getPresence = useCallback(
    (userId: number): PresenceState => {
      return onlineUsers.get(userId) ?? DEFAULT_PRESENCE;
    },
    [onlineUsers]
  );

  /**
   * Set the current user's status.
   */
  const setStatus = useCallback(
    async (status: PresenceStatus, customStatus?: string, emoji?: string) => {
      try {
        await api.put('/v2/presence/status', {
          status,
          custom_status: customStatus ?? null,
          emoji: emoji ?? null,
        });

        // Optimistically update local cache for current user
        if (user?.id) {
          setOnlineUsers((prev) => {
            const next = new Map(prev);
            next.set(user.id, {
              status,
              last_seen_at: new Date().toISOString(),
              custom_status: customStatus ?? null,
              status_emoji: emoji ?? null,
            });
            return next;
          });
        }
      } catch (error) {
        logError('Failed to set status', error);
      }
    },
    [user?.id]
  );

  /**
   * Toggle presence visibility.
   */
  const setPrivacy = useCallback(async (hidePresence: boolean) => {
    try {
      await api.put('/v2/presence/privacy', { hide_presence: hidePresence });
    } catch (error) {
      logError('Failed to set privacy', error);
    }
  }, []);

  const value = useMemo<PresenceContextValue>(
    () => ({
      onlineUsers,
      onlineCount,
      setStatus,
      setPrivacy,
      fetchPresence,
      getPresence,
    }),
    [onlineUsers, onlineCount, setStatus, setPrivacy, fetchPresence, getPresence]
  );

  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hook to access presence context (required).
 */
export function usePresence(): PresenceContextValue {
  const context = use(PresenceContext);
  if (!context) {
    throw new Error('usePresence must be used within a PresenceProvider');
  }
  return context;
}

/**
 * Hook to optionally access presence context (returns null if not available).
 */
export function usePresenceOptional(): PresenceContextValue | null {
  return use(PresenceContext);
}
