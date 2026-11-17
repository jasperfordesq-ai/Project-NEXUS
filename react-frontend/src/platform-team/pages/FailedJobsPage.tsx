// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Failed background jobs.
 *
 * Background jobs that failed (an email that could not be sent, an import
 * that stopped) are recorded by the platform. This page lists them, newest
 * first, and lets the platform team run one again or discard it.
 *
 * 🔴 The server sends only the job's name, its queue, when it failed and one
 * masked line of the reason. Never ask it for the job's contents: they can
 * hold members' details from any community.
 *
 * A list that cannot be loaded shows the error card. It never falls back to
 * "nothing is waiting", which would be a comforting lie.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { ConfirmModal } from '@/admin/components/ConfirmModal';
import { LoadError } from '@/components/feedback/LoadError';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import CheckCircle from 'lucide-react/icons/circle-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Trash2 from 'lucide-react/icons/trash-2';
import { getFormattingLocale } from '@/lib/helpers';

interface FailedJob {
  id: string;
  job: string | null;
  queue: string;
  failed_at: string | null;
  reason: string | null;
}

interface FailedJobsList {
  jobs: FailedJob[];
  total: number;
  page: number;
  per_page: number;
}

const PER_PAGE = 25;

export function FailedJobsPage() {
  const { t } = useTranslation('platform_team');
  const toast = useToast();
  usePageTitle(t('failed_jobs.title'));

  const [list, setList] = useState<FailedJobsList | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDiscard, setToDiscard] = useState<FailedJob | null>(null);

  const load = useCallback(async (wanted: number) => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<FailedJobsList>(`/v2/platform-team/failed-jobs?page=${wanted}&per_page=${PER_PAGE}`);
      if (res.success && res.data && Array.isArray(res.data.jobs)) {
        setList(res.data);
      } else {
        setList(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load failed background jobs', err);
      setList(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page);
  }, [load, page]);

  const act = async (job: FailedJob, kind: 'retry' | 'discard') => {
    setBusyId(job.id);
    try {
      const res =
        kind === 'retry'
          ? await api.post<{ retried: boolean }>(`/v2/platform-team/failed-jobs/${job.id}/retry`)
          : await api.delete<{ discarded: boolean }>(`/v2/platform-team/failed-jobs/${job.id}`);
      if (res.success) {
        toast.success(kind === 'retry' ? t('failed_jobs.retried') : t('failed_jobs.discarded'));
        await load(page);
      } else {
        toast.error(t('failed_jobs.action_failed'));
      }
    } catch (err) {
      logError('Failed background job action did not complete', err);
      toast.error(t('failed_jobs.action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const when = (iso: string | null): string => {
    if (!iso) return t('home.value.not_known');
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? t('home.value.not_known') : date.toLocaleString(getFormattingLocale());
  };

  const pages = list ? Math.max(1, Math.ceil(list.total / PER_PAGE)) : 1;

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('failed_jobs.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('failed_jobs.intro')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load(page)} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !list ? (
        <div role="status" aria-busy="true" aria-label={t('failed_jobs.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !list ? (
        <LoadError title={t('failed_jobs.load_error_title')} onRetry={() => void load(page)} />
      ) : list.jobs.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center gap-2 p-10 text-center">
            <CheckCircle size={32} className="text-success" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-foreground">{t('failed_jobs.empty_title')}</h2>
            <p className="text-sm text-muted">{t('failed_jobs.empty_text')}</p>
          </CardBody>
        </Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted" aria-live="polite">
            {t('failed_jobs.count', { count: list.total })}
          </p>
          <ul className="flex flex-col gap-3">
            {list.jobs.map((job) => (
              <li key={job.id} data-testid={`failed-job-${job.id}`}>
                <Card>
                  <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-foreground">
                        {job.job ?? t('failed_jobs.unknown_job')}
                      </h2>
                      <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                        <div className="flex gap-1">
                          <dt>{t('failed_jobs.queue')}</dt>
                          <dd className="font-medium text-foreground">{job.queue}</dd>
                        </div>
                        <div className="flex gap-1">
                          <dt>{t('failed_jobs.failed_at')}</dt>
                          <dd className="font-medium text-foreground">{when(job.failed_at)}</dd>
                        </div>
                      </dl>
                      <p className="mt-2 break-words text-sm text-foreground">
                        {job.reason ?? t('failed_jobs.no_reason')}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        isDisabled={busyId !== null}
                        onPress={() => void act(job, 'retry')}
                      >
                        <RotateCcw size={14} aria-hidden="true" />
                        {t('failed_jobs.retry')}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        isDisabled={busyId !== null}
                        onPress={() => setToDiscard(job)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t('failed_jobs.discard')}
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <Button variant="tertiary" isDisabled={page <= 1 || loading} onPress={() => setPage(page - 1)}>
                {t('failed_jobs.previous_page')}
              </Button>
              <span className="text-sm text-muted">{t('failed_jobs.page_of', { page, pages })}</span>
              <Button variant="tertiary" isDisabled={page >= pages || loading} onPress={() => setPage(page + 1)}>
                {t('failed_jobs.next_page')}
              </Button>
            </div>
          )}
        </>
      )}

      <ConfirmModal
        isOpen={toDiscard !== null}
        onClose={() => setToDiscard(null)}
        onConfirm={() => {
          const job = toDiscard;
          setToDiscard(null);
          if (job) void act(job, 'discard');
        }}
        title={t('failed_jobs.discard_title')}
        message={t('failed_jobs.discard_message')}
        confirmLabel={t('failed_jobs.discard')}
        cancelLabel={t('failed_jobs.cancel')}
        confirmColor="danger"
      />
    </section>
  );
}

export default FailedJobsPage;
