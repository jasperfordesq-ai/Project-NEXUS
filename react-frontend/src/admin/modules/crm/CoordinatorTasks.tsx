import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Select, SelectItem, useDisclosure, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Spinner, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Pagination, Tooltip } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Coordinator Tasks
 * Task management interface for timebank coordinators to track follow-ups and actions.
 */

import { useState, useCallback, useEffect } from 'react';

import ClipboardList from 'lucide-react/icons/clipboard-list';
import Plus from 'lucide-react/icons/plus';
import Calendar from 'lucide-react/icons/calendar';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Trash2 from 'lucide-react/icons/trash-2';
import Edit3 from 'lucide-react/icons/pen-line';
import User from 'lucide-react/icons/user';
import Search from 'lucide-react/icons/search';
import Check from 'lucide-react/icons/check';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { Link } from 'react-router-dom';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useAuth,
  useTenant,
  useToast } from '@/contexts';
import { adminCrm } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

import { useTranslation } from 'react-i18next';
interface Task {
  id: number;
  tenant_id: number;
  assigned_to: number;
  user_id: number | null;
  title: string;
  description: string | null;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
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

type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed';
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'urgent';

const STATUS_TABS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'crm.status_all' },
  { key: 'pending', labelKey: 'crm.status_pending' },
  { key: 'in_progress', labelKey: 'crm.status_in_progress' },
  { key: 'completed', labelKey: 'crm.status_completed' },
];

const PRIORITY_OPTIONS: { key: PriorityFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'crm.priority_all' },
  { key: 'low', labelKey: 'crm.priority_low' },
  { key: 'medium', labelKey: 'crm.priority_medium' },
  { key: 'high', labelKey: 'crm.priority_high' },
  { key: 'urgent', labelKey: 'crm.priority_urgent' },
];

const PRIORITY_COLOR_MAP: Record<string, 'default' | 'primary' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  urgent: 'danger',
};

const STATUS_COLOR_MAP: Record<string, 'default' | 'primary' | 'success'> = {
  pending: 'default',
  in_progress: 'primary',
  completed: 'success',
  cancelled: 'default',
};

const ITEMS_PER_PAGE = 20;

function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate || status === 'completed' || status === 'cancelled') return false;
  return new Date(dueDate) < new Date();
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(getFormattingLocale(), {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function CoordinatorTasks() {
  const { t } = useTranslation('admin_crm');
  const { t: tNav } = useTranslation('admin_nav');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const currentUserId = user?.id ? String(user.id) : '';
  const toast = useToast();

  // State
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [adminsLoaded, setAdminsLoaded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal state
  const createModal = useDisclosure();
  const deleteModal = useDisclosure();
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [deletingTask, setDeletingTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formPriority, setFormPriority] = useState<string>('medium');
  const [formAssignedTo, setFormAssignedTo] = useState<string>('');
  const [formUserId, setFormUserId] = useState('');
  const [formMember, setFormMember] = useState<MemberSearchMember | null>(null);
  const [formDueDate, setFormDueDate] = useState('');

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {
        page,
        limit: ITEMS_PER_PAGE,
      };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (searchQuery.trim().length >= 2) params.search = searchQuery.trim();

      const res = await adminCrm.getTasks(params);
      if (res.success) {
        setTasks(Array.isArray(res.data) ? res.data as Task[] : []);
        setTotal(res.meta?.total || 0);
        setTotalPages(res.meta?.total_pages || 1);
      }
    } catch {
      toast.error(t('crm.failed_to_load_tasks'));
      setTasks([]);
    }
    setLoading(false);
  }, [page, statusFilter, priorityFilter, searchQuery, t, toast])


  const loadAdmins = useCallback(async () => {
    if (adminsLoaded) return;
    try {
      const res = await adminCrm.getAdmins();
      if (res.success && res.data) {
        setAdmins(res.data as unknown as AdminMember[]);
      }
    } catch {
      // silent — admins dropdown will be empty
    }
    setAdminsLoaded(true);
  }, [adminsLoaded]);

  useEffect(() => { loadTasks(); }, [loadTasks]);
  useEffect(() => { loadAdmins(); }, [loadAdmins]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [statusFilter, priorityFilter, searchQuery]);

  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormDescription('');
    setFormPriority('medium');
    // The API assigns a task with no assignee to the admin creating it, so
    // show that choice instead of an empty "Select an item".
    setFormAssignedTo(currentUserId);
    setFormUserId('');
    setFormMember(null);
    setFormDueDate('');
    setEditingTask(null);
  }, [currentUserId]);

  const openCreate = useCallback(() => {
    resetForm();
    createModal.onOpen();
  }, [resetForm, createModal]);

  const openEdit = useCallback((task: Task) => {
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
    setFormDueDate(task.due_date || '');
    createModal.onOpen();
  }, [createModal]);

  const getPriorityLabel = useCallback((priority: Task['priority']) => {
    return t(`crm.priority_${priority}`);
  }, [t]);

  const getStatusLabel = useCallback((status: Task['status']) => {
    return t(`crm.status_${status}`);
  }, [t]);

  const handleSave = useCallback(async () => {
    if (!formTitle.trim()) {
      toast.error(t('crm.title_is_required'));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        title: formTitle.trim(),
        description: formDescription.trim() || null,
        priority: formPriority,
        assigned_to: formAssignedTo ? Number(formAssignedTo) : undefined,
        // When editing, send null explicitly so the backend clears the field
        user_id: formUserId ? Number(formUserId) : (editingTask ? null : undefined),
        due_date: formDueDate || (editingTask ? null : undefined),
      };

      const res = editingTask
        ? await adminCrm.updateTask(editingTask.id, payload as Parameters<typeof adminCrm.updateTask>[1])
        : await adminCrm.createTask(payload as Parameters<typeof adminCrm.createTask>[0]);

      if (res.success) {
        toast.success(editingTask ? t('crm.task_updated') : t('crm.task_created'));
        createModal.onClose();
        resetForm();
        await loadTasks();
      } else {
        toast.error((editingTask ? t('crm.failed_to_update_task') : t('crm.failed_to_create_task')));
      }
    } catch {
      toast.error(editingTask ? t('crm.failed_to_update_task') : t('crm.failed_to_create_task'));
    }
    setSaving(false);
  }, [formTitle, formDescription, formPriority, formAssignedTo, formUserId, formDueDate, editingTask, createModal, resetForm, loadTasks, t, toast])


  const handleDelete = useCallback(async () => {
    if (!deletingTask) return;
    setDeleting(true);
    try {
      const res = await adminCrm.deleteTask(deletingTask.id);
      if (res.success) {
        toast.success(t('crm.task_deleted'));
        deleteModal.onClose();
        setDeletingTask(null);
        await loadTasks();
      } else {
        toast.error(t('crm.failed_to_delete_task'));
      }
    } catch {
      toast.error(t('crm.failed_to_delete_task'));
    }
    setDeleting(false);
  }, [deletingTask, deleteModal, loadTasks, t, toast])


  const handleStatusChange = useCallback(async (task: Task, newStatus: Task['status']) => {
    try {
      const res = await adminCrm.updateTask(task.id, { status: newStatus });
      if (res.success) {
        toast.success(t('crm.task_status_changed'));
        await loadTasks();
      } else {
        toast.error(t('crm.failed_to_update_task_status'));
      }
    } catch {
      toast.error(t('crm.failed_to_update_task_status'));
    }
  }, [loadTasks, t, toast])


  const handleQuickComplete = useCallback(async (task: Task) => {
    const newStatus = task.status === 'completed' ? 'pending' : 'completed';
    await handleStatusChange(task, newStatus);
  }, [handleStatusChange]);

  const openDeleteConfirm = useCallback((task: Task) => {
    setDeletingTask(task);
    deleteModal.onOpen();
  }, [deleteModal]);

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        title={t('crm.coordinator_tasks_title')}
        description={t('crm.tasks_total_count', { count: total })}
        actions={
          <Button startContent={<Plus className="w-4 h-4" />} onPress={openCreate}>
            {t('crm.create_task')}
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 flex-wrap items-end">
        {/* Status tabs */}
        <div className="flex gap-1 p-1 bg-surface-secondary rounded-lg">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.key}
              size="sm"
              variant={statusFilter === tab.key ? 'primary' : 'ghost'}
              onPress={() => setStatusFilter(tab.key)}
            >
              {t(tab.labelKey)}
            </Button>
          ))}
        </div>

        {/* Priority filter */}
        <Select
          size="sm"
          label={t('crm.label_priority')}
          selectedKeys={[priorityFilter]}
          onChange={(e) => setPriorityFilter((e.target.value || 'all') as PriorityFilter)}
          className="max-w-[180px]"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
          ))}
        </Select>

        {/* Search */}
        <Input type="search" name="admin-search" autoComplete="off"
          size="sm"
          label={t('crm.label_search')}
          placeholder={t('crm.placeholder_search_tasks')}
          className="max-w-[220px]"
          startContent={<Search className="w-4 h-4" />}
          value={searchQuery}
          onValueChange={setSearchQuery}
          isClearable
          onClear={() => setSearchQuery('')}
        />
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('crm.loading_tasks')} /></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && tasks.length === 0 && (
        <Card>
          <CardBody className="py-12 text-center">
            <ClipboardList className="w-12 h-12 mx-auto text-muted mb-4" />
            <p className="text-muted text-lg font-medium">{t('crm.no_tasks_found')}</p>
            <p className="text-muted text-sm mt-1">
              {statusFilter !== 'all' || priorityFilter !== 'all'
                ? t('crm.no_tasks_hint_filtered')
                : t('crm.no_tasks_hint_default')}
            </p>
          </CardBody>
        </Card>
      )}

      {/* Task list */}
      {!loading && tasks.length > 0 && (
        <div className="space-y-3">
          {tasks.map((task) => {
            const overdue = isOverdue(task.due_date, task.status);
            return (
              <Card
                key={task.id}
                className={`transition-all ${overdue ? 'border-l-4 border-l-danger' : ''} ${
                  task.status === 'completed' ? 'opacity-75' : ''
                }`}
              >
                <CardBody className="p-4">
                  <div className="flex items-start gap-3">
                    {/* Quick complete toggle. This was a 16px HeroUI checkbox
                        whose white control vanished against the white card. */}
                    <Tooltip
                      content={task.status === 'completed' ? t('crm.action_reopen_task') : t('crm.action_mark_complete')}
                      delay={300}
                    >
                      <Button
                        isIconOnly
                        size="sm"
                        variant="outline"
                        aria-pressed={task.status === 'completed'}
                        aria-label={t('crm.mark_task_as_status', {
                          title: task.title,
                          status: getStatusLabel(task.status === 'completed' ? 'pending' : 'completed'),
                        })}
                        onPress={() => handleQuickComplete(task)}
                        className={`mt-0.5 shrink-0 rounded-full border-2 ${
                          task.status === 'completed'
                            ? 'border-success bg-success text-white'
                            : 'border-muted text-muted hover:border-success hover:text-success'
                        }`}
                      >
                        <Check className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3
                            className={`font-semibold text-base ${
                              task.status === 'completed' ? 'line-through text-muted' : ''
                            }`}
                          >
                            {task.title}
                          </h3>
                          {task.description && (
                            <p className="text-sm text-muted mt-1 line-clamp-2">
                              {task.description}
                            </p>
                          )}
                        </div>

                        {/* Actions dropdown */}
                        <Dropdown>
                          <DropdownTrigger>
                            <Button isIconOnly size="sm" variant="ghost" aria-label={t('crm.label_task_actions')}>
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu aria-label={t('crm.label_task_actions')}>
                            <DropdownItem
                              key="edit" id="edit"
                              startContent={<Edit3 className="w-4 h-4" />}
                              onPress={() => openEdit(task)}
                            >
                              {t('crm.action_edit')}
                            </DropdownItem>
                            {task.status === 'completed' ? (
                              <DropdownItem
                                key="reopen" id="reopen"
                                startContent={<RotateCcw className="w-4 h-4" />}
                                onPress={() => handleStatusChange(task, 'pending')}
                              >
                                {t('crm.action_reopen_task')}
                              </DropdownItem>
                            ) : (
                              <DropdownItem
                                key="complete" id="complete"
                                startContent={<CheckCircle className="w-4 h-4" />}
                                onPress={() => handleStatusChange(task, 'completed')}
                              >
                                {t('crm.action_mark_complete')}
                              </DropdownItem>
                            )}
                            <DropdownItem
                              key="in_progress" id="in_progress"
                              startContent={<Clock className="w-4 h-4" />}
                              onPress={() => handleStatusChange(task, 'in_progress')}
                            >
                              {t('crm.action_mark_in_progress')}
                            </DropdownItem>
                            <DropdownItem
                              key="cancel" id="cancel"
                              startContent={<AlertTriangle className="w-4 h-4" />}
                              onPress={() => handleStatusChange(task, 'cancelled')}
                            >
                              {t('crm.action_cancel')}
                            </DropdownItem>
                            <DropdownItem
                              key="delete" id="delete"
                              className="text-danger"
                              color="danger"
                              startContent={<Trash2 className="w-4 h-4" />}
                              onPress={() => openDeleteConfirm(task)}
                            >
                              {t('crm.action_delete')}
                            </DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      {/* Metadata row */}
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <Chip size="sm" color={PRIORITY_COLOR_MAP[task.priority]} variant="soft">
                          {getPriorityLabel(task.priority)}
                        </Chip>
                        <Chip size="sm" color={STATUS_COLOR_MAP[task.status] || 'default'} variant="soft">
                          {getStatusLabel(task.status)}
                        </Chip>

                        {task.due_date && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${
                              overdue ? 'text-danger font-semibold' : 'text-muted'
                            }`}
                          >
                            <Calendar className="w-3 h-3" />
                            {overdue && <AlertTriangle className="w-3 h-3" />}
                            {t('crm.due_date_prefix')} {formatDate(task.due_date)}
                          </span>
                        )}

                        <span className="inline-flex items-center gap-1 text-xs text-muted">
                          <User className="w-3 h-3" />
                          {task.assigned_to_name}
                        </span>
                      </div>

                      {/* Related member + created by */}
                      <div className="flex flex-wrap items-center gap-4 mt-2">
                        {task.user_name && (
                          <Link
                            to={tenantPath(`/admin/users/${task.user_id}/edit`)}
                            className="flex items-center gap-2 text-xs text-muted hover:text-accent transition-colors"
                          >
                            <Avatar
                              src={task.user_avatar || undefined}
                              name={task.user_name}
                              size="sm"
                              className="w-5 h-5"
                            />
                            <span>{t('crm.related_prefix')} {task.user_name}</span>
                          </Link>
                        )}
                        <span className="text-xs text-muted">
                          {t('crm.created_by_prefix')} {task.created_by_name} &middot; {formatDateTime(task.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center pt-4">
          <Pagination
            total={totalPages}
            page={page}
            onChange={setPage}
            showControls
          />
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={createModal.isOpen} onOpenChange={createModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
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
                />
                <MemberSearchPicker
                  label={t('crm.label_task_member')}
                  description={t('crm.task_member_help')}
                  placeholder={t('crm.placeholder_type_name_or_email')}
                  noResultsText={t('crm.no_members_found')}
                  clearText={t('common.clear')}
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
                    <SelectItem key={String(admin.id)} id={String(admin.id)}>
                      {String(admin.id) === currentUserId
                        ? t('crm.assigned_to_you', { name: admin.name })
                        : `${admin.name} (${t(`crm.admin_roles.${admin.role}`, {
                          defaultValue: t('crm.admin_roles.unknown'),
                        })})`}
                    </SelectItem>
                  ))}
                </Select>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Select
                    label={t('crm.label_priority')}
                    selectedKeys={[formPriority]}
                    onChange={(e) => setFormPriority(e.target.value || 'medium')}
                  >
                    <SelectItem key="low" id="low">{t('crm.priority_low')}</SelectItem>
                    <SelectItem key="medium" id="medium">{t('crm.priority_medium')}</SelectItem>
                    <SelectItem key="high" id="high">{t('crm.priority_high')}</SelectItem>
                    <SelectItem key="urgent" id="urgent">{t('crm.priority_urgent')}</SelectItem>
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

      {/* Delete Confirmation Modal */}
      <Modal isOpen={deleteModal.isOpen} onOpenChange={deleteModal.onOpenChange} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2 text-danger">
                <Trash2 className="w-5 h-5" />
                {t('crm.delete_task_title')}
              </ModalHeader>
              <ModalBody>
                <p>
                  {t('crm.delete_task_confirm')}
                  {deletingTask && <strong> ({deletingTask.title})</strong>}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={deleting}>
                  {t('crm.action_cancel')}
                </Button>
                <Button variant="danger" onPress={handleDelete} isLoading={deleting} isDisabled={deleting}>
                  {t('crm.action_delete')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
