import { Button, Card, CardBody, CardHeader, Chip, Spinner, Select, SelectItem, Tab, Tabs } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Download from 'lucide-react/icons/download';
import MapPin from 'lucide-react/icons/map-pin';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useChartColors } from '@/hooks/useChartColors';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG59 — Partner-facing Regional Analytics dashboard.
 *
 * Auth: ?token=<subscription_token> in the URL OR
 *       Authorization: Bearer <token>.
 *
 * All data is bucketed / anonymised server-side. Segments with N<10 are
 * suppressed and rendered as "—".
 */


// ─── Types ────────────────────────────────────────────────────────────────

type Module = 'trends' | 'demand_supply' | 'demographics' | 'footfall';
type Period = 'last_30d' | 'last_90d' | 'last_year';

interface DashboardPayload {
  period: string;
  enabled_modules: Module[];
  generated_at: string;
  engagement?: {
    period_start: string;
    period_end: string;
    active_members_bucket: string | null;
    categories_active_bucket: string | null;
    partner_orgs_bucket: string | null;
    volunteer_hours_rounded: number | null;
    event_participation_bucket: string | null;
  };
  demand_supply?: {
    cells: Array<{
      category_id: number;
      postcode_3: string;
      offers_bucket: string | null;
      requests_bucket: string | null;
      match_rate_bucket: number | null;
    }>;
  };
  demographics?: {
    age_buckets: Record<string, string | null>;
    gender_buckets: Record<string, string | null>;
  };
  footfall?: {
    areas: Record<string, { page_views_bucket: string | null; distinct_visitors_bucket: string | null }>;
  };
}

interface ReportRow {
  id: number;
  report_type: string;
  period_start: string;
  period_end: string;
  generated_at: string | null;
  status: string;
  file_url: string | null;
}

/**
 * Offers and requests keep the colours they have everywhere on the site
 * (offers green, requests amber). Every other series follows the community's
 * chart colours (`useChartColors`).
 */
const OFFERS_COLOR = '#10b981';
const REQUESTS_COLOR = '#f59e0b';

// Map a bucket label to a numeric mid-point so we can plot it.
function bucketToNumber(b: string | null): number {
  if (!b) return 0;
  if (b === '<50') return 25;
  if (b === '50-200') return 125;
  if (b === '200-1000') return 600;
  if (b === '>1000') return 1500;
  const n = Number(b);
  return Number.isFinite(n) ? n : 0;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function PartnerDashboardPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('regional_analytics.partner_dashboard_title'));
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [period, setPeriod] = useState<Period>('last_30d');
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUrl = useCallback(
    (path: string) => {
      const sep = path.includes('?') ? '&' : '?';
      return `/api/partner-analytics${path}${sep}token=${encodeURIComponent(token)}`;
    },
    [token],
  );

  const load = useCallback(async () => {
    if (!token) {
      setError('missing_token');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [dashRes, reportsRes] = await Promise.all([
        fetch(fetchUrl(`/me/dashboard?period=${period}`)),
        fetch(fetchUrl('/me/reports')),
      ]);
      if (!dashRes.ok) {
        setError(dashRes.status === 401 ? 'unauthorized' : 'fetch_failed');
        setLoading(false);
        return;
      }
      const dash = await dashRes.json();
      const rep = reportsRes.ok ? await reportsRes.json() : { data: { reports: [] } };
      const payload = dash?.data ?? dash;
      const reportList = (rep?.data?.reports ?? rep?.reports ?? []) as ReportRow[];
      setData(payload);
      setReports(reportList);
    } catch {
      setError('fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [fetchUrl, period, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = useMemo<Set<Module>>(
    () => new Set((data?.enabled_modules ?? []) as Module[]),
    [data?.enabled_modules],
  );

  const pageMeta = (
    <PageMeta
      title={t('regional_analytics.partner_dashboard_title')}
      description={t('regional_analytics.partner_dashboard_meta_description')}
      noIndex
    />
  );

  if (!token) {
    return (
      <>
        {pageMeta}
        <div className="max-w-3xl mx-auto p-8">
          <Card>
            <CardBody className="text-center p-10">
              <h1 className="text-xl font-semibold mb-2">
                {t('partner_analytics.no_token_title')}
              </h1>
              <p className="text-[var(--color-text-muted)]">
                {t('partner_analytics.no_token_body')}
              </p>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  if (loading) {
    return (
      <>
        {pageMeta}
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center p-20">
          <Spinner />
        </div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        {pageMeta}
        <div className="max-w-3xl mx-auto p-8">
          <Card>
            <CardBody className="text-center p-10">
              <h1 className="text-xl font-semibold mb-2">
                {t('partner_analytics.error_title')}
              </h1>
              <p className="text-[var(--color-text-muted)]">
                {error === 'unauthorized'
                  ? t('partner_analytics.error_unauthorized')
                  : t('partner_analytics.error_generic')}
              </p>
              <Button color="primary" className="mt-4" onPress={() => void load()}>
                {t('partner_analytics.retry')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      {pageMeta}
      <div className="max-w-7xl mx-auto space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <BarChart3 size={24} aria-hidden="true" /> {t('partner_analytics.title')}
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            {t('partner_analytics.subtitle')}
          </p>
        </div>
        <Select
          label={t('partner_analytics.period_label')}
          selectedKeys={new Set([period])}
          onSelectionChange={(keys) => {
            const v = Array.from(keys as Set<string>)[0] as Period | undefined;
            if (v) setPeriod(v);
          }}
          className="w-full sm:max-w-[220px]"
        >
          <SelectItem key="last_30d" id="last_30d">{t('partner_analytics.period_30d')}</SelectItem>
          <SelectItem key="last_90d" id="last_90d">{t('partner_analytics.period_90d')}</SelectItem>
          <SelectItem key="last_year" id="last_year">{t('partner_analytics.period_year')}</SelectItem>
        </Select>
      </div>

      <Tabs aria-label={t('partner_analytics.tabs_aria')}>
        {enabled.has('trends') && (
          <Tab key="trends" title={<span className="flex items-center gap-2"><TrendingUp size={14} aria-hidden="true" /> {t('partner_analytics.tab_trends')}</span>}>
            <TrendsTab data={data} t={t} />
          </Tab>
        )}
        {enabled.has('demand_supply') && (
          <Tab key="ds" title={<span className="flex items-center gap-2"><MapPin size={14} aria-hidden="true" /> {t('partner_analytics.tab_demand_supply')}</span>}>
            <DemandSupplyTab data={data} t={t} />
          </Tab>
        )}
        {enabled.has('demographics') && (
          <Tab key="demo" title={<span className="flex items-center gap-2"><Users size={14} aria-hidden="true" /> {t('partner_analytics.tab_demographics')}</span>}>
            <DemographicsTab data={data} t={t} />
          </Tab>
        )}
        {enabled.has('footfall') && (
          <Tab key="ff" title={<span className="flex items-center gap-2"><BarChart3 size={14} aria-hidden="true" /> {t('partner_analytics.tab_footfall')}</span>}>
            <FootfallTab data={data} t={t} />
          </Tab>
        )}
      </Tabs>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <Download size={16} aria-hidden="true" /> {t('partner_analytics.reports_title')}
        </CardHeader>
        <CardBody>
          {reports.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('partner_analytics.no_reports')}
            </p>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-col gap-3 border-b border-[var(--color-border)] py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="text-sm font-medium">
                      {r.period_start} - {r.period_end}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {r.report_type} · <Chip size="sm" variant="flat">{r.status}</Chip>
                    </div>
                  </div>
                  <Button
                    as="a"
                    href={fetchUrl(`/me/reports/${r.id}/download`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    variant="flat"
                    startContent={<Download size={14} aria-hidden="true" />}
                    isDisabled={!r.file_url || r.status !== 'generated'}
                    className="w-full sm:w-auto"
                  >
                    {t('partner_analytics.download_pdf')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <p className="text-xs text-[var(--color-text-muted)] text-center pt-4">
        {t('partner_analytics.privacy_footer')}
      </p>
      </div>
    </>
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

type T = ReturnType<typeof useTranslation>['t'];

function StatCard({
  label,
  value,
  emptyValue,
}: {
  label: string;
  value: string | number | null;
  emptyValue: string;
}) {
  return (
    <Card shadow="sm">
      <CardBody>
        <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value ?? emptyValue}</div>
      </CardBody>
    </Card>
  );
}

function TrendsTab({ data, t }: { data: DashboardPayload; t: T }) {
  const chartColors = useChartColors();
  const e = data.engagement;
  // Synthesize a single-point trend from the bucketed values for visualization.
  const series = e
    ? [
        { name: t('partner_analytics.metric_active_members'), value: bucketToNumber(e.active_members_bucket) },
        { name: t('partner_analytics.metric_categories'), value: bucketToNumber(e.categories_active_bucket) },
        { name: t('partner_analytics.metric_partner_orgs'), value: bucketToNumber(e.partner_orgs_bucket) },
        { name: t('partner_analytics.metric_event_participation'), value: bucketToNumber(e.event_participation_bucket) },
      ]
    : [];
  return (
    <div className="space-y-4 pt-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label={t('partner_analytics.metric_active_members')}
          value={e?.active_members_bucket ?? null}
          emptyValue={t('partner_analytics.suppressed_value')}
        />
        <StatCard
          label={t('partner_analytics.metric_categories')}
          value={e?.categories_active_bucket ?? null}
          emptyValue={t('partner_analytics.suppressed_value')}
        />
        <StatCard
          label={t('partner_analytics.metric_partner_orgs')}
          value={e?.partner_orgs_bucket ?? null}
          emptyValue={t('partner_analytics.suppressed_value')}
        />
        <StatCard
          label={t('partner_analytics.metric_volunteer_hours')}
          value={e?.volunteer_hours_rounded ?? null}
          emptyValue={t('partner_analytics.suppressed_value')}
        />
      </div>
      <Card>
        <CardHeader>{t('partner_analytics.engagement_overview')}</CardHeader>
        <CardBody>
          <div role="img" aria-label={t('partner_analytics.line_chart_aria')}>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke={chartColors.primary} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function DemandSupplyTab({ data, t }: { data: DashboardPayload; t: T }) {
  const cells = data.demand_supply?.cells ?? [];
  // Bar chart by postcode bucket
  const byPostcode: Record<string, { postcode: string; offers: number; requests: number }> = {};
  for (const c of cells) {
    const key = c.postcode_3 || '???';
    byPostcode[key] ??= { postcode: key, offers: 0, requests: 0 };
    byPostcode[key].offers += bucketToNumber(c.offers_bucket);
    byPostcode[key].requests += bucketToNumber(c.requests_bucket);
  }
  const barData = Object.values(byPostcode).slice(0, 12);

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>{t('partner_analytics.ds_by_postcode')}</CardHeader>
        <CardBody>
          {barData.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('partner_analytics.no_data')}
            </p>
          ) : (
            <div role="img" aria-label={t('partner_analytics.bar_chart_aria')}>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="postcode" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="offers" fill={OFFERS_COLOR} name={t('partner_analytics.offers')} />
                  <Bar dataKey="requests" fill={REQUESTS_COLOR} name={t('partner_analytics.requests')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{t('partner_analytics.match_heatmap')}</CardHeader>
        <CardBody>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {cells.slice(0, 24).map((c, i) => (
              <div
                key={i}
                className="rounded p-2 text-center text-xs"
                style={{
                  backgroundColor:
                    c.match_rate_bucket === null
                      ? 'rgba(150,150,150,0.15)'
                      : `rgba(59,130,246,${(c.match_rate_bucket ?? 0) / 100})`,
                }}
              >
                <div className="font-mono">{c.postcode_3 || t('partner_analytics.suppressed_short')}</div>
                <div className="text-[10px]">{t('partner_analytics.category_short')} {c.category_id}</div>
                <div className="font-semibold">
                  {c.match_rate_bucket === null
                    ? t('partner_analytics.suppressed_short')
                    : `${c.match_rate_bucket}%`}
                </div>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function DemographicsTab({ data, t }: { data: DashboardPayload; t: T }) {
  const chartColors = useChartColors();
  const ageData = Object.entries(data.demographics?.age_buckets ?? {}).map(([k, v]) => ({
    name: k,
    value: bucketToNumber(v),
  }));
  const genderData = Object.entries(data.demographics?.gender_buckets ?? {}).map(([k, v]) => ({
    name: k,
    value: bucketToNumber(v),
  }));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
      <Card>
        <CardHeader>{t('partner_analytics.age_distribution')}</CardHeader>
        <CardBody>
          <div role="img" aria-label={t('partner_analytics.pie_chart_aria')}>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={ageData} dataKey="value" nameKey="name" outerRadius={90} label>
                  {ageData.map((entry, i) => (
                    <Cell key={entry.name} fill={chartColors.categorical[i % chartColors.categorical.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>{t('partner_analytics.gender_distribution')}</CardHeader>
        <CardBody>
          <div role="img" aria-label={t('partner_analytics.bar_chart_aria')}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={genderData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill={chartColors.primary} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function FootfallTab({ data, t }: { data: DashboardPayload; t: T }) {
  const chartColors = useChartColors();
  const rows = Object.entries(data.footfall?.areas ?? {}).map(([area, v]) => ({
    area,
    page_views: bucketToNumber(v.page_views_bucket),
    visitors: bucketToNumber(v.distinct_visitors_bucket),
  }));
  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>{t('partner_analytics.footfall_by_area')}</CardHeader>
        <CardBody>
          <div role="img" aria-label={t('partner_analytics.area_chart_aria')}>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="area" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="page_views" stroke={chartColors.primary} fill={chartColors.primary} name={t('partner_analytics.page_views')} />
                <Area type="monotone" dataKey="visitors" stroke={chartColors.secondary} fill={chartColors.secondary} name={t('partner_analytics.distinct_visitors')} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
