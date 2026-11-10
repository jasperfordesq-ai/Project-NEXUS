// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Hours shared, month by month — a small bar chart under the dashboard's
 * monthly highlight, in the community's own colour. It reads `monthly_hours`
 * from GET /v2/community/this-month: whole-community totals for the last six
 * calendar months, never a figure for one member.
 *
 * The request is the same one the highlight above makes, so the API client
 * answers both with a single call. Shows nothing when every month is zero (a
 * row of empty bars is discouraging, not warm), when the totals cannot be
 * loaded, or when the server has not sent the monthly figures.
 *
 * The bars are decoration for assistive technology: the same numbers are in a
 * visually hidden list, one line per month, under the visible heading. The
 * charting library is loaded only once there is something to draw.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from '@/components/ui/GlassCard';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const CommunityHoursBars = lazy(() => import('./CommunityHoursBars'));

interface MonthlyHoursRow {
  month: string;
  hours: number;
}

export interface CommunityHoursPoint {
  /** 'YYYY-MM'. */
  month: string;
  /** The month's short name in the reader's language, e.g. "Nov". */
  label: string;
  hours: number;
  /** The hours as the reader's locale writes numbers, e.g. "1,204.5". */
  formatted: string;
}

/** Keeps only well-formed rows: a 'YYYY-MM' month and a number that is not negative. */
function toPoints(rows: unknown, locale: string): CommunityHoursPoint[] {
  if (!Array.isArray(rows)) return [];
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short' });
  const points: CommunityHoursPoint[] = [];
  for (const row of rows as Array<Partial<MonthlyHoursRow> | null>) {
    const match = typeof row?.month === 'string' ? /^(\d{4})-(\d{2})$/.exec(row.month) : null;
    const hours = Number(row?.hours);
    if (!row || !match || !Number.isFinite(hours) || hours < 0) continue;
    points.push({
      month: row.month as string,
      label: monthName.format(new Date(Number(match[1]), Number(match[2]) - 1, 1)),
      hours,
      formatted: hours.toLocaleString(locale, { maximumFractionDigits: 1 }),
    });
  }
  return points;
}

/** `className` places the card in its parent grid; renders nothing when there is nothing to show. */
export function CommunityHoursChart({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const [rows, setRows] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<{ monthly_hours?: MonthlyHoursRow[] }>('/v2/community/this-month')
      .then((res) => {
        if (!cancelled && res.success && res.data) setRows(res.data.monthly_hours ?? null);
      })
      .catch((err) => logError('Community hours chart failed to load', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const locale = getFormattingLocale();
  const points = useMemo(() => toPoints(rows, locale), [rows, locale]);

  if (points.length === 0 || points.every((point) => point.hours === 0)) return null;

  const label = t('month_highlight.hours');

  return (
    <GlassCard data-testid="community-hours-chart" className={`p-5 sm:p-6 ${className}`}>
      <h2 className="text-lg font-semibold text-theme-primary">{label}</h2>
      <ul className="sr-only" data-testid="community-hours-list">
        {points.map((point) => (
          <li key={point.month}>
            {point.label}: {point.formatted}
          </li>
        ))}
      </ul>
      <div className="mt-3 h-40 text-theme-muted" aria-hidden="true">
        <Suspense fallback={null}>
          <CommunityHoursBars points={points} label={label} />
        </Suspense>
      </div>
    </GlassCard>
  );
}

export default CommunityHoursChart;
