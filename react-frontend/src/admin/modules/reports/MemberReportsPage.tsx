import { Card, CardBody, CardHeader, Spinner, Button, Chip, Select, SelectItem, Avatar, Tabs, Tab, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination, Skeleton } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import Users from 'lucide-react/icons/users';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingUp from 'lucide-react/icons/trending-up';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import Activity from 'lucide-react/icons/activity';
import Trophy from 'lucide-react/icons/trophy';
import BarChart3 from 'lucide-react/icons/chart-column';
import { usePageTitle } from '@/hooks';
import { api, tokenManager } from '@/lib/api';
import { formatNumber, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { CHART_COLOR_MAP } from '@/lib/chartColors';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A2 - Member Activity Reports
 *
 * Report type tabs/selector with:
 * - Active members list with last login, transaction count
 * - Registration trends chart (daily/weekly/monthly)
 * - Retention cohort table
 * - Engagement metrics cards
 * - Top contributors leaderboard
 * - Least active members list
 *
 * API: GET /api/v2/admin/reports/members?type=active|registrations|retention|engagement|top_contributors|least_active
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/*
 * 🔴 These interfaces MUST mirror app/Services/MemberReportService.php as wrapped
 * by AdminAnalyticsReportsController::memberReports(). They previously described
 * fields the backend has never returned — `avatar_url`, `last_login`,
 * `joined_at`, `count`, `initial`/`month_1..12`, `listing_rate`,
 * `avg_sessions_per_user`, `total_active_30d`, `listings_count` — which left the
 * Registration Trends chart permanently empty, the retention table rendering all
 * zeros, four engagement tiles blank, and every avatar and date column empty.
 * The page test mocked the invented shape too, so CI stayed green throughout.
 * Copy from the service, not from what a tile would like to display.
 */

/** type=active → getActiveMembers() */
interface ActiveMember {
  id: number;
  name: string;
  email: string;
  profile_image_url: string | null;
  last_login_at: string | null;
  created_at: string;
  transaction_count: number;
  hours_given: number;
  hours_received: number;
}

/** type=least_active → getLeastActiveMembers(). A DIFFERENT shape from active:
 *  no transaction/hours columns, but it carries `days_inactive`. */
interface LeastActiveMember {
  id: number;
  name: string;
  email: string;
  last_login_at: string | null;
  created_at: string;
  days_inactive: number | null;
}

/** type=registrations → getNewRegistrations(); rows live under `data`. */
interface RegistrationTrend {
  period: string;
  registrations: number;
}

/** type=retention → getMemberRetention(); `retention_rate` is a 0–1 fraction. */
interface RetentionCohort {
  cohort: string;
  cohort_month: string;
  joined: number;
  retained: number;
  retention_rate: number;
}

/** type=engagement → getEngagementMetrics(). `*_rate` are 0–1 fractions. */
interface EngagementMetrics {
  period_days: number;
  total_users: number;
  active_users: number;
  login_rate: number;
  trading_users: number;
  trading_rate: number;
  posts_created: number;
  comments_created: number;
  event_rsvps: number;
  new_connections: number;
}

/** Rows per page. Sent to the API AND used to derive the page count, so the
 *  request and the pagination control cannot drift apart. */
const MEMBER_PAGE_SIZE = 20;

/** type=top_contributors → { contributors: getTopContributors() } */
interface TopContributor {
  id: number;
  name: string;
  profile_image_url: string | null;
  hours_given: number;
  hours_received: number;
  total_hours: number;
  transaction_count: number;
}

interface ReportData extends Partial<EngagementMetrics> {
  /** active and least_active both return `members` + `total`. */
  members?: (ActiveMember | LeastActiveMember)[];
  total?: number;
  threshold_days?: number;
  /** registrations */
  data?: RegistrationTrend[];
  period_type?: string;
  months_back?: number;
  total_registrations?: number;
  /** retention */
  cohorts?: RetentionCohort[];
  overall?: { total_joined: number; total_retained: number; overall_retention_rate: number };
  /** top_contributors */
  contributors?: TopContributor[];
}

// ---------------------------------------------------------------------------
// Chart tooltip style
// ---------------------------------------------------------------------------

const tooltipStyle = {
  borderRadius: '8px',
  border: '1px solid var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-foreground)',
};

// GROUP_BY_OPTIONS and PERIOD_OPTIONS are defined inside the component to access t()

// ---------------------------------------------------------------------------
// CSV Export helper
// ---------------------------------------------------------------------------

/**
 * Which export type (if any) genuinely matches each tab.
 *
 * 🔴 The export used to be hardcoded to `members` with no parameters at all, so
 * every one of the six tabs downloaded the same complete all-time member
 * directory — differing only in filename. Four tabs have no matching export on
 * the backend at all; for those the button is disabled rather than handing the
 * operator a file that has nothing to do with what they were looking at.
 *
 * `active` maps to the member directory, which is a legitimate artefact in its
 * own right, but note it is NOT period-filtered: ReportExportService::getMemberData()
 * reads only `status`. A true "most active in period" export would need a new
 * export type backed by MemberReportService::getActiveMembers().
 */
function memberExportTypeForTab(reportType: string): string | null {
  switch (reportType) {
    case 'active': return 'members';        // full directory (all-time)
    case 'least_active': return 'inactive'; // honours `days`
    default: return null;                   // registrations / retention / engagement / top_contributors
  }
}

async function exportCsv(reportType: string, period: string) {
  const exportType = memberExportTypeForTab(reportType);
  if (!exportType) return;
  const token = tokenManager.getAccessToken();
  const tenantId = tokenManager.getTenantId();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (tenantId) headers['X-Tenant-ID'] = tenantId;

  const params = new URLSearchParams({ format: 'csv' });
  // `inactive` genuinely filters on `days`; passing it keeps the file in step
  // with the threshold shown on screen.
  if (exportType === 'inactive') params.set('days', period);

  const apiBase = import.meta.env.VITE_API_BASE || '/api';
  const res = await fetch(`${apiBase}/v2/admin/reports/${exportType}/export?${params}`, { headers, credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Name the file after what it CONTAINS, not the tab. `members` is the complete
  // directory and is not period-scoped, so calling it "member-report-active"
  // overstated what the operator was getting.
  a.download = exportType === 'members' ? 'member-directory.csv' : `member-report-${reportType}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MemberReportsPage() {
  const { t } = useTranslation('admin_reports');
  const formatPeriodLabel = (period: string): string => {
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
    if (day) {
      return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).toLocaleDateString(getFormattingLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
    }
    const month = /^(\d{4})-(\d{2})$/.exec(period);
    if (month) {
      return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleDateString(getFormattingLocale(), { month: 'short', year: 'numeric' });
    }
    const week = /^(\d{4})-W(\d{1,2})$/.exec(period);
    return week
      ? t('reports.week_period', { year: Number(week[1]), week: Number(week[2]) })
      : t('reports.unknown_period');
  };
  usePageTitle(t('reports.page_title'));
  const toast = useToast();

  const GROUP_BY_OPTIONS = [
    { key: 'daily', label: t('reports.group_by_daily') },
    { key: 'weekly', label: t('reports.group_by_weekly') },
    { key: 'monthly', label: t('reports.group_by_monthly') },
  ];

  const PERIOD_OPTIONS = [
    { key: '30', label: t('reports.period_30_days') },
    { key: '60', label: t('reports.period_60_days') },
    { key: '90', label: t('reports.period_90_days') },
    { key: '180', label: t('reports.period_180_days') },
    { key: '365', label: t('reports.period_365_days') },
  ];

  const [reportType, setReportType] = useState('active');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('30');
  const [groupBy, setGroupBy] = useState('monthly');
  const [page, setPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: reportType, period, page: String(page), limit: String(MEMBER_PAGE_SIZE) });
      if (reportType === 'registrations') params.append('group_by', groupBy);
      const res = await api.get(`/v2/admin/reports/members?${params}`);
      if (res.data) {
        setData(res.data);
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [reportType, period, groupBy, page]);

  useEffect(() => {
    setPage(1);
  }, [reportType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderActiveMembers = () => {
    const members = (data?.members ?? []) as ActiveMember[];
    const total = data?.total ?? members.length;
    const totalPages = Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE));

    return (
      <>
        <Table aria-label={t('reports.active_members')} >
          <TableHeader>
            <TableColumn>{t('reports.col_member')}</TableColumn>
            <TableColumn>{t('reports.col_last_login')}</TableColumn>
            <TableColumn>{t('reports.col_transactions')}</TableColumn>
            <TableColumn>{t('reports.col_hours_given')}</TableColumn>
            <TableColumn>{t('reports.col_hours_received')}</TableColumn>
            <TableColumn>{t('reports.col_joined')}</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={t('reports.no_active_members_found')}
            isLoading={loading}
            loadingContent={<Spinner />}
          >
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm" src={resolveAvatarUrl(m.profile_image_url) || undefined} name={m.name} />
                    <div>
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted">
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleDateString(getFormattingLocale()) : t('reports.never')}
                  </span>
                </TableCell>
                <TableCell>
                  <Chip size="sm" variant="soft">{m.transaction_count}</Chip>
                </TableCell>
                <TableCell className="text-sm text-success font-medium">{formatNumber(m.hours_given ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                <TableCell className="text-sm text-warning font-medium">{formatNumber(m.hours_received ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                <TableCell className="text-sm text-muted">
                  {m.created_at ? new Date(m.created_at).toLocaleDateString(getFormattingLocale()) : '---'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center mt-4">
            <Pagination total={totalPages} page={page} onChange={setPage} />
          </div>
        )}
      </>
    );
  };

  const renderRegistrations = () => {
    // getNewRegistrations() returns its rows under `data`. The page previously
    // looked for `trends`/`registrations`, neither of which exists, so this chart
    // always rendered the "no registration data" placeholder.
    const trends = data?.data ?? [];

    return (
      <Card >
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <TrendingUp size={18} className="text-success" aria-hidden="true" />
          <h3 className="font-semibold">{t('reports.registration_trends')}</h3>
          <div className="ml-auto">
            <Select
              size="sm"
              selectedKeys={[groupBy]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v) setGroupBy(String(v));
              }}
              className="w-32"
              aria-label={t('reports.label_group_by')}
            >
              {GROUP_BY_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>
          </div>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-[350px] items-center justify-center"><Spinner /></div>
          ) : trends.length > 0 ? (
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} tickFormatter={formatPeriodLabel} />
                <YAxis tick={{ fontSize: 12 }} tickLine={false} allowDecimals={false} tickFormatter={(value: number) => formatNumber(value)} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => formatPeriodLabel(String(value))} formatter={(value) => formatNumber(Number(value))} />
                <Legend />
                <Bar dataKey="registrations" name={t('reports.new_registrations')} fill={CHART_COLOR_MAP.success} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="flex h-[350px] items-center justify-center text-sm text-muted">
              {t('reports.no_registration_data')}
            </p>
          )}
        </CardBody>
      </Card>
    );
  };

  const renderRetention = () => {
    // getMemberRetention() returns one retention figure per cohort
    // ({joined, retained, retention_rate}), NOT a month-by-month grid. This table
    // used to render Initial/Month 1/2/3/6/12 columns from `initial` and
    // `month_N` fields that the backend has never produced, so every cell showed
    // 0 / 0%. It now shows what the service actually computes.
    const cohorts = data?.cohorts ?? [];
    const overall = data?.overall;

    return (
      <Card >
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <UserCheck size={18} className="text-accent" aria-hidden="true" />
          <h3 className="font-semibold">{t('reports.retention_cohorts')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <Table aria-label={t('reports.label_retention_cohorts')}  isStriped>
            <TableHeader>
              <TableColumn>{t('reports.col_cohort')}</TableColumn>
              <TableColumn className="text-center">{t('reports.col_joined')}</TableColumn>
              <TableColumn className="text-center">{t('reports.col_retained')}</TableColumn>
              <TableColumn className="text-center">{t('reports.col_retention_rate')}</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={t('reports.no_retention_data')}
              isLoading={loading}
              loadingContent={<Spinner />}
            >
              {cohorts.map((c) => {
                // retention_rate is already a 0–1 fraction from the service.
                const rate = c.retention_rate ?? 0;
                const color = rate >= 0.6 ? 'text-success' : rate >= 0.3 ? 'text-warning' : 'text-danger';
                return (
                  <TableRow key={c.cohort_month || c.cohort}>
                    <TableCell className="font-medium text-foreground">{c.cohort}</TableCell>
                    <TableCell className="text-center">{formatNumber(c.joined ?? 0)}</TableCell>
                    <TableCell className="text-center">{formatNumber(c.retained ?? 0)}</TableCell>
                    <TableCell className={`text-center font-medium ${color}`}>
                      {formatNumber(rate, { style: 'percent', maximumFractionDigits: 0 })}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {overall && (
            <p className="mt-3 text-sm text-muted">
              {t('reports.col_joined')}: <strong>{formatNumber(overall.total_joined ?? 0)}</strong>
              {' · '}
              {t('reports.col_retained')}: <strong>{formatNumber(overall.total_retained ?? 0)}</strong>
              {' · '}
              {t('reports.col_retention_rate')}:{' '}
              <strong>{formatNumber(overall.overall_retention_rate ?? 0, { style: 'percent', maximumFractionDigits: 0 })}</strong>
            </p>
          )}
        </CardBody>
      </Card>
    );
  };

  const renderEngagement = () => {
    const metrics = data;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('reports.label_login_rate')}
            value={metrics ? formatNumber(Number(metrics.login_rate ?? 0), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '\u2014'}
            icon={Users}
            loading={loading}
          />
          <StatCard
            label={t('reports.label_trading_rate')}
            value={metrics ? formatNumber(Number(metrics.trading_rate ?? 0), { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '\u2014'}
            icon={TrendingUp}
            color="success"
            loading={loading}
          />
          {/*
            getEngagementMetrics() returns no `listing_rate` or `messaging_rate`.
            These two tiles used to read those non-existent fields and therefore
            always displayed 0.0%. They now show two counts the service really
            does compute for the selected period.
          */}
          <StatCard
            label={t('reports.label_posts_created')}
            value={metrics ? formatNumber(metrics.posts_created ?? 0) : '\u2014'}
            icon={BarChart3}
            color="warning"
            loading={loading}
          />
          <StatCard
            label={t('reports.label_new_connections')}
            value={metrics ? formatNumber(metrics.new_connections ?? 0) : '\u2014'}
            icon={Activity}
            color="default"
            loading={loading}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/*
            `total_active_30d`, `total_members`, `avg_sessions_per_user` and
            `avg_transactions_per_user` are not returned by getEngagementMetrics()
            — the first two cards showed "0 / 0" and the last two "0.0" on every
            tenant. `active_users` / `total_users` express the same idea and are
            real; the period is whatever the selector is set to, so the label is
            deliberately period-neutral.
          */}
          <Card >
            <CardBody className="p-4">
              <p className="text-sm text-muted">{t('reports.label_active_members')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-secondary" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {formatNumber(metrics?.active_users ?? 0)} / {formatNumber(metrics?.total_users ?? 0)}
                </p>
              )}
            </CardBody>
          </Card>
          <Card >
            <CardBody className="p-4">
              <p className="text-sm text-muted">{t('reports.label_comments_created')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-secondary" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {formatNumber(metrics?.comments_created ?? 0)}
                </p>
              )}
            </CardBody>
          </Card>
          <Card >
            <CardBody className="p-4">
              <p className="text-sm text-muted">{t('reports.label_event_rsvps')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-secondary" />
              ) : (
                <p className="text-2xl font-bold text-foreground">
                  {formatNumber(metrics?.event_rsvps ?? 0)}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    );
  };

  const renderTopContributors = () => {
    const contributors = (data?.contributors ?? []) as TopContributor[];

    return (
      <Card >
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <Trophy size={18} className="text-warning" aria-hidden="true" />
          <h3 className="font-semibold">{t('reports.top_contributors')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <Table aria-label={t('reports.label_top_contributors')}  isStriped>
            <TableHeader>
              <TableColumn>{t('reports.col_rank')}</TableColumn>
              <TableColumn>{t('reports.col_member')}</TableColumn>
              <TableColumn className="text-right">{t('reports.col_given')}</TableColumn>
              <TableColumn className="text-right">{t('reports.col_received')}</TableColumn>
              <TableColumn className="text-right">{t('reports.col_transactions')}</TableColumn>
              <TableColumn className="text-right">{t('reports.col_total')}</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={t('reports.no_contributor_data')}
              isLoading={loading}
              loadingContent={<Spinner />}
            >
              {contributors.map((c, i) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <span className={`font-bold ${i < 3 ? 'text-warning' : 'text-muted'}`}>
                      {i + 1}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar size="sm" src={resolveAvatarUrl(c.profile_image_url) || undefined} name={c.name} />
                      <span className="font-medium text-foreground">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-success font-medium">{formatNumber(c.hours_given ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                  <TableCell className="text-right text-warning font-medium">{formatNumber(c.hours_received ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                  <TableCell className="text-right text-accent">{c.transaction_count}</TableCell>
                  {/* getTopContributors() returns no listings count; it returns
                      total_hours, which is the figure this leaderboard ranks on. */}
                  <TableCell className="text-right text-muted">{formatNumber(c.total_hours ?? 0, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    );
  };

  const renderLeastActive = () => {
    const members = (data?.members ?? []) as LeastActiveMember[];
    const total = data?.total ?? members.length;
    const totalPages = Math.max(1, Math.ceil(total / MEMBER_PAGE_SIZE));

    return (
      <>
        <Table aria-label={t('reports.label_least_active_members')} >
          <TableHeader>
            <TableColumn>{t('reports.col_member')}</TableColumn>
            <TableColumn>{t('reports.col_last_login')}</TableColumn>
            {/* getLeastActiveMembers() returns days_inactive, NOT transaction_count.
                The old Transactions column was always blank here. */}
            <TableColumn>{t('reports.col_days_inactive')}</TableColumn>
            <TableColumn>{t('reports.col_joined')}</TableColumn>
          </TableHeader>
          <TableBody
            emptyContent={t('reports.no_inactive_members_found')}
            isLoading={loading}
            loadingContent={<Spinner />}
          >
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm" name={m.name} />
                    <div>
                      <p className="text-sm font-medium">{m.name}</p>
                      <p className="text-xs text-muted">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={m.last_login_at ? 'default' : 'danger'}
                  >
                    {m.last_login_at ? new Date(m.last_login_at).toLocaleDateString(getFormattingLocale()) : t('reports.never')}
                  </Chip>
                </TableCell>
                <TableCell className="text-sm">{m.days_inactive != null ? formatNumber(m.days_inactive) : '—'}</TableCell>
                <TableCell className="text-sm text-muted">
                  {m.created_at ? new Date(m.created_at).toLocaleDateString(getFormattingLocale()) : '---'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex justify-center mt-4">
            <Pagination total={totalPages} page={page} onChange={setPage} />
          </div>
        )}
      </>
    );
  };

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title={t('reports.member_reports_page_title')}
        description={t('reports.member_reports_page_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Select
              size="sm"
              selectedKeys={[period]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v) setPeriod(String(v));
              }}
              className="w-32"
              aria-label={t('reports.label_period')}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>
            {/* Disabled on tabs with no matching backend export, rather than
                downloading an unrelated file. See memberExportTypeForTab(). */}
            <Button
              variant="tertiary"
              startContent={<Download size={16} aria-hidden="true" />}
              isDisabled={memberExportTypeForTab(reportType) === null}
              onPress={async () => {
                try { await exportCsv(reportType, period); } catch { toast.error(t('reports.failed_to_export_c_s_v')); }
              }}
              size="sm"
            >
              {t('reports.export_csv')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} aria-hidden="true" />}
              onPress={loadData}
              isLoading={loading}
              size="sm"
            >
              {t('reports.refresh')}
            </Button>
          </div>
        }
      />

      <Tabs
        aria-label={t('reports.members_tabs_aria')}
        selectedKey={reportType}
        onSelectionChange={(key) => setReportType(String(key))}
        variant="underlined"
        classNames={{ tabList: 'mb-4' }}
      >
        <Tab key="active" title={<span className="flex items-center gap-1.5"><Users size={14} aria-hidden="true" /> {t('reports.tab_active')}</span>} />
        <Tab key="registrations" title={<span className="flex items-center gap-1.5"><TrendingUp size={14} aria-hidden="true" /> {t('reports.tab_registrations')}</span>} />
        <Tab key="retention" title={<span className="flex items-center gap-1.5"><UserCheck size={14} aria-hidden="true" /> {t('reports.tab_retention')}</span>} />
        <Tab key="engagement" title={<span className="flex items-center gap-1.5"><Activity size={14} aria-hidden="true" /> {t('reports.tab_engagement')}</span>} />
        <Tab key="top_contributors" title={<span className="flex items-center gap-1.5"><Trophy size={14} aria-hidden="true" /> {t('reports.tab_top_contributors')}</span>} />
        <Tab key="least_active" title={<span className="flex items-center gap-1.5"><UserX size={14} aria-hidden="true" /> {t('reports.tab_least_active')}</span>} />
      </Tabs>

      {reportType === 'active' && renderActiveMembers()}
      {reportType === 'registrations' && renderRegistrations()}
      {reportType === 'retention' && renderRetention()}
      {reportType === 'engagement' && renderEngagement()}
      {reportType === 'top_contributors' && renderTopContributors()}
      {reportType === 'least_active' && renderLeastActive()}
    </div>
  );
}

export default MemberReportsPage;
