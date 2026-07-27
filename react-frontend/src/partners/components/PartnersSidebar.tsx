// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks Sidebar Navigation
 *
 * Plain-English, task-oriented sections for a non-technical super admin:
 * who we partner with (network), systems outside the NEXUS network
 * (external connections), the module-gated Caring Community protocols,
 * the technical access surfaces (keys/webhooks), and monitoring/data.
 *
 * Sections are feature-gated to mirror the route gates in routes.tsx:
 * federation-backed sections hide without the `federation` feature, the
 * Inbound API partners item needs `partner_api`, and the whole Caring
 * Community section disappears when the `caring_community` module is off.
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useTenant } from '@/contexts';
import { isSuperAdminUser } from '@/lib/access';
import Globe from 'lucide-react/icons/globe';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Handshake from 'lucide-react/icons/handshake';
import BookUser from 'lucide-react/icons/book-user';
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

interface PartnersSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  path: string;
}

interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
  /**
   * Section carries traffic to/from OTHER installations, so it is inert while
   * the external partner federation kill switch is off. The links stay
   * reachable — an operator still needs them to inspect and reconfigure — but
   * the heading is marked so the state is visible without opening a page.
   */
  externalGated?: boolean;
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
              { key: 'neighborhoods', label: t('nav.neighborhoods'), icon: MapPin, path: '/partner-timebanks/neighborhoods' },
              { key: 'credit-agreements', label: t('nav.credit_agreements'), icon: Scale, path: '/partner-timebanks/credit-agreements' },
            ],
          },
        ] as NavSection[])
      : []),
    ...((showFederation && isSuper) || showInboundApi
      ? ([
          {
            key: 'external',
            title: t('sidebar.section_external'),
            externalGated: true,
            items: [
              ...(showFederation && isSuper
                ? ([
                    { key: 'external-partners', label: t('nav.external_partners'), icon: Globe, path: '/partner-timebanks/external-partners' },
                    { key: 'credit-commons', label: t('nav.credit_commons'), icon: Landmark, path: '/partner-timebanks/credit-commons' },
                  ] as NavItem[])
                : []),
              ...(showInboundApi
                ? ([{ key: 'inbound-api', label: t('nav.inbound_api'), icon: Network, path: '/partner-timebanks/inbound-api' }] as NavItem[])
                : []),
            ],
          },
        ] as NavSection[])
      : []),
    ...(showCaring
      ? ([
          {
            key: 'caring',
            title: t('sidebar.section_caring'),
            items: [
              { key: 'caring-peers', label: t('nav.caring_peers'), icon: HeartHandshake, path: '/partner-timebanks/caring/peers' },
            ],
          },
        ] as NavSection[])
      : []),
    ...(showFederation && isSuper
      ? ([
          {
            key: 'access',
            title: t('sidebar.section_access'),
            // Inbound partner credentials and outbound webhooks — both inert
            // while the external kill switch is off.
            externalGated: true,
            items: [
              { key: 'api-keys', label: t('nav.api_keys'), icon: KeyRound, path: '/partner-timebanks/api-keys' },
              { key: 'webhooks', label: t('nav.webhooks'), icon: Webhook, path: '/partner-timebanks/webhooks' },
              { key: 'api-docs', label: t('nav.api_docs'), icon: BookOpen, path: '/partner-timebanks/api-docs' },
            ],
          },
        ] as NavSection[])
      : []),
    ...(showFederation
      ? ([
          {
            key: 'data',
            title: t('sidebar.section_data'),
            items: [
              { key: 'activity', label: t('nav.activity'), icon: Activity, path: '/partner-timebanks/activity' },
              { key: 'analytics', label: t('nav.analytics'), icon: BarChart3, path: '/partner-timebanks/analytics' },
              ...(isSuper
                ? ([
                    { key: 'aggregates', label: t('nav.aggregates'), icon: ShieldCheck, path: '/partner-timebanks/aggregates' },
                    { key: 'data', label: t('nav.data'), icon: Database, path: '/partner-timebanks/data' },
                  ] as NavItem[])
                : []),
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
  ];

  const isActive = (path: string) => {
    const current = location.pathname;
    if (path === '/partner-timebanks') {
      return current === tenantPath('/partner-timebanks') || current === tenantPath('/partner-timebanks/');
    }
    // Exact match or a `/`-delimited descendant only — a bare prefix match
    // would light "/partner-timebanks/api-keys" for ".../api-keys/create"
    // siblings whose path is a string prefix of another.
    const target = tenantPath(path);
    return current === target || current.startsWith(target + '/');
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    const Icon = item.icon;

    const link = (
      <li key={item.key}>
        <Link
          to={tenantPath(item.path)}
          aria-current={active ? 'page' : undefined}
          className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none ${
            active
              ? 'bg-accent/10 text-accent'
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
      className={`fixed left-0 top-0 z-40 h-screen border-r border-divider bg-surface transition-all duration-300 flex flex-col ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath('/partner-timebanks')} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/20">
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
        {sections.map((section, idx) => (
          <div key={section.key} className={idx > 0 ? 'mt-4' : ''}>
            {!collapsed && section.key !== 'overview' && (
              <p className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                <span>{section.title}</span>
                {section.externalGated && externalFederationOff && (
                  <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-semibold normal-case text-danger">
                    {t('external_federation.sidebar_disabled_chip')}
                  </span>
                )}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {section.items.map(renderItem)}
            </ul>
          </div>
        ))}
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
