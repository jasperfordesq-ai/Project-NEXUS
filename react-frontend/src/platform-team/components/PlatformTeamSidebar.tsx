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
 * Item labels reuse the wording of the menu a page came from (`admin_nav` for
 * the admin panel, `super_admin` for the super admin panel), so a page is
 * called the same thing it was called there. The panel's own words (zones,
 * groups, the brand) are in `platform_team`.
 *
 * The menu is longer than a screen, so the current page's entry is scrolled
 * into view: a page opened from a bookmark or an old address would otherwise
 * show a menu with nothing highlighted.
 *
 * 🔴 The current page is found with `isOnPanelPath()`, never by comparing
 * `useLocation().pathname` with `tenantPath(path)`: inside the app's routes the
 * pathname has no community slug, so that comparison never matches on a slug
 * address (lib/panelPath.ts). Of the entries that match, the LONGEST path wins,
 * so `/platform-team/enterprise/roles/5` marks Roles and permissions and not
 * the Enterprise dashboard, and `/platform-team/plans/edit/3` marks Plans.
 */

import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { isOnPanelPath } from '@/lib/panelPath';
import { Button, ScrollShadow, Tooltip } from '@/components/ui';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import BarChart3 from 'lucide-react/icons/chart-column';
import BellRing from 'lucide-react/icons/bell-ring';
import Building2 from 'lucide-react/icons/building-2';
import CreditCard from 'lucide-react/icons/credit-card';
import Eraser from 'lucide-react/icons/eraser';
import FileSearch from 'lucide-react/icons/file-search';
import FileSignature from 'lucide-react/icons/file-signature';
import FileText from 'lucide-react/icons/file-text';
import FlaskConical from 'lucide-react/icons/flask-conical';
import Globe from 'lucide-react/icons/globe';
import Handshake from 'lucide-react/icons/handshake';
import Heart from 'lucide-react/icons/heart';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Inbox from 'lucide-react/icons/inbox';
import Scale from 'lucide-react/icons/scale';
import KeyIcon from 'lucide-react/icons/key';
import Landmark from 'lucide-react/icons/landmark';
import Languages from 'lucide-react/icons/languages';
import ListChecks from 'lucide-react/icons/list-checks';
import Mail from 'lucide-react/icons/mail';
import Menu from 'lucide-react/icons/menu';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Rocket from 'lucide-react/icons/rocket';
import SearchCheck from 'lucide-react/icons/search-check';
import ScrollText from 'lucide-react/icons/scroll-text';
import Settings from 'lucide-react/icons/settings';
import Shield from 'lucide-react/icons/shield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import Grid3x3 from 'lucide-react/icons/grid-3x3';
import Lock from 'lucide-react/icons/lock';
import Megaphone from 'lucide-react/icons/megaphone';
import Smartphone from 'lucide-react/icons/smartphone';
import Gauge from 'lucide-react/icons/gauge';
import UserCog from 'lucide-react/icons/user-cog';
import UserSearch from 'lucide-react/icons/user-search';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Stethoscope from 'lucide-react/icons/stethoscope';
import Plug from 'lucide-react/icons/plug';
import Target from 'lucide-react/icons/target';
import Timer from 'lucide-react/icons/timer';
import UserCheck from 'lucide-react/icons/user-check';
import Wallet from 'lucide-react/icons/wallet';
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
  // The pages that came from the super admin panel keep the names they had in its menu.
  const { t: tSuper } = useTranslation('super_admin');
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
            { label: t('home.card.failed_jobs'), icon: RotateCcw, path: `${P}/failed-jobs` },
            { label: t('deployments.title'), icon: Rocket, path: `${P}/deployments` },
            { label: t('search_rebuild.title'), icon: SearchCheck, path: `${P}/search-rebuild` },
            { label: tNav('error_404_tracking'), icon: AlertTriangle, path: `${P}/404-errors` },
            { label: t('nav.tests'), icon: Stethoscope, path: `${P}/tests` },
          ],
        },
        {
          key: 'money',
          title: t('sidebar.group_money'),
          items: [
            { label: tSuper('nav.billing_control'), icon: Wallet, path: `${P}/billing` },
            { label: tSuper('nav.revenue_dashboard'), icon: BarChart3, path: `${P}/billing/revenue` },
            { label: tNav('plans_pricing'), icon: CreditCard, path: `${P}/plans` },
            { label: tNav('subscriptions'), icon: CreditCard, path: `${P}/plans/subscriptions` },
            { label: t('agreements.title'), icon: FileSignature, path: `${P}/agreements` },
          ],
        },
        {
          key: 'communities',
          title: t('sidebar.group_communities'),
          items: [
            { label: t('glance.nav'), icon: Grid3x3, path: `${P}/communities` },
            { label: t('community_health.nav'), icon: HeartPulse, path: `${P}/community-health` },
            { label: t('community_setup.nav'), icon: ListChecks, path: `${P}/community-setup` },
            { label: t('notices.title'), icon: Megaphone, path: `${P}/notices` },
            { label: tSuper('nav.provisioning_queue'), icon: Building2, path: `${P}/provisioning-requests` },
            { label: tSuper('nav.pilot_inquiries'), icon: FileSearch, path: `${P}/platform/pilot-inquiries` },
            { label: tNav('platform_capabilities'), icon: SlidersHorizontal, path: `${P}/platform-capabilities` },
            { label: t('unfinished_features.nav'), icon: FlaskConical, path: `${P}/unfinished-features` },
            { label: t('phone_app.title'), icon: Smartphone, path: `${P}/phone-app` },
            { label: t('push_notifications.nav'), icon: BellRing, path: `${P}/push-notifications` },
            { label: t('usage.nav'), icon: Gauge, path: `${P}/usage` },
          ],
        },
        {
          // Data requests, legal documents and the jobs that delete old data,
          // across every community. A group with no entries is not drawn.
          key: 'data',
          title: t('sidebar.group_data'),
          items: [
            { label: t('data_requests.nav'), icon: Inbox, path: `${P}/data-requests` },
            { label: t('legal_documents.nav'), icon: Scale, path: `${P}/legal-documents` },
            { label: t('clean_up_jobs.title'), icon: Eraser, path: `${P}/clean-up-jobs` },
          ],
        },
        {
          // Links with other installations and other platforms. The name and
          // the four entries are the super admin menu's own, unchanged.
          key: 'federation',
          title: tSuper('sidebar.section_federation'),
          items: [
            { label: tSuper('nav.federation_dashboard'), icon: Globe, path: `${P}/federation` },
            { label: tSuper('nav.whitelist'), icon: Shield, path: `${P}/federation/whitelist` },
            { label: tSuper('nav.partnerships'), icon: Handshake, path: `${P}/federation/partnerships` },
            { label: tSuper('nav.federation_audit'), icon: ScrollText, path: `${P}/federation/audit` },
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
            { label: t('security.title'), icon: Lock, path: `${P}/security` },
            { label: t('senior_accounts.title'), icon: UserCog, path: `${P}/senior-accounts` },
            { label: t('accounts.title'), icon: UserSearch, path: `${P}/accounts` },
            { label: t('access_review.title'), icon: ClipboardCheck, path: `${P}/access-review` },
            { label: tNav('enterprise_dashboard'), icon: Building2, path: `${P}/enterprise` },
            { label: tNav('permissions_list'), icon: ListChecks, path: `${P}/enterprise/permissions` },
          ],
        },
        {
          key: 'products',
          title: t('sidebar.group_products'),
          items: [
            { label: t('nav.regional_analytics_subscriptions'), icon: BarChart3, path: `${P}/regional-analytics/subscriptions` },
            { label: tSuper('nav.national_dashboard'), icon: Landmark, path: `${P}/national/kiss` },
          ],
        },
        {
          key: 'keys',
          title: t('sidebar.group_keys'),
          items: [
            { label: t('connections.title'), icon: Plug, path: `${P}/connections` },
            { label: tSuper('nav.platform_translation'), icon: Languages, path: `${P}/platform/translation` },
            { label: t('translations.title'), icon: Globe, path: `${P}/translations` },
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

  // Bring the current page's entry into view (see the note at the top).
  // The first time (a bookmark, an old address, a reload) it is centred, so it
  // is not left under the fade at the menu's edge. After that `nearest` is
  // used, which does nothing when the entry is already on screen: clicking an
  // entry never makes the menu jump.
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);
  const hasScrolledOnce = useRef(false);
  useEffect(() => {
    if (activePath === null) return;
    activeLinkRef.current?.scrollIntoView?.({ block: hasScrolledOnce.current ? 'nearest' : 'center' });
    hasScrolledOnce.current = true;
  }, [activePath]);

  const renderItem = (item: NavItem) => {
    const active = item.path === activePath;
    const Icon = item.icon;
    const link = (
      <li key={item.path}>
        <Link
          to={tenantPath(item.path)}
          ref={active ? activeLinkRef : undefined}
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
            {zone.groups.filter((group) => group.items.length > 0).map((group, groupIndex) => (
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
