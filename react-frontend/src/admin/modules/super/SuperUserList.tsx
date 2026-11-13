import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Avatar, Switch, Tabs, Tab } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Plus from 'lucide-react/icons/plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Shield from 'lucide-react/icons/shield';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Eye from 'lucide-react/icons/eye';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import Info from 'lucide-react/icons/info';
import { usePageTitle } from '@/hooks';
import { useTenant,
  useToast } from '@/contexts';
import { adminSuper } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column, type DataTableSort } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { SuperAdminUser, SuperUserView } from '../../api/types';

/**
 * The page's views, in tab order. Active comes first and is the default:
 * deleted accounts (thousands of them) are only ever listed under "deleted"
 * (owner, 13 Nov 2026).
 */
const VIEWS: SuperUserView[] = ['active', 'pending', 'suspended', 'banned', 'deleted', 'all'];
const DEFAULT_VIEW: SuperUserView = 'active';

/** Rows-per-page choices. The request and the page buttons always use the same one. */
const PAGE_SIZES = [20, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

/** Columns the server can sort by; their keys are the server's sort keys. */
const SORTABLE = new Set(['name', 'tenant', 'role', 'status', 'super_admin', 'last_login_at', 'created_at']);
const DEFAULT_SORT: DataTableSort = { column: 'created_at', direction: 'desc' };

/** Wait this long after the last keystroke before searching. */
const SEARCH_DELAY_MS = 300;

function positiveInt(value: string | null, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function SuperUserList() {
  const { t } = useTranslation('admin_super');
  usePageTitle(t('super.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  // The view, page, search, filters and sort live in the address, so the
  // back button, a refresh and a shared link all keep them.
  const [params, setParams] = useSearchParams();
  const view: SuperUserView = VIEWS.includes(params.get('view') as SuperUserView)
    ? (params.get('view') as SuperUserView)
    : DEFAULT_VIEW;
  const page = positiveInt(params.get('page'), 1);
  const sizeParam = positiveInt(params.get('size'), DEFAULT_PAGE_SIZE);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(sizeParam) ? sizeParam : DEFAULT_PAGE_SIZE;
  const search = params.get('q') ?? '';
  const tenantFilter = params.get('tenant') ? Number(params.get('tenant')) : undefined;
  const roleFilter = params.get('role') || undefined;
  const superAdminsOnly = params.get('sa') === '1';
  const sort: DataTableSort = useMemo(() => {
    const column = params.get('sort');
    if (!column || !SORTABLE.has(column)) return DEFAULT_SORT;
    return { column, direction: params.get('order') === 'asc' ? 'asc' : 'desc' };
  }, [params]);

  /**
   * Change some address values. Anything that changes which people match
   * (not just which page) goes back to page 1.
   */
  const update = useCallback((changes: Record<string, string | null>, resetPage = true) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      if (resetPage) next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const [users, setUsers] = useState<SuperAdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<SuperUserView, number>>>({});
  const [tenants, setTenants] = useState<Array<{id: number; name: string}>>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // What is in the search box now; it reaches the address after a pause.
  const [searchText, setSearchText] = useState(search);
  useEffect(() => { setSearchText(search); }, [search]);
  useEffect(() => {
    if (searchText === search) return;
    const timer = setTimeout(() => update({ q: searchText.trim() || null }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search, update]);

  const [confirmAction, setConfirmAction] = useState<{
    type: 'grant-sa' | 'revoke-sa' | 'grant-global' | 'revoke-global' | 'move';
    user: SuperAdminUser;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSuper.listUsers({
        view,
        page,
        limit: pageSize,
        search: search || undefined,
        tenant_id: tenantFilter,
        role: roleFilter,
        super_admins: superAdminsOnly || undefined,
        sort: sort.column,
        order: sort.direction,
      });
      if (res.success && res.data) {
        const rows = Array.isArray(res.data) ? res.data : [];
        setUsers(rows);
        // The server's total covers every page; fall back to this batch only
        // if an older server sends none.
        setTotal(res.meta?.total ?? (page - 1) * pageSize + rows.length);
        // `meta.counts` is this endpoint's own addition to the shared paging meta.
        const meta = res.meta as { counts?: Partial<Record<SuperUserView, number>> } | undefined;
        setCounts(meta?.counts ?? {});
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
  }, [view, page, pageSize, search, tenantFilter, roleFilter, superAdminsOnly, sort, t, toast]);

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

  const formatCount = (n: number) => n.toLocaleString(getFormattingLocale());
  const formatDate = (value?: string | null) =>
    value ? new Date(value).toLocaleDateString(getFormattingLocale()) : t('super.never');

  const columns: Column<SuperAdminUser>[] = [
    {
      key: 'name', label: t('super.col_user'), sortable: true,
      render: (user) => (
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="sm" />
          <div className="min-w-0">
            <Link to={tenantPath(`/super-admin/users/${user.id}`)} className="font-medium text-foreground hover:text-accent">
              {user.name}
            </Link>
            <p className="truncate text-xs text-muted">{user.email}</p>
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
      render: (user) => <span className="text-sm text-muted">{formatDate(user.last_login_at)}</span>,
    },
    {
      key: 'created_at', label: t('super.users_col_joined'), sortable: true,
      render: (user) => <span className="text-sm text-muted">{formatDate(user.created_at)}</span>,
    },
    {
      key: 'actions', label: t('super.col_actions'),
      render: (user) => {
        // A deleted account has been erased: there is nothing left to edit or promote.
        const erased = user.status === 'deleted';
        return (
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
              {erased ? null : <DropdownItem key="edit" id="edit" startContent={<ArrowRight size={14} />}>{t('super.action_edit')}</DropdownItem>}
              {erased ? null : !user.is_tenant_super_admin
                ? <DropdownItem key="grant-sa" id="grant-sa" startContent={<UserCheck size={14} />} className="text-success">{t('super.action_grant_tenant_sa')}</DropdownItem>
                : <DropdownItem key="revoke-sa" id="revoke-sa" startContent={<UserX size={14} />} className="text-warning">{t('super.action_revoke_tenant_sa')}</DropdownItem>
              }
              {erased ? null : !user.is_super_admin
                ? <DropdownItem key="grant-global" id="grant-global" startContent={<Shield size={14} />} className="text-accent">{t('super.action_grant_global_sa')}</DropdownItem>
                : <DropdownItem key="revoke-global" id="revoke-global" startContent={<Shield size={14} />} className="text-danger">{t('super.action_revoke_global_sa')}</DropdownItem>
              }
            </DropdownMenu>
          </Dropdown>
        );
      },
    },
  ];

  const confirmMessages: Record<string, { title: string; message: string; label: string }> = {
    'grant-sa': { title: t('super.confirm_grant_sa_title'), message: t('super.confirm_grant_sa_message'), label: t('super.confirm_grant_sa_label') },
    'revoke-sa': { title: t('super.confirm_revoke_sa_title'), message: t('super.confirm_revoke_sa_message'), label: t('super.confirm_revoke_sa_label') },
    'grant-global': { title: t('super.confirm_grant_global_title'), message: t('super.confirm_grant_global_message'), label: t('super.confirm_grant_global_label') },
    'revoke-global': { title: t('super.confirm_revoke_global_title'), message: t('super.confirm_revoke_global_message'), label: t('super.confirm_revoke_global_label') },
  };

  const viewLabels: Record<SuperUserView, string> = {
    active: t('super.users_view_active'),
    pending: t('super.users_view_pending'),
    suspended: t('super.users_view_suspended'),
    banned: t('super.users_view_banned'),
    deleted: t('super.users_view_deleted'),
    all: t('super.users_view_all'),
  };

  return (
    <div>
      {/* The admin layout already shows "Super Admin › Users" above the page. */}
      <PageHeader
        title={t('super.users_page_title')}
        description={t('super.users_page_desc')}
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

      <div className="mb-4 overflow-x-auto rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('super.users_view_tabs_aria')}
          selectedKey={view}
          onSelectionChange={(key) => update({ view: key === DEFAULT_VIEW ? null : String(key) })}
          variant="underlined"
          size="sm"
          // The table below is what each tab shows; the tabs' own panels stay empty.
          classNames={{ panel: 'p-0' }}
        >
          {VIEWS.map((key) => (
            <Tab
              key={key}
              title={
                <span className="flex items-center gap-2">
                  <span>{viewLabels[key]}</span>
                  {counts[key] !== undefined && (
                    <Chip size="sm" variant="soft" color={key === view ? 'primary' : 'default'}>
                      {formatCount(counts[key] as number)}
                    </Chip>
                  )}
                </span>
              }
            />
          ))}
        </Tabs>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Select
          label={t('super.label_filter_by_tenant')}
          size="sm"
          className="w-full max-w-xs"
          selectedKeys={[tenantFilter ? String(tenantFilter) : 'all']}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0];
            update({ tenant: val && val !== 'all' ? String(val) : null });
          }}
        >
          {[
            <SelectItem key="all" id="all">{t('super.users_all_communities')}</SelectItem>,
            ...tenants.map((tn) => <SelectItem key={String(tn.id)} id={String(tn.id)}>{tn.name}</SelectItem>),
          ]}
        </Select>
        <Select
          label={t('super.label_filter_by_role')}
          size="sm"
          className="w-full max-w-[12rem]"
          selectedKeys={[roleFilter ?? 'all']}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0];
            update({ role: val && val !== 'all' ? String(val) : null });
          }}
        >
          <SelectItem key="all" id="all">{t('super.users_all_roles')}</SelectItem>
          <SelectItem key="member" id="member">{t('super.role_member')}</SelectItem>
          <SelectItem key="admin" id="admin">{t('super.role_admin')}</SelectItem>
          <SelectItem key="broker" id="broker">{t('super.role_broker')}</SelectItem>
        </Select>
        <Select
          label={t('super.users_rows_per_page')}
          size="sm"
          className="w-full max-w-[9rem]"
          selectedKeys={[String(pageSize)]}
          onSelectionChange={(keys) => {
            const val = Number(Array.from(keys)[0]);
            update({ size: val && val !== DEFAULT_PAGE_SIZE ? String(val) : null });
          }}
        >
          {PAGE_SIZES.map((n) => <SelectItem key={String(n)} id={String(n)}>{String(n)}</SelectItem>)}
        </Select>
        <Switch
          size="sm"
          className="pb-2"
          classNames={{ content: 'flex-row items-center gap-2' }}
          isSelected={superAdminsOnly}
          onValueChange={(val) => update({ sa: val ? '1' : null })}
        >
          {t('super.super_admins_only')}
        </Switch>
      </div>

      {view === 'deleted' && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-divider bg-surface-secondary/50 p-3 text-sm text-muted">
          <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <p>{t('super.users_deleted_note')}</p>
        </div>
      )}

      <DataTable
        columns={columns}
        data={users}
        isLoading={loading}
        searchPlaceholder={t('super.users_search_placeholder')}
        searchValue={searchText}
        onSearch={setSearchText}
        onRefresh={loadUsers}
        totalItems={total}
        page={page}
        pageSize={pageSize}
        onPageChange={(p) => update({ page: p > 1 ? String(p) : null }, false)}
        sortDescriptor={sort}
        onSortChange={(column, direction) => {
          const isDefault = column === DEFAULT_SORT.column && direction === DEFAULT_SORT.direction;
          update({ sort: isDefault ? null : column, order: isDefault ? null : direction });
        }}
        mobileCards
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
