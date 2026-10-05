import { Card, CardBody, CardHeader, Button, Chip, Spinner } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Users from 'lucide-react/icons/users';
import Activity from 'lucide-react/icons/activity';
import UserPlus from 'lucide-react/icons/user-plus';
import UserCheck from 'lucide-react/icons/user-check';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import StickyNote from 'lucide-react/icons/sticky-note';
import TrendingUp from 'lucide-react/icons/trending-up';
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Tag from 'lucide-react/icons/tag';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useTenant, useToast } from '@/contexts';
import api from '@/lib/api';
import { formatPercentValue } from '@/lib/helpers';
import { adminCrm } from '../../api/adminApi';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CRM Dashboard
 * Main dashboard for the Member CRM module.
 * Displays key member metrics, quick actions, and recent activity summary.
 */

interface CrmDashboardData {
  total_members: number;
  active_members: number;
  new_this_month: number;
  pending_approvals: number;
  open_tasks: number;
  overdue_tasks: number;
  total_notes: number;
  never_logged_in: number;
  retention_rate: number;
}

const QUICK_ACTIONS = [
  { labelKey: 'crm.qa_member_notes', path: '/admin/crm/notes', icon: StickyNote, color: 'text-accent bg-accent/10' },
  { labelKey: 'crm.qa_crm_tasks', path: '/admin/crm/tasks', icon: ClipboardList, color: 'text-warning bg-warning/10' },
  { labelKey: 'crm.qa_member_tags', path: '/admin/crm/tags', icon: Tag, color: 'text-accent bg-accent-soft' },
  { labelKey: 'crm.qa_activity_timeline', path: '/admin/crm/timeline', icon: Activity, color: 'text-danger bg-danger/10' },
  { labelKey: 'crm.qa_onboarding_funnel', path: '/admin/crm/funnel', icon: TrendingUp, color: 'text-success bg-success/10' },
  { labelKey: 'crm.qa_all_members', path: '/admin/users', icon: Users, color: 'text-muted bg-surface-tertiary' },
] as const;

export function CrmDashboard() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_crm');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [data, setData] = useState<CrmDashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminCrm.getDashboard();
      if (res.success && res.data) {
        setData(res.data as CrmDashboardData);
      }
    } catch {
      toast.error(t('crm.failed_to_load_c_r_m_dashboard_data'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  const handleExport = useCallback(async (type: 'dashboard' | 'notes' | 'tasks') => {
    try {
      await api.download(`/v2/admin/crm/export/${type}`, {
        filename: `crm-${type}-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(t('crm.export_failed'));
    }
  }, [t, toast]);


  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('crm.loading_dashboard')} /></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('crm.crm_dashboard_title')}
        description={t('crm.crm_dashboard_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              size="sm"
              startContent={<Download aria-hidden="true" size={14} />}
              onPress={() => handleExport('dashboard')}
            >
              {t('crm.export_stats')}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              startContent={<Download aria-hidden="true" size={14} />}
              onPress={() => handleExport('notes')}
            >
              {t('crm.export_notes')}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              startContent={<Download aria-hidden="true" size={14} />}
              onPress={() => handleExport('tasks')}
            >
              {t('crm.export_tasks')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw aria-hidden="true" size={16} />}
              onPress={loadDashboard}
              isLoading={loading}
            >
              {t('crm.refresh')}
            </Button>
          </div>
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label={t('crm.label_total_members')}
          value={data?.total_members ?? 0}
          icon={Users}
          loading={!data}
        />
        <StatCard
          label={t('crm.label_active_members')}
          value={data?.active_members ?? 0}
          icon={Activity}
          color="success"
          loading={!data}
        />
        <StatCard
          label={t('crm.label_new_this_month')}
          value={data?.new_this_month ?? 0}
          icon={UserPlus}
          color="default"
          loading={!data}
        />
        <StatCard
          label={t('crm.label_pending_approvals')}
          value={data?.pending_approvals ?? 0}
          icon={UserCheck}
          color="warning"
          loading={!data}
        />
        <StatCard
          label={t('crm.label_open_tasks')}
          value={data?.open_tasks ?? 0}
          icon={ClipboardList}
          loading={!data}
          to={tenantPath('/admin/crm/tasks')}
        />
        <StatCard
          label={t('crm.label_overdue_tasks')}
          value={data?.overdue_tasks ?? 0}
          icon={AlertTriangle}
          color={(data?.overdue_tasks ?? 0) > 0 ? 'danger' : 'default'}
          loading={!data}
          to={tenantPath('/admin/crm/tasks?status=overdue')}
        />
        <StatCard
          label={t('crm.label_member_notes')}
          value={data?.total_notes ?? 0}
          icon={StickyNote}
          color="default"
          loading={!data}
        />
        <StatCard
          label={t('crm.label_retention_rate')}
          value={formatPercentValue(data?.retention_rate ?? 0)}
          icon={TrendingUp}
          color="success"
          loading={!data}
        />
      </div>

      {/* Quick Actions + Activity Summary */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Quick Actions */}
        <Card >
          <CardHeader className="flex-col items-start px-4 pb-0 pt-4">
            <h3 className="text-lg font-semibold text-foreground">{t('crm.quick_actions_title')}</h3>
            <p className="text-sm text-muted">{t('crm.quick_actions_desc')}</p>
          </CardHeader>
          <CardBody className="gap-3 px-4 pb-4 pt-3">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.path}
                  as={Link}
                  to={tenantPath(action.path)}
                  variant="tertiary"
                  className="justify-between"
                  fullWidth
                  endContent={<ChevronRight aria-hidden="true" size={16} className="text-muted" />}
                >
                  <span className="flex items-center gap-3">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${action.color}`}>
                      <Icon aria-hidden="true" size={16} />
                    </span>
                    <span>{t(action.labelKey)}</span>
                  </span>
                </Button>
              );
            })}
          </CardBody>
        </Card>

        {/* Activity Summary */}
        <Card >
          <CardHeader className="flex-col items-start px-4 pb-0 pt-4">
            <h3 className="text-lg font-semibold text-foreground">{t('crm.activity_summary_title')}</h3>
            <p className="text-sm text-muted">{t('crm.activity_summary_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4 px-4 pb-4 pt-3">
            <div className="flex items-center justify-between rounded-lg bg-surface-secondary p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg text-success bg-success/10">
                  <Activity aria-hidden="true" size={20} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('crm.active_in_last_30')}</p>
                  <p className="text-xs text-muted">{t('crm.members_logged_in_recently')}</p>
                </div>
              </div>
              <Chip color="success" variant="soft" size="lg">
                {data?.active_members ?? 0}
              </Chip>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-surface-secondary p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg text-accent bg-accent-soft">
                  <UserPlus aria-hidden="true" size={20} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('crm.new_this_month_summary')}</p>
                  <p className="text-xs text-muted">{t('crm.signups_in_current_month')}</p>
                </div>
              </div>
              <Chip color="default" variant="soft" size="lg">
                {data?.new_this_month ?? 0}
              </Chip>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-surface-secondary p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg text-warning bg-warning/10">
                  <AlertTriangle aria-hidden="true" size={20} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('crm.never_logged_in')}</p>
                  <p className="text-xs text-muted">{t('crm.members_not_signed_in')}</p>
                </div>
              </div>
              <Chip color="warning" variant="soft" size="lg">
                {data?.never_logged_in ?? 0}
              </Chip>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-surface-secondary p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg text-accent bg-accent/10">
                  <TrendingUp aria-hidden="true" size={20} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{t('crm.retention_rate_summary')}</p>
                  <p className="text-xs text-muted">{t('crm.members_active_vs_total')}</p>
                </div>
              </div>
              <Chip
                color={(data?.retention_rate ?? 0) >= 50 ? 'success' : 'danger'}
                variant="tertiary"
                size="lg"
              >
                {formatPercentValue(data?.retention_rate ?? 0)}
              </Chip>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default CrmDashboard;
