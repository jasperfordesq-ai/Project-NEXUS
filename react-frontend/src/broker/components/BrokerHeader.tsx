// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Header Bar
 * Back-to-site, tenant name, search, help, notifications (count + drawer),
 * theme toggle and the user menu.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useNotifications, useTenant, useTheme } from '@/contexts';
import { hasAdminPanelAccess } from '@/lib/access';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Bell from 'lucide-react/icons/bell';
import HelpCircle from 'lucide-react/icons/circle-help';
import Keyboard from 'lucide-react/icons/keyboard';
import Moon from 'lucide-react/icons/moon';
import Search from 'lucide-react/icons/search';
import Settings from 'lucide-react/icons/settings';
import LogOut from 'lucide-react/icons/log-out';
import Menu from 'lucide-react/icons/menu';
import Sun from 'lucide-react/icons/sun';
import User from 'lucide-react/icons/user';
import { resolveAvatarUrl } from '@/lib/helpers';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Avatar, Badge } from '@/components/ui';
import { BrokerNotificationsDrawer } from './BrokerNotificationsDrawer';
import { SearchShortcutKeys } from './BrokerShortcutsModal';

interface BrokerHeaderProps {
  sidebarCollapsed: boolean;
  onSidebarToggle?: () => void;
  /** Opens the ⌘K / Ctrl+K command palette. */
  onOpenSearch?: () => void;
  /** Opens the keyboard shortcuts list (BrokerLayout owns the modal). */
  onOpenShortcuts?: () => void;
}

export function BrokerHeader({ sidebarCollapsed, onSidebarToggle, onOpenSearch, onOpenShortcuts }: BrokerHeaderProps) {
  const { t } = useTranslation('broker');
  const { user, logout } = useAuth();
  const { tenantPath, tenant, hasModule } = useTenant();
  const { resolvedTheme, toggleTheme } = useTheme();
  const { unreadCount } = useNotifications();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const showNotifications = hasModule('notifications');
  const canOpenAdmin = hasAdminPanelAccess(user);
  const isDark = resolvedTheme === 'dark';
  const unreadLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <header
      className={`fixed top-0 right-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-divider bg-surface/95 backdrop-blur px-3 sm:px-6 transition-all duration-300 left-0 ${
        sidebarCollapsed ? 'md:left-16' : 'md:left-64'
      }`}
    >
      {/* Left: Mobile menu + Back to frontend + tenant name */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {onSidebarToggle && (
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            onPress={onSidebarToggle}
            className="text-muted md:hidden"
            aria-label={t('header.toggle_sidebar')}
          >
            <Menu size={20} />
          </Button>
        )}
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath(hasModule('dashboard') ? '/dashboard' : '/'))}
          startContent={<ArrowLeft size={16} />}
          className="min-w-0 px-2 text-muted sm:px-3"
        >
          <span className="hidden sm:inline">{t('header.back_to_site')}</span>
        </Button>
        {tenant?.name && (
          <span className="min-w-0 max-w-[9rem] truncate text-sm font-medium text-muted sm:max-w-[18rem]">
            {tenant.name}
          </span>
        )}
      </div>

      {/* Right: Search + help + notifications + theme + user menu */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {onOpenSearch && (
          <>
            {/* Wide screens get an affordance with the shortcut hint… */}
            <button
              type="button"
              onClick={onOpenSearch}
              className="hidden items-center gap-2 rounded-xl border border-divider bg-surface-secondary px-3 py-1.5 text-sm text-muted transition-colors hover:border-divider hover:text-foreground motion-reduce:transition-none lg:flex"
            >
              <Search size={14} aria-hidden="true" />
              <span>{t('header.search')}</span>
              <span className="ml-1"><SearchShortcutKeys /></span>
            </button>
            {/* …small screens get an icon button. */}
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={onOpenSearch}
              aria-label={t('header.search')}
              className="lg:hidden"
            >
              <Search size={18} />
            </Button>
          </>
        )}
        <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath('/broker/help'))}
          aria-label={t('header.help')}
          className="hidden sm:inline-flex"
        >
          <HelpCircle size={18} />
        </Button>
        {showNotifications && (
          <Badge
            content={unreadCount > 0 ? unreadLabel : undefined}
            color="danger"
            size="sm"
            placement="top-right"
            isInvisible={unreadCount === 0}
            className="min-w-5 font-semibold tabular-nums"
          >
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={() => setNotificationsOpen(true)}
              aria-label={
                unreadCount > 0
                  ? t('header.notifications_with_count', { count: unreadCount })
                  : t('header.notifications')
              }
            >
              <Bell size={18} />
            </Button>
          </Badge>
        )}
        <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={() => void toggleTheme()}
          aria-label={isDark ? t('header.switch_to_light') : t('header.switch_to_dark')}
        >
          {isDark ? <Sun size={18} className="text-warning" /> : <Moon size={18} />}
        </Button>

        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button variant="tertiary" size="sm" className="min-w-0 gap-2 px-2">
              <Avatar
                src={resolveAvatarUrl(user?.avatar_url || user?.avatar) || undefined}
                name={user?.name || t('header.user_fallback')}
                size="sm"
                className="h-8 w-8"
              />
              <span className="hidden max-w-[10rem] truncate text-sm font-medium text-foreground sm:block">
                {user?.name || t('header.user_fallback')}
              </span>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('header.user_menu')}
            onAction={(key) => {
              if (key === 'profile') navigate(tenantPath('/profile'));
              if (key === 'admin') navigate(tenantPath('/admin'));
              if (key === 'shortcuts') onOpenShortcuts?.();
              if (key === 'logout') logout();
            }}
          >
            {hasModule('profile') ? <DropdownItem key="profile" id="profile" startContent={<User size={16} />}>
              {t('header.my_profile')}
            </DropdownItem> : null}
            {canOpenAdmin ? <DropdownItem key="admin" id="admin" startContent={<Settings size={16} />}>
              {t('header.admin_panel')}
            </DropdownItem> : null}
            {onOpenShortcuts ? <DropdownItem key="shortcuts" id="shortcuts" startContent={<Keyboard size={16} />}>
              {t('header.keyboard_shortcuts')}
            </DropdownItem> : null}
            <DropdownItem
              key="logout" id="logout"
              startContent={<LogOut size={16} />}
              className="text-danger"
              color="danger"
            >
              {t('header.sign_out')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>

      {showNotifications && (
        <BrokerNotificationsDrawer isOpen={notificationsOpen} onClose={() => setNotificationsOpen(false)} />
      )}
    </header>
  );
}

export default BrokerHeader;
