import { CardBody, Card, Button, Chip } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Dashboard
 * Overview with compliance score, stats, breach alerts, and links to GDPR sub-pages.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import FileWarning from 'lucide-react/icons/file-warning';
import UserCheck from 'lucide-react/icons/user-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import ArrowRight from 'lucide-react/icons/arrow-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useTenant } from '@/contexts';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { formatPercentValue } from '@/lib/helpers';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import type { GdprDashboardStats, GdprStatistics, GdprTrendData } from '../../api/types';
import { useTranslation } from 'react-i18next';
import { logError } from '@/lib/logger';

function ComplianceScoreRing({ score, size = 120, scoreLabel }: { score: number; size?: number; scoreLabel?: string }) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-danger';
  const strokeColor = score >= 80 ? CHART_TOKEN_COLORS.success : score >= 50 ? CHART_TOKEN_COLORS.warning : CHART_TOKEN_COLORS.danger;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          className="text-border"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={8}
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-2xl font-bold ${color}`}>{formatPercentValue(score)}</span>
        <span className="text-xs text-muted">{scoreLabel}</span>
      </div>
    </div>
  );
}

export function GdprDashboard() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_dashboard_title') });
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  const [stats, setStats] = useState<GdprDashboardStats | null>(null);
  const [statistics, setStatistics] = useState<GdprStatistics | null>(null);
  const [trends, setTrends] = useState<GdprTrendData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, statsRes, trendsRes] = await Promise.all([
        adminEnterprise.getGdprDashboard(),
        adminEnterprise.getGdprStatistics(),
        adminEnterprise.getGdprTrends(),
      ]);
      if (dashRes.success && dashRes.data) {
        setStats(dashRes.data as unknown as GdprDashboardStats);
      }
      if (statsRes.success && statsRes.data) {
        setStatistics(statsRes.data as unknown as GdprStatistics);
      }
      if (trendsRes.success && trendsRes.data) {
        setTrends(trendsRes.data as unknown as GdprTrendData);
      }
    } catch (err) {
      logError('Failed to load GDPR dashboard data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const activeBreaches = statistics?.active_breaches ?? 0;
  const overdueCount = statistics?.overdue_count ?? 0;
  const complianceScore = statistics?.compliance_score ?? 0;
  const consentCoverage = statistics?.consent_coverage_percent ?? 0;

  // Build chart data from trends
  const chartData = trends ? trends.months.map((month, i) => ({
    month,
    requests: trends.requests[i],
    breaches: trends.breaches[i],
  })) : [];

  // Compute period-over-period trend for requests
  const requestsTrend = trends && trends.comparison.last_month_requests > 0
    ? Math.round(((trends.comparison.this_month_requests - trends.comparison.last_month_requests) / trends.comparison.last_month_requests) * 100)
    : undefined;

  // Compute period-over-period trend for completed requests
  const completedTrend = trends && trends.comparison.last_month_completed > 0
    ? Math.round(((trends.comparison.this_month_completed - trends.comparison.last_month_completed) / trends.comparison.last_month_completed) * 100)
    : undefined;

  const links = [
    { label: t('enterprise.link_data_requests'), href: tenantPath('/admin/enterprise/gdpr/requests'), icon: FileWarning, description: t('enterprise.link_data_requests_desc') },
    { label: t('enterprise.link_consent_records'), href: tenantPath('/admin/enterprise/gdpr/consents'), icon: UserCheck, description: t('enterprise.link_consent_records_desc') },
    { label: t('enterprise.link_data_breaches'), href: tenantPath('/admin/enterprise/gdpr/breaches'), icon: AlertTriangle, description: t('enterprise.link_data_breaches_desc') },
    { label: t('enterprise.link_gdpr_audit_log'), href: tenantPath('/admin/enterprise/gdpr/audit'), icon: ClipboardList, description: t('enterprise.link_gdpr_audit_log_desc') },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_dashboard_title')}
        description={t('enterprise.gdpr_dashboard_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={loadData}
              isLoading={loading}
              size="sm"
            >
              {t('enterprise.refresh')}
            </Button>
          </div>
        }
      />

      {/* Active Breach Alert */}
      {activeBreaches > 0 && (
        <div role="alert" className="mb-6 p-4 rounded-xl border-2 border-danger bg-danger-50 animate-pulse flex items-center gap-3">
          <ShieldAlert aria-hidden="true" size={24} className="text-danger shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-danger">
              {t('enterprise.gdpr_active_breaches_alert')}
            </p>
            <p className="text-sm text-danger-600">{t('enterprise.gdpr_review_breaches_immediately')}</p>
          </div>
          <Button
            size="sm"
            variant="danger"
            onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/breaches'))}
          >
            {t('enterprise.gdpr_view_breaches')}
          </Button>
        </div>
      )}

      {/* Compliance Score + Mini Stats */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 mb-6">
        {/* Compliance Score */}
        <Card  className="lg:col-span-1">
          <CardBody className="flex flex-col items-center justify-center p-4 gap-2">
            <p className="text-sm font-medium text-muted">{t('enterprise.gdpr_compliance_score')}</p>
            <ComplianceScoreRing score={complianceScore} scoreLabel={t('enterprise.gdpr_score')} />
          </CardBody>
        </Card>

        {/* Mini Stats Grid */}
        <div className="lg:col-span-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('enterprise.gdpr_pending_requests')}
            value={stats?.pending_requests ?? 0}
            icon={FileWarning}
            color="warning"
            loading={loading}
            trend={requestsTrend}
            trendLabel={t('enterprise.gdpr_vs_last_month')}
          />
          <StatCard
            label={t('enterprise.gdpr_completed_this_month')}
            value={statistics?.requests_by_status?.completed ?? 0}
            icon={UserCheck}
            color="default"
            loading={loading}
            trend={completedTrend}
            trendLabel={t('enterprise.gdpr_vs_last_month')}
          />
          <StatCard
            label={t('enterprise.gdpr_consent_coverage')}
            value={formatPercentValue(consentCoverage, { maximumFractionDigits: 0 })}
            icon={UserCheck}
            loading={loading}
          />
          <StatCard
            label={t('enterprise.gdpr_data_breaches')}
            value={activeBreaches}
            icon={AlertTriangle}
            color="danger"
            loading={loading}
          />
        </div>
      </div>

      {/* Trend Chart — Last 6 Months */}
      {trends && chartData.length > 0 && (
        <Card  className="mb-6">
          <CardBody className="p-4">
            <p className="text-sm font-semibold text-foreground mb-4">{t('enterprise.gdpr_requests_breaches_chart')}</p>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_TOKEN_COLORS.border} />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Area type="monotone" dataKey="requests" stackId="1" stroke={CHART_TOKEN_COLORS.primary} fill={CHART_TOKEN_COLORS.primary} fillOpacity={0.2} name={t('enterprise.gdpr_chart_requests')} />
                <Area type="monotone" dataKey="breaches" stackId="2" stroke={CHART_TOKEN_COLORS.danger} fill={CHART_TOKEN_COLORS.danger} fillOpacity={0.2} name={t('enterprise.gdpr_chart_breaches')} />
              </AreaChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      )}

      {/* Request Type Breakdown + Overdue Alert */}
      {statistics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          {/* Request Type Breakdown */}
          <Card >
            <CardBody className="p-4">
              <p className="text-sm font-semibold text-foreground mb-3">{t('enterprise.gdpr_requests_by_type')}</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(statistics.requests_by_type || {}).map(([type, count]) => (
                  <Chip key={type} size="sm" variant="soft">
                    {t(`enterprise.gdpr_type_${type}`, { defaultValue: t('enterprise.gdpr_type_unknown') })}: {count}
                  </Chip>
                ))}
                {Object.keys(statistics.requests_by_type || {}).length === 0 && (
                  <span className="text-sm text-muted">{t('enterprise.gdpr_no_requests_yet')}</span>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Overdue Alert + Quick Actions */}
          <Card >
            <CardBody className="p-4 space-y-3">
              {overdueCount > 0 && (
                <div role="alert" className="p-3 rounded-lg bg-danger-50 border border-danger-200 flex items-center gap-2">
                  <AlertTriangle aria-hidden="true" size={16} className="text-danger shrink-0" />
                  <span className="text-sm text-danger font-medium">
                    {t('enterprise.gdpr_overdue_requests', { count: overdueCount })}
                  </span>
                </div>
              )}
              <p className="text-sm font-semibold text-foreground">{t('enterprise.gdpr_quick_actions')}</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  startContent={<Plus aria-hidden="true" size={14} />}
                  as={Link}
                  to={tenantPath('/admin/enterprise/gdpr/requests/create')}
                >
                  {t('enterprise.gdpr_new_request')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  startContent={<AlertTriangle aria-hidden="true" size={14} />}
                  as={Link}
                  to={tenantPath('/admin/enterprise/gdpr/breaches')}
                >
                  {t('enterprise.gdpr_report_breach')}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Quick Links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <Card key={link.href}  isPressable as={Link} to={link.href}>
            <CardBody className="flex flex-row items-center gap-4 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <link.icon aria-hidden="true" size={20} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-foreground">{link.label}</p>
                <p className="text-sm text-muted">{link.description}</p>
              </div>
              <ArrowRight aria-hidden="true" size={16} className="text-muted shrink-0" />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default GdprDashboard;
