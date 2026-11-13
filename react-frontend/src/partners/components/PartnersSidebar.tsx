// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks Sidebar Navigation
 *
 * Ordered by what a non-technical admin does, most often first:
 *   Overview → Partner network (who we partner with, how we appear, credit
 *   agreements) → Activity → Settings → Technical setup.
 *
 * "Technical setup" gathers everything that needs a developer or the other
 * side's technical contact (other platforms' protocols, API keys, webhooks,
 * the developer guide, signed statistics, export/import). It is one group,
 * closed until opened, so the everyday items are not buried under nine
 * specialist ones. It opens by itself when the current page is inside it.
 *
 * Until November 2026 those nine items sat in three always-open sections
 * between the partner network and the activity pages, "Network settings" —
 * step one of setting up — was the very last link, and "Our listing" had no
 * link at all (it is a tab of the directory page).
 *
 * Visibility mirrors the route gates in routes.tsx: federation-backed items
 * need the `federation` feature, Inbound API partners needs `partner_api`,
 * Partner cooperatives needs the `caring_community` module, and everything
 * in Settings and Technical setup is super-admin-only.
 */

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useTenant } from '@/contexts';
import { isSuperAdminUser } from '@/lib/access';
import Globe from 'lucide-react/icons/globe';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Handshake from 'lucide-react/icons/handshake';
import BookUser from 'lucide-react/icons/book-user';
import ChevronDown from 'lucide-react/icons/chevron-down';
import IdCard from 'lucide-react/icons/id-card';
import Wrench from 'lucide-react/icons/wrench';
import MapPin from 'lucide-react/icons/map-pin';
import Scale from 'lucide-react/icons/scale';
import Network from 'lucide-react/icons/network';
import Landmark from 'lucide-react/icons/landmark';
import KeyRound from 'lucide-react/icons/key-round';
import Webhook from 'lucide-react/icons/webhook';
import BookOpen from 'lucide-react/icons/book-open';
import Activity from 'lucide-react/icons/activity';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Database from 'lucide-react/icons/database';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import Settings from 'lucide-react/icons/settings';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import PanelLeft from 'lucide-react/icons/panel-left';
import { Button, Tooltip } from '@/components/ui';
import { useExternalFederationStatus } from './useExternalFederationStatus';
import { isOnPanelPath } from '@/lib/panelPath';

interface PartnersSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  path: string;
  /**
   * Query the link carries, for pages that are a tab of another page
   * ("Our listing" is the directory page's ?tab=profile).
   */
  query?: Record<string, string>;
  /**
   * The page carries traffic to/from OTHER installations, so it is inert
   * while external partner federation is switched off. The link stays
   * reachable — an operator still needs it to inspect and reconfigure — but
   * it is marked so the state is visible without opening the page.
   */
  externalGated?: boolean;
}

interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
  /** Closed until opened (or until the current page is inside it). */
  collapsible?: boolean;
}

export function PartnersSidebar({ collapsed, onToggle }: PartnersSidebarProps) {
  const { t } = useTranslation('partners');
  const location = useLocation();
  const { tenantPath, hasFeature } = useTenant();
  const { user } = useAuth();
  const externalStatus = useExternalFederationStatus();
  const externalFederationOff = externalStatus !== null && !externalStatus.effective;

  // Setup/plumbing surfaces are super-admin-only; ordinary admins get the
  // read-mostly panel. Must mirror the SuperRoute gates in routes.tsx.
  const isSuper = isSuperAdminUser(user);
  const showFederation = hasFeature('federation');
  const showInboundApi = hasFeature('partner_api') && isSuper;
  const showCaring = hasFeature('caring_community') && isSuper;

  const sections: NavSection[] = [
    {
      key: 'overview',
      title: t('sidebar.section_overview'),
      items: [
        { key: 'overview', label: t('nav.overview'), icon: LayoutDashboard, path: '/partner-timebanks' },
      ],
    },
    ...(showFederation
      ? ([
          {
            key: 'network',
            title: t('sidebar.section_network'),
            items: [
              { key: 'partnerships', label: t('nav.partnerships'), icon: Handshake, path: '/partner-timebanks/partnerships' },
              { key: 'directory', label: t('nav.directory'), icon: BookUser, path: '/partner-timebanks/directory' },
              { key: 'our-listing', label: t('nav.our_listing'), icon: IdCard, path: '/partner-timebanks/directory', query: { tab: 'profile' } },
              { key: 'neighborhoods', label: t('nav.neighborhoods'), icon: MapPin, path: '/partner-timebanks/neighborhoods' },
              { key: 'credit-agreements', label: t('nav.credit_agreements'), icon: Scale, path: '/partner-timebanks/credit-agreements' },
            ],
          },
          {
            key: 'data',
            title: t('sidebar.section_data'),
            items: [
              { key: 'activity', label: t('nav.activity'), icon: Activity, path: '/partner-timebanks/activity' },
              { key: 'analytics', label: t('nav.analytics'), icon: BarChart3, path: '/partner-timebanks/analytics' },
            ],
          },
        ] as NavSection[])
      : []),
    ...(showFederation && isSuper
      ? ([
          {
            key: 'settings',
            title: t('sidebar.section_settings'),
            items: [
              { key: 'settings', label: t('nav.settings'), icon: Settings, path: '/partner-timebanks/settings' },
            ],
          },
        ] as NavSection[])
      : []),
    ...((showFederation && isSuper) || showInboundApi || showCaring
      ? ([
          {
            key: 'technical',
            title: t('sidebar.section_technical'),
            collapsible: true,
            items: [
              ...(showFederation && isSuper
                ? ([
                    { key: 'external-partners', label: t('nav.external_partners'), icon: Globe, path: '/partner-timebanks/external-partners', externalGated: true },
                    { key: 'credit-commons', label: t('nav.credit_commons'), icon: Landmark, path: '/partner-timebanks/credit-commons', externalGated: true },
                  ] as NavItem[])
                : []),
              ...(showInboundApi
                ? ([{ key: 'inbound-api', label: t('nav.inbound_api'), icon: Network, path: '/partner-timebanks/inbound-api', externalGated: true }] as NavItem[])
                : []),
              ...(showCaring
                ? ([{ key: 'caring-peers', label: t('nav.caring_peers'), icon: HeartHandshake, path: '/partner-timebanks/caring/peers' }] as NavItem[])
                : []),
              ...(showFederation && isSuper
                ? ([
                    { key: 'api-keys', label: t('nav.api_keys'), icon: KeyRound, path: '/partner-timebanks/api-keys', externalGated: true },
                    { key: 'webhooks', label: t('nav.webhooks'), icon: Webhook, path: '/partner-timebanks/webhooks', externalGated: true },
                    { key: 'api-docs', label: t('nav.api_docs'), icon: BookOpen, path: '/partner-timebanks/api-docs', externalGated: true },
                    { key: 'aggregates', label: t('nav.aggregates'), icon: ShieldCheck, path: '/partner-timebanks/aggregates' },
                    { key: 'data', label: t('nav.data'), icon: Database, path: '/partner-timebanks/data' },
                  ] as NavItem[])
                : []),
            ],
          },
        ] as NavSection[])
      : []),
  ];

  const currentTab = new URLSearchParams(location.search).get('tab');

  const isActive = (item: NavItem) => {
    // The panel's home page matches exactly; every other page also matches
    // its own sub-pages. See isOnPanelPath for why both the slug and the
    // slug-less form of the address are accepted.
    if (item.path === '/partner-timebanks') {
      return isOnPanelPath(location.pathname, item.path, tenantPath, { exact: true });
    }
    if (!isOnPanelPath(location.pathname, item.path, tenantPath)) return false;
    // Two links share the directory page and differ only by tab.
    if (item.query?.tab) return currentTab === item.query.tab;
    if (item.path === '/partner-timebanks/directory') return currentTab !== 'profile';
    return true;
  };

  const hrefFor = (item: NavItem) => {
    const base = tenantPath(item.path);
    return item.query ? `${base}?${new URLSearchParams(item.query).toString()}` : base;
  };

  // The technical group is closed until the admin opens it — or lands on a
  // page inside it, in which case hiding the current page's own link would
  // be disorienting. An explicit choice wins over the automatic one.
  const [technicalChoice, setTechnicalChoice] = useState<boolean | null>(null);
  const technicalSection = sections.find((section) => section.collapsible);
  const insideTechnical = technicalSection?.items.some(isActive) ?? false;
  const technicalOpen = technicalChoice ?? insideTechnical;

  const renderItem = (item: NavItem) => {
    const active = isActive(item);
    const Icon = item.icon;
    const off = item.externalGated && externalFederationOff;

    const link = (
      <li key={item.key}>
        <Link
          to={hrefFor(item)}
          aria-current={active ? 'page' : undefined}
          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none ${
            active
              ? 'bg-accent/10 text-accent-soft-foreground'
              : 'text-muted hover:bg-surface-secondary hover:text-foreground'
          } ${collapsed ? 'justify-center px-2' : ''}`}
        >
          {/* Active rail — anchors the eye to the current section */}
          {active && (
            <span
              aria-hidden="true"
              className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent"
            />
          )}
          <Icon
            size={20}
            className={`shrink-0 transition-transform group-hover:scale-105 motion-reduce:transition-none ${active ? 'text-accent' : 'text-muted group-hover:text-foreground'}`}
          />
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && off && (
            <span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              {t('external_federation.sidebar_disabled_chip')}
            </span>
          )}
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

  const renderSection = (section: NavSection, idx: number) => {
    if (section.collapsible) {
      const listId = `partners-nav-${section.key}`;
      const toggle = (
        <button
          type="button"
          aria-expanded={technicalOpen}
          aria-controls={listId}
          aria-label={collapsed ? section.title : undefined}
          onClick={() => setTechnicalChoice(!technicalOpen)}
          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted transition-colors hover:bg-surface-secondary hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent motion-reduce:transition-none ${
            collapsed ? 'justify-center px-2' : ''
          }`}
        >
          {collapsed ? (
            <Wrench size={18} aria-hidden="true" />
          ) : (
            <>
              <span className="flex-1 text-left">{section.title}</span>
              <ChevronDown
                size={16}
                aria-hidden="true"
                className={`shrink-0 transition-transform motion-reduce:transition-none ${technicalOpen ? 'rotate-180' : ''}`}
              />
            </>
          )}
        </button>
      );

      return (
        <div key={section.key} className="mt-4 border-t border-divider pt-3">
          {collapsed ? (
            <Tooltip content={section.title} placement="right">
              {toggle}
            </Tooltip>
          ) : (
            toggle
          )}
          <ul id={listId} hidden={!technicalOpen} className={`flex-col gap-1 pt-1 ${technicalOpen ? 'flex' : ''}`}>
            {section.items.map(renderItem)}
          </ul>
        </div>
      );
    }

    return (
      <div key={section.key} className={idx > 0 ? 'mt-4' : ''}>
        {!collapsed && section.key !== 'overview' && (
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
            {section.title}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {section.items.map(renderItem)}
        </ul>
      </div>
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-divider bg-surface transition-all duration-300 flex flex-col ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath('/partner-timebanks')} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent-soft-foreground ring-1 ring-inset ring-accent/20">
              <Globe size={18} />
            </span>
            <span className="truncate text-base font-semibold tracking-tight text-foreground">
              {t('sidebar.title')}
            </span>
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

      {/* Navigation */}
      <nav aria-label={t('sidebar.nav_label')} className="flex-1 overflow-y-auto px-2 py-3">
        {sections.map(renderSection)}
      </nav>

      {/* Footer — back to the full admin panel (all panel users are super admins) */}
      <div className="border-t border-divider px-2 py-3">
        {collapsed ? (
          <Tooltip content={t('sidebar.full_admin')} placement="right">
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
            <span>{t('sidebar.full_admin')}</span>
          </Link>
        )}
      </div>
    </aside>
  );
}

export default PartnersSidebar;
