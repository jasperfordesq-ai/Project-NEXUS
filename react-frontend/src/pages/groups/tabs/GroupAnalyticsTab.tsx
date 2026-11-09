// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { useChartColors } from '@/hooks/useChartColors';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useState, useEffect, useCallback } from 'react';

import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import BarChart3 from 'lucide-react/icons/chart-column';
import Download from 'lucide-react/icons/download';
import Award from 'lucide-react/icons/award';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { CHART_COLOR_MAP, CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { resolveAvatarUrl } from '@/lib/helpers';
import {
  downloadGroupAnalyticsExport,
  getGroupAnalyticsDashboard,
  type GroupAnalyticsDashboard as AnalyticsDashboard,
  type GroupAnalyticsDaysRange as DaysRange,
  type GroupAnalyticsExport,
} from '../api/analytics';
import { GroupApiError } from '../api/core';
/**
 * Group Analytics Tab
 * Dashboard for group admins/owners showing KPIs, growth, engagement, * top contributors, activity breakdown, retention cohorts, and comparative stats.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupAnalyticsTabProps {
  groupId: number;
  isAdmin: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tooltip style (consistent with CommunityAnalytics)
// ─────────────────────────────────────────────────────────────────────────────

const tooltipStyle = {
  borderRadius: '8px',
  border: `1px solid ${CHART_TOKEN_COLORS.border}`,
  backgroundColor: CHART_TOKEN_COLORS.surface,
  color: CHART_TOKEN_COLORS.foreground,
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupAnalyticsTab({ groupId, isAdmin }: GroupAnalyticsTabProps) {
  // Charts in the community's colours (meaningful colours — success, warning — stay fixed).
  const chartColors = useChartColors();
  const { t } = useTranslation('groups');
  const toast = useToast();

  const [days, setDays] = useState<DaysRange>(30);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsDashboard | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [exporting, setExporting] = useState<GroupAnalyticsExport | null>(null);

  const loadAnalytics = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const dashboard = await getGroupAnalyticsDashboard(groupId, days, { signal });
      if (!signal.aborted) setData(dashboard);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupAnalyticsTab.loadAnalytics', err);
      if (!signal.aborted) {
        setLoadFailed(true);
        toast.error(t('analytics.load_error'));
      }
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [groupId, days, t, toast]);

  useEffect(() => {
    if (!isAdmin) return;

    const controller = new AbortController();
    void loadAnalytics(controller.signal);
    return () => controller.abort();
  }, [isAdmin, loadAnalytics, loadAttempt]);

  // ─────────────────────────────────────────────────────────────────────
  // Admin-only gate
  // ─────────────────────────────────────────────────────────────────────

  if (!isAdmin) {
    return (
      <GlassCard className="p-6">
        <p className="text-center text-theme-subtle">
          {t('analytics.admin_only')}
        </p>
      </GlassCard>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Loading state
  // ─────────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div
        className="flex justify-center py-12"
        role="status"
        aria-label={t('analytics.loading')}
        aria-busy="true"
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <GlassCard className="p-6">
        <div role="alert" className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{t('analytics.load_error')}</p>
          <Button variant="flat" onPress={() => setLoadAttempt((attempt) => attempt + 1)}>
            {t('try_again')}
          </Button>
        </div>
      </GlassCard>
    );
  }

  const kpi = data?.kpi;
  const activityChartData = (data?.activity_breakdown ?? []).map((entry) => ({
    ...entry,
    label: (() => {
      switch (entry.type) {
        case 'posts': return t('analytics.chart_posts');
        case 'discussions': return t('analytics.chart_discussions');
        case 'events': return t('events');
        case 'files': return t('detail.tab_files');
        case 'member_joins': return t('analytics.col_joined');
        default: return entry.type;
      }
    })(),
  }));

  // ─────────────────────────────────────────────────────────────────────
  // Export handlers
  // ─────────────────────────────────────────────────────────────────────

  const handleExport = async (type: GroupAnalyticsExport) => {
    setExporting(type);
    try {
      await downloadGroupAnalyticsExport(groupId, type);
    } catch (err) {
      logError('GroupAnalyticsTab.handleExport', err);
      toast.error(t('files.download_failed'));
    } finally {
      setExporting(null);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* sr-only section heading so chart h3s are valid sub-headings (WCAG 1.3.1 / 2.4.6) */}
      <h2 className="sr-only">{t('analytics.section_heading')}</h2>
      {/* Header: Date Range + Export Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Date range selector */}
        <ToggleButtonGroup
          aria-label={t('analytics.date_range_aria')}
          selectionMode="single"
          disallowEmptySelection
          size="sm"
          selectedKeys={new Set([String(days)])}
          onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setDays(Number(k) as DaysRange); }}
          className="flex items-center gap-0"
        >
          {([7, 30, 90] as DaysRange[]).map((d) => (
            <ToggleButton
              key={d}
              id={String(d)}
              variant="ghost"
              className="data-[selected=true]:bg-[var(--color-primary)] data-[selected=true]:text-white"
            >
              {t(`analytics.days_${d}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {/* Export buttons */}
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center">
          <Button
            size="sm"
            variant="flat"
            startContent={<Download className="w-4 h-4" aria-hidden="true" />}
            onPress={() => void handleExport('members')}
            isLoading={exporting === 'members'}
            isDisabled={exporting !== null}
            aria-label={t('analytics.export_members_aria')}
          >
            {t('analytics.export_members')}
          </Button>
          <Button
            size="sm"
            variant="flat"
            startContent={<Download className="w-4 h-4" aria-hidden="true" />}
            onPress={() => void handleExport('activity')}
            isLoading={exporting === 'activity'}
            isDisabled={exporting !== null}
            aria-label={t('analytics.export_activity_aria')}
          >
            {t('analytics.export_activity')}
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
              <Users className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-theme-subtle">{t('analytics.total_members')}</p>
              <p className="text-xl font-bold text-theme-primary">
                {loading ? <span role="status" aria-busy="true" aria-label={t('analytics.loading')}><Spinner size="sm" /></span> : (kpi?.total_members ?? 0)}
              </p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-5 h-5 text-success" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-theme-subtle">{t('analytics.active_members')}</p>
              <p className="text-xl font-bold text-theme-primary">
                {loading ? <span role="status" aria-busy="true" aria-label={t('analytics.loading')}><Spinner size="sm" /></span> : (kpi?.active_members ?? 0)}
              </p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-5 h-5 text-warning" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-theme-subtle">{t('analytics.participation_rate')}</p>
              <p className="text-xl font-bold text-theme-primary">
                {loading ? <span role="status" aria-busy="true" aria-label={t('analytics.loading')}><Spinner size="sm" /></span> : `${(kpi?.participation_rate ?? 0).toFixed(1)}%`}
              </p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent-soft flex items-center justify-center flex-shrink-0">
              <Award className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs text-theme-subtle">{t('analytics.avg_posts_day')}</p>
              <p className="text-xl font-bold text-theme-primary">
                {loading ? <span role="status" aria-busy="true" aria-label={t('analytics.loading')}><Spinner size="sm" /></span> : (kpi?.avg_posts_per_day ?? 0).toFixed(1)}
              </p>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Member Growth Chart */}
      <Card className="border border-border bg-surface">
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <Users className="w-[18px] h-[18px] text-success" aria-hidden="true" />
          <h3 className="font-semibold">{t('analytics.member_growth')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <p className="sr-only">{t('analytics.member_growth_summary')}</p>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('analytics.loading')} className="flex h-[300px] items-center justify-center">
              <Spinner />
            </div>
          ) : data && data.growth.length > 0 ? (
            <>
              <ul className="sr-only">
                {data.growth.map((point) => (
                  <li key={point.date}>
                    {point.date}: {t('analytics.chart_total_members')} {point.total_members};{' '}
                    {t('analytics.chart_new_members')} {point.new_members}
                  </li>
                ))}
              </ul>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={data.growth}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-border"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="text-muted"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted"
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} />
                <Line
                  type="monotone"
                  dataKey="total_members"
                  name={t('analytics.chart_total_members')}
                  stroke={chartColors.primary}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                <Line
                  type="monotone"
                  dataKey="new_members"
                  name={t('analytics.chart_new_members')}
                  stroke={CHART_COLOR_MAP.success}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
                </LineChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="flex h-[300px] items-center justify-center text-sm text-muted">
              {t('analytics.no_growth_data')}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Engagement Timeline Chart */}
      <Card className="border border-border bg-surface">
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <BarChart3 className="w-[18px] h-[18px] text-accent" aria-hidden="true" />
          <h3 className="font-semibold">{t('analytics.engagement_timeline')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <p className="sr-only">{t('analytics.engagement_summary')}</p>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('analytics.loading')} className="flex h-[300px] items-center justify-center">
              <Spinner />
            </div>
          ) : data && data.engagement.length > 0 ? (
            <>
              <ul className="sr-only">
                {data.engagement.map((point) => (
                  <li key={point.date}>
                    {point.date}: {t('analytics.chart_posts')} {point.posts};{' '}
                    {t('analytics.chart_discussions')} {point.discussions};{' '}
                    {t('analytics.chart_active_members')} {point.active_members}
                  </li>
                ))}
              </ul>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={data.engagement}
                  margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
                >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="currentColor"
                  className="text-border"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  className="text-muted"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  className="text-muted"
                  allowDecimals={false}
                />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} />
                <Bar
                  dataKey="posts"
                  name={t('analytics.chart_posts')}
                  fill={chartColors.primary}
                  radius={[4, 4, 0, 0]}
                  fillOpacity={0.8}
                />
                <Bar
                  dataKey="discussions"
                  name={t('analytics.chart_discussions')}
                  fill={chartColors.secondary}
                  radius={[4, 4, 0, 0]}
                  fillOpacity={0.8}
                />
                <Line
                  type="monotone"
                  dataKey="active_members"
                  name={t('analytics.chart_active_members')}
                  stroke={CHART_COLOR_MAP.success}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
                </BarChart>
              </ResponsiveContainer>
            </>
          ) : (
            <p className="flex h-[300px] items-center justify-center text-sm text-muted">
              {t('analytics.no_engagement_data')}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Top Contributors + Activity Breakdown (side by side) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Contributors */}
        <Card className="border border-border bg-surface">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Award className="w-[18px] h-[18px] text-warning" aria-hidden="true" />
            <h3 className="font-semibold">{t('analytics.top_contributors')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('analytics.loading')} className="flex h-[300px] items-center justify-center">
                <Spinner />
              </div>
            ) : data && data.top_contributors.length > 0 ? (
              <div className="space-y-3">
                {data.top_contributors.map((contributor, index) => (
                  <div
                    key={contributor.user_id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-theme-elevated hover:bg-theme-hover transition-colors"
                  >
                    <span className="text-sm font-bold text-muted w-6 text-center">
                      {index + 1}
                    </span>
                    <Avatar
                      src={resolveAvatarUrl(contributor.avatar_url)}
                      name={contributor.name}
                      size="sm"
                      className="flex-shrink-0"
                    />
                    <span className="flex-1 text-sm font-medium text-theme-primary truncate">
                      {contributor.name}
                    </span>
                    <Chip size="sm" variant="flat" color="primary">
                      {contributor.post_count} {t('analytics.posts')}
                    </Chip>
                  </div>
                ))}
              </div>
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-muted">
                {t('analytics.no_contributors')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Activity Breakdown (Pie Chart) */}
        <Card className="border border-border bg-surface">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <BarChart3 className="w-[18px] h-[18px] text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('analytics.activity_breakdown')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <p className="sr-only">{t('analytics.activity_breakdown_summary')}</p>
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('analytics.loading')} className="flex h-[300px] items-center justify-center">
                <Spinner />
              </div>
            ) : activityChartData.length > 0 ? (
              <>
                <ul className="sr-only">
                  {activityChartData.map((entry) => (
                    <li key={entry.type}>{entry.label}: {entry.count}</li>
                  ))}
                </ul>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                  <Pie
                    data={activityChartData}
                    dataKey="count"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    paddingAngle={2}
                    label={({ name, percent }) =>
                      `${name} (${((percent ?? 0) * 100).toFixed(0)}%)`
                    }
                    labelLine={{ strokeWidth: 1 }}
                  >
                    {activityChartData.map((entry, index) => (
                      <Cell
                        key={`cell-${entry.type}`}
                        fill={chartColors.categorical[index % chartColors.categorical.length]}
                        fillOpacity={0.85}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => [
                      `${value ?? 0}`,
                      name,
                    ]}
                  />
                  </PieChart>
                </ResponsiveContainer>
              </>
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-muted">
                {t('analytics.no_activity_data')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Retention Cohorts */}
      <Card className="border border-border bg-surface">
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <TrendingUp className="w-[18px] h-[18px] text-info" aria-hidden="true" />
          <h3 className="font-semibold">{t('analytics.retention_cohorts')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <p className="sr-only">{t('analytics.retention_summary')}</p>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('analytics.loading')} className="flex h-[200px] items-center justify-center">
              <Spinner />
            </div>
          ) : data && data.retention.length > 0 ? (
            <div className="overflow-x-auto">
              <Table aria-label={t('analytics.retention_table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('analytics.col_month')}</TableColumn>
                <TableColumn align="end">{t('analytics.col_joined')}</TableColumn>
                <TableColumn align="end">{t('analytics.col_still_active')}</TableColumn>
                <TableColumn align="end">{t('analytics.col_retention')}</TableColumn>
              </TableHeader>
              <TableBody>
                {data.retention.map((cohort) => (
                  <TableRow key={cohort.month}>
                    <TableCell className="text-theme-primary">{cohort.month}</TableCell>
                    <TableCell className="text-right text-theme-subtle">{cohort.joined}</TableCell>
                    <TableCell className="text-right text-theme-subtle">{cohort.still_active}</TableCell>
                    <TableCell className="text-right">
                      <Chip
                        size="sm"
                        variant="flat"
                        color={
                          (cohort.retention_pct ?? 0) >= 70
                            ? 'success'
                            : (cohort.retention_pct ?? 0) >= 40
                              ? 'warning'
                              : 'danger'
                        }
                      >
                        {/* Coerce defensively: retention is a blind cast, so a cohort
                            missing retention_pct used to crash this table (and blank the
                            whole analytics tab) via .toFixed on undefined — the sibling
                            KPIs already use `?? 0`. */}
                        {(cohort.retention_pct ?? 0).toFixed(1)}%
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              </Table>
            </div>
          ) : (
            <p className="flex h-[200px] items-center justify-center text-sm text-muted">
              {t('analytics.no_retention_data')}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Comparative Stats */}
      {data?.comparative && (
        <Card className="border border-border bg-surface">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <BarChart3 className="w-[18px] h-[18px] text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('analytics.comparative_stats')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <p className="sr-only">{t('analytics.comparative_summary')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Members comparison */}
              <div className="p-4 rounded-lg bg-theme-elevated text-center">
                <p className="text-xs text-theme-subtle mb-1">
                  {t('analytics.your_members')}
                </p>
                <p className="text-2xl font-bold text-theme-primary">
                  {data.comparative.your_members}
                </p>
                <p className="text-xs text-theme-subtle mt-1">
                  {t('analytics.vs_average')}{' '}
                  <span className="font-semibold text-foreground">
                    {data.comparative.avg_members}
                  </span>
                </p>
              </div>

              {/* Activity comparison */}
              <div className="p-4 rounded-lg bg-theme-elevated text-center">
                <p className="text-xs text-theme-subtle mb-1">
                  {t('analytics.your_activity')}
                </p>
                <p className="text-2xl font-bold text-theme-primary">
                  {data.comparative.your_activity}
                </p>
                <p className="text-xs text-theme-subtle mt-1">
                  {t('analytics.vs_average')}{' '}
                  <span className="font-semibold text-foreground">
                    {data.comparative.avg_activity}
                  </span>
                </p>
              </div>

              {/* Percentile rank */}
              <div className="p-4 rounded-lg bg-theme-elevated text-center">
                <p className="text-xs text-theme-subtle mb-1">
                  {t('analytics.percentile_rank')}
                </p>
                <p className="text-2xl font-bold text-theme-primary">
                  {t('analytics.percentile_value', {
                    pct: (100 - data.comparative.percentile_rank).toFixed(0),
                  })}
                </p>
                <Chip
                  size="sm"
                  variant="flat"
                  color={
                    data.comparative.percentile_rank >= 75
                      ? 'success'
                      : data.comparative.percentile_rank >= 50
                        ? 'primary'
                        : 'warning'
                  }
                  className="mt-2"
                >
                  {data.comparative.percentile_rank >= 75
                    ? t('analytics.excellent')
                    : data.comparative.percentile_rank >= 50
                      ? t('analytics.good')
                      : t('analytics.below_average')}
                </Chip>
              </div>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export default GroupAnalyticsTab;
