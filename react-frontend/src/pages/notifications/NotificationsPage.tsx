// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
/**
 * Notifications Page - User notifications center
 */

import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Bell from 'lucide-react/icons/bell';
import MessageSquare from 'lucide-react/icons/message-square';
import ListTodo from 'lucide-react/icons/list-todo';
import Wallet from 'lucide-react/icons/wallet';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import User from 'lucide-react/icons/user';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Award from 'lucide-react/icons/award';
import Check from 'lucide-react/icons/check';
import CheckCheck from 'lucide-react/icons/check-check';
import Trash2 from 'lucide-react/icons/trash-2';
import Settings from 'lucide-react/icons/settings';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Shield from 'lucide-react/icons/shield';
import Eye from 'lucide-react/icons/eye';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronUp from 'lucide-react/icons/chevron-up';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useToast, useTenant, useNotifications } from '@/contexts';
import { usePusherOptional } from '@/contexts/PusherContext';
import { api } from '@/lib/api';
import { formatRelativeTime, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { getNotificationDisplayText } from '@/lib/notificationText';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import type { Notification } from '@/types/api';

type NotificationFilter = 'all' | 'unread';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

export function NotificationsPage() {
  const { t } = useTranslation('notifications');
  usePageTitle(t('page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const pusher = usePusherOptional();
  const onNotification = pusher?.onNotification;
  const { refreshCounts, markAsRead: contextMarkAsRead, markAllAsRead: contextMarkAllAsRead } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('all');

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const loadNotifications = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setLoadError(null);
      setNextCursor(null);
      setHasMore(false);
      const response = await api.get<Notification[] | { data: Notification[]; meta?: { cursor?: string | null; has_more?: boolean } }>('/v2/notifications/grouped?per_page=50');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        // Handle both array response and paginated {data, meta} response
        if (Array.isArray(response.data)) {
          setNotifications(response.data);
        } else {
          const paged = response.data as { data: Notification[]; meta?: { cursor?: string | null; has_more?: boolean } };
          setNotifications(paged.data ?? []);
          setHasMore(paged.meta?.has_more ?? false);
          setNextCursor(paged.meta?.cursor ?? null);
        }
      } else {
        setLoadError(tRef.current('error_load'));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load notifications', error);
      setLoadError(tRef.current('error_load'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMoreNotifications = useCallback(async () => {
    if (!hasMore || !nextCursor || isLoadingMore) return;
    try {
      setIsLoadingMore(true);
      const response = await api.get<Notification[] | { data: Notification[]; meta?: { cursor?: string | null; has_more?: boolean } }>(`/v2/notifications/grouped?per_page=50&cursor=${encodeURIComponent(nextCursor)}`);
      if (response.success && response.data) {
        if (Array.isArray(response.data)) {
          setNotifications((prev) => [...prev, ...response.data as Notification[]]);
          setHasMore(false);
          setNextCursor(null);
        } else {
          const paged = response.data as { data: Notification[]; meta?: { cursor?: string | null; has_more?: boolean } };
          setNotifications((prev) => [...prev, ...(paged.data ?? [])]);
          setHasMore(paged.meta?.has_more ?? false);
          setNextCursor(paged.meta?.cursor ?? null);
        }
      } else {
        toastRef.current.error(tRef.current('error_load'));
      }
    } catch (error) {
      logError('Failed to load more notifications', error);
      toastRef.current.error(tRef.current('error_load'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, nextCursor, isLoadingMore]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Consume live notifications from the canonical shared user channel.
  useEffect(() => {
    if (!onNotification) return;

    const handleNewNotification = (data: Notification) => {
      setNotifications((prev) => {
        // Avoid duplicates
        if (prev.some((n) => n.id === data.id)) return prev;
        return [data, ...prev];
      });
      refreshCounts();
    };

    return onNotification(handleNewNotification);
  }, [onNotification, refreshCounts]);

  async function markAsRead(id: number) {
    // The context performs the API call + updates the bell badge, and resolves
    // false (it never throws) when the server rejects the change. Gate the
    // optimistic list update on that confirmed result instead of assuming success
    // — otherwise a failed request still marked the row read while the badge and
    // the server disagreed.
    const ok = await contextMarkAsRead(id);
    if (!ok) {
      toastRef.current.error(tRef.current('toast.mark_read_failed'));
      return;
    }
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
  }

  async function markAllAsRead() {
    const ok = await contextMarkAllAsRead();
    if (!ok) {
      // Without this, a failed request still showed a "marked all read" success
      // toast and visually cleared every row.
      toastRef.current.error(tRef.current('toast.mark_all_failed'));
      return;
    }
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() }))
    );
    toastRef.current.success(tRef.current('toast.all_read'));
  }

  async function markGroupAsRead(notification: Notification) {
    if (!notification.group_key) return;
    try {
      const response = await api.post('/v2/notifications/group/read', {
        group_key: notification.group_key,
      });
      if (response.success) {
        setNotifications((prev) =>
          prev.map((n) =>
            n.group_key === notification.group_key
              ? { ...n, read_at: new Date().toISOString() }
              : n
          )
        );
        refreshCounts();
      } else {
        toastRef.current.error(response.error || tRef.current('toast.mark_read_failed'));
      }
    } catch (error) {
      logError('Failed to mark group as read', error);
      toastRef.current.error(tRef.current('toast.mark_read_failed'));
    }
  }

  async function deleteNotification(id: number) {
    const notificationIndex = notifications.findIndex((n) => n.id === id);
    const notification = notifications[notificationIndex];
    if (!notification) return;

    // Optimistically remove from UI
    setNotifications((prev) => prev.filter((n) => n.id !== id));

    let undone = false;

    // Show undo info toast — user can click "Undo" before the timeout
    const undoTimeout = setTimeout(async () => {
      if (undone) return;
      try {
        const response = await api.delete(`/v2/notifications/${id}`);
        if (response.success) {
          if (!notification.read_at) {
            refreshCounts();
          }
        } else {
          // Restore if delete actually failed
          setNotifications((prev) => {
            const updated = [...prev];
            updated.splice(notificationIndex, 0, notification);
            return updated;
          });
          toastRef.current.error(response.error || tRef.current('toast.delete_failed'));
        }
      } catch (error) {
        logError('Failed to delete notification', error);
        // Restore if delete actually failed
        setNotifications((prev) => {
          const updated = [...prev];
          updated.splice(notificationIndex, 0, notification);
          return updated;
        });
        toastRef.current.error(tRef.current('toast.delete_failed'));
      }
    }, 4000);

    toastRef.current.info(
      tRef.current('toast.deleted'),
      tRef.current('toast.undo_hint'),
    );

    // Expose undo mechanism via a module-level ref so the toast button can call it
    // Since ToastContext doesn't support action buttons, we store the undo callback
    // and expose it via the page-level state so the user sees a separate "Undo" button
    setLastDeletedNotification({ notification, index: notificationIndex, timeout: undoTimeout, undone: () => { undone = true; } });
  }

  // Undo state for last deleted notification
  const [lastDeletedNotification, setLastDeletedNotification] = useState<{
    notification: Notification;
    index: number;
    timeout: ReturnType<typeof setTimeout>;
    undone: () => void;
  } | null>(null);

  function handleUndoDelete() {
    if (!lastDeletedNotification) return;
    clearTimeout(lastDeletedNotification.timeout);
    lastDeletedNotification.undone();
    // Re-insert at original position
    setNotifications((prev) => {
      const updated = [...prev];
      updated.splice(lastDeletedNotification.index, 0, lastDeletedNotification.notification);
      return updated;
    });
    setLastDeletedNotification(null);
  }

  const filteredNotifications = notifications.filter((n) =>
    filter === 'all' ? true : !n.read_at
  );

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* Header */}
      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <Chip size="sm" variant="flat" color={unreadCount > 0 ? 'primary' : 'success'} className="mb-3 font-medium">
              {unreadCount > 0 ? t('unread_badge', { count: unreadCount }) : t('caught_up_badge')}
            </Chip>
            <h1 className="flex items-center gap-3 text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">
              <Bell className="h-8 w-8 text-accent" aria-hidden="true" />
              {t('title')}
            </h1>
            <p className="mt-2 text-sm leading-6 text-theme-muted sm:text-base">{t('subtitle')}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-stretch">
            {unreadCount > 0 && (
              <Button
                variant="flat"
                size="sm"
                className="bg-theme-elevated text-theme-primary"
                startContent={<CheckCheck className="w-4 h-4" aria-hidden="true" />}
                onPress={markAllAsRead}
              >
                {t('mark_all_read')}
              </Button>
            )}
            <Button
              as={Link}
              to={tenantPath('/settings')}
              variant="flat"
              size="sm"
              aria-label={t('settings_aria')}
              className="w-full bg-theme-elevated text-theme-primary"
              startContent={<Settings className="w-4 h-4" aria-hidden="true" />}
            >
              {t('settings_label')}
            </Button>
          </div>
        </div>
      </header>

      {/* Filter — single-select ToggleButtonGroup */}
      <ToggleButtonGroup
        aria-label={t('filter_all')}
        selectionMode="single"
        disallowEmptySelection
        size="sm"
        selectedKeys={new Set([filter])}
        onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setFilter(k as 'all' | 'unread'); }}
        className="flex gap-2 rounded-2xl border border-theme-default bg-theme-surface p-2"
      >
        <ToggleButton
          id="all"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-theme-hover data-[selected=true]:text-theme-primary"
        >
          {t('filter_all')}
        </ToggleButton>
        <ToggleButton
          id="unread"
          variant="ghost"
          className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-theme-hover data-[selected=true]:text-theme-primary"
        >
          {t('filter_unread', { count: unreadCount })}
        </ToggleButton>
      </ToggleButtonGroup>

      {/* Undo delete banner — always present in DOM so screen readers hear it when it appears */}
      <div role="status" aria-live="polite" aria-atomic="true">
        {lastDeletedNotification && (
          <div className="flex items-center justify-between p-3 rounded-xl bg-theme-elevated border border-theme-default text-sm">
            <span className="text-theme-muted">{t('toast.deleted')}</span>
            <Button
              size="sm"
              variant="flat"
              className="bg-accent/10 text-accent dark:text-accent"
              onPress={handleUndoDelete}
            >
              {t('undo')}
            </Button>
          </div>
        )}
      </div>

      {/* Load Error */}
      {loadError && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <Bell className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4 opacity-50" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('error_title')}</h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            className="bg-linear-to-r from-accent to-accent-gradient-end text-white"
            onPress={loadNotifications}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Notifications List */}
      {!loadError && isLoading ? (
        <div role="status" aria-label={t('loading_aria')} aria-busy="true" className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <GlassCard key={i} className="p-4">
              <div className="flex items-start gap-4">
                <Skeleton className="rounded-full flex-shrink-0"><div className="w-10 h-10 rounded-full bg-surface-tertiary" /></Skeleton>
                <div className="flex-1 space-y-2">
                  <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-2/3" /></Skeleton>
                  <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : filteredNotifications.length === 0 ? (
        <EmptyState
          icon={<Bell className="w-12 h-12" />}
          title={filter === 'unread' ? t('empty_caught_up') : t('empty_title')}
          description={filter === 'unread' ? t('empty_caught_up_desc') : t('empty_desc')}
        />
      ) : (
        <>
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {filteredNotifications.map((notification) => (
              <motion.div key={notification.id} variants={itemVariants}>
                <NotificationCard
                  notification={notification}
                  onMarkRead={() => notification.is_grouped && notification.group_key
                    ? markGroupAsRead(notification)
                    : markAsRead(notification.id)}
                  onDelete={() => deleteNotification(notification.id)}
                />
              </motion.div>
            ))}
          </motion.div>
          {hasMore && filter === 'all' && (
            <div className="flex justify-center pt-2">
              <Button
                variant="flat"
                size="sm"
                className="bg-theme-elevated text-theme-primary"
                onPress={loadMoreNotifications}
                isLoading={isLoadingMore}
              >
                {t('load_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface NotificationCardProps {
  notification: Notification;
  onMarkRead: () => void;
  onDelete: () => void;
}

const iconMap: Record<string, { icon: React.ReactNode; color: string }> = {
  message: { icon: <MessageSquare className="w-5 h-5" aria-hidden="true" />, color: 'indigo' },
  listing: { icon: <ListTodo className="w-5 h-5" aria-hidden="true" />, color: 'emerald' },
  transaction: { icon: <Wallet className="w-5 h-5" aria-hidden="true" />, color: 'amber' },
  connection: { icon: <User className="w-5 h-5" aria-hidden="true" />, color: 'purple' },
  event: { icon: <Calendar className="w-5 h-5" aria-hidden="true" />, color: 'rose' },
  group: { icon: <Users className="w-5 h-5" aria-hidden="true" />, color: 'teal' },
  achievement: { icon: <Award className="w-5 h-5" aria-hidden="true" />, color: 'orange' },
  safeguarding_flag: { icon: <ShieldAlert className="w-5 h-5" aria-hidden="true" />, color: 'red' },
  safeguarding_assignment: { icon: <Shield className="w-5 h-5" aria-hidden="true" />, color: 'blue' },
  broker_review: { icon: <Eye className="w-5 h-5" aria-hidden="true" />, color: 'amber' },
  group_exchange: { icon: <ArrowLeftRight className="w-5 h-5" aria-hidden="true" />, color: 'indigo' },
};

const colorClasses: Record<string, string> = {
  indigo: 'bg-accent/20 text-accent dark:text-accent',
  emerald: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  purple: 'bg-accent/20 text-accent dark:text-accent',
  rose: 'bg-rose-500/20 text-rose-600 dark:text-rose-400',
  teal: 'bg-teal-500/20 text-teal-600 dark:text-teal-400',
  orange: 'bg-orange-500/20 text-orange-600 dark:text-orange-400',
  red: 'bg-red-500/20 text-red-600 dark:text-red-400',
  blue: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  gray: 'bg-theme-elevated text-theme-muted',
};

const NotificationCard = memo(function NotificationCard({ notification, onMarkRead, onDelete }: NotificationCardProps) {
  const { t } = useTranslation('notifications');
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const [isExpanded, setIsExpanded] = useState(false);
  const isUnread = !notification.read_at;
  const hasLink = !!notification.link;
  const isGrouped = notification.is_grouped && (notification.group_count ?? 0) > 1;
  /*
    🔴 What "expand" actually reveals — and whether there is anything at all.

    This page offered the expand toggle for ANY grouped notification and then rendered only
    the actor avatars, so a group whose notifications carry no actor (an achievement, a
    wallet movement, a listing expiry — most types) expanded to nothing: the chevron turned
    over and not one pixel else changed. Reported against the mobile app on 2026-09-06 and
    reproduced there; this client had the identical defect. The API now sends the group's
    own notifications, so there is something real to show.
  */
  const groupItems = notification.group_items ?? [];
  const groupActors = notification.actors ?? [];
  const canExpand = isGrouped && (groupItems.length > 0 || groupActors.length > 0);

  function handleClick() {
    if (!notification.link) return;
    // Mark as read when navigating
    if (isUnread) onMarkRead();
    // The link from the API is a relative path like "/messages/123" — scope it to the tenant
    navigate(tenantPath(notification.link));
  }

  const { icon, color } = iconMap[notification.type] || { icon: <Bell className="w-5 h-5" aria-hidden="true" />, color: 'gray' };

  return (
    <GlassCard className={`p-4 ${isUnread ? 'ring-1 ring-accent/30' : ''} ${hasLink ? 'hover:bg-theme-hover/50 transition-colors' : ''}`}>
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          className={`flex items-start gap-3 sm:gap-4 flex-1 min-w-0 ${hasLink ? 'cursor-pointer' : ''}`}
          onClick={handleClick}
          role={hasLink ? 'link' : undefined}
          tabIndex={hasLink ? 0 : undefined}
          onKeyDown={hasLink ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } } : undefined}
        >
          {/* Grouped: show stacked avatars; Single: show icon */}
          {isGrouped && notification.actors && notification.actors.length > 1 ? (
            <div className="flex-shrink-0">
              <AvatarGroup max={3} size="sm">
                {notification.actors.map((actor) => (
                  <Avatar
                    key={actor.id}
                    name={actor.name}
                    src={resolveAvatarUrl(actor.avatar_url)}
                    size="sm"
                    className="w-8 h-8"
                  />
                ))}
              </AvatarGroup>
            </div>
          ) : (
            <div className={`p-2.5 rounded-full flex-shrink-0 ${colorClasses[color]}`}>
              {icon}
            </div>
          )}

          <div className="flex-1 min-w-0">
            <p className={`${isUnread ? 'text-theme-primary font-medium' : 'text-theme-muted'}`}>
              {getNotificationDisplayText(notification)}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-theme-subtle">
                {formatRelativeTime(notification.latest_at || notification.created_at)}
              </p>
              {isGrouped && (
                <span className="text-[10px] text-theme-subtle bg-theme-elevated px-1.5 py-0.5 rounded-full">
                  {notification.group_count} {t('notifications_count')}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {canExpand && (
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              className="bg-theme-elevated text-theme-muted hover:text-theme-primary"
              onPress={() => setIsExpanded(!isExpanded)}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? t('collapse_group') : t('expand_group')}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </Button>
          )}
          {isUnread && (
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              className="bg-theme-elevated text-theme-muted hover:text-theme-primary"
              onPress={onMarkRead}
              aria-label={isGrouped ? t('mark_group_read_aria') : t('mark_read_aria')}
            >
              <Check className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
          {!isGrouped && (
            <Button
              isIconOnly
              variant="flat"
              size="sm"
              className="bg-theme-elevated text-theme-muted hover:text-[var(--color-error)] dark:hover:text-red-400"
              onPress={onDelete}
              aria-label={t('delete_aria')}
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded group: the notifications it is made of, or its actors when that is all there is. */}
      <AnimatePresence>
        {canExpand && isExpanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 pt-3 border-t border-[var(--border-default)] space-y-2 overflow-hidden"
          >
            {groupItems.length > 0
              ? groupItems.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2.5 p-1.5 rounded-lg">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] flex-shrink-0" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm text-theme-primary">
                      {entry.title && entry.title !== notification.title
                        ? `${entry.title} — ${entry.message}`
                        : entry.message}
                    </p>
                  </div>
                </div>
              ))
              : groupActors.map((actor) => (
              <Link
                key={actor.id}
                to={tenantPath(`/profile/${actor.id}`)}
                className="flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-theme-hover transition-colors"
              >
                <Avatar
                  name={actor.name}
                  src={resolveAvatarUrl(actor.avatar_url)}
                  size="sm"
                  className="w-7 h-7"
                />
                <span className="text-sm text-theme-secondary">{actor.name}</span>
              </Link>
            ))}
            {(notification.remaining_count ?? 0) > 0 && (
              <p className="text-xs text-theme-subtle pl-10">
                {t('and_others', { count: notification.remaining_count })}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
});

export default NotificationsPage;
