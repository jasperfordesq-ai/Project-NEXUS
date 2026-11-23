// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — menu.
 *
 * Built like the admin panel's menu, so the two feel the same: a "find a page"
 * box, groups that open and close (one open at a time, and the one holding the
 * current page opens by itself), and one icon per group when the menu is
 * collapsed to a strip.
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
 * (`.local-docs-archive/platform-team-panel/`, section 6.3). Regrouping INSIDE
 * a zone is a matter of taste; moving a page BETWEEN zones is not.
 *
 * The groups (17 Nov 2026) follow what someone opens the panel to do, in the
 * order they tend to do it: is it working, how are the communities, who can
 * get in, the legal side, money, then the machinery. Ten groups, not twelve:
 * "Tools" joined the scheduled jobs, "Products" was split between Money and
 * Communities, and "Keys" joined Connections.
 *
 * Item labels reuse the wording of the menu a page came from (`admin_nav` for
 * the admin panel, `super_admin` for the super admin panel), so a page is
 * called the same thing it was called there. The panel's own words (zones,
 * groups, the brand) are in `platform_team`.
 *
 * 🔴 "Deliverability" (`/deliverability`) tracks project deliverables and
 * milestones. It is NOT about email, so it sits under Reports and not beside
 * "Email Deliverability", where it was until 17 Nov 2026.
 *
 * 🔴 The current page is found with `isOnPanelPath()`, never by comparing
 * `useLocation().pathname` with `tenantPath(path)`: inside the app's routes the
 * pathname has no community slug, so that comparison never matches on a slug
 * address (lib/panelPath.ts). Of the entries that match, the LONGEST path wins,
 * so `/platform-team/enterprise/roles/5` marks Roles and permissions and not
 * the Enterprise dashboard, and `/platform-team/plans/edit/3` marks Plans.
 *
 * A closed group's links stay in the page (hidden), so the tests can count
 * every page whichever group is open.
 */

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { isOnPanelPath } from '@/lib/panelPath';
import { Button, ScrollShadow, Tooltip } from '@/components/ui';
import { Accordion, AccordionItem } from '@/components/ui/Accordion';
import { Input } from '@/components/ui/Input';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import BarChart3 from 'lucide-react/icons/chart-column';
import BellRing from 'lucide-react/icons/bell-ring';
import Bug from 'lucide-react/icons/bug';
import Building2 from 'lucide-react/icons/building-2';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Compass from 'lucide-react/icons/compass';
import CreditCard from 'lucide-react/icons/credit-card';
import Eraser from 'lucide-react/icons/eraser';
import FileSearch from 'lucide-react/icons/file-search';
import FileSignature from 'lucide-react/icons/file-signature';
import FileText from 'lucide-react/icons/file-text';
import FlaskConical from 'lucide-react/icons/flask-conical';
import Gauge from 'lucide-react/icons/gauge';
import Globe from 'lucide-react/icons/globe';
import GlobeLock from 'lucide-react/icons/globe-lock';
import Grid3x3 from 'lucide-react/icons/grid-3x3';
import Handshake from 'lucide-react/icons/handshake';
import Heart from 'lucide-react/icons/heart';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Inbox from 'lucide-react/icons/inbox';
import KeyIcon from 'lucide-react/icons/key';
import Landmark from 'lucide-react/icons/landmark';
import Languages from 'lucide-react/icons/languages';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import ListChecks from 'lucide-react/icons/list-checks';
import Lock from 'lucide-react/icons/lock';
import Mail from 'lucide-react/icons/mail';
import MailCheck from 'lucide-react/icons/mail-check';
import Megaphone from 'lucide-react/icons/megaphone';
import Menu from 'lucide-react/icons/menu';
import PanelLeft from 'lucide-react/icons/panel-left';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import Plug from 'lucide-react/icons/plug';
import Rocket from 'lucide-react/icons/rocket';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Scale from 'lucide-react/icons/scale';
import ScrollText from 'lucide-react/icons/scroll-text';
import Search from 'lucide-react/icons/search';
import SearchCheck from 'lucide-react/icons/search-check';
import Settings from 'lucide-react/icons/settings';
import Shield from 'lucide-react/icons/shield';
import ShieldCheck from 'lucide-react/icons/shield-check';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import Smartphone from 'lucide-react/icons/smartphone';
import Stethoscope from 'lucide-react/icons/stethoscope';
import Target from 'lucide-react/icons/target';
import Timer from 'lucide-react/icons/timer';
import UserCheck from 'lucide-react/icons/user-check';
import UserCog from 'lucide-react/icons/user-cog';
import UserSearch from 'lucide-react/icons/user-search';
import Wallet from 'lucide-react/icons/wallet';
import Webhook from 'lucide-react/icons/webhook';
import Wrench from 'lucide-react/icons/wrench';
import X from 'lucide-react/icons/x';
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
  /** Shown beside the group's name, and alone when the menu is a strip of icons. */
  icon: LucideIcon;
  items: NavItem[];
}

interface NavZone {
  key: 'platform' | 'community';
  title: string;
  groups: NavGroup[];
}

const P = '/platform-team';

/** Every word typed must be in the page's name or its group's name. Case is ignored. */
function matchesSearch(query: string, text: string): boolean {
  const haystack = text.toLocaleLowerCase();
  return query
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

export function PlatformTeamSidebar({ collapsed, onToggle }: PlatformTeamSidebarProps) {
  const { t } = useTranslation('platform_team');
  const { t: tNav } = useTranslation('admin_nav');
  // The pages that came from the super admin panel keep the names they had in its menu.
  const { t: tSuper } = useTranslation('super_admin');
  const location = useLocation();
  const { tenantPath, tenant } = useTenant();
  const [searchQuery, setSearchQuery] = useState('');

  const zones: NavZone[] = [
    {
      key: 'platform',
      title: t('sidebar.zone_platform'),
      groups: [
        {
          // Is it working? What is wrong first, then what was released.
          key: 'health',
          title: t('sidebar.group_health'),
          icon: Activity,
          items: [
            { label: tNav('monitoring'), icon: Heart, path: `${P}/enterprise/monitoring` },
            { label: t('errors.title'), icon: Bug, path: `${P}/errors` },
            { label: t('home.card.failed_jobs'), icon: RotateCcw, path: `${P}/failed-jobs` },
            { label: tNav('error_404_tracking'), icon: AlertTriangle, path: `${P}/404-errors` },
            { label: t('deployments.title'), icon: Rocket, path: `${P}/deployments` },
            { label: t('domains.title'), icon: GlobeLock, path: `${P}/domains` },
            { label: t('nav.tests'), icon: Stethoscope, path: `${P}/tests` },
          ],
        },
        {
          // Every community side by side, then the two queues of new ones.
          key: 'communities',
          title: t('sidebar.group_communities'),
          icon: Building2,
          items: [
            { label: t('glance.nav'), icon: Grid3x3, path: `${P}/communities` },
            { label: t('community_health.nav'), icon: HeartPulse, path: `${P}/community-health` },
            { label: t('community_setup.nav'), icon: ListChecks, path: `${P}/community-setup` },
            { label: t('usage.nav'), icon: Gauge, path: `${P}/usage` },
            { label: tSuper('nav.national_dashboard'), icon: Landmark, path: `${P}/national/kiss` },
            { label: tSuper('nav.provisioning_queue'), icon: Inbox, path: `${P}/provisioning-requests` },
            { label: tSuper('nav.pilot_inquiries'), icon: FileSearch, path: `${P}/platform/pilot-inquiries` },
          ],
        },
        {
          // What is switched on for everyone, and what every admin is told.
          key: 'features',
          title: t('sidebar.group_features'),
          icon: SlidersHorizontal,
          items: [
            { label: tNav('platform_capabilities'), icon: SlidersHorizontal, path: `${P}/platform-capabilities` },
            { label: t('unfinished_features.nav'), icon: FlaskConical, path: `${P}/unfinished-features` },
            { label: t('notices.title'), icon: Megaphone, path: `${P}/notices` },
          ],
        },
        {
          // The phone app across every community: who has it, and what it is sent.
          key: 'phone',
          title: t('sidebar.group_phone'),
          icon: Smartphone,
          items: [
            { label: t('phone_app.title'), icon: Smartphone, path: `${P}/phone-app` },
            { label: t('push_notifications.nav'), icon: BellRing, path: `${P}/push-notifications` },
          ],
        },
        {
          // Who can get in, and what has been tried.
          key: 'access',
          title: t('sidebar.group_access_security'),
          icon: Lock,
          items: [
            { label: t('security.title'), icon: Shield, path: `${P}/security` },
            { label: t('senior_accounts.title'), icon: UserCog, path: `${P}/senior-accounts` },
            { label: t('accounts.title'), icon: UserSearch, path: `${P}/accounts` },
            { label: t('access_review.title'), icon: ClipboardCheck, path: `${P}/access-review` },
            { label: tNav('enterprise_dashboard'), icon: Building2, path: `${P}/enterprise` },
            { label: tNav('permissions_list'), icon: ListChecks, path: `${P}/enterprise/permissions` },
          ],
        },
        {
          // Data requests, legal documents, the jobs that delete old data, and
          // the facts a customer's assurance questions are answered from.
          key: 'data',
          title: t('sidebar.group_data'),
          icon: Scale,
          items: [
            { label: t('data_requests.nav'), icon: Inbox, path: `${P}/data-requests` },
            { label: t('legal_documents.nav'), icon: Scale, path: `${P}/legal-documents` },
            { label: t('clean_up_jobs.title'), icon: Eraser, path: `${P}/clean-up-jobs` },
            { label: t('assurance.title'), icon: ClipboardList, path: `${P}/assurance` },
          ],
        },
        {
          // Everything that is charged for, including the analytics product.
          key: 'money',
          title: t('sidebar.group_money'),
          icon: Wallet,
          items: [
            { label: tSuper('nav.billing_control'), icon: Wallet, path: `${P}/billing` },
            { label: tSuper('nav.revenue_dashboard'), icon: BarChart3, path: `${P}/billing/revenue` },
            { label: tNav('plans_pricing'), icon: CreditCard, path: `${P}/plans` },
            { label: t('nav.regional_analytics_subscriptions'), icon: BarChart3, path: `${P}/regional-analytics/subscriptions` },
            { label: t('agreements.title'), icon: FileSignature, path: `${P}/agreements` },
          ],
        },
        {
          // The scheduled jobs (their list, their record, how they are set
          // up), then the two things run by hand when something needs rebuilding.
          key: 'jobs',
          title: t('sidebar.group_jobs_tools'),
          icon: Timer,
          items: [
            { label: tNav('cron_jobs'), icon: Timer, path: `${P}/cron-jobs` },
            { label: tNav('cron_logs'), icon: FileText, path: `${P}/cron-jobs/logs` },
            { label: tNav('cron_setup'), icon: Wrench, path: `${P}/cron-jobs/setup` },
            { label: tNav('cron_settings'), icon: Settings, path: `${P}/cron-jobs/settings` },
            { label: t('search_rebuild.title'), icon: SearchCheck, path: `${P}/search-rebuild` },
            { label: tNav('prerender_engine'), icon: Zap, path: `${P}/seo/prerender` },
          ],
        },
        {
          // The outside services the server talks to, and the languages.
          key: 'connections',
          title: t('sidebar.group_connections'),
          icon: Plug,
          items: [
            { label: t('connections.title'), icon: Plug, path: `${P}/connections` },
            { label: tNav('outbound_webhooks'), icon: Webhook, path: `${P}/integrations/webhooks` },
            { label: tSuper('nav.platform_translation'), icon: KeyIcon, path: `${P}/platform/translation` },
            { label: t('translations.title'), icon: Languages, path: `${P}/translations` },
          ],
        },
        {
          // Links with other installations and other platforms. The name and
          // the four entries are the super admin menu's own, unchanged.
          key: 'federation',
          title: tSuper('sidebar.section_federation'),
          icon: Globe,
          items: [
            { label: tSuper('nav.federation_dashboard'), icon: Globe, path: `${P}/federation` },
            { label: tSuper('nav.whitelist'), icon: Shield, path: `${P}/federation/whitelist` },
            { label: tSuper('nav.partnerships'), icon: Handshake, path: `${P}/federation/partnerships` },
            { label: tSuper('nav.federation_audit'), icon: ScrollText, path: `${P}/federation/audit` },
          ],
        },
      ],
    },
    {
      key: 'community',
      title: t('sidebar.zone_community', { name: tenant?.name ?? '' }),
      groups: [
        {
          key: 'joining',
          title: t('sidebar.group_joining'),
          icon: UserCheck,
          items: [
            { label: tNav('registration_policy'), icon: UserCheck, path: `${P}/settings/registration-policy` },
            { label: tNav('roles_permissions'), icon: KeyIcon, path: `${P}/enterprise/roles` },
          ],
        },
        {
          key: 'email',
          title: t('sidebar.group_email'),
          icon: Mail,
          items: [
            { label: tNav('email_settings'), icon: Mail, path: `${P}/email-settings` },
            { label: tNav('email_deliverability'), icon: MailCheck, path: `${P}/email-deliverability` },
          ],
        },
        {
          key: 'site',
          title: t('sidebar.group_site'),
          icon: Compass,
          items: [
            { label: tNav('menus'), icon: Menu, path: `${P}/menus` },
            { label: tNav('seo_audit'), icon: ListChecks, path: `${P}/seo/audit` },
            { label: tNav('url_redirects'), icon: ArrowLeftRight, path: `${P}/seo/redirects` },
            { label: tNav('search_analytics'), icon: Search, path: `${P}/search-analytics` },
          ],
        },
        {
          key: 'matching',
          title: t('sidebar.group_matching'),
          icon: Target,
          items: [
            { label: tNav('diagnostics'), icon: Stethoscope, path: `${P}/matching-diagnostic` },
            { label: tNav('match_debug_panel'), icon: Target, path: `${P}/match-debug` },
          ],
        },
        {
          key: 'reports',
          title: t('sidebar.group_reports'),
          icon: BarChart3,
          items: [
            { label: tNav('performance'), icon: Activity, path: `${P}/performance` },
            { label: tNav('regional_analytics'), icon: BarChart3, path: `${P}/analytics/regional` },
            // Project deliverables and milestones, not email: see the note at the top.
            { label: tNav('deliverability'), icon: ClipboardList, path: `${P}/deliverability` },
          ],
        },
      ],
    },
  ];

  const allItems = zones.flatMap((zone) =>
    zone.groups.flatMap((group) =>
      group.items.map((item) => ({ ...item, groupKey: group.key, groupTitle: group.title })),
    ),
  );

  // The panel's front page has an entry of its own at the top of the menu. It
  // matches only its exact address: every other page sits under it.
  const onHome = isOnPanelPath(location.pathname, P, tenantPath, { exact: true });

  // The entry whose path is the longest one the address sits on or under.
  const activePath = allItems
    .map((item) => item.path)
    .filter((path) => isOnPanelPath(location.pathname, path, tenantPath))
    .reduce<string | null>((best, path) => (best === null || path.length > best.length ? path : best), null);
  const activeGroupKey = allItems.find((item) => item.path === activePath)?.groupKey ?? null;

  // One group open at a time. The group holding the current page opens by
  // itself; after that the reader opens and closes what they like.
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroupKey);
  useEffect(() => {
    if (activeGroupKey) setOpenGroup(activeGroupKey);
  }, [activeGroupKey]);

  // Bring the current page's entry into view. When the panel is opened on a
  // page (a bookmark, an old address, a reload) it is centred, so it is not
  // left under the fade at the menu's edge. After that `nearest` is used,
  // which does nothing when the entry is already on screen: clicking an entry
  // never makes the menu jump, including the first click from the front page.
  const activeLinkRef = useRef<HTMLAnchorElement | null>(null);
  const openedOnThisPage = useRef(true);
  useEffect(() => {
    const centre = openedOnThisPage.current;
    openedOnThisPage.current = false;
    if (activePath === null) return;
    activeLinkRef.current?.scrollIntoView?.({ block: centre ? 'center' : 'nearest' });
  }, [activePath]);

  const query = searchQuery.trim();
  const searchResults = query
    ? allItems.filter((item) => matchesSearch(query, `${item.label} ${item.groupTitle}`))
    : [];

  const linkClass = (active: boolean) =>
    `relative flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm leading-snug transition-colors ${
      active
        ? 'bg-accent/10 font-semibold text-accent-soft-foreground'
        : 'text-muted hover:bg-surface-secondary hover:text-foreground'
    }`;

  /** A page's entry. `hint` is the group's name, shown beside a search result. */
  const renderItem = (item: NavItem, hint?: string) => {
    const active = item.path === activePath;
    const Icon = item.icon;

    return (
      <li key={item.path}>
        <Link
          to={tenantPath(item.path)}
          onClick={() => setSearchQuery('')}
          ref={active && !hint ? activeLinkRef : undefined}
          aria-current={active ? 'page' : undefined}
          className={linkClass(active)}
        >
          {active && <span className="absolute start-0 top-2 h-5 w-0.5 rounded-e bg-accent" aria-hidden="true" />}
          <Icon size={16} className={`shrink-0 ${active ? 'text-accent' : ''}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 hyphens-auto break-words">{item.label}</span>
          {hint && <span className="max-w-[5.5rem] shrink-0 truncate text-xs text-muted">{hint}</span>}
        </Link>
      </li>
    );
  };

  /** The panel's front page: always the first entry, in the menu and in the strip. */
  const homeLink = (
    <Tooltip content={t('home.title')} placement="right" isDisabled={!collapsed}>
      <Link
        to={tenantPath(P)}
        aria-current={onHome ? 'page' : undefined}
        aria-label={collapsed ? t('home.title') : undefined}
        className={`${linkClass(onHome)} font-medium ${collapsed ? 'justify-center px-2' : ''}`}
      >
        <LayoutDashboard size={18} className={`shrink-0 ${onHome ? 'text-accent' : ''}`} aria-hidden="true" />
        {!collapsed && <span className="min-w-0 flex-1 hyphens-auto break-words">{t('home.title')}</span>}
      </Link>
    </Tooltip>
  );

  /** A group in the open menu: its name opens and closes its pages. */
  const renderGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const holdsCurrentPage = group.key === activeGroupKey;

    return (
      <div key={group.key} data-nav-group={group.key}>
        <Accordion
          selectedKeys={openGroup === group.key ? new Set<string>([group.key]) : new Set<string>()}
          selectionMode="single"
          onSelectionChange={(keys) => {
            const selected = Array.from(keys as Set<string>)[0]?.toString() ?? null;
            setOpenGroup(selected === group.key ? group.key : null);
          }}
          itemClasses={{
            base: 'py-0',
            trigger: `rounded-lg px-3 py-2 text-sm transition-colors hover:bg-surface-secondary hover:text-foreground ${
              holdsCurrentPage ? 'font-semibold text-foreground' : 'text-muted'
            }`,
            title: 'text-sm font-medium',
            content: 'pb-1 pt-0',
            indicator: 'text-muted',
          }}
        >
          <AccordionItem
            key={group.key}
            id={group.key}
            aria-label={group.title}
            title={
              <span className="flex items-center gap-3">
                <Icon size={18} className={`shrink-0 ${holdsCurrentPage ? 'text-accent' : ''}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 hyphens-auto break-words text-start leading-snug">{group.title}</span>
              </span>
            }
          >
            <ul className="ms-5 mt-1 flex flex-col gap-0.5 border-s border-divider ps-1.5">
              {group.items.map((item) => renderItem(item))}
            </ul>
          </AccordionItem>
        </Accordion>
      </div>
    );
  };

  /**
   * A group in the strip of icons. Pressing it opens the menu at that group:
   * a group is several pages, so a single link could only ever reach one.
   */
  const renderGroupIcon = (group: NavGroup) => {
    const Icon = group.icon;
    const holdsCurrentPage = group.key === activeGroupKey;

    return (
      <li key={group.key} className="flex justify-center">
        <Tooltip content={group.title} placement="right">
          <Button
            isIconOnly
            variant="tertiary"
            size="sm"
            aria-label={group.title}
            aria-current={holdsCurrentPage ? 'true' : undefined}
            onPress={() => {
              setOpenGroup(group.key);
              onToggle();
            }}
            className={
              holdsCurrentPage
                ? 'bg-accent/10 text-accent-soft-foreground'
                : 'text-muted hover:bg-surface-secondary hover:text-foreground'
            }
          >
            <Icon size={18} aria-hidden="true" />
          </Button>
        </Tooltip>
      </li>
    );
  };

  return (
    <aside
      className={`fixed start-0 top-0 z-40 flex h-screen flex-col border-e border-divider bg-surface transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath(P)} className="flex min-w-0 items-center gap-2">
            <ShieldCheck size={22} className="shrink-0 text-accent" aria-hidden="true" />
            <span className="truncate text-base font-semibold text-foreground">{t('nav.brand')}</span>
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
          {/* Mirrored in a right-to-left language, where the menu is on the right. */}
          {collapsed ? (
            <PanelLeft size={18} className="rtl:-scale-x-100" />
          ) : (
            <PanelLeftClose size={18} className="rtl:-scale-x-100" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="shrink-0 border-b border-divider px-2 py-2">
          <Input
            size="sm"
            variant="secondary"
            type="search"
            name="platform-team-menu-search"
            autoComplete="off"
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            placeholder={t('sidebar.search')}
            aria-label={t('sidebar.search')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            startContent={<Search size={14} className="text-muted" aria-hidden="true" />}
            endContent={
              searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="text-muted hover:text-foreground"
                  aria-label={t('sidebar.search_clear')}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null
            }
            // The browser's own clear cross is hidden: the box has one already.
            classNames={{
              input: 'text-sm [&::-webkit-search-cancel-button]:appearance-none',
              inputWrapper: 'h-8 min-h-8',
            }}
          />
        </div>
      )}

      <ScrollShadow as="nav" aria-label={t('sidebar.nav_label')} className="min-h-0 flex-1 px-2 py-3" hideScrollBar>
        {!collapsed && query ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">{t('sidebar.search_none')}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">{searchResults.map((item) => renderItem(item, item.groupTitle))}</ul>
          )
        ) : (
          <>
            {homeLink}
            {zones.map((zone) => (
              <section key={zone.key} aria-label={zone.title} className="mt-3 border-t border-divider pt-3">
                {collapsed ? (
                  <ul className="flex flex-col gap-1">{zone.groups.map(renderGroupIcon)}</ul>
                ) : (
                  <>
                    {/* Not upper-cased: the title carries the community's own name. */}
                    <h2 className="px-3 pb-1.5 text-xs font-semibold text-foreground">{zone.title}</h2>
                    <div className="flex flex-col gap-0.5">{zone.groups.map(renderGroup)}</div>
                  </>
                )}
              </section>
            ))}
          </>
        )}
      </ScrollShadow>

      <div className="shrink-0 border-t border-divider px-2 py-2">
        <Tooltip content={t('nav.back_to_admin')} placement="right" isDisabled={!collapsed}>
          <Link
            to={tenantPath('/admin')}
            aria-label={collapsed ? t('nav.back_to_admin') : undefined}
            className={`flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm leading-snug text-muted transition-colors hover:bg-surface-secondary hover:text-foreground ${
              collapsed ? 'justify-center px-2' : ''
            }`}
          >
            <ArrowLeft size={16} className="shrink-0 rtl:rotate-180" aria-hidden="true" />
            {!collapsed && <span className="min-w-0 flex-1 hyphens-auto break-words">{t('nav.back_to_admin')}</span>}
          </Link>
        </Tooltip>
      </div>
    </aside>
  );
}

export default PlatformTeamSidebar;
