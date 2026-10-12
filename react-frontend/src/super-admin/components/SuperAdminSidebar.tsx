// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Sidebar
 * Focused navigation for platform-wide and cross-tenant tools.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { superPanelLevel } from '@/lib/access';
import { ScrollShadow } from '@/components/ui';
import { Button, Tooltip } from '@/components/ui';
import Activity from 'lucide-react/icons/activity';
import BarChart3 from 'lucide-react/icons/chart-column';
import Building2 from 'lucide-react/icons/building-2';
import CreditCard from 'lucide-react/icons/credit-card';
import FileSearch from 'lucide-react/icons/file-search';
import Globe from 'lucide-react/icons/globe';
import Handshake from 'lucide-react/icons/handshake';
import Landmark from 'lucide-react/icons/landmark';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import ListChecks from 'lucide-react/icons/list-checks';
import Network from 'lucide-react/icons/network';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import ScrollText from 'lucide-react/icons/scroll-text';
import Shield from 'lucide-react/icons/shield';
import Users from 'lucide-react/icons/users';
import Settings from 'lucide-react/icons/settings';
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
   * 🔴 Two tiers, matching the API exactly.
   *
   * A 'regional' caller — the super-admin of a community that has communities
   * beneath it — may use the community/member/hierarchy/audit screens, which the
   * backend confines to their own branch. They are refused everything
   * platform-wide: platform income and pricing, the federation switches, the
   * provisioning queue and platform enquiries.
   *
   * The API enforces this regardless (tier B sits behind EnsureIsSuperAdmin, which
   * refuses tenant super-admins). Hiding it here is so the panel does not show
   * controls that can only fail. If you add a section, decide which tier it is in
   * and gate it — an ungated addition shows a branch admin a dead end.
   *
   * Fail closed: ask for an explicit 'master'. An earlier version asked "is this
   * caller regional?" and hid the sections if so — which meant a caller resolving
   * to 'none' (no super-panel reach at all) was shown every platform control.
   * Nobody like that should reach this component, but "should not" is not a
   * guarantee, so ask for the positive.
   */
  const showPlatformSections = superPanelLevel(user) === 'master';

  const sections: NavSection[] = [
    {
      key: 'overview',
      title: t('sidebar.section_overview'),
      items: [
        { key: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, path: '/super-admin' },
        // Platform-only: enquiries and the provisioning queue span the whole
        // installation, and approving a request assigns a parent anywhere in the tree.
        ...(showPlatformSections ? [
          { key: 'pilot-inquiries', label: t('nav.pilot_inquiries'), icon: FileSearch, path: '/super-admin/platform/pilot-inquiries' },
          { key: 'provisioning', label: t('nav.provisioning_queue'), icon: Building2, path: '/super-admin/provisioning-requests' },
        ] : []),
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
      ],
    },
    // Platform-only: these control connections to other installations for the
    // whole platform, including the external kill switches.
    ...(showPlatformSections ? [{
      key: 'federation',
      title: t('sidebar.section_federation'),
      items: [
        { key: 'federation-dashboard', label: t('nav.federation_dashboard'), icon: Globe, path: '/super-admin/federation' },
        { key: 'whitelist', label: t('nav.whitelist'), icon: Shield, path: '/super-admin/federation/whitelist' },
        { key: 'partnerships', label: t('nav.partnerships'), icon: Handshake, path: '/super-admin/federation/partnerships' },
        { key: 'federation-audit', label: t('nav.federation_audit'), icon: Activity, path: '/super-admin/federation/audit' },
      ],
    }] : []),
    // Platform-only: platform income and pricing. The billing endpoints also take
    // the community they act on from the request without a branch check, which is
    // the concrete reason a branch admin must not reach them.
    ...(showPlatformSections ? [{
      key: 'commercial',
      title: t('sidebar.section_commercial'),
      items: [
        { key: 'billing', label: t('nav.billing_control'), icon: CreditCard, path: '/super-admin/billing' },
        { key: 'revenue', label: t('nav.revenue_dashboard'), icon: BarChart3, path: '/super-admin/billing/revenue' },
        { key: 'regional-analytics', label: t('nav.regional_analytics'), icon: BarChart3, path: '/super-admin/regional-analytics/subscriptions' },
        { key: 'national-kiss', label: t('nav.national_dashboard'), icon: Landmark, path: '/super-admin/national/kiss' },
      ],
    }] : []),
  ];

  const isActive = (path: string) => {
    const target = tenantPath(path);
    if (path === '/super-admin') {
      return location.pathname === target || location.pathname === `${target}/`;
    }
    return location.pathname === target || location.pathname.startsWith(`${target}/`);
  };

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
              ? 'bg-accent/10 text-accent'
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
