import { formatPercentRatio, formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Spinner, Select, SelectItem, Tabs, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Map from 'lucide-react/icons/map';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Activity from 'lucide-react/icons/activity';
import Heart from 'lucide-react/icons/heart';
import { usePageTitle } from '@/hooks';
import api from '@/lib/api';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { useAdminPageMeta } from '../../AdminMetaContext';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG59 — Regional Analytics Product
 * Sellable analytics dashboard for municipalities and SME partners.
 * Shows geographic density, demand/supply heatmaps, demographics, * engagement trends, volunteer breakdowns, and help-request analysis.
 *
 * User-facing admin copy is routed through translations.
 */


type AdminT = ReturnType<typeof useTranslation<'admin'>>['t'];

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type Period = 'last_30d' | 'last_90d' | 'last_12m' | 'all_time';

interface OverviewData {
  active_members: number;
  vol_hours_this_month: number;
  help_requests_this_month: number;
  most_needed_category: string;
}

interface HeatmapCell {
  lat: number;
  lng: number;
  count: number;
}

interface DemandSupplyRow {
  category_id: number;
  category_name: string;
  request_count: number;
  offer_count: number;
  ratio: number;
  trend: '↑' | '↓' | '→';
}

interface DemographicsData {
  age_groups: Record<string, number>;
  languages: Array<{ language: string; count: number }>;
  monthly_growth: Array<{ month: string; new_members: number; cumulative: number }>;
}

interface EngagementRow {
  month: string;
  active_members: number;
  vol_hours: number;
  new_listings: number;
  new_events: number;
  help_requests: number;
}

interface VolunteerData {
  top_orgs: Array<{ org_id: number; org_name: string; total_hours: number; volunteers: number }>;
  avg_hours_per_volunteer: number;
  total_hours: number;
  reciprocity_ratio: number;
}

interface HelpRequestCategoryRow {
  category: string;
  total: number;
  resolved_count: number;
  resolution_rate: number;
  avg_resolution_days: number | null;
}

interface HelpRequestData {
  by_category: HelpRequestCategoryRow[];
  resolution_trend: Array<{ month: string; total: number; resolved: number; resolution_rate: number }>;
}

type TabData =
  | HeatmapCell[]
  | DemandSupplyRow[]
  | DemographicsData
  | EngagementRow[]
  | VolunteerData
  | HelpRequestData
  | { error: string };

type AnalyticsLoadError = 'data_unavailable' | 'load_failed';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isError(data: unknown): data is { error: string } {
  return typeof data === 'object'
    && data !== null
    && 'error' in data
    && typeof (data as { error?: unknown }).error === 'string';
}

function getLoadErrorCode(data: { error: string }): AnalyticsLoadError {
  return data.error === 'data_unavailable' ? 'data_unavailable' : 'load_failed';
}

const AGE_GROUP_LABEL_KEYS: Record<string, string> = {
  under_25: 'analytics.regional.age_groups.under_25',
  '25_34': 'analytics.regional.age_groups.25_34',
  '35_44': 'analytics.regional.age_groups.35_44',
  '45_54': 'analytics.regional.age_groups.45_54',
  '55_64': 'analytics.regional.age_groups.55_64',
  '65_plus': 'analytics.regional.age_groups.65_plus',
  unknown: 'analytics.regional.age_groups.unknown',
};

const AGE_GROUP_ORDER = ['under_25', '25_34', '35_44', '45_54', '55_64', '65_plus', 'unknown'];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function TabPanel({ loading, error, t, children }: { loading: boolean; error: AnalyticsLoadError | null; t: AdminT; children: React.ReactNode }) {
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('analytics.regional.loading.section')} className="flex items-center justify-center py-16">
        <Spinner label={t('analytics.regional.loading.section')} size="lg" />
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg bg-danger/10 p-4 text-sm text-danger">
        {error === 'data_unavailable'
          ? t('analytics.regional.errors.data_unavailable')
          : t('analytics.regional.errors.failed_to_load_data')}
      </div>
    );
  }
  return <>{children}</>;
}

/** Horizontal percentage bar row */
function PercentBar({ label, value, total, color = 'bg-accent' }: { label: string; value: number; total: number; color?: string }) {
  const width = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="w-28 shrink-0 text-right text-sm text-muted">{label}</div>
      <div className="h-3 flex-1 rounded-full bg-surface-secondary">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%`, minWidth: width > 0 ? 4 : 0 }} />
      </div>
      <div className="w-20 shrink-0 text-sm text-muted">
        {value.toLocaleString(getFormattingLocale())} ({formatPercentValue(width)})
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab panels
// ─────────────────────────────────────────────────────────────────────────────

function HeatmapTab({ data, t }: { data: HeatmapCell[]; t: AdminT }) {
  const top10 = data.slice(0, 10);
  const maxCount = top10[0]?.count ?? 1;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {t('analytics.regional.heatmap.description')}
      </p>
      <Table aria-label={t('analytics.regional.sections.geographic_activity_density')} removeWrapper>
        <TableHeader>
          <TableColumn>{t('analytics.regional.columns.rank')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.latitude')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.longitude')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.members')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.density')}</TableColumn>
        </TableHeader>
        <TableBody>
          {top10.map((cell, i) => {
            const barWidth = Math.round((cell.count / maxCount) * 100);
            return (
              <TableRow key={`${cell.lat}-${cell.lng}-${i}`}>
                <TableCell className="text-muted">{i + 1}</TableCell>
                <TableCell className="font-mono">{cell.lat.toFixed(2)}</TableCell>
                <TableCell className="font-mono">{cell.lng.toFixed(2)}</TableCell>
                <TableCell className="font-semibold">{cell.count}</TableCell>
                <TableCell>
                  <div className="h-3 w-32 rounded-full bg-surface-secondary">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${barWidth}%` }} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data.length === 0 && (
        <p className="text-sm text-muted">{t('analytics.regional.empty.no_geographic_data')}</p>
      )}
    </div>
  );
}

function DemographicsTab({ data, t }: { data: DemographicsData; t: AdminT }) {
  const totalAge = Object.values(data.age_groups).reduce((a, b) => a + b, 0);
  const totalLang = data.languages.reduce((a, b) => a + b.count, 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Age distribution */}
      <Card >
        <CardHeader>
          <h3 className="text-base font-semibold">{t('analytics.regional.demographics.age_distribution')}</h3>
        </CardHeader>
        <CardBody>
          {AGE_GROUP_ORDER.map((key) => {
            const count = data.age_groups[key] ?? 0;
            return (
              <PercentBar
                key={key}
                label={t(AGE_GROUP_LABEL_KEYS[key] ?? key)}
                value={count}
                total={totalAge}
                color="bg-accent"
              />
            );
          })}
          <p className="mt-3 text-xs text-muted">{t('analytics.regional.demographics.total_with_data', { total: totalAge.toLocaleString(getFormattingLocale()) })}</p>
        </CardBody>
      </Card>

      {/* Language distribution */}
      <Card >
        <CardHeader>
          <h3 className="text-base font-semibold">{t('analytics.regional.demographics.language_distribution')}</h3>
        </CardHeader>
        <CardBody>
          {data.languages.slice(0, 12).map((l) => (
            <PercentBar
              key={l.language}
              label={new Intl.DisplayNames([getFormattingLocale()], { type: 'language' }).of(l.language) ?? t('analytics.regional.demographics.unknown_language')}
              value={l.count}
              total={totalLang}
              color="bg-surface-tertiary"
            />
          ))}
          <p className="mt-3 text-xs text-muted">{t('analytics.regional.demographics.total_active_members', { total: totalLang.toLocaleString(getFormattingLocale()) })}</p>
        </CardBody>
      </Card>

      {/* Monthly growth table */}
      <Card  className="lg:col-span-2">
        <CardHeader>
          <h3 className="text-base font-semibold">{t('analytics.regional.demographics.member_growth_12m')}</h3>
        </CardHeader>
        <CardBody>
          <Table aria-label={t('analytics.regional.demographics.member_growth_12m')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('analytics.regional.columns.month')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.new_members')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.cumulative_total')}</TableColumn>
            </TableHeader>
            <TableBody>
              {data.monthly_growth.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-mono">{row.month}</TableCell>
                  <TableCell className="font-semibold text-success">{row.new_members.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell className="text-muted">{row.cumulative.toLocaleString(getFormattingLocale())}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

function DemandSupplyTab({ data, t }: { data: DemandSupplyRow[]; t: AdminT }) {
  return (
    <div>
      <Table aria-label={t('analytics.regional.sections.demand_supply_by_category')} removeWrapper>
        <TableHeader>
          <TableColumn>{t('analytics.regional.columns.category')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.requests')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.offers')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.ratio')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.trend')}</TableColumn>
        </TableHeader>
        <TableBody>
          {data.map((row) => (
            <TableRow key={row.category_id}>
              <TableCell className="font-medium">{row.category_name}</TableCell>
              <TableCell>{row.request_count.toLocaleString(getFormattingLocale())}</TableCell>
              <TableCell>{row.offer_count.toLocaleString(getFormattingLocale())}</TableCell>
              <TableCell>
                <Chip
                  size="sm"
                  color={row.ratio >= 2 ? 'danger' : row.ratio >= 1 ? 'warning' : 'success'}
                  variant="tertiary"
                >
                  {row.ratio === 999 ? t('analytics.regional.empty.infinity') : row.ratio.toFixed(2)}
                </Chip>
              </TableCell>
              <TableCell className="text-lg">{row.trend}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.length === 0 && (
        <p className="mt-4 text-sm text-muted">{t('analytics.regional.empty.no_listing_data')}</p>
      )}
    </div>
  );
}

function EngagementTab({ data, t }: { data: EngagementRow[]; t: AdminT }) {
  const maxActive = Math.max(...data.map((r) => r.active_members), 1);

  return (
    <div>
      <Table aria-label={t('analytics.regional.sections.monthly_engagement_metrics')} removeWrapper>
        <TableHeader>
          <TableColumn>{t('analytics.regional.columns.month')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.active_members')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.vol_hours')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.new_listings')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.new_events')}</TableColumn>
          <TableColumn>{t('analytics.regional.columns.help_requests')}</TableColumn>
        </TableHeader>
        <TableBody>
          {data.map((row) => {
            const barWidth = Math.round((row.active_members / maxActive) * 80);
            return (
              <TableRow key={row.month}>
                <TableCell className="font-mono">{row.month}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-20 rounded-full bg-surface-secondary">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${barWidth}%` }} />
                    </div>
                    <span className="font-semibold">{row.active_members.toLocaleString(getFormattingLocale())}</span>
                  </div>
                </TableCell>
                <TableCell>{row.vol_hours.toLocaleString(getFormattingLocale())}</TableCell>
                <TableCell>{row.new_listings.toLocaleString(getFormattingLocale())}</TableCell>
                <TableCell>{row.new_events.toLocaleString(getFormattingLocale())}</TableCell>
                <TableCell>{row.help_requests.toLocaleString(getFormattingLocale())}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {data.length === 0 && (
        <p className="mt-4 text-sm text-muted">{t('analytics.regional.empty.no_engagement_data')}</p>
      )}
    </div>
  );
}

function VolunteerTab({ data, t }: { data: VolunteerData; t: AdminT }) {
  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card >
          <CardBody className="p-4">
            <p className="text-xs text-muted">{t('analytics.regional.volunteer.total_hours')}</p>
            <p className="text-2xl font-bold text-accent">{data.total_hours.toLocaleString(getFormattingLocale())}</p>
          </CardBody>
        </Card>
        <Card >
          <CardBody className="p-4">
            <p className="text-xs text-muted">{t('analytics.regional.volunteer.avg_hours_per_volunteer')}</p>
            <p className="text-2xl font-bold text-success">{data.avg_hours_per_volunteer.toLocaleString(getFormattingLocale())}</p>
          </CardBody>
        </Card>
        <Card >
          <CardBody className="p-4">
            <p className="text-xs text-muted">{t('analytics.regional.volunteer.reciprocity_ratio')}</p>
            <p className="text-2xl font-bold text-accent">
              {formatPercentRatio(data.reciprocity_ratio)}
            </p>
            <p className="text-xs text-muted">{t('analytics.regional.volunteer.reciprocity_description')}</p>
          </CardBody>
        </Card>
      </div>

      {/* Top orgs table */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">{t('analytics.regional.volunteer.top_orgs_title')}</h3>
        <div>
          <Table aria-label={t('analytics.regional.volunteer.top_orgs_title')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('analytics.regional.columns.rank')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.organisation')}</TableColumn>
              <TableColumn>{t('analytics.regional.volunteer.total_hours')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.volunteers')}</TableColumn>
            </TableHeader>
            <TableBody>
              {data.top_orgs.map((org, i) => (
                <TableRow key={org.org_id}>
                  <TableCell className="text-muted">{i + 1}</TableCell>
                  <TableCell className="font-medium">{org.org_name}</TableCell>
                  <TableCell className="font-semibold">{org.total_hours.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell>{org.volunteers.toLocaleString(getFormattingLocale())}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.top_orgs.length === 0 && (
            <p className="mt-4 text-sm text-muted">{t('analytics.regional.empty.no_organisation_data')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function HelpRequestsTab({ data, t }: { data: HelpRequestData; t: AdminT }) {
  return (
    <div className="space-y-6">
      {/* By category */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">{t('analytics.regional.help.by_category')}</h3>
        <div>
          <Table aria-label={t('analytics.regional.help.by_category')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('analytics.regional.columns.category')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.total')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.resolved')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.resolution_rate')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.avg_days_to_resolve')}</TableColumn>
            </TableHeader>
            <TableBody>
              {data.by_category.map((row) => (
                <TableRow key={row.category}>
                  <TableCell className="font-medium">
                    {t(`analytics.regional.help.categories.${row.category}`, { defaultValue: t('analytics.regional.help.categories.unknown') })}
                  </TableCell>
                  <TableCell>{row.total.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell>{row.resolved_count.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={row.resolution_rate >= 70 ? 'success' : row.resolution_rate >= 40 ? 'warning' : 'danger'}
                      variant="tertiary"
                    >
                      {formatPercentValue(row.resolution_rate)}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    {row.avg_resolution_days != null
                      ? t('analytics.regional.units.days_count', { count: row.avg_resolution_days })
                      : t('analytics.regional.empty_value')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.by_category.length === 0 && (
            <p className="mt-4 text-sm text-muted">{t('analytics.regional.empty.no_help_request_data')}</p>
          )}
        </div>
      </div>

      {/* Resolution trend */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">{t('analytics.regional.help.resolution_trend_6m')}</h3>
        <div>
          <Table aria-label={t('analytics.regional.help.resolution_trend_6m')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('analytics.regional.columns.month')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.total')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.resolved')}</TableColumn>
              <TableColumn>{t('analytics.regional.columns.resolution_rate')}</TableColumn>
            </TableHeader>
            <TableBody>
              {data.resolution_trend.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-mono">{row.month}</TableCell>
                  <TableCell>{row.total.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell>{row.resolved.toLocaleString(getFormattingLocale())}</TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={row.resolution_rate >= 70 ? 'success' : row.resolution_rate >= 40 ? 'warning' : 'danger'}
                      variant="tertiary"
                    >
                      {formatPercentValue(row.resolution_rate)}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function RegionalAnalyticsPage() {
  const { t } = useTranslation('admin_analytics');
  usePageTitle(t('analytics.regional.meta.title'));
  useAdminPageMeta({
    title: t('analytics.regional.meta.title'),
    description: t('analytics.regional.meta.description'),
  });

  const [period, setPeriod] = useState<Period>('last_30d');
  const [overviewData, setOverviewData] = useState<OverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState<AnalyticsLoadError | null>(null);
  const [invalidating, setInvalidating] = useState(false);

  // Per-tab data state
  const [tabData, setTabData] = useState<Record<string, TabData | null>>({});
  const [tabLoading, setTabLoading] = useState<Record<string, boolean>>({});
  const [tabError, setTabError] = useState<Record<string, AnalyticsLoadError | null>>({});

  // Track which tabs have been loaded for the current period
  const loadedTabs = useRef<Set<string>>(new Set());

  const BASE = '/v2/admin/regional-analytics';

  // Load overview on mount / period change
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const res = await api.get(`${BASE}/overview`);
      const data = (res.data as Record<string, unknown>)?.data ?? res.data;
      if (isError(data)) {
        setOverviewError(getLoadErrorCode(data));
      } else {
        setOverviewData(data as OverviewData);
      }
    } catch {
      setOverviewError('load_failed');
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  // Load a specific tab's data
  const loadTab = useCallback(async (tabKey: string) => {
    const cacheKey = `${tabKey}:${period}`;
    if (loadedTabs.current.has(cacheKey)) return;
    loadedTabs.current.add(cacheKey);

    setTabLoading((prev) => ({ ...prev, [tabKey]: true }));
    setTabError((prev) => ({ ...prev, [tabKey]: null }));

    const periodParam = `?period=${period}`;

    const endpointMap: Record<string, string> = {
      heatmap: `${BASE}/heatmap${periodParam}`,
      demand: `${BASE}/demand-supply${periodParam}`,
      demographics: `${BASE}/demographics`,
      engagement: `${BASE}/engagement-trends${periodParam}`,
      volunteer: `${BASE}/volunteer-breakdown${periodParam}`,
      help: `${BASE}/help-requests${periodParam}`,
    };

    try {
      const endpoint = endpointMap[tabKey] ?? `${BASE}/${tabKey}`;
      const res = await api.get(endpoint);
      const data = (res.data as Record<string, unknown>)?.data ?? res.data;
      if (isError(data)) {
        setTabError((prev) => ({ ...prev, [tabKey]: getLoadErrorCode(data) }));
      } else {
        setTabData((prev) => ({ ...prev, [tabKey]: data as TabData }));
      }
    } catch {
      setTabError((prev) => ({ ...prev, [tabKey]: 'load_failed' }));
    } finally {
      setTabLoading((prev) => ({ ...prev, [tabKey]: false }));
    }
  }, [period]);

  // Initial load
  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Handle period change — clear tab cache
  const handlePeriodChange = (newPeriod: Period) => {
    setPeriod(newPeriod);
    loadedTabs.current.clear();
    setTabData({});
    setTabLoading({});
    setTabError({});
    loadOverview();
  };

  // Handle tab selection
  const handleTabChange = (key: React.Key) => {
    loadTab(key as string);
  };

  // Invalidate cache
  const handleInvalidate = async () => {
    setInvalidating(true);
    try {
      const res = await api.post(`${BASE}/invalidate-cache`);
      if (res.success) {
        loadedTabs.current.clear();
        setTabData({});
        setTabLoading({});
        setTabError({});
        setOverviewData(null);
        loadOverview();
      }
    } catch {
      // Silently fail
    } finally {
      setInvalidating(false);
    }
  };

  // Export report as JSON download
  const handleExport = async () => {
    try {
      const res = await api.get(`${BASE}/export?period=${period}`);
      const payload = res.data as { data?: unknown } | undefined;
      const data = payload?.data ?? res.data;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `regional-analytics-${period}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={t('analytics.regional.meta.title')}
        subtitle={t('analytics.regional.meta.description')}
        icon={<BarChart3 size={24} />}
      />

      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label={t('analytics.regional.controls.period')}
          selectedKeys={[period]}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as Period;
            if (val) handlePeriodChange(val);
          }}
          className="w-44"
          size="sm"
          variant="secondary"
        >
          <SelectItem key="last_30d" id="last_30d">{t('analytics.regional.periods.last_30d')}</SelectItem>
          <SelectItem key="last_90d" id="last_90d">{t('analytics.regional.periods.last_90d')}</SelectItem>
          <SelectItem key="last_12m" id="last_12m">{t('analytics.regional.periods.last_12m')}</SelectItem>
          <SelectItem key="all_time" id="all_time">{t('analytics.regional.periods.all_time')}</SelectItem>
        </Select>

        <Button
          size="sm"
          variant="secondary"
          startContent={<RefreshCw size={14} />}
          isLoading={invalidating}
          onPress={handleInvalidate}
        >
          {t('analytics.regional.actions.refresh_cache')}
        </Button>

        <Button
          size="sm"
          variant="tertiary"
          startContent={<Download size={14} />}
          onPress={handleExport}
        >
          {t('analytics.regional.actions.export_report')}
        </Button>
      </div>

      {/* Hero stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label={t('analytics.regional.stats.active_members')}
          value={overviewData?.active_members ?? t('analytics.regional.empty_value')}
          icon={Users}
          color="default"
          loading={overviewLoading}
          description={t('analytics.regional.stats.active_members_description')}
        />
        <StatCard
          label={t('analytics.regional.stats.vol_hours_this_month')}
          value={overviewData?.vol_hours_this_month ?? t('analytics.regional.empty_value')}
          icon={Activity}
          color="success"
          loading={overviewLoading}
          description={t('analytics.regional.stats.vol_hours_description')}
        />
        <StatCard
          label={t('analytics.regional.stats.help_requests_this_month')}
          value={overviewData?.help_requests_this_month ?? t('analytics.regional.empty_value')}
          icon={Heart}
          color="warning"
          loading={overviewLoading}
          description={t('analytics.regional.stats.help_requests_description')}
        />
        <StatCard
          label={t('analytics.regional.stats.most_needed_category')}
          value={overviewData?.most_needed_category ?? t('analytics.regional.empty_value')}
          icon={TrendingUp}
          color="default"
          loading={overviewLoading}
          description={t('analytics.regional.stats.most_needed_description')}
        />
      </div>

      {overviewError && (
        <div role="alert" className="rounded-lg bg-danger/10 p-4 text-sm text-danger">
          {overviewError === 'data_unavailable'
            ? t('analytics.regional.errors.data_unavailable')
            : t('analytics.regional.errors.load_overview')}
        </div>
      )}

      {/* Section tabs */}
      <Card >
        <CardBody className="p-0">
          <Tabs
            aria-label={t('analytics.regional.tabs.aria')}
            variant="underlined"
            className="px-4 pt-4"
            onSelectionChange={handleTabChange}
          >
            {/* Member Heatmap */}
            <Tab
              key="heatmap"
              title={
                <div className="flex items-center gap-1.5">
                  <Map size={14} />
                  <span>{t('analytics.regional.tabs.heatmap')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.geographic_activity_density')}</h2>
                <TabPanel loading={!!tabLoading['heatmap']} error={tabError['heatmap'] ?? null} t={t}>
                  {tabData['heatmap'] && !isError(tabData['heatmap']) && (
                    <HeatmapTab data={tabData['heatmap'] as HeatmapCell[]} t={t} />
                  )}
                  {!tabData['heatmap'] && !tabLoading['heatmap'] && !tabError['heatmap'] && (
                    <p className="text-sm text-muted">{t('analytics.regional.empty.select_tab_to_load')}</p>
                  )}
                </TabPanel>
              </div>
            </Tab>

            {/* Demographics */}
            <Tab
              key="demographics"
              title={
                <div className="flex items-center gap-1.5">
                  <Users size={14} />
                  <span>{t('analytics.regional.tabs.demographics')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.member_demographics')}</h2>
                <TabPanel loading={!!tabLoading['demographics']} error={tabError['demographics'] ?? null} t={t}>
                  {tabData['demographics'] && !isError(tabData['demographics']) && (
                    <DemographicsTab data={tabData['demographics'] as DemographicsData} t={t} />
                  )}
                </TabPanel>
              </div>
            </Tab>

            {/* Demand & Supply */}
            <Tab
              key="demand"
              title={
                <div className="flex items-center gap-1.5">
                  <BarChart3 size={14} />
                  <span>{t('analytics.regional.tabs.demand_supply')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.demand_supply_by_category')}</h2>
                <p className="mb-4 text-sm text-muted">
                  {t('analytics.regional.sections.demand_supply_note')}
                </p>
                <TabPanel loading={!!tabLoading['demand']} error={tabError['demand'] ?? null} t={t}>
                  {tabData['demand'] && !isError(tabData['demand']) && (
                    <DemandSupplyTab data={tabData['demand'] as DemandSupplyRow[]} t={t} />
                  )}
                </TabPanel>
              </div>
            </Tab>

            {/* Engagement Trends */}
            <Tab
              key="engagement"
              title={
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={14} />
                  <span>{t('analytics.regional.tabs.engagement')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.monthly_engagement_metrics')}</h2>
                <TabPanel loading={!!tabLoading['engagement']} error={tabError['engagement'] ?? null} t={t}>
                  {tabData['engagement'] && !isError(tabData['engagement']) && (
                    <EngagementTab data={tabData['engagement'] as EngagementRow[]} t={t} />
                  )}
                </TabPanel>
              </div>
            </Tab>

            {/* Volunteer Breakdown */}
            <Tab
              key="volunteer"
              title={
                <div className="flex items-center gap-1.5">
                  <Activity size={14} />
                  <span>{t('analytics.regional.tabs.volunteer')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.volunteer_activity')}</h2>
                <TabPanel loading={!!tabLoading['volunteer']} error={tabError['volunteer'] ?? null} t={t}>
                  {tabData['volunteer'] && !isError(tabData['volunteer']) && (
                    <VolunteerTab data={tabData['volunteer'] as VolunteerData} t={t} />
                  )}
                </TabPanel>
              </div>
            </Tab>

            {/* Help Requests */}
            <Tab
              key="help"
              title={
                <div className="flex items-center gap-1.5">
                  <Heart size={14} />
                  <span>{t('analytics.regional.columns.help_requests')}</span>
                </div>
              }
            >
              <div className="p-4">
                <h2 className="mb-4 text-base font-semibold">{t('analytics.regional.sections.help_request_analysis')}</h2>
                <TabPanel loading={!!tabLoading['help']} error={tabError['help'] ?? null} t={t}>
                  {tabData['help'] && !isError(tabData['help']) && (
                    <HelpRequestsTab data={tabData['help'] as HelpRequestData} t={t} />
                  )}
                </TabPanel>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>
    </div>
  );
}
