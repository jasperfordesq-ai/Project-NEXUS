import { formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Button, Chip, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Enterprise Dashboard
 * Overview with stats cards (users, roles, GDPR requests, health) and quick links.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

import Users from 'lucide-react/icons/users';
import Shield from 'lucide-react/icons/shield';
import FileWarning from 'lucide-react/icons/file-warning';
import HeartPulse from 'lucide-react/icons/heart-pulse';
import ArrowRight from 'lucide-react/icons/arrow-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Database from 'lucide-react/icons/database';
import Cpu from 'lucide-react/icons/cpu';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import type { EnterpriseDashboardStats } from '../../api/types';
import { translationToken } from './gdprAuditTranslations';

export function EnterpriseDashboard() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.enterprise_dashboard_title'));
  const { tenantPath } = useTenant();

  const [stats, setStats] = useState<EnterpriseDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getDashboard();
      if (res.success && res.data) {
        setStats(res.data as unknown as EnterpriseDashboardStats);
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const healthColor = stats?.health_status === 'healthy' ? 'success' : stats?.health_status === 'degraded' ? 'warning' : 'danger';
  const healthStatusLabel = stats
    ? t(`enterprise.status_${stats.health_status}`, { defaultValue: t('enterprise.status_unknown') })
    : '---';

  const quickLinks = [
    { label: t('enterprise.link_roles_permissions'), href: tenantPath('/admin/enterprise/roles'), icon: Shield },
    { label: t('enterprise.link_gdpr_dashboard'), href: tenantPath('/admin/enterprise/gdpr'), icon: FileWarning },
    { label: t('enterprise.link_system_monitoring'), href: tenantPath('/admin/enterprise/monitoring'), icon: HeartPulse },
    { label: t('enterprise.link_legal_documents'), href: tenantPath('/admin/legal-documents'), icon: FileWarning },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.enterprise_dashboard_title')}
        description={t('enterprise.enterprise_dashboard_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" size={16} />}
            onPress={loadData}
            isLoading={loading}
            size="sm"
          >
            {t('enterprise.refresh')}
          </Button>
        }
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('enterprise.label_total_users')}
          value={stats?.user_count ?? '---'}
          icon={Users}
          loading={loading}
        />
        <StatCard
          label={t('enterprise.label_roles')}
          value={stats?.role_count ?? '---'}
          icon={Shield}
          loading={loading}
        />
        <StatCard
          label={t('enterprise.label_pending_g_d_p_r')}
          value={stats?.pending_gdpr_requests ?? 0}
          icon={FileWarning}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('enterprise.label_system_health')}
          value={healthStatusLabel}
          icon={HeartPulse}
          color={healthColor}
          loading={loading}
        />
      </div>

      {/* System Health */}
      {stats && (
        <Card  className="mb-6">
          <CardBody className="p-4">
            <p className="text-sm font-semibold text-foreground mb-3">{t('enterprise.label_system_health')}</p>
            <div className="flex flex-wrap gap-3">
              <Chip color={stats.db_connected ? 'success' : 'danger'} variant="soft" size="sm" startContent={<Database aria-hidden="true" size={12} />}>
                {t('enterprise.database')} {stats.db_connected ? t('enterprise.connected') : t('enterprise.disconnected')}
              </Chip>
              <Chip color={stats.redis_connected ? 'success' : 'danger'} variant="soft" size="sm" startContent={<Cpu aria-hidden="true" size={12} />}>
                {t('enterprise.redis')} {stats.redis_connected ? t('enterprise.connected') : t('enterprise.disconnected')}
              </Chip>
              <Chip color={stats.memory_percent > 90 ? 'danger' : stats.memory_percent > 70 ? 'warning' : 'success'} variant="tertiary" size="sm">
                {t('enterprise.memory')} {formatPercentValue(stats.memory_percent)}
              </Chip>
              <Chip color={stats.disk_percent > 90 ? 'danger' : stats.disk_percent > 70 ? 'warning' : 'success'} variant="tertiary" size="sm">
                {t('enterprise.disk')} {formatPercentValue(stats.disk_percent)}
              </Chip>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Quick Links */}
      <Card >
        <CardBody className="p-4">
          <h3 className="text-lg font-semibold text-foreground mb-4">{t('enterprise.quick_links')}</h3>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {quickLinks.map((link) => (
                <Button
                  key={link.href}
                  as={Link}
                  to={link.href}
                  variant="secondary"
                  className="min-h-11 justify-between px-4 py-3"
                  endContent={<ArrowRight aria-hidden="true" size={16} />}
                  startContent={<link.icon aria-hidden="true" size={18} />}
                >
                  {link.label}
                </Button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Recent GDPR Activity */}
      {stats?.recent_gdpr_activity && stats.recent_gdpr_activity.length > 0 && (
        <Card  className="mt-6">
          <CardBody className="p-4">
            <p className="text-sm font-semibold text-foreground mb-3">{t('enterprise.recent_gdpr_activity')}</p>
            <div className="space-y-2">
              {stats.recent_gdpr_activity.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between text-sm border-b border-divider pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="soft">
                      {t(`enterprise.gdpr_audit_action_${translationToken(entry.action)}`, { defaultValue: t('enterprise.gdpr_audit_action_unknown') })}
                    </Chip>
                    <span className="text-muted">
                      {t(`enterprise.gdpr_entity_type_${translationToken(entry.entity_type)}`, { defaultValue: t('enterprise.gdpr_entity_type_unknown') })}
                    </span>
                    {entry.user_name && (
                      <span className="text-muted">
                        {t('enterprise.activity_by_user', { name: entry.user_name })}
                      </span>
                    )}
                  </div>
                  <span className="text-muted text-xs">{new Date(entry.created_at).toLocaleString(getFormattingLocale())}</span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export default EnterpriseDashboard;
