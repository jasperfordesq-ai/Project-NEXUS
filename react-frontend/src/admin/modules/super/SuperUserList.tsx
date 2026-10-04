import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Avatar, Switch } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Plus from 'lucide-react/icons/plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Shield from 'lucide-react/icons/shield';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Eye from 'lucide-react/icons/eye';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import { usePageTitle } from '@/hooks';
import { useTenant,
  useToast } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SuperAdminUser } from '../../api/types';

export function SuperUserList() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [tenants, setTenants] = useState<Array<{id: number; name: string}>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState<number | undefined>();
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [superAdminsOnly, setSuperAdminsOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'grant-sa' | 'revoke-sa' | 'grant-global' | 'revoke-global' | 'move';
    user: SuperAdminUser;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSuper.listUsers({
        page,
        search: search || undefined,
        tenant_id: tenantFilter,
        role: roleFilter,
        super_admins: superAdminsOnly || undefined,
        limit: 100,
      });
      if (res.success && res.data) {
        setUsers(Array.isArray(res.data) ? res.data : []);
        setLastRefreshed(new Date());
      } else if (!res.success) {
        toast.error(t('super.users_error_detail', { error: t('super.failed_to_load_user_list') }));
      }
    } catch {
      toast.error(t('super.users_error_detail', {
        error: t('super.unknown_error'),
      }));
    }
    setLoading(false);
  }, [page, search, tenantFilter, roleFilter, superAdminsOnly, t, toast])


  const loadTenants = useCallback(async () => {
    try {
      const res = await adminSuper.listTenants();
      if (res.success && res.data) {
        setTenants(Array.isArray(res.data) ? res.data.map((t) => ({ id: t.id, name: t.name })) : []);
      }
    } catch {
      // Tenant list for filter dropdown - non-critical
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { loadTenants(); }, [loadTenants]);

  const handleAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);
    const { type, user } = confirmAction;
    let res;
    switch (type) {
      case 'grant-sa': res = await adminSuper.grantSuperAdmin(user.id); break;
      case 'revoke-sa': res = await adminSuper.revokeSuperAdmin(user.id); break;
      case 'grant-global': res = await adminSuper.grantGlobalSuperAdmin(user.id); break;
      case 'revoke-global': res = await adminSuper.revokeGlobalSuperAdmin(user.id); break;
    }
    if (res?.success) {
      toast.success(t('super.user_updated_successfully'));
      loadUsers();
    } else {
      toast.error(t('super.action_failed'));
    }
    setActionLoading(false);
    setConfirmAction(null);
  };

  const columns: Column<SuperAdminUser>[] = [
    {
      key: 'name', label: t('super.col_user'), sortable: true,
      render: (user) => (
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="sm" />
          <div>
            <Link to={tenantPath(`/super-admin/users/${user.id}`)} className="font-medium text-foreground hover:text-accent">
              {user.name}
            </Link>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'tenant', label: t('super.col_tenant'), sortable: true,
      render: (user) => (
        <Link to={tenantPath(`/super-admin/tenants/${user.tenant_id}`)} className="hover:text-accent">
          <Chip size="sm" variant="soft">{user.tenant_name || t('super.tenant_with_id', { id: user.tenant_id })}</Chip>
        </Link>
      ),
    },
    {
      key: 'role', label: t('super.col_role'), sortable: true,
      render: (user) => (
        <Chip size="sm" variant="soft" color={user.role === 'admin' || user.role === 'tenant_admin' ? 'primary' : 'default'}>
          {t(`super.role_${user.role}`, { defaultValue: t('super.role_unknown') })}
        </Chip>
      ),
    },
    {
      key: 'status', label: t('super.col_status'), sortable: true,
      render: (user) => <StatusBadge status={user.status} />,
    },
    {
      key: 'super_admin', label: t('super.col_super_admin'), sortable: true,
      render: (user) => (
        <div className="flex items-center gap-1">
          {user.is_super_admin ? (
            <Chip size="sm" variant="soft" color="danger" startContent={<Shield size={10} />}>
              {t('super.global_sa')}
            </Chip>
          ) : user.is_tenant_super_admin ? (
            <Chip size="sm" variant="soft" startContent={<Shield size={10} />}>
              {t('super.tenant_sa')}
            </Chip>
          ) : (
            <span className="text-muted">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'last_login_at', label: t('super.col_last_login'), sortable: true,
      render: (user) => (
        <span className="text-sm text-muted">
          {user.last_login_at
            ? new Date(user.last_login_at).toLocaleDateString(getFormattingLocale())
            : t('super.never')}
        </span>
      ),
    },
    {
      key: 'actions', label: t('super.col_actions'),
      render: (user) => (
        <Dropdown>
          <DropdownTrigger><Button isIconOnly size="sm" variant="tertiary" aria-label={t('super.label_user_actions')}><MoreVertical size={16} /></Button></DropdownTrigger>
          <DropdownMenu aria-label={t('super.label_user_actions')} onAction={(key) => {
            if (key === 'view') navigate(tenantPath(`/super-admin/users/${user.id}`));
            else if (key === 'edit') navigate(tenantPath(`/super-admin/users/${user.id}/edit`));
            else if (key === 'grant-sa') setConfirmAction({ type: 'grant-sa', user });
            else if (key === 'revoke-sa') setConfirmAction({ type: 'revoke-sa', user });
            else if (key === 'grant-global') setConfirmAction({ type: 'grant-global', user });
            else if (key === 'revoke-global') setConfirmAction({ type: 'revoke-global', user });
          }}>
            <DropdownItem key="view" id="view" startContent={<Eye size={14} />}>{t('super.action_view')}</DropdownItem>
            <DropdownItem key="edit" id="edit" startContent={<ArrowRight size={14} />}>{t('super.action_edit')}</DropdownItem>
            {!user.is_tenant_super_admin
              ? <DropdownItem key="grant-sa" id="grant-sa" startContent={<UserCheck size={14} />} className="text-success">{t('super.action_grant_tenant_sa')}</DropdownItem>
              : <DropdownItem key="revoke-sa" id="revoke-sa" startContent={<UserX size={14} />} className="text-warning">{t('super.action_revoke_tenant_sa')}</DropdownItem>
            }
            {!user.is_super_admin
              ? <DropdownItem key="grant-global" id="grant-global" startContent={<Shield size={14} />} className="text-accent">{t('super.action_grant_global_sa')}</DropdownItem>
              : <DropdownItem key="revoke-global" id="revoke-global" startContent={<Shield size={14} />} className="text-danger">{t('super.action_revoke_global_sa')}</DropdownItem>
            }
          </DropdownMenu>
        </Dropdown>
      ),
    },
  ];

  const confirmMessages: Record<string, { title: string; message: string; label: string }> = {
    'grant-sa': { title: t('super.confirm_grant_sa_title'), message: t('super.confirm_grant_sa_message'), label: t('super.confirm_grant_sa_label') },
    'revoke-sa': { title: t('super.confirm_revoke_sa_title'), message: t('super.confirm_revoke_sa_message'), label: t('super.confirm_revoke_sa_label') },
    'grant-global': { title: t('super.confirm_grant_global_title'), message: t('super.confirm_grant_global_message'), label: t('super.confirm_grant_global_label') },
    'revoke-global': { title: t('super.confirm_revoke_global_title'), message: t('super.confirm_revoke_global_message'), label: t('super.confirm_revoke_global_label') },
  };

  return (
    <div>
      <nav aria-label={t('super.breadcrumb_nav_aria')} className="flex items-center gap-1 text-sm text-muted mb-1">
        <Link to={tenantPath('/super-admin')} className="hover:text-accent">{t('super.breadcrumb_super_admin')}</Link>
        <span>/</span>
        <span className="text-foreground">{t('super.breadcrumb_users')}</span>
      </nav>
      <PageHeader
        title={t('super.super_user_list_title')}
        description={t('super.super_user_list_desc')}
        actions={
          <div className="flex items-center gap-2">
            {lastRefreshed && (
              <span className="text-xs text-muted">
                {t('super.updated_at', { time: lastRefreshed.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' }) })}
              </span>
            )}
            <Button startContent={<Plus size={16} />}
              onPress={() => navigate(tenantPath('/super-admin/users/create'))}>
              {t('super.create_user')}
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Select
          label={t('super.label_filter_by_tenant')}
          size="sm"
          className="max-w-xs"
          selectedKeys={tenantFilter ? [String(tenantFilter)] : []}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0];
            setTenantFilter(val ? Number(val) : undefined);
            setPage(1);
          }}
        >
          {tenants.map((t) => <SelectItem key={String(t.id)} id={String(t.id)}>{t.name}</SelectItem>)}
        </Select>
        <Select
          label={t('super.label_filter_by_role')}
          size="sm"
          className="max-w-xs"
          selectedKeys={roleFilter ? [roleFilter] : []}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0];
            setRoleFilter(val ? String(val) : undefined);
            setPage(1);
          }}
        >
          <SelectItem key="member" id="member">{t('super.role_member')}</SelectItem>
          <SelectItem key="admin" id="admin">{t('super.role_admin')}</SelectItem>
        </Select>
        <Switch
          size="sm"
          isSelected={superAdminsOnly}
          onValueChange={(val) => {
            setSuperAdminsOnly(val);
            setPage(1);
          }}
        >
          {t('super.super_admins_only')}
        </Switch>
      </div>
      {users.length >= 100 && (
        <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded-lg">
          <p className="text-sm text-warning-soft-foreground">
            {t('super.showing_first_100')}
          </p>
        </div>
      )}
      <DataTable
        columns={columns}
        data={users}
        isLoading={loading}
        searchPlaceholder={t('super.search_users_placeholder')}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onRefresh={loadUsers}
        totalItems={users.length}
        page={page}
        pageSize={20}
        onPageChange={setPage}
      />
      {confirmAction && (
        <ConfirmModal
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleAction}
          title={confirmMessages[confirmAction.type]?.title ?? ''}
          message={t('super.confirm_user_message', {
            message: confirmMessages[confirmAction.type]?.message ?? '',
            name: confirmAction.user.name,
            email: confirmAction.user.email,
          })}
          confirmLabel={confirmMessages[confirmAction.type]?.label ?? ''}
          confirmColor={confirmAction.type.includes('revoke') ? 'danger' : 'primary'}
          isLoading={actionLoading}
        />
      )}
    </div>
  );
}
export default SuperUserList;
