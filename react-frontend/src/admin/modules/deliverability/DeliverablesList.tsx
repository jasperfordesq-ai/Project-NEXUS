import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Button, Spinner } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Deliverables List
 * View all project deliverables with status and progress tracking.
 * Wired to adminDeliverability.list() API.
 */

import { useState, useEffect, useCallback } from 'react';

import Target from 'lucide-react/icons/target';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Pencil from 'lucide-react/icons/pencil';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useNavigate } from 'react-router-dom';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useTenant, useToast } from '@/contexts';
import { adminDeliverability } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';

interface DeliverableItem {
  id: number;
  title: string;
  description: string;
  priority: string;
  status: string;
  assigned_to: string;
  due_date: string;
  created_at: string;
}

export function DeliverablesList() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_deliverability');
  useAdminPageMeta({ title: tNav('deliverability') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<DeliverableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeliverableItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await adminDeliverability.list({ page });
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (Array.isArray(result)) {
          // The shared api client unwraps the `{ data, meta }` envelope: `res.data`
          // is the bare row array and the true total arrives on the sibling
          // `res.meta`. This used to request no page and ignore `meta`, so every
          // deliverable past the first 20 was hidden with no page control.
          const metaTotal = (res.meta as { total?: unknown } | undefined)?.total;
          setData(result);
          setTotal(typeof metaTotal === 'number' ? metaTotal : result.length);
        } else if (result && typeof result === 'object') {
          const pd = result as { data?: DeliverableItem[] };
          setData(pd.data || []);
          setTotal(pd.data?.length ?? 0);
        }
      } else {
        setLoadError(t('deliverability.failed_to_load_deliverables'));
      }
    } catch {
      setLoadError(t('deliverability.failed_to_load_deliverables'));
      toast.error(t('deliverability.failed_to_load_deliverables'));
    } finally {
      setLoading(false);
    }
  }, [page, t, toast]);


  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await adminDeliverability.delete(confirmDelete.id);
      if (res?.success) {
        toast.success(t('deliverability.deliverable_deleted_successfully'));
        fetchData();
      } else {
        toast.error(t('deliverability.failed_to_delete_deliverable'));
      }
    } catch {
      toast.error(t('deliverability.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  const columns: Column<DeliverableItem>[] = [
    {
      key: 'title',
      label: t('deliverability.col_title'),
      sortable: true,
      render: (item) => <span className="font-medium">{item.title}</span>,
    },
    {
      key: 'priority',
      label: t('deliverability.col_priority'),
      sortable: true,
      render: (item) => (
        <StatusBadge status={item.priority || 'medium'} />
      ),
    },
    {
      key: 'status',
      label: t('deliverability.col_status'),
      sortable: true,
      render: (item) => <StatusBadge status={item.status || 'planned'} />,
    },
    {
      key: 'assigned_to',
      label: t('deliverability.col_assigned_to'),
      render: (item) => <span className="text-sm text-muted">{item.assigned_to || '--'}</span>,
    },
    {
      key: 'due_date',
      label: t('deliverability.col_due_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.due_date ? new Date(item.due_date).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('deliverability.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => navigate(tenantPath(`/admin/deliverability/edit/${item.id}`))}
            aria-label={t('deliverability.label_edit_deliverable')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setConfirmDelete(item)}
            aria-label={t('deliverability.label_delete_deliverable')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div>
        <PageHeader title={t('deliverability.deliverables_list_title')} description={t('deliverability.deliverables_list_desc')} />
        <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('deliverability.deliverables_list_title')}
        description={t('deliverability.deliverables_list_desc')}
        actions={
          <Button
            startContent={<Plus size={16} />}
            onPress={() => navigate(tenantPath('/admin/deliverability/create'))}
          >
            {t('deliverability.create_deliverable')}
          </Button>
        }
      />

      {loadError ? (
        <Card >
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center" role="alert">
            <AlertTriangle size={32} className="text-danger" aria-hidden="true" />
            <div className="text-base font-semibold">{t('common.error_loading_data')}</div>
            <div className="text-sm text-muted">{loadError}</div>
            <Button variant="tertiary" onPress={fetchData}>{t('common.retry')}</Button>
          </CardBody>
        </Card>
      ) : data.length === 0 ? (
        <EmptyState
          icon={Target}
          title={t('deliverability.no_deliverables')}
          description={t('deliverability.desc_create_deliverables_to_track_project_mil')}
          actionLabel={t('deliverability.create_deliverable')}
          onAction={() => navigate(tenantPath('/admin/deliverability/create'))}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder={t('deliverability.search_deliverables')}
          onRefresh={fetchData}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={t('deliverability.delete_deliverable_title')}
          message={t('deliverability.delete_deliverable_message')}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}

export default DeliverablesList;
