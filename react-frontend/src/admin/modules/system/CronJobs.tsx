// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Cron Jobs
 * Card-based view of all scheduled tasks with manual trigger and status tracking.
 * Parity: PHP CronJobController::index()
 */

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useState } from 'react';
import { Separator } from '@/components/ui';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Play from 'lucide-react/icons/play';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Tag from 'lucide-react/icons/tag';
import Terminal from 'lucide-react/icons/terminal';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Spinner } from '@/components/ui';
import { adminCron, adminSystem } from '../../api/adminApi';
import type { CronHealthMetrics, CronJob } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/DataTable';
import { getCronJobDescription, getCronJobName } from './cronJobTranslations';

// ─────────────────────────────────────────────────────────────────────────────
// Extended type to include extra fields from the API
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Category colour & label mapping
// ─────────────────────────────────────────────────────────────────────────────

const categoryColorMap: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  notifications: 'default',
  newsletters: 'default',
  matching: 'success',
  geocoding: 'warning',
  maintenance: 'default',
  master: 'danger',
  gamification: 'default',
  groups: 'default',
  security: 'danger',
};

// ─────────────────────────────────────────────────────────────────────────────
// Date formatter
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CronJobs() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.page_title'));
  const toast = useToast();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJob, setRunningJob] = useState<number | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<CronHealthMetrics | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  const formatDate = useCallback((dateStr: string | null): string => {
    if (!dateStr) return t('system.never');
    const d = new Date(dateStr);
    return d.toLocaleDateString(getFormattingLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [t]);

  const timeAgo = useCallback((dateStr: string | null): string => {
    if (!dateStr) return t('system.never');
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return t('system.just_now');
    if (diffMins < 60) return t('system.minutes_ago', { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('system.hours_ago', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('system.days_ago', { count: diffDays });
  }, [t]);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSystem.getCronJobs();
      if (res.success && res.data) {
        setJobs(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      setJobs([]);
    }
    setLoading(false);
  }, []);

  const loadHealthMetrics = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const res = await adminCron.getHealthMetrics();
      if (res.success && res.data) {
        setHealthMetrics(res.data);
      }
    } catch {
      setHealthMetrics(null);
    }
    setLoadingHealth(false);
  }, []);

  const handleRunJob = async (id: number) => {
    setRunningJob(id);
    try {
      const res = await adminSystem.runCronJob(id);
      if (res.success) {
        toast.success(t('system.job_triggered'));
        loadJobs(); // Refresh to get updated status
      } else {
        toast.error(t('system.failed_to_run_job'));
      }
    } catch {
      toast.error(t('system.failed_to_run_job'));
    }
    setRunningJob(null);
  };

  useEffect(() => {
    loadJobs();
    loadHealthMetrics();
  }, [loadJobs, loadHealthMetrics]);

  // Group jobs by category
  const jobsByCategory = jobs.reduce<Record<string, CronJob[]>>((acc, job) => {
    const cat = job.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(job);
    return acc;
  }, {});

  // Summary stats
  const totalJobs = jobs.length;
  const activeJobs = jobs.filter((j) => j.status === 'active').length;
  const recentSuccesses = jobs.filter((j) => j.last_status === 'success').length;
  // cron_logs records a failed run as 'error' (enum success/error/running).
  const recentFailures = jobs.filter((j) => j.last_status === 'error').length;

  return (
    <div>
      <PageHeader
        title={t('system.cron_jobs_title')}
        description={t('system.cron_jobs_desc')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadJobs}
            isLoading={loading}
            size="sm"
          >
            {t('system.btn_refresh')}
          </Button>
        }
      />

      {/* Loading state */}
      {loading && jobs.length === 0 && (
        <div role="status" aria-busy="true" aria-label={t('system.loading_cron_jobs')} className="flex items-center justify-center py-20">
          <Spinner size="lg" label={t('system.loading_cron_jobs')} />
        </div>
      )}

      {/* Health Metrics Section */}
      {!loadingHealth && healthMetrics && (
        <div className="mb-6">
          {/* Alert Banner for Critical Status */}
          {healthMetrics.alert_status === 'critical' && (
            <Card className="mb-4 border-2 border-danger">
              <CardBody className="flex flex-row items-center gap-3 p-4 bg-danger/10">
                <AlertTriangle aria-hidden="true" size={24} className="text-danger shrink-0" />
                <div>
                  <p className="font-semibold text-danger">{t('system.critical_cron_failing')}</p>
                  <p className="text-sm text-danger-700 dark:text-danger-300">
                    {t('system.jobs_failed_24h_message')}
                  </p>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Health Score Card */}
            <Card>
              <CardHeader className="flex items-center gap-2 pb-2">
                <Activity aria-hidden="true" size={16} className="text-muted" />
                <span className="text-sm font-medium">{t('system.health_score')}</span>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex items-end gap-2">
                  <span className={`text-4xl font-bold ${
                    healthMetrics.health_score >= 80 ? 'text-success' :
                    healthMetrics.health_score >= 50 ? 'text-warning' :
                    'text-danger'
                  }`}>
                    {healthMetrics.health_score}
                  </span>
                  <span className="mb-1 text-sm text-muted">/100</span>
                </div>
                <Chip
                  size="sm"
                  variant="soft"
                  color={
                    healthMetrics.alert_status === 'healthy' ? 'success' :
                    healthMetrics.alert_status === 'warning' ? 'warning' :
                    'danger'
                  }
                  className="mt-2"
                >
                  {t(`system.alert_status_${healthMetrics.alert_status}`, { defaultValue: t('common.unknown') })}
                </Chip>
              </CardBody>
            </Card>

            {/* Success Rate Card */}
            <Card>
              <CardHeader className="flex items-center gap-2 pb-2">
                <CheckCircle aria-hidden="true" size={16} className="text-success" />
                <span className="text-sm font-medium">{t('system.seven_day_success_rate')}</span>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex items-end gap-2">
                  <span className="text-4xl font-bold text-success">
                    {formatNumber(healthMetrics.avg_success_rate_7d, { style: 'percent', maximumFractionDigits: 0 })}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t('system.average_across_all_jobs')}
                </p>
              </CardBody>
            </Card>

            {/* Recent Failures Card */}
            <Card>
              <CardHeader className="flex items-center gap-2 pb-2">
                <XCircle aria-hidden="true" size={16} className="text-danger" />
                <span className="text-sm font-medium">{t('system.twenty_four_h_failures')}</span>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex items-end gap-2">
                  <span className={`text-4xl font-bold ${
                    healthMetrics.jobs_failed_24h === 0 ? 'text-success' :
                    healthMetrics.jobs_failed_24h < 5 ? 'text-warning' :
                    'text-danger'
                  }`}>
                    {healthMetrics.jobs_failed_24h}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {t('system.jobs_failed_in_last_24h')}
                </p>
              </CardBody>
            </Card>
          </div>

          {/* Recent Failures List */}
          {healthMetrics.recent_failures.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <span className="text-sm font-semibold">{t('system.recent_failures')}</span>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-divider">
                  {healthMetrics.recent_failures.slice(0, 5).map((failure) => (
                    <div key={`${failure.job_name}-${failure.failed_at}`} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{failure.job_name}</p>
                          <p className="line-clamp-1 text-xs text-muted">
                            {failure.reason}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-muted">
                          {new Date(failure.failed_at).toLocaleDateString(getFormattingLocale())}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {/* Overdue Jobs */}
          {healthMetrics.jobs_overdue.length > 0 && (
            <Card className="mt-4 border border-warning">
              <CardHeader className="flex items-center gap-2 bg-warning/10">
                <AlertTriangle aria-hidden="true" size={16} className="text-warning" />
                <span className="text-sm font-semibold">{t('system.overdue_jobs')}</span>
              </CardHeader>
              <CardBody className="p-0">
                <div className="divide-y divide-divider">
                  {healthMetrics.jobs_overdue.map((job) => (
                    <div key={job.job_id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{job.job_name}</p>
                          <p className="text-xs text-muted">
                            {t('system.expected')}: {job.expected_interval} • {t('system.last_run')}: {job.last_run || t('system.never')}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      )}

      {/* Summary stats */}
      {!loading && jobs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 mb-6">
          <Card>
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10">
                <Clock aria-hidden="true" size={20} className="text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('system.total_jobs')}</p>
                <p className="text-xl font-bold">{totalJobs}</p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle aria-hidden="true" size={20} className="text-success" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('system.active')}</p>
                <p className="text-xl font-bold">{activeJobs}</p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                <CheckCircle aria-hidden="true" size={20} className="text-success" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('system.last_succeeded')}</p>
                <p className="text-xl font-bold">{recentSuccesses}</p>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-danger/10">
                <XCircle aria-hidden="true" size={20} className="text-danger" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('system.last_failed')}</p>
                <p className="text-xl font-bold">{recentFailures}</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {!loading && jobs.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-muted">
            <Clock aria-hidden="true" size={48} />
            <p className="text-lg font-medium">{t('system.no_cron_jobs')}</p>
            <p className="text-sm">{t('system.no_cron_jobs_hint')}</p>
          </CardBody>
        </Card>
      )}

      {/* Jobs grouped by category */}
      {!loading &&
        Object.entries(jobsByCategory).map(([category, categoryJobs]) => (
          <div key={category} className="mb-8">
            <div className="mb-3 flex items-center gap-2">
              <Chip
                size="sm"
                variant="soft"
                color={categoryColorMap[category] || 'default'}
                className="capitalize"
              >
                {t(`system.job_category_${category}`, { defaultValue: t('system.job_category_unknown') })}
              </Chip>
              <span className="text-sm text-muted">
                {t('system.job_count')}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {categoryJobs.map((job) => (
                <Card key={job.id} className="border border-divider">
                  {/* Header: Name + Status */}
                  <CardHeader className="flex items-start justify-between gap-2 px-4 pt-4 pb-0">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground truncate">{getCronJobName(t, job)}</h3>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                        {getCronJobDescription(t, job)}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                  </CardHeader>

                  {/* Body: Details */}
                  <CardBody className="px-4 py-3 gap-2.5">
                    {/* Command */}
                    <div className="flex items-start gap-2">
                      <Terminal aria-hidden="true" size={14} className="mt-0.5 shrink-0 text-muted" />
                      <code className="break-all rounded bg-surface-secondary px-2 py-1 text-xs text-foreground">
                        {job.command}
                      </code>
                    </div>

                    {/* Schedule */}
                    <div className="flex items-center gap-2">
                      <Clock aria-hidden="true" size={14} className="shrink-0 text-muted" />
                      <span className="text-xs text-foreground">
                        {t('system.schedule')}: <code className="rounded bg-surface-secondary px-1.5 py-0.5">{job.schedule}</code>
                      </span>
                    </div>

                    <Separator className="my-1" />

                    {/* Last Run */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar aria-hidden="true" size={14} className="shrink-0 text-muted" />
                        <span className="text-xs text-muted">{t('system.last_run')}:</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {job.last_status === 'success' && (
                          <CheckCircle aria-hidden="true" size={12} className="text-success" />
                        )}
                        {job.last_status === 'error' && (
                          <XCircle aria-hidden="true" size={12} className="text-danger" />
                        )}
                        <span className="text-xs text-foreground" title={formatDate(job.last_run_at)}>
                          {timeAgo(job.last_run_at)}
                        </span>
                      </div>
                    </div>

                    {/* Last Status */}
                    {job.last_status && (
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Tag aria-hidden="true" size={14} className="shrink-0 text-muted" />
                          <span className="text-xs text-muted">{t('system.last_status')}:</span>
                        </div>
                        <StatusBadge status={job.last_status} />
                      </div>
                    )}

                    {/* Next Run */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock aria-hidden="true" size={14} className="shrink-0 text-muted" />
                        <span className="text-xs text-muted">{t('system.next_run')}:</span>
                      </div>
                      <span className="text-xs text-foreground">
                        {job.next_run_at ? formatDate(job.next_run_at) : t('system.not_scheduled')}
                      </span>
                    </div>
                  </CardBody>

                  {/* Footer: Run Now */}
                  <CardFooter className="px-4 pb-4 pt-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      startContent={
                        runningJob === job.id ? undefined : <Play aria-hidden="true" size={14} />
                      }
                      isLoading={runningJob === job.id}
                      isDisabled={job.status === 'disabled' || runningJob !== null}
                      onPress={() => handleRunJob(job.id)}
                    >
                      {runningJob === job.id ? t('system.running') : t('system.run_now')}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

export default CronJobs;
