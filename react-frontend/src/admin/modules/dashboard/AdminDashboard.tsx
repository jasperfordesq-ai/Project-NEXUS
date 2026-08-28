import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Spinner, Button, Chip } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import ListChecks from 'lucide-react/icons/list-checks';
import Building2 from 'lucide-react/icons/building-2';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Clock from 'lucide-react/icons/clock';
import UserCheck from 'lucide-react/icons/user-check';
import UserPlus from 'lucide-react/icons/user-plus';
import FileCheck from 'lucide-react/icons/file-check';
import TrendingUp from 'lucide-react/icons/trending-up';
import Activity from 'lucide-react/icons/activity';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import PenSquare from 'lucide-react/icons/square-pen';
import Trophy from 'lucide-react/icons/trophy';
import Settings from 'lucide-react/icons/settings';
import Rocket from 'lucide-react/icons/rocket';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { useTenant, useToast } from '@/contexts';
import { useOnboardingConfig } from '@/hooks/useOnboardingConfig';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminDashboard } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import type { AdminDashboardStats, ActivityLogEntry, MonthlyTrend } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Dashboard
 * Overview with key metrics, activity log, monthly trends, and quick actions.
 * Parity: PHP AdminController::index() / views/modern/admin/dashboard.php
 *
 * Parity notes (vs legacy PHP dashboard):
 * - Stats: Total Users, Active Listings, Transactions, Hours Exchanged -- DONE
 * - Pending alerts: Users, Listings -- DONE
 * - Quick Actions sidebar: Manage Users, View Listings, Newsletters, Blog, Gamification, Settings -- DONE
 * - Activity Log -- DONE
 * - Monthly Trends -- DONE (text bars; legacy uses Chart.js line chart)
 *
 * NOT yet implemented (parity gaps):
 * - Users Online / Active Sessions (LIVE stats) -- backend has no API for this
 * - Platform Modules grid (15 module cards) -- low priority, sidebar already provides navigation
 * - System Status panel (Database/Cache/Cron/Email) -- available at /admin/enterprise/monitoring
 * - Enterprise Suite sidebar links -- available at /admin/enterprise
 * - Transaction Volume chart (Chart.js line chart) -- current text bars are functional
 * - Onboarding Tour -- low priority
 */


export function AdminDashboard() {
  const { t } = useTranslation('admin_dashboard');
  useAdminPageMeta({ title: t('title'), description: t('subtitle') });
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();

  /** Quick action items matching the legacy PHP dashboard sidebar */
  const quickActions = [
    { label: t('quick_actions.manage_users'), path: '/admin/users', icon: UserPlus, color: 'text-accent bg-accent/10' },
    { label: t('quick_actions.view_listings'), path: '/admin/listings', icon: ListChecks, color: 'text-success bg-success/10' },
    ...(hasFeature('newsletter') ? [
      { label: t('quick_actions.send_newsletter'), path: '/admin/newsletters', icon: Send, color: 'text-accent bg-accent-soft' },
    ] : []),
    { label: t('quick_actions.new_blog_post'), path: '/admin/blog/create', icon: PenSquare, color: 'text-danger bg-danger/10' },
    { label: t('quick_actions.gamification'), path: '/admin/gamification', icon: Trophy, color: 'text-warning bg-warning/10' },
    { label: t('quick_actions.settings'), path: '/admin/settings', icon: Settings, color: 'text-muted bg-surface-secondary' },
  ] as const;

  const [stats, setStats] = useState<AdminDashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityLogEntry[]>([]);
  const [trends, setTrends] = useState<MonthlyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  // Surface a prominent banner when the onboarding safeguarding step is off.
  // Without it, members cannot declare vulnerability or vetting needs during
  // onboarding, and admins never get the safeguarding alerts that would
  // otherwise fire on self-declaration.
  const { config: onboardingConfig, isLoading: onboardingLoading } = useOnboardingConfig();
  const showSafeguardingBanner =
    !onboardingLoading && onboardingConfig.step_safeguarding_enabled === false;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, activityRes, trendsRes] = await Promise.all([
        adminDashboard.getStats(),
        adminDashboard.getActivity(1, 10),
        adminDashboard.getTrends(6),
      ]);

      if (statsRes.success && statsRes.data) {
        setStats(statsRes.data);
      }
      if (activityRes.success) {
        // After api.ts unwrapping, activityRes.data is already ActivityLogEntry[]
        const items = activityRes.data;
        if (Array.isArray(items)) {
          setActivity(items);
        }
      }
      if (trendsRes.success && trendsRes.data) {
        setTrends(Array.isArray(trendsRes.data) ? trendsRes.data : []);
      }
    } catch {
      toast.error(t('load_error'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadDashboard}
            isLoading={loading}
            size="sm"
          >
            {t('refresh')}
          </Button>
        }
      />

      {showSafeguardingBanner && (
        <Card
          className="border border-danger/20 border-l-4 border-l-danger bg-danger/5 shadow-sm shadow-danger/10"
          data-testid="safeguarding-disabled-banner"
        >
          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-danger/10">
              <ShieldAlert size={22} className="text-danger" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-danger">
                {t('safeguarding_banner.title')}
              </p>
              <p className="mt-0.5 text-sm text-muted">
                {t('safeguarding_banner.body')}
              </p>
            </div>
            <Button
              as={Link}
              to={tenantPath('/admin/onboarding-settings')}
              size="sm"
              variant="danger"
              className="shrink-0"
            >
              {t('safeguarding_banner.cta')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Stats Grid - Row 1: Core Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('stats.total_members')}
          value={stats?.total_users ?? '—'}
          icon={Users}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('stats.active_listings')}
          value={stats?.active_listings ?? '—'}
          icon={FileCheck}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('stats.transactions')}
          value={stats?.total_transactions ?? '—'}
          icon={ArrowLeftRight}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('stats.hours_exchanged')}
          value={stats?.total_hours_exchanged ?? '—'}
          icon={Clock}
          color="warning"
          loading={loading}
        />
      </div>

      {/* Stats Grid - Row 2: This Month */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('stats.new_users_this_month')}
          value={stats?.new_users_this_month ?? '—'}
          icon={UserPlus}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('stats.active_users')}
          value={stats?.active_users ?? '—'}
          icon={UserCheck}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('stats.total_listings')}
          value={stats?.total_listings ?? '—'}
          icon={ListChecks}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('stats.new_listings_this_month')}
          value={stats?.new_listings_this_month ?? '—'}
          icon={ListChecks}
          color="default"
          loading={loading}
        />
      </div>

      {/* Actionable Alerts: Pending Users + Listings + Volunteering Organisations */}
      {((stats?.pending_users ?? 0) > 0
        || (stats?.pending_listings ?? 0) > 0
        || (stats?.pending_organisations ?? 0) > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {stats?.pending_users !== undefined && stats.pending_users > 0 && (
            <Card className="border border-warning/20 bg-surface shadow-sm shadow-warning/10">
              <CardBody className="flex flex-row items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <UserCheck size={20} className="text-warning" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted">{t('alerts.pending_approvals')}</p>
                  <p className="text-lg font-bold">{stats.pending_users}</p>
                </div>
                <Button
                  as={Link}
                  to={tenantPath('/admin/users?filter=pending')}
                  size="sm"
                  variant="secondary"
                >
                  {t('alerts.review')}
                </Button>
              </CardBody>
            </Card>
          )}

          {stats?.pending_listings !== undefined && stats.pending_listings > 0 && (
            <Card className="border border-accent/20 bg-surface shadow-sm shadow-accent/10">
              <CardBody className="flex flex-row items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                  <ListChecks size={20} className="text-accent" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted">{t('alerts.pending_listings')}</p>
                  <p className="text-lg font-bold">{stats.pending_listings}</p>
                </div>
                <Button
                  as={Link}
                  to={tenantPath('/admin/listings?status=pending')}
                  size="sm"
                  variant="secondary"
                >
                  {t('alerts.review')}
                </Button>
              </CardBody>
            </Card>
          )}

          {stats?.pending_organisations !== undefined && stats.pending_organisations > 0 && (
            <Card className="border border-warning/20 bg-surface shadow-sm shadow-warning/10">
              <CardBody className="flex flex-row items-center gap-4 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/10">
                  <Building2 size={20} className="text-warning" />
                </div>
                <div className="flex-1">
                  {/* Reuses the existing, already-translated alerts key rather
                      than introducing a twelfth-locale duplicate of the same phrase. */}
                  <p className="text-sm text-muted">{t('alerts.orgs_pending_text')}</p>
                  <p className="text-lg font-bold">{stats.pending_organisations}</p>
                </div>
                <Button
                  as={Link}
                  to={tenantPath('/admin/volunteering/organizations')}
                  size="sm"
                  variant="secondary"
                >
                  {t('alerts.review')}
                </Button>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Quick Actions + Trends + Activity -- 3-column layout on large screens */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Quick Actions (matches legacy sidebar) */}
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Rocket size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('quick_actions.card_title')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((action) => {
                const Icon = action.icon;
                return (
                  <Link
                    key={action.path}
                    to={tenantPath(action.path)}
                    className="flex flex-col items-center gap-2 rounded-xl border border-divider/70 bg-surface-secondary/30 p-3 text-center transition-all hover:-translate-y-0.5 hover:bg-surface-secondary hover:shadow-sm"
                  >
                    <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${action.color}`}>
                      <Icon size={20} />
                    </div>
                    <span className="text-xs font-medium text-foreground">{action.label}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-divider">
              <Link
                to={tenantPath('/admin/enterprise')}
                className="flex items-center justify-between rounded-xl px-2 py-2 text-sm text-accent transition-colors hover:bg-accent/10"
              >
                <span className="flex items-center gap-1.5">
                  <Chip size="sm" color="default" variant="soft">{t('quick_actions.enterprise')}</Chip>
                  {t('quick_actions.advanced_controls')}
                </span>
                <ChevronRight size={14} />
              </Link>
            </div>
          </CardBody>
        </Card>

        {/* Monthly Trends */}
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <TrendingUp size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('trends.card_title')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('loading')} className="flex h-48 items-center justify-center">
                <Spinner />
              </div>
            ) : trends.length > 0 ? (
              <div className="space-y-3">
                {trends.map((trend) => (
                  <div key={trend.month} className="flex items-center justify-between">
                    <span className="text-sm text-muted">{trend.month}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium">{trend.hours} {t('trends.hours_suffix')}</span>
                      <div
                        className="h-2 rounded-full bg-accent"
                        style={{ width: `${Math.min(100, (trend.hours / Math.max(...trends.map((x) => x.hours || 1))) * 100)}px` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted">
                {t('trends.no_data')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Recent Activity */}
        <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
          <CardHeader className="flex items-center justify-between px-4 pt-4 pb-0">
            <div className="flex items-center gap-2">
              <Activity size={18} className="text-accent" aria-hidden="true" />
              <h3 className="font-semibold">{t('activity.card_title')}</h3>
            </div>
            <Button
              as={Link}
              to={tenantPath('/admin/activity-log')}
              size="sm"
              variant="tertiary"
            >
              {t('activity.view_all')}
            </Button>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('loading')} className="flex h-48 items-center justify-center">
                <Spinner />
              </div>
            ) : activity.length > 0 ? (
              <div className="space-y-3">
                {activity.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 border-b border-divider pb-3 last:border-0 last:pb-0">
                    <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">{entry.user_name}</span>{' '}
                        <span className="text-muted">{entry.description}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {new Date(entry.created_at).toLocaleString(getFormattingLocale())}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted">
                {t('activity.empty')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default AdminDashboard;
