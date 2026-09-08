// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Header Bar
 * Top bar with breadcrumbs, search, and user menu
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Bell from 'lucide-react/icons/bell';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import LogOut from 'lucide-react/icons/log-out';
import Menu from 'lucide-react/icons/menu';
import User from 'lucide-react/icons/user';
import { resolveAvatarUrl } from '@/lib/helpers';
import { adminSupportReports } from '@/admin/api/adminApi';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
interface AdminHeaderProps {
  sidebarCollapsed: boolean;
  onSidebarToggle?: () => void;
}

function scheduleSupportStatsFetch(callback: () => void): () => void {
  let cancelled = false;
  let timeoutId: number | undefined;
  let secondFrameId: number | undefined;
  let idleId: number | undefined;
  const idleWindow = window as Window & {
    requestIdleCallback?: (idleCallback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  const firstFrameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      if (typeof idleWindow.requestIdleCallback === 'function') {
        idleId = idleWindow.requestIdleCallback(() => {
          if (!cancelled) callback();
        }, { timeout: 3000 });
        return;
      }
      timeoutId = window.setTimeout(() => {
        if (!cancelled) callback();
      }, 1500);
    });
  });

  return () => {
    cancelled = true;
    if (firstFrameId !== undefined) window.cancelAnimationFrame(firstFrameId);
    if (secondFrameId !== undefined) window.cancelAnimationFrame(secondFrameId);
    if (idleId !== undefined) idleWindow.cancelIdleCallback?.(idleId);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  };
}

export function AdminHeader({ sidebarCollapsed, onSidebarToggle }: AdminHeaderProps) {
  const { t } = useTranslation('admin_nav');
  const { user, logout } = useAuth();
  const { tenantPath, tenant, hasModule } = useTenant();
  const navigate = useNavigate();
  const adminLabel = t('admin');

  // Open support-request count for the header indicator. Best-effort and
  // deferred so it does not compete with the first admin page render. If the
  // stats endpoint is unavailable for this admin, the badge simply stays hidden.
  const [openSupportCount, setOpenSupportCount] = useState(0);

  useEffect(() => {
    let active = true;
    const cancelScheduledFetch = scheduleSupportStatsFetch(() => {
      adminSupportReports
        .stats()
        .then((response) => {
          if (active && response?.success && response.data) {
            setOpenSupportCount(response.data.open ?? 0);
          }
        })
        .catch(() => {
          /* indicator is non-critical — ignore failures */
        });
    });
    return () => {
      active = false;
      cancelScheduledFetch();
    };
  }, []);

  return (
    <header
      className={`fixed top-0 right-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-divider/70 bg-[var(--surface-solid)] px-3 shadow-sm shadow-black/[0.06] ring-1 ring-white/60 sm:px-6 transition-all duration-300 left-0 dark:ring-white/5 ${
        sidebarCollapsed ? 'md:left-16' : 'md:left-64'
      }`}
    >
      {/* Left: Mobile menu + Back to frontend + tenant name */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {/* Mobile hamburger */}
        {onSidebarToggle && (
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            onPress={onSidebarToggle}
            className="text-muted md:hidden"
            aria-label={t('toggle_sidebar')}
          >
            <Menu size={20} />
          </Button>
        )}
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath(hasModule('dashboard') ? '/dashboard' : '/'))}
          startContent={<ArrowLeft size={16} aria-hidden="true" />}
          aria-label={t('back_to_site')}
          className="min-w-0 bg-surface-secondary/70 px-2 text-muted hover:bg-surface-tertiary/70 sm:px-3"
        >
          <span className="hidden sm:inline" aria-hidden="true">{t('back_to_site_header')}</span>
        </Button>
        {tenant?.name && (
          <span className="min-w-0 max-w-[9rem] truncate text-sm font-medium text-muted sm:max-w-[18rem]">
            {tenant.name}
          </span>
        )}
      </div>

      {/* Right: User menu */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath('/admin/support-reports'))}
          aria-label={
            openSupportCount > 0
              ? t('support_requests_count', { count: openSupportCount })
              : t('support_requests')
          }
          className="relative bg-surface-secondary/70 text-muted hover:bg-surface-tertiary/70"
        >
          <LifeBuoy size={18} />
          {openSupportCount > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
              aria-hidden="true"
            >
              {openSupportCount > 99 ? '99+' : openSupportCount}
            </span>
          )}
        </Button>

        {hasModule('notifications') && <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath('/notifications'))}
          aria-label={t('notifications')}
          className="bg-surface-secondary/70 text-muted hover:bg-surface-tertiary/70"
        >
          <Bell size={18} />
        </Button>}

        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button variant="tertiary" className="flex min-h-10 min-w-0 items-center gap-2 bg-surface-secondary/70 px-2 py-1 hover:bg-surface-tertiary/70">
              <Avatar
                src={resolveAvatarUrl(user?.avatar_url || user?.avatar) || undefined}
                name={user?.name || adminLabel}
                size="sm"
                className="h-8 w-8 ring-2 ring-surface"
              />
              <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground sm:block">
                {user?.name || adminLabel}
              </span>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('admin_menu')}
            onAction={(key) => {
              if (key === 'profile') navigate(tenantPath('/profile'));
              if (key === 'logout') logout();
            }}
          >
            {hasModule('profile') ? <DropdownItem
              key="profile" id="profile"
              startContent={<User size={16} />}
            >
              {t('my_profile')}
            </DropdownItem> : null}
            <DropdownItem
              key="logout" id="logout"
              startContent={<LogOut size={16} />}
              className="text-danger"
            >
              {t('sign_out')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </header>
  );
}

export default AdminHeader;
