// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Role List
 * DataTable of roles with permissions count, user count. CRUD actions.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Shield from 'lucide-react/icons/shield';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable } from '../../components/DataTable';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { Column } from '../../components/DataTable';
import type { Role } from '../../api/types';
import { Button, Chip } from '@/components/ui';
import {
  caringRolePresetDescription,
  caringRolePresetKey,
  caringRolePresetName,
} from './caringRolePresetTranslations';

export function RoleList() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getRoles();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setRoles(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_roles'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])


  useEffect(() => {
    loadRoles();
  }, [loadRoles]);

  const handleDelete = async () => {
    if (!deleteTarget || !deleteTarget.id) return;
    setDeleting(true);
    try {
      const res = await adminEnterprise.deleteRole(deleteTarget.id);

      if (res.success) {
        toast.success(t('enterprise.role_deleted'));
        setDeleteTarget(null);
        loadRoles();
      } else {
        // Surface the API's own (server-translated) reason -- e.g. why a
        // particular role may not be deleted -- and fall back to the generic
        // message only when it sends none. This is the house pattern used by
        // every other admin page that reports a failed write.
        // admin-i18n-ignore: localized server message - AdminEnterpriseController
        // returns __('api.role_delete_failed') and the role-in-use reasons already
        // rendered in the caller's locale.
        toast.error(res.error || t('enterprise.failed_to_delete_role'));
      }
    } catch {
      toast.error(t('enterprise.failed_to_delete_role'));
    } finally {
      setDeleting(false);
    }
  };

  const columns: Column<Role>[] = [
    {
      key: 'name',
      label: t('enterprise.col_name'),
      sortable: true,
      render: (role) => (
        <div className="flex items-center gap-2">
          <Shield size={16} className="text-accent" />
          <span className="font-medium">
            {caringRolePresetKey(role.name)
              ? caringRolePresetName(t, caringRolePresetKey(role.name)!)
              : role.name}
          </span>
        </div>
      ),
    },
    { key: 'slug', label: t('enterprise.col_slug'), sortable: true },
    {
      key: 'description',
      label: t('enterprise.col_description'),
      render: (role) => {
        const presetKey = caringRolePresetKey(role.name);
        return presetKey ? caringRolePresetDescription(t, presetKey) : role.description;
      },
    },
    {
      key: 'permissions',
      label: t('enterprise.col_permissions'),
      render: (role) => (
        <Chip size="sm" variant="soft">
          {t('enterprise.permissions_count', { count: role.permissions?.length ?? 0 })}
        </Chip>
      ),
    },
    {
      key: 'users_count',
      label: t('enterprise.col_users'),
      sortable: true,
      render: (role) => (
        <span className="text-sm">{role.users_count ?? 0}</span>
      ),
    },
    {
      key: 'actions',
      label: t('enterprise.col_actions'),
      render: (role) => (
        <div className="flex items-center gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => navigate(tenantPath(`/admin/enterprise/roles/${role.id}/edit`))}
            aria-label={t('enterprise.label_edit_role')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setDeleteTarget(role)}
            isDisabled={role.slug === 'admin' || role.slug === 'super_admin'}
            aria-label={t('enterprise.label_delete_role')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.role_list_title')}
        description={t('enterprise.role_list_desc')}
        actions={
          <Button
            as={Link}
            to={tenantPath('/admin/enterprise/roles/create')}
            startContent={<Plus size={16} />}
            size="sm"
          >
            {t('enterprise.create_role')}
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={roles}
        isLoading={loading}
        onRefresh={loadRoles}
        searchable={false}
        emptyContent={t('enterprise.no_roles_found')}
      />

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('enterprise.delete_role_title')}
        message={t('enterprise.delete_role_confirm')}
        confirmLabel={t('enterprise.delete')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}

export default RoleList;
