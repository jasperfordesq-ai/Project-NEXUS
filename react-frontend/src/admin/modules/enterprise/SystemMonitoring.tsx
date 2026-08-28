import { CardBody, Card, Progress, Button, Chip, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * System Monitoring
 * System health dashboard with metric cards and progress bars.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import Server from 'lucide-react/icons/server';
import Database from 'lucide-react/icons/database';
import HardDrive from 'lucide-react/icons/hard-drive';
import Clock from 'lucide-react/icons/clock';
import Cpu from 'lucide-react/icons/cpu';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ArrowRight from 'lucide-react/icons/arrow-right';
import FileText from 'lucide-react/icons/file-text';
import Settings from 'lucide-react/icons/settings';
import ToggleLeft from 'lucide-react/icons/toggle-left';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { SystemHealth } from '../../api/types';
import { logError } from '@/lib/logger';

/**
 * Parse a memory string like "24 MB" or "256M" to bytes.
 */
function parseMemory(str: string | undefined | null): number | null {
  if (!str) return null;
  const match = str.match(/^([\d.]+)\s*(B|KB|K|MB|M|GB|G|TB|T)?$/i);
  if (!match?.[1]) return null;
  const val = parseFloat(match[1]);
  const unit = (match[2] ?? 'B').toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    K: 1024,
    KB: 1024,
    M: 1024 ** 2,
    MB: 1024 ** 2,
    G: 1024 ** 3,
    GB: 1024 ** 3,
    T: 1024 ** 4,
    TB: 1024 ** 4,
  };
  return val * (multipliers[unit] || 1);
}

function memoryProgressColor(pct: number): 'success' | 'warning' | 'danger' {
  if (pct >= 90) return 'danger';
  if (pct >= 70) return 'warning';
  return 'success';
}

export function SystemMonitoring() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));
  const { tenantPath } = useTenant();

  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getMonitoring();
      if (res.success && res.data) {
        setHealth(res.data as unknown as SystemHealth);
      }
    } catch (err) {
      logError('Failed to load monitoring data', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute memory percentage
  const memUsageBytes = parseMemory(health?.memory_usage);
  const memLimitBytes = parseMemory(health?.memory_limit);
  const memoryPct = memUsageBytes && memLimitBytes && memLimitBytes > 0
    ? Math.round((memUsageBytes / memLimitBytes) * 100)
    : null;

  const metrics = health
    ? [
        { label: t('enterprise.metric_php_version'), value: health.php_version, icon: Cpu, color: 'primary' },
        { label: t('enterprise.metric_database_size'), value: health.db_size, icon: Database, color: 'success' },
        { label: t('enterprise.metric_redis_memory'), value: health.redis_memory, icon: HardDrive, color: 'secondary' },
        { label: t('enterprise.metric_db_uptime'), value: health.uptime, icon: Clock, color: 'primary' },
        { label: t('enterprise.metric_server_time'), value: health.server_time, icon: Clock, color: 'default' },
        { label: t('enterprise.metric_operating_system'), value: health.os, icon: Cpu, color: 'default' },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title={t('enterprise.system_monitoring_title')}
        description={t('enterprise.system_monitoring_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              as={Link}
              to={tenantPath('/admin/enterprise/monitoring/health')}
              variant="tertiary"
              size="sm"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('enterprise.health_check')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/admin/enterprise/monitoring/logs')}
              variant="tertiary"
              size="sm"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('enterprise.error_logs')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/admin/enterprise/monitoring/log-files')}
              variant="tertiary"
              size="sm"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('enterprise.log_files')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/admin/enterprise/monitoring/requirements')}
              variant="tertiary"
              size="sm"
              endContent={<ArrowRight aria-hidden="true" size={14} />}
            >
              {t('enterprise.requirements')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/admin/module-configuration')}
              variant="tertiary"
              size="sm"
              endContent={<ToggleLeft aria-hidden="true" size={14} />}
            >
              {t('enterprise.module_configuration')}
            </Button>
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

      {/* Connection Status */}
      <div className="flex gap-3 mb-6">
        <Chip
          size="sm"
          variant="soft"
          color={health?.db_connected ? 'success' : 'danger'}
        >
          {t('enterprise.database')}: {health?.db_connected ? t('enterprise.connected') : t('enterprise.disconnected')}
        </Chip>
        <Chip
          size="sm"
          variant="soft"
          color={health?.redis_connected ? 'success' : 'danger'}
        >
          {t('enterprise.redis')}: {health?.redis_connected ? t('enterprise.connected') : t('enterprise.disconnected')}
        </Chip>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Memory Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* PHP Process Memory */}
            {memoryPct !== null && (
              <Card >
                <CardBody className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Server aria-hidden="true" size={18} className="text-warning" />
                      <span className="text-sm font-semibold text-foreground">
                        {t('enterprise.php_process_memory')}
                      </span>
                    </div>
                    <span className="text-sm text-muted">
                      {health?.memory_usage} / {health?.memory_limit}
                    </span>
                  </div>
                  <Progress
                    size="md"
                    value={memoryPct}
                    color={memoryProgressColor(memoryPct)}
                    showValueLabel
                    aria-label={t('enterprise.php_memory_usage')}
                    className="max-w-full"
                  />
                </CardBody>
              </Card>
            )}

            {/* System / VM Memory */}
            {health?.sys_memory && (
              <Card >
                <CardBody className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Cpu aria-hidden="true" size={18} className="text-accent" />
                      <span className="text-sm font-semibold text-foreground">
                        {t('enterprise.vm_memory')}
                      </span>
                    </div>
                    <span className="text-sm text-muted">
                      {health.sys_memory.used} / {health.sys_memory.total}
                    </span>
                  </div>
                  <Progress
                    size="md"
                    value={health.sys_memory.used_pct}
                    color={memoryProgressColor(health.sys_memory.used_pct)}
                    showValueLabel
                    aria-label={t('enterprise.vm_memory_usage')}
                    className="max-w-full"
                  />
                  <p className="text-xs text-muted mt-1">
                    {t('enterprise.memory_available', { value: health.sys_memory.available })}
                  </p>
                </CardBody>
              </Card>
            )}
          </div>

          {/* Server Stats Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((metric) => (
              <Card key={metric.label} >
                <CardBody className="flex flex-row items-center gap-3 p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                    <metric.icon aria-hidden="true" size={20} className="text-muted" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted">{metric.label}</p>
                    <p className="text-sm font-semibold text-foreground truncate">{metric.value || t('enterprise.empty_value')}</p>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card  isPressable as={Link} to={tenantPath('/admin/enterprise/monitoring/log-files')}>
              <CardBody className="flex flex-row items-center gap-3 p-4">
                <FileText aria-hidden="true" size={20} className="text-accent" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('enterprise.log_files')}</p>
                  <p className="text-xs text-muted">{t('enterprise.log_files_desc')}</p>
                </div>
              </CardBody>
            </Card>
            <Card  isPressable as={Link} to={tenantPath('/admin/enterprise/monitoring/requirements')}>
              <CardBody className="flex flex-row items-center gap-3 p-4">
                <Settings aria-hidden="true" size={20} className="text-warning" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('enterprise.system_requirements')}</p>
                  <p className="text-xs text-muted">{t('enterprise.system_requirements_desc')}</p>
                </div>
              </CardBody>
            </Card>
            <Card  isPressable as={Link} to={tenantPath('/admin/module-configuration')}>
              <CardBody className="flex flex-row items-center gap-3 p-4">
                <ToggleLeft aria-hidden="true" size={20} className="text-success" />
                <div>
                  <p className="text-sm font-semibold text-foreground">{t('enterprise.module_configuration')}</p>
                  <p className="text-xs text-muted">{t('enterprise.module_configuration_desc')}</p>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemMonitoring;
