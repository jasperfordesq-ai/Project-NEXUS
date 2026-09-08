// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import Bell from 'lucide-react/icons/bell';
import LogOut from 'lucide-react/icons/log-out';
import Menu from 'lucide-react/icons/menu';
import User from 'lucide-react/icons/user';
import { resolveAvatarUrl } from '@/lib/helpers';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Avatar } from '@/components/ui';
interface CaringPanelHeaderProps {
  sidebarCollapsed: boolean;
  onSidebarToggle?: () => void;
}

export function CaringPanelHeader({ sidebarCollapsed, onSidebarToggle }: CaringPanelHeaderProps) {
  const { user, logout } = useAuth();
  const { tenantPath, tenant, hasModule } = useTenant();
  const navigate = useNavigate();
  const { t } = useTranslation('caring_community');

  return (
    <header
      className={`fixed top-0 right-0 z-30 flex h-16 items-center justify-between border-b border-divider bg-surface/95 backdrop-blur px-3 sm:px-6 transition-all duration-300 left-0 ${
        sidebarCollapsed ? 'md:left-16' : 'md:left-64'
      }`}
    >
      {/* Left: Mobile menu + Back to site + tenant name */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-4">
        {onSidebarToggle && (
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            onPress={onSidebarToggle}
            className="text-muted md:hidden"
            aria-label={t('panel.header.toggle_sidebar')}
          >
            <Menu size={20} />
          </Button>
        )}
        <Button
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath(hasModule('dashboard') ? '/dashboard' : '/'))}
          startContent={<ArrowLeft size={16} />}
          className="text-muted"
          aria-label={t('panel.header.back_to_site')}
        >
          <span className="hidden sm:inline">{t('panel.header.back_to_site')}</span>
        </Button>
        {tenant?.name && (
          <span className="hidden max-w-[14rem] truncate text-sm font-medium text-muted sm:inline md:max-w-[20rem]">
            {tenant.name}
          </span>
        )}
      </div>

      {/* Right: User menu */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {hasModule('notifications') && <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={() => navigate(tenantPath('/notifications'))}
          aria-label={t('panel.header.notifications')}
        >
          <Bell size={18} />
        </Button>}

        <Dropdown placement="bottom-end">
          <DropdownTrigger>
            <Button
              variant="tertiary"
              size="sm"
              className="min-w-0 gap-2 px-2"
              aria-label={t('panel.header.user_menu')}
            >
              <Avatar
                src={resolveAvatarUrl(user?.avatar_url || user?.avatar) || undefined}
                name={user?.name || t('panel.header.user_fallback')}
                size="sm"
                className="h-8 w-8"
              />
              <span className="hidden text-sm font-medium text-foreground sm:block">
                {user?.name || t('panel.header.user_fallback')}
              </span>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('panel.header.user_menu')}
            onAction={(key) => {
              if (key === 'profile') navigate(tenantPath('/profile'));
              if (key === 'logout') logout();
            }}
          >
            {hasModule('profile') ? <DropdownItem key="profile" id="profile" startContent={<User size={16} />}>
              {t('panel.header.my_profile')}
            </DropdownItem> : null}
            <DropdownItem
              key="logout" id="logout"
              startContent={<LogOut size={16} />}
              className="text-danger"
              color="danger"
            >
              {t('panel.header.sign_out')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </header>
  );
}

export default CaringPanelHeader;
