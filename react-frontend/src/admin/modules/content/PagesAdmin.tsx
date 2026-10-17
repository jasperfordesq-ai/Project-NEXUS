// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pages Admin
 * Manage CMS pages for the platform.
 * Wired to adminPages API for full CRUD.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback } from 'react';
import FileText from 'lucide-react/icons/file-text';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminPages } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { HeaderColumnTitleCard } from './HeaderColumnTitleCard';

import { useTranslation } from 'react-i18next';
import { Button, Chip, Spinner } from '@/components/ui';
interface PageItem {
  id: number;
  title: string;
  slug: string;
  status: string;
  sort_order: number;
  show_in_menu: number;
  menu_location: string;
  created_at: string;
}

const MENU_LOCATION_LABEL_KEYS: Record<string, string> = {
  about: 'content.location_about',
  header: 'content.location_header',
  footer: 'content.footer',
};

export function PagesAdmin() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.page_title'));
  const { tenantPath, refreshTenant } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<PageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<PageItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminPages.list();
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (Array.isArray(result)) {
          setData(result);
        } else if (result && typeof result === 'object') {
          const pd = result as { data?: PageItem[] };
          setData(pd.data || []);
        }
      }
    } catch {
      toast.error(t('content.failed_to_load_pages'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])


  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await adminPages.delete(confirmDelete.id);
      if (res?.success) {
        toast.success(t('content.page_deleted_successfully'));
        fetchData();
        void refreshTenant({ silent: true });
      } else {
        toast.error(t('content.failed_to_delete_page'));
      }
    } catch {
      toast.error(t('content.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  const columns: Column<PageItem>[] = [
    {
      key: 'title',
      label: t('content.label_name'),
      sortable: true,
      render: (item) => (
        <Button
          type="button"
          variant="tertiary"
          onPress={() => navigate(tenantPath(`/admin/pages/builder/${item.id}`))}
          className="text-left font-medium text-accent hover:underline min-w-0 min-h-10 p-0 justify-start"
        >
          {item.title}
        </Button>
      ),
    },
    {
      key: 'slug',
      label: t('content.label_slug'),
      sortable: true,
      render: (item) => <span className="text-sm text-muted">/{item.slug}</span>,
    },
    {
      key: 'status',
      label: t('content.label_status'),
      sortable: true,
      render: (item) => <StatusBadge status={item.status || 'draft'} />,
    },
    {
      key: 'show_in_menu',
      label: t('content.in_menu'),
      sortable: true,
      render: (item) => item.show_in_menu ? (
        <Chip size="sm" variant="soft">
          {t(MENU_LOCATION_LABEL_KEYS[item.menu_location] ?? 'content.location_about')}
        </Chip>
      ) : (
        <span className="text-sm text-muted">{t('content.label_no')}</span>
      ),
    },
    {
      key: 'created_at',
      label: t('content.label_created'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('content.label_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => navigate(tenantPath(`/admin/pages/builder/${item.id}`))}
            aria-label={t('content.label_edit_page')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setConfirmDelete(item)}
            aria-label={t('content.label_delete_page')}
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
        <PageHeader title={t('content.pages_admin_title')} description={t('content.pages_admin_desc')} />
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={t('shared.loading')}>
            <Spinner size="lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('content.pages_admin_title')}
        description={t('content.pages_admin_desc')}
        actions={
          <Button
            startContent={<Plus size={16} />}
            onPress={() => navigate(tenantPath('/admin/pages/builder/new'))}
          >
            {t('content.create_page')}
          </Button>
        }
      />

      <HeaderColumnTitleCard />

      {data.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t('content.no_data_available')}
          description={t('content.pages_admin_desc')}
          actionLabel={t('content.create_page')}
          onAction={() => navigate(tenantPath('/admin/pages/builder/new'))}
        />
      ) : (
        <DataTable
          columns={columns}
          data={data}
          searchPlaceholder={t('data_table.search')}
          onRefresh={fetchData}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={t('content.delete_page_title')}
          message={t('content.delete_page_confirm')}
          confirmLabel={t('content.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}

export default PagesAdmin;
