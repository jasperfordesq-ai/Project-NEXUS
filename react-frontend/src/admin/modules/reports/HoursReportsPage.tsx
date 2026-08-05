import { Card, CardBody, CardHeader, Spinner, Button, Input, Chip, Select, SelectItem, Avatar, Tabs, Tab, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
} from 'recharts';
import Clock from 'lucide-react/icons/clock';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import BarChart3 from 'lucide-react/icons/chart-column';
import PieChartIcon from 'lucide-react/icons/chart-pie';
import Activity from 'lucide-react/icons/activity';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api, tokenManager } from '@/lib/api';
import { CHART_COLORS, CHART_COLOR_MAP, CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import { formatNumber, getFormattingLocale } from '@/lib/helpers';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A3 - Hours Reports
 *
 * Reports on hours exchanged, grouped by category, member, or period.
 * - Hours by category pie/bar chart
 * - Hours by member table (given/received/balance)
 * - Monthly trend chart
 * - Summary stats cards (total hours, avg per member, etc.)
 *
 * API: GET /api/v2/admin/reports/hours?group_by=category|member|period|summary
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/*
 * 🔴 These interfaces MUST mirror what app/Services/HoursReportService.php
 * actually returns. They previously described a shape the backend has never
 * produced (`category`, `month`, `unique_givers`, `members` as a flat array),
 * which left the category axis, the trend axis and a summary tile permanently
 * blank and made the "By Member" tab throw. The page test mocked the invented
 * shape too, so CI stayed green. If you change either side, change both, and
 * check HoursReportsPage.test.tsx still mocks the real thing.
 */

/** HoursReportService::getHoursByCategory() */
interface CategoryHours {
  category_id: number | null;
  category_name: string;
  category_color: string;
  total_hours: number;
  transaction_count: number;
  unique_providers: number;
  unique_receivers: number;
}

/** HoursReportService::getHoursByMember() — note: no `balance` is returned. */
interface MemberHours {
  user_id: number;
  name: string;
  avatar_url: string | null;
  hours_given: number;
  hours_received: number;
  total_hours: number;
  given_count: number;
  received_count: number;
  total_transactions: number;
}

/** getHoursByMember() returns a paginated envelope, NOT a flat array. */
interface MemberHoursPage {
  data: MemberHours[];
  total: number;
}

/** HoursReportService::getHoursByPeriod() — `period` is 'YYYY-MM'. */
interface PeriodHours {
  period: string;
  period_label: string;
  total_hours: number;
  transaction_count: number;
  unique_providers: number;
  unique_receivers: number;
  unique_participants: number;
}

interface HoursReportData {
  categories?: CategoryHours[];
  members?: MemberHoursPage;
  periods?: PeriodHours[];
}

/** HoursReportService::getHoursSummary() */
interface HoursSummary {
  total_hours: number;
  total_transactions: number;
  avg_hours_per_transaction: number;
  max_single_transaction: number;
  unique_providers: number;
  unique_receivers: number;
  total_members: number;
  participation_rate: number;
  this_month?: { hours: number; transactions: number };
  last_month?: { hours: number; transactions: number };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const tooltipStyle = {
  borderRadius: '8px',
  border: `1px solid ${CHART_TOKEN_COLORS.border}`,
  backgroundColor: CHART_TOKEN_COLORS.surface,
  color: CHART_TOKEN_COLORS.foreground,
};

const PIE_COLORS = CHART_COLORS;

/** Rows per page for the By Member table. Sent to the API AND used to derive the
 *  page count, so the request and the pagination control cannot drift apart. */
const MEMBER_PAGE_SIZE = 50;

const SORT_OPTIONS = [
  { key: 'total' },
  { key: 'given' },
  { key: 'received' },
];

// ---------------------------------------------------------------------------
// CSV Export helper
// ---------------------------------------------------------------------------

/**
 * Map the active tab (`groupBy`) to its export type.
 *
 * 🔴 This function exists because the export URL used to be hardcoded to
 * `hours_category` while only the *filename* varied by tab — so an operator on
 * "By Member" clicked Export and received category totals in a file called
 * `hours-report-member.csv`. The whole point of an export is that it matches the
 * screen; if you add a tab, add its export type here and in
 * ReportExportService::SUPPORTED_TYPES.
 */
function exportTypeForTab(groupBy: string): string {
  switch (groupBy) {
    case 'member': return 'hours_member';
    case 'period': return 'hours_period';
    case 'category':
    default: return 'hours_category';
  }
}

/** `tab` is the active groupBy ('category' | 'member' | 'period'). */
async function exportCsv(tab: string, dateFrom?: string, dateTo?: string) {
  const exportType = exportTypeForTab(tab);
  const token = tokenManager.getAccessToken();
  const tenantId = tokenManager.getTenantId();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['X-Tenant-ID'] = tenantId;

  const params = new URLSearchParams({ format: 'csv' });
  if (dateFrom) params.append('date_from', dateFrom);
  if (dateTo) params.append('date_to', dateTo);

  const apiBase = import.meta.env.VITE_API_BASE || '/api';
  const res = await fetch(`${apiBase}/v2/admin/reports/${exportType}/export?${params}`, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Name the file after the tab the operator was looking at; the URL above uses
  // the mapped export type so the CONTENTS match that tab.
  a.download = `hours-report-${tab}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HoursReportsPage() {
  const { t } = useTranslation('admin_reports');
  usePageTitle(t('reports.page_title'));
  const toast = useToast();

  const [groupBy, setGroupBy] = useState('category');
  const [data, setData] = useState<HoursReportData | null>(null);
  const [summary, setSummary] = useState<HoursSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState('total');
  const [page, setPage] = useState(1);

  // Load summary always
  const loadSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams({ group_by: 'summary' });
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      const res = await api.get(`/v2/admin/reports/hours?${params}`);
      if (res.data) {
        setSummary(res.data as HoursSummary);
      }
    } catch {
      toast.error(t('reports.failed_to_load_summary_data'));
    }
  }, [dateFrom, dateTo, t, toast])


  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ group_by: groupBy, page: String(page), limit: String(MEMBER_PAGE_SIZE) });
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (groupBy === 'member') params.append('sort_by', sortBy);
      const res = await api.get(`/v2/admin/reports/hours?${params}`);
      if (res.data) {
        setData(res.data);
      }
    } catch {
      toast.error(t('reports.failed_to_load_report_data'));
    } finally {
      setLoading(false);
    }
  }, [groupBy, dateFrom, dateTo, sortBy, page, t, toast])


  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    setPage(1);
  }, [groupBy]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Render: Summary cards
  // -------------------------------------------------------------------------

  const renderSummary = () => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
      <StatCard
        label={t('reports.label_total_hours')}
        value={summary ? formatNumber(summary.total_hours ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '\u2014'}
        icon={Clock}
        color="warning"
        loading={!summary}
      />
      <StatCard
        label={t('reports.label_total_transactions')}
        value={summary?.total_transactions ?? '\u2014'}
        icon={ArrowLeftRight}
        loading={!summary}
      />
      <StatCard
        label={t('reports.label_unique_givers')}
        value={summary?.unique_providers ?? '\u2014'}
        icon={Users}
        color="success"
        loading={!summary}
      />
      <StatCard
        label={t('reports.label_avg_hours_transaction')}
        value={summary ? formatNumber(summary.avg_hours_per_transaction ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '\u2014'}
        icon={Activity}
        loading={!summary}
      />
    </div>
  );

  // -------------------------------------------------------------------------
  // Render: Category chart
  // -------------------------------------------------------------------------

  const renderCategory = () => {
    const categories = (data?.categories ?? []) as CategoryHours[];

    return (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Bar Chart */}
        <Card >
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <BarChart3 aria-hidden="true" size={18} className="text-accent" />
            <h3 className="font-semibold">{t('reports.chart_hours_by_category')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-[350px] items-center justify-center"><Spinner /></div>
            ) : categories.length > 0 ? (
              <div role="img" aria-label={t('reports.hours_by_category_aria')}>
                <ResponsiveContainer width="100%" height={350}>
                  <BarChart data={categories} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(value: number) => formatNumber(value)} />
                    <YAxis type="category" dataKey="category_name" tick={{ fontSize: 11 }} width={80} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="total_hours" name={t('reports.hours')} fill={CHART_COLOR_MAP.primary} radius={[0, 4, 4, 0]} fillOpacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="flex h-[350px] items-center justify-center text-sm text-muted">
                {t('reports.no_category_data')}
              </p>
            )}
          </CardBody>
        </Card>

        {/* Pie Chart */}
        <Card >
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <PieChartIcon aria-hidden="true" size={18} className="text-accent" />
            <h3 className="font-semibold">{t('reports.chart_category_distribution')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-[350px] items-center justify-center"><Spinner /></div>
            ) : categories.length > 0 ? (
              <div role="img" aria-label={t('reports.hours_distribution_aria')}>
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={categories.filter((c) => c.total_hours > 0)}
                      dataKey="total_hours"
                      nameKey="category_name"
                      cx="50%"
                      cy="50%"
                      outerRadius={110}
                      innerRadius={50}
                      paddingAngle={2}
                      label={({ name, percent }) =>
                        `${name} (${formatNumber(percent ?? 0, { style: 'percent', maximumFractionDigits: 0 })})`
                      }
                      labelLine={{ strokeWidth: 1 }}
                    >
                      {categories
                        .filter((c) => c.total_hours > 0)
                        .map((entry, index) => (
                          <Cell key={`cell-${entry.category_id ?? entry.category_name}`} fill={PIE_COLORS[index % PIE_COLORS.length]} fillOpacity={0.85} />
                        ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value, name) =>
                        [t('reports.hours_value', { value: formatNumber(Number(value ?? 0), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }), String(name ?? '')] as [string, string]
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="flex h-[350px] items-center justify-center text-sm text-muted">
                {t('reports.no_category_data')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Render: Member table
  // -------------------------------------------------------------------------

  const renderMember = () => {
    // getHoursByMember() returns { data, total }. Treating it as an array here
    // is what made this tab throw "members.map is not a function".
    const members = data?.members?.data ?? [];
    const memberPages = Math.max(1, Math.ceil((data?.members?.total ?? 0) / MEMBER_PAGE_SIZE));

    return (
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Select
            size="sm"
            selectedKeys={[sortBy]}
            onSelectionChange={(keys) => {
              const v = Array.from(keys)[0];
              if (v) setSortBy(String(v));
            }}
            className="w-40"
            aria-label={t('reports.label_sort_by')}
            label={t('reports.label_sort_by')}
          >
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.key} id={opt.key}>
                {opt.key === 'total' ? t('reports.sort_total_hours') : opt.key === 'given' ? t('reports.sort_hours_given') : t('reports.sort_hours_received')}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Table aria-label={t('reports.label_hours_by_member')} >
          <TableHeader>
            <TableColumn>{t('reports.col_member')}</TableColumn>
            <TableColumn>{t('reports.col_hours_given')}</TableColumn>
            <TableColumn>{t('reports.col_hours_received')}</TableColumn>
            <TableColumn>{t('reports.col_total')}</TableColumn>
            <TableColumn>{t('reports.col_balance')}</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={t('reports.no_member_hours_data')}
            isLoading={loading}
            loadingContent={<Spinner />}
          >
            {members.map((m) => {
              // The service returns no `balance` field. The meaningful figure in
              // an hours report is the member's net position over the selected
              // range, which is derivable from the two columns beside it.
              const net = (m.hours_given ?? 0) - (m.hours_received ?? 0);
              return (
                <TableRow key={m.user_id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm" src={m.avatar_url ?? undefined} name={m.name} />
                      <span className="text-sm font-medium">{m.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-success font-medium">{formatNumber(m.hours_given ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                  <TableCell className="text-sm text-warning font-medium">{formatNumber(m.hours_received ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                  <TableCell className="text-sm text-muted font-medium">{formatNumber(m.total_hours ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={net >= 0 ? 'success' : 'danger'}
                    >
                      {formatNumber(net, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: net >= 0 ? 'always' : 'auto' })}
                    </Chip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {/*
          The `page` state was already being sent to the API but there was no
          control to change it, so this table silently showed only the first 50
          members of however many the tenant has. `total` comes from the same
          paginated envelope that used to be mis-read as an array.
        */}
        {memberPages > 1 && (
          <div className="mt-4 flex justify-center">
            <Pagination
              total={memberPages}
              page={page}
              onChange={setPage}
              showControls
            />
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Render: Period trend
  // -------------------------------------------------------------------------

  const renderPeriod = () => {
    const periods = (data?.periods ?? []) as PeriodHours[];

    return (
      <Card >
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <TrendingUp aria-hidden="true" size={18} className="text-accent" />
          <h3 className="font-semibold">{t('reports.chart_monthly_hours_trend')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-[350px] items-center justify-center"><Spinner /></div>
          ) : periods.length > 0 ? (
            <div role="img" aria-label={t('reports.hours_trend_aria')}>
              <ResponsiveContainer width="100%" height={350}>
                <AreaChart data={periods} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="hrTotalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="hrTxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLOR_MAP.success} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLOR_MAP.success} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    tickFormatter={(period: string) => {
                      const match = /^(\d{4})-(\d{2})$/.exec(period);
                      return match
                        ? new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString(getFormattingLocale(), { month: 'short', year: 'numeric' })
                        : t('reports.unknown_period');
                    }}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} tickFormatter={(value: number) => formatNumber(value)} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} formatter={(value) => formatNumber(Number(value), { maximumFractionDigits: 1 })} />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="total_hours"
                    name={t('reports.sort_total_hours')}
                    stroke={CHART_COLOR_MAP.primary}
                    fill="url(#hrTotalGrad)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="transaction_count"
                    name={t('reports.label_transactions')}
                    stroke={CHART_COLOR_MAP.success}
                    fill="url(#hrTxGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="flex h-[350px] items-center justify-center text-sm text-muted">
              {t('reports.no_period_data')}
            </p>
          )}
        </CardBody>
      </Card>
    );
  };

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title={t('reports.hours_reports_page_title')}
        description={t('reports.hours_reports_page_desc')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Input
              type="date"
              size="sm"
              value={dateFrom}
              onValueChange={setDateFrom}
              aria-label={t('reports.label_from_date')}
              className="w-36"
              variant="secondary"
            />
            <Input
              type="date"
              size="sm"
              value={dateTo}
              onValueChange={setDateTo}
              aria-label={t('reports.label_to_date')}
              className="w-36"
              variant="secondary"
            />
            <Button
              variant="tertiary"
              startContent={<Download size={16} />}
              onPress={async () => {
                try { await exportCsv(groupBy, dateFrom, dateTo); } catch { toast.error(t('reports.failed_to_export_c_s_v')); }
              }}
              size="sm"
            >
              {t('reports.export_csv')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={() => { loadSummary(); loadData(); }}
              isLoading={loading}
              isDisabled={loading}
              size="sm"
            >
              {t('reports.refresh')}
            </Button>
          </div>
        }
      />

      {renderSummary()}

      <Tabs
        aria-label={t('reports.hours_tabs_aria')}
        selectedKey={groupBy}
        onSelectionChange={(key) => setGroupBy(String(key))}
        variant="underlined"
        classNames={{ tabList: 'mb-4' }}
      >
        <Tab key="category" title={<span className="flex items-center gap-1.5"><PieChartIcon aria-hidden="true" size={14} /> {t('reports.tab_by_category')}</span>} />
        <Tab key="member" title={<span className="flex items-center gap-1.5"><Users aria-hidden="true" size={14} /> {t('reports.tab_by_member')}</span>} />
        <Tab key="period" title={<span className="flex items-center gap-1.5"><TrendingUp aria-hidden="true" size={14} /> {t('reports.tab_monthly_trend')}</span>} />
      </Tabs>

      {groupBy === 'category' && renderCategory()}
      {groupBy === 'member' && renderMember()}
      {groupBy === 'period' && renderPeriod()}
    </div>
  );
}

export default HoursReportsPage;
