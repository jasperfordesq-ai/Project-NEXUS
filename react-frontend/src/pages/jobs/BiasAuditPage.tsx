// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
/**
 * Bias Audit Page — Hiring process analytics to detect potential bias.
 *
 * Features:
 * - Date range picker and optional job filter
 * - Application funnel visualization (bar chart)
 * - Rejection rate breakdown by stage
 * - Time-in-stage analysis
 * - Skills match correlation
 * - Source effectiveness
 * - Hiring velocity metric
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';

import ShieldCheck from 'lucide-react/icons/shield-check';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import BarChart3 from 'lucide-react/icons/chart-column';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { EmptyState } from '@/components/feedback';
import { useAuth, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

interface FunnelStage {
  stage: string;
  count: number;
  percentage: number;
}

interface RejectionRate {
  rejections: number;
  total_at_stage: number;
  rate: number;
}

interface SourceData {
  total_applications: number;
  accepted: number;
  acceptance_rate: number;
}

interface BiasAuditData {
  period: { from: string; to: string };
  total_applications: number;
  funnel: FunnelStage[];
  rejection_rates: Record<string, RejectionRate>;
  avg_time_in_stage: Record<string, number>;
  skills_match_correlation: {
    accepted_count: number;
    rejected_count: number;
    acceptance_rate: number;
    note: string;
  };
  source_effectiveness: Record<string, SourceData>;
  hiring_velocity_days: number | null;
}

interface JobOption {
  id: number;
  title: string;
}

const FUNNEL_COLORS = [
  '#6366f1', // indigo - applied
  '#8b5cf6', // violet - screening
  '#a855f7', // purple - interview
  '#22c55e', // green - offer
  '#10b981', // emerald - accepted
];

export function BiasAuditPage() {
  const { t } = useTranslation('jobs');
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  usePageTitle(t('bias_audit.title'));

  const isAdmin = user?.is_admin === true || user?.role === 'admin' || user?.role === 'tenant_admin' || user?.role === 'super_admin' || user?.is_super_admin === true;

  const [report, setReport] = useState<BiasAuditData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobOption[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);

  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // Date range validation: keep dateFrom <= dateTo
  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateTo(dateFrom);
    }
  }, [dateFrom]); // eslint-disable-line react-hooks/exhaustive-deps -- sync dateTo when dateFrom changes; dateTo excluded to avoid loop

  useEffect(() => {
    if (dateFrom && dateTo && dateTo < dateFrom) {
      setDateFrom(dateTo);
    }
  }, [dateTo]); // eslint-disable-line react-hooks/exhaustive-deps -- sync dateFrom when dateTo changes; dateFrom excluded to avoid loop

  // Load available jobs for the filter dropdown
  useEffect(() => {
    let cancelled = false;
    const loadJobs = async () => {
      try {
        const response = await api.get<{ items: JobOption[] }>('/v2/jobs?per_page=100&status=open');
        if (!cancelled && response.success && response.data) {
          const raw = response.data as Record<string, unknown> | JobOption[];
          const items: JobOption[] = Array.isArray(raw) ? raw
            : Array.isArray((raw as Record<string, unknown>)?.items) ? (raw as Record<string, unknown>).items as JobOption[]
            : [];
          setJobs(items);
        }
      } catch {
        // Non-critical — filter dropdown just won't have options
      }
    };
    loadJobs();
    return () => { cancelled = true; };
  }, []);

  const loadReport = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      if (selectedJobId) params.set('job_id', selectedJobId);

      const response = await api.get<BiasAuditData>(`/v2/admin/jobs/bias-audit?${params.toString()}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setReport(response.data);
      } else {
        setError(response.error || tRef.current('bias_audit.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load bias audit report', err);
      setError(tRef.current('bias_audit.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [dateFrom, dateTo, selectedJobId]);

  // Load report on mount
  useEffect(() => {
    loadReport();
    return () => { abortRef.current?.abort(); };
  }, [loadReport]);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Link
          to={tenantPath('/jobs')}
          className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('title')}
        </Link>
        <EmptyState
          icon={<ShieldCheck className="w-12 h-12" aria-hidden="true" />}
          title={t('bias_audit.access_denied')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('page_meta.bias_audit.title')} noIndex />
      {/* Back navigation */}
      <Link
        to={tenantPath('/jobs')}
        className="inline-flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        {t('title')}
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-accent" aria-hidden="true" />
            {t('bias_audit.title')}
          </h1>
          <p className="text-sm text-theme-muted mt-1">{t('bias_audit.subtitle')}</p>
        </div>
      </div>

      {/* Privacy notice */}
      <GlassCard className="p-4 border-l-4 border-accent">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-accent mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-theme-muted">{t('bias_audit.note_privacy')}</p>
        </div>
      </GlassCard>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-col sm:flex-row items-end gap-4">
          <Input
            type="date"
            label={t('bias_audit.date_from')}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            variant="bordered"
            classNames={{ base: 'max-w-[180px]' }}
          />
          <Input
            type="date"
            label={t('bias_audit.date_to')}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            variant="bordered"
            classNames={{ base: 'max-w-[180px]' }}
          />
          <Autocomplete
            label={t('bias_audit.filter_by_job')}
            placeholder={t('bias_audit.all_jobs')}
            searchPlaceholder={t('bias_audit.search_jobs')}
            value={selectedJobId || null}
            onChange={(key) => setSelectedJobId(key && !Array.isArray(key) ? String(key) : '')}
            variant="secondary"
            classNames={{ base: 'max-w-[250px]' }}
          >
            {jobs.map((job) => (
              <AutocompleteItem key={String(job.id)} id={String(job.id)} textValue={job.title}>
                {job.title}
              </AutocompleteItem>
            ))}
          </Autocomplete>
          <Button
            color="primary"
            onPress={loadReport}
            isLoading={isLoading}
            startContent={!isLoading ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : undefined}
          >
            {t('bias_audit.generate')}
          </Button>
        </div>
      </GlassCard>

      {/* Loading state */}
      {isLoading && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} className="p-6" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!isLoading && error && (
        <EmptyState
          icon={<AlertTriangle className="w-12 h-12" aria-hidden="true" />}
          title={error}
          action={
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={loadReport}
            >
              {t('try_again')}
            </Button>
          }
        />
      )}

      {/* Report data */}
      {!isLoading && !error && report && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard
              icon={<Users className="w-5 h-5 text-accent" aria-hidden="true" />}
              label={t('bias_audit.total_applications')}
              value={report.total_applications.toLocaleString(getFormattingLocale())}
            />
            <MetricCard
              icon={<Clock className="w-5 h-5 text-blue-400" aria-hidden="true" />}
              label={t('bias_audit.hiring_velocity')}
              value={report.hiring_velocity_days !== null ? `${report.hiring_velocity_days} ${t('bias_audit.days')}` : t('bias_audit.not_available')}
            />
            <MetricCard
              icon={<TrendingUp className="w-5 h-5 text-green-400" aria-hidden="true" />}
              label={t('bias_audit.acceptance_rate')}
              value={`${report.skills_match_correlation.acceptance_rate}%`}
            />
            <MetricCard
              icon={<BarChart3 className="w-5 h-5 text-amber-400" aria-hidden="true" />}
              label={t('bias_audit.funnel_title')}
              value={`${report.funnel.length} ${t('bias_audit.stages')}`}
            />
          </div>

          {/* Application Funnel */}
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-theme-primary mb-1">
              {t('bias_audit.funnel_title')}
            </h2>
            <p className="text-sm text-theme-muted mb-4">{t('bias_audit.funnel_description')}</p>
            {report.total_applications > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={report.funnel} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis type="number" />
                  <YAxis
                    dataKey="stage"
                    type="category"
                    width={90}
                    tickFormatter={(val: string) => t(`bias_audit.stage.${val}`, val)}
                  />
                  <Tooltip
                    formatter={((value: number | undefined, _name: string, props: { payload?: FunnelStage }): [string, string] => [
                      `${value ?? 0} (${props?.payload?.percentage ?? 0}%)`,
                      t('bias_audit.applications'),
                    ]) as never}
                    contentStyle={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: '8px',
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                    {report.funnel.map((entry, index) => (
                      <Cell key={entry.stage} fill={FUNNEL_COLORS[index % FUNNEL_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-theme-muted text-center py-8">{t('bias_audit.no_data')}</p>
            )}
          </GlassCard>

          {/* Rejection Rates by Stage */}
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-theme-primary mb-1">
              {t('bias_audit.rejection_rates_title')}
            </h2>
            <p className="text-sm text-theme-muted mb-4">{t('bias_audit.rejection_rates_description')}</p>
            <Table aria-label={t('bias_audit.rejection_rates_table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('bias_audit.stage.applied')}</TableColumn>
                <TableColumn align="end">{t('bias_audit.total_at_stage')}</TableColumn>
                <TableColumn align="end">{t('bias_audit.rejections')}</TableColumn>
                <TableColumn align="end">{t('bias_audit.rate')}</TableColumn>
              </TableHeader>
              <TableBody>
                {Object.entries(report.rejection_rates).map(([stage, data]) => (
                  <TableRow key={stage}>
                    <TableCell className="font-medium text-theme-primary">
                      {t(`bias_audit.stage.${stage}`, stage)}
                    </TableCell>
                    <TableCell className="text-right text-theme-muted">{data.total_at_stage}</TableCell>
                    <TableCell className="text-right text-theme-muted">{data.rejections}</TableCell>
                    <TableCell className="text-right">
                      <Chip
                        size="sm"
                        variant="tertiary"
                        color={data.rate > 50 ? 'danger' : data.rate > 25 ? 'warning' : 'success'}
                      >
                        {/* Icon qualifier so the severity tier isn't conveyed by colour alone (WCAG 1.4.1) */}
                        {data.rate > 50 ? (
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                        ) : data.rate > 25 ? (
                          <Info className="w-3 h-3" aria-hidden="true" />
                        ) : null}
                        {data.rate}%
                      </Chip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </GlassCard>

          {/* Time in Stage */}
          <GlassCard className="p-6">
            <h2 className="text-lg font-semibold text-theme-primary mb-1">
              {t('bias_audit.time_in_stage_title')}
            </h2>
            <p className="text-sm text-theme-muted mb-4">{t('bias_audit.time_in_stage_description')}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {Object.entries(report.avg_time_in_stage).map(([stage, days]) => (
                <div
                  key={stage}
                  className="text-center p-3 rounded-lg bg-[var(--color-surface-elevated)]"
                >
                  <p className="text-xs text-theme-muted mb-1">
                    {t(`bias_audit.stage.${stage}`, stage)}
                  </p>
                  <p className="text-xl font-bold text-theme-primary">{days}</p>
                  <p className="text-xs text-theme-subtle">{t('bias_audit.days')}</p>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Skills Match Correlation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold text-theme-primary mb-1">
                {t('bias_audit.skills_match_title')}
              </h2>
              <p className="text-sm text-theme-muted mb-4">{t('bias_audit.skills_match_description')}</p>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-3xl font-bold text-[var(--color-success)]">
                    {report.skills_match_correlation.accepted_count}
                  </p>
                  <p className="text-xs text-theme-muted">{t('bias_audit.accepted_count')}</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-[var(--color-error)]">
                    {report.skills_match_correlation.rejected_count}
                  </p>
                  <p className="text-xs text-theme-muted">{t('bias_audit.rejected_count')}</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-accent">
                    {report.skills_match_correlation.acceptance_rate}%
                  </p>
                  <p className="text-xs text-theme-muted">{t('bias_audit.acceptance_rate')}</p>
                </div>
              </div>
            </GlassCard>

            {/* Source Effectiveness */}
            <GlassCard className="p-6">
              <h2 className="text-lg font-semibold text-theme-primary mb-1">
                {t('bias_audit.source_title')}
              </h2>
              <p className="text-sm text-theme-muted mb-4">{t('bias_audit.source_description')}</p>
              <div className="space-y-3">
                {Object.entries(report.source_effectiveness).map(([source, data]) => (
                  <div
                    key={source}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--color-surface-elevated)]"
                  >
                    <div>
                      <p className="text-sm font-medium text-theme-primary">
                        {t(`bias_audit.source.${source}`, source)}
                      </p>
                      <p className="text-xs text-theme-muted">
                        {data.total_applications} {t('bias_audit.applications').toLowerCase()}
                      </p>
                    </div>
                    <Chip
                      size="sm"
                      variant="tertiary"
                      color={data.acceptance_rate > 20 ? 'success' : 'default'}
                    >
                      {/* Icon marks the high-acceptance tier so it isn't colour-only (WCAG 1.4.1) */}
                      {data.acceptance_rate > 20 && <TrendingUp className="w-3 h-3" aria-hidden="true" />}
                      {data.acceptance_rate}%
                    </Chip>
                  </div>
                ))}
              </div>
            </GlassCard>
          </div>
        </>
      )}

      {/* No data state */}
      {!isLoading && !error && report && report.total_applications === 0 && (
        <EmptyState
          icon={<BarChart3 className="w-12 h-12" aria-hidden="true" />}
          title={t('bias_audit.no_data')}
        />
      )}
    </div>
  );
}

/** Reusable stat card */
function MetricCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-xs text-theme-subtle truncate">{label}</p>
          <p className="text-xl font-bold text-theme-primary">{value}</p>
        </div>
      </div>
    </GlassCard>
  );
}

export default BiasAuditPage;
