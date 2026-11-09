// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Hub Page - Main landing page for federation features
 *
 * Sections (opted-out state):
 *   1. Hero with CTA to enable federation
 *   2. How It Works cards
 *
 * Sections (opted-in state):
 *   1. Stats row (partners, messages, transactions, status)
 *   2. Quick navigation links
 *   3. Partner communities preview
 *   4. Recent federation activity
 *   5. Opt-out footer link
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import Users from 'lucide-react/icons/users';
import MessageSquare from 'lucide-react/icons/message-square';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Search from 'lucide-react/icons/search';
import Settings from 'lucide-react/icons/settings';
import Calendar from 'lucide-react/icons/calendar';
import ListTodo from 'lucide-react/icons/list-todo';
import ArrowRight from 'lucide-react/icons/arrow-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Activity from 'lucide-react/icons/activity';
import Network from 'lucide-react/icons/network';
import Handshake from 'lucide-react/icons/handshake';
import Shield from 'lucide-react/icons/shield';
import Zap from 'lucide-react/icons/zap';
import ChevronRight from 'lucide-react/icons/chevron-right';
import UserPlus from 'lucide-react/icons/user-plus';
import UsersRound from 'lucide-react/icons/users-round';
import Send from 'lucide-react/icons/send';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Breadcrumbs, type BreadcrumbItem } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import type {
  FederationStatus,
  FederationPartner,
  FederationActivityItem,
} from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface FederationDashboardData {
  status: FederationStatus | null;
  partners: FederationPartner[];
  activity: FederationActivityItem[];
  stats: {
    partners_count: number;
    messages_count: number;
    transactions_count: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Breadcrumbs are constructed inside the component to use tenantPath()
// const breadcrumbs — see FederationHubPage body

const howItWorksCards = [
  {
    key: 'discover',
    icon: Search,
    tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200',
  },
  {
    key: 'connect',
    icon: Users,
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
  {
    key: 'exchange',
    icon: ArrowRightLeft,
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  },
];

const quickLinks = [
  {
    icon: Globe,
    href: '/federation/partners',
    tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200',
  },
  {
    icon: Users,
    href: '/federation/members',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
  },
  {
    icon: MessageSquare,
    href: '/federation/messages',
    tone: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200',
  },
  {
    icon: ListTodo,
    href: '/federation/listings',
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
  },
  {
    icon: Calendar,
    href: '/federation/events',
    tone: 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-200',
  },
  // Labels are index-based (hub.quick_link_<index>_*): groups=5, connections=6,
  // settings=7 — keep this array order in sync with the locale keys.
  {
    icon: UsersRound,
    href: '/federation/groups',
    tone: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-200',
  },
  {
    icon: UserPlus,
    href: '/federation/connections',
    tone: 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-200',
  },
  {
    icon: Settings,
    href: '/federation/settings',
    tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
];

const activityIcons: Record<FederationActivityItem['type'], typeof Activity> = {
  message_received: MessageSquare,
  message_sent: Send,
  transaction_received: ArrowRightLeft,
  transaction_sent: ArrowRightLeft,
  partnership_approved: Handshake,
  member_joined: UserPlus,
};

const federationLevelColors: Record<number, 'default' | 'primary' | 'secondary' | 'success' | 'warning'> = {
  1: 'default',
  2: 'primary',
  3: 'secondary',
  4: 'success',
};

// Translation-first level labels: the backend's federation_level_name is
// always English, so it is only a fallback for unmapped levels (e.g. external).
const federationLevelLabelKeys: Record<number, string> = {
  1: 'partners.level_discovery',
  2: 'partners.level_social',
  3: 'partners.level_economic',
  4: 'partners.level_integrated',
};

// ─────────────────────────────────────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

// ─────────────────────────────────────────────────────────────────────────────
// Hero Section (Not opted in)
// ─────────────────────────────────────────────────────────────────────────────

function FederationHero({ onOptIn, isOptingIn }: { onOptIn: () => void; isOptingIn: boolean }) {
  const { t } = useTranslation('federation');
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="text-center"
    >
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-xl border border-theme-default bg-theme-surface p-8 shadow-sm md:p-12 mb-8 text-center">
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="mx-auto mb-6 w-20 h-20 rounded-2xl bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200 flex items-center justify-center"
          >
            <Network className="w-10 h-10" aria-hidden="true" />
          </motion.div>

          {/* h2: the page's one h1 is the panel above (hub.title). */}
          <h2 className="text-3xl md:text-4xl font-bold text-theme-primary mb-4">
            {t('hub.hero_title')}
          </h2>
          <p className="text-lg text-theme-muted mb-8 max-w-2xl mx-auto">
            {t('hub.hero_description')}
          </p>

          <Button
            size="lg"
            color="primary"
            className="px-8"
            onPress={onOptIn}
            isLoading={isOptingIn}
            startContent={!isOptingIn ? <Globe className="w-5 h-5" aria-hidden="true" /> : undefined}
          >
            {t('hub.enable_federation')}
          </Button>
        </div>
      </div>

      {/* How It Works */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-foreground mb-6">{t('hub.how_it_works')}</h2>
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          {howItWorksCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <motion.div key={card.key} variants={itemVariants}>
                <GlassCard className="p-6 h-full text-center">
                  <div className="relative mx-auto mb-4">
                    <div
                      className={`w-14 h-14 rounded-xl ${card.tone} flex items-center justify-center mx-auto`}
                    >
                      <Icon className="w-7 h-7" aria-hidden="true" />
                    </div>
                    <span
                      className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-foreground text-background text-xs font-bold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{t(`hub.how_it_works_${index}_title`)}</h3>
                  <p className="text-sm text-muted">{t(`hub.how_it_works_${index}_description`)}</p>
                </GlassCard>
              </motion.div>
            );
          })}
        </motion.div>
      </div>

      {/* Feature highlights */}
      <GlassCard className="p-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
          <div>
            <Shield className="w-8 h-8 text-emerald-500 mx-auto mb-2" aria-hidden="true" />
            <h4 className="font-semibold text-foreground mb-1">{t('hub.feature_privacy_title')}</h4>
            <p className="text-sm text-muted">
              {t('hub.feature_privacy_description')}
            </p>
          </div>
          <div>
            <Zap className="w-8 h-8 text-[var(--color-warning)] mx-auto mb-2" aria-hidden="true" />
            <h4 className="font-semibold text-foreground mb-1">{t('hub.feature_instant_title')}</h4>
            <p className="text-sm text-muted">
              {t('hub.feature_instant_description')}
            </p>
          </div>
          <div>
            <Handshake className="w-8 h-8 text-sky-600 dark:text-sky-300 mx-auto mb-2" aria-hidden="true" />
            <h4 className="font-semibold text-foreground mb-1">{t('hub.feature_network_title')}</h4>
            <p className="text-sm text-muted">
              {t('hub.feature_network_description')}
            </p>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats Row
// ─────────────────────────────────────────────────────────────────────────────

function StatsRow({ stats, enabled }: { stats: FederationDashboardData['stats']; enabled: boolean }) {
  const { t } = useTranslation('federation');
  const statCards = [
    {
      label: t('hub.stat_partners'),
      value: stats.partners_count,
      icon: Globe,
      tone: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-200',
    },
    {
      label: t('hub.stat_messages'),
      value: stats.messages_count,
      icon: MessageSquare,
      tone: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200',
    },
    {
      label: t('hub.stat_exchanges'),
      value: stats.transactions_count,
      icon: ArrowRightLeft,
      tone: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-200',
    },
    {
      label: t('hub.stat_status'),
      value: null,
      icon: Activity,
      tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200',
      chipContent: enabled ? t('hub.status_active') : t('hub.status_inactive'),
      chipColor: enabled ? ('success' as const) : ('default' as const),
    },
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
    >
      {statCards.map((card) => {
        const Icon = card.icon;
        return (
          <motion.div key={card.label} variants={itemVariants}>
            <GlassCard className="p-5">
              <div className="flex items-start justify-between mb-3">
                <div
                  className={`w-10 h-10 rounded-lg ${card.tone} flex items-center justify-center flex-shrink-0`}
                >
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </div>
              </div>
              {card.value !== null ? (
                <p className="text-2xl font-bold text-foreground">{card.value}</p>
              ) : (
                <Chip
                  size="sm"
                  color={card.chipColor}
                  variant="flat"
                  startContent={
                    card.chipColor === 'success' ? (
                      <CheckCircle className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <XCircle className="w-3 h-3" aria-hidden="true" />
                    )
                  }
                >
                  {card.chipContent}
                </Chip>
              )}
              <p className="text-xs text-muted mt-1">{card.label}</p>
            </GlassCard>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick Links
// ─────────────────────────────────────────────────────────────────────────────

function QuickLinksSection() {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('federation');
  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-foreground mb-4">{t('hub.explore_network')}</h2>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 md:grid-cols-3 gap-4"
      >
        {quickLinks.map((link, index) => {
          const Icon = link.icon;
          return (
            <motion.div key={link.href} variants={itemVariants}>
              <Link to={tenantPath(link.href)} className="block group">
                <GlassCard className="p-4 h-full transition-all duration-200 group-hover:shadow-lg group-hover:scale-[1.02]">
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg ${link.tone} flex items-center justify-center flex-shrink-0`}
                    >
                      <Icon className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground text-sm leading-tight mb-1 group-hover:text-accent transition-colors">
                        {t(`hub.quick_link_${index}_title`)}
                      </h3>
                      <p className="text-xs text-muted line-clamp-2">{t(`hub.quick_link_${index}_description`)}</p>
                    </div>
                  </div>
                </GlassCard>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner Communities Section
// ─────────────────────────────────────────────────────────────────────────────

function PartnerCommunitiesSection({ partners }: { partners: FederationPartner[] }) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('federation');
  if (partners.length === 0) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-foreground">{t('hub.partner_communities')}</h2>
        </div>
        <GlassCard className="p-8 text-center">
          <Globe className="w-12 h-12 text-muted/60 mx-auto mb-3" aria-hidden="true" />
          <p className="text-muted mb-1">{t('hub.no_partners_yet')}</p>
          <p className="text-sm text-muted">
            {t('hub.no_partners_description')}
          </p>
        </GlassCard>
      </div>
    );
  }

  const displayPartners = partners.slice(0, 4);

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-foreground">{t('hub.partner_communities')}</h2>
        {partners.length > 4 && (
          <Link
            to={tenantPath("/federation/partners")}
            className="text-sm text-accent hover:text-accent flex items-center gap-1 transition-colors"
          >
            {t('hub.view_all', { count: partners.length })}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {displayPartners.map((partner) => (
          <motion.div key={partner.id} variants={itemVariants}>
            <GlassCard className="p-5 h-full flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <Avatar
                  src={partner.logo ? resolveAvatarUrl(partner.logo) : undefined}
                  name={partner.name}
                  size="md"
                  className="flex-shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-foreground text-sm truncate">{partner.name}</h3>
                  {partner.location && (
                    <p className="text-xs text-muted truncate">{partner.location}</p>
                  )}
                </div>
              </div>

              {partner.tagline && (
                <p className="text-xs text-muted mb-3 line-clamp-2">{partner.tagline}</p>
              )}

              <div className="flex items-center gap-2 mb-3 mt-auto">
                <Chip size="sm" variant="flat" color={federationLevelColors[partner.federation_level] || 'default'}>
                  {federationLevelLabelKeys[partner.federation_level]
                    ? t(federationLevelLabelKeys[partner.federation_level]!)
                    : partner.federation_level_name || t('partners.level_unknown')}
                </Chip>
                <span className="text-xs text-muted">
                  {t('hub.member_count', { count: partner.member_count })}
                </span>
              </div>

              <Button
                as={Link}
                to={tenantPath(`/federation/partners/${partner.id}`)}
                size="sm"
                variant="flat"
                color="primary"
                className="w-full"
                endContent={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                {t('hub.view_community')}
              </Button>
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Recent Activity Section
// ─────────────────────────────────────────────────────────────────────────────

function RecentActivitySection({ activity }: { activity: FederationActivityItem[] }) {
  const { t } = useTranslation('federation');
  if (activity.length === 0) {
    return (
      <div className="mb-8">
        <h2 className="text-xl font-bold text-foreground mb-4">{t('hub.recent_activity')}</h2>
        <GlassCard className="p-8 text-center">
          <Activity className="w-12 h-12 text-muted/60 mx-auto mb-3" aria-hidden="true" />
          <p className="text-muted mb-1">{t('hub.no_activity_yet')}</p>
          <p className="text-sm text-muted">
            {t('hub.no_activity_description')}
          </p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="mb-8">
      <h2 className="text-xl font-bold text-foreground mb-4">{t('hub.recent_activity')}</h2>
      <GlassCard className="divide-y divide-default-200">
        <AnimatePresence>
          {activity.slice(0, 5).map((item, index) => {
            const Icon = activityIcons[item.type] || Activity;
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-start gap-3 p-4"
              >
                <div className="w-9 h-9 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Icon className="w-[18px] h-[18px] text-foreground/70" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted mt-0.5 line-clamp-1">
                        {item.description}
                      </p>
                    </div>
                    <span className="text-xs text-muted whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                      <Clock className="w-3 h-3" aria-hidden="true" />
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </div>
                  {item.actor && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <Avatar
                        src={resolveAvatarUrl(item.actor.avatar)}
                        name={item.actor.name}
                        size="sm"
                        className="w-5 h-5"
                      />
                      <span className="text-xs text-muted">
                        {item.actor.name}
                        {item.actor.tenant_name && (
                          <span className="text-muted"> {t('hub.from_community', { community: item.actor.tenant_name })}</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </GlassCard>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

export default function FederationHubPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('hub.page_title'));

  const { tenant, tenantPath } = useTenant();
  const toast = useToast();

  const breadcrumbs: BreadcrumbItem[] = [
    { label: t('hub.breadcrumb_dashboard'), href: tenantPath('/dashboard') },
    { label: t('hub.breadcrumb_federation') },
  ];

  const [isLoading, setIsLoading] = useState(true);
  const [isOptingIn, setIsOptingIn] = useState(false);
  const [isOptingOut, setIsOptingOut] = useState(false);
  const [showOptOutConfirm, setShowOptOutConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FederationDashboardData>({
    status: null,
    partners: [],
    activity: [],
    stats: { partners_count: 0, messages_count: 0, transactions_count: 0 },
  });

  const isOptedIn = data.status?.enabled ?? false;

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ─── Load federation data ───

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch status first to determine if opted in
      const statusRes = await api.get<FederationStatus>('/v2/federation/status', { signal: controller.signal });

      if (controller.signal.aborted) return;

      if (!statusRes.success || !statusRes.data) {
        setError(tRef.current('hub.error_load_status'));
        setIsLoading(false);
        return;
      }

      const status = statusRes.data;
      const newData: FederationDashboardData = {
        status,
        partners: [],
        activity: [],
        stats: {
          partners_count: status.partnerships_count || 0,
          messages_count: status.messages_count || 0,
          transactions_count: status.transactions_count || 0,
        },
      };

      // If opted in, load additional data in parallel
      if (status.enabled) {
        const [partnersRes, activityRes] = await Promise.all([
          api.get<FederationPartner[]>('/v2/federation/partners', { signal: controller.signal }),
          api.get<FederationActivityItem[]>('/v2/federation/activity', { signal: controller.signal }),
        ]);

        if (controller.signal.aborted) return;

        if (partnersRes.success && partnersRes.data) {
          const partnersData = Array.isArray(partnersRes.data)
            ? partnersRes.data
            : [];
          newData.partners = partnersData;
          newData.stats.partners_count = partnersData.length;
        }

        if (activityRes.success && activityRes.data) {
          newData.activity = Array.isArray(activityRes.data)
            ? activityRes.data
            : [];
        }
      }

      setData(newData);
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('FederationHubPage: Failed to load data', err);
      setError(tRef.current('hub.error_generic'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  // ─── Opt in ───

  const handleOptIn = useCallback(async () => {
    setIsOptingIn(true);
    try {
      const res = await api.post<{ success: boolean }>('/v2/federation/opt-in');
      if (res.success) {
        toastRef.current.success(tRef.current('hub.toast_enabled_title'), tRef.current('hub.toast_enabled_description'));
        await loadData();
      } else {
        toastRef.current.error(tRef.current('hub.toast_enable_error_title'), tRef.current('hub.toast_enable_error_description'));
      }
    } catch (err) {
      logError('FederationHubPage: Opt-in failed', err);
      toastRef.current.error(tRef.current('hub.toast_error'), tRef.current('hub.toast_enable_error_generic'));
    } finally {
      setIsOptingIn(false);
    }
  }, [loadData]);

  // ─── Opt out ───

  const handleOptOut = useCallback(async () => {
    setIsOptingOut(true);
    try {
      const res = await api.post<{ success: boolean }>('/v2/federation/opt-out');
      if (res.success) {
        toastRef.current.info(tRef.current('hub.toast_disabled_title'), tRef.current('hub.toast_disabled_description'));
        setShowOptOutConfirm(false);
        await loadData();
      } else {
        toastRef.current.error(tRef.current('hub.toast_disable_error_title'), tRef.current('hub.toast_disable_error_description'));
      }
    } catch (err) {
      logError('FederationHubPage: Opt-out failed', err);
      toastRef.current.error(tRef.current('hub.toast_error'), tRef.current('hub.toast_disable_error_generic'));
    } finally {
      setIsOptingOut(false);
    }
  }, [loadData]);

  // ─── Loading state ───

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Breadcrumbs items={breadcrumbs} />
        <div role="status" aria-busy="true" aria-label={t('hub.loading')} className="flex flex-col items-center justify-center py-24">
          <Spinner size="lg" color="primary" />
          <p className="text-muted mt-4">{t('hub.loading')}</p>
        </div>
      </div>
    );
  }

  // ─── Error state ───

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Breadcrumbs items={breadcrumbs} />
        <GlassCard role="alert" className="p-12 text-center mt-6">
          <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-xl font-semibold text-foreground mb-2">{t('hub.unable_to_load')}</h2>
          <p className="text-muted mb-6">{error}</p>
          <Button
            color="primary"
            variant="flat"
            onPress={loadData}
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
          >
            {t('hub.try_again')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  // ─── Tenant federation not enabled ───

  if (data.status && !data.status.tenant_federation_enabled) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <Breadcrumbs items={breadcrumbs} />
        <GlassCard className="p-12 text-center mt-6">
          <Network className="w-16 h-16 text-muted/60 mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-2xl font-bold text-foreground mb-2">{t('hub.not_available_title')}</h2>
          <p className="text-muted mb-2">
            {t('hub.not_available_description', { community: tenant?.name || t('hub.your_community') })}
          </p>
          <p className="text-sm text-muted">
            {t('hub.not_available_contact')}
          </p>
        </GlassCard>
      </div>
    );
  }

  // ─── Render ───

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <PageMeta title={t('hub.page_title')} noIndex />
      <Breadcrumbs items={breadcrumbs} />

      {/* Page header — the same soft panel in the community colour that opens
          the offers, events and groups pages (AWID: warmer, more inviting). */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mt-4 mb-8"
      >
        <PublicPageHero
          size="full"
          title={t('hub.title')}
          description={isOptedIn
            ? t('hub.subtitle_opted_in')
            : t('hub.subtitle_opted_out')}
          icon={<Network className="h-7 w-7" aria-hidden="true" />}
          accent="indigo"
        />
      </motion.div>

      {/* Not opted in: show hero */}
      {!isOptedIn && <FederationHero onOptIn={handleOptIn} isOptingIn={isOptingIn} />}

      {/* Opted in: show dashboard */}
      {isOptedIn && (
        <>
          <StatsRow stats={data.stats} enabled={isOptedIn} />
          <QuickLinksSection />
          <PartnerCommunitiesSection partners={data.partners} />
          <RecentActivitySection activity={data.activity} />

          {/* Opt-out footer */}
          <div className="border-t border-border pt-6 mt-4 text-center">
            {!showOptOutConfirm ? (
              <Button
                variant="light"
                color="default"
                size="sm"
                onPress={() => setShowOptOutConfirm(true)}
                className="text-muted hover:text-danger"
              >
                {t('hub.disable_federation')}
              </Button>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex flex-col items-center gap-3"
              >
                <p className="text-sm text-muted">
                  {t('hub.disable_confirm_message')}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    variant="flat"
                    color="danger"
                    size="sm"
                    onPress={handleOptOut}
                    isLoading={isOptingOut}
                  >
                    {t('hub.disable_confirm_yes')}
                  </Button>
                  <Button
                    variant="flat"
                    size="sm"
                    onPress={() => setShowOptOutConfirm(false)}
                  >
                    {t('hub.disable_confirm_cancel')}
                  </Button>
                </div>
              </motion.div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
