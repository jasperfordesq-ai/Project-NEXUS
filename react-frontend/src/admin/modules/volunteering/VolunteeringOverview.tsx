// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatNumber, getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Avatar, Skeleton, Select, SelectItem } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import { ButtonGroup } from '@/components/ui';
import Heart from 'lucide-react/icons/heart';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import Briefcase from 'lucide-react/icons/briefcase';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Building2 from 'lucide-react/icons/building-2';
import DollarSign from 'lucide-react/icons/dollar-sign';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Activity from 'lucide-react/icons/activity';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import Check from 'lucide-react/icons/check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import X from 'lucide-react/icons/x';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

/**
 * Volunteering Overview
 * Admin dashboard for volunteering module with stats, trends chart, * quick actions, and real-time activity feed.
 */


interface VolStats {
  total_opportunities: number;
  active_opportunities: number;
  total_applications: number;
  pending_applications: number;
  total_hours_logged: number;
  active_volunteers: number;
}

interface Opportunity {
  id: number;
  title: string;
  status: string;
  first_name: string;
  last_name: string;
  created_at: string;
}

interface TrendPeriod {
  period: string;
  hours: number;
  count: number;
}

interface AppPeriod {
  period: string;
  count: number;
  approved: number;
}

interface VolPeriod {
  period: string;
  count: number;
}

interface TrendsData {
  hours_by_period: TrendPeriod[];
  applications_by_period: AppPeriod[];
  volunteers_by_period: VolPeriod[];
}

interface ActivityItem {
  type: string;
  timestamp: string;
  user_name: string;
  avatar_url: string;
  description: string;
  entity_type: string;
  entity_id: number;
}

interface QuickAction {
  label: string;
  description: string;
  icon: typeof ClipboardCheck;
  path: string;
  color: 'primary' | 'warning' | 'secondary' | 'success';
}

const ACTIVITY_TYPE_COLORS: Record<string, 'success' | 'warning' | 'danger' | 'primary' | 'default'> = {
  hours_logged: 'success',
  application_pending: 'warning',
  application_approved: 'success',
  application_declined: 'danger',
  donation: 'primary',
};

function formatTimestamp(ts: string, t: TFunction): string {
  const date = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('volunteering.time_just_now');
  if (mins < 60) return t('volunteering.time_minutes_ago', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('volunteering.time_hours_ago', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('volunteering.time_days_ago', { count: days });
  return date.toLocaleDateString(getFormattingLocale());
}

function formatTrendPeriod(period: string, granularity: 'week' | 'month', t: TFunction): string {
  if (granularity === 'month') {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
      return date.toLocaleDateString(getFormattingLocale(), { month: 'short', year: 'numeric' });
    }
  } else {
    const match = /^(\d{4})-W(\d{1,2})$/.exec(period);
    if (match) {
      return t('volunteering.week_period', { year: Number(match[1]), week: Number(match[2]) });
    }
  }

  return t('volunteering.chart_period_unknown');
}

// ── Wellbeing alerts ───────────────────────────────────────────────────────────

type WellbeingStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

/**
 * Admin wellbeing alert. Every field is optional — the backend contract only
 * guarantees a loose shape, so the UI reads defensively and falls back to
 * whatever identifying/type fields the item exposes.
 */
interface WellbeingAlert {
  id?: number | string;
  user_id?: number;
  user_name?: string;
  name?: string;
  display_name?: string;
  volunteer_name?: string;
  alert_type?: string;
  risk_type?: string;
  type?: string;
  risk_level?: string;
  severity?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/** Pull the alert list out of any of the envelope shapes the endpoint may use. */
function extractWellbeingAlerts(payload: unknown): WellbeingAlert[] {
  if (Array.isArray(payload)) return payload as WellbeingAlert[];
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.data)) return p.data as WellbeingAlert[];
    if (Array.isArray(p.items)) return p.items as WellbeingAlert[];
    if (p.data && typeof p.data === 'object') {
      const inner = p.data as Record<string, unknown>;
      if (Array.isArray(inner.items)) return inner.items as WellbeingAlert[];
      if (Array.isArray(inner.data)) return inner.data as WellbeingAlert[];
    }
  }
  return [];
}

function wellbeingAlertName(a: WellbeingAlert, t: TFunction): string {
  return (
    a.user_name ||
    a.name ||
    a.display_name ||
    a.volunteer_name ||
    (a.user_id != null ? t('volunteering.wellbeing_user_number', { id: a.user_id }) : t('volunteering.wellbeing_unknown_user'))
  );
}

function wellbeingAlertType(a: WellbeingAlert, t: TFunction): string {
  return a.risk_type || a.alert_type || a.type || t('volunteering.wellbeing_unknown_type');
}

export function VolunteeringOverview() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.volunteering_overview_title'));
  const toast = useToast();
  const navigate = useNavigate();
  const [stats, setStats] = useState<VolStats | null>(null);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  // Trends state
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<'week' | 'month'>('week');
  const [trendsLoading, setTrendsLoading] = useState(true);

  // Activity feed state
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);

  // Data-load error state — surfaced on success:false / thrown failures so the
  // page never silently shows stale or empty content.
  const [loadError, setLoadError] = useState<string | null>(null);

  // Wellbeing alerts state
  const [wellbeingAlerts, setWellbeingAlerts] = useState<WellbeingAlert[]>([]);
  const [wellbeingLoading, setWellbeingLoading] = useState(true);
  const [wellbeingStatus, setWellbeingStatus] = useState<WellbeingStatus>('active');
  const [wellbeingActionId, setWellbeingActionId] = useState<number | string | null>(null);
  const [wellbeingError, setWellbeingError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getOverview();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let d: { stats?: VolStats; recent_opportunities?: Opportunity[] };
        if (payload && typeof payload === 'object' && 'data' in payload) {
          d = (payload as { data: typeof d }).data;
        } else {
          d = payload as typeof d;
        }
        setStats(d.stats || null);
        setOpportunities(d.recent_opportunities || []);
        setLoadError(null);
      } else {
        // success:false comes back without throwing — surface it instead of
        // leaving stale/empty content on screen silently.
        setStats(null);
        setOpportunities([]);
        setLoadError(t('volunteering.failed_to_load_volunteering_data'));
        toast.error(t('volunteering.failed_to_load_volunteering_data'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_volunteering_data'));
      setStats(null);
      setOpportunities([]);
      setLoadError(t('volunteering.failed_to_load_volunteering_data'));
    }
    setLoading(false);
  }, [toast, t]);


  const loadTrends = useCallback(async (period: string) => {
    setTrendsLoading(true);
    try {
      const res = await adminVolunteering.getTrends(period);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let d: TrendsData;
        if (payload && typeof payload === 'object' && 'data' in payload) {
          d = (payload as { data: TrendsData }).data;
        } else {
          d = payload as TrendsData;
        }
        setTrends(d);
      } else {
        setTrends(null);
        toast.error(t('volunteering.failed_to_load_trends'));
      }
    } catch {
      setTrends(null);
      toast.error(t('volunteering.failed_to_load_trends'));
    }
    setTrendsLoading(false);
  }, [toast, t]);

  const loadActivityFeed = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await adminVolunteering.getActivityFeed(20, 30);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let d: { activities: ActivityItem[] };
        if (payload && typeof payload === 'object' && 'data' in payload) {
          d = (payload as { data: typeof d }).data;
        } else {
          d = payload as typeof d;
        }
        setActivities(d.activities || []);
      } else {
        setActivities([]);
        toast.error(t('volunteering.failed_to_load_activity'));
      }
    } catch {
      setActivities([]);
      toast.error(t('volunteering.failed_to_load_activity'));
    }
    setActivitiesLoading(false);
  }, [toast, t]);

  const loadWellbeingAlerts = useCallback(async (status: WellbeingStatus) => {
    setWellbeingLoading(true);
    try {
      const res = await api.get(`/v2/admin/volunteering/wellbeing/alerts?status=${status}`);
      if (res.success) {
        setWellbeingAlerts(extractWellbeingAlerts(res.data));
        setWellbeingError(null);
      } else {
        setWellbeingAlerts([]);
        setWellbeingError(t('volunteering.failed_to_load_wellbeing_alerts'));
      }
    } catch {
      setWellbeingAlerts([]);
      setWellbeingError(t('volunteering.failed_to_load_wellbeing_alerts'));
    }
    setWellbeingLoading(false);
  }, [t]);

  const handleWellbeingAction = useCallback(async (alert: WellbeingAlert, status: WellbeingStatus) => {
    if (alert.id == null) return;
    setWellbeingActionId(alert.id);
    try {
      const res = await api.put(`/v2/admin/volunteering/wellbeing/alerts/${alert.id}`, { status });
      if (res.success) {
        toast.success(t('volunteering.wellbeing_alert_updated'));
        loadWellbeingAlerts(wellbeingStatus);
      } else {
        toast.error(t('volunteering.wellbeing_alert_update_failed'));
      }
    } catch {
      toast.error(t('volunteering.wellbeing_alert_update_failed'));
    }
    setWellbeingActionId(null);
  }, [toast, t, loadWellbeingAlerts, wellbeingStatus]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadTrends(trendPeriod); }, [loadTrends, trendPeriod]);
  useEffect(() => { loadActivityFeed(); }, [loadActivityFeed]);
  useEffect(() => { loadWellbeingAlerts(wellbeingStatus); }, [loadWellbeingAlerts, wellbeingStatus]);

  // Merge trend data for the chart
  const chartData = trends ? trends.hours_by_period.map((h, i) => ({
    period: h.period,
    hours: h.hours,
    applications: trends.applications_by_period[i]?.count ?? 0,
    volunteers: trends.volunteers_by_period[i]?.count ?? 0,
  })) : [];

  const quickActions: QuickAction[] = [
    { label: t('volunteering.review_applications'), description: t('volunteering.review_applications_desc'), icon: ClipboardCheck, path: '/admin/volunteering/approvals', color: 'warning' },
    { label: t('volunteering.verify_hours'), description: t('volunteering.verify_hours_desc'), icon: Clock, path: '/admin/volunteering/hours', color: 'success' },
    { label: t('volunteering.manage_organizations'), description: t('volunteering.manage_organizations_desc'), icon: Building2, path: '/admin/volunteering/organizations', color: 'secondary' },
    { label: t('volunteering.view_expenses'), description: t('volunteering.view_expenses_desc'), icon: DollarSign, path: '/admin/volunteering/expenses', color: 'primary' },
    { label: t('volunteering.manage_swaps'), description: t('volunteering.manage_swaps_desc'), icon: ArrowLeftRight, path: '/admin/volunteering/swaps', color: 'secondary' },
  ];

  // Build alert banners for urgent items
  const alerts: { message: string; path?: string }[] = [];
  if (stats && stats.pending_applications > 0) {
    alerts.push({ message: t('volunteering.alert_pending_applications', { count: stats.pending_applications }), path: '/admin/volunteering/approvals' });
  }

  const handleRefresh = () => {
    loadData();
    loadTrends(trendPeriod);
    loadActivityFeed();
    loadWellbeingAlerts(wellbeingStatus);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.volunteering_overview_title')}
        description={t('volunteering.volunteering_overview_desc')}
        actions={<Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={handleRefresh} isLoading={loading}>{t('volunteering.refresh')}</Button>}
      />

      {/* Alert Banners */}
      {!loading && alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((alert) => (
            <div
              key={alert.message}
              className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center gap-3 cursor-pointer hover:bg-amber-500/15 transition-colors"
              onClick={() => alert.path && navigate(alert.path)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && alert.path) { e.preventDefault(); navigate(alert.path); } }}
            >
              <AlertTriangle size={18} className="text-amber-500 shrink-0" />
              <span className="text-sm font-medium flex-1">{alert.message}</span>
              {alert.path && <ChevronRight size={16} className="text-amber-500/60" />}
            </div>
          ))}
        </div>
      )}

      {/* Data load error banner */}
      {!loading && loadError && (
        <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 flex items-center gap-3">
          <AlertTriangle size={18} className="text-danger shrink-0" />
          <span className="text-sm font-medium flex-1">{loadError}</span>
          <Button size="sm" variant="tertiary" onPress={handleRefresh}>{t('volunteering.retry')}</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={t('volunteering.label_active_opportunities')} value={stats?.active_opportunities ?? 0} icon={Briefcase} loading={loading} />
        <StatCard label={t('volunteering.label_pending_applications')} value={stats?.pending_applications ?? 0} icon={Users} color="warning" loading={loading} />
        <StatCard label={t('volunteering.label_total_hours_logged')} value={stats?.total_hours_logged ?? 0} icon={Clock} color="success" loading={loading} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label={t('volunteering.label_total_opportunities')} value={stats?.total_opportunities ?? 0} icon={Heart} color="default" loading={loading} />
        <StatCard label={t('volunteering.label_total_applications')} value={stats?.total_applications ?? 0} icon={Users} loading={loading} />
        <StatCard label={t('volunteering.label_active_volunteers')} value={stats?.active_volunteers ?? 0} icon={Users} color="success" loading={loading} />
      </div>

      {/* Wellbeing Alerts */}
      <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HeartPulse size={18} className="text-danger" />
            <h3 className="text-lg font-semibold">{t('volunteering.wellbeing_alerts_title')}</h3>
          </div>
          <Select
            aria-label={t('volunteering.wellbeing_filter_status_aria')}
            className="w-44"
            size="sm"
            selectedKeys={new Set([wellbeingStatus])}
            onSelectionChange={(keys) => {
              const val = Array.from(keys)[0] as WellbeingStatus;
              if (val) setWellbeingStatus(val);
            }}
          >
            <SelectItem key="active" id="active">{t('volunteering.wellbeing_status_active')}</SelectItem>
            <SelectItem key="acknowledged" id="acknowledged">{t('volunteering.wellbeing_status_acknowledged')}</SelectItem>
            <SelectItem key="resolved" id="resolved">{t('volunteering.wellbeing_status_resolved')}</SelectItem>
            <SelectItem key="dismissed" id="dismissed">{t('volunteering.wellbeing_status_dismissed')}</SelectItem>
          </Select>
        </CardHeader>
        <CardBody>
          {wellbeingLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : wellbeingError ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <AlertTriangle size={32} className="mb-2 text-danger" />
              <p>{wellbeingError}</p>
              <Button size="sm" variant="tertiary" className="mt-3" onPress={() => loadWellbeingAlerts(wellbeingStatus)}>
                {t('volunteering.retry')}
              </Button>
            </div>
          ) : wellbeingAlerts.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <HeartPulse size={40} className="mb-2" />
              <p>{t('volunteering.wellbeing_no_alerts')}</p>
              <p className="text-xs mt-1">{t('volunteering.wellbeing_no_alerts_desc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {wellbeingAlerts.map((alert, idx) => {
                const busy = wellbeingActionId !== null && wellbeingActionId === alert.id;
                const otherBusy = wellbeingActionId !== null && wellbeingActionId !== alert.id;
                const riskLevel = alert.risk_level || alert.severity;
                return (
                  <div
                    key={`${alert.id ?? 'alert'}-${idx}`}
                    className="flex flex-col gap-2 rounded-xl border border-divider/70 bg-surface-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{wellbeingAlertName(alert, t)}</span>
                        <Chip size="sm" variant="soft" color="danger" className="capitalize">
                          {wellbeingAlertType(alert, t)}
                        </Chip>
                        {riskLevel && (
                          <Chip size="sm" variant="soft" color="warning" className="capitalize">
                            {riskLevel}
                          </Chip>
                        )}
                      </div>
                      {alert.created_at && (
                        <p className="text-xs text-muted mt-1">
                          {t('volunteering.wellbeing_raised_on', { date: new Date(alert.created_at).toLocaleDateString(getFormattingLocale()) })}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<Check size={14} />}
                        isLoading={busy}
                        isDisabled={otherBusy}
                        onPress={() => handleWellbeingAction(alert, 'acknowledged')}
                      >
                        {t('volunteering.wellbeing_acknowledge')}
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        color="success"
                        startContent={<CheckCircle size={14} />}
                        isLoading={busy}
                        isDisabled={otherBusy}
                        onPress={() => handleWellbeingAction(alert, 'resolved')}
                      >
                        {t('volunteering.wellbeing_resolve')}
                      </Button>
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<X size={14} />}
                        isLoading={busy}
                        isDisabled={otherBusy}
                        onPress={() => handleWellbeingAction(alert, 'dismissed')}
                      >
                        {t('volunteering.wellbeing_dismiss')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Trends Chart */}
      <Card  className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader className="flex flex-row items-center justify-between">
          <h3 className="text-lg font-semibold">{t('volunteering.trends_title')}</h3>
          <ButtonGroup size="sm" variant="tertiary">
            <Button
              color={trendPeriod === 'week' ? 'primary' : 'default'}
              onPress={() => setTrendPeriod('week')}
            >
              {t('volunteering.weekly')}
            </Button>
            <Button
              color={trendPeriod === 'month' ? 'primary' : 'default'}
              onPress={() => setTrendPeriod('month')}
            >
              {t('volunteering.monthly')}
            </Button>
          </ButtonGroup>
        </CardHeader>
        <CardBody>
          {trendsLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-[300px] w-full rounded-lg" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <Activity size={40} className="mb-2" />
              <p>{t('volunteering.no_trend_data')}</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradHours" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradApplications" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradVolunteers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-default-200, #e5e7eb)" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value: string) => formatTrendPeriod(value, trendPeriod, t)}
                  stroke="var(--color-default-400, #9ca3af)"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={(value: number) => formatNumber(value)}
                  stroke="var(--color-default-400, #9ca3af)"
                />
                <Tooltip
                  labelFormatter={(value) => formatTrendPeriod(String(value), trendPeriod, t)}
                  formatter={(value) => formatNumber(Number(value))}
                  contentStyle={{
                    backgroundColor: 'var(--color-surface, #fff)',
                    border: '1px solid var(--color-default-200, #e5e7eb)',
                    borderRadius: '8px',
                    fontSize: '13px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="hours"
                  name={t('volunteering.chart_hours')}
                  stroke="var(--chart-color-success, #22c55e)"
                  fill="url(#gradHours)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="applications"
                  name={t('volunteering.chart_applications')}
                  stroke="var(--chart-color-info, #3b82f6)"
                  fill="url(#gradApplications)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="volunteers"
                  name={t('volunteering.chart_volunteers')}
                  stroke="var(--chart-color-accent, #a855f7)"
                  fill="url(#gradVolunteers)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {quickActions.map((action) => {
          const colorClasses: Record<string, { bg: string; text: string }> = {
            primary: { bg: 'bg-accent/10', text: 'text-accent' },
            secondary: { bg: 'bg-accent-soft', text: 'text-accent' },
            success: { bg: 'bg-success/10', text: 'text-success' },
            warning: { bg: 'bg-warning/10', text: 'text-warning' },
            danger: { bg: 'bg-danger/10', text: 'text-danger' },
          };
          const cc = colorClasses[action.color] ?? { bg: 'bg-surface-tertiary', text: 'text-muted' };
          return (
          <Card
            key={action.path}

            isPressable
            onPress={() => navigate(action.path)}
            className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] transition-transform hover:-translate-y-0.5"
          >
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className={`p-2 rounded-lg ${cc.bg}`}>
                <action.icon size={20} className={cc.text} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{action.label}</p>
                <p className="text-xs text-muted truncate">{action.description}</p>
              </div>
              <ChevronRight size={16} className="text-muted shrink-0" />
            </CardBody>
          </Card>
          );
        })}
      </div>

      {/* Recent Opportunities */}
      <Card  className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader><h3 className="text-lg font-semibold">{t('volunteering.recent_opportunities')}</h3></CardHeader>
        <CardBody>
          {opportunities.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <Heart size={40} className="mb-2" />
              <p>{t('volunteering.no_opportunities_yet')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {opportunities.map((opp) => (
                <div key={opp.id} className="flex items-center justify-between rounded-xl border border-divider/70 bg-surface-secondary/30 p-3">
                  <div>
                    <p className="font-medium">{opp.title}</p>
                      <p className="text-xs text-muted">
                        {t('volunteering.by_name', { name: resolveUserDisplayName(opp) || t('volunteering.unknown_org') })}
                      </p>
                  </div>
                  <Chip size="sm" variant="soft" color={['active', 'open'].includes(opp.status) ? 'success' : 'default'} className="capitalize">
                    {t(`volunteering.status_${opp.status || 'unknown'}`, { defaultValue: t('volunteering.status_unknown') })}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Activity Feed */}
      <Card  className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
        <CardHeader><h3 className="text-lg font-semibold">{t('volunteering.activity_feed')}</h3></CardHeader>
        <CardBody>
          {activitiesLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4 rounded-lg" />
                    <Skeleton className="h-3 w-1/2 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted">
              <Clock size={40} className="mb-2" />
              <p>{t('volunteering.no_recent_activity')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activities.map((item, idx) => {
                const typeColor = ACTIVITY_TYPE_COLORS[item.type] ?? 'default';
                return (
                  <div key={`${item.type}-${item.entity_id}-${idx}`} className="flex items-start gap-3">
                    <Avatar
                      src={item.avatar_url || undefined}
                      name={item.user_name}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{item.user_name}</span>
                        <Chip size="sm" variant="soft" color={typeColor} className="capitalize">
                          {t(`volunteering.activity_type_${item.type}`, { defaultValue: t('volunteering.activity_type_unknown') })}
                        </Chip>
                      </div>
                      <p className="text-sm text-muted mt-0.5">{item.description}</p>
                      <p className="text-xs text-muted mt-1">{formatTimestamp(item.timestamp, t)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export default VolunteeringOverview;
