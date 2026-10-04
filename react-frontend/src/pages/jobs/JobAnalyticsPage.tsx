// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/Progress';
import { Skeleton } from '@/components/ui/Skeleton';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
/**
 * Job Analytics Page (J8) - Analytics dashboard for job posters
 *
 * Features:
 * - Total views, unique viewers, applications, conversion rate
 * - Views over time chart (last 30 days)
 * - Applications by stage breakdown
 * - Average time to apply, time to fill
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';

import BarChart3 from 'lucide-react/icons/chart-column';
import Eye from 'lucide-react/icons/eye';
import Users from 'lucide-react/icons/users';
import FileText from 'lucide-react/icons/file-text';
import TrendingUp from 'lucide-react/icons/trending-up';
import Clock from 'lucide-react/icons/clock';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Share2 from 'lucide-react/icons/share-2';
import Star from 'lucide-react/icons/star';
import Sparkles from 'lucide-react/icons/sparkles';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

interface AnalyticsData {
  job_id: number;
  total_views: number;
  unique_viewers: number;
  total_applications: number;
  conversion_rate: number;
  avg_time_to_apply_hours: number | null;
  time_to_fill_days: number | null;
  views_by_day: Array<{ date: string; count: number }>;
  applications_by_stage: Array<{ stage: string; count: number }>;
  weekly_trend: { week: string; count: number }[];
  referral_stats: { total_shares: number; referral_applications: number; referral_conversion_pct: number } | null;
  scorecard_avg: number | null;
  created_at: string;
  status: string;
}

interface JobPredictionsData {
  expected_applications: { value: number; current: number; label: string };
  estimated_time_to_fill: { value: number | null; days_posted: number; label: string };
  conversion_rate: { yours: number; average: number; label: string };
  salary_comparison: { your_salary: number; market_avg: number; diff_percent: number; label: string } | null;
  similar_jobs_analyzed: number;
  ai_insights?: string[];
}

function isJobPredictionsData(value: unknown): value is JobPredictionsData {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const data = value as Partial<JobPredictionsData>;
  return Boolean(
    data.expected_applications
      && typeof data.expected_applications.value === 'number'
      && typeof data.expected_applications.current === 'number'
      && data.estimated_time_to_fill
      && typeof data.estimated_time_to_fill.days_posted === 'number'
      && data.conversion_rate
      && typeof data.conversion_rate.yours === 'number'
      && typeof data.conversion_rate.average === 'number'
      && typeof data.similar_jobs_analyzed === 'number'
  );
}

const STAGE_COLORS: Record<string, string> = {
  applied: 'bg-warning/20 text-warning',
  screening: 'bg-accent/20 text-accent',
  reviewed: 'bg-accent/20 text-accent',
  interview: 'bg-accent-soft text-accent',
  offer: 'bg-success/20 text-success',
  accepted: 'bg-success/20 text-success',
  rejected: 'bg-danger/20 text-danger',
  withdrawn: 'bg-surface-secondary text-muted',
  pending: 'bg-warning/20 text-warning',
};

const APPLICATION_STATUSES = [
  'applied',
  'pending',
  'screening',
  'reviewed',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
] as const;

const STAGE_PROGRESS_COLORS: Record<string, 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'default'> = {
  applied: 'warning',
  pending: 'warning',
  screening: 'primary',
  reviewed: 'primary',
  interview: 'secondary',
  offer: 'success',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'default',
};

const BAR_HEIGHT_CLASSES = [
  'h-1',
  'h-2',
  'h-4',
  'h-6',
  'h-8',
  'h-10',
  'h-12',
  'h-16',
  'h-20',
  'h-24',
  'h-28',
  'h-32',
  'h-36',
  'h-40',
];

function getApplicationStatusKey(stage: string) {
  return APPLICATION_STATUSES.includes(stage as (typeof APPLICATION_STATUSES)[number])
    ? `application_status.${stage}`
    : 'application_status.unknown';
}

function getBarHeightClass(value: number, max: number) {
  const ratio = max > 0 ? value / max : 0;
  const index = Math.max(0, Math.min(BAR_HEIGHT_CLASSES.length - 1, Math.ceil(ratio * (BAR_HEIGHT_CLASSES.length - 1))));
  return BAR_HEIGHT_CLASSES[index];
}

export function JobAnalyticsPage() {
  const { t } = useTranslation('jobs');
  const { id } = useParams<{ id: string }>();
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('analytics.title'));

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<JobPredictionsData | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(true);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const loadAnalytics = useCallback(async () => {
    if (!id) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<AnalyticsData>(`/v2/jobs/${id}/analytics`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setAnalytics(response.data);
      } else {
        setError(response.error || tRef.current('analytics.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load job analytics', err);
      setError(tRef.current('analytics.load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  const loadPredictions = useCallback(async () => {
    if (!id) return;
    setPredictionsLoading(true);
    try {
      const res = await api.get(`/v2/jobs/${id}/predictions`);
      setPredictions(res.success && isJobPredictionsData(res.data) ? res.data : null);
    } catch { /* silent */ }
    finally { setPredictionsLoading(false); }
  }, [id]);

  useEffect(() => { loadPredictions(); }, [loadPredictions]);

  if (isLoading) {
    return (
      <div className="space-y-6" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <Skeleton className="h-8 w-1/3 rounded" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error || !analytics) {
    return (
      <EmptyState
        icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
        title={error || t('analytics.no_data')}
        action={
          <div className="flex gap-2">
            <Button as={Link} to={tenantPath(`/jobs/${id}`)} variant="flat" className="bg-theme-elevated text-theme-muted">
              {t('detail.browse_vacancies')}
            </Button>
            <Button
              color="primary"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={loadAnalytics}
            >
              {t('try_again')}
            </Button>
          </div>
        }
      />
    );
  }

  // Find the max view count for the bar chart
  const maxViews = Math.max(...analytics.views_by_day.map((d) => Number(d.count)), 1);

  // api.download carries the sign-in token; a new tab sent none (401).
  const handleExportCsv = async () => {
    try {
      await api.download(`/v2/jobs/${id}/applications/export-csv`, {
        filename: `job-${id}-applications.csv`,
      });
    } catch {
      toast.error(t('common:errors.download_failed'));
    }
  };

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.analytics.title')} noIndex />
      {/* Back nav */}
      <Link
        to={tenantPath(`/jobs/${id}`)}
        className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('detail.browse_vacancies')}
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <BarChart3 className="w-7 h-7 text-blue-400" aria-hidden="true" />
          {t('analytics.title')}
        </h1>
        <Button
          variant="flat"
          className="bg-theme-elevated text-theme-muted self-start sm:self-auto"
          startContent={<Download className="w-4 h-4" aria-hidden="true" />}
          onPress={handleExportCsv}
        >
          {t('analytics.export_csv')}
        </Button>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          icon={<Eye className="w-5 h-5 text-blue-400" aria-hidden="true" />}
          label={t('analytics.total_views')}
          value={analytics.total_views.toLocaleString(getFormattingLocale())}
        />
        <MetricCard
          icon={<Users className="w-5 h-5 text-green-400" aria-hidden="true" />}
          label={t('analytics.unique_viewers')}
          value={analytics.unique_viewers.toLocaleString(getFormattingLocale())}
        />
        <MetricCard
          icon={<FileText className="w-5 h-5 text-accent" aria-hidden="true" />}
          label={t('analytics.total_applications')}
          value={analytics.total_applications.toLocaleString(getFormattingLocale())}
        />
        <MetricCard
          icon={<TrendingUp className="w-5 h-5 text-amber-400" aria-hidden="true" />}
          label={t('analytics.conversion_rate')}
          value={`${analytics.conversion_rate}%`}
        />
      </div>

      {/* Referral stats + Scorecard chips */}
      {(analytics.referral_stats || analytics.scorecard_avg !== null) && (
        <div className="flex flex-wrap gap-3">
          {analytics.referral_stats && (
            <>
              <GlassCard className="flex min-w-[12rem] flex-1 items-center gap-3 p-4 sm:flex-none">
                <Share2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-theme-subtle">{t('analytics.referral_shares')}</p>
                  <p className="text-lg font-bold text-theme-primary">{analytics.referral_stats.total_shares.toLocaleString(getFormattingLocale())}</p>
                </div>
              </GlassCard>
              <GlassCard className="flex min-w-[12rem] flex-1 items-center gap-3 p-4 sm:flex-none">
                <Users className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-theme-subtle">{t('analytics.referral_apps')}</p>
                  <p className="text-lg font-bold text-theme-primary">{analytics.referral_stats.referral_applications.toLocaleString(getFormattingLocale())}</p>
                </div>
              </GlassCard>
              <GlassCard className="flex min-w-[12rem] flex-1 items-center gap-3 p-4 sm:flex-none">
                <TrendingUp className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-xs text-theme-subtle">{t('analytics.referral_conversion')}</p>
                  <p className="text-lg font-bold text-theme-primary">{analytics.referral_stats.referral_conversion_pct}%</p>
                </div>
              </GlassCard>
            </>
          )}
          {analytics.scorecard_avg !== null && (
            <GlassCard className="p-4 flex items-center gap-3">
              <Star className={`w-4 h-4 ${analytics.scorecard_avg >= 60 ? 'text-success' : 'text-warning'}`} aria-hidden="true" />
              <div>
                <p className="text-xs text-theme-subtle">{t('analytics.scorecard_avg')}</p>
                <p className={`text-lg font-bold ${analytics.scorecard_avg >= 60 ? 'text-success' : 'text-warning'}`}>
                  {analytics.scorecard_avg}%
                </p>
              </div>
            </GlassCard>
          )}
        </div>
      )}

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {analytics.avg_time_to_apply_hours !== null && (
          <GlassCard className="p-5">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
              <div>
                <p className="text-xs text-theme-subtle">{t('analytics.avg_time_to_apply')}</p>
                <p className="text-xl font-bold text-theme-primary">
                  {analytics.avg_time_to_apply_hours} {t('analytics.hours')}
                </p>
              </div>
            </div>
          </GlassCard>
        )}
        {analytics.time_to_fill_days !== null && (
          <GlassCard className="p-5">
            <div className="flex items-center gap-3">
              <Clock className="w-5 h-5 text-theme-subtle" aria-hidden="true" />
              <div>
                <p className="text-xs text-theme-subtle">{t('analytics.time_to_fill')}</p>
                <p className="text-xl font-bold text-theme-primary">
                  {analytics.time_to_fill_days} {t('analytics.days')}
                </p>
              </div>
            </div>
          </GlassCard>
        )}
      </div>

      {/* Views Over Time (simple bar chart) */}
      {analytics.views_by_day.length > 0 && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4">
            {t('analytics.views_over_time')}
          </h2>
          <div className="flex h-48 items-end gap-1 overflow-x-auto pb-8">
            {analytics.views_by_day.map((day) => {
              const count = Number(day.count);
              return (
                <div
                  key={day.date}
                  className="flex min-w-6 flex-1 flex-col items-center gap-1"
                >
                  <span className="text-[10px] text-theme-subtle">{count}</span>
                  <Tooltip content={t('analytics.views_tooltip', { date: day.date, count })}>
                    <div className={`w-full rounded-t bg-accent ${getBarHeightClass(count, maxViews)}`} />
                  </Tooltip>
                  <span className="text-[9px] text-theme-subtle rotate-[-45deg] origin-top-left whitespace-nowrap">
                    {new Date(day.date).toLocaleDateString(getFormattingLocale(), { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* Weekly Application Trend */}
      {analytics.weekly_trend && analytics.weekly_trend.length > 0 && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4">
            {t('analytics.weekly_trend')}
          </h2>
          {(() => {
            const maxWeeklyCount = Math.max(...analytics.weekly_trend.map((w) => Number(w.count)), 1);
            return (
              <div className="flex h-48 items-end gap-1 overflow-x-auto pb-8">
                {analytics.weekly_trend.map((week) => {
                  const count = Number(week.count);
                  return (
                    <div
                      key={week.week}
                      className="flex min-w-10 flex-1 flex-col items-center gap-1"
                    >
                      <span className="text-[10px] text-theme-subtle">{count}</span>
                      <Tooltip content={t('analytics.applications_tooltip', { week: week.week, count })}>
                        <div className={`w-full rounded-t bg-surface-tertiary ${getBarHeightClass(count, maxWeeklyCount)}`} />
                      </Tooltip>
                      <span className="text-[9px] text-theme-subtle rotate-[-45deg] origin-top-left whitespace-nowrap">
                        {week.week}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </GlassCard>
      )}

      {/* Applications by Stage */}
      {analytics.applications_by_stage.length > 0 && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4">
            {t('analytics.applications_by_stage')}
          </h2>
          <div className="space-y-3">
            {analytics.applications_by_stage.map((item) => {
              const total = analytics.total_applications || 1;
              const pct = Math.round((Number(item.count) / total) * 100);
              return (
                <div key={item.stage} className="flex items-center gap-3">
                  <div className="w-28 text-sm text-theme-muted">
                    {t(getApplicationStatusKey(item.stage))}
                  </div>
                  <div className="flex-1">
                    <Progress
                      aria-label={t('analytics.stage_progress_aria', { stage: t(getApplicationStatusKey(item.stage)) })}
                      color={STAGE_PROGRESS_COLORS[item.stage] ?? 'primary'}
                      value={pct}
                      size="sm"
                      className="min-w-24"
                    />
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_COLORS[item.stage] ?? 'bg-accent/20 text-accent'}`}>
                    {item.count}
                  </span>
                  <span className="text-xs text-theme-subtle w-12 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* AI Predictions */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles size={20} className="text-accent" />
          <h2 className="text-lg font-semibold text-theme-primary">
            {t('analytics.predictions')}
          </h2>
          {predictions && (
            <Chip size="sm" variant="tertiary" color="default">
              {t('analytics.based_on', { count: predictions.similar_jobs_analyzed })}
            </Chip>
          )}
        </div>

        {predictionsLoading ? (
          <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-8"><Spinner size="lg" /></div>
        ) : !predictions ? (
          <p className="text-center text-muted py-6">{t('analytics.no_predictions')}</p>
        ) : (
          <div className="space-y-4">
            {/* Prediction cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-surface-secondary border border-border">
                <p className="text-xs text-muted uppercase tracking-wide">{t('analytics.expected_apps')}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{predictions.expected_applications.value}</p>
                <p className="text-xs mt-1">
                  <span className="text-muted">{t('analytics.current')}: {predictions.expected_applications.current}</span>
                  {' · '}
                  <Chip size="sm" variant="tertiary" color={predictions.expected_applications.current >= predictions.expected_applications.value ? 'success' : 'warning'}>
                    {predictions.expected_applications.label}
                  </Chip>
                </p>
              </div>

              <div className="p-4 rounded-lg bg-surface-secondary border border-border">
                <p className="text-xs text-muted uppercase tracking-wide">{t('analytics.time_to_fill')}</p>
                <p className="text-2xl font-bold text-foreground mt-1">
                  {predictions.estimated_time_to_fill.value
                    ? t('analytics.days_short_value', { count: predictions.estimated_time_to_fill.value })
                    : t('analytics.not_available')}
                </p>
                <p className="text-xs text-muted mt-1">{t('analytics.posted_days_ago', { days: predictions.estimated_time_to_fill.days_posted })}</p>
              </div>

              <div className="p-4 rounded-lg bg-surface-secondary border border-border">
                <p className="text-xs text-muted uppercase tracking-wide">{t('analytics.conversion_comparison')}</p>
                <p className="text-2xl font-bold text-foreground mt-1">{predictions.conversion_rate.yours}%</p>
                <p className="text-xs mt-1">
                  <span className="text-muted">{t('analytics.avg')}: {predictions.conversion_rate.average}%</span>
                  {' · '}
                  <Chip size="sm" variant="tertiary" color={predictions.conversion_rate.yours >= predictions.conversion_rate.average ? 'success' : 'warning'}>
                    {predictions.conversion_rate.label}
                  </Chip>
                </p>
              </div>
            </div>

            {/* Salary comparison */}
            {predictions.salary_comparison && (
              <div className="p-4 rounded-lg bg-surface-secondary border border-border">
                <p className="text-xs text-muted uppercase tracking-wide mb-2">{t('analytics.salary_comparison')}</p>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm text-muted">{t('analytics.yours')}</p>
                    <p className="text-lg font-bold">{predictions.salary_comparison.your_salary.toLocaleString(getFormattingLocale())}</p>
                  </div>
                  <div className="text-muted">{t('analytics.versus')}</div>
                  <div>
                    <p className="text-sm text-muted">{t('analytics.market_avg')}</p>
                    <p className="text-lg font-bold">{predictions.salary_comparison.market_avg.toLocaleString(getFormattingLocale())}</p>
                  </div>
                  <Chip size="sm" variant="tertiary" color={predictions.salary_comparison.diff_percent >= 0 ? 'success' : 'danger'}>
                    {predictions.salary_comparison.diff_percent > 0 ? '+' : ''}{predictions.salary_comparison.diff_percent}% {predictions.salary_comparison.label}
                  </Chip>
                </div>
              </div>
            )}

            {/* AI Insights */}
            {predictions.ai_insights && predictions.ai_insights.length > 0 && (
              <div className="p-4 rounded-lg bg-accent-soft border border-accent/20">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-accent" />
                  <p className="text-sm font-semibold text-accent">{t('analytics.ai_insights')}</p>
                </div>
                <ul className="space-y-2">
                  {predictions.ai_insights.map((insight, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="text-accent mt-0.5">•</span>
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <p className="text-xs text-theme-subtle">{label}</p>
          <p className="text-2xl font-bold text-theme-primary">{value}</p>
        </div>
      </div>
    </GlassCard>
  );
}

export default JobAnalyticsPage;
