import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Chip, Button, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo } from 'react';

import { Separator } from '@/components/ui';
import BarChart3 from 'lucide-react/icons/chart-column';
import Mail from 'lucide-react/icons/mail';
import Users from 'lucide-react/icons/users';
import MousePointer from 'lucide-react/icons/mouse-pointer';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trophy from 'lucide-react/icons/trophy';
import TrendingUp from 'lucide-react/icons/trending-up';
import Send from 'lucide-react/icons/send';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Target from 'lucide-react/icons/target';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { usePageTitle } from '@/hooks';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Analytics
 * Full analytics dashboard with summary stats, engagement metrics, * monthly performance chart, top performers table, and benchmark comparison.
 */

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface Totals {
  newsletters_sent: number;
  total_sent: number;
  total_failed: number;
  total_opens: number;
  unique_opens: number;
  total_clicks: number;
  unique_clicks: number;
}

interface MonthlyRow {
  month: string;
  newsletters: number;
  sent: number;
  opens: number;
  clicks: number;
}

interface TopPerformer {
  id: number;
  subject: string;
  sent_at: string;
  total_sent: number;
  open_rate: number;
  click_rate: number;
}

interface AnalyticsData {
  total_newsletters: number;
  total_sent: number;
  avg_open_rate: number;
  avg_click_rate: number;
  total_subscribers: number;
  totals?: Totals;
  monthly_breakdown?: MonthlyRow[];
  top_performers?: TopPerformer[];
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Industry benchmarks (Mailchimp 2024 all-industry averages)               */
/* ────────────────────────────────────────────────────────────────────────── */

const BENCHMARK_OPEN_RATE = 21.3;
const BENCHMARK_CLICK_RATE = 2.6;

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function formatMonth(ym: string): string {
  const [year, month] = ym.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString(getFormattingLocale(), { month: 'short', year: '2-digit' });
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString(getFormattingLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + '...';
}

function rateColor(rate: number, benchmark: number): 'success' | 'warning' | 'danger' {
  if (rate >= benchmark) return 'success';
  if (rate >= benchmark * 0.7) return 'warning';
  return 'danger';
}

function formatRate(rate: number, maximumFractionDigits = 2): string {
  return formatNumber(rate / 100, { style: 'percent', maximumFractionDigits });
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function NewsletterAnalytics() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.newsletter_analytics_title'));
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed load must not fall through to the "no analytics yet" empty state:
  // that message told communities with thousands of sent emails they had sent
  // nothing.
  const [loadFailed, setLoadFailed] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const res = await adminNewsletters.getAnalytics();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (payload && typeof payload === 'object' && 'data' in payload) {
          setData((payload as { data: AnalyticsData }).data);
        } else {
          setData(payload as AnalyticsData);
        }
      } else {
        setData(null);
        setLoadFailed(true);
      }
    } catch {
      setData(null);
      setLoadFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totals = data?.totals ?? null;
  const topPerformers = data?.top_performers ?? [];

  // Derived avg rates from totals (more accurate than column average)
  const avgOpenRate = useMemo(() => {
    if (totals && totals.total_sent > 0) {
      return Math.round((totals.unique_opens / totals.total_sent) * 1000) / 10;
    }
    return data?.avg_open_rate ?? 0;
  }, [totals, data]);

  const avgClickRate = useMemo(() => {
    if (totals && totals.total_sent > 0) {
      return Math.round((totals.unique_clicks / totals.total_sent) * 1000) / 10;
    }
    return data?.avg_click_rate ?? 0;
  }, [totals, data]);

  // Monthly chart data with computed rates
  const chartData = useMemo(
    () => {
      const monthly = data?.monthly_breakdown ?? [];
      return monthly.map((m) => ({
        ...m,
        label: formatMonth(m.month),
        openRate: m.sent > 0 ? Math.round((m.opens / m.sent) * 1000) / 10 : 0,
        clickRate: m.sent > 0 ? Math.round((m.clicks / m.sent) * 1000) / 10 : 0,
      }));
    },
    [data],
  );

  const hasData = (data?.total_newsletters ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title={t('newsletters.newsletter_analytics_title')}
        description={t('newsletters.newsletter_analytics_desc')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            isLoading={loading}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {/* ── Summary Stats ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label={t('newsletters.label_campaigns_sent')}
          value={data?.total_newsletters ?? 0}
          icon={Send}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('newsletters.label_emails_delivered')}
          value={totals?.total_sent ?? data?.total_sent ?? 0}
          icon={Mail}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('newsletters.label_avg_open_rate')}
          value={formatRate(avgOpenRate)}
          icon={Eye}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('newsletters.label_avg_click_rate')}
          value={formatRate(avgClickRate)}
          icon={MousePointer}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('newsletters.label_subscribers')}
          value={data?.total_subscribers ?? 0}
          icon={Users}
          color="default"
          loading={loading}
        />
      </div>

      {/* ── Engagement Summary ────────────────────────────────────────── */}
      {totals && hasData && (
        <Card className="mt-6">
          <CardHeader className="flex items-center gap-3 px-6 pb-0 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <BarChart3 aria-hidden="true" size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">{t('newsletters.section_engagement_summary')}</h3>
              <p className="text-sm text-muted">
                {t('newsletters.section_engagement_summary_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-6 pb-6">
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-5">
              <EngagementStat
                label={t('newsletters.label_unique_opens')}
                value={totals.unique_opens}
                color="text-accent"
              />
              <EngagementStat
                label={t('newsletters.label_total_opens')}
                value={totals.total_opens}
                color="text-accent"
              />
              <EngagementStat
                label={t('newsletters.label_unique_clicks')}
                value={totals.unique_clicks}
                color="text-success"
              />
              <EngagementStat
                label={t('newsletters.label_total_clicks')}
                value={totals.total_clicks}
                color="text-success"
              />
              {totals.total_failed > 0 && (
                <EngagementStat
                  label={t('newsletters.label_failed')}
                  value={totals.total_failed}
                  color="text-danger"
                  icon={<AlertTriangle aria-hidden="true" size={14} className="text-danger" />}
                />
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Monthly Performance Chart ─────────────────────────────────── */}
      {chartData.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex items-center gap-3 px-6 pb-0 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <TrendingUp aria-hidden="true" size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">{t('newsletters.section_monthly_performance')}</h3>
              <p className="text-sm text-muted">
                {t('newsletters.section_monthly_performance_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-2 pb-4 sm:px-6">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value) => formatRate(Number(value), 0)}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: `1px solid ${CHART_TOKEN_COLORS.border}`,
                    background: CHART_TOKEN_COLORS.surface,
                  }}
                  formatter={(value, name) => {
                    const v = value as number;
                    const n = name as string;
                    if (n === 'openRate' || n === 'clickRate') return [formatRate(v), n === 'openRate' ? t('newsletters.chart_open_rate') : t('newsletters.chart_click_rate')];
                    return [v.toLocaleString(getFormattingLocale()), n === 'sent' ? t('newsletters.chart_emails_sent') : n === 'opens' ? t('newsletters.chart_opens') : t('newsletters.chart_clicks')];
                  }}
                  labelFormatter={(label) => String(label)}
                />
                <Legend
                  formatter={(value: string) => {
                    const labels: Record<string, string> = {
                      sent: t('newsletters.chart_emails_sent'),
                      opens: t('newsletters.chart_opens'),
                      clicks: t('newsletters.chart_clicks'),
                      openRate: t('newsletters.chart_open_rate_pct'),
                      clickRate: t('newsletters.chart_click_rate_pct'),
                    };
                    return labels[value] ?? value;
                  }}
                />
                <Bar yAxisId="left" dataKey="sent" fill={CHART_TOKEN_COLORS.accent} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="opens" fill={CHART_TOKEN_COLORS.warning} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="clicks" fill={CHART_TOKEN_COLORS.success} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>

            {/* Monthly data table below chart */}
            <Separator className="my-4" />
            <div className="overflow-x-auto">
              <Table
                aria-label={t('newsletters.section_monthly_performance')}
                removeWrapper
                classNames={{ th: 'text-xs uppercase', td: 'py-2' }}
              >
                <TableHeader>
                  <TableColumn>{t('newsletters.col_month')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_newsletters')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_emails_sent')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_opens')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_clicks')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_open_rate')}</TableColumn>
                  <TableColumn className="text-center">{t('newsletters.col_click_rate')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {chartData.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-center">{row.newsletters}</TableCell>
                      <TableCell className="text-center">
                        {row.sent.toLocaleString(getFormattingLocale())}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.opens.toLocaleString(getFormattingLocale())}
                      </TableCell>
                      <TableCell className="text-center">
                        {row.clicks.toLocaleString(getFormattingLocale())}
                      </TableCell>
                      <TableCell className="text-center">
                        <Chip
                          size="sm"
                          variant="soft"
                          color={rateColor(row.openRate, BENCHMARK_OPEN_RATE)}
                        >
                          {formatRate(row.openRate)}
                        </Chip>
                      </TableCell>
                      <TableCell className="text-center">
                        <Chip
                          size="sm"
                          variant="soft"
                          color={rateColor(row.clickRate, BENCHMARK_CLICK_RATE)}
                        >
                          {formatRate(row.clickRate)}
                        </Chip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Top 10 Performers ─────────────────────────────────────────── */}
      {topPerformers.length > 0 && (
        <Card className="mt-6">
          <CardHeader className="flex items-center gap-3 px-6 pb-0 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
              <Trophy aria-hidden="true" size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">{t('newsletters.section_top_performers')}</h3>
              <p className="text-sm text-muted">
                {t('newsletters.section_top_performers_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-0 pb-4 sm:px-2">
            <Table
              aria-label={t('newsletters.label_top_performing_newsletters')}
              removeWrapper
              classNames={{ th: 'text-xs uppercase', td: 'py-3' }}
            >
              <TableHeader>
                <TableColumn className="w-[50px]">#</TableColumn>
                <TableColumn>{t('newsletters.col_subject')}</TableColumn>
                <TableColumn className="text-center">{t('newsletters.col_recipients')}</TableColumn>
                <TableColumn className="text-center">{t('newsletters.col_open_rate')}</TableColumn>
                <TableColumn className="text-center">{t('newsletters.col_click_rate')}</TableColumn>
                <TableColumn className="text-end">{t('newsletters.col_date')}</TableColumn>
              </TableHeader>
              <TableBody>
                {topPerformers.map((nl, idx) => (
                  <TableRow key={nl.id}>
                    <TableCell>
                      {idx < 3 ? (
                        <RankBadge rank={idx + 1} />
                      ) : (
                        <span className="pl-2 text-muted">{idx + 1}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{truncate(nl.subject, 55)}</span>
                    </TableCell>
                    <TableCell className="text-center text-muted">
                      {nl.total_sent.toLocaleString(getFormattingLocale())}
                    </TableCell>
                    <TableCell className="text-center">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={rateColor(nl.open_rate, BENCHMARK_OPEN_RATE)}
                      >
                        {formatRate(nl.open_rate)}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-center">
                      <Chip
                        size="sm"
                        variant="soft"
                        color={rateColor(nl.click_rate, BENCHMARK_CLICK_RATE)}
                      >
                        {formatRate(nl.click_rate)}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-end text-sm text-muted">
                      {formatDate(nl.sent_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* ── Benchmark Comparison ──────────────────────────────────────── */}
      {hasData && (
        <Card className="mt-6">
          <CardHeader className="flex items-center gap-3 px-6 pb-0 pt-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success">
              <Target aria-hidden="true" size={20} />
            </div>
            <div>
              <h3 className="text-base font-semibold">{t('newsletters.section_benchmark')}</h3>
              <p className="text-sm text-muted">
                {t('newsletters.section_benchmark_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-6 pb-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <BenchmarkCard
                label={t('newsletters.label_open_rate')}
                yours={avgOpenRate}
                benchmark={BENCHMARK_OPEN_RATE}
              />
              <BenchmarkCard
                label={t('newsletters.label_click_rate')}
                yours={avgClickRate}
                benchmark={BENCHMARK_CLICK_RATE}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Load Error ────────────────────────────────────────────────── */}
      {!loading && loadFailed && (
        <Card className="mt-6">
          <CardBody className="flex flex-col items-center justify-center py-16 text-center" role="alert">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-danger/10">
              <AlertTriangle aria-hidden="true" size={40} className="text-danger" />
            </div>
            <h3 className="text-lg font-semibold">{t('newsletters.failed_to_load_data')}</h3>
          </CardBody>
        </Card>
      )}

      {/* ── Empty State ───────────────────────────────────────────────── */}
      {!loading && !loadFailed && !hasData && (
        <Card className="mt-6">
          <CardBody className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-secondary">
              <BarChart3 aria-hidden="true" size={40} className="text-muted" />
            </div>
            <h3 className="text-lg font-semibold">{t('newsletters.empty_no_analytics')}</h3>
            <p className="mt-1 text-muted">
              {t('newsletters.empty_no_analytics_desc')}
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Sub-components                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

function EngagementStat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1">
        {icon}
        <span className={`text-2xl font-bold ${color}`}>{value.toLocaleString(getFormattingLocale())}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{label}</p>
    </div>
  );
}

const colors: Record<number, string> = {
  1: 'bg-warning text-warning-foreground',
  2: 'bg-surface-secondary text-muted',
  3: 'bg-orange-300 text-orange-900',
};

function RankBadge({ rank }: { rank: number }) {
  return (
    <span
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${colors[rank] ?? ''}`}
    >
      {rank}
    </span>
  );
}

function BenchmarkCard({
  label,
  yours,
  benchmark,
}: {
  label: string;
  yours: number;
  benchmark: number;
}) {
  const { t: tLocal } = useTranslation('admin_newsletters');
  const diff = yours - benchmark;
  const diffPct = benchmark > 0 ? Math.round((diff / benchmark) * 100) : 0;
  const isAbove = diff >= 0;

  return (
    <div className="rounded-xl border border-border p-5">
      <p className="mb-3 text-sm font-semibold text-foreground">{label}</p>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted">{tLocal('newsletters.your_average')}</p>
          <p className="text-2xl font-bold text-foreground">{formatRate(yours)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">{tLocal('newsletters.industry_avg')}</p>
          <p className="text-2xl font-bold text-muted">{formatRate(benchmark)}</p>
        </div>
      </div>
      <Separator className="my-3" />
      <div className="flex items-center gap-2">
        <Chip
          size="sm"
          variant="soft"
          color={isAbove ? 'success' : 'danger'}
          startContent={
            isAbove ? <TrendingUp aria-hidden="true" size={12} /> : <TrendingUp aria-hidden="true" size={12} className="rotate-180" />
          }
        >
          {tLocal('newsletters.benchmark_difference', {
            percentValue: formatNumber(diffPct / 100, { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' }),
            pointValue: formatNumber(diff, { maximumFractionDigits: 1, signDisplay: 'exceptZero' }),
          })}
        </Chip>
        <span className="text-xs text-muted">
          {isAbove ? tLocal('newsletters.above_benchmark') : tLocal('newsletters.below_benchmark')}
        </span>
      </div>
    </div>
  );
}

export default NewsletterAnalytics;
