// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Sidebar Navigation
 * Sectioned sidebar covering daily workflow, compliance, records, and
 * settings. Live badge counts are owned by BrokerLayout and passed in as
 * a prop — keeps the polling singleton even though we mount two
 * BrokerSidebar instances (desktop fixed + mobile drawer).
 */

import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useAuth, useTenant } from '@/contexts';
import { hasAdminPanelAccess } from '@/lib/access';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Users from 'lucide-react/icons/users';
import UserPlus from 'lucide-react/icons/user-plus';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import HandHeart from 'lucide-react/icons/hand-heart';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import UserCheck from 'lucide-react/icons/user-check';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import ShieldPlus from 'lucide-react/icons/shield-plus';
import MessageSquare from 'lucide-react/icons/message-square';
import MessageCircle from 'lucide-react/icons/message-circle';
import Star from 'lucide-react/icons/star';
import Flag from 'lucide-react/icons/flag';
import Eye from 'lucide-react/icons/eye';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import FileText from 'lucide-react/icons/file-text';
import Archive from 'lucide-react/icons/archive';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import HelpCircle from 'lucide-react/icons/circle-help';
import PanelLeftClose from 'lucide-react/icons/panel-left-close';
import PanelLeft from 'lucide-react/icons/panel-left';
import Settings from 'lucide-react/icons/settings';
import { Chip } from '@/components/ui';
import { Button, Tooltip } from '@/components/ui';

export interface BrokerBadgeCounts {
  pending_members: number;
  safeguarding_alerts: number;
  vetting_review_requests: number;
  pending_exchanges: number;
  unreviewed_messages: number;
  monitored_users: number;
  high_risk_listings: number;
  pending_matches: number;
  /** Members who told us they need support and no broker has seen since. */
  support_needs_unseen: number;
  /** Prepared actions waiting for the supported member's answer. */
  pending_support_actions: number;
}

interface BrokerSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  badges: BrokerBadgeCounts;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  path: string;
  badgeKey?: keyof BrokerBadgeCounts;
}

interface NavSection {
  key: string;
  title: string;
  items: NavItem[];
}

export function BrokerSidebar({ collapsed, onToggle, badges }: BrokerSidebarProps) {
  const { t } = useTranslation('broker');
  const location = useLocation();
  const { tenantPath, tenant, hasFeature, hasModule } = useTenant();
  const { user } = useAuth();

  // Exchanges is the only broker surface that depends on the exchange_workflow
  // feature; the rest of the panel (compliance, members, monitoring) is always
  // available to brokers. Hide the nav item on tenants without the feature.
  const showExchanges = hasFeature('exchange_workflow');
  const showFeedModeration = hasModule('feed');
  const showReviewsModeration = hasFeature('reviews');
  const showVolunteering = hasFeature('volunteering');

  // Check if user also has admin access for the "Full Admin" link.
  const hasAdminAccess = hasAdminPanelAccess(user);

  const sections: NavSection[] = [
    {
      key: 'overview',
      title: t('sidebar.section_overview'),
      items: [
        { key: 'dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, path: '/broker' },
      ],
    },
    {
      key: 'daily',
      title: t('sidebar.section_daily'),
      items: [
        { key: 'members', label: t('nav.members'), icon: Users, path: '/broker/members', badgeKey: 'pending_members' },
        { key: 'onboarding', label: t('nav.onboarding'), icon: UserPlus, path: '/broker/onboarding' },
        ...(showExchanges
          ? ([
              { key: 'exchanges', label: t('nav.exchanges'), icon: ArrowLeftRight, path: '/broker/exchanges', badgeKey: 'pending_exchanges' },
              { key: 'match-approvals', label: t('nav.match_approvals'), icon: UserCheck, path: '/broker/match-approvals', badgeKey: 'pending_matches' },
            ] as NavItem[])
          : []),
        { key: 'messages', label: t('nav.messages'), icon: MessageSquareWarning, path: '/broker/messages', badgeKey: 'unreviewed_messages' },
      ],
    },
    {
      // One page per safeguarding job (Oct 2026). These were tabs on a
      // single page and brokers said things were hidden; Members' support
      // needs leads because those answers change what a member can do.
      // Flagged messages are not here: they are the Messages queue above.
      key: 'safeguarding',
      title: t('sidebar.section_safeguarding'),
      items: [
        { key: 'safeguarding-support-needs', label: t('nav.safeguarding_support_needs'), icon: HeartHandshake, path: '/broker/safeguarding/support-needs', badgeKey: 'support_needs_unseen' },
        { key: 'safeguarding-guardians', label: t('nav.safeguarding_guardians'), icon: Users, path: '/broker/safeguarding/guardians' },
        { key: 'safeguarding-support-actions', label: t('nav.safeguarding_support_actions'), icon: ClipboardCheck, path: '/broker/safeguarding/support-actions', badgeKey: 'pending_support_actions' },
        ...(showVolunteering
          ? ([{ key: 'safeguarding-volunteering', label: t('nav.safeguarding_volunteering'), icon: HandHeart, path: '/broker/safeguarding/volunteering' }] as NavItem[])
          : []),
        { key: 'safeguarding-options', label: t('nav.safeguarding_options'), icon: SlidersHorizontal, path: '/broker/safeguarding-options' },
      ],
    },
    {
      key: 'moderation',
      title: t('sidebar.section_moderation'),
      items: [
        { key: 'moderation-queue', label: t('nav.moderation_queue'), icon: ShieldPlus, path: '/broker/moderation/queue' },
        ...(showFeedModeration
          ? ([{ key: 'moderation-feed', label: t('nav.moderation_feed'), icon: MessageSquare, path: '/broker/moderation/feed' }] as NavItem[])
          : []),
        { key: 'moderation-comments', label: t('nav.moderation_comments'), icon: MessageCircle, path: '/broker/moderation/comments' },
        ...(showReviewsModeration
          ? ([{ key: 'moderation-reviews', label: t('nav.moderation_reviews'), icon: Star, path: '/broker/moderation/reviews' }] as NavItem[])
          : []),
        { key: 'moderation-reports', label: t('nav.moderation_reports'), icon: Flag, path: '/broker/moderation/reports' },
      ],
    },
    {
      key: 'compliance',
      title: t('sidebar.section_compliance'),
      items: [
        { key: 'vetting', label: t('nav.vetting'), icon: ShieldCheck, path: '/broker/vetting', badgeKey: 'vetting_review_requests' },
        { key: 'monitoring', label: t('nav.monitoring'), icon: Eye, path: '/broker/monitoring', badgeKey: 'monitored_users' },
        { key: 'risk-tags', label: t('nav.risk_tags'), icon: AlertTriangle, path: '/broker/risk-tags', badgeKey: 'high_risk_listings' },
        { key: 'insurance', label: t('nav.insurance'), icon: FileText, path: '/broker/insurance' },
      ],
    },
    {
      key: 'records',
      title: t('sidebar.section_records'),
      items: [
        { key: 'archives', label: t('nav.archives'), icon: Archive, path: '/broker/archives' },
      ],
    },
    {
      key: 'settings',
      title: t('sidebar.section_settings'),
      items: [
        { key: 'configuration', label: t('nav.configuration'), icon: SlidersHorizontal, path: '/broker/configuration' },
        { key: 'help', label: t('nav.help'), icon: HelpCircle, path: '/broker/help' },
      ],
    },
  ];

  const isActive = (path: string) => {
    const current = location.pathname;
    if (path === '/broker' || path === `${tenant?.slug ? `/${tenant.slug}` : ''}/broker`) {
      return current === tenantPath('/broker') || current === tenantPath('/broker/');
    }
    // Exact match or a `/`-delimited descendant only — a bare prefix match
    // would light "/broker/safeguarding" for "/broker/safeguarding-options"
    // (and any other sibling whose path is a string prefix of another).
    const target = tenantPath(path);
    return current === target || current.startsWith(target + '/');
  };

  const renderItem = (item: NavItem) => {
    const active = isActive(item.path);
    const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
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
          {!collapsed && (
            <>
              <span className="flex-1 truncate">{item.label}</span>
              {badgeCount > 0 && (
                <Chip size="sm" color={active ? 'accent' : 'danger'} variant="tertiary" className="min-w-[24px] h-5 text-xs tabular-nums">
                  {badgeCount > 99 ? '99+' : badgeCount}
                </Chip>
              )}
            </>
          )}
          {collapsed && badgeCount > 0 && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-danger" />
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

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-divider bg-surface transition-all duration-300 flex flex-col ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Header */}
      <div className="flex h-16 items-center justify-between border-b border-divider px-3">
        {!collapsed && (
          <Link to={tenantPath('/broker')} className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-inset ring-accent/20">
              <ShieldCheck size={18} />
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
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                {section.title}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {section.items.map(renderItem)}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer — Admin panel link for admins */}
      {hasAdminAccess && (
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
      )}
    </aside>
  );
}

export default BrokerSidebar;
