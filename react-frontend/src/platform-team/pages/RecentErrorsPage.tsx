// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Recent errors.
 *
 * Three counts per part of the platform, read by the server from the error
 * service (`GET /v2/platform-team/errors`, platform team only): errors in the
 * last 24 hours, in the last 7 days, and unresolved problems.
 *
 * 🔴 Switched off until the platform's owner stores a read-only key for the
 * error service on the server. Until then the page says "Not connected" and,
 * calmly, what would be needed and whose decision it is. It offers no set-up
 * button, no form and no field for a key.
 *
 * 🔴 Counts only: the details of each error stay in the error service. A part
 * that could not be read says so, never zero; a figure the service did not
 * give is "Not available".
 *
 * 🔴 Read-only. The only control asks the error service again
 * (`?refresh=1`, limited on the server to six a minute).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CircleHelp from 'lucide-react/icons/circle-help';
import PlugZap from 'lucide-react/icons/plug-zap';
import { getFormattingLocale } from '@/lib/helpers';

export type ErrorProjectKey = 'php' | 'react' | 'webuk';

export interface ErrorProject {
  key: ErrorProjectKey;
  available: boolean;
  errors_24h: number | null;
  errors_7d: number | null;
  unresolved: number | null;
}

export interface RecentErrorsReport {
  connected: boolean;
  /** ISO 8601; null when not connected. */
  checked_at: string | null;
  /** null when not connected. */
  projects: ErrorProject[] | null;
}

const FIGURES = [
  { field: 'errors_24h', id: '24h' },
  { field: 'errors_7d', id: '7d' },
  { field: 'unresolved', id: 'unresolved' },
] as const;

const ENDPOINT = '/v2/platform-team/errors';

export function RecentErrorsPage() {
  const { t } = useTranslation('platform_team');
  usePageTitle(t('errors.title'));

  const [report, setReport] = useState<RecentErrorsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** "Check again" was refused (too many in a minute); the figures on screen stay. */
  const [refused, setRefused] = useState(false);
  const hasReport = useRef(false);

  const load = useCallback(async (askAgain = false) => {
    setLoading(true);
    setFailed(false);
    setRefused(false);
    try {
      const res = await api.get<RecentErrorsReport>(askAgain ? `${ENDPOINT}?refresh=1` : ENDPOINT);
      if (res.success && res.data && typeof res.data.connected === 'boolean') {
        setReport(res.data);
        hasReport.current = true;
      } else if (askAgain && hasReport.current && res.code === 'RATE_LIMIT_EXCEEDED') {
        setRefused(true);
      } else {
        setReport(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load recent errors', err);
      setReport(null);
      hasReport.current = false;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const number = (value: number | null) =>
    value === null ? t('errors.not_available') : new Intl.NumberFormat(getFormattingLocale()).format(value);

  const checkedAt = (() => {
    if (!report?.checked_at) return null;
    const date = new Date(report.checked_at);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
  })();


  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('errors.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('errors.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('errors.counts_only')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load(true)} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !report ? (
        <div role="status" aria-busy="true" aria-label={t('errors.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !report ? (
        <LoadError title={t('errors.load_error_title')} onRetry={() => void load()} />
      ) : !report.connected ? (
        <Card data-testid="errors-not-connected">
          <CardBody className="gap-2 p-4" role="status">
            <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-foreground">
              <PlugZap size={18} aria-hidden="true" className="text-muted" />
              {t('errors.not_connected.title')}
            </h2>
            <p className="text-sm text-foreground">{t('errors.not_connected.needed')}</p>
            <p className="text-sm text-foreground">{t('errors.not_connected.settings')}</p>
            <p className="text-sm text-foreground">{t('errors.not_connected.decision')}</p>
            <p className="text-sm text-muted">{t('errors.not_connected.meanwhile')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {refused ? (
            <p className="text-sm font-medium text-warning-soft-foreground" role="status">
              {t('errors.check_refused')}
            </p>
          ) : null}
          {checkedAt ? <p className="text-sm text-muted">{t('errors.checked_at', { time: checkedAt })}</p> : null}
          <p className="text-sm text-muted">{t('errors.kept_note')}</p>
          {!Array.isArray(report.projects) ? (
            // Connected, but no parts came back: say so, never an empty grid.
            <p className="inline-flex items-start gap-2 text-sm text-warning-soft-foreground" role="status">
              <CircleHelp size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
              {t('errors.could_not_read_any')}
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {report.projects.map((project) => (
                <Card key={project.key} data-testid={`errors-project-${project.key}`}>
                  <CardBody className="gap-3 p-4">
                    <h2 className="text-lg font-semibold text-foreground">{t(`errors.project.${project.key}`)}</h2>
                    {project.available ? (
                      <dl className="flex flex-col gap-2">
                        {FIGURES.map(({ field, id }) => (
                          <div key={id} className="min-w-0">
                            <dt className="text-xs text-muted">{t(`errors.figure.${field}`)}</dt>
                            <dd
                              className="break-words text-xl font-semibold text-foreground"
                              data-testid={`errors-${project.key}-${id}`}
                            >
                              {number(project[field])}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className="inline-flex items-start gap-2 text-sm text-warning-soft-foreground" role="status">
                        <CircleHelp size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                        {t('errors.could_not_read')}
                      </p>
                    )}
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default RecentErrorsPage;
