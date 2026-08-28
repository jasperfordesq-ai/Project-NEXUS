// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Select, SelectItem, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useCallback, useEffect, useRef } from 'react';

import Handshake from 'lucide-react/icons/handshake';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import MessageSquare from 'lucide-react/icons/message-square';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Globe from 'lucide-react/icons/globe';
import Package from 'lucide-react/icons/package';
import Star from 'lucide-react/icons/star';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Users from 'lucide-react/icons/users';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as ReTooltip,
  CartesianGrid,
} from 'recharts';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts/ToastContext';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { adminFederation } from '../../api/adminApi';
import { BrokerEmptyState } from '@/broker/components';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

/**
 * Federation Analytics
 * KPI cards, daily API call line chart, top partners bar chart, * and recent error log table. Range selectable 7d / 30d / 90d.
 */


type Range = '7d' | '30d' | '90d';

interface AnalyticsOverview {
  range_days: number;
  kpis: {
    total_partnerships: number;
    active_partnerships: number;
    pending_partnerships: number;
    external_partners: number;
    federated_transactions: number;
    federated_messages: number;
    federated_listings: number;
    inbound_reviews: number;
  };
  daily_calls: Array<{ date: string; count: number }>;
  top_partners: Array<{ tenant_id: number; name: string; activity: number }>;
  recent_errors: Array<{
    id: number;
    endpoint: string;
    method: string;
    response_code: number;
    ip_address: string;
    created_at: string;
  }>;
}

export function FederationAnalytics() {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.analytics.title'));
  const toast = useToast();
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>('30d');
  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const res = await adminFederation.getAnalyticsOverview(range);
      if (abortRef.current.signal.aborted) return;
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setData(null);
        // Show the server's own reason (federation disabled, no partner, a
        // permission refusal) rather than a blanket load failure.
        toast.error(res.error || t('federation.failed_to_load_analytics'));
      }
    } catch {
      if (!abortRef.current?.signal.aborted) {
        setData(null);
        toast.error(t('federation.failed_to_load_analytics'));
      }
    }
    setLoading(false);
  }, [range, t, toast]);

  useEffect(() => {
    loadData();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadData]);

  const kpis = data?.kpis;

  return (
    <div>
      <PageHeader
        title={t('federation.analytics.title')}
        description={t('federation.analytics.description')}
        actions={
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('federation.analytics.range_label')}
              size="sm"
              selectedKeys={[range]}
              onSelectionChange={(keys) => {
                const k = Array.from(keys)[0] as Range | undefined;
                if (k) setRange(k);
              }}
              className="w-36"
            >
              <SelectItem key="7d" id="7d">{t('federation.analytics.range_7d')}</SelectItem>
              <SelectItem key="30d" id="30d">{t('federation.analytics.range_30d')}</SelectItem>
              <SelectItem key="90d" id="90d">{t('federation.analytics.range_90d')}</SelectItem>
            </Select>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
            >
              {t('federation.refresh')}
            </Button>
          </div>
        }
      />

      <div className="mb-6">
        <PartnerTimebankGuidance page="analytics" />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('federation.analytics.kpi_total_partnerships')}
          value={kpis?.total_partnerships ?? 0}
          icon={Handshake}
          loading={loading}
        />
        <StatCard
          label={t('federation.analytics.kpi_active_partnerships')}
          value={kpis?.active_partnerships ?? 0}
          icon={Handshake}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('federation.analytics.kpi_pending_partnerships')}
          value={kpis?.pending_partnerships ?? 0}
          icon={Clock}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('federation.analytics.kpi_external_partners')}
          value={kpis?.external_partners ?? 0}
          icon={Globe}
          loading={loading}
        />
        <StatCard
          label={t('federation.analytics.kpi_federated_transactions')}
          value={kpis?.federated_transactions ?? 0}
          icon={ArrowRightLeft}
          loading={loading}
          description={t('federation.analytics.kpi_window')}
        />
        <StatCard
          label={t('federation.analytics.kpi_federated_messages')}
          value={kpis?.federated_messages ?? 0}
          icon={MessageSquare}
          loading={loading}
          description={t('federation.analytics.kpi_window')}
        />
        <StatCard
          label={t('federation.analytics.kpi_federated_listings')}
          value={kpis?.federated_listings ?? 0}
          icon={Package}
          loading={loading}
        />
        <StatCard
          label={t('federation.analytics.kpi_inbound_reviews')}
          value={kpis?.inbound_reviews ?? 0}
          icon={Star}
          color="warning"
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 mb-6">
        <Card >
          <CardHeader>
            <h3 className="text-lg font-semibold">
              {t('federation.analytics.chart_daily_calls')}
            </h3>
          </CardHeader>
          <CardBody>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.daily_calls ?? []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-default-200" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => v.slice(5)}
                    fontSize={11}
                  />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <ReTooltip />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke={CHART_TOKEN_COLORS.primary}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card >
          <CardHeader className="flex items-center gap-2">
            <Users size={18} />
            <h3 className="text-lg font-semibold">
              {t('federation.analytics.chart_top_partners')}
            </h3>
          </CardHeader>
          <CardBody>
            <div className="h-64 w-full">
              {data && data.top_partners.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.top_partners} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-default-200" />
                    <XAxis type="number" fontSize={11} allowDecimals={false} />
                    <YAxis
                      dataKey="name"
                      type="category"
                      fontSize={11}
                      width={120}
                    />
                    <ReTooltip />
                    <Bar dataKey="activity" fill={CHART_TOKEN_COLORS.primary} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center">
                  <BrokerEmptyState
                    bare
                    icon={Users}
                    title={t('federation.analytics.no_partner_activity')}
                  />
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Recent errors */}
      <Card >
        <CardHeader className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-warning" />
          <h3 className="text-lg font-semibold">
            {t('federation.analytics.recent_errors')}
          </h3>
        </CardHeader>
        <CardBody>
          <Table
            aria-label={t('federation.analytics.recent_errors')}
            removeWrapper
            isCompact
          >
            <TableHeader>
              <TableColumn>{t('federation.col_timestamp')}</TableColumn>
              <TableColumn>{t('federation.col_method')}</TableColumn>
              <TableColumn>{t('federation.col_endpoint')}</TableColumn>
              <TableColumn>{t('federation.col_status')}</TableColumn>
              <TableColumn>{t('federation.analytics.col_ip')}</TableColumn>
            </TableHeader>
            <TableBody
              emptyContent={t('federation.analytics.no_recent_errors')}
              items={data?.recent_errors ?? []}
            >
              {(row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="text-xs text-muted">
                      {new Date(row.created_at).toLocaleString(getFormattingLocale())}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="soft">
                      {row.method}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <code className="text-xs">{row.endpoint}</code>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      color={row.response_code >= 500 ? 'danger' : 'warning'}
                      variant="tertiary"
                    >
                      {row.response_code || '—'}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted">{row.ip_address}</span>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

export default FederationAnalytics;
