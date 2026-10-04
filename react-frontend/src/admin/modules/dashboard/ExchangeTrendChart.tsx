// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Exchange activity by month: hours exchanged as a filled area, number of
 * exchanges as a line on the right axis. Replaces the text rows with an
 * inline-style bar that the dashboard drew until 2026-10-04.
 *
 * The API already leaves out opening balances, admin credits, donations and
 * reversals (AdminDashboardController::exchangeWhere), and the footnote says
 * so, because a 3,000-hour opening-balance import used to flatten every
 * other month into a flat line.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import TrendingUp from 'lucide-react/icons/trending-up';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { CHART_COLOR_MAP } from '@/lib/chartColors';
import { getFormattingLocale } from '@/lib/helpers';
import type { MonthlyTrend } from '../../api/types';

interface ExchangeTrendChartProps {
  trends: MonthlyTrend[];
  loading: boolean;
  /** The transactions series could not be computed (named in the API's `_failed_metrics`). */
  failed?: boolean;
}

/** 'YYYY-MM' → a Date on the first of that month, in local time. */
function monthToDate(month: string): Date | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1);
}

export function ExchangeTrendChart({ trends, loading, failed = false }: ExchangeTrendChartProps) {
  const { t } = useTranslation('admin_dashboard');
  const locale = getFormattingLocale();

  const data = useMemo(() => {
    const short = new Intl.DateTimeFormat(locale, { month: 'short' });
    const long = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    return trends.map((row) => {
      const date = monthToDate(row.month);
      return {
        month: row.month,
        label: date ? short.format(date) : row.month,
        fullLabel: date ? long.format(date) : row.month,
        hours: row.hours ?? 0,
        exchanges: row.transactions ?? 0,
      };
    });
  }, [trends, locale]);

  const hasAnyExchange = data.some((row) => row.hours > 0 || row.exchanges > 0);
  const hoursLabel = t('chart.dataset_label');
  const exchangesLabel = t('chart.exchanges_series');

  return (
    <Card className="h-full border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardHeader className="flex flex-col items-start gap-0.5 px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-accent" aria-hidden="true" />
          <h3 className="font-semibold">{t('chart.title')}</h3>
        </div>
        <p className="text-sm text-muted">{t('chart.subtitle')}</p>
      </CardHeader>
      <CardBody className="px-4 pb-4 sm:px-5 sm:pb-5">
        {loading ? (
          <Skeleton role="status" aria-busy="true" aria-label={t('loading')} className="h-72 w-full rounded-xl bg-surface-tertiary" />
        ) : failed ? (
          <div role="status" className="flex h-72 flex-col items-center justify-center gap-2 text-center">
            <AlertCircle size={28} className="text-warning" aria-hidden="true" />
            <p className="text-sm text-muted">{t('chart.could_not_load')}</p>
          </div>
        ) : !hasAnyExchange ? (
          <p className="flex h-72 items-center justify-center text-center text-sm text-muted">{t('chart.no_data')}</p>
        ) : (
          <div role="img" aria-label={t('chart.aria_label', { months: data.length })}>
            <ResponsiveContainer width="100%" height={288}>
              <AreaChart data={data} margin={{ top: 10, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="exchangeHoursGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} className="text-muted" tickLine={false} axisLine={false} />
                <YAxis yAxisId="hours" orientation="left" tick={{ fontSize: 12 }} className="text-muted" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="count" orientation="right" tick={{ fontSize: 12 }} className="text-muted" tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  labelFormatter={(_label, payload) => {
                    const first = payload?.[0]?.payload as { fullLabel?: string } | undefined;
                    return first?.fullLabel ?? String(_label);
                  }}
                  formatter={(value, name) => [
                    typeof value === 'number' ? value.toLocaleString(locale) : String(value ?? ''),
                    String(name ?? ''),
                  ]}
                  contentStyle={{
                    borderRadius: '8px',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-foreground)',
                  }}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area
                  yAxisId="hours"
                  type="monotone"
                  dataKey="hours"
                  name={hoursLabel}
                  stroke={CHART_COLOR_MAP.primary}
                  fill="url(#exchangeHoursGradient)"
                  strokeWidth={2}
                  activeDot={{ r: 5 }}
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="exchanges"
                  name={exchangesLabel}
                  stroke={CHART_COLOR_MAP.success}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-3 text-xs leading-4 text-muted">{t('chart.excludes_note')}</p>
      </CardBody>
    </Card>
  );
}

export default ExchangeTrendChart;
