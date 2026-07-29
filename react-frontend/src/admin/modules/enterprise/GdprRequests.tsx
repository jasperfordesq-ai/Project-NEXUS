import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Requests
 * DataTable of GDPR requests with status filter, SLA badges, and row navigation.
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';import RefreshCw from 'lucide-react/icons/refresh-cw';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Plus from 'lucide-react/icons/plus';
import { useTenant,
  useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, StatusBadge } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import type { GdprRequest } from '../../api/types';

import { useTranslation } from 'react-i18next';
const STATUS_OPTION_KEYS = ['all', 'pending', 'processing', 'completed', 'rejected'] as const;

function SlaChip({ createdAt, t }: { createdAt: string; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const created = new Date(createdAt);
  const deadline = new Date(created.getTime() + 30 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    const days = Math.abs(daysRemaining);
    return (
      <Chip size="sm" variant="soft" color="danger">
        {t('enterprise.gdpr_sla_overdue', { count: days })}
      </Chip>
    );
  }
  if (daysRemaining <= 7) {
    return (
      <Chip size="sm" variant="soft" color="warning">
        {t('enterprise.gdpr_sla_days_left', { count: daysRemaining })}
      </Chip>
    );
  }
  return (
    <Chip size="sm" variant="soft" color="success">
      {t('enterprise.gdpr_sla_days_left', { count: daysRemaining })}
    </Chip>
  );
}

export function GdprRequests() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_requests_title') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [requests, setRequests] = useState<GdprRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getGdprRequests({
        page,
        status: statusFilter !== 'all' ? statusFilter : undefined,
      });
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (Array.isArray(result)) {
          setRequests(result);
          setTotal(result.length);
        } else if (result && typeof result === 'object') {
          const pd = result as { data?: GdprRequest[]; meta?: { total?: number } };
          setRequests(pd.data || []);
          setTotal(pd.meta?.total ?? pd.data?.length ?? 0);
        }
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_g_d_p_r_requests'));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleStatusUpdate = async (id: number, newStatus: string) => {
    try {
      const res = await adminEnterprise.updateGdprRequest(id, { status: newStatus });

      if (res.success) {
        toast.success(t('enterprise.gdpr_request_status_updated'));
        loadData();
      } else {
        const error = t('enterprise.gdpr_failed_update_request_status');
        toast.error(error);
      }
    } catch (err) {
      toast.error(t('enterprise.gdpr_failed_update_request_status'));
      console.error('GDPR request update error:', err);
    }
  };

  const columns: Column<GdprRequest>[] = [
    { key: 'id', label: t('enterprise.gdpr_id'), sortable: true },
    { key: 'user_name', label: t('enterprise.gdpr_user'), sortable: true },
    {
      key: 'type',
      label: t('enterprise.gdpr_type'),
      sortable: true,
      render: (r) => (
        <span data-testid="request-type" data-type={r.type}>
          {t(`enterprise.gdpr_type_${r.type}`, { defaultValue: t('enterprise.gdpr_type_unknown') })}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('enterprise.gdpr_status'),
      sortable: true,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'sla',
      label: t('enterprise.gdpr_sla'),
      render: (r) => <SlaChip createdAt={r.created_at} t={(key, opts) => t(key, opts)} />,
    },
    {
      key: 'created_at',
      label: t('enterprise.gdpr_created_at'),
      sortable: true,
      render: (r) => new Date(r.created_at).toLocaleDateString(getFormattingLocale()),
    },
    {
      key: 'actions',
      label: t('enterprise.gdpr_actions'),
      render: (r) => (
        <Dropdown>
          <DropdownTrigger>
            <Button isIconOnly size="sm" variant="tertiary" aria-label={t('enterprise.gdpr_actions')}>
              <MoreVertical size={14} />
            </Button>
          </DropdownTrigger>
          <DropdownMenu aria-label={t('enterprise.gdpr_request_actions')}>
            <DropdownItem key="view" id="view" onPress={() => navigate(tenantPath(`/admin/enterprise/gdpr/requests/${r.id}`))}>
              {t('enterprise.gdpr_view_details')}
            </DropdownItem>
            <DropdownItem key="processing" id="processing" onPress={() => handleStatusUpdate(r.id, 'processing')}>
              {t('enterprise.gdpr_mark_processing')}
            </DropdownItem>
            <DropdownItem key="completed" id="completed" onPress={() => handleStatusUpdate(r.id, 'completed')}>
              {t('enterprise.gdpr_mark_completed')}
            </DropdownItem>
            <DropdownItem key="rejected" id="rejected" className="text-danger" variant="danger" onPress={() => handleStatusUpdate(r.id, 'rejected')}>
              {t('enterprise.gdpr_reject')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_requests_title')}
        description={t('enterprise.gdpr_requests_desc')}
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
            <Button
              startContent={<Plus aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/requests/create'))}
              size="sm"
            >
              {t('enterprise.gdpr_create_request')}
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <Select
          label={t('enterprise.gdpr_filter_by_status')}
          selectedKeys={new Set([statusFilter])}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0] as string;
            setStatusFilter(selected || 'all');
            setPage(1);
          }}
          className="max-w-xs"
          size="sm"
          variant="secondary"
        >
          {STATUS_OPTION_KEYS.map((key) => (
            <SelectItem key={key} id={key}>{t(`enterprise.status_${key}`)}</SelectItem>
          ))}
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={requests}
        isLoading={loading}
        totalItems={total}
        page={page}
        onPageChange={setPage}
        searchable={false}
        emptyContent={t('enterprise.no_gdpr_requests')}
      />
    </div>
  );
}

export default GdprRequests;
