// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BrokerNotificationsDrawer — the header bell's drawer.
 *
 * Until October 2026 the bell sent a broker out of the panel to the member
 * notifications page. This keeps them in the panel: the latest fifteen
 * notifications, each with how long ago it arrived, "Mark all as read" while
 * anything is unread, and a link to the full page for the rest.
 *
 * The list is fetched each time the drawer opens (the context only carries
 * counts), with a request id so a slow earlier response never overwrites a
 * newer one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Bell from 'lucide-react/icons/bell';
import CheckCheck from 'lucide-react/icons/check-check';
import ExternalLink from 'lucide-react/icons/external-link';
import { Button, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, Skeleton } from '@/components/ui';
import { useNotifications, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatRelativeTime } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { isNavigationPathEnabled } from '@/components/navigation/navigationRegistry';
import type { Notification } from '@/types/api';

/** How many to show before pointing at the full page. */
const DRAWER_LIMIT = 15;

interface BrokerNotificationsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

type DrawerNotification = Notification & { latest_at?: string | null };

export function BrokerNotificationsDrawer({ isOpen, onClose }: BrokerNotificationsDrawerProps) {
  const { t } = useTranslation('broker');
  const navigate = useNavigate();
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const { unreadCount, markAsRead, markAllAsRead } = useNotifications();

  const [items, setItems] = useState<DrawerNotification[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const fetchIdRef = useRef(0);

  const load = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await api.get<DrawerNotification[]>(`/v2/notifications/grouped?per_page=${DRAWER_LIMIT}`);
      if (fetchId !== fetchIdRef.current) return;
      if (response.success && Array.isArray(response.data)) {
        setItems(response.data.slice(0, DRAWER_LIMIT));
      } else {
        setLoadError(true);
      }
    } catch (error) {
      logError('Failed to load notifications for the broker drawer', error);
      if (fetchId === fetchIdRef.current) setLoadError(true);
    } finally {
      if (fetchId === fetchIdRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleMarkAll = useCallback(async () => {
    const ok = await markAllAsRead();
    if (ok) {
      const now = new Date().toISOString();
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || now })));
    }
  }, [markAllAsRead]);

  const open = useCallback((notification: DrawerNotification) => {
    if (!notification.read_at) {
      void markAsRead(notification.id);
      setItems((prev) => prev.map((n) => (n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n)));
    }
    const link =
      notification.link && isNavigationPathEnabled(notification.link, { hasFeature, hasModule }, tenantPath(''))
        ? notification.link
        : '/notifications';
    onClose();
    navigate(tenantPath(link));
  }, [markAsRead, hasFeature, hasModule, tenantPath, onClose, navigate]);

  return (
    <Drawer isOpen={isOpen} onClose={onClose} placement="right" size="sm" closeLabel={t('header.drawer_close')}>
      <DrawerContent aria-label={t('header.notifications')}>
        <DrawerHeader className="flex items-center justify-between gap-3 pr-12">
          <span className="flex items-center gap-2 text-base font-semibold text-foreground">
            <Bell size={18} className="text-accent" aria-hidden="true" />
            {t('header.notifications')}
          </span>
          {unreadCount > 0 && (
            <Button
              size="sm"
              variant="tertiary"
              onPress={() => void handleMarkAll()}
              startContent={<CheckCheck size={14} aria-hidden="true" />}
              className="text-accent"
            >
              {t('header.drawer_mark_all_read')}
            </Button>
          )}
        </DrawerHeader>

        <DrawerBody className="p-0">
          {isLoading && items.length === 0 ? (
            <div className="flex flex-col gap-3 p-4" aria-busy="true" aria-label={t('header.drawer_loading')}>
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-3/4 rounded-md" />
                  <Skeleton className="h-3 w-1/3 rounded-md" />
                </div>
              ))}
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-muted">
              <p>{t('header.drawer_error')}</p>
              <Button size="sm" variant="secondary" onPress={() => void load()}>
                {t('header.drawer_retry')}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted">
              <Bell size={28} className="text-muted/60" aria-hidden="true" />
              <p>{t('header.drawer_empty')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-divider">
              {items.map((notification) => {
                const unread = !notification.read_at;
                const detail = notification.message || notification.body;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => open(notification)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-secondary motion-reduce:transition-none ${
                        unread ? 'bg-accent/5' : ''
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-2 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-accent' : 'bg-transparent'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
                          {notification.title}
                        </span>
                        {detail && detail !== notification.title && (
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{detail}</span>
                        )}
                        <span className="mt-1 block text-xs text-muted/80">
                          {formatRelativeTime(notification.latest_at || notification.created_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DrawerBody>

        <DrawerFooter className="justify-center border-t border-divider">
          <Link
            to={tenantPath('/notifications')}
            onClick={onClose}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            {t('header.drawer_open_all')}
            <ExternalLink size={14} aria-hidden="true" />
          </Link>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

export default BrokerNotificationsDrawer;
