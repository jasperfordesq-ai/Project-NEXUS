// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — menu.
 *
 * Two zones, so it is always clear what a page acts on:
 *
 *   - "The whole platform": the page's endpoints act on the installation
 *     (background jobs, the server, search snapshots, plans, webhooks).
 *   - "This community: {name}": the page acts on the community whose address
 *     the panel was opened from (its email settings, its menus, its roles).
 *
 * A page belongs in the first zone ONLY if the server code says so; the
 * placement here follows the endpoint-by-endpoint read recorded in the design
 * (`.local-docs-archive/platform-team-panel/`, section 6.3).
 *
 * Item labels reuse the admin menu's wording (`admin_nav`), so a page is
 * called the same thing it was called in the admin panel. The panel's own
 * words (zones, groups, the brand) are in `platform_team`.
 *
 * 🔴 The current page is found with `isOnPanelPath()`, never by comparing
 * `useLocation().pathname` with `tenantPath(path)`: inside the app's routes the
 * pathname has no community slug, so that comparison never matches on a slug
 * address (lib/panelPath.ts). Of the entries that match, the LONGEST path wins,
 * so `/platform-team/enterprise/roles/5` marks Roles and permissions and not
 * the Enterprise dashboard, and `/platform-team/plans/edit/3` marks Plans.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { isOnPanelPath } from '@/lib/panelPath';
import { Button, ScrollShadow, Tooltip } from '@/components/ui';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import BarChart3 from 'lucide-react/icons/chart-column';
import Building2 from 'lucide-react/icons/building-2';
import CreditCard from 'lucide-react/icons/credit-card';
import FileText from 'lucide-react/icons/file-text';
import Heart from 'lucide-react/icons/heart';
import KeyIcon from 'lucide-react/icons/key';
import ListChecks from 'lucide-react/icons/list-checks';
import Mail from 'lucide-react/icons/mail';
import Menu from 'lucide-react/icons/menu';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import Settings from 'lucide-react/icons/settings';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Stethoscope from 'lucide-react/icons/stethoscope';
import Target from 'lucide-react/icons/target';
import Timer from 'lucide-react/icons/timer';
import UserCheck from 'lucide-react/icons/user-check';
import Webhook from 'lucide-react/icons/webhook';
import Wrench from 'lucide-react/icons/wrench';
import Zap from 'lucide-react/icons/zap';
import type { LucideIcon } from 'lucide-react';

interface PlatformTeamSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Bare panel path, e.g. "/platform-team/cron-jobs". Also the item's key. */
  path: string;
}

interface NavGroup {
  key: string;
  title: string;
  items: NavItem[];
}

interface NavZone {
  key: 'platform' | 'community';
  title: string;
  groups: NavGroup[];
}

const P = '/platform-team';

export function PlatformTeamSidebar({ collapsed, onToggle }: PlatformTeamSidebarProps) {
  const { t } = useTranslation('platform_team');
  const { t: tNav } = useTranslation('admin_nav');
  const location = useLocation();
  const { tenantPath, tenant } = useTenant();

  const zones: NavZone[] = [
    {
      key: 'platform',
      title: t('sidebar.zone_platform'),
      groups: [
        {
          key: 'health',
          title: t('sidebar.group_health'),
          items: [
            { label: tNav('monitoring'), icon: Heart, path: `${P}/enterprise/monitoring` },
            { label: tNav('cron_jobs'), icon: Timer, path: `${P}/cron-jobs` },
            { label: tNav('cron_logs'), icon: FileText, path: `${P}/cron-jobs/logs` },
            { label: tNav('cron_setup'), icon: Wrench, path: `${P}/cron-jobs/setup` },
            { label: tNav('cron_settings'), icon: Settings, path: `${P}/cron-jobs/settings` },
            { label: tNav('prerender_engine'), icon: Zap, path: `${P}/seo/prerender` },
            { label: tNav('error_404_tracking'), icon: AlertTriangle, path: `${P}/404-errors` },
            { label: t('nav.tests'), icon: Stethoscope, path: `${P}/tests` },
          ],
        },
        {
          key: 'money',
          title: t('sidebar.group_money'),
          items: [
            { label: tNav('plans_pricing'), icon: CreditCard, path: `${P}/plans` },
            { label: tNav('subscriptions'), icon: CreditCard, path: `${P}/plans/subscriptions` },
          ],
        },
        {
          key: 'connections',
          title: t('sidebar.group_connections'),
          items: [
            { label: tNav('outbound_webhooks'), icon: Webhook, path: `${P}/integrations/webhooks` },
          ],
        },
        {
          key: 'access',
          title: t('sidebar.group_access'),
          items: [
            { label: tNav('enterprise_dashboard'), icon: Building2, path: `${P}/enterprise` },
            { label: tNav('permissions_list'), icon: ListChecks, path: `${P}/enterprise/permissions` },
          ],
        },
      ],
    },
    {
      key: 'community',
      title: t('sidebar.zone_community', { name: tenant?.name ?? '' }),
      groups: [
        {
          key: 'email',
          title: t('sidebar.group_email'),
          items: [
            { label: tNav('email_settings'), icon: Mail, path: `${P}/email-settings` },
            { label: tNav('email_deliverability'), icon: Mail, path: `${P}/email-deliverability` },
            { label: tNav('deliverability'), icon: Mail, path: `${P}/deliverability` },
          ],
        },
        {
          key: 'joining',
          title: t('sidebar.group_joining'),
          items: [
            { label: tNav('registration_policy'), icon: UserCheck, path: `${P}/settings/registration-policy` },
            { label: tNav('roles_permissions'), icon: KeyIcon, path: `${P}/enterprise/roles` },
          ],
        },
        {
          key: 'site',
          title: t('sidebar.group_site'),
          items: [
            { label: tNav('menus'), icon: Menu, path: `${P}/menus` },
            { label: tNav('seo_audit'), icon: ListChecks, path: `${P}/seo/audit` },
            { label: tNav('url_redirects'), icon: ArrowLeftRight, path: `${P}/seo/redirects` },
            { label: tNav('search_analytics'), icon: BarChart3, path: `${P}/search-analytics` },
          ],
        },
        {
          key: 'reports',
          title: t('sidebar.group_reports'),
          items: [
            { label: tNav('performance'), icon: Activity, path: `${P}/performance` },
            { label: tNav('regional_analytics'), icon: BarChart3, path: `${P}/analytics/regional` },
          ],
        },
        {
          key: 'matching',
          title: t('sidebar.group_matching'),
          items: [
            { label: tNav('diagnostics'), icon: Stethoscope, path: `${P}/matching-diagnostic` },
            { label: tNav('match_debug_panel'), icon: Target, path: `${P}/match-debug` },
          ],
        },
      ],
    },
  ];

  // The entry whose path is the longest one the address sits on or under.
  const activePath = zones
    .flatMap((zone) => zone.groups.flatMap((group) => group.items.map((item) => item.path)))
    .filter((path) => isOnPanelPath(location.pathname, path, tenantPath))
    .reduce<string | null>((best, path) => (best === null || path.length > best.length ? path : best), null);

  const renderItem = (item: NavItem) => {
    const active = item.path === activePath;
    const Icon = item.icon;
    const link = (
      <li key={item.path}>
        <Link
          to={tenantPath(item.path)}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? item.label : undefined}
          className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            active
              ? 'bg-accent/10 text-accent-soft-foreground'
              : 'text-muted hover:bg-surface-secondary hover:text-foreground'
          } ${collapsed ? 'justify-center px-2' : ''}`}
        >
          <Icon size={20} className={active ? 'text-accent' : 'text-muted'} aria-hidden="true" />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
        </Link>
      </li>
    );

    return collapsed ? (
      <Tooltip key={item.path} content={item.label} placement="right">
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
          <Settings size={18} aria-hidden="true" />
        </Link>
      </Tooltip>
    ) : (
      <Link
        to={tenantPath(path)}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-secondary hover:text-foreground"
      >
        <Settings size={18} aria-hidden="true" />
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
          <Link to={tenantPath(P)} className="flex items-center gap-2">
            <ShieldCheck size={22} className="text-accent" aria-hidden="true" />
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
        {zones.map((zone, zoneIndex) => (
          <section
            key={zone.key}
            aria-label={zone.title}
            className={zoneIndex > 0 ? 'mt-5 border-t border-divider pt-4' : ''}
          >
            {!collapsed && (
              <h2 className="px-3 pb-2 text-sm font-semibold text-foreground">{zone.title}</h2>
            )}
            {zone.groups.map((group, groupIndex) => (
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
