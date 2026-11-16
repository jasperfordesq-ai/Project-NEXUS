// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Deployments.
 *
 * The last deployments and rollbacks this server recorded, newest first
 * (`GET /v2/platform-team/deployments`, platform team only): when, which kind,
 * whether it worked (icon AND word), the short version code, the one-line
 * description of the change, how long it took and how many changes it carried.
 *
 * 🔴 Only the live server keeps the record. When the server has no record
 * file the page says "This server keeps no record of deployments", never
 * "no deployments". The 30-minute watch that follows a deployment is not in
 * the record, and the page always says so.
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

export interface Deployment {
  /** ISO 8601 with offset, as the server recorded it; null when unreadable. */
  timestamp: string | null;
  subcommand: 'deploy' | 'rollback' | 'other';
  status: 'success' | 'failed' | 'unknown';
  commit_short: string | null;
  subject: string | null;
  color: 'blue' | 'green' | null;
  duration_s: number | null;
  commit_distance: number | null;
}

export interface DeploymentHistory {
  available: boolean;
  /** null when the server keeps no record. */
  deployments: Deployment[] | null;
  skipped_lines: number | null;
  limit: number;
}

const OUTCOME_ICON = {
  success: { Icon: CircleCheck, tone: 'text-success' },
  failed: { Icon: CircleX, tone: 'text-danger' },
  unknown: { Icon: CircleHelp, tone: 'text-muted' },
} as const;

export function DeploymentsPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('deployments.title'));
  const language = i18n.language;

  const [history, setHistory] = useState<DeploymentHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<DeploymentHistory>('/v2/platform-team/deployments');
      if (res.success && res.data && typeof res.data.available === 'boolean') {
        setHistory(res.data);
      } else {
        setHistory(null);
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load the deployment record', err);
      setHistory(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const when = (timestamp: string | null) => {
    if (!timestamp) return t('deployments.not_recorded');
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return t('deployments.not_recorded');
    return date.toLocaleString(language, { dateStyle: 'medium', timeStyle: 'short' });
  };

  // Minutes and seconds in the viewer's language, from the browser's own unit names.
  const duration = (seconds: number | null) => {
    if (seconds === null || seconds < 0) return t('deployments.not_recorded');
    const unit = (value: number, name: 'minute' | 'second') =>
      new Intl.NumberFormat(language, { style: 'unit', unit: name, unitDisplay: 'short' }).format(value);
    return `${unit(Math.floor(seconds / 60), 'minute')} ${unit(seconds % 60, 'second')}`;
  };

  // On a rollback the recorder may count backwards: the number of changes is the distance either way.
  const changes = (distance: number | null) =>
    distance === null ? t('deployments.not_recorded') : new Intl.NumberFormat(language).format(Math.abs(distance));

  const fact = (label: string, value: string, testId?: string) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="break-words text-sm font-medium text-foreground" data-testid={testId}>
        {value}
      </dd>
    </div>
  );

  const deployments = history?.deployments ?? [];

  return (
    <section className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('deployments.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('deployments.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('deployments.watch_note')}</p>
        </div>
        <Button variant="tertiary" onPress={() => void load()} isDisabled={loading}>
          <RefreshCw size={16} aria-hidden="true" />
          {t('home.refresh')}
        </Button>
      </div>

      {loading && !history ? (
        <div role="status" aria-busy="true" aria-label={t('deployments.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !history ? (
        <LoadError title={t('deployments.load_error_title')} onRetry={() => void load()} />
      ) : !history.available ? (
        <Card>
          <CardBody className="gap-1 p-4" role="status">
            <h2 className="text-lg font-semibold text-foreground">{t('deployments.no_record_title')}</h2>
            <p className="text-sm text-muted">{t('deployments.no_record_text')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {history.skipped_lines ? (
            <p className="text-sm text-warning-soft-foreground" role="status">
              {t('deployments.skipped', { count: history.skipped_lines })}
            </p>
          ) : null}

          {deployments.length === 0 ? (
            <p className="text-sm text-muted" role="status">
              {t('deployments.empty')}
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">{t('deployments.count', { count: deployments.length })}</p>
              <ul className="flex flex-col gap-2">
                {deployments.map((item, index) => {
                  const { Icon, tone } = OUTCOME_ICON[item.status] ?? OUTCOME_ICON.unknown;
                  return (
                    <li key={`${item.timestamp ?? 'none'}-${index}`} data-testid={`deployment-${index}`}>
                      <Card>
                        <CardBody className="gap-3 p-4">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className={`inline-flex items-center gap-1 text-sm font-semibold ${tone}`}>
                              <Icon size={16} aria-hidden="true" />
                              {t(`deployments.outcome.${item.status}`)}
                            </span>
                            <span className="text-sm font-medium text-foreground">
                              {t(`deployments.kind.${item.subcommand}`)}
                            </span>
                            <span className="text-sm text-muted" data-testid={`deployment-${index}-when`}>
                              {when(item.timestamp)}
                            </span>
                          </div>
                          <p className="break-words text-sm text-foreground">
                            {item.subject || t('deployments.not_recorded')}
                          </p>
                          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {fact(t('deployments.version'), item.commit_short ?? t('deployments.not_recorded'))}
                            {fact(t('deployments.time_taken'), duration(item.duration_s), `deployment-${index}-duration`)}
                            {fact(t('deployments.changes_label'), changes(item.commit_distance), `deployment-${index}-changes`)}
                          </dl>
                        </CardBody>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default DeploymentsPage;
