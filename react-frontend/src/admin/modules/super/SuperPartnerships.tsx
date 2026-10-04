import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Tabs, Tab, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';

import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import MessageSquare from 'lucide-react/icons/message-square';
import DollarSign from 'lucide-react/icons/dollar-sign';
import FileText from 'lucide-react/icons/file-text';
import Calendar from 'lucide-react/icons/calendar';
import UsersRound from 'lucide-react/icons/users-round';
import Pause from 'lucide-react/icons/pause';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ConfirmModal from '../../components/ConfirmModal';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useToast } from '@/contexts/ToastContext';
import { adminSuper } from '../../api/adminApi';
import type { FederationPartnership } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


interface Partnership {
  id: number;
  tenant_a_id: number;
  tenant_a_name: string;
  tenant_b_id: number;
  tenant_b_name: string;
  level: number;
  status: 'active' | 'pending' | 'suspended' | 'terminated';
  features: {
    profiles: boolean;
    messaging: boolean;
    transactions: boolean;
    listings: boolean;
    events: boolean;
    groups: boolean;
  };
  created_at: string;
}

interface Stats {
  active: number;
  pending: number;
  suspended: number;
  terminated: number;
}

type PartnershipStatus = 'all' | 'active' | 'pending' | 'suspended' | 'terminated';

function mapApiPartnership(p: FederationPartnership): Partnership {
  return {
    id: p.id,
    tenant_a_id: p.tenant_1_id,
    tenant_a_name: p.tenant_1_name,
    tenant_b_id: p.tenant_2_id,
    tenant_b_name: p.tenant_2_name,
    level: 1,
    status: p.status,
    features: { profiles: false, messaging: false, transactions: false, listings: false, events: false, groups: false },
    created_at: p.created_at,
  };
}

function computeStats(partnerships: Partnership[]): Stats {
  return partnerships.reduce(
    (acc, p) => {
      if (p.status in acc) acc[p.status as keyof Stats]++;
      return acc;
    },
    { active: 0, pending: 0, suspended: 0, terminated: 0 },
  );
}

function statusLabelKey(status: PartnershipStatus | Partnership['status']): string {
  switch (status) {
    case 'all': return 'super.tab_all';
    case 'active': return 'super.status_active';
    case 'pending': return 'super.status_pending';
    case 'suspended': return 'super.status_suspended';
    case 'terminated': return 'super.status_terminated';
    default: return 'super.unknown_error';
  }
}

function featureLabelKey(feature: string): string {
  switch (feature) {
    case 'profiles': return 'super.feature_profiles';
    case 'messaging': return 'super.feature_messaging';
    case 'transactions': return 'super.feature_transactions';
    case 'listings': return 'super.feature_listings';
    case 'events': return 'super.feature_events';
    case 'groups': return 'super.feature_groups';
    default: return 'super.unknown_error';
  }
}

const getLevelColor = (level: number) => {
  switch (level) {
    case 1: return 'primary';
    case 2: return 'success';
    case 3: return 'secondary';
    case 4: return 'warning';
    default: return 'default';
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case 'active': return 'success';
    case 'pending': return 'warning';
    case 'suspended': return 'danger';
    case 'terminated': return 'default';
    default: return 'default';
  }
};

const getFeatureIcon = (feature: string) => {
  switch (feature) {
    case 'profiles': return <Users className="w-4 h-4 text-accent" />;
    case 'messaging': return <MessageSquare className="w-4 h-4 text-success" />;
    case 'transactions': return <DollarSign className="w-4 h-4 text-accent" />;
    case 'listings': return <FileText className="w-4 h-4 text-warning" />;
    case 'events': return <Calendar className="w-4 h-4 text-pink-500" />;
    case 'groups': return <UsersRound className="w-4 h-4 text-cyan-500" />;
    default: return null;
  }
};

export default function Partnerships() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const toast = useToast();
  const [partnerships, setPartnerships] = useState<Partnership[]>([]);
  const [stats, setStats] = useState<Stats>({ active: 0, pending: 0, suspended: 0, terminated: 0 });
  const [filter, setFilter] = useState<PartnershipStatus>('all');
  const [loading, setLoading] = useState(true);
  const [actionPartnership, setActionPartnership] = useState<{ id: number; action: 'suspend' | 'terminate' } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await adminSuper.getFederationPartnerships();
    if (res.success && res.data) {
      const mapped = (Array.isArray(res.data) ? res.data : []).map(mapApiPartnership);
      setPartnerships(mapped);
      setStats(computeStats(mapped));
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSuspend = async (id: number) => {
    const res = await adminSuper.suspendPartnership(id, t('super.suspended_by_super_admin'));
    if (res.success) {
      setPartnerships(prev => {
        const updated = prev.map(p => p.id === id ? { ...p, status: 'suspended' as const } : p);
        setStats(computeStats(updated));
        return updated;
      });
      setActionPartnership(null);
      toast.success(t('super.partnership_suspended'));
    } else {
      toast.error(t('super.failed_to_suspend_partnership'));
    }
  };

  const handleTerminate = async (id: number) => {
    const res = await adminSuper.terminatePartnership(id, t('super.terminated_by_super_admin'));
    if (res.success) {
      setPartnerships(prev => {
        const updated = prev.map(p => p.id === id ? { ...p, status: 'terminated' as const } : p);
        setStats(computeStats(updated));
        return updated;
      });
      setActionPartnership(null);
      toast.success(t('super.partnership_terminated'));
    } else {
      toast.error(t('super.failed_to_terminate_partnership'));
    }
  };

  const filteredPartnerships = filter === 'all'
    ? partnerships
    : partnerships.filter(p => p.status === filter);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('super.super_partnerships_title')}
        description={t('super.super_partnerships_desc')}
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('super.status_active')}</p>
                <p className="text-2xl font-bold text-success">{stats.active}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <TrendingUp className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('super.status_pending')}</p>
                <p className="text-2xl font-bold text-warning">{stats.pending}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-danger/10">
                <Pause className="w-5 h-5 text-danger" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('super.status_suspended')}</p>
                <p className="text-2xl font-bold text-danger">{stats.suspended}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-surface-secondary">
                <XCircle className="w-5 h-5 text-muted" />
              </div>
              <div>
                <p className="text-xs text-muted">{t('super.status_terminated')}</p>
                <p className="text-2xl font-bold">{stats.terminated}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Partnerships Table */}
      <Card>
        <CardHeader>
          <Tabs
            aria-label={t('super.partnerships_tabs_aria')}
            selectedKey={filter}
            onSelectionChange={(key) => setFilter(key as PartnershipStatus)}
          >
            <Tab key="all" title={t('super.tab_with_count', { label: t(statusLabelKey('all')), count: partnerships.length })} />
            <Tab key="active" title={t('super.tab_with_count', { label: t(statusLabelKey('active')), count: stats.active })} />
            <Tab key="pending" title={t('super.tab_with_count', { label: t(statusLabelKey('pending')), count: stats.pending })} />
            <Tab key="suspended" title={t('super.tab_with_count', { label: t(statusLabelKey('suspended')), count: stats.suspended })} />
            <Tab key="terminated" title={t('super.tab_with_count', { label: t(statusLabelKey('terminated')), count: stats.terminated })} />
          </Tabs>
        </CardHeader>
        <CardBody>
          <Table aria-label={t('super.label_federation_partnerships')}  isStriped>
            <TableHeader>
              <TableColumn>{t('super.col_partnership')}</TableColumn>
              <TableColumn>{t('super.col_level')}</TableColumn>
              <TableColumn>{t('super.col_features')}</TableColumn>
              <TableColumn>{t('super.col_status')}</TableColumn>
              <TableColumn>{t('super.col_created')}</TableColumn>
              <TableColumn>{t('super.col_actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('super.no_partnerships_found')}>
              {filteredPartnerships.map(partnership => (
                <TableRow key={partnership.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{partnership.tenant_a_name}</span>
                      <span className="text-muted">↔</span>
                      <span className="font-medium">{partnership.tenant_b_name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={getLevelColor(partnership.level)} variant="soft">
                      {t('super.level_value', { level: partnership.level })}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {Object.entries(partnership.features).map(([key, enabled]) =>
                        enabled ? (
                          <span key={key} title={t(featureLabelKey(key))}>
                            {getFeatureIcon(key)}
                          </span>
                        ) : null
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={getStatusColor(partnership.status)} variant="soft">
                      {t(statusLabelKey(partnership.status))}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-sm text-muted">
                    {new Date(partnership.created_at).toLocaleDateString(getFormattingLocale())}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {partnership.status === 'active' && (
                        <Button
                          size="sm"
                          variant="tertiary"
                          color="warning"
                          onPress={() => setActionPartnership({ id: partnership.id, action: 'suspend' })}
                          startContent={<Pause className="w-4 h-4" />}
                        >
                          {t('super.suspend')}
                        </Button>
                      )}
                      {(partnership.status === 'active' || partnership.status === 'suspended') && (
                        <Button
                          size="sm"
                          variant="danger"
                          onPress={() => setActionPartnership({ id: partnership.id, action: 'terminate' })}
                          startContent={<XCircle className="w-4 h-4" />}
                        >
                          {t('super.terminate')}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      {/* Action Confirmation Modal */}
      {actionPartnership && (
        <ConfirmModal
          isOpen={true}
          onClose={() => setActionPartnership(null)}
          onConfirm={() => {
            if (actionPartnership.action === 'suspend') {
              handleSuspend(actionPartnership.id);
            } else {
              handleTerminate(actionPartnership.id);
            }
          }}
          title={actionPartnership.action === 'suspend' ? t('super.suspend_partnership') : t('super.terminate_partnership')}
          message={
            actionPartnership.action === 'suspend'
              ? t('super.suspend_partnership_confirm')
              : t('super.terminate_partnership_confirm')
          }
          confirmLabel={actionPartnership.action === 'suspend' ? t('super.suspend_btn') : t('super.terminate_btn')}
          confirmColor="danger"
        />
      )}
    </div>
  );
}
