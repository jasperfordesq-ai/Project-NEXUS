// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Dashboard ("Mission Control")
 *
 * Top to bottom: what needs a decision now, four headline numbers with their
 * change against last month, four supporting numbers, quick links, then the
 * exchange chart beside the latest activity. Every number card is a link into
 * the page that explains it, with the matching filter already applied.
 *
 * Polished 2026-10-04. Before that the eight cards went nowhere, "Active users"
 * meant approved accounts, the trend was text rows with an inline-style bar
 * flattened by a 3,000-hour opening-balance import, and a failed load showed a
 * row of dashes with no message.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import UserCheck from 'lucide-react/icons/user-check';
import UserPlus from 'lucide-react/icons/user-plus';
import ListChecks from 'lucide-react/icons/list-checks';
import FileCheck from 'lucide-react/icons/file-check';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Clock from 'lucide-react/icons/clock';
import History from 'lucide-react/icons/history';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import PenSquare from 'lucide-react/icons/square-pen';
import Trophy from 'lucide-react/icons/trophy';
import Settings from 'lucide-react/icons/settings';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Building2 from 'lucide-react/icons/building-2';
import { Alert, Button, Card, CardBody, Skeleton } from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import { isGodUser } from '@/lib/access';
import { formatRelativeTime } from '@/lib/helpers';
import { useOnboardingConfig } from '@/hooks/useOnboardingConfig';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminDashboard } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { useAdminBadgeCounts } from '../../hooks/useAdminBadgeCounts';
import type { AdminDashboardStats, ActivityLogEntry, MonthlyTrend } from '../../api/types';
import { AttentionStrip } from './AttentionStrip';
import { ExchangeTrendChart } from './ExchangeTrendChart';
import { RecentActivityFeed } from './RecentActivityFeed';

const TREND_MONTHS = 12;

export function AdminDashboard() {
  const { t } = useTranslation('admin_dashboard');
  useAdminPageMeta({ title: t('title'), description: t('subtitle') });
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const { user } = useAuth();
  // The Enterprise dashboard is god accounts only (owner decision 2026-10-02).
  const isGod = isGodUser(user);
  const toast = useToast();
  const { counts: badgeCounts, loaded: badgesLoaded, refresh: refreshBadges } = useAdminBadgeCounts();

  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [activityFailed, setActivityFailed] = useState(false);
  const [trends, setTrends] = useState<MonthlyTrend[]>([]);
  const [trendsFailed, setTrendsFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Surface a prominent banner when the onboarding safeguarding step is off.
  // Without it, members cannot declare vulnerability or vetting needs during
  // onboarding, and admins never get the safeguarding alerts that would
  // otherwise fire on self-declaration.
  const { config: onboardingConfig, isLoading: onboardingLoading } = useOnboardingConfig();
  const showSafeguardingBanner =
    !onboardingLoading && onboardingConfig.step_safeguarding_enabled === false;

  const loadDashboard = useCallback(async (isRefresh = false) => {
    setLoading(true);
    // api.ts never throws: a failure comes back as { success: false }. The
    // three requests are independent, so one failing must not blank the rest.
    const [statsRes, activityRes, trendsRes] = await Promise.all([
      adminDashboard.getStats(),
      adminDashboard.getActivity(1, 10),
      adminDashboard.getTrends(TREND_MONTHS),
    ]);

    const statsOk = statsRes.success && !!statsRes.data && typeof statsRes.data === 'object';
    if (statsOk) {
      setStats(statsRes.data as AdminDashboardStats);
      setLoadError(false);
    } else {
      setLoadError(true);
      if (isRefresh) toast.error(t('load_error'));
    }

    if (activityRes.success && Array.isArray(activityRes.data)) {
      setActivity(activityRes.data);
      setActivityFailed(false);
    } else {
      setActivityFailed(true);
    }

    if (trendsRes.success && Array.isArray(trendsRes.data)) {
      setTrends(trendsRes.data);
      const failedSeries = (trendsRes.meta as { _failed_metrics?: string[] } | undefined)?._failed_metrics ?? [];
      setTrendsFailed(failedSeries.includes('transactions'));
    } else {
      setTrendsFailed(true);
    }

    setUpdatedAt(new Date());
    setLoading(false);
    if (isRefresh) void refreshBadges();
  }, [toast, t, refreshBadges]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const failed = useCallback(
    (metric: string) => stats?._failed_metrics?.includes(metric) ?? false,
    [stats],
  );

  const wallet = hasModule('wallet');
  const exchangesPath = wallet ? '/admin/timebanking' : '/admin/community-analytics';
  const hoursPath = wallet ? '/admin/reports/hours' : '/admin/community-analytics';

  /** Quick links — the same pages as the sidebar's most-used entries. */
  const quickActions = useMemo(() => [
    { key: 'manage_users', path: '/admin/users', icon: UserPlus },
    { key: 'view_listings', path: '/admin/listings', icon: ListChecks },
    ...(hasFeature('newsletter') ? [{ key: 'send_newsletter', path: '/admin/newsletters', icon: Send }] : []),
    { key: 'new_blog_post', path: '/admin/blog/create', icon: PenSquare },
    { key: 'gamification', path: '/admin/gamification', icon: Trophy },
    { key: 'activity_log', path: '/admin/activity-log', icon: History },
    { key: 'settings', path: '/admin/settings', icon: Settings },
  ], [hasFeature]);

  const firstLoad = loading && !stats && !loadError;
  const hardFailure = loadError && !stats;
  const couldNotLoad = t('stats.could_not_load');
  const vsLastMonth = t('stats.vs_last_month');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex items-center gap-3">
            {updatedAt && !loading && (
              <span className="hidden text-xs text-muted sm:inline" data-testid="dashboard-updated-at">
                {t('updated_ago', { time: formatRelativeTime(updatedAt.toISOString()) })}
              </span>
            )}
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} aria-hidden="true" />}
              onPress={() => void loadDashboard(true)}
              isLoading={loading}
              size="sm"
            >
              {t('refresh')}
            </Button>
          </div>
        }
      />

      {showSafeguardingBanner && (
        <Card
          className="border border-danger/20 border-l-4 border-l-danger bg-danger/5 shadow-sm shadow-danger/10"
          data-testid="safeguarding-disabled-banner"
        >
          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger/10">
              <ShieldAlert size={22} className="text-danger" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-danger">{t('safeguarding_banner.title')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('safeguarding_banner.body')}</p>
            </div>
            <Button as={Link} to={tenantPath('/admin/onboarding-settings')} size="sm" variant="danger" className="shrink-0">
              {t('safeguarding_banner.cta')}
            </Button>
          </CardBody>
        </Card>
      )}

      {stats?._partial && (
        <Alert
          role="status"
          color="warning"
          className="rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm"
          classNames={{
            title: 'text-sm font-semibold text-foreground',
            description: 'text-sm leading-6 text-foreground',
            icon: 'text-warning',
          }}
          icon={<AlertCircle size={20} aria-hidden="true" />}
          title={t('partial.title')}
          description={t('partial.body')}
          endContent={
            <Button size="sm" variant="secondary" className="shrink-0 self-center" onPress={() => void loadDashboard(true)}>
              {t('partial.retry')}
            </Button>
          }
          data-testid="dashboard-partial-banner"
        />
      )}

      {firstLoad ? (
        <DashboardSkeleton label={t('loading')} />
      ) : hardFailure ? (
        <EmptyState
          icon={AlertCircle}
          title={t('error.title')}
          description={t('error.hint')}
          actionLabel={t('error.retry')}
          onAction={() => void loadDashboard(true)}
        />
      ) : (
        <>
          <AttentionStrip
            counts={badgeCounts}
            loaded={badgesLoaded}
            pendingOrganisations={stats?.pending_organisations}
          />

          {/* Headline numbers — each links to the page that explains it. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="headline-stats">
            <StatCard
              label={t('stats.members')}
              value={stats?.total_users ?? '—'}
              icon={Users}
              color="primary"
              loading={loading}
              trend={stats?.members_delta_pct}
              trendLabel={vsLastMonth}
              description={
                (stats?.pending_users ?? 0) > 0
                  ? t('stats.members_hint', { count: stats?.pending_users ?? 0 })
                  : undefined
              }
              to={tenantPath('/admin/users')}
              failed={failed('total_users')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.active_listings')}
              value={stats?.active_listings ?? '—'}
              icon={FileCheck}
              color="success"
              loading={loading}
              description={
                typeof stats?.total_listings === 'number'
                  ? t('stats.of_total', { count: stats.total_listings })
                  : undefined
              }
              to={tenantPath('/admin/listings?status=active')}
              failed={failed('active_listings')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.exchanges_this_month')}
              value={stats?.exchanges_this_month ?? '—'}
              icon={ArrowLeftRight}
              color="secondary"
              loading={loading}
              trend={stats?.exchanges_delta_pct}
              trendLabel={vsLastMonth}
              to={tenantPath(exchangesPath)}
              failed={failed('exchanges_this_month')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.hours_this_month')}
              value={stats?.exchange_hours_this_month ?? '—'}
              icon={Clock}
              color="warning"
              loading={loading}
              trend={stats?.exchange_hours_delta_pct}
              trendLabel={vsLastMonth}
              to={tenantPath(hoursPath)}
              failed={failed('exchanges_this_month')}
              failedLabel={couldNotLoad}
            />
          </div>

          {/* Supporting numbers. */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4" data-testid="secondary-stats">
            <StatCard
              label={t('stats.active_members_30d', { days: stats?.active_users_window_days ?? 30 })}
              value={stats?.active_users ?? '—'}
              icon={UserCheck}
              color="default"
              loading={loading}
              to={tenantPath('/admin/reports/members')}
              failed={failed('active_users')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.new_members_this_month')}
              value={stats?.new_users_this_month ?? '—'}
              icon={UserPlus}
              color="default"
              loading={loading}
              trend={stats?.new_users_delta_pct}
              trendLabel={vsLastMonth}
              to={tenantPath('/admin/reports/members')}
              failed={failed('new_users_this_month')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.total_listings')}
              value={stats?.total_listings ?? '—'}
              icon={ListChecks}
              color="default"
              loading={loading}
              to={tenantPath('/admin/listings')}
              failed={failed('total_listings')}
              failedLabel={couldNotLoad}
            />
            <StatCard
              label={t('stats.hours_all_time')}
              value={stats?.total_hours_exchanged ?? '—'}
              icon={Clock}
              color="default"
              loading={loading}
              description={
                typeof stats?.total_transactions === 'number'
                  ? t('stats.exchanges_count', { count: stats.total_transactions })
                  : undefined
              }
              to={tenantPath(exchangesPath)}
              failed={failed('exchanges_all_time')}
              failedLabel={couldNotLoad}
            />
          </div>

          {/* Quick links — one compact row; the sidebar has the same pages. */}
          <nav aria-label={t('quick_actions.card_title')} className="flex flex-wrap items-center gap-2">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.path}
                  as={Link}
                  to={tenantPath(action.path)}
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  startContent={<Icon size={14} aria-hidden="true" />}
                >
                  {t(`quick_actions.${action.key}`)}
                </Button>
              );
            })}
            {isGod && (
              <Button
                as={Link}
                to={tenantPath('/admin/enterprise')}
                size="sm"
                variant="tertiary"
                className="rounded-full"
                startContent={<Building2 size={14} aria-hidden="true" />}
              >
                {t('quick_actions.enterprise')}
              </Button>
            )}
          </nav>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ExchangeTrendChart trends={trends} loading={loading && trends.length === 0} failed={trendsFailed} />
            </div>
            <RecentActivityFeed entries={activity} loading={loading && activity.length === 0} failed={activityFailed} />
          </div>
        </>
      )}
    </div>
  );
}

/** First-load placeholder in the shape of the finished page, so nothing jumps. */
function DashboardSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="space-y-6" data-testid="dashboard-skeleton">
      <Skeleton className="h-24 w-full rounded-2xl bg-surface-tertiary" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl bg-surface-tertiary" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl bg-surface-tertiary" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-2xl bg-surface-tertiary lg:col-span-2" />
        <Skeleton className="h-80 rounded-2xl bg-surface-tertiary" />
      </div>
    </div>
  );
}

export default AdminDashboard;
