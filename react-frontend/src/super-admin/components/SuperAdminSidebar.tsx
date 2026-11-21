// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Sidebar
 * Navigation for the tools that work across a branch of communities.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { isPlatformTeamUser } from '@/lib/access';
import { isOnPanelPath } from '@/lib/panelPath';
import { ScrollShadow } from '@/components/ui';
import { Button, Tooltip } from '@/components/ui';
import Banknote from 'lucide-react/icons/banknote';
import Building2 from 'lucide-react/icons/building-2';
import Layers from 'lucide-react/icons/layers';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import ListChecks from 'lucide-react/icons/list-checks';
import Network from 'lucide-react/icons/network';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import ScrollText from 'lucide-react/icons/scroll-text';
import Users from 'lucide-react/icons/users';
import Settings from 'lucide-react/icons/settings';
import ShieldCheck from 'lucide-react/icons/shield-check';
import type { LucideIcon } from 'lucide-react';

interface SuperAdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  path: string;
}

interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}

export function SuperAdminSidebar({ collapsed, onToggle }: SuperAdminSidebarProps) {
  const { t } = useTranslation('super_admin');
  const location = useLocation();
  const { tenantPath } = useTenant();
  const { user } = useAuth();

  /*
   * 🔴 One tier. Everything in this menu is confined by the server to the
   * caller's own branch (their community and the communities below it), so a
   * global super admin and a tenant super admin see the SAME eight entries.
   *
   * The platform-wide pages that used to sit here behind a 'master' check
   * (pilot enquiries, the provisioning queue, the translation key, the
   * federation controls, platform billing and revenue, regional analytics
   * subscriptions, the national dashboard) moved to the Platform team panel on
   * 15 Nov 2026 (owner: "Yes, move it"). Do not add a platform-wide entry
   * here: it belongs in src/platform-team/components/PlatformTeamSidebar.tsx.
   */

  const sections: NavSection[] = [
    {
      key: 'overview',
      title: t('sidebar.section_overview'),
      items: [
        { key: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, path: '/super-admin' },
      ],
    },
    {
      key: 'tenants',
      title: t('sidebar.section_tenants'),
      items: [
        { key: 'tenants', label: t('nav.tenants'), icon: Building2, path: '/super-admin/tenants' },
        { key: 'hierarchy', label: t('nav.hierarchy'), icon: Network, path: '/super-admin/tenants/hierarchy' },
        { key: 'users', label: t('nav.users'), icon: Users, path: '/super-admin/users' },
        { key: 'bulk', label: t('nav.bulk_ops'), icon: ListChecks, path: '/super-admin/bulk' },
        { key: 'audit', label: t('nav.audit_log'), icon: ScrollText, path: '/super-admin/audit' },
        // The payment standing of the communities below the signed-in manager's own.
        { key: 'branch_payments', label: t('nav.branch_payments'), icon: Banknote, path: '/super-admin/branch-payments' },
        // The standard plans as the manager's hub offers them to the communities that pay it.
        { key: 'branch_plans', label: t('nav.branch_plans'), icon: Layers, path: '/super-admin/branch-plans' },
      ],
    },
  ];

  // useLocation() has no community slug inside the app's routes, while
  // tenantPath() adds one: isOnPanelPath() accepts both forms.
  const isActive = (path: string) =>
    isOnPanelPath(location.pathname, path, tenantPath, { exact: path === '/super-admin' });

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    const Icon = item.icon;
    const link = (
      <li key={item.key}>
        <Link
          to={tenantPath(item.path)}
          aria-current={active ? 'page' : undefined}
          className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            active
              ? 'bg-accent/10 text-accent-soft-foreground'
              : 'text-muted hover:bg-surface-secondary hover:text-foreground'
          } ${collapsed ? 'justify-center px-2' : ''}`}
        >
          <Icon size={20} className={active ? 'text-accent' : 'text-muted'} />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        </Link>
      </li>
    );

    return collapsed ? (
      <Tooltip key={item.key} content={item.label} placement="right">
        {link}
      </Tooltip>
    ) : (
      link
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-divider bg-surface transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath('/super-admin')} className="flex items-center gap-2">
            <Settings size={22} className="text-accent" />
            <span className="text-base font-semibold text-foreground">{t('nav.brand')}</span>
          </Link>
        )}
        <Button
          isIconOnly
          variant="tertiary"
          size="sm"
          onPress={onToggle}
          className="text-muted"
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
        </Button>
      </div>

      <ScrollShadow as="nav" aria-label={t('sidebar.nav_label')} className="min-h-0 flex-1 px-2 py-3" hideScrollBar>
        {sections.map((section, index) => (
          <div key={section.key} className={index > 0 ? 'mt-4' : ''}>
            {!collapsed && section.key !== 'overview' && (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </p>
            )}
            <ul className="flex flex-col gap-1">{section.items.map(renderItem)}</ul>
          </div>
        ))}
      </ScrollShadow>

      <div className="border-t border-divider px-2 py-3">
        {/* The Platform team panel, for the platform team only: the whole-platform
            pages live there (15 Nov 2026). */}
        {isPlatformTeamUser(user) && (
          <Link
            to={tenantPath('/platform-team')}
            aria-label={collapsed ? t('nav.platform_team_panel') : undefined}
            className={`mb-1 flex items-center rounded-lg text-sm text-muted transition-colors hover:bg-surface-secondary hover:text-foreground ${
              collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
            }`}
          >
            <ShieldCheck size={18} aria-hidden="true" />
            {!collapsed && <span>{t('nav.platform_team_panel')}</span>}
          </Link>
        )}
        {collapsed ? (
          <Tooltip content={t('nav.back_to_platform_admin')} placement="right">
            <Link
              to={tenantPath('/admin')}
              className="flex items-center justify-center rounded-lg px-2 py-2 text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
            >
              <Settings size={18} />
            </Link>
          </Tooltip>
        ) : (
          <Link
            to={tenantPath('/admin')}
            className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
          >
            <Settings size={18} />
            <span>{t('nav.back_to_platform_admin')}</span>
          </Link>
        )}
      </div>
    </aside>
  );
}

export default SuperAdminSidebar;
