// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Members Page
 *
 * Rich member management restyled to the broker design language: a KPI stat
 * header (totals derived from the same list endpoint the page already uses),
 * deep-linkable status tabs (?status=…), enriched member cells, a polished
 * bulk-action bar, per-tab empty states, and the notes / detail workflows.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import { Chip } from '@/components/ui';
import { Badge } from '@/components/ui';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Clock from 'lucide-react/icons/clock';
import Coins from 'lucide-react/icons/coins';
import StickyNote from 'lucide-react/icons/sticky-note';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import ExternalLink from 'lucide-react/icons/external-link';
import Send from 'lucide-react/icons/send';
import MailCheck from 'lucide-react/icons/mail-check';
import MailX from 'lucide-react/icons/mail-x';
import X from 'lucide-react/icons/x';
import IdCard from 'lucide-react/icons/id-card';
import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Moon from 'lucide-react/icons/moon';
import Hourglass from 'lucide-react/icons/hourglass';
import Sparkles from 'lucide-react/icons/sparkles';
import SearchX from 'lucide-react/icons/search-x';
import BadgeCheck from 'lucide-react/icons/badge-check';
import { MemberName, useMemberWindow } from '@/broker/BrokerMemberWindow';
import { useCsvExport } from '@/broker/useCsvExport';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import { useMemberNotes } from '@/broker/components/member/useMemberNotes';
import { MemberNotesPanel } from '@/broker/components/member/MemberNotesPanel';
import type { DataTableSort } from '@/admin/components/DataTable';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useToast,
  useTenant } from '@/contexts';
import { adminUsers } from '@/admin/api/adminApi';
import type { AdminUser } from '@/admin/api/types';
import { DataTable,
  ConfirmModal } from '@/admin/components';
import type { Column } from '@/admin/components';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { parseServerTimestamp,
  formatServerDate,
  formatServerDateTime } from '@/lib/serverTime';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, Avatar, Tabs, Tab, Tooltip, Select, SelectItem, useConfirm } from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerSkeleton,
  BrokerEmptyState,
  BrokerStatusChip,
  type BrokerStatColor,
} from '../components';
// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────────────────

type StatusTab = 'all' | 'pending' | 'active' | 'suspended' | 'never_logged_in' | 'onboarding_incomplete';

/** KPI counts derived from the list endpoint (meta.total with limit=1). */
interface MemberStats {
  total: number | null;
  pending: number | null;
  active: number | null;
  suspended: number | null;
}

const PAGE_SIZE = 20;

// Columns the list endpoint can sort on (AdminUsersController@index whitelist).
const SORTABLE_COLUMNS = new Set(['name', 'email', 'role', 'created_at', 'balance', 'status']);

// Role filter options — matches the roles the list endpoint understands.
const ROLE_FILTERS = ['all', 'member', 'broker', 'admin', 'tenant_admin', 'org_admin'] as const;

// Deep-linkable tab keys — anything else in ?status falls back to 'all'.
const VALID_TABS: ReadonlySet<string> = new Set([
  'all', 'pending', 'active', 'suspended', 'never_logged_in', 'onboarding_incomplete',
]);

// Per-tab empty states. Empty review queues read as good news (success);
// the catch-all tab stays neutral.
const EMPTY_BY_TAB: Record<StatusTab, { icon: LucideIcon; color: BrokerStatColor; titleKey: string; hintKey: string }> = {
  all: { icon: Users, color: 'neutral', titleKey: 'members.empty_all_title', hintKey: 'members.empty_all_hint' },
  pending: { icon: Sparkles, color: 'success', titleKey: 'members.empty_pending_title', hintKey: 'members.empty_pending_hint' },
  active: { icon: UserCheck, color: 'neutral', titleKey: 'members.empty_active_title', hintKey: 'members.empty_active_hint' },
  suspended: { icon: ShieldCheck, color: 'success', titleKey: 'members.empty_suspended_title', hintKey: 'members.empty_suspended_hint' },
  never_logged_in: { icon: Moon, color: 'success', titleKey: 'members.empty_never_logged_in_title', hintKey: 'members.empty_never_logged_in_hint' },
  onboarding_incomplete: { icon: Hourglass, color: 'success', titleKey: 'members.empty_onboarding_incomplete_title', hintKey: 'members.empty_onboarding_incomplete_hint' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function useTimeAgo() {
  const { t } = useTranslation('broker');
  return (dateStr: string | null | undefined): string => {
    if (!dateStr) return t('members.time_never');
    const parsed = parseServerTimestamp(dateStr);
    if (!parsed) return t('members.time_never');
    // Clamp to 0 so server clock skew doesn't render rows as "in the future".
    const diff = Math.max(0, Date.now() - parsed.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('members.time_just_now');
    if (mins < 60) return t('members.time_minutes_ago', { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t('members.time_hours_ago', { count: hours });
    const days = Math.floor(hours / 24);
    if (days < 30) return t('members.time_days_ago', { count: days });
    return formatServerDate(dateStr);
  };
}

/**
 * Count members in a given status via the SAME list endpoint the table uses
 * (limit=1, read the pagination total). No new endpoints — just a cheap count.
 *
 * NOTE: the api client unwraps the `{ data, meta }` envelope — the row array
 * arrives as `res.data` and the pagination meta as `res.meta`. Reading
 * `res.data.meta` (which never exists) is what made every card show "1".
 */
async function fetchStatusTotal(status?: 'pending' | 'active' | 'suspended'): Promise<number | null> {
  try {
    const params: Record<string, unknown> = { page: 1, limit: 1 };
    if (status) params.status = status;
    const res = await adminUsers.list(params as Parameters<typeof adminUsers.list>[0]);
    if (res.success) {
      if (typeof res.meta?.total === 'number') return res.meta.total;
      // Defensive fallback for endpoints that return a bare array with no meta.
      const payload = res.data as unknown;
      if (Array.isArray(payload)) return payload.length;
      if (payload && typeof payload === 'object') {
        const meta = (payload as { meta?: { total?: number } }).meta;
        if (typeof meta?.total === 'number') return meta.total;
      }
    }
  } catch {
    // Stats are supplementary — a failed count renders as "—", never a toast.
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function MembersPage() {
  const { t } = useTranslation('broker');
  const timeAgo = useTimeAgo();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { open: openMember } = useMemberWindow();
  const csvExport = useCsvExport();
  usePageTitle(t('members.page_title'));

  // Stash the latest `t`/`toast` in refs so the fetch effect is keyed on the
  // real query params only (see BrokerDashboardPage for the rationale).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // Data state
  const [members, setMembers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // First page load renders a shaped skeleton; later refreshes use the
  // table's own isLoading so the layout never jumps.
  const [initialLoaded, setInitialLoaded] = useState(false);

  // KPI stats
  const [stats, setStats] = useState<MemberStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Filter / pagination state — every filter lives in the URL (?status=…,
  // ?search=…, ?role=…) so dashboard tiles, stat cards and the command palette
  // can deep-link into a filtered view, and the view survives a reload.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') ?? 'all';
  const activeTab: StatusTab = (VALID_TABS.has(statusParam) ? statusParam : 'all') as StatusTab;
  const roleParam = searchParams.get('role') ?? 'all';
  const roleFilter: string = (ROLE_FILTERS as readonly string[]).includes(roleParam) ? roleParam : 'all';
  // The URL holds the *settled* search term, so it is also the debounced value
  // the fetch is keyed on. The input's own text is local until the debounce.
  const debouncedSearch = (searchParams.get('search') ?? '').trim();

  /** Change one or more URL filters without disturbing the others. */
  const updateFilters = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [search, setSearch] = useState(debouncedSearch);
  // Debounce search so typing doesn't fire a network request on every
  // keystroke — the settled text is written to ?search=.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (search.trim() !== debouncedSearch) updateFilters({ search: search.trim() });
    }, 300);
    return () => clearTimeout(handle);
  }, [search, debouncedSearch, updateFilters]);
  // A link or the palette can change ?search= while the page is open — adopt it.
  useEffect(() => {
    setSearch((current) => (current.trim() === debouncedSearch ? current : debouncedSearch));
  }, [debouncedSearch]);
  const [page, setPage] = useState(1);
  // Server-side sort — the list endpoint orders the whole collection, so
  // sorting never misorders a page of a 256-member community.
  const [sort, setSort] = useState<DataTableSort>({ column: 'created_at', direction: 'desc' });

  // Stat cards and dashboard tiles deep-link into ?status=… without going
  // through handleTabChange — reset paging + selection when the tab changes
  // underneath us so a stale page number can't render an empty result set.
  const prevTabRef = useRef(activeTab);
  useEffect(() => {
    if (prevTabRef.current === activeTab) return;
    prevTabRef.current = activeTab;
    setPage(1);
    setSelectedIds(new Set());
  }, [activeTab]);

  // Action modal state
  const [confirmAction, setConfirmAction] = useState<{
    type: 'approve' | 'suspend';
    user: AdminUser;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Bulk selection state — powers the "approve/suspend selected" bar.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Notes modal: the member whose notes are open; data via the shared hook.
  const [notesUser, setNotesUser] = useState<AdminUser | null>(null);
  const notesState = useMemberNotes(notesUser?.id ?? null);
  const openNotes = useCallback((user: AdminUser) => setNotesUser(user), []);

  // ─── Fetch members ────────────────────────────────────────────────────────

  /** Load the current page. `quiet` keeps the rows on screen (no spinner) — used by auto-refresh. */
  const fetchMembers = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        limit: PAGE_SIZE,
        sort: sort.column,
        order: sort.direction,
      };
      if (activeTab !== 'all') params.status = activeTab;
      if (roleFilter !== 'all') params.role = roleFilter;
      if (debouncedSearch.trim()) params.search = debouncedSearch.trim();

      const res = await adminUsers.list(params as Parameters<typeof adminUsers.list>[0]);
      if (res.success && res.data) {
        // api client unwrap: res.data is the row array, res.meta the pagination
        // meta. The full collection size MUST come from meta.total — using the
        // page's row count here is what hid the pagination controls entirely.
        const payload = res.data as unknown;
        const rows = Array.isArray(payload)
          ? (payload as AdminUser[])
          : ((payload as { data?: AdminUser[] }).data ?? []);
        setMembers(rows);
        const metaTotal =
          res.meta?.total ?? (payload as { meta?: { total?: number } })?.meta?.total;
        setTotal(typeof metaTotal === 'number' ? metaTotal : rows.length);
      }
    } catch {
      toastRef.current.error(tRef.current('members.action_failed'));
    } finally {
      setLoading(false);
      setInitialLoaded(true);
    }
    // Fetch is keyed on the real query params only — t/toast live in refs.
  }, [page, activeTab, roleFilter, debouncedSearch, sort]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  /** Re-count the KPI cards. `quiet` keeps the current numbers up (no skeleton) — used by auto-refresh. */
  const loadStats = useCallback(async (quiet = false) => {
    if (!quiet) setStatsLoading(true);
    const [totalCount, pending, active, suspended] = await Promise.all([
      fetchStatusTotal(),
      fetchStatusTotal('pending'),
      fetchStatusTotal('active'),
      fetchStatusTotal('suspended'),
    ]);
    setStats({ total: totalCount, pending, active, suspended });
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const refreshAll = useCallback(() => {
    void fetchMembers();
    void loadStats();
  }, [fetchMembers, loadStats]);

  // Quiet refresh after any broker write / on an interval: same page, same
  // filters, rows stay on screen while the new ones arrive.
  useBrokerAutoRefresh(() => {
    void fetchMembers(true);
    void loadStats(true);
  });

  const handleSortChange = useCallback((column: string, direction: DataTableSort['direction']) => {
    if (!SORTABLE_COLUMNS.has(column)) return;
    setPage(1);
    setSort({ column, direction });
  }, []);

  // ─── Export ───────────────────────────────────────────────────────────────

  const handleExport = useCallback(() => {
    const status = activeTab === 'all' ? undefined : activeTab;
    const role = roleFilter === 'all' ? undefined : roleFilter;
    const search = debouncedSearch.trim() || undefined;
    const filename = ['members', status, role].filter(Boolean).join('_');
    void csvExport.run<AdminUser>({
      filename,
      columns: [
        { label: t('members.col_name'), value: (u) => u.name },
        { label: t('members.col_email'), value: (u) => u.email },
        { label: t('members.col_status'), value: (u) => u.status },
        { label: t('members.col_role'), value: (u) => t(`members.role_${u.role}`, { defaultValue: u.role }) },
        { label: t('members.col_balance'), value: (u) => u.balance },
        { label: t('members.col_last_active'), value: (u) => (u.last_active_at ? formatServerDateTime(u.last_active_at) : '') },
        { label: t('members.col_joined'), value: (u) => formatServerDate(u.created_at) },
      ],
      // Same endpoint, same filters as the screen, at the server's maximum page size (limit=100).
      fetchPage: async (p) => {
        const res = await adminUsers.list({ page: p, limit: 100, status, role, search, sort: sort.column, order: sort.direction } as Parameters<typeof adminUsers.list>[0]);
        if (!res.success) throw new Error('export');
        const rows = Array.isArray(res.data) ? (res.data as AdminUser[]) : [];
        const hasMore = res.meta?.has_more ?? (typeof res.meta?.total === 'number' ? p * 100 < res.meta.total : rows.length === 100);
        return { rows, hasMore };
      },
    });
  }, [activeTab, roleFilter, debouncedSearch, sort, csvExport, t]);

  // ─── Tab change / search ──────────────────────────────────────────────────

  const handleTabChange = useCallback((key: React.Key) => {
    const next = String(key);
    setPage(1);
    setSelectedIds(new Set());
    // Deep-linkable filter: ?status=<tab>, omitted for the default tab. The
    // search and role filters are kept.
    updateFilters({ status: next === 'all' ? null : next });
  }, [updateFilters]);

  const handleSearch = useCallback((query: string) => {
    setSearch(query);
    setPage(1);
    setSelectedIds(new Set());
  }, []);

  const handleRoleChange = useCallback((next: string) => {
    setPage(1);
    setSelectedIds(new Set());
    updateFilters({ role: next === 'all' ? null : next });
  }, [updateFilters]);

  // ─── Bulk actions ───────────────────────────────────────────────────────────

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const runBulk = useCallback(
    async (
      fn: (ids: number[]) => Promise<{ success?: boolean; error?: string }>,
      successKey: string,
    ) => {
      const ids = Array.from(selectedIds).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (ids.length === 0) return;
      setBulkLoading(true);
      try {
        const res = await fn(ids);
        if (res?.success) {
          toast.success(t(successKey, { count: ids.length }));
          clearSelection();
          refreshAll();
        } else {
          toast.error(res?.error || t('members.action_failed'));
        }
      } catch {
        toast.error(t('members.action_failed'));
      } finally {
        setBulkLoading(false);
      }
    },
    [selectedIds, toast, t, clearSelection, refreshAll],
  );

  // Both bulk actions change access for several people at once and email each
  // of them — a mis-click must be stoppable, so each asks first.
  const handleBulkApprove = useCallback(async () => {
    const count = selectedIds.size;
    const ok = await confirm({
      title: t('members.bulk_approve_confirm_title'),
      body: t('members.bulk_approve_confirm_body', { count }),
      confirmLabel: t('members.bulk_approve'),
      status: 'success',
    });
    if (!ok) return;
    await runBulk((ids) => adminUsers.bulkApprove(ids), 'members.bulk_approved_success');
  }, [selectedIds, confirm, t, runBulk]);
  const handleBulkSuspend = useCallback(async () => {
    const count = selectedIds.size;
    const ok = await confirm({
      title: t('members.bulk_suspend_confirm_title'),
      body: t('members.bulk_suspend_confirm_body', { count }),
      confirmLabel: t('members.bulk_suspend'),
      status: 'danger',
    });
    if (!ok) return;
    await runBulk((ids) => adminUsers.bulkSuspend(ids), 'members.bulk_suspended_success');
  }, [selectedIds, confirm, t, runBulk]);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleApprove = useCallback(async () => {
    if (!confirmAction || confirmAction.type !== 'approve') return;
    setActionLoading(true);
    try {
      const res = await adminUsers.approve(confirmAction.user.id);
      if (res.success) {
        toast.success(t('members.approved_success'));
        setConfirmAction(null);
        refreshAll();
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setActionLoading(false);
    }
  }, [confirmAction, toast, t, refreshAll]);

  const handleSuspend = useCallback(async () => {
    if (!confirmAction || confirmAction.type !== 'suspend') return;
    setActionLoading(true);
    try {
      const res = await adminUsers.suspend(confirmAction.user.id);
      if (res.success) {
        toast.success(t('members.suspended_success'));
        setConfirmAction(null);
        refreshAll();
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setActionLoading(false);
    }
  }, [confirmAction, toast, t, refreshAll]);

  // Per-id loading flag prevents double-click from spamming the
  // reactivate endpoint (which fires welcome-back emails + bell
  // notifications on every call — the backend is not idempotent).
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const handleReactivate = useCallback(
    async (user: AdminUser) => {
      if (reactivatingId !== null) return;
      // Reactivation emails the member, so it is confirmed like suspend is.
      const ok = await confirm({
        title: t('members.confirm_reactivate_title'),
        body: t('members.confirm_reactivate_message', { name: user.name }),
        confirmLabel: t('members.reactivate'),
        status: 'accent',
      });
      if (!ok) return;
      setReactivatingId(user.id);
      try {
        const res = await adminUsers.reactivate(user.id);
        if (res.success) {
          toast.success(t('members.reactivated_success'));
          refreshAll();
        } else {
          toast.error(t('members.action_failed'));
        }
      } catch {
        toast.error(t('members.action_failed'));
      } finally {
        setReactivatingId(null);
      }
    },
    [reactivatingId, confirm, toast, t, refreshAll],
  );

  // ─── Columns ──────────────────────────────────────────────────────────────

  const columns: Column<AdminUser>[] = useMemo(
    () => [
      {
        key: 'name',
        sortable: true,
        label: t('members.col_name'),
        render: (user: AdminUser) => (
          <div className="flex min-w-0 items-center gap-3">
            <Badge
              content=""
              color={user.status === 'active' ? 'success' : user.status === 'suspended' ? 'danger' : 'warning'}
              placement="bottom-right"
              shape="circle"
              size="sm"
              isInvisible={!user.status}
            >
              <Avatar
                src={resolveAvatarUrl(user.avatar_url || user.avatar) || undefined}
                name={user.name}
                size="sm"
                className="h-9 w-9"
              />
            </Badge>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <MemberName userId={user.id} name={user.name} className="truncate text-sm" />
                {user.email_verified_at && (
                  <Tooltip content={t('members.email_verified')}>
                    <BadgeCheck
                      size={14}
                      className="shrink-0 text-success"
                      aria-label={t('members.email_verified')}
                      role="img"
                    />
                  </Tooltip>
                )}
              </div>
              <p className="truncate text-xs text-muted">{user.email}</p>
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        sortable: true,
        label: t('members.col_status'),
        render: (user: AdminUser) => (
          <div className="flex flex-col gap-1">
            <BrokerStatusChip status={user.status} />
            {user.onboarding_completed === false && user.status !== 'pending' && (
              <Chip size="sm" variant="soft" color="warning" className="text-xs">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                <Chip.Label>{t('members.onboarding_incomplete')}</Chip.Label>
              </Chip>
            )}
          </div>
        ),
      },
      {
        key: 'role',
        sortable: true,
        hideBelow: '2xl',
        label: t('members.col_role'),
        render: (user: AdminUser) => (
          <Chip
            size="sm"
            variant="tertiary"
            color={user.role === 'member' ? 'default' : 'accent'}
          >
            {t(`members.role_${user.role}`, { defaultValue: user.role })}
          </Chip>
        ),
      },
      {
        key: 'verified',
        label: t('members.col_verified'),
        render: (user: AdminUser) => (
          user.email_verified_at ? (
            <Chip size="sm" variant="tertiary" color="success">
              <MailCheck size={12} aria-hidden="true" />
              <Chip.Label>{t('members.email_verified')}</Chip.Label>
            </Chip>
          ) : (
            <Chip size="sm" variant="tertiary" color="warning">
              <MailX size={12} aria-hidden="true" />
              <Chip.Label>{t('members.email_unverified')}</Chip.Label>
            </Chip>
          )
        ),
      },
      {
        key: 'balance',
        sortable: true,
        label: t('members.col_balance'),
        render: (user: AdminUser) => (
          <div className="flex items-center gap-1.5">
            <Coins size={14} className="text-muted" aria-hidden="true" />
            <span className="text-sm font-medium tabular-nums">
              {typeof user.balance === 'number' ? user.balance.toLocaleString(getFormattingLocale()) : '0'}
            </span>
            <span className="text-xs text-muted">{t('members.hours_short')}</span>
          </div>
        ),
      },
      {
        key: 'last_active_at',
        hideBelow: '2xl',
        label: t('members.col_last_active'),
        render: (user: AdminUser) => (
          <Tooltip content={user.last_active_at ? formatServerDateTime(user.last_active_at) : t('members.time_never')}>
            <div className="flex items-center gap-1.5 text-sm tabular-nums text-muted">
              <Clock size={14} aria-hidden="true" />
              <span>{timeAgo(user.last_active_at)}</span>
            </div>
          </Tooltip>
        ),
      },
      {
        // Sorted on the server (see handleSortChange), so the whole
        // collection is ordered, not the visible page.
        key: 'created_at',
        sortable: true,
        hideBelow: '2xl',
        label: t('members.col_joined'),
        render: (user: AdminUser) => (
          <span className="text-sm tabular-nums text-muted">
            {formatServerDate(user.created_at)}
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        render: (user: AdminUser) => (
          <div className="flex items-center gap-1">
            {/* Approving a new member is a broker's daily job: a visible button,
                not only the last item of the menu. Same confirmation as the menu. */}
            {user.status === 'pending' && (
              <Button
                size="sm"
                color="success"
                variant="flat"
                startContent={<UserCheck size={14} aria-hidden="true" />}
                onPress={() => setConfirmAction({ type: 'approve', user })}
                aria-label={t('members.approve_named', { name: user.name })}
              >
                {t('members.approve')}
              </Button>
            )}
            {/* Quick note button */}
            <Tooltip content={t('members.notes')}>
              <Button
                isIconOnly
                variant="light"
                size="sm"
                onPress={() => openNotes(user)}
                aria-label={t('members.open_notes_for', { name: user.name })}
              >
                <StickyNote size={15} className="text-muted" />
              </Button>
            </Tooltip>

            {/* Context menu */}
            <Dropdown>
              <DropdownTrigger>
                <Button isIconOnly variant="light" size="sm" aria-label={t('members.col_actions')}>
                  <MoreVertical size={16} />
                </Button>
              </DropdownTrigger>
              <DropdownMenu aria-label={t('members.col_actions')}>
                <DropdownItem
                  key="details" id="details"
                  startContent={<IdCard size={14} />}
                  onPress={() => openMember(user.id)}
                >
                  {t('members.view_details')}
                </DropdownItem>
                <DropdownItem
                  key="view" id="view"
                  startContent={<ExternalLink size={14} />}
                  onPress={() => window.open(tenantPath(`/profile/${user.id}`), '_blank')}
                >
                  {t('members.view_profile')}
                </DropdownItem>
                <DropdownItem
                  key="message" id="message"
                  startContent={<Send size={14} />}
                  onPress={() => window.open(tenantPath(`/messages?to=${user.id}`), '_blank')}
                >
                  {t('members.send_message')}
                </DropdownItem>
                <DropdownItem
                  key="notes" id="notes"
                  startContent={<StickyNote size={14} />}
                  onPress={() => openNotes(user)}
                >
                  {t('members.notes')}
                </DropdownItem>
                <DropdownItem
                  key="vetting" id="vetting"
                  startContent={<ShieldCheck size={14} />}
                  onPress={() => navigate(tenantPath(`/broker/vetting?user_id=${user.id}`))}
                >
                  {t('members.check_vetting')}
                </DropdownItem>
                {/* Status-action item is omitted entirely for banned members
                    (broker can't unban — that's an admin-only action). For
                    other statuses we render an action that maps to the
                    appropriate state transition. */}
                {user.status !== 'banned' ? (
                  <DropdownItem
                    key="status-action" id="status-action"
                    startContent={
                      user.status === 'pending' ? <UserCheck size={14} /> :
                      user.status === 'active' ? <UserX size={14} /> :
                      <RotateCcw size={14} />
                    }
                    color={user.status === 'active' ? 'danger' : user.status === 'pending' ? 'success' : 'default'}
                    className={user.status === 'active' ? 'text-danger' : user.status === 'pending' ? 'text-success' : ''}
                    onPress={() => {
                      if (user.status === 'pending') setConfirmAction({ type: 'approve', user });
                      else if (user.status === 'active') setConfirmAction({ type: 'suspend', user });
                      else if (user.status === 'suspended') handleReactivate(user);
                    }}
                  >
                    {user.status === 'pending' ? t('members.approve') :
                     user.status === 'active' ? t('members.suspend') :
                     t('members.reactivate')}
                  </DropdownItem>
                ) : null}
              </DropdownMenu>
            </Dropdown>
          </div>
        ),
      },
    ],
    [t, tenantPath, navigate, timeAgo, handleReactivate, openNotes, openMember],
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const emptyDef = EMPTY_BY_TAB[activeTab];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_members', articleId: 'broker_members_list' }}
      title={t('members.title')}
      description={t('members.description')}
      icon={Users}
      color="accent"
      actions={
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download size={16} />}
            onPress={handleExport}
            isLoading={csvExport.exporting}
            isDisabled={!initialLoaded}
          >
            {csvExport.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<RefreshCw size={16} />}
            onPress={refreshAll}
            isLoading={loading || statsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <Tabs
            aria-label={t('members.tabs_aria')}
            selectedKey={activeTab}
            onSelectionChange={handleTabChange}
            variant="underlined"
            size="sm"
          >
            <Tab
              key="all"
              title={
                <div className="flex items-center gap-2">
                  <Users size={14} aria-hidden="true" />
                  <span>{t('members.tab_all')}</span>
                </div>
              }
            />
            <Tab
              key="pending"
              title={
                <div className="flex items-center gap-2">
                  <Clock size={14} aria-hidden="true" />
                  <span>{t('members.tab_pending')}</span>
                  {typeof stats?.pending === 'number' && stats.pending > 0 && (
                    <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                      {stats.pending}
                    </Chip>
                  )}
                </div>
              }
            />
            <Tab
              key="active"
              title={
                <div className="flex items-center gap-2">
                  <UserCheck size={14} aria-hidden="true" />
                  <span>{t('members.tab_active')}</span>
                </div>
              }
            />
            <Tab
              key="suspended"
              title={
                <div className="flex items-center gap-2">
                  <UserX size={14} aria-hidden="true" />
                  <span>{t('members.tab_suspended')}</span>
                  {typeof stats?.suspended === 'number' && stats.suspended > 0 && (
                    <Chip size="sm" variant="soft" color="danger" className="tabular-nums">
                      {stats.suspended}
                    </Chip>
                  )}
                </div>
              }
            />
            <Tab
              key="never_logged_in"
              title={
                <div className="flex items-center gap-2">
                  <Moon size={14} aria-hidden="true" />
                  <span>{t('members.tab_never_logged_in')}</span>
                </div>
              }
            />
            <Tab
              key="onboarding_incomplete"
              title={
                <div className="flex items-center gap-2">
                  <Hourglass size={14} aria-hidden="true" />
                  <span>{t('members.tab_onboarding_incomplete')}</span>
                </div>
              }
            />
          </Tabs>
          {/* Role filter — the list endpoint already supports ?role=…, this just
              exposes it. Resets paging + selection like every other filter. */}
          <div className="ms-auto">
            <Select
              aria-label={t('members.filter_role_label')}
              size="sm"
              variant="bordered"
              selectedKeys={[roleFilter]}
              onSelectionChange={(keys) => {
                handleRoleChange((Array.from(keys)[0] as string) ?? 'all');
              }}
              className="w-[190px]"
            >
              {ROLE_FILTERS.map((r) => (
                <SelectItem key={r} id={r}>
                  {r === 'all'
                    ? t('members.filter_role_all')
                    : t(`members.role_${r}`, { defaultValue: r })}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
      }
    >
      {/* ── KPI header — counts come from the same list endpoint, deep-linked ── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('members.stat_total')}
          value={stats?.total ?? null}
          icon={Users}
          color="accent"
          loading={statsLoading}
          to={tenantPath('/broker/members')}
        />
        <BrokerStatCard
          label={t('members.stat_pending')}
          value={stats?.pending ?? null}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          to={tenantPath('/broker/members?status=pending')}
        />
        <BrokerStatCard
          label={t('members.stat_active')}
          value={stats?.active ?? null}
          icon={UserCheck}
          color="success"
          loading={statsLoading}
          to={tenantPath('/broker/members?status=active')}
        />
        <BrokerStatCard
          label={t('members.stat_suspended')}
          value={stats?.suspended ?? null}
          icon={UserX}
          color="danger"
          loading={statsLoading}
          to={tenantPath('/broker/members?status=suspended')}
        />
      </div>

      {/* ── Bulk-action bar ──────────────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2.5 shadow-sm shadow-black/[0.03]">
          <span className="text-sm font-medium tabular-nums text-foreground">
            {t('members.bulk_selected', { count: selectedIds.size })}
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            color="success"
            variant="flat"
            startContent={<UserCheck size={14} />}
            onPress={handleBulkApprove}
            isLoading={bulkLoading}
          >
            {t('members.bulk_approve')}
          </Button>
          <Button
            size="sm"
            color="danger"
            variant="flat"
            startContent={<UserX size={14} />}
            onPress={handleBulkSuspend}
            isLoading={bulkLoading}
          >
            {t('members.bulk_suspend')}
          </Button>
          <Button
            size="sm"
            variant="light"
            isIconOnly
            onPress={clearSelection}
            aria-label={t('members.bulk_clear')}
          >
            <X size={16} />
          </Button>
        </div>
      )}

      {/* ── Table — shaped skeleton on first load, in-table spinner after ────── */}
      {!initialLoaded ? (
        <BrokerSkeleton variant="table" count={8} />
      ) : (
        <DataTable<AdminUser>
          stickyActions
          mobileCards
          columns={columns}
          data={members}
          keyField="id"
          isLoading={loading}
          selectable
          selectedKeys={selectedIds}
          onSelectionChange={setSelectedIds}
          searchable
          searchPlaceholder={t('members.search_placeholder')}
          totalItems={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          searchValue={search}
          onSearch={handleSearch}
          onRefresh={refreshAll}
          onRowClick={(user) => openMember(user.id)}
          sortDescriptor={sort}
          onSortChange={handleSortChange}
          emptyContent={
            debouncedSearch.trim() ? (
              <BrokerEmptyState
                bare
                icon={SearchX}
                color="neutral"
                title={t('members.empty_search_title')}
                hint={t('members.empty_search_hint')}
              />
            ) : (
              <BrokerEmptyState
                bare
                icon={emptyDef.icon}
                color={emptyDef.color}
                title={t(emptyDef.titleKey)}
                hint={t(emptyDef.hintKey)}
              />
            )
          }
        />
      )}

      {/* Approve confirmation */}
      <ConfirmModal
        isOpen={confirmAction?.type === 'approve'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleApprove}
        title={t('members.confirm_approve_title')}
        message={t('members.confirm_approve_message')}
        confirmLabel={t('members.approve')}
        cancelLabel={t('common.cancel')}
        confirmColor="primary"
        isLoading={actionLoading}
      />

      {/* Suspend confirmation */}
      <ConfirmModal
        isOpen={confirmAction?.type === 'suspend'}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleSuspend}
        title={t('members.confirm_suspend_title')}
        message={t('members.confirm_suspend_message')}
        confirmLabel={t('members.suspend')}
        cancelLabel={t('common.cancel')}
        confirmColor="danger"
        isLoading={actionLoading}
      />

      {/* Notes Modal */}
      <Modal
        isOpen={!!notesUser}
        onClose={() => setNotesUser(null)}
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          {notesUser && (
            <>
              <ModalHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
                <Avatar
                  src={resolveAvatarUrl(notesUser.avatar_url || notesUser.avatar) || undefined}
                  name={notesUser.name}
                  size="sm"
                  className="row-span-2"
                />
                <ModalHeading className="text-base font-semibold">
                  {t('members.notes_for', { name: notesUser.name })}
                </ModalHeading>
                <p className="text-xs text-muted font-normal">{notesUser.email}</p>
              </ModalHeader>
              <ModalBody>
                <MemberNotesPanel key={notesUser.id} state={notesState} />
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={() => setNotesUser(null)}>
                  {t('members.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

    </BrokerPageShell>
  );
}
