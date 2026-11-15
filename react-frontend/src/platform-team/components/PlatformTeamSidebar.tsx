// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — menu.
 *
 * Two zones, so it is always clear what a page acts on: "The whole platform"
 * and "This community: {name}". A page belongs in the first zone only if its
 * endpoints act on the whole installation.
 *
 * 🔴 The current page is marked with `isOnPanelPath()`, never by comparing
 * `useLocation().pathname` with `tenantPath(path)`: inside the app's routes the
 * pathname has no community slug, so that comparison never matches on a slug
 * address (lib/panelPath.ts).
 *
 * The pages themselves are mounted in PlatformTeamRoutes.tsx. The menu entries
 * are added with them (plan Task 8); until then this renders the frame only.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { isOnPanelPath } from '@/lib/panelPath';
import { Button, ScrollShadow, Tooltip } from '@/components/ui';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import Settings from 'lucide-react/icons/settings';
import ShieldCheck from 'lucide-react/icons/shield-check';
import type { LucideIcon } from 'lucide-react';

interface PlatformTeamSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export interface PlatformTeamNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Bare panel path, e.g. "/platform-team/cron-jobs". */
  path: string;
}

export interface PlatformTeamNavGroup {
  key: string;
  title: string;
  items: PlatformTeamNavItem[];
}

export interface PlatformTeamNavZone {
  key: 'platform' | 'community';
  title: string;
  groups: PlatformTeamNavGroup[];
}

export function PlatformTeamSidebar({ collapsed, onToggle }: PlatformTeamSidebarProps) {
  const { t } = useTranslation('platform_team');
  const location = useLocation();
  const { tenantPath, tenant } = useTenant();

  const zones: PlatformTeamNavZone[] = [
    { key: 'platform', title: t('sidebar.zone_platform'), groups: [] },
    { key: 'community', title: t('sidebar.zone_community', { name: tenant?.name ?? '' }), groups: [] },
  ];

  const renderItem = (item: PlatformTeamNavItem) => {
    const active = isOnPanelPath(location.pathname, item.path, tenantPath);
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

  const footerLink = (path: string, label: string) =>
    collapsed ? (
      <Tooltip content={label} placement="right">
        <Link
          to={tenantPath(path)}
          aria-label={label}
          className="flex items-center justify-center rounded-lg px-2 py-2 text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
        >
          <Settings size={18} />
        </Link>
      </Tooltip>
    ) : (
      <Link
        to={tenantPath(path)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
      >
        <Settings size={18} />
        <span>{label}</span>
      </Link>
    );

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-divider bg-surface transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-16 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath('/platform-team')} className="flex items-center gap-2">
            <ShieldCheck size={22} className="text-accent" />
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
        {zones
          .filter((zone) => zone.groups.some((group) => group.items.length > 0))
          .map((zone, zoneIndex) => (
            <section key={zone.key} className={zoneIndex > 0 ? 'mt-5 border-t border-divider pt-4' : ''}>
              {!collapsed && (
                <h2 className="px-3 pb-2 text-xs font-semibold text-foreground">{zone.title}</h2>
              )}
              {zone.groups
                .filter((group) => group.items.length > 0)
                .map((group, groupIndex) => (
                  <div key={group.key} className={groupIndex > 0 ? 'mt-3' : ''}>
                    {!collapsed && (
                      <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                        {group.title}
                      </p>
                    )}
                    <ul className="flex flex-col gap-1">{group.items.map(renderItem)}</ul>
                  </div>
                ))}
            </section>
          ))}
      </ScrollShadow>

      <div className="flex flex-col gap-1 border-t border-divider px-2 py-3">
        {footerLink('/admin', t('nav.back_to_admin'))}
        {footerLink('/super-admin', t('nav.back_to_super_admin'))}
      </div>
    </aside>
  );
}

export default PlatformTeamSidebar;
