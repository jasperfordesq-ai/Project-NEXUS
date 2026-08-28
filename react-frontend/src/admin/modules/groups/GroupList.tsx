// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Groups List
 * Full management for community groups with status filtering, search, and delete.
 * Parity: PHP Admin groups management
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import Trash2 from 'lucide-react/icons/trash-2';
import Users from 'lucide-react/icons/users';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Lock from 'lucide-react/icons/lock';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Power from 'lucide-react/icons/power';
import PowerOff from 'lucide-react/icons/power-off';
import Pencil from 'lucide-react/icons/pencil';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant,
  useToast } from '@/contexts';
import { adminGroups } from '../../api/adminApi';
import { api } from '@/lib/api';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import type { AdminGroup, GroupStatus } from '../../api/types';

import { resolveAssetUrl, getFormattingLocale } from '@/lib/helpers';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Input, Avatar, Tabs, Tab } from '@/components/ui';
import { AlertDialog } from '@/components/ui/AlertDialog';

const statusColors: Record<GroupStatus, 'success' | 'warning' | 'danger' | 'default'> = {
  active: 'success',
  pending_review: 'warning',
  dormant: 'default',
  archived: 'default',
  rejected: 'danger',
};

export const GROUP_STATUS_TABS = [
  'all',
  'pending_review',
  'active',
  'dormant',
  'archived',
  'rejected',
] as const;

type GroupStatusTab = typeof GROUP_STATUS_TABS[number];

export interface GroupStatusTransition {
  target: GroupStatus;
  labelKey:
    | 'groups.transition_pending_review_to_active'
    | 'groups.transition_active_to_dormant'
    | 'groups.transition_dormant_to_active'
    | 'groups.transition_archived_to_active'
    | 'groups.transition_rejected_to_pending_review';
}

const GROUP_STATUS_TRANSITIONS: Record<GroupStatus, GroupStatusTransition> = {
    pending_review: { target: 'active', labelKey: 'groups.transition_pending_review_to_active' },
    active: { target: 'dormant', labelKey: 'groups.transition_active_to_dormant' },
    dormant: { target: 'active', labelKey: 'groups.transition_dormant_to_active' },
    archived: { target: 'active', labelKey: 'groups.transition_archived_to_active' },
    rejected: { target: 'pending_review', labelKey: 'groups.transition_rejected_to_pending_review' },
};

export function getGroupStatusTransition(status: GroupStatus): GroupStatusTransition {
  return GROUP_STATUS_TRANSITIONS[status];
}

const ARCHIVABLE_STATUSES = new Set<GroupStatus>(['pending_review', 'active', 'dormant']);

const visibilityIcons: Record<string, typeof Eye> = {
  public: Eye,
  private: Lock,
  hidden: EyeOff,
};

export function GroupList() {
  const { t } = useTranslation('admin_groups');
  usePageTitle(t('groups.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  const [items, setItems] = useState<AdminGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<GroupStatusTab>('all');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<AdminGroup | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleteConfirmation, setBulkDeleteConfirmation] = useState('');
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGroups.list({
        page,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
      });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setItems(data);
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else if (data && typeof data === 'object') {
          const pd = data as { data: AdminGroup[]; meta?: { total: number } };
          setItems(pd.data || []);
          setTotal(pd.meta?.total || 0);
        }
      } else {
        toast.error(t('groups.failed_to_load_groups'));
      }
    } catch {
      toast.error(t('groups.failed_to_load_groups'));
    } finally {
      setLoading(false);
    }
  }, [page, status, search, t, toast])


  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleDelete = async () => {
    if (!confirmDelete || deleteConfirmation !== confirmDelete.name) return;
    setActionLoadingId(confirmDelete.id);

    try {
      const res = await adminGroups.delete(confirmDelete.id);
      if (res?.success) {
        toast.success(t('groups.group_deleted_successfully'));
        setConfirmDelete(null);
        setDeleteConfirmation('');
        await loadItems();
      } else {
        // Surface the server's own reason (already translated) so an admin is
        // told WHY the delete was refused, instead of a blanket failure they
        // cannot act on. `res.error || t(fallback)` is the pattern the other
        // admin call sites use.
        toast.error(res?.error || t('groups.failed_to_delete_group'));
      }
    } catch {
      toast.error(t('common.unexpected_error'));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleStatusTransition = async (item: AdminGroup, newStatus: GroupStatus) => {
    setActionLoadingId(item.id);
    try {
      const res = await adminGroups.updateStatus(item.id, newStatus);
      if (res?.success) {
        toast.success(t('groups.group_status_changed'));
        await loadItems();
      } else {
        // A refused transition always has a reason — the group is in a state
        // that does not allow it, a policy blocks it, permissions. Show it.
        toast.error(res?.error || t('groups.failed_to_update_group_status'));
      }
    } catch {
      toast.error(t('groups.failed_to_update_group_status'));
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleArchive = async (item: AdminGroup) => {
    if (!ARCHIVABLE_STATUSES.has(item.status)) return;
    await handleStatusTransition(item, 'archived');
  };

  const handleBulkArchive = async () => {
    try {
      const res = await api.post('/v2/admin/groups/bulk-archive', { group_ids: Array.from(selectedIds) });
      if (res?.success) {
        toast.success(t('groups.groups_archived'));
        setSelectedIds(new Set());
        loadItems();
      } else {
        toast.error(res?.error || t('groups.failed_to_archive_groups'));
      }
    } catch { toast.error(t('groups.failed_to_archive_groups')); }
  };

  const handleBulkDelete = async () => {
    const requiredPhrase = t('groups.bulk_delete_phrase', { count: selectedIds.size });
    if (bulkDeleteConfirmation !== requiredPhrase || selectedIds.size === 0) return;
    setBulkDeleteLoading(true);
    // Delete one by one (no bulk delete endpoint)
    const failedIds = new Set<number>();
    // Keep the first server reason so a partially failed bulk delete can say why
    // the survivors survived, rather than only that "some" failed.
    let firstFailureReason: string | null = null;
    for (const id of selectedIds) {
      try {
        const res = await adminGroups.delete(id);
        if (!res?.success) {
          failedIds.add(id);
          if (!firstFailureReason && res?.error) firstFailureReason = res.error;
        }
      } catch {
        failedIds.add(id);
      }
    }
    if (failedIds.size === 0) {
      toast.success(t('groups.groups_deleted'));
    } else {
      toast.error(firstFailureReason || t('groups.failed_to_delete_group'));
    }
    // Keep failed ids selected so nothing is silently lost
    setSelectedIds(failedIds);
    setBulkDeleteLoading(false);
    setConfirmBulkDelete(false);
    setBulkDeleteConfirmation('');
    await loadItems();
  };

  const selectedGroups = items.filter((item) => selectedIds.has(item.id));
  const canBulkArchive = selectedIds.size > 0
    && selectedGroups.length === selectedIds.size
    && selectedGroups.every((item) => ARCHIVABLE_STATUSES.has(item.status));
  const bulkDeletePhrase = t('groups.bulk_delete_phrase', { count: selectedIds.size });

  const columns: Column<AdminGroup>[] = [
    {
      key: 'name',
      label: t('groups.col_group'),
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar
            src={item.image_url ? resolveAssetUrl(item.image_url) : undefined}
            name={item.name}
            size="sm"
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{item.name}</p>
            {item.description && (
              <p className="text-xs text-muted truncate max-w-xs">
                {item.description}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      label: t('groups.col_status'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={statusColors[item.status] || 'default'}
          className="capitalize"
        >
          {t(`groups.status_${item.status}`)}
        </Chip>
      ),
    },
    {
      key: 'visibility',
      label: t('groups.col_visibility'),
      sortable: true,
      render: (item) => {
        const Icon = visibilityIcons[item.visibility] || Eye;
        return (
          <div className="flex items-center gap-1.5">
            <Icon size={14} className="text-muted" aria-hidden="true" />
            <span className="text-sm text-muted capitalize">{t(`groups.visibility_${item.visibility}`)}</span>
          </div>
        );
      },
    },
    {
      key: 'member_count',
      label: t('groups.col_members'),
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-1.5">
          <Users size={14} className="text-muted" aria-hidden="true" />
          <span className="text-sm text-muted">{item.member_count}</span>
        </div>
      ),
    },
    {
      key: 'creator_name',
      label: t('groups.col_creator'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.creator_name || t('common.unknown')}</span>
      ),
    },
    {
      key: 'created_at',
      label: t('groups.col_created'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('groups.col_actions'),
      render: (item) => {
        const transition = getGroupStatusTransition(item.status);
        return (
        <Dropdown>
          <DropdownTrigger>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              aria-label={t('groups.actions_for', { name: item.name })}
              isDisabled={actionLoadingId !== null}
              isLoading={actionLoadingId === item.id}
            >
              <MoreVertical size={16} />
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t('groups.label_group_actions')}
            onAction={(key) => {
              if (key === 'view') navigate(tenantPath(`/admin/groups/${item.id}/detail`));
              else if (key === 'edit') navigate(tenantPath(`/groups/edit/${item.id}`));
              else if (key === 'transition') void handleStatusTransition(item, transition.target);
              else if (key === 'archive') handleArchive(item);
              else if (key === 'audit') navigate(tenantPath(`/admin/groups/${item.id}/detail?tab=audit`));
              else if (key === 'delete') {
                setDeleteConfirmation('');
                setConfirmDelete(item);
              }
            }}
          >
            <DropdownItem key="view" id="view" startContent={<Eye size={14} />}>
              {t('groups.view_group')}
            </DropdownItem>
            <DropdownItem key="edit" id="edit" startContent={<Pencil size={14} />}>
              {t('groups.edit_group')}
            </DropdownItem>
            <DropdownItem
              key="transition" id="transition"
              startContent={transition.target === 'dormant' ? <PowerOff size={14} /> : <Power size={14} />}
              className={transition.target === 'dormant' ? 'text-warning' : 'text-success'}
            >
              {t(transition.labelKey)}
            </DropdownItem>
            {ARCHIVABLE_STATUSES.has(item.status) ? (
              <DropdownItem
                key="archive" id="archive"
                startContent={<EyeOff size={14} />}
              >
                {t('groups.archive')}
              </DropdownItem>
            ) : null}
            <DropdownItem key="audit" id="audit" startContent={<Eye size={14} />}>
              {t('groups.audit_log_title')}
            </DropdownItem>
            <DropdownItem key="delete" id="delete" startContent={<Trash2 size={14} />} className="text-danger" variant="danger">
              {t('groups.delete')}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('groups.group_list_title')}
        description={t('groups.group_list_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              size="sm"
              onPress={() => navigate(tenantPath('/admin/groups/analytics'))}
            >
              {t('groups.analytics')}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onPress={() => navigate(tenantPath('/admin/groups/approvals'))}
            >
              {t('groups.approvals')}
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <Tabs
          aria-label={t('groups.status_tabs_aria')}
          selectedKey={status}
          onSelectionChange={(key) => {
            const nextStatus = String(key);
            if (GROUP_STATUS_TABS.includes(nextStatus as GroupStatusTab)) {
              setStatus(nextStatus as GroupStatusTab);
              setPage(1);
            }
          }}
          variant="underlined"
          size="sm"
        >
          <Tab key="all" title={t('groups.status_all')} />
          <Tab key="pending_review" title={t('groups.status_pending_review')} />
          <Tab key="active" title={t('groups.status_active')} />
          <Tab key="dormant" title={t('groups.status_dormant')} />
          <Tab key="archived" title={t('groups.status_archived')} />
          <Tab key="rejected" title={t('groups.status_rejected')} />
        </Tabs>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 p-3 mb-4 bg-accent/10 rounded-lg">
          <span className="text-sm font-medium">{t('groups.selected_count', { count: selectedIds.size })}</span>
          {canBulkArchive && (
            <Button size="sm" variant="tertiary" onPress={handleBulkArchive}>{t('groups.archive')}</Button>
          )}
          <Button
            size="sm"
            variant="danger"
            onPress={() => {
              setBulkDeleteConfirmation('');
              setConfirmBulkDelete(true);
            }}
          >
            {t('groups.delete')}
          </Button>
          <Button size="sm" variant="tertiary" onPress={() => setSelectedIds(new Set())}>{t('common.clear')}</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchPlaceholder={t('groups.search_groups_placeholder')}
        onSearch={(q) => { setSearch(q); setPage(1); }}
        onRefresh={loadItems}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        selectable
        selectedKeys={new Set(Array.from(selectedIds, String))}
        onSelectionChange={(keys) => setSelectedIds(new Set(Array.from(keys, Number)))}
      />

      <AlertDialog.Backdrop
        isOpen={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open && actionLoadingId === null) {
            setConfirmDelete(null);
            setDeleteConfirmation('');
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[480px]">
            <AlertDialog.CloseTrigger
              aria-label={t('common.close')}
              isDisabled={actionLoadingId !== null}
            />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t('groups.delete_group')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-4">
              <p>{t('groups.delete_group_warning')}</p>
              <p>{t('groups.delete_group_type_instruction', { name: confirmDelete?.name ?? '' })}</p>
              <Input
                label={t('groups.delete_group_confirmation_label')}
                value={deleteConfirmation}
                onValueChange={setDeleteConfirmation}
                autoComplete="off"
                isDisabled={actionLoadingId !== null}
              />
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="tertiary"
                isDisabled={actionLoadingId !== null}
                onPress={() => {
                  setConfirmDelete(null);
                  setDeleteConfirmation('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                isLoading={actionLoadingId !== null}
                isDisabled={
                  !confirmDelete
                  || deleteConfirmation !== confirmDelete.name
                  || actionLoadingId !== null
                }
                onPress={() => void handleDelete()}
              >
                {t('groups.delete')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <AlertDialog.Backdrop
        isOpen={confirmBulkDelete}
        onOpenChange={(open) => {
          if (!open && !bulkDeleteLoading) {
            setConfirmBulkDelete(false);
            setBulkDeleteConfirmation('');
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[480px]">
            <AlertDialog.CloseTrigger
              aria-label={t('common.close')}
              isDisabled={bulkDeleteLoading}
            />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t('groups.bulk_delete_title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body className="space-y-4">
              <p>{t('groups.bulk_delete_warning', { count: selectedIds.size })}</p>
              <p>{t('groups.bulk_delete_type_instruction', { phrase: bulkDeletePhrase })}</p>
              <Input
                label={t('groups.bulk_delete_confirmation_label')}
                value={bulkDeleteConfirmation}
                onValueChange={setBulkDeleteConfirmation}
                autoComplete="off"
                isDisabled={bulkDeleteLoading}
              />
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="tertiary"
                isDisabled={bulkDeleteLoading}
                onPress={() => {
                  setConfirmBulkDelete(false);
                  setBulkDeleteConfirmation('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                isLoading={bulkDeleteLoading}
                isDisabled={
                  selectedIds.size === 0
                  || bulkDeleteConfirmation !== bulkDeletePhrase
                  || bulkDeleteLoading
                }
                onPress={() => void handleBulkDelete()}
              >
                {t('groups.delete')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

export default GroupList;
