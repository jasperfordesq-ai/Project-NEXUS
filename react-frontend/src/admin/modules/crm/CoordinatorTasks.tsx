// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Coordinator Tasks
 * Admin CRM page for the follow-ups and actions coordinators track: create,
 * edit, quick-complete, change status, delete, and a CSV export. The filters
 * live in the address (?status=&priority=&assigned_to=&q=&page=) so a reload,
 * the back button or a shared link keeps them. The default view is what still
 * needs doing (status=open); the CRM dashboard links here with status=overdue.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import ClipboardList from 'lucide-react/icons/clipboard-list';
import Plus from 'lucide-react/icons/plus';
import Calendar from 'lucide-react/icons/calendar';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import CircleX from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Trash2 from 'lucide-react/icons/trash-2';
import Edit3 from 'lucide-react/icons/pen-line';
import User from 'lucide-react/icons/user';
import Search from 'lucide-react/icons/search';
import Check from 'lucide-react/icons/check';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Download from 'lucide-react/icons/download';

import { getFormattingLocale } from '@/lib/helpers';
import {
  Card, CardBody, Button, Input, Textarea, Chip, Spinner, Select, SelectItem,
  useDisclosure, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Pagination, Tooltip,
  ToggleButtonGroup, ToggleButton,
} from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

interface Task {
  id: number;
  tenant_id: number;
  assigned_to: number;
  user_id: number | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
  assigned_to_name: string;
  created_by_name: string;
  user_name: string | null;
  user_avatar: string | null;
}

interface AdminMember {
  id: number;
  name: string;
  email: string;
  avatar_url: string;
  role: string;
}

interface TasksMeta {
  total: number;
  pages: number;
}

// 'open' (pending + in progress) and 'overdue' are views the API understands
// on top of the four stored statuses. The page opens on 'open'.
type StatusFilter = 'open' | 'overdue' | TaskStatus | 'all';
const STATUS_FILTERS: readonly StatusFilter[] = ['open', 'overdue', 'pending', 'in_progress', 'completed', 'cancelled', 'all'];
const DEFAULT_STATUS: StatusFilter = 'open';
const isStatusFilter = (value: string | null | undefined): value is StatusFilter =>
  typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value);

const PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
const isPriority = (value: string | null | undefined): value is TaskPriority =>
  typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);

type ChipLook = { color: 'default' | 'accent' | 'warning' | 'success' | 'danger'; variant: 'soft' | 'secondary' };

// The neutral soft chip is near-invisible on a white card, so the uncoloured
// values are outlined ('secondary') instead; the theme has no numbered shades.
const PRIORITY_LOOK: Record<TaskPriority, ChipLook> = {
  low: { color: 'default', variant: 'secondary' },
  medium: { color: 'accent', variant: 'soft' },
  high: { color: 'warning', variant: 'soft' },
  urgent: { color: 'danger', variant: 'soft' },
};

const STATUS_LOOK: Record<TaskStatus, ChipLook> = {
  pending: { color: 'default', variant: 'secondary' },
  in_progress: { color: 'accent', variant: 'soft' },
  completed: { color: 'success', variant: 'soft' },
  cancelled: { color: 'default', variant: 'secondary' },
};

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

const isOpen = (status: TaskStatus) => status === 'pending' || status === 'in_progress';

// due_date is a date without a time. Parsing it with `new Date('YYYY-MM-DD')`
// gives UTC midnight, which displays as the previous day west of Greenwich,
// so it is parsed as a local calendar date instead.
const parseDateOnly = (value: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
};

const localDateKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const dueState = (task: Task, todayKey: string): 'overdue' | 'today' | null => {
  if (!task.due_date || !isOpen(task.status)) return null;
  const key = task.due_date.slice(0, 10);
  if (key < todayKey) return 'overdue';
  if (key === todayKey) return 'today';
  return null;
};

const formatDate = (dateStr: string): string =>
  parseDateOnly(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
  });

const formatDateTime = (dateStr: string): string =>
  new Date(dateStr).toLocaleString(getFormattingLocale(), {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

export default function CoordinatorTasks() {
  const { t } = useTranslation('admin_crm');
  const { t: tNav } = useTranslation('admin_nav');
  const { t: tCommon } = useTranslation('common');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const currentUserId = user?.id ? String(user.id) : '';
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- Filters: the address is the source of truth -----
  const rawStatus = searchParams.get('status');
  const statusFilter: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : DEFAULT_STATUS;
  const rawPriority = searchParams.get('priority');
  const priorityFilter: TaskPriority | '' = isPriority(rawPriority) ? rawPriority : '';
  const assignedFilter = (searchParams.get('assigned_to') || '').replace(/\D/g, '');
  const searchQuery = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const hasFilters = statusFilter !== DEFAULT_STATUS || Boolean(priorityFilter || assignedFilter || searchQuery);

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Every filter change starts from page 1 again.
  const setFilter = useCallback((changes: Record<string, string | null>) => {
    updateParams({ ...changes, page: null });
  }, [updateParams]);

  // The search box is typed into freely and only reaches the address (and the
  // server) after a short pause, instead of one request per keystroke.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSearchInput(searchQuery); }, [searchQuery]);
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      setFilter({ q: trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : null });
    }, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // ----- List state -----
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meta, setMeta] = useState<TasksMeta>({ total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const todayKey = localDateKey(new Date());

  // ----- Form modal state -----
  const formModal = useDisclosure();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<TaskPriority>('medium');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formMember, setFormMember] = useState<MemberSearchMember | null>(null);
  const [formDueDate, setFormDueDate] = useState('');

  // ----- Delete state -----
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ----- Data loading -----

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: ITEMS_PER_PAGE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (assignedFilter) params.assigned_to = Number(assignedFilter);
      if (searchQuery.length >= MIN_SEARCH_LENGTH) params.search = searchQuery;

      const res = await adminCrm.getTasks(params);
      if (res.success) {
        setTasks(Array.isArray(res.data) ? res.data as Task[] : []);
        setMeta({ total: res.meta?.total || 0, pages: res.meta?.total_pages || 1 });
      }
    } catch {
      toast.error(t('crm.failed_to_load_tasks'));
      setTasks([]);
    }
    setLoading(false);
  }, [page, statusFilter, priorityFilter, assignedFilter, searchQuery, t, toast]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  useEffect(() => {
    let cancelled = false;
    adminCrm.getAdmins()
      .then((res) => {
        if (!cancelled && res.success && Array.isArray(res.data)) setAdmins(res.data as unknown as AdminMember[]);
      })
      .catch(() => { /* the assignee lists stay empty */ });
    return () => { cancelled = true; };
  }, []);

  // ----- Form helpers -----

  const openCreateModal = () => {
    setEditingTask(null);
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    // The API assigns a task with no assignee to the admin creating it, so
    // show that choice instead of an empty select. A filter on a colleague
    // is a strong hint the new task is for them.
    setFormAssignedTo(assignedFilter || currentUserId);
    setFormUserId('');
    setFormMember(null);
    setFormDueDate('');
    formModal.onOpen();
  };

  const openEditModal = (task: Task) => {
    setEditingTask(task);
    setFormTitle(task.title);
    setFormDescription(task.description || '');
    setFormPriority(task.priority);
    setFormAssignedTo(String(task.assigned_to));
    setFormUserId(task.user_id ? String(task.user_id) : '');
    setFormMember(task.user_id && task.user_name ? {
      id: task.user_id,
      name: task.user_name,
      email: '',
      avatar_url: task.user_avatar,
    } : null);
    setFormDueDate(task.due_date ? task.due_date.slice(0, 10) : '');
    formModal.onOpen();
  };

  const handleSave = async () => {
    if (!formTitle.trim()) {
      toast.error(t('crm.title_is_required'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        priority: formPriority,
        assigned_to: formAssignedTo ? Number(formAssignedTo) : undefined,
        // When editing, send null explicitly so the backend clears the field.
        user_id: formUserId ? Number(formUserId) : (editingTask ? null : undefined),
        due_date: formDueDate || (editingTask ? null : undefined),
      };

      const res = editingTask
        ? await adminCrm.updateTask(editingTask.id, payload as Parameters<typeof adminCrm.updateTask>[1])
        : await adminCrm.createTask(payload as Parameters<typeof adminCrm.createTask>[0]);

      if (res.success) {
        toast.success(editingTask ? t('crm.task_updated') : t('crm.task_created'));
        formModal.onClose();
        await loadTasks();
      } else {
        toast.error(editingTask ? t('crm.failed_to_update_task') : t('crm.failed_to_create_task'));
      }
    } catch {
      toast.error(editingTask ? t('crm.failed_to_update_task') : t('crm.failed_to_create_task'));
    }
    setSaving(false);
  };

  // ----- Status changes -----

  const handleStatusChange = async (task: Task, status: TaskStatus) => {
    try {
      const res = await adminCrm.updateTask(task.id, { status });
      if (res.success) {
        toast.success(t('crm.task_status_changed'));
        await loadTasks();
      } else {
        toast.error(t('crm.failed_to_update_task_status'));
      }
    } catch {
      toast.error(t('crm.failed_to_update_task_status'));
    }
  };

  const handleQuickComplete = (task: Task) =>
    handleStatusChange(task, task.status === 'completed' ? 'pending' : 'completed');

  // ----- Delete -----

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminCrm.deleteTask(deleteTarget.id);
      if (res.success) {
        toast.success(t('crm.task_deleted'));
        setDeleteTarget(null);
        await loadTasks();
      } else {
        toast.error(t('crm.failed_to_delete_task'));
      }
    } catch {
      toast.error(t('crm.failed_to_delete_task'));
    }
    setDeleting(false);
  };

  // ----- Export -----

  const handleExport = async () => {
    setExporting(true);
    try {
      await adminCrm.exportTasks();
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(tCommon('errors.download_failed'));
    } finally {
      setExporting(false);
    }
  };

  // ----- Labels -----

  const statusLabel = (status: TaskStatus) => t(`crm.status_${status}`);
  const priorityLabel = (priority: TaskPriority) => t(`crm.priority_${priority}`);
  // An admin account with no display name is shown by its email so the
  // option never reads as just "(Administrator)".
  const adminLabel = (admin: AdminMember) => {
    const name = admin.name?.trim() || admin.email;
    return String(admin.id) === currentUserId
      ? t('crm.assigned_to_you', { name })
      : `${name} (${t(`crm.admin_roles.${admin.role}`, { defaultValue: t('crm.admin_roles.unknown') })})`;
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilter({ status: null, priority: null, assigned_to: null, q: null });
  };

  const statusSelection = useMemo(() => new Set<Key>([statusFilter]), [statusFilter]);

  const summary = !hasFilters
    ? t('crm.tasks_summary_open', { count: meta.total })
    : statusFilter === 'all' && !priorityFilter && !assignedFilter && !searchQuery
      ? t('crm.tasks_summary', { count: meta.total })
      : t('crm.tasks_summary_filtered', { count: meta.total });

  // ----- Render -----

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t('crm.coordinator_tasks_title')}
        description={t('crm.coordinator_tasks_desc')}
        icon={<ClipboardList size={20} />}
        actions={
          <>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={handleExport}
              isLoading={exporting}
              isDisabled={exporting}
            >
              {t('crm.export_tasks')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreateModal}>
              {t('crm.create_task')}
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4">
        <ToggleButtonGroup
          aria-label={t('crm.label_status')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={statusSelection}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            const next = key == null ? '' : String(key);
            setFilter({ status: isStatusFilter(next) && next !== DEFAULT_STATUS ? next : null });
          }}
          className="flex flex-wrap justify-start gap-2"
        >
          {STATUS_FILTERS.map((key) => (
            <ToggleButton key={key} id={key}>{t(`crm.status_${key}`)}</ToggleButton>
          ))}
        </ToggleButtonGroup>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Input type="search" name="admin-search" autoComplete="off"
            label={t('crm.label_search')}
            placeholder={t('crm.placeholder_search_tasks')}
            className="w-full sm:max-w-[280px]"
            size="sm"
            startContent={<Search size={14} />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable
            onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
          />

          <Select
            size="sm"
            label={t('crm.label_priority')}
            className="w-full sm:max-w-[180px]"
            selectedKeys={[priorityFilter || 'all']}
            onChange={(e) => setFilter({ priority: isPriority(e.target.value) ? e.target.value : null })}
          >
            <SelectItem key="all" id="all">{t('crm.priority_all')}</SelectItem>
            {PRIORITIES.map((key) => (
              <SelectItem key={key} id={key}>{priorityLabel(key)}</SelectItem>
            ))}
          </Select>

          <Select
            size="sm"
            label={t('crm.label_assigned_to')}
            className="w-full sm:max-w-[260px]"
            selectedKeys={[assignedFilter || 'all']}
            onChange={(e) => setFilter({ assigned_to: e.target.value && e.target.value !== 'all' ? e.target.value : null })}
          >
            <SelectItem key="all" id="all">{t('crm.assigned_to_anyone')}</SelectItem>
            {admins.map((admin) => (
              <SelectItem key={String(admin.id)} id={String(admin.id)}>{adminLabel(admin)}</SelectItem>
            ))}
          </Select>

          {hasFilters && (
            <Button size="sm" variant="tertiary" onPress={clearFilters} className="self-start sm:self-end">
              {t('crm.clear_filters')}
            </Button>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" label={t('crm.loading_tasks')} />
        </div>
      ) : tasks.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={ClipboardList}
            title={t('crm.no_tasks_found')}
            description={t('crm.no_tasks_hint_filtered')}
            actionLabel={t('crm.clear_filters')}
            onAction={clearFilters}
          />
        ) : (
          <EmptyState
            icon={CheckCircle}
            title={t('crm.no_open_tasks')}
            description={t('crm.no_open_tasks_hint')}
            actionLabel={t('crm.create_task')}
            onAction={openCreateModal}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted" aria-live="polite">{summary}</p>

          {tasks.map((task) => {
            const due = dueState(task, todayKey);
            const completed = task.status === 'completed';
            const cancelled = task.status === 'cancelled';
            const priorityLook = PRIORITY_LOOK[task.priority] ?? PRIORITY_LOOK.medium;
            const statusLook = STATUS_LOOK[task.status] ?? STATUS_LOOK.pending;
            const assignedToMe = String(task.assigned_to) === currentUserId;

            return (
              <Card
                key={task.id}
                className={`border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${
                  due === 'overdue' ? 'border-l-4 border-l-danger' : ''
                } ${completed || cancelled ? 'opacity-75' : ''}`}
              >
                <CardBody className="p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    {/* Quick complete toggle. This was a 16px HeroUI checkbox
                        whose white control vanished against the white card. */}
                    <Tooltip
                      content={completed ? t('crm.action_reopen_task') : t('crm.action_mark_complete')}
                      delay={300}
                    >
                      <Button
                        isIconOnly
                        size="sm"
                        variant="outline"
                        aria-pressed={completed}
                        aria-label={t('crm.mark_task_as_status', {
                          title: task.title,
                          status: statusLabel(completed ? 'pending' : 'completed'),
                        })}
                        onPress={() => handleQuickComplete(task)}
                        className={`mt-0.5 shrink-0 rounded-full border-2 ${
                          completed
                            ? 'border-success bg-success text-white'
                            : 'border-muted text-muted hover:border-success hover:text-success'
                        }`}
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h3
                            className={`font-semibold text-foreground [overflow-wrap:anywhere] ${
                              completed ? 'line-through text-muted' : cancelled ? 'text-muted' : ''
                            }`}
                          >
                            {task.title}
                          </h3>
                          {task.description && (
                            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">
                              {task.description}
                            </p>
                          )}
                        </div>

                        <Dropdown>
                          <DropdownTrigger>
                            <Button isIconOnly size="sm" variant="tertiary" className="-mr-2 -mt-1 shrink-0" aria-label={t('crm.label_task_actions')}>
                              <MoreVertical size={16} />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu
                            aria-label={t('crm.label_task_actions')}
                            onAction={(key) => {
                              if (key === 'edit') openEditModal(task);
                              else if (key === 'complete') handleStatusChange(task, 'completed');
                              else if (key === 'reopen') handleStatusChange(task, 'pending');
                              else if (key === 'in_progress') handleStatusChange(task, 'in_progress');
                              else if (key === 'cancel') handleStatusChange(task, 'cancelled');
                              else if (key === 'delete') setDeleteTarget(task);
                            }}
                          >
                            <DropdownItem key="edit" id="edit" startContent={<Edit3 size={14} />}>
                              {t('crm.action_edit')}
                            </DropdownItem>
                            {completed ? (
                              <DropdownItem key="reopen" id="reopen" startContent={<RotateCcw size={14} />}>
                                {t('crm.action_reopen_task')}
                              </DropdownItem>
                            ) : (
                              <DropdownItem key="complete" id="complete" startContent={<CheckCircle size={14} />}>
                                {t('crm.action_mark_complete')}
                              </DropdownItem>
                            )}
                            {task.status !== 'in_progress' && !completed ? (
                              <DropdownItem key="in_progress" id="in_progress" startContent={<Clock size={14} />}>
                                {t('crm.action_mark_in_progress')}
                              </DropdownItem>
                            ) : null}
                            {isOpen(task.status) ? (
                              <DropdownItem key="cancel" id="cancel" startContent={<CircleX size={14} />}>
                                {t('crm.action_cancel_task')}
                              </DropdownItem>
                            ) : null}
                            <DropdownItem
                              key="delete" id="delete"
                              startContent={<Trash2 size={14} />}
                              className="text-danger"
                              variant="danger"
                            >
                              {t('crm.action_delete')}
                            </DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      {/* Priority, status, due date, assignee */}
                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Chip size="sm" color={priorityLook.color} variant={priorityLook.variant}>
                            {priorityLabel(task.priority)}
                          </Chip>
                          <Chip size="sm" color={statusLook.color} variant={statusLook.variant}>
                            {statusLabel(task.status)}
                          </Chip>
                          {due === 'overdue' && (
                            <Chip size="sm" color="danger" variant="soft" startContent={<AlertTriangle size={12} aria-hidden="true" />}>
                              {t('crm.status_overdue')}
                            </Chip>
                          )}
                        </div>

                        {task.due_date && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${
                              due === 'overdue' ? 'font-semibold text-danger' : due === 'today' ? 'font-semibold text-warning' : 'text-muted'
                            }`}
                          >
                            <Calendar size={12} aria-hidden="true" />
                            <time dateTime={task.due_date.slice(0, 10)}>
                              {due === 'today' ? t('crm.due_today') : t('crm.task_due_on', { date: formatDate(task.due_date) })}
                            </time>
                          </span>
                        )}

                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <User size={12} aria-hidden="true" />
                          {assignedToMe ? t('crm.task_assigned_to_you') : t('crm.task_assigned_to_name', { name: task.assigned_to_name })}
                        </span>
                      </div>

                      {/* Related member, author, dates */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        {task.user_id && task.user_name && (
                          <>
                            <Link
                              to={tenantPath(`/admin/users/${task.user_id}/edit`)}
                              className="inline-flex min-w-0 items-center gap-1.5 transition-colors hover:text-accent"
                            >
                              <Avatar
                                src={task.user_avatar || undefined}
                                name={task.user_name}
                                size="sm"
                                className="h-5 w-5 shrink-0"
                              />
                              <span className="truncate">{t('crm.task_about_member', { name: task.user_name })}</span>
                            </Link>
                            <span aria-hidden="true">·</span>
                          </>
                        )}
                        <span>{t('crm.task_created_by', { name: task.created_by_name })}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={task.created_at}>{formatDateTime(task.created_at)}</time>
                        {completed && task.completed_at && (
                          <>
                            <span aria-hidden="true">·</span>
                            <time dateTime={task.completed_at}>
                              {t('crm.task_completed_on', { date: formatDateTime(task.completed_at) })}
                            </time>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}

          {meta.pages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination
                total={meta.pages}
                page={page}
                onChange={(next) => updateParams({ page: next > 1 ? String(next) : null })}
                showControls
              />
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={formModal.isOpen} onOpenChange={formModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <ClipboardList size={20} />
                {editingTask ? t('crm.edit_task_title') : t('crm.create_task_title')}
              </ModalHeader>
              <ModalBody className="gap-5">
                <p className="text-sm text-muted">{t('crm.task_form_intro')}</p>
                <Input
                  label={t('crm.label_title')}
                  placeholder={t('crm.placeholder_enter_task_title')}
                  value={formTitle}
                  onValueChange={setFormTitle}
                  isRequired
                  autoFocus
                />
                <Textarea
                  label={t('crm.label_description')}
                  placeholder={t('crm.placeholder_optional_description_or_notes')}
                  value={formDescription}
                  onValueChange={setFormDescription}
                  minRows={3}
                  maxRows={8}
                />
                <MemberSearchPicker
                  label={t('crm.label_task_member')}
                  description={t('crm.task_member_help')}
                  placeholder={t('crm.placeholder_type_name_or_email')}
                  noResultsText={t('crm.no_members_found')}
                  clearText={t('crm.clear')}
                  value={formUserId}
                  selectedMember={formMember}
                  onSelectedMemberChange={setFormMember}
                  onValueChange={setFormUserId}
                  size="md"
                />
                <Select
                  label={t('crm.label_assign_to')}
                  description={t('crm.assign_to_help')}
                  selectedKeys={formAssignedTo ? [formAssignedTo] : []}
                  onChange={(e) => setFormAssignedTo(e.target.value)}
                >
                  {admins.map((admin) => (
                    <SelectItem key={String(admin.id)} id={String(admin.id)}>{adminLabel(admin)}</SelectItem>
                  ))}
                </Select>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Select
                    label={t('crm.label_priority')}
                    selectedKeys={[formPriority]}
                    onChange={(e) => setFormPriority(isPriority(e.target.value) ? e.target.value : 'medium')}
                  >
                    {PRIORITIES.map((key) => (
                      <SelectItem key={key} id={key}>{priorityLabel(key)}</SelectItem>
                    ))}
                  </Select>
                  <Input
                    label={t('crm.label_due_date')}
                    type="date"
                    value={formDueDate}
                    onValueChange={setFormDueDate}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={saving}>
                  {t('crm.action_cancel')}
                </Button>
                <Button onPress={handleSave} isLoading={saving} isDisabled={saving}>
                  {editingTask ? t('crm.update_task') : t('crm.create_task')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('crm.delete_task_title')}
        message={t('crm.delete_task_confirm_named', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('crm.action_delete')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}
