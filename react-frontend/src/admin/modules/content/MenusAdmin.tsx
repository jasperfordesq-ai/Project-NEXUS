// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Menus Admin
 * Manage navigation menus for the platform.
 * Wired to adminMenus API for full CRUD.
 */

import { useState, useEffect, useCallback } from 'react';import Menu from 'lucide-react/icons/menu';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Info from 'lucide-react/icons/info';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminMenus } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Button, Chip, Spinner } from '@/components/ui';

interface MenuItem {
  id: number;
  name: string;
  slug: string;
  location: string;
  is_active: boolean;
  item_count: number;
}

const LOCATIONS: string[] = [
  'header-main',
  'header-secondary',
  'footer',
  'sidebar',
  'mobile',
];

export function MenusAdmin() {
  const { t } = useTranslation('admin_content');
  usePageTitle(t('content.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<MenuItem | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [locationFilter, setLocationFilter] = useState<string | null>(null);

  const LOCATION_LABELS: Record<string, string> = {
    'header-main': t('content.location_header_main'),
    'header-secondary': t('content.location_header_secondary'),
    'footer': t('content.footer'),
    'sidebar': t('content.location_sidebar'),
    'mobile': t('content.location_mobile'),
  };

  const filteredData = locationFilter
    ? data.filter((m) => m.location === locationFilter)
    : data;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminMenus.list();
      if (res.success && res.data) {
        const result = res.data as unknown;
        if (Array.isArray(result)) {
          setData(result);
        } else if (result && typeof result === 'object') {
          const pd = result as { data?: MenuItem[] };
          setData(pd.data || []);
        }
      }
    } catch {
      toast.error(t('content.failed_to_load_menus'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);


  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await adminMenus.delete(confirmDelete.id);
      if (res?.success) {
        toast.success(t('content.menu_deleted_successfully'));
        fetchData();
      } else {
        toast.error(t('content.failed_to_delete_menu'));
      }
    } catch {
      toast.error(t('content.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  const columns: Column<MenuItem>[] = [
    {
      key: 'name',
      label: t('content.label_name'),
      sortable: true,
      render: (item) => (
        <Button
          type="button"
          variant="tertiary"
          onPress={() => navigate(tenantPath(`/platform-team/menus/builder/${item.id}`))}
          className="text-left font-medium text-accent hover:underline min-w-0 min-h-10 p-0 justify-start"
        >
          {item.name}
        </Button>
      ),
    },
    {
      key: 'location',
      label: t('content.label_location'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {LOCATION_LABELS[item.location] ?? item.location ?? '--'}
        </span>
      ),
    },
    {
      key: 'item_count',
      label: t('content.items'),
      sortable: true,
      render: (item) => <span className="text-sm text-muted">{item.item_count ?? 0}</span>,
    },
    {
      key: 'is_active',
      label: t('content.label_active'),
      render: (item) => (
        <Chip size="sm" variant="soft" color={item.is_active ? 'success' : 'default'}>
          {item.is_active ? t('content.label_active') : t('content.label_inactive')}
        </Chip>
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
            onPress={() => navigate(tenantPath(`/platform-team/menus/builder/${item.id}`))}
            aria-label={t('content.label_edit_menu')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setConfirmDelete(item)}
            aria-label={t('content.label_delete_menu')}
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
        <PageHeader title={t('content.menus_admin_title')} description={t('content.menus_admin_desc')} />
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
        title={t('content.menus_admin_title')}
        description={t('content.menus_admin_desc')}
        actions={
          <Button
            startContent={<Plus size={16} />}
            onPress={() => navigate(tenantPath('/platform-team/menus/builder/new'))}
          >
            {t('content.create_menu_title')}
          </Button>
        }
      />

      {/* How it works notice */}
      <div className="flex items-start gap-3 p-4 mb-4 rounded-lg bg-accent-soft dark:bg-accent-soft border border-accent dark:border-accent">
        <Info size={16} className="text-accent0 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm">
          <p className="font-medium text-theme-primary">{t('content.menus_how_it_works_title')}</p>
          <p className="mt-0.5 text-theme-muted">{t('content.menus_how_it_works_desc')}</p>
        </div>
      </div>

      {/* Info notice when no custom menus exist */}
      {data.length === 0 && (
        <div className="flex items-start gap-3 p-4 mb-4 rounded-[12px] bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300">
          <Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-sm">{t('content.menus_using_defaults_desc')}</p>
        </div>
      )}

      {/* Location filter chips */}
      {data.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label={t('content.filter_by_location')}>
          <Button
            variant={locationFilter === null ? 'primary' : 'flat'}
            size="sm"
            onPress={() => setLocationFilter(null)}
            aria-pressed={locationFilter === null}
          >
            {t('content.filter_all', { count: data.length })}
          </Button>
          {LOCATIONS.map((loc) => {
            const count = data.filter((m) => m.location === loc).length;
            if (count === 0) return null;
            return (
              <Button
                key={loc}
                variant={locationFilter === loc ? 'primary' : 'flat'}
                size="sm"
                onPress={() => setLocationFilter(locationFilter === loc ? null : loc)}
                aria-pressed={locationFilter === loc}
              >
                {LOCATION_LABELS[loc] ?? loc} ({count})
              </Button>
            );
          })}
        </div>
      )}

      {data.length === 0 ? (
        <EmptyState
          icon={Menu}
          title={t('content.no_data_available')}
          description={t('content.desc_create_custom_navigation_menus_for_your_')}
          actionLabel={t('content.create_menu_title')}
          onAction={() => navigate(tenantPath('/platform-team/menus/builder/new'))}
        />
      ) : (
        <DataTable
          columns={columns}
          data={filteredData}
          searchPlaceholder={t('content.search')}
          onRefresh={fetchData}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={t('content.delete_menu_title')}
          message={t('content.delete_menu_confirm', { name: confirmDelete.name })}
          confirmLabel={t('content.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}

export default MenusAdmin;
