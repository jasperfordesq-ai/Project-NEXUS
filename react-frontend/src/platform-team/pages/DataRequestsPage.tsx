// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — Data requests.
 *
 * Per community: how many data requests (a copy of their data, erasure, a
 * correction, a limit on use, a transfer, an objection) are open, how many are
 * overdue (open for more than 30 days, counted from when the request was
 * made), how many are nearly due, how long the oldest has waited, and how many
 * were completed in the last 90 days. A wide screen gets a table; a narrow one
 * gets a card per community. Every community is listed, so "nothing open" is
 * seen rather than inferred.
 *
 * 🔴 Counts only: no member and no request is named on this page. Read-only;
 * requests are answered in each community's own admin panel.
 *
 * A figure the server could not read arrives as null and is shown as "Not
 * available", never as zero: "nothing overdue" would be a comforting lie.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, Chip, Spinner } from '@/components/ui';
import { LoadError } from '@/components/feedback/LoadError';
import { FiguresRefresh, withRefresh } from '../components/FiguresRefresh';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { joinList } from '@/lib/listFormat';
import { logError } from '@/lib/logger';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import { getFormattingLocale } from '@/lib/helpers';

export type RequestType = 'access' | 'erasure' | 'rectification' | 'restriction' | 'portability' | 'objection';

const REQUEST_TYPES: readonly RequestType[] = [
  'access',
  'erasure',
  'rectification',
  'restriction',
  'portability',
  'objection',
];

export interface DataRequestsRow {
  id: number;
  name: string;
  slug: string | null;
  is_active: boolean;
  open: number | null;
  open_by_type: Record<RequestType, number> | null;
  overdue: number | null;
  nearly_due: number | null;
  oldest_open_days: number | null;
  completed_last_90_days: number | null;
}

export interface DataRequestsTotals {
  communities: number;
  open: number | null;
  open_by_type: Record<RequestType, number> | null;
  overdue: number | null;
  nearly_due: number | null;
  oldest_open_days: number | null;
  completed_last_90_days: number | null;
  /**
   * Completed requests with no completion date, platform-wide (not in any
   * window). Optional: an older server does not send it; null = not readable.
   */
  completed_without_date?: number | null;
}

export interface DataRequests {
  overdue_after_days: number;
  nearly_due_from_days: number;
  completed_window_days: number;
  request_types: string[];
  unavailable: string[];
  totals: DataRequestsTotals;
  communities: DataRequestsRow[];
  /** When the server worked these figures out (absent from an older server). */
  generated_at?: string | null;
}

/** The figure columns, in the order the table shows them. */
const FIGURES = ['open', 'overdue', 'nearly_due', 'oldest_open_days', 'completed_last_90_days'] as const;
type Figure = (typeof FIGURES)[number];

type Counts = Pick<DataRequestsRow, Figure | 'open_by_type'>;

export function DataRequestsPage() {
  const { t, i18n } = useTranslation('platform_team');
  usePageTitle(t('data_requests.title'));

  const [data, setData] = useState<DataRequests | null>(null);
  const [refused, setRefused] = useState(false);
  /** Figures are on screen: a refused "Check again" keeps them. */
  const shown = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setRefused(false);
    setLoading(true);
    setFailed(false);
    try {
      const res = await api.get<DataRequests>(withRefresh('/v2/platform-team/data-requests', refresh));
      if (res.success && res.data && Array.isArray(res.data.communities) && res.data.totals) {
        setData(res.data);
        shown.current = true;
      } else if (refresh && shown.current && res.code === 'RATE_LIMIT_EXCEEDED') {
        // Asked again too soon: keep what is on screen and say so.
        setRefused(true);
      } else {
        setData(null);
        shown.current = false;
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load data requests', err);
      setData(null);
      shown.current = false;
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const overdueDays = data?.overdue_after_days ?? 30;
  const nearlyFrom = data?.nearly_due_from_days ?? 25;
  const completedDays = data?.completed_window_days ?? 90;
  const unavailable = data?.unavailable ?? [];

  const value = (counts: Counts, figure: Figure): string => {
    const v = counts[figure];
    if (v === null) {
      // No open request has no age; anything else null could not be read.
      return figure === 'oldest_open_days' && counts.open === 0 && !unavailable.includes(figure)
        ? t('data_requests.no_oldest')
        : t('data_requests.not_available');
    }
    return v.toLocaleString(getFormattingLocale());
  };

  const label = (figure: Figure): string =>
    figure === 'completed_last_90_days'
      ? t('data_requests.column.completed_last_90_days', { days: completedDays })
      : t(`data_requests.column.${figure}`);

  const emphasis = (counts: Counts, figure: Figure): string =>
    figure === 'overdue' && (counts.overdue ?? 0) > 0
      ? 'font-semibold text-danger'
      : figure === 'nearly_due' && (counts.nearly_due ?? 0) > 0
        ? 'font-semibold text-warning'
        : 'text-foreground';

  /** The kinds that are open, each named plainly with its count. */
  const kinds = (counts: Counts) => {
    if (counts.open_by_type === null) {
      return <span className="text-muted">{t('data_requests.not_available')}</span>;
    }
    const byType = counts.open_by_type;
    const open = REQUEST_TYPES.filter((type) => (byType[type] ?? 0) > 0);
    if (open.length === 0) {
      return <span className="text-muted">{t('data_requests.nothing_open')}</span>;
    }
    return (
      <dl className="flex flex-col gap-0.5">
        {open.map((type) => (
          <div key={type} className="flex flex-wrap gap-x-1">
            <dt className="text-muted">{t(`data_requests.type.${type}`)}</dt>
            <dd className="tabular-nums text-foreground">{byType[type].toLocaleString(getFormattingLocale())}</dd>
          </div>
        ))}
      </dl>
    );
  };

  const notActive = (community: DataRequestsRow) =>
    community.is_active ? null : (
      <Chip size="sm" variant="soft" color="default">
        {t('data_requests.not_active')}
      </Chip>
    );

  const overdueOnes = data ? data.communities.filter((c) => (c.overdue ?? 0) > 0) : [];

  return (
    <section className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-foreground">{t('data_requests.title')}</h1>
          <p className="mt-2 max-w-2xl text-base text-muted">{t('data_requests.intro')}</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">{t('data_requests.where_answered')}</p>
          <p className="mt-2 flex max-w-2xl items-start gap-2 text-sm text-muted">
            <Eye size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t('data_requests.counts_only')}
          </p>
        </div>
        <FiguresRefresh
          onRefresh={() => void load(true)}
          loading={loading}
          generatedAt={data?.generated_at}
          refused={refused}
        />
      </div>

      {loading && !data ? (
        <div role="status" aria-busy="true" aria-label={t('data_requests.loading')} className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : failed || !data ? (
        <LoadError title={t('data_requests.load_error_title')} onRetry={() => void load()} />
      ) : data.communities.length === 0 ? (
        <p className="text-sm text-muted">{t('data_requests.empty')}</p>
      ) : (
        <div className="flex flex-col gap-6">
          {data.unavailable.length > 0 ? (
            <p className="max-w-2xl text-sm text-warning-soft-foreground" role="status">
              {t('data_requests.unavailable_note')}
            </p>
          ) : null}

          <Card>
            <CardBody className="flex flex-row items-start gap-3 p-4" data-testid="data-requests-overdue">
              <Clock
                size={20}
                className={`mt-0.5 shrink-0 ${overdueOnes.length > 0 ? 'text-danger' : 'text-muted'}`}
                aria-hidden="true"
              />
              <div className="min-w-0 text-sm">
                {data.totals.overdue === null ? (
                  <p className="font-medium text-foreground">{t('data_requests.overdue_unknown')}</p>
                ) : overdueOnes.length > 0 ? (
                  <>
                    <p className="font-medium text-foreground">{t('data_requests.overdue_count', { count: overdueOnes.length })}</p>
                    <p className="mt-1 break-words text-foreground">
                      {t('data_requests.overdue_names', { names: joinList(overdueOnes.map((c) => c.name), i18n.language) })}
                    </p>
                  </>
                ) : (
                  <p className="font-medium text-foreground">{t('data_requests.none_overdue')}</p>
                )}
                <p className="mt-2 text-muted">{t('data_requests.overdue_rule', { days: overdueDays })}</p>
                <p className="mt-1 text-muted">{t('data_requests.nearly_due_rule', { from: nearlyFrom, to: overdueDays })}</p>
              </div>
            </CardBody>
          </Card>

          <p className="text-sm text-muted">{t('data_requests.community_count', { count: data.totals.communities })}</p>

          <div className="hidden overflow-x-auto rounded-xl border border-divider md:block">
            <table className="w-full border-collapse text-sm" data-testid="data-requests-table">
              <caption className="sr-only">{t('data_requests.title')}</caption>
              <thead>
                <tr className="bg-surface-secondary text-start text-xs text-muted">
                  <th scope="col" className="sticky start-0 z-10 min-w-48 bg-surface-secondary px-3 py-2 text-start align-bottom font-medium">
                    {t('data_requests.column.community')}
                  </th>
                  {FIGURES.map((figure) => (
                    <th key={figure} scope="col" className="min-w-24 px-3 py-2 text-end align-bottom font-medium">
                      {label(figure)}
                    </th>
                  ))}
                  <th scope="col" className="min-w-40 px-3 py-2 text-start align-bottom font-medium">
                    {t('data_requests.column.open_by_type')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.communities.map((community) => (
                  <tr key={community.id} className="border-t border-divider align-top">
                    <th scope="row" className="sticky start-0 z-10 bg-background px-3 py-2 text-start font-medium text-foreground">
                      <span className="block break-words">{community.name}</span>
                      {community.is_active ? null : <span className="mt-1 flex">{notActive(community)}</span>}
                    </th>
                    {FIGURES.map((figure) => (
                      <td key={figure} className={`px-3 py-2 text-end tabular-nums ${emphasis(community, figure)}`}>
                        {value(community, figure)}
                      </td>
                    ))}
                    <td className="px-3 py-2">{kinds(community)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-divider bg-surface-secondary align-top">
                  <th scope="row" className="sticky start-0 z-10 bg-surface-secondary px-3 py-2 text-start font-semibold text-foreground">
                    {t('data_requests.totals_row')}
                  </th>
                  {FIGURES.map((figure) => (
                    <td key={figure} className="px-3 py-2 text-end font-semibold tabular-nums text-foreground">
                      {value(data.totals, figure)}
                    </td>
                  ))}
                  <td className="px-3 py-2">{kinds(data.totals)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {(data.totals.completed_without_date ?? 0) > 0 ? (
            <p className="max-w-2xl text-sm text-muted" data-testid="data-requests-without-date">
              {t('data_requests.completed_without_date', { count: data.totals.completed_without_date ?? 0 })}
            </p>
          ) : null}

          <ul className="flex flex-col gap-3 md:hidden" data-testid="data-requests-list">
            {data.communities.map((community) => (
              <li key={community.id}>
                <Card>
                  <CardBody className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="min-w-0 break-words text-base font-semibold text-foreground">{community.name}</h2>
                      {notActive(community)}
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      {FIGURES.map((figure) => (
                        <div key={figure} className="min-w-0">
                          <dt className="text-xs text-muted">{label(figure)}</dt>
                          <dd className={`tabular-nums ${emphasis(community, figure)}`}>{value(community, figure)}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 text-sm">
                      <p className="text-xs text-muted">{t('data_requests.column.open_by_type')}</p>
                      <div className="mt-1">{kinds(community)}</div>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default DataRequestsPage;
