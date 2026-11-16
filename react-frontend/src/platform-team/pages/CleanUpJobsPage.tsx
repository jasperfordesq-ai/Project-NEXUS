// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Clean-up jobs.
 *
 * The scheduled jobs that delete data (`GET /v2/platform-team/clean-up-jobs`,
 * platform team only): for each, a plain name, one line saying what it
 * deletes, how often it runs, when it last ran successfully, when it last
 * failed, and its state in words with an icon.
 *
 * 🔴 A job with nothing recorded is "No record yet", never fine. Records for
 * most of these jobs only start on the day this page went live, and the page
 * always says so. A record the server could not read says "Could not be
 * read", which is not the same as "No record yet".
 *
 * 🔴 Read-only. The only control reloads.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CircleCheck from 'lucide-react/icons/circle-check';
import CircleX from 'lucide-react/icons/circle-x';
import CircleHelp from 'lucide-react/icons/circle-help';
import Clock from 'lucide-react/icons/clock';
import TriangleAlert from 'lucide-react/icons/triangle-alert';

export type CleanUpJobStatus = 'ok' | 'late' | 'failing' | 'unknown';

export interface CleanUpJob {
  key: string;
  how_often: 'hourly' | 'daily' | 'weekly';
  /** ISO 8601; null when no success is recorded. */
  last_ok_at: string | null;
  /** ISO 8601; null when no failure is recorded. */
  last_failed_at: string | null;
  status: CleanUpJobStatus;
  /** false when the record for this job could not be read. */
  readable: boolean;
}

export interface CleanUpJobsReport {
  jobs: CleanUpJob[];
}

const STATE = {
  ok: { Icon: CircleCheck, tone: 'text-success' },
  late: { Icon: Clock, tone: 'text-warning' },
  failing: { Icon: CircleX, tone: 'text-danger' },
  unknown: { Icon: CircleHelp, tone: 'text-muted' },
  unreadable: { Icon: TriangleAlert, tone: 'text-muted' },
} as const;

export function CleanUpJobsPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('clean_up_jobs.title'));
  const language = i18n.language;

  const [report, setReport] = useState<CleanUpJobsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<CleanUpJobsReport>('/v2/platform-team/clean-up-jobs');
      if (res.success && res.data && Array.isArray(res.data.jobs)) {
        setReport(res.data);
      } else {
        setReport(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the clean-up jobs', err);
      setReport(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const when = (value: string | null, empty: string) => {
    if (!value) return empty;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return empty;
    return date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  const fact = (label: string, value: string, testId: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('clean_up_jobs.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('clean_up_jobs.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('clean_up_jobs.records_note')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !report ? (
        <div role="status" aria-busy="true" aria-label={t('clean_up_jobs.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !report ? (
        <LoadError title={t('clean_up_jobs.load_error_title')} onRetry={() => void load()} />
      ) : (
        <ul className="flex flex-col gap-2">
          {report.jobs.map((job) => {
            const state = job.readable ? job.status : 'unreadable';
            const { Icon, tone } = STATE[state] ?? STATE.unknown;
            const id = `clean-up-job-${job.key}`;
            return (
              <li key={job.key} data-testid={id}>
                <Card>
                  <CardBody className="gap-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <h2 className="text-base font-semibold text-foreground">
                          {t(`clean_up_jobs.job.${job.key}.name`)}
                        </h2>
                        <p className="text-sm text-muted">{t(`clean_up_jobs.job.${job.key}.deletes`)}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 text-sm font-semibold ${tone}`}>
                        <Icon size={16} aria-hidden="true" />
                        {t(`clean_up_jobs.status.${state}`)}
                      </span>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {fact(t('clean_up_jobs.runs'), t(`clean_up_jobs.how_often.${job.how_often}`), `${id}-how-often`)}
                      {fact(
                        t('clean_up_jobs.last_ok'),
                        job.readable
                          ? when(job.last_ok_at, t('clean_up_jobs.not_recorded'))
                          : t('clean_up_jobs.status.unreadable'),
                        `${id}-last-ok`,
                      )}
                      {fact(
                        t('clean_up_jobs.last_failed'),
                        job.readable
                          ? when(job.last_failed_at, t('clean_up_jobs.never_failed'))
                          : t('clean_up_jobs.status.unreadable'),
                        `${id}-last-failed`,
                      )}
                    </dl>
                  </CardBody>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default CleanUpJobsPage;
