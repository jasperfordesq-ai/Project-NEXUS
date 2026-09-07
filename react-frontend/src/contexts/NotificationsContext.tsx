// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NotificationsContext owns notification counts and presentation side effects.
 * PusherContext is the sole realtime client/channel owner; this provider only
 * consumes its typed event manager and polls while realtime is unavailable.
 */

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import i18n from 'i18next';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { Notification } from '@/types';
import { useAuth } from './AuthContext';
import { useTenant } from './TenantContext';
import {
  usePusherOptional,
  type NewMessageEvent,
  type TransactionEvent,
} from './PusherContext';
import { useToast } from './ToastContext';

const POLLING_INTERVAL = 60_000;

interface NotificationCounts {
  total: number;
  messages: number;
  listings: number;
  transactions: number;
  connections: number;
  events: number;
  groups: number;
  achievements: number;
  system: number;
}

interface NotificationsState {
  unreadCount: number;
  counts: NotificationCounts;
}

interface NotificationsContextValue extends NotificationsState {
  /** True only when both the socket and authenticated user channel are healthy. */
  isConnected: boolean;
  connectionError: string | null;
  refreshCounts: () => Promise<void>;
  /** Resolves true only if the server confirmed the change. */
  markAsRead: (id: number) => Promise<boolean>;
  /** Resolves true only if the server confirmed the change. */
  markAllAsRead: () => Promise<boolean>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const emptyCounts: NotificationCounts = {
  total: 0,
  messages: 0,
  listings: 0,
  transactions: 0,
  connections: 0,
  events: 0,
  groups: 0,
  achievements: 0,
  system: 0,
};

const emptyNotificationsContext: NotificationsContextValue = {
  unreadCount: 0,
  counts: emptyCounts,
  isConnected: false,
  connectionError: null,
  refreshCounts: async () => {},
  markAsRead: async () => false,
  markAllAsRead: async () => false,
};

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user, isAuthenticated } = useAuth();
  const { hasModule } = useTenant();
  const notificationsEnabled = hasModule('notifications');
  const messagesEnabled = hasModule('messages');
  const walletEnabled = hasModule('wallet');
  const realtime = usePusherOptional();
  const toast = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [state, setState] = useState<NotificationsState>({
    unreadCount: 0,
    counts: { ...emptyCounts },
  });

  const refreshCounts = useCallback(async () => {
    if (!isAuthenticated) return;

    try {
      const [notificationResponse, messagesResponse] = await Promise.all([
        notificationsEnabled ? api.get<NotificationCounts>('/v2/notifications/counts') : Promise.resolve(null),
        messagesEnabled ? api.get<{ count: number }>('/v2/messages/unread-count').catch(() => null) : Promise.resolve(null),
      ]);

      if (notificationsEnabled && (!notificationResponse?.success || !notificationResponse.data)) return;

      const counts = notificationResponse?.data ?? emptyCounts;
      const unreadMessages = messagesResponse?.success
        ? messagesResponse.data?.count ?? 0
        : 0;

      setState({
        unreadCount: counts.total ?? 0,
        counts: {
          total: counts.total ?? 0,
          messages: unreadMessages,
          listings: counts.listings ?? 0,
          transactions: counts.transactions ?? 0,
          connections: counts.connections ?? 0,
          events: counts.events ?? 0,
          groups: counts.groups ?? 0,
          achievements: counts.achievements ?? 0,
          system: counts.system ?? 0,
        },
      });
    } catch (error) {
      logError('Failed to fetch notification counts', error);
    }
  }, [isAuthenticated, notificationsEnabled, messagesEnabled]);

  const refreshCountsRef = useRef(refreshCounts);
  useEffect(() => {
    refreshCountsRef.current = refreshCounts;
  }, [refreshCounts]);

  const markAsRead = useCallback(async (id: number): Promise<boolean> => {
    if (!notificationsEnabled) return false;
    try {
      const response = await api.post(`/v2/notifications/${id}/read`);
      if (!response.success) return false;

      setState((previous) => ({
        ...previous,
        unreadCount: Math.max(0, previous.unreadCount - 1),
      }));
      return true;
    } catch (error) {
      logError('Failed to mark notification as read', error);
      return false;
    }
  }, [notificationsEnabled]);

  const markAllAsRead = useCallback(async (): Promise<boolean> => {
    if (!notificationsEnabled) return false;
    try {
      const response = await api.post('/v2/notifications/read-all');
      if (!response.success) return false;

      setState((previous) => ({
        unreadCount: 0,
        counts: {
          ...emptyCounts,
          // Messages and notifications are separate systems.
          messages: previous.counts.messages,
        },
      }));
      return true;
    } catch (error) {
      logError('Failed to mark all notifications as read', error);
      return false;
    }
  }, [notificationsEnabled]);

  const handleNewNotification = useCallback((data: Notification) => {
    if (!notificationsEnabled) return;
    setState((previous) => ({
      ...previous,
      unreadCount: previous.unreadCount + 1,
    }));

    const toastConfig = getToastConfig(data.type);
    toastRef.current.info(
      toastConfig.title,
      data.message || data.body || data.title
    );
  }, [notificationsEnabled]);

  const handleNewMessage = useCallback((data: NewMessageEvent) => {
    if (!messagesEnabled) return;
    setState((previous) => ({
      ...previous,
      unreadCount: previous.unreadCount + 1,
      counts: {
        ...previous.counts,
        messages: previous.counts.messages + 1,
      },
    }));

    const text = data.body || data.preview || data.message || '';
    toastRef.current.info(
      i18n.t('realtime.new_message', { ns: 'notifications' }),
      text.substring(0, 50) ||
        i18n.t('realtime.new_message_fallback', { ns: 'notifications' })
    );
  }, [messagesEnabled]);

  const handleTransaction = useCallback((data: TransactionEvent) => {
    if (!walletEnabled) return;
    void refreshCountsRef.current();
    toastRef.current.success(
      i18n.t('realtime.transaction_complete', { ns: 'notifications' }),
      i18n.t('realtime.transaction_amount', {
        ns: 'notifications',
        sign: data.type === 'credit' ? '+' : '-',
        amount: data.amount,
      })
    );
  }, [walletEnabled]);

  // Fetch once per authenticated tenant/user identity and clear tenant-scoped
  // notification state on logout before another identity can be rendered.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setState({ unreadCount: 0, counts: { ...emptyCounts } });
      return;
    }

    void refreshCountsRef.current();
  }, [isAuthenticated, user?.id, user?.tenant_id, notificationsEnabled, messagesEnabled]);

  const onNotification = realtime?.onNotification;
  const onUserMessage = realtime?.onUserMessage;
  const onTransaction = realtime?.onTransaction;

  // Consume the canonical user's channel. This provider deliberately contains
  // no pusher-js import, client construction, subscription, or disconnection.
  useEffect(() => {
    if (
      !isAuthenticated ||
      !user?.id ||
      !onNotification ||
      !onUserMessage ||
      !onTransaction
    ) {
      return;
    }

    const unsubscribeNotification = onNotification(handleNewNotification);
    const unsubscribeMessage = onUserMessage(handleNewMessage);
    const unsubscribeTransaction = onTransaction(handleTransaction);

    return () => {
      unsubscribeNotification();
      unsubscribeMessage();
      unsubscribeTransaction();
    };
  }, [
    isAuthenticated,
    user?.id,
    onNotification,
    onUserMessage,
    onTransaction,
    handleNewNotification,
    handleNewMessage,
    handleTransaction,
  ]);

  const isRealtimeHealthy = Boolean(
    realtime?.isConnected && realtime.isNotificationChannelReady
  );

  // Polling is a fallback, never a parallel primary transport. It pauses as
  // soon as the private user channel is healthy and resumes on degradation.
  useEffect(() => {
    if (!isAuthenticated || !user?.id || isRealtimeHealthy || (!notificationsEnabled && !messagesEnabled)) return;

    const interval = setInterval(() => {
      void refreshCountsRef.current();
    }, POLLING_INTERVAL);

    return () => clearInterval(interval);
  }, [isAuthenticated, user?.id, user?.tenant_id, isRealtimeHealthy, notificationsEnabled, messagesEnabled]);

  const value = useMemo<NotificationsContextValue>(
    () => ({
      ...state,
      isConnected: isRealtimeHealthy,
      connectionError: null,
      refreshCounts,
      markAsRead,
      markAllAsRead,
    }),
    [state, isRealtimeHealthy, refreshCounts, markAsRead, markAllAsRead]
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const context = use(NotificationsContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider');
  }
  return context;
}

export function useNotificationsOptional(): NotificationsContextValue {
  return use(NotificationsContext) ?? emptyNotificationsContext;
}

function getNotificationToastTitle(key: string): string {
  return i18n.t(`realtime.toast_${key}`, { ns: 'notifications' });
}

function getToastConfig(type: string): { title: string } {
  const configs: Record<string, { title: string }> = {
    message: { title: getNotificationToastTitle('message') },
    listing: { title: getNotificationToastTitle('listing') },
    transaction: { title: getNotificationToastTitle('transaction') },
    connection: { title: getNotificationToastTitle('connection') },
    event: { title: getNotificationToastTitle('event') },
    group: { title: getNotificationToastTitle('group') },
    achievement: { title: getNotificationToastTitle('achievement') },
    broker_review: { title: getNotificationToastTitle('broker_review') },
    safeguarding_flag: { title: getNotificationToastTitle('safeguarding_flag') },
    safeguarding_assignment: { title: getNotificationToastTitle('safeguarding_assignment') },
    system: { title: getNotificationToastTitle('system') },
    vol_application_received: { title: getNotificationToastTitle('vol_application_received') },
    vol_application_approved: { title: getNotificationToastTitle('vol_application_approved') },
    vol_application_declined: { title: getNotificationToastTitle('vol_application_declined') },
    vol_application_withdrawn: { title: getNotificationToastTitle('vol_application_withdrawn') },
    vol_shift_signup: { title: getNotificationToastTitle('vol_shift_signup') },
    vol_shift_cancelled: { title: getNotificationToastTitle('vol_shift_cancelled') },
    vol_hours_approved: { title: getNotificationToastTitle('vol_hours_approved') },
    vol_hours_declined: { title: getNotificationToastTitle('vol_hours_declined') },
    vol_opportunity_closed: { title: getNotificationToastTitle('vol_opportunity_closed') },
    job_application_status: { title: getNotificationToastTitle('job_application_status') },
    job_application: { title: getNotificationToastTitle('job_application') },
    job_interview_proposed: { title: getNotificationToastTitle('job_interview_proposed') },
    job_interview_accepted: { title: getNotificationToastTitle('job_interview_accepted') },
    job_interview_declined: { title: getNotificationToastTitle('job_interview_declined') },
    job_interview_cancelled: { title: getNotificationToastTitle('job_interview_cancelled') },
    job_offer_received: { title: getNotificationToastTitle('job_offer_received') },
    job_offer_accepted: { title: getNotificationToastTitle('job_offer_accepted') },
    job_offer_rejected: { title: getNotificationToastTitle('job_offer_rejected') },
    job_offer_withdrawn: { title: getNotificationToastTitle('job_offer_withdrawn') },
    job_alert_match: { title: getNotificationToastTitle('job_alert_match') },
    job_interview_reminder: { title: getNotificationToastTitle('job_interview_reminder') },
    job_completion_credits: { title: getNotificationToastTitle('job_completion_credits') },
  };

  return configs[type] || { title: getNotificationToastTitle('default') };
}

export default NotificationsContext;
