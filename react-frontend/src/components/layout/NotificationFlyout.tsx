// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Notification Flyout Panel
 * Rich popover showing recent notifications without leaving the current page.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Popover, PopoverTrigger, PopoverContent, PopoverHeading } from '@/components/ui/Popover';
import Bell from 'lucide-react/icons/bell';
import MessageSquare from 'lucide-react/icons/message-square';
import ListTodo from 'lucide-react/icons/list-todo';
import Wallet from 'lucide-react/icons/wallet';
import User from 'lucide-react/icons/user';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Award from 'lucide-react/icons/award';
import CheckCheck from 'lucide-react/icons/check-check';
import ExternalLink from 'lucide-react/icons/external-link';
import Info from 'lucide-react/icons/info';
import X from 'lucide-react/icons/x';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useTranslation } from 'react-i18next';
import { useNotificationsOptional } from '@/contexts/NotificationsContext';
import { useTenant } from '@/contexts/TenantContext';
import { api } from '@/lib/api';
import { formatRelativeTime, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { getNotificationDisplayText } from '@/lib/notificationText';
import type { Notification } from '@/types/api';
import { Avatar, AvatarGroup } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Drawer, DrawerContent, DrawerHeader, DrawerBody } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';

const TYPE_ICONS: Record<string, typeof Bell> = {
  message: MessageSquare,
  listing: ListTodo,
  transaction: Wallet,
  connection: User,
  event: Calendar,
  group: Users,
  achievement: Award,
  system: Info,
};

const getIcon = (type: string) => {
  const Icon = TYPE_ICONS[type] || Bell;
  return <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />;
};

export function NotificationFlyout() {
  const { t } = useTranslation('notifications');
  const navigate = useNavigate();
  const { unreadCount, markAsRead, markAllAsRead } = useNotificationsOptional();
  const { tenantPath } = useTenant();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const fetchIdRef = useRef(0);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  // Always re-fetch when popover opens — ensures sync with page deletions/reads
  const fetchNotifications = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    try {
      setIsLoading(true);
      setLoadError(false);
      const response = await api.get<Notification[]>('/v2/notifications/grouped?per_page=8');
      // Only apply if this is still the latest fetch
      if (fetchId === fetchIdRef.current) {
        if (response.success && response.data) {
          setNotifications(response.data);
        } else {
          setLoadError(true);
        }
      }
    } catch (error) {
      logError('Failed to load notifications for flyout', error);
      if (fetchId === fetchIdRef.current) {
        setLoadError(true);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Re-fetch every time the popover opens
  useEffect(() => {
    if (isOpen) fetchNotifications();
  }, [isOpen, fetchNotifications]);

  const handleOpenChange = useCallback((open: boolean) => setIsOpen(open), []);

  const handleMarkAllRead = useCallback(async () => {
    await markAllAsRead();
    setNotifications(prev => prev.map(n => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
  }, [markAllAsRead]);

  const handleNotificationClick = useCallback((notification: Notification) => {
    setIsOpen(false);
    // Mark as read in context so bell badge updates
    if (!notification.read_at) {
      markAsRead(notification.id);
      setNotifications(prev => prev.map(n =>
        n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n
      ));
    }
    navigate(notification.link ? tenantPath(notification.link) : tenantPath('/notifications'));
  }, [navigate, tenantPath, markAsRead]);

  const handleViewAll = useCallback(() => {
    setIsOpen(false);
    navigate(tenantPath('/notifications'));
  }, [navigate, tenantPath]);

  /* ── Shared notification list content ────────────────────── */
  const notificationHeader = (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] bg-[var(--surface-solid)]">
      <h3 className="text-sm font-semibold text-theme-primary">
        {t('title')}
        {unreadCount > 0 && (
          <span className="ms-2 text-xs font-normal text-theme-subtle">
            ({unreadCount} {t('flyout.unread_count')})
          </span>
        )}
      </h3>
      <div className="flex items-center gap-1">
        {unreadCount > 0 && (
          <Button
            variant="light"
            size="sm"
            className="min-h-[44px] min-w-0 gap-1 px-2 text-sm text-accent dark:text-accent"
            onPress={handleMarkAllRead}
          >
            <CheckCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {t('mark_all_read')}
          </Button>
        )}
        {isMobile && (
          <Button
            isIconOnly
            variant="light"
            size="sm"
            className="min-h-[44px] min-w-[44px] text-theme-muted hover:text-theme-primary"
            onPress={() => setIsOpen(false)}
            aria-label={t('flyout.close')}
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );

  const notificationBody = (
    <>
      {isLoading ? (
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="p-4 space-y-3 bg-[var(--surface-solid)]">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4 rounded" />
                <Skeleton className="h-3 w-1/2 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="py-8 text-center bg-[var(--surface-solid)]">
          <Bell className="w-8 h-8 mx-auto text-theme-subtle mb-2 opacity-40" />
          <p className="text-sm text-theme-subtle">{t('error_load')}</p>
        </div>
      ) : notifications.length === 0 ? (
        <div className="py-8 text-center bg-[var(--surface-solid)]">
          <Bell className="w-8 h-8 mx-auto text-theme-subtle mb-2 opacity-40" />
          <p className="text-sm text-theme-subtle">{t('flyout.empty')}</p>
        </div>
      ) : (
        <div className="py-1 bg-[var(--surface-solid)]">
          {notifications.map(notification => {
            const isUnread = !notification.read_at;
            const isGrouped = notification.is_grouped && (notification.group_count ?? 0) > 1;
            return (
              <Button
                key={notification.id}
                variant="light"
                onPress={() => handleNotificationClick(notification)}
                className={`w-full flex items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-theme-hover h-auto min-h-14 justify-start rounded-none ${
                  isUnread ? 'bg-accent/50 dark:bg-accent/5' : ''
                }`}
              >
                {isGrouped && notification.actors && notification.actors.length > 1 ? (
                  <div className="mt-0.5 shrink-0">
                    <AvatarGroup max={3} size="sm" className="justify-start">
                      {notification.actors.map((actor) => (
                        <Avatar
                          key={actor.id}
                          name={actor.name}
                          src={resolveAvatarUrl(actor.avatar_url)}
                          size="sm"
                          className="w-6 h-6"
                        />
                      ))}
                    </AvatarGroup>
                  </div>
                ) : (
                  <div className={`mt-0.5 p-1.5 rounded-full shrink-0 ${
                    isUnread
                      ? 'bg-accent-soft dark:bg-accent/20 text-accent dark:text-accent'
                      : 'bg-[var(--surface-elevated)] text-theme-subtle'
                  }`}>
                    {getIcon(notification.type)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug whitespace-normal break-words line-clamp-2 ${isUnread ? 'font-medium text-theme-primary' : 'text-theme-secondary'}`}>
                    {getNotificationDisplayText(notification)}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-theme-subtle">
                      {formatRelativeTime(notification.latest_at || notification.created_at)}
                    </p>
                    {isGrouped && (
                      <span className="text-[10px] text-theme-subtle bg-[var(--surface-elevated)] px-1.5 py-0.5 rounded-full">
                        {notification.group_count}
                      </span>
                    )}
                  </div>
                </div>
                {isUnread && (
                  <span className="w-2 h-2 mt-2 rounded-full bg-accent shrink-0" aria-label={t('flyout.unread_dot_aria')} />
                )}
              </Button>
            );
          })}
        </div>
      )}
    </>
  );

  const notificationFooter = (
    <div className="border-t border-[var(--border-default)] px-4 py-2.5 bg-[var(--surface-solid)]">
      <Button
        variant="light"
        fullWidth
        size="sm"
        className="min-h-[44px] gap-1.5 text-sm text-accent dark:text-accent"
        onPress={handleViewAll}
      >
        {t('flyout.view_all')}
        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
      </Button>
    </div>
  );

  /* ── Bell trigger button (shared) ────────────────────────── */
  const bellButton = (
    <Button
      isIconOnly
      variant="light"
      size="sm"
      className={`relative text-theme-muted hover:text-theme-primary ${unreadCount > 0 ? 'text-accent dark:text-accent' : ''}`}
      aria-label={unreadCount > 0 ? t('flyout.bell_unread_aria', { count: unreadCount }) : t('flyout.bell_aria')}
      {...(isMobile ? { onPress: () => setIsOpen(true) } : {})}
    >
      <Bell className="w-4 h-4 sm:w-5 sm:h-5" aria-hidden="true" />
      {unreadCount > 0 && (
        // Structural hook for the E2E suite. This dot is the ONLY unread
        // indicator: it has no text, no icon and no aria of its own (the count
        // is announced by the button's aria-label), so there was nothing a test
        // could hold on to. It renders only while unreadCount > 0, so its
        // absence is a meaningful assertion too.
        <span data-notification-badge="" className="absolute top-0.5 right-0.5 w-2 h-2 bg-danger rounded-full" />
      )}
    </Button>
  );

  /* ── Mobile: full-screen bottom drawer ───────────────────── */
  if (isMobile) {
    return (
      <>
        {bellButton}
        <Drawer
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          placement="bottom"
          hideCloseButton
          classNames={{
            wrapper: 'z-[400]',
            base: 'bg-[var(--surface-solid)] rounded-t-2xl max-h-[85vh] shadow-2xl border border-[var(--border-default)]',
            header: 'p-0',
            body: 'p-0',
          }}
        >
          <DrawerContent aria-label={t('title')} className="pb-[env(safe-area-inset-bottom,0px)]">
            <DrawerHeader>
              {/* Drag handle */}
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1 rounded-full bg-[var(--border-default)]" />
              </div>
              {notificationHeader}
            </DrawerHeader>
            <DrawerBody>
              <div className="overflow-y-auto flex-1">
                {notificationBody}
              </div>
              {notificationFooter}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </>
    );
  }

  /* ── Desktop: popover (existing behavior) ────────────────── */
  return (
    <Popover
      placement="bottom-end"
      isOpen={isOpen}
      onOpenChange={handleOpenChange}
      shouldBlockScroll={false}
      backdrop="transparent"
      offset={8}
    >
      <PopoverTrigger>
        {bellButton}
      </PopoverTrigger>
      <PopoverContent className="p-0 overflow-hidden isolate bg-[var(--surface-solid)] border border-[var(--border-default)] shadow-2xl rounded-xl w-[360px] max-w-[90vw]">
        <PopoverHeading className="sr-only">{t('title')}</PopoverHeading>
        {notificationHeader}
        <div className="max-h-[400px] overflow-y-auto bg-[var(--surface-solid)]">
          {notificationBody}
        </div>
        {notificationFooter}
      </PopoverContent>
    </Popover>
  );
}

export default NotificationFlyout;
