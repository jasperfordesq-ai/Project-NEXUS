// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Operations
 *
 * Operational tools (not config): cache statistics and background jobs.
 * Previously lived inside /admin/tenant-features (now retired).
 *
 * The background jobs are the cron jobs, so that card is shown to god accounts
 * only (owner decision 2026-10-02) — everyone else sees the cache card alone,
 * and the jobs list is not even requested for them.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Spinner, Button } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import { Separator } from '@/components/ui';
import { useTranslation } from 'react-i18next';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trash2 from 'lucide-react/icons/trash-2';
import Database from 'lucide-react/icons/database';
import Timer from 'lucide-react/icons/timer';
import Play from 'lucide-react/icons/play';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast } from '@/contexts';
import { isGodUser } from '@/lib/access';
import { adminConfig } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { CacheStats, BackgroundJob } from '../../api/types';
import { getCronJobName } from './cronJobTranslations';

export default function Operations() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('operations.title'));
  const toast = useToast();
  const { user } = useAuth();
  const isGod = isGodUser(user);

  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [cacheRes, jobsRes] = await Promise.all([
      adminConfig.getCacheStats(),
      isGod ? adminConfig.getJobs() : Promise.resolve(null),
    ]);
    if (cacheRes.success && cacheRes.data) setCacheStats(cacheRes.data);
    if (jobsRes?.success && jobsRes.data) {
      setJobs(Array.isArray(jobsRes.data) ? jobsRes.data : []);
    }
    setLoading(false);
  }, [isGod]);

  useEffect(() => { load(); }, [load]);

  const handleClearCache = async () => {
    const res = await adminConfig.clearCache('tenant');
    if (res.success) {
      toast.success(t('operations.cache_cleared'));
      const statsRes = await adminConfig.getCacheStats();
      if (statsRes.success && statsRes.data) setCacheStats(statsRes.data);
    } else {
      toast.error(t('operations.cache_clear_failed'));
    }
  };

  const handleRunJob = async (jobId: string) => {
    const res = await adminConfig.runJob(jobId);
    if (res.success) {
      toast.success(t('operations.job_triggered'));
    } else {
      toast.error(t('operations.job_trigger_failed'));
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('operations.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('operations.title')}
        description={isGod ? t('operations.description') : t('operations.description_cache_only')}
        actions={
          <Button variant="tertiary" size="sm" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={load}>
            {t('operations.refresh')}
          </Button>
        }
      />

      <div className={isGod ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : 'grid grid-cols-1 gap-6'}>
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Database aria-hidden="true" size={18} className="text-warning" />
            <h3 className="font-semibold">{t('operations.cache_heading')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('operations.redis_label')}</span>
              <span className={cacheStats?.redis_connected ? 'text-success' : 'text-danger'}>
                {cacheStats?.redis_connected ? t('operations.redis_connected') : t('operations.redis_disconnected')}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('operations.memory_used')}</span>
              <span>{cacheStats?.redis_memory_used || '—'}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted">{t('operations.keys')}</span>
              <span>{cacheStats?.redis_keys_count ?? '—'}</span>
            </div>
            <Separator />
            <Button
              fullWidth
              variant="tertiary"
              color="warning"
              startContent={<Trash2 aria-hidden="true" size={14} />}
              onPress={handleClearCache}
              size="sm"
            >
              {t('operations.clear_cache')}
            </Button>
          </CardBody>
        </Card>

        {isGod && (
          <Card>
            <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
              <Timer aria-hidden="true" size={18} className="text-accent" />
              <h3 className="font-semibold">{t('operations.bg_jobs_heading')}</h3>
            </CardHeader>
            <CardBody className="px-4 pb-4 space-y-3">
              {jobs.length > 0 ? jobs.map((job) => (
                <div key={job.id} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{getCronJobName(t, job)}</p>
                    <p className="text-xs text-muted">
                      {job.last_run_at
                        ? t('operations.last_run', { date: new Date(job.last_run_at).toLocaleString(getFormattingLocale()) })
                        : t('operations.never_run')}
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    onPress={() => handleRunJob(job.id)}
                    aria-label={t('operations.run_job_label', { name: getCronJobName(t, job) })}
                  >
                    <Play aria-hidden="true" size={14} />
                  </Button>
                </div>
              )) : (
                <p className="text-sm text-muted">{t('operations.no_jobs')}</p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
