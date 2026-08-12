// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AlertCircle from 'lucide-react/icons/alert-circle';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Calendar from 'lucide-react/icons/calendar';
import HandHeart from 'lucide-react/icons/hand-heart';
import Heart from 'lucide-react/icons/heart';
import PiggyBank from 'lucide-react/icons/piggy-bank';
import Sparkles from 'lucide-react/icons/sparkles';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { useApi } from '@/hooks/useApi';
import { usePageTitle } from '@/hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface YearBreakdown {
  year: number;
  hours_given: number;
  hours_received: number;
}

interface FutureCareFundSummary {
  total_banked_hours: number;
  hours_received: number;
  net_balance: number;
  chf_value_estimate: number;
  hour_value_chf: number;
  lifetime_given: number;
  lifetime_received: number;
  reciprocity_ratio: number;
  first_contribution_date: string | null;
  active_months: number;
  partner_organisations_helped: number;
  this_month_hours_given: number;
  this_month_hours_received: number;
  by_year: YearBreakdown[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHours(hours: number): string {
  return hours.toLocaleString(getFormattingLocale(), {
    minimumFractionDigits: hours % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function formatChf(value: number): string {
  return value.toLocaleString(getFormattingLocale(), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatHoursShort(
  hours: number,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t('hours_short', { count: formatHours(hours) });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function reciprocityKey(ratio: number): 'strong_giver' | 'balanced' | 'strong_receiver' {
  if (ratio < 0.3) return 'strong_giver';
  if (ratio > 1.5) return 'strong_receiver';
  return 'balanced';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageSkeleton({ loadingLabel }: { loadingLabel: string }) {
  return (
    <div className="space-y-4">
      <p className="text-center text-base text-theme-muted">{loadingLabel}</p>
      <Skeleton className="h-48 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  accentClass: string;
}

function StatCard({ icon, label, value, hint, accentClass }: StatCardProps) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accentClass}`}
          aria-hidden="true"
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-theme-muted">{label}</p>
          <p className="mt-1 text-2xl font-bold leading-tight text-theme-primary">{value}</p>
          {hint && <p className="mt-0.5 text-xs text-theme-muted">{hint}</p>}
        </div>
      </div>
    </GlassCard>
  );
}

interface ReciprocityBarProps {
  given: number;
  received: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ReciprocityBar({ given, received, t }: ReciprocityBarProps) {
  const total = Math.max(1, given + received);
  const givenPct = (given / total) * 100;
  const receivedPct = (received / total) * 100;

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium text-emerald-600 dark:text-emerald-400">
          {t('future_care_fund.reciprocity.given_label')}: {formatHoursShort(given, t)}
        </span>
        <span className="font-medium text-sky-600 dark:text-sky-400">
          {t('future_care_fund.reciprocity.received_label')}: {formatHoursShort(received, t)}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-theme-elevated">
        {given > 0 && (
          <div
            className="h-full bg-emerald-500 transition-all"
            style={{ width: `${givenPct}%` }}
            aria-hidden="true"
          />
        )}
        {received > 0 && (
          <div
            className="h-full bg-sky-500 transition-all"
            style={{ width: `${receivedPct}%` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

interface ByYearChartProps {
  rows: YearBreakdown[];
  t: (key: string, opts?: Record<string, unknown>) => string;
}

function ByYearChart({ rows, t }: ByYearChartProps) {
  if (rows.length === 0) return null;
  const max = Math.max(
    1,
    ...rows.map((r) => Math.max(r.hours_given, r.hours_received)),
  );

  return (
    <GlassCard className="p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold text-theme-primary">
        {t('future_care_fund.by_year.title')}
      </h2>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.year} className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-theme-primary">{row.year}</span>
              <span className="text-theme-muted">
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {t('future_care_fund.by_year.given')} {formatHoursShort(row.hours_given, t)}
                </span>
                {' · '}
                <span className="font-medium text-sky-600 dark:text-sky-400">
                  {t('future_care_fund.by_year.received')} {formatHoursShort(row.hours_received, t)}
                </span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="h-2 overflow-hidden rounded-full bg-theme-elevated">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${(row.hours_given / max) * 100}%` }}
                  aria-hidden="true"
                />
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-theme-elevated">
                <div
                  className="h-full bg-sky-500"
                  style={{ width: `${(row.hours_received / max) * 100}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function FutureCareFundPage() {
  const { t } = useTranslation('common');
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  usePageTitle(t('future_care_fund.meta.title'));

  const { data: summary, isLoading, error } = useApi<FutureCareFundSummary>(
    '/v2/caring-community/my-future-care-fund',
    { immediate: true },
  );

  // Redirect if feature is disabled.
  useEffect(() => {
    if (!hasFeature('caring_community')) {
      void navigate(tenantPath('/caring-community'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  const reciprocityMessageKey = summary
    ? `future_care_fund.reciprocity.${reciprocityKey(summary.reciprocity_ratio)}`
    : 'future_care_fund.reciprocity.balanced';

  return (
    <>
      <PageMeta
        title={t('future_care_fund.meta.title')}
        description={t('future_care_fund.meta.description')}
        noIndex
      />

      <div className="space-y-6">
        {/* Back link */}
        <Link
          to={tenantPath('/caring-community')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t('future_care_fund.back')}
        </Link>

        {/* Error state */}
        {error && !isLoading && (
          <GlassCard role="alert" className="p-6">
            <div className="flex items-center gap-3 text-danger">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <p className="font-medium">{t('future_care_fund.errors.load_failed')}</p>
            </div>
          </GlassCard>
        )}

        {/* Loading */}
        {isLoading && <PageSkeleton loadingLabel={t('future_care_fund.loading')} />}

        {/* Loaded content */}
        {!isLoading && !error && summary && (
          <>
            {/* Hero card */}
            <GlassCard className="overflow-hidden p-6 sm:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="flex items-start gap-4">
                  <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-400/30 to-amber-400/30">
                    <PiggyBank
                      className="h-7 w-7 text-[var(--color-primary)]"
                      aria-hidden="true"
                    />
                    <Heart
                      className="absolute -right-1 -top-1 h-4 w-4 fill-rose-500 text-rose-500"
                      aria-hidden="true"
                    />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold leading-tight text-theme-primary sm:text-3xl">
                      {t('future_care_fund.title')}
                    </h1>
                    <p className="mt-2 max-w-xl text-base leading-7 text-theme-muted">
                      {t('future_care_fund.intro')}
                    </p>
                  </div>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-5xl font-extrabold text-[var(--color-primary)] sm:text-6xl">
                    {formatHours(summary.net_balance)}
                  </p>
                  <p className="mt-1 text-sm font-medium uppercase tracking-wide text-theme-muted">
                    {t('future_care_fund.hours_short')}
                  </p>
                  <p className="mt-3 text-sm text-theme-muted">
                    {t('future_care_fund.subhead', {
                      value: formatChf(summary.chf_value_estimate),
                    })}
                  </p>
                </div>
              </div>

              {summary.first_contribution_date && (
                <p className="mt-6 border-t border-theme-default pt-4 text-xs text-theme-muted">
                  {t('future_care_fund.first_contribution', {
                    date: formatDate(summary.first_contribution_date),
                  })}
                </p>
              )}
            </GlassCard>

            {/* Stat cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatCard
                icon={<TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />}
                label={t('future_care_fund.stats.lifetime_given')}
                value={formatHoursShort(summary.lifetime_given, t)}
                hint={
                  summary.partner_organisations_helped > 0
                    ? t('future_care_fund.stats.partner_orgs') +
                      ': ' +
                      summary.partner_organisations_helped
                    : undefined
                }
                accentClass="bg-emerald-500/15"
              />
              <StatCard
                icon={<HandHeart className="h-5 w-5 text-sky-600 dark:text-sky-400" />}
                label={t('future_care_fund.stats.lifetime_received')}
                value={formatHoursShort(summary.lifetime_received, t)}
                accentClass="bg-sky-500/15"
              />
              <StatCard
                icon={<Calendar className="h-5 w-5 text-theme-primary" />}
                label={t('future_care_fund.stats.active_months')}
                value={`${summary.active_months}`}
                accentClass="bg-theme-elevated"
              />
            </div>

            {/* Reciprocity card */}
            <GlassCard className="p-5 sm:p-6">
              <h2 className="mb-4 text-lg font-semibold text-theme-primary">
                {t('future_care_fund.reciprocity.title')}
              </h2>
              <ReciprocityBar
                given={summary.lifetime_given}
                received={summary.lifetime_received}
                t={t}
              />
              <p className="mt-3 text-sm leading-6 text-theme-muted">
                {t(reciprocityMessageKey)}
              </p>
            </GlassCard>

            {/* By-year breakdown */}
            <ByYearChart rows={summary.by_year} t={t} />

            {/* How it works */}
            <GlassCard className="p-6 sm:p-8">
              <h2 className="mb-5 text-lg font-semibold text-theme-primary">
                {t('future_care_fund.how_it_works.title')}
              </h2>
              <ol className="space-y-4">
                <li className="flex items-start gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-sm font-bold text-[var(--color-primary)]"
                    aria-hidden="true"
                  >
                    1
                  </span>
                  <p className="pt-0.5 text-sm leading-6 text-theme-primary">
                    {t('future_care_fund.how_it_works.step1')}
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-sm font-bold text-[var(--color-primary)]"
                    aria-hidden="true"
                  >
                    2
                  </span>
                  <p className="pt-0.5 text-sm leading-6 text-theme-primary">
                    {t('future_care_fund.how_it_works.step2')}
                  </p>
                </li>
                <li className="flex items-start gap-3">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15 text-sm font-bold text-[var(--color-primary)]"
                    aria-hidden="true"
                  >
                    3
                  </span>
                  <p className="pt-0.5 text-sm leading-6 text-theme-primary">
                    {t('future_care_fund.how_it_works.step3')}
                  </p>
                </li>
              </ol>

              <div className="mt-6 flex flex-wrap gap-3">
                <Button
                  as={Link}
                  to={tenantPath('/listings/create')}
                  color="primary"
                  startContent={<Sparkles className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('future_care_fund.how_it_works.cta_offer')}
                </Button>
                <Button
                  as={Link}
                  to={tenantPath('/listings')}
                  variant="bordered"
                >
                  {t('future_care_fund.how_it_works.cta_browse')}
                </Button>
                <Button
                  as={Link}
                  to={tenantPath('/caring-community/my-relationships')}
                  variant="light"
                  startContent={<Users className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('future_care_fund.how_it_works.cta_relationships')}
                </Button>
              </div>
            </GlassCard>
          </>
        )}
      </div>
    </>
  );
}

export default FutureCareFundPage;
