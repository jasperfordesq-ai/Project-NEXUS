import { Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Tabs, Tab, SearchField } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin User List
 * Full user management with filtering, search, and bulk actions.
 * Parity: PHP Admin\UserController::index()
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import Plus from 'lucide-react/icons/plus';
import Upload from 'lucide-react/icons/upload';
import Download from 'lucide-react/icons/download';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import Ban from 'lucide-react/icons/ban';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Edit from 'lucide-react/icons/square-pen';
import Shield from 'lucide-react/icons/shield';
import KeyRound from 'lucide-react/icons/key-round';
import LogIn from 'lucide-react/icons/log-in';
import FileUp from 'lucide-react/icons/file-up';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { canImpersonateTarget } from '@/lib/access';
import { useTenant,
  useToast } from '@/contexts';
import { formatNumber, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminUsers,
  type BulkActionResult } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { BulkActionToolbar, type BulkAction } from '../../components/BulkActionToolbar';
import type { AdminUser,
  UserListParams } from '../../api/types';

type UserStatusFilter = NonNullable<UserListParams['status']>;

type ParsedUserSearch = {
  role?: string;
  search: string;
  status?: UserStatusFilter;
};

const PHRASE_HINTS: Array<
  | { type: 'role'; value: string; pattern: RegExp }
  | { type: 'status'; value: UserStatusFilter; pattern: RegExp }
> = [
  { type: 'status', value: 'never_logged_in', pattern: /\bnever[\s_-]+logged[\s_-]+in\b/gi },
  { type: 'status', value: 'onboarding_incomplete', pattern: /\bonboarding[\s_-]+incomplete\b/gi },
  { type: 'role', value: 'tenant_admin', pattern: /\btenant[\s_-]+admin\b/gi },
  { type: 'role', value: 'super_admin', pattern: /\bsuper[\s_-]+admin\b/gi },
];

const STATUS_HINTS: Record<string, UserStatusFilter> = {
  active: 'active',
  approved: 'active',
  banned: 'banned',
  ban: 'banned',
  incomplete: 'onboarding_incomplete',
  never_logged_in: 'never_logged_in',
  neverloggedin: 'never_logged_in',
  onboarding: 'onboarding_incomplete',
  onboarding_incomplete: 'onboarding_incomplete',
  pending: 'pending',
  suspended: 'suspended',
  suspend: 'suspended',
  unapproved: 'pending',
};

const ROLE_HINTS: Record<string, string> = {
  admin: 'admin',
  broker: 'broker',
  member: 'member',
  super_admin: 'super_admin',
  superadmin: 'super_admin',
  tenant_admin: 'tenant_admin',
  tenantadmin: 'tenant_admin',
};

const SEARCH_PREFIXES = new Set([
  'email',
  'id',
  'location',
  'name',
  'organisation',
  'organization',
  'phone',
  'user',
  'username',
]);

function normalizeHint(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanSearchToken(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function parseUserSearch(value: string): ParsedUserSearch {
  let remaining = value.trim();
  let role: string | undefined;
  let status: UserStatusFilter | undefined;

  for (const hint of PHRASE_HINTS) {
    if (hint.pattern.test(remaining)) {
      if (hint.type === 'role') {
        role = hint.value;
      } else {
        status = hint.value;
      }
      remaining = remaining.replace(hint.pattern, ' ');
    }
    hint.pattern.lastIndex = 0;
  }

  const searchTerms: string[] = [];
  const tokens = remaining.match(/"[^"]+"|'[^']+'|\S+/g) ?? [];

  for (const rawToken of tokens) {
    const token = cleanSearchToken(rawToken);
    if (!token) continue;

    const colonIndex = token.indexOf(':');
    if (colonIndex > 0) {
      const prefix = normalizeHint(token.slice(0, colonIndex));
      const tokenValue = cleanSearchToken(token.slice(colonIndex + 1));
      const normalizedValue = normalizeHint(tokenValue);

      if (prefix === 'role' && ROLE_HINTS[normalizedValue]) {
        role = ROLE_HINTS[normalizedValue];
        continue;
      }
      if (prefix === 'status' && STATUS_HINTS[normalizedValue]) {
        status = STATUS_HINTS[normalizedValue];
        continue;
      }
      if (SEARCH_PREFIXES.has(prefix) && tokenValue) {
        searchTerms.push(tokenValue);
        continue;
      }
    }

    const normalizedToken = normalizeHint(token);
    if (STATUS_HINTS[normalizedToken]) {
      status = STATUS_HINTS[normalizedToken];
      continue;
    }
    if (ROLE_HINTS[normalizedToken]) {
      role = ROLE_HINTS[normalizedToken];
      continue;
    }

    searchTerms.push(token);
  }

  return {
    role,
    search: searchTerms.join(' ').trim(),
    status,
  };
}

type UserConfirmAction = {
  type: 'approve' | 'suspend' | 'ban' | 'reactivate' | 'delete' | 'reset2fa' | 'impersonate';
  user: AdminUser;
};

interface UserActionsMenuProps {
  user: AdminUser;
  t: (key: string, options?: Record<string, unknown>) => string;
  isSuperAdmin: boolean;
  /*
   * The identity flags are needed, not just the id: the impersonation entry is
   * decided by comparing the viewer's security tier with the target's, mirroring
   * the server. Typing this as `{ id?: number }` hid those fields.
   */
  currentUser: {
    id?: number;
    role?: string;
    is_god?: boolean;
    is_super_admin?: boolean;
    is_tenant_super_admin?: boolean;
    is_admin?: boolean;
  } | null;
  navigate: (path: string) => void;
  tenantPath: (path: string) => string;
  setConfirmAction: React.Dispatch<React.SetStateAction<UserConfirmAction | null>>;
}

function UserActionsMenu({ user, t, isSuperAdmin, currentUser, navigate, tenantPath, setConfirmAction }: UserActionsMenuProps) {
  type ActionKey = 'edit' | 'approve' | 'suspend' | 'ban' | 'reactivate' | 'reset2fa' | 'permissions' | 'impersonate' | 'delete';

  const items: { key: ActionKey; label: string; icon: React.ReactNode; color?: 'success' | 'warning' | 'danger'; className?: string }[] = [
    { key: 'edit', label: t('users.action_edit'), icon: <Edit size={14} aria-hidden="true" /> },
  ];

  if (user.status === 'pending') {
    items.push({ key: 'approve', label: t('users.action_approve'), icon: <UserCheck size={14} aria-hidden="true" />, color: 'success', className: 'text-success' });
  }
  if (user.status === 'active') {
    items.push({ key: 'suspend', label: t('users.action_suspend'), icon: <UserX size={14} aria-hidden="true" />, color: 'warning', className: 'text-warning' });
  }
  if (user.status !== 'banned') {
    items.push({ key: 'ban', label: t('users.action_ban'), icon: <Ban size={14} aria-hidden="true" />, color: 'danger', className: 'text-danger' });
  }
  if (user.status === 'suspended' || user.status === 'banned') {
    items.push({ key: 'reactivate', label: t('users.action_reactivate'), icon: <RotateCcw size={14} aria-hidden="true" />, color: 'success', className: 'text-success' });
  }
  if (user.has_2fa_enabled) {
    items.push({ key: 'reset2fa', label: t('users.action_reset_2fa'), icon: <KeyRound size={14} aria-hidden="true" /> });
  }
  items.push({ key: 'permissions', label: t('users.action_permissions'), icon: <Shield size={14} aria-hidden="true" /> });
  /*
   * Offered only where the server will actually permit it.
   *
   * `isSuperAdmin` is the gate half (platform super-admin, god, or the
   * super-admin of this community — the same predicate as the route's
   * middleware). `canImpersonateTarget` is the tier half: a strictly higher tier
   * is required, so a peer administrator is not a target. Before 2026-08-06 this
   * checked only `!user.is_super_admin`, so pressing it on a fellow
   * administrator produced "Impersonate Failed" with nothing to explain it.
   */
  if (isSuperAdmin && canImpersonateTarget(currentUser, user) && user.id !== currentUser?.id) {
    items.push({ key: 'impersonate', label: t('users.action_impersonate'), icon: <LogIn size={14} aria-hidden="true" /> });
  }
  // Delete (only if not current user)
  if (user.id !== currentUser?.id) {
    items.push({ key: 'delete', label: t('users.action_delete'), icon: <Trash2 size={14} aria-hidden="true" />, color: 'danger', className: 'text-danger' });
  }

  const handleMenuAction = (key: React.Key) => {
    const action = key as ActionKey;
    if (action === 'edit') {
      navigate(tenantPath(`/admin/users/${user.id}/edit`));
    } else if (action === 'permissions') {
      navigate(tenantPath(`/admin/users/${user.id}/permissions`));
    } else if (action === 'impersonate') {
      setConfirmAction({ type: 'impersonate', user });
    } else {
      setConfirmAction({ type: action, user });
    }
  };

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('users.actions_menu')} className="bg-surface-secondary/70">
          <MoreVertical size={16} aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={t('users.actions_menu')} onAction={handleMenuAction}>
        {items.map((item) => (
          <DropdownItem
            key={item.key} id={item.key}
            startContent={item.icon}
            className={item.className}
            color={item.color}
          >
            {item.label}
          </DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  );
}

export function UserList() {
  const { t } = useTranslation('admin_users');
  useAdminPageMeta({ title: t('users.title') });
  const { tenantPath, tenant } = useTenant();
  const toast = useToast();
  const { user: currentUser } = useAuth();
  const isSuperAdmin = (currentUser as Record<string, unknown> | null)?.is_super_admin === true
    || (currentUser as Record<string, unknown> | null)?.is_tenant_super_admin === true
    || (currentUser?.role as string) === 'super_admin';
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState(searchParams.get('filter') || 'all');
  const [search, setSearch] = useState('');
  const parsedSearch = useMemo(() => parseUserSearch(search), [search]);

  // Sync filter state when the URL changes externally (e.g. sidebar link click)
  useEffect(() => {
    const urlFilter = searchParams.get('filter') || 'all';
    if (urlFilter !== filter) {
      setFilter(urlFilter);
      setPage(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Import modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importRole, setImportRole] = useState('member');
  const [importLoading, setImportLoading] = useState(false);
  const [importResults, setImportResults] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
    total_rows: number;
  } | null>(null);

  // Confirm modal state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'suspend' | 'ban' | 'reactivate' | 'delete' | 'reset2fa' | 'impersonate';
    user: AdminUser;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const handleBulkResult = (res: { success: boolean; error?: string; data?: BulkActionResult | unknown }, actionLabel: string) => {
    if (!res.success) {
      toast.error(t('users.result_failed'));
      return;
    }
    const data = (res.data as BulkActionResult) || { success: 0, failed: 0 };
    if (data.failed && data.failed > 0) {
      toast.error(t('users.result_partial'));
    } else {
      toast.success(t('users.result_success'));
    }
    setSelectedIds(new Set());
    loadUsers();
    void actionLabel;
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const effectiveStatus = parsedSearch.status
      ?? (filter === 'all' ? undefined : filter as UserListParams['status']);
    const params: UserListParams = {
      page,
      limit: 20,
      search: parsedSearch.search || undefined,
      status: effectiveStatus,
      role: parsedSearch.role,
      tenant_id: tenant?.id,
    };

    const res = await adminUsers.list(params);
    if (res.success && res.data) {
      const data = res.data as unknown;
      if (Array.isArray(data)) {
        setUsers(data);
        // Use meta.total from the paginated response envelope for correct pagination.
        // Falling back to data.length only if meta is unavailable (non-paginated response).
        const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
        setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
      } else if (data && typeof data === 'object') {
        const paginatedData = data as { data: AdminUser[]; meta?: { total: number } };
        setUsers(paginatedData.data || []);
        setTotal(paginatedData.meta?.total || 0);
      }
    }
    setLoading(false);
  }, [page, filter, parsedSearch, tenant?.id]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleFilterChange = (key: string) => {
    setFilter(key);
    setPage(1);
    if (key === 'all') {
      searchParams.delete('filter');
    } else {
      searchParams.set('filter', key);
    }
    setSearchParams(searchParams);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const roleLabel = (role: string) => {
    return t(`users.role_${role}`, { defaultValue: t('users.role_unknown') });
  };

  const activeSearchChips = [
    parsedSearch.status
      ? {
          key: 'status',
          label: t('users.smart_search_status_chip', {
            status: t(`users.${parsedSearch.status}`),
          }),
        }
      : null,
    parsedSearch.role
      ? {
          key: 'role',
          label: t('users.smart_search_role_chip', {
            role: roleLabel(parsedSearch.role),
          }),
        }
      : null,
    parsedSearch.search
      ? {
          key: 'query',
          label: t('users.smart_search_text_chip', { query: parsedSearch.search }),
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string }>;

  const handleImport = async () => {
    if (!importFile) return;
    setImportLoading(true);
    setImportResults(null);

    const res = await adminUsers.importUsers(importFile, { default_role: importRole });
    if (res.success && res.data) {
      const data = res.data as { imported: number; skipped: number; errors: string[]; total_rows: number };
      setImportResults(data);
      if (data.imported > 0) {
        toast.success(t('users.import_success'));
        loadUsers();
      }
    } else {
      toast.error(t('users.import_failed'));
    }
    setImportLoading(false);
  };

  const resetImportModal = () => {
    setImportOpen(false);
    setImportFile(null);
    setImportRole('member');
    setImportResults(null);
  };

  const handleAction = async () => {
    if (!confirmAction) return;
    setActionLoading(true);

    const { type, user } = confirmAction;
    let res;

    switch (type) {
      case 'approve':
        res = await adminUsers.approve(user.id);
        break;
      case 'suspend':
        res = await adminUsers.suspend(user.id);
        break;
      case 'ban':
        res = await adminUsers.ban(user.id);
        break;
      case 'reactivate':
        res = await adminUsers.reactivate(user.id);
        break;
      case 'delete':
        res = await adminUsers.delete(user.id);
        break;
      case 'reset2fa':
        res = await adminUsers.reset2fa(user.id, t('users.reset_2fa_reason'));
        break;
      case 'impersonate': {
        res = await adminUsers.impersonate(user.id);
        if (res?.success && res.data) {
          const tokenData = res.data as { token?: string; impersonation_token?: string; tenant_slug?: string; tenant_id?: number };
          const token = tokenData.token || tokenData.impersonation_token;
          const targetSlug = tokenData.tenant_slug || '';
          if (token) {
            // Open the new tab on the IMPERSONATED user's tenant URL — without
            // this, the URL inherits the admin's slug and /v2/users/me returns
            // 403 tenant_mismatch on the impersonated user's first request.
            const targetUrl = targetSlug
              ? `${window.location.origin}/${targetSlug}/dashboard`
              : `${window.location.origin}${tenantPath('/dashboard')}`;
            const { sendImpersonationToken } = await import('@/lib/impersonate');
            sendImpersonationToken(token, targetUrl, {
              tenantId: tokenData.tenant_id ?? null,
              tenantSlug: targetSlug || null,
            });
            toast.success(t('users.impersonate_success'));
          } else {
            toast.success(t('users.impersonate_started'));
          }
        } else {
          toast.error(t('users.impersonate_failed'));
        }
        setActionLoading(false);
        setConfirmAction(null);
        return;
      }
    }

    if (res?.success) {
      const data = res.data as Record<string, unknown> | undefined;
      if ((type === 'approve' || type === 'reactivate') && data?.email_sent === false) {
        toast.success(t('users.user_approved_email_warning'));
      } else {
        toast.success(t('users.user_action_success'));
      }
      loadUsers();
    } else {
      toast.error(t('users.user_action_failed'));
    }

    setActionLoading(false);
    setConfirmAction(null);
  };

  const confirmMessages: Record<string, { title: string; message: string; label: string }> = {
    approve: { title: t('users.confirm_approve_title'), message: t('users.confirm_approve_message'), label: t('users.action_approve') },
    suspend: { title: t('users.confirm_suspend_title'), message: t('users.confirm_suspend_message'), label: t('users.action_suspend') },
    ban: { title: t('users.confirm_ban_title'), message: t('users.confirm_ban_message'), label: t('users.action_ban') },
    reactivate: { title: t('users.confirm_reactivate_title'), message: t('users.confirm_reactivate_message'), label: t('users.action_reactivate') },
    delete: { title: t('users.confirm_delete_title'), message: t('users.confirm_delete_message'), label: t('users.action_delete') },
    reset2fa: { title: t('users.confirm_reset_2fa_title'), message: t('users.confirm_reset_2fa_message'), label: t('users.action_reset_2fa') },
    impersonate: { title: t('users.confirm_impersonate_title'), message: t('users.confirm_impersonate_message'), label: t('users.action_impersonate') },
  };

  const columns: Column<AdminUser>[] = [
    {
      key: 'name',
      label: t('users.col_user'),
      sortable: true,
      render: (user) => (
        <div className="flex items-center gap-3">
          <Avatar
            src={resolveAvatarUrl(user.avatar_url || user.avatar) || undefined}
            name={user.name}
            size="sm"
            className="ring-2 ring-surface"
          />
          <div>
            <Link
              to={tenantPath(`/admin/users/${user.id}/edit`)}
              className="font-medium text-foreground hover:text-accent"
            >
              {user.name}
            </Link>
            <p className="text-xs text-muted">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: t('users.col_role'),
      sortable: true,
      render: (user) => (
        <div className="flex items-center gap-1">
          <Chip
            size="sm"
            variant="soft"
            color={user.is_super_admin || user.role === 'super_admin' ? 'secondary' : user.role === 'admin' || user.role === 'tenant_admin' ? 'primary' : 'default'}
          >
            {roleLabel(user.role)}
          </Chip>
          {user.is_super_admin && (
            <Chip size="sm" variant="soft" color="warning" startContent={<Shield size={10} aria-hidden="true" />}>
              {t('users.role_super_admin_short')}
            </Chip>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: t('users.col_status'),
      sortable: true,
      render: (user) => <StatusBadge status={user.status} />,
    },
    {
      key: 'email_verified_at',
      label: t('users.col_email_activation'),
      sortable: true,
      render: (user) => {
        const isActivated = Boolean(user.email_verified_at);

        return (
          <Chip
            size="sm"
            variant="soft"
            color={isActivated ? 'success' : 'warning'}
            className="gap-1 whitespace-nowrap"
          >
            {isActivated ? (
              <CheckCircle2 size={12} aria-hidden="true" />
            ) : (
              <AlertCircle size={12} aria-hidden="true" />
            )}
            {isActivated ? t('users.email_activation_activated') : t('users.email_activation_not_activated')}
          </Chip>
        );
      },
    },
    {
      key: 'balance',
      label: t('users.col_balance'),
      sortable: true,
      render: (user) => <span>{formatNumber(user.balance ?? 0, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}</span>,
    },
    {
      key: 'created_at',
      label: t('users.col_joined'),
      sortable: true,
      render: (user) => (
        <span className="text-sm text-muted">
          {new Date(user.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('users.col_actions'),
      render: (user) => (
        <UserActionsMenu
          user={user}
          t={t}
          isSuperAdmin={isSuperAdmin}
          currentUser={currentUser}
          navigate={navigate}
          tenantPath={tenantPath}
          setConfirmAction={setConfirmAction}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('users.title')}
        description={t('users.description')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              startContent={<Upload size={16} />}
              onPress={() => setImportOpen(true)}
            >
              {t('users.import_csv')}
            </Button>
            <Button
              startContent={<Plus size={16} />}
              onPress={() => navigate(tenantPath('/admin/users/create'))}
            >
              {t('users.add_user')}
            </Button>
          </div>
        }
      />

      <section className="rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03]">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-sm font-semibold text-foreground">
              {t('users.smart_search_label')}
            </p>
            <SearchField
              id="admin-user-smart-search"
              aria-label={t('users.smart_search_label')}
              value={search}
              onValueChange={handleSearchChange}
              placeholder={t('users.smart_search_placeholder')}
              size="lg"
              variant="bordered"
              autoComplete="off"
              classNames={{
                inputWrapper: 'bg-surface-secondary/50 border-divider/70',
                input: 'text-sm',
              }}
            />
          </div>
          {search && (
            <Button
              variant="secondary"
              onPress={() => handleSearchChange('')}
              className="lg:mb-0.5"
            >
              {t('users.smart_search_clear')}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          {t('users.smart_search_description')}
        </p>
        {activeSearchChips.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {activeSearchChips.map((chip) => (
              <Chip key={chip.key} size="sm" variant="soft" color={chip.key === 'query' ? 'default' : 'primary'}>
                {chip.label}
              </Chip>
            ))}
          </div>
        )}
      </section>

      {/* Status Filter Tabs */}
      <div className="rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('users.tabs_aria')}
          selectedKey={filter}
          onSelectionChange={(key) => handleFilterChange(key as string)}
          variant="underlined"
          size="sm"
        >
          <Tab key="all" title={t('users.all_users')} />
          <Tab key="pending" title={t('users.pending')} />
          <Tab key="active" title={t('users.active')} />
          <Tab key="suspended" title={t('users.suspended')} />
          <Tab key="banned" title={t('users.banned')} />
          <Tab key="never_logged_in" title={t('users.never_logged_in')} />
          <Tab key="onboarding_incomplete" title={t('users.onboarding_incomplete')} />
        </Tabs>
      </div>

      {(() => {
        const selectedIdList = Array.from(selectedIds).map((id) => Number(id)).filter((n) => Number.isFinite(n));
        const bulkActions: BulkAction[] = [
          {
            key: 'approve',
            label: t('users.action_approve'),
            icon: <UserCheck size={14} />,
            color: 'success',
            confirmTitle: t('users.bulk_approve_title'),
            confirmMessage: t('users.bulk_approve_message'),
            onConfirm: async () => {
              setBulkLoading(true);
              try {
                const res = await adminUsers.bulkApprove(selectedIdList);
                handleBulkResult(res, 'approve');
              } finally {
                setBulkLoading(false);
              }
            },
          },
          {
            key: 'suspend',
            label: t('users.action_suspend'),
            icon: <UserX size={14} />,
            color: 'warning',
            destructive: true,
            needsReason: true,
            reasonLabel: t('users.label_reason'),
            reasonPlaceholder: t('users.reason_placeholder'),
            confirmTitle: t('users.bulk_suspend_title'),
            confirmMessage: t('users.bulk_suspend_message'),
            onConfirm: async (reason) => {
              setBulkLoading(true);
              try {
                const res = await adminUsers.bulkSuspend(selectedIdList, reason);
                handleBulkResult(res, 'suspend');
              } finally {
                setBulkLoading(false);
              }
            },
          },
        ];
        return (
          <BulkActionToolbar
            selectedCount={selectedIds.size}
            actions={bulkActions}
            onClearSelection={() => setSelectedIds(new Set())}
            isLoading={bulkLoading}
          />
        );
      })()}

      <DataTable
        columns={columns}
        data={users}
        isLoading={loading}
        searchable={false}
        onRefresh={loadUsers}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        selectable
        onSelectionChange={setSelectedIds}
      />

      {/* Confirm Action Modal */}
      {confirmAction && (
        <ConfirmModal
          isOpen={!!confirmAction}
          onClose={() => setConfirmAction(null)}
          onConfirm={handleAction}
          title={confirmMessages[confirmAction.type]?.title ?? ''}
          message={`${confirmMessages[confirmAction.type]?.message ?? ''}\n\n${t('users.user_context', { name: confirmAction.user.name, email: confirmAction.user.email })}`}
          confirmLabel={confirmMessages[confirmAction.type]?.label ?? ''}
          confirmColor={confirmAction.type === 'approve' || confirmAction.type === 'reactivate' ? 'primary' : 'danger'}
          isLoading={actionLoading}
        />
      )}

      {/* Import Users Modal */}
      <Modal isOpen={importOpen} onClose={resetImportModal} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <FileUp size={20} aria-hidden="true" />
            {t('users.import_title')}
          </ModalHeader>
          <ModalBody>
            {!importResults ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted">
                  {t('users.import_csv_description')}
                </p>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="tertiary"
                    startContent={<Download size={14} />}
                    onPress={() => adminUsers.downloadImportTemplate()}
                  >
                    {t('users.import_download_template')}
                  </Button>
                </div>

                <div>
                  <label htmlFor="import-csv-file" className="block text-sm font-medium mb-1">
                    {t('users.import_csv_file')}
                  </label>
                  <input
                    id="import-csv-file"
                    type="file"
                    accept=".csv"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                    className="block w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent-soft file:text-accent hover:file:bg-accent-soft"
                  />
                </div>

                <Select
                  label={t('users.import_default_role')}
                  selectedKeys={[importRole]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as string;
                    if (selected) setImportRole(selected);
                  }}
                  size="sm"
                  variant="secondary"
                >
                  <SelectItem key="member" id="member">{t('users.import_role_member')}</SelectItem>
                  <SelectItem key="broker" id="broker">{t('users.import_role_broker')}</SelectItem>
                  <SelectItem key="coordinator" id="coordinator">{t('users.import_role_coordinator')}</SelectItem>
                </Select>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span className="font-medium">{t('users.import_imported')}</span>
                  </div>
                  {importResults.skipped > 0 && (
                    <div className="flex items-center gap-2 text-warning">
                      <AlertCircle size={18} aria-hidden="true" />
                      <span className="font-medium">{t('users.import_skipped')}</span>
                    </div>
                  )}
                  <span className="text-sm text-muted">
                    {t('users.import_total_rows')}
                  </span>
                </div>

                {importResults.errors.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-lg bg-danger-50 p-3">
                    <p className="text-sm font-medium text-danger mb-1">{t('users.import_errors')}</p>
                    <ul className="text-xs text-danger-600 space-y-1">
                      {importResults.errors.map((err, i) => (
                        // Error strings may duplicate; use index prefix for stable key
                        <li key={`err-${i}`}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={resetImportModal} isDisabled={importLoading}>
              {importResults ? t('users.close') : t('users.cancel')}
            </Button>
            {!importResults && (
              <Button
                onPress={handleImport}
                isLoading={importLoading}
                isDisabled={!importFile}
                startContent={!importLoading ? <Upload size={16} /> : undefined}
              >
                {t('users.import_title')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default UserList;
