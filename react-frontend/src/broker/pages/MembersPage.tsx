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
import { useSearchParams } from 'react-router-dom';
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
import Pin from 'lucide-react/icons/pin';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Check from 'lucide-react/icons/check';
import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Moon from 'lucide-react/icons/moon';
import Hourglass from 'lucide-react/icons/hourglass';
import Sparkles from 'lucide-react/icons/sparkles';
import SearchX from 'lucide-react/icons/search-x';
import BadgeCheck from 'lucide-react/icons/badge-check';
import MemberDetailModal from '@/broker/components/MemberDetailModal';
import { usePageTitle } from '@/hooks';
import { useToast,
  useTenant } from '@/contexts';
import { adminUsers,
  adminCrm } from '@/admin/api/adminApi';
import type { AdminUser } from '@/admin/api/types';
import { DataTable,
  ConfirmModal } from '@/admin/components';
import type { Column } from '@/admin/components';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { parseServerTimestamp,
  formatServerDate,
  formatServerDateTime } from '@/lib/serverTime';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Textarea, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, Avatar, Tabs, Tab, Tooltip, Select, SelectItem } from '@/components/ui';
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

interface MemberNote {
  id: number;
  content: string;
  category?: string;
  is_pinned?: boolean;
  created_at: string;
  author_name?: string;
  author?: { name: string };
}

/** KPI counts derived from the list endpoint (meta.total with limit=1). */
interface MemberStats {
  total: number | null;
  pending: number | null;
  active: number | null;
  suspended: number | null;
}

const PAGE_SIZE = 20;

// CRM note categories — mirrors the admin MemberNotes module.
const NOTE_CATEGORIES = ['general', 'outreach', 'support', 'onboarding', 'concern', 'follow_up'] as const;

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
  const { tenantPath } = useTenant();
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

  // Filter / pagination state — the status tab lives in the URL (?status=…)
  // so dashboard tiles and stat cards can deep-link into a filtered view.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') ?? 'all';
  const activeTab: StatusTab = (VALID_TABS.has(statusParam) ? statusParam : 'all') as StatusTab;

  const [search, setSearch] = useState('');
  // Debounce search so typing doesn't fire a network request on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handle);
  }, [search]);
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<string>('all');

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

  // Member detail modal state (holds the id of the member being viewed).
  const [detailUserId, setDetailUserId] = useState<number | null>(null);

  // Notes drawer state
  const [notesUser, setNotesUser] = useState<AdminUser | null>(null);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [noteCategory, setNoteCategory] = useState('general');
  const [addingNote, setAddingNote] = useState(false);
  // Inline note editing
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [editingContent, setEditingContent] = useState('');
  const [editingCategory, setEditingCategory] = useState('general');
  const [savingNote, setSavingNote] = useState(false);
  const [noteBusyId, setNoteBusyId] = useState<number | null>(null);

  // ─── Fetch members ────────────────────────────────────────────────────────

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        limit: PAGE_SIZE,
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
  }, [page, activeTab, roleFilter, debouncedSearch]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
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
    fetchMembers();
    loadStats();
  }, [fetchMembers, loadStats]);

  // ─── Notes ────────────────────────────────────────────────────────────────

  const openNotes = useCallback(async (user: AdminUser) => {
    setNotesUser(user);
    setNotesLoading(true);
    setNotes([]);
    setNewNote('');
    try {
      const res = await adminCrm.getNotes({ user_id: user.id, limit: 20 });
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setNotes(payload as MemberNote[]);
        } else if (payload && typeof payload === 'object') {
          const paged = payload as { data: MemberNote[] };
          setNotes(paged.data || []);
        }
      }
    } catch {
      // silently fail
    } finally {
      setNotesLoading(false);
    }
  }, []);

  const handleAddNote = useCallback(async () => {
    if (!notesUser || !newNote.trim()) return;
    setAddingNote(true);
    try {
      const res = await adminCrm.createNote({
        user_id: notesUser.id,
        content: newNote.trim(),
        category: noteCategory,
      });
      if (res.success) {
        toast.success(t('members.note_added'));
        setNewNote('');
        setNoteCategory('general');
        // Refresh notes
        openNotes(notesUser);
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setAddingNote(false);
    }
  }, [notesUser, newNote, noteCategory, toast, t, openNotes]);

  const startEditNote = useCallback((note: MemberNote) => {
    setEditingNoteId(note.id);
    setEditingContent(note.content);
    setEditingCategory(note.category || 'general');
  }, []);

  const cancelEditNote = useCallback(() => {
    setEditingNoteId(null);
    setEditingContent('');
  }, []);

  const handleUpdateNote = useCallback(async () => {
    if (editingNoteId == null || !editingContent.trim() || !notesUser) return;
    setSavingNote(true);
    try {
      const res = await adminCrm.updateNote(editingNoteId, {
        content: editingContent.trim(),
        category: editingCategory,
      });
      if (res.success) {
        toast.success(t('members.note_updated'));
        setEditingNoteId(null);
        openNotes(notesUser);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setSavingNote(false);
    }
  }, [editingNoteId, editingContent, editingCategory, notesUser, toast, t, openNotes]);

  const handleDeleteNote = useCallback(async (noteId: number) => {
    if (!notesUser) return;
    setNoteBusyId(noteId);
    try {
      const res = await adminCrm.deleteNote(noteId);
      if (res.success) {
        toast.success(t('members.note_deleted'));
        openNotes(notesUser);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setNoteBusyId(null);
    }
  }, [notesUser, toast, t, openNotes]);

  const handleTogglePin = useCallback(async (note: MemberNote) => {
    if (!notesUser) return;
    setNoteBusyId(note.id);
    try {
      const res = await adminCrm.updateNote(note.id, { is_pinned: !note.is_pinned });
      if (res.success) {
        openNotes(notesUser);
      } else {
        toast.error(t('members.action_failed'));
      }
    } catch {
      toast.error(t('members.action_failed'));
    } finally {
      setNoteBusyId(null);
    }
  }, [notesUser, toast, t, openNotes]);

  // ─── Tab change / search ──────────────────────────────────────────────────

  const handleTabChange = useCallback((key: React.Key) => {
    const next = String(key);
    setPage(1);
    setSelectedIds(new Set());
    // Deep-linkable filter: ?status=<tab>, omitted for the default tab.
    setSearchParams(next === 'all' ? {} : { status: next }, { replace: true });
  }, [setSearchParams]);

  const handleSearch = useCallback((query: string) => {
    setSearch(query);
    setPage(1);
    setSelectedIds(new Set());
  }, []);

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

  const handleBulkApprove = useCallback(
    () => runBulk((ids) => adminUsers.bulkApprove(ids), 'members.bulk_approved_success'),
    [runBulk],
  );
  const handleBulkSuspend = useCallback(
    () => runBulk((ids) => adminUsers.bulkSuspend(ids), 'members.bulk_suspended_success'),
    [runBulk],
  );

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
    [reactivatingId, toast, t, refreshAll],
  );

  // ─── Columns ──────────────────────────────────────────────────────────────

  const columns: Column<AdminUser>[] = useMemo(
    () => [
      {
        key: 'member',
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
                <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
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
        key: 'created_at',
        label: t('members.col_joined'),
        sortable: true,
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
                  onPress={() => setDetailUserId(user.id)}
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
                  onPress={() => window.open(tenantPath(`/broker/vetting?user_id=${user.id}`), '_self')}
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
    [t, tenantPath, timeAgo, handleReactivate, openNotes],
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
        <Button
          variant="tertiary"
          size="sm"
          startContent={<RefreshCw size={16} />}
          onPress={refreshAll}
          isLoading={loading || statsLoading}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      {/* ── KPI header — counts come from the same list endpoint, deep-linked ── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {/* ── Status tabs — deep-linkable (?status=…) — plus role filter ───────── */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
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
              const next = (Array.from(keys)[0] as string) ?? 'all';
              setRoleFilter(next);
              setPage(1);
              setSelectedIds(new Set());
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
          onSearch={handleSearch}
          onRefresh={refreshAll}
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
                {/* Add note */}
                <div className="space-y-2">
                  <Select
                    aria-label={t('members.note_category_label')}
                    size="sm"
                    variant="bordered"
                    selectedKeys={[noteCategory]}
                    onSelectionChange={(keys) => setNoteCategory((Array.from(keys)[0] as string) ?? 'general')}
                    className="max-w-[220px]"
                  >
                    {NOTE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} id={cat}>{t(`members.note_category_${cat}`)}</SelectItem>
                    ))}
                  </Select>
                  <div className="flex gap-2">
                    <Textarea
                      placeholder={t('members.note_placeholder')}
                      value={newNote}
                      onValueChange={setNewNote}
                      minRows={2}
                      maxRows={4}
                      className="flex-1"
                    />
                    <Button
                      color="primary"
                      isIconOnly
                      isLoading={addingNote}
                      isDisabled={!newNote.trim()}
                      onPress={handleAddNote}
                      className="self-end"
                      aria-label={t('members.send_note')}
                    >
                      <Send size={16} />
                    </Button>
                  </div>
                </div>

                {/* Notes list — pinned first */}
                {notesLoading ? (
                  <div className="py-8 text-center text-muted">{t('common.loading')}</div>
                ) : notes.length === 0 ? (
                  <BrokerEmptyState
                    bare
                    icon={StickyNote}
                    color="neutral"
                    title={t('members.no_notes')}
                  />
                ) : (
                  <div className="space-y-3 mt-2">
                    {[...notes].sort((a, b) => Number(b.is_pinned ?? false) - Number(a.is_pinned ?? false)).map((note) => (
                      <div key={note.id} className={`rounded-xl p-3 ${note.is_pinned ? 'border border-accent/20 bg-accent/10' : 'bg-surface-secondary'}`}>
                        {editingNoteId === note.id ? (
                          <div className="space-y-2">
                            <Select
                              aria-label={t('members.note_category_label')}
                              size="sm"
                              variant="bordered"
                              selectedKeys={[editingCategory]}
                              onSelectionChange={(keys) => setEditingCategory((Array.from(keys)[0] as string) ?? 'general')}
                              className="max-w-[220px]"
                            >
                              {NOTE_CATEGORIES.map((cat) => (
                                <SelectItem key={cat} id={cat}>{t(`members.note_category_${cat}`)}</SelectItem>
                              ))}
                            </Select>
                            <Textarea value={editingContent} onValueChange={setEditingContent} minRows={2} maxRows={5} variant="bordered" />
                            <div className="flex gap-2">
                              <Button size="sm" color="primary" isLoading={savingNote} isDisabled={!editingContent.trim()} startContent={<Check size={14} />} onPress={handleUpdateNote}>
                                {t('members.note_save')}
                              </Button>
                              <Button size="sm" variant="flat" isDisabled={savingNote} onPress={cancelEditNote}>
                                {t('common.cancel')}
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <p className="flex-1 whitespace-pre-wrap text-sm text-foreground">{note.content}</p>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <Tooltip content={note.is_pinned ? t('members.note_unpin') : t('members.note_pin')}>
                                  <Button isIconOnly size="sm" variant="light" isLoading={noteBusyId === note.id} onPress={() => handleTogglePin(note)} aria-label={note.is_pinned ? t('members.note_unpin') : t('members.note_pin')}>
                                    <Pin size={13} className={note.is_pinned ? 'fill-current text-accent' : 'text-muted'} />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t('members.note_edit')}>
                                  <Button isIconOnly size="sm" variant="light" onPress={() => startEditNote(note)} aria-label={t('members.note_edit')}>
                                    <Pencil size={13} className="text-muted" />
                                  </Button>
                                </Tooltip>
                                <Tooltip content={t('members.note_delete')}>
                                  <Button isIconOnly size="sm" variant="light" color="danger" isLoading={noteBusyId === note.id} onPress={() => handleDeleteNote(note.id)} aria-label={t('members.note_delete')}>
                                    <Trash2 size={13} />
                                  </Button>
                                </Tooltip>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span>{note.author_name || note.author?.name || t('members.note_system_author')}</span>
                              <span>&middot;</span>
                              <span className="tabular-nums">{formatServerDateTime(note.created_at)}</span>
                              {note.category && (
                                <Chip size="sm" variant="tertiary" className="text-xs">{t(`members.note_category_${note.category}`, { defaultValue: note.category })}</Chip>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={() => setNotesUser(null)}>
                  {t('common.cancel')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Member detail modal — operational actions, safe edits, compliance view */}
      <MemberDetailModal
        userId={detailUserId}
        onClose={() => setDetailUserId(null)}
        onChanged={refreshAll}
      />
    </BrokerPageShell>
  );
}
