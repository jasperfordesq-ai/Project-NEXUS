import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Chip, Table, TableHeader, TableBody, TableRow, TableColumn, TableCell } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import History from 'lucide-react/icons/history';
import { usePageTitle } from '@/hooks';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { HealthCheckResult, HealthCheckHistoryEntry } from '../../api/types';

// Written out in full so Tailwind can find them (a class built at runtime,
// such as `text-${color}`, is never generated and shows no colour).
const STATUS_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
const STATUS_TINT = { success: 'bg-success/10', warning: 'bg-warning/10', danger: 'bg-danger/10' } as const;
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Health Check
 * System health status indicators with history.
 */


function statusBorderClass(status: string): string {
  switch (status) {
    case 'ok':
      return 'border-success';
    case 'fail':
      return 'border-danger';
    default:
      return 'border-border';
  }
}

export function HealthCheck() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));

  const [result, setResult] = useState<HealthCheckResult | null>(null);
  const [history, setHistory] = useState<HealthCheckHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getHealthCheck();
      if (res.success && res.data) {
        setResult(res.data as unknown as HealthCheckResult);
      }
    } catch {
      setResult({
        status: 'unhealthy',
        checks: [{ code: 'api', status: 'fail' }],
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await adminEnterprise.getHealthHistory();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setHistory(Array.isArray(data) ? data.slice(0, 10) : []);
      }
    } catch {
      // Silently handle — history is supplementary
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    loadHistory();
  }, [loadData, loadHistory]);

  const handleRefresh = () => {
    loadData();
    loadHistory();
  };

  const statusColor = result?.status === 'healthy' ? 'success' : result?.status === 'degraded' ? 'warning' : 'danger';

  const getOverallStatusLabel = (status: string) => {
    switch (status) {
      case 'healthy':
        return t('enterprise.status_healthy');
      case 'degraded':
        return t('enterprise.status_degraded');
      case 'unhealthy':
        return t('enterprise.status_unhealthy');
      default:
        return t('enterprise.status_unknown');
    }
  };

  const getCheckStatusLabel = (status: string) => (
    status === 'ok' ? t('enterprise.operational') : t('enterprise.failed')
  );

  const getCheckStatusCodeLabel = (status: string) => (
    status === 'ok' ? t('enterprise.status_ok') : t('enterprise.status_fail')
  );

  const getCheckName = (check: HealthCheckResult['checks'][number]) =>
    t(`enterprise.health_check_name_${check.code}`, {
      ...(check.params ?? {}),
      defaultValue: t('enterprise.health_check_name_unknown'),
    });

  return (
    <div>
      <PageHeader
        title={t('enterprise.health_check_title')}
        description={t('enterprise.health_check_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={handleRefresh}
            isLoading={loading}
            size="sm"
          >
            {t('enterprise.refresh')}
          </Button>
        }
      />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : result ? (
        <div className="space-y-6">
          {/* Overall Status */}
          <Card >
            <CardBody className="flex flex-row items-center gap-4 p-6">
              <div className={`flex h-14 w-14 items-center justify-center rounded-full ${STATUS_TINT[statusColor]}`}>
                <HeartPulse aria-hidden="true" size={28} className={STATUS_TEXT[statusColor]} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">{t('enterprise.system_status')}</h3>
                <Chip size="sm" variant="soft" color={statusColor} className="mt-1 capitalize">
                  {getOverallStatusLabel(result.status)}
                </Chip>
              </div>
            </CardBody>
          </Card>

          {/* Individual Checks - Enhanced with colored borders */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.checks.map((check) => (
              <Card
                key={`${check.code}-${JSON.stringify(check.params ?? {})}`}

                className={`border-l-4 ${statusBorderClass(check.status)}`}
              >
                <CardBody className="flex flex-row items-center gap-4 p-5">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${check.status === 'ok' ? 'bg-success/10' : 'bg-danger/10'}`}>
                    {check.status === 'ok' ? (
                      <CheckCircle aria-hidden="true" size={24} className="text-success" />
                    ) : (
                      <XCircle aria-hidden="true" size={24} className="text-danger" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground">{getCheckName(check)}</p>
                    <p className="text-sm text-muted">
                      {getCheckStatusLabel(check.status)}
                    </p>
                    {(check.free || check.total) && (
                      <p className="text-xs text-muted mt-1">
                        {check.free && t('enterprise.free_value', { value: check.free })}
                        {check.free && check.total && t('enterprise.value_separator')}
                        {check.total && t('enterprise.total_value', { value: check.total })}
                      </p>
                    )}
                  </div>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={check.status === 'ok' ? 'success' : 'danger'}
                  >
                    {getCheckStatusCodeLabel(check.status)}
                  </Chip>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Health Check History */}
          <Card >
            <CardHeader className="flex items-center gap-2 px-6 pt-5 pb-0">
              <History aria-hidden="true" size={18} className="text-muted" />
              <h3 className="text-base font-semibold">{t('enterprise.history')}</h3>
              <Chip size="sm" variant="soft">
                {t('enterprise.last_n_checks', { count: history.length })}
              </Chip>
            </CardHeader>
            <Separator className="mt-3" />
            <CardBody className="px-0 pb-0">
              {historyLoading ? (
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
                  <Spinner size="sm" />
                </div>
              ) : history.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-muted">{t('enterprise.no_history_available')}</p>
                </div>
              ) : (
                <Table aria-label={t('enterprise.health_check_history')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('enterprise.col_status')}</TableColumn>
                    <TableColumn>{t('enterprise.col_latency')}</TableColumn>
                    <TableColumn>{t('enterprise.col_timestamp')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => {
                      const histColor = entry.status === 'healthy' ? 'success' : entry.status === 'degraded' ? 'warning' : 'danger';
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <Chip size="sm" variant="soft" color={histColor} className="capitalize">
                              {getOverallStatusLabel(entry.status)}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-muted">
                              {entry.latency_ms !== null ? t('enterprise.latency_ms', { value: entry.latency_ms }) : t('enterprise.empty_value')}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-muted">
                              {new Date(entry.created_at).toLocaleString(getFormattingLocale())}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

export default HealthCheck;
