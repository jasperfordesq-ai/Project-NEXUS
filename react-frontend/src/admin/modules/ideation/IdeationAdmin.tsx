// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Ideation / Challenges Management
 * List, search, filter, change status, and delete ideation challenges.
 */

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';

import Lightbulb from 'lucide-react/icons/lightbulb';
import Eye from 'lucide-react/icons/eye';
import Trash2 from 'lucide-react/icons/trash-2';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Archive from 'lucide-react/icons/archive';
import XCircle from 'lucide-react/icons/circle-x';
import FileEdit from 'lucide-react/icons/file-pen';
import Vote from 'lucide-react/icons/vote';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Tabs, Tab } from '@/components/ui';
// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Challenge {
  id: number;
  title: string;
  creator_name: string;
  ideas_count: number;
  status: 'draft' | 'open' | 'voting' | 'evaluating' | 'closed' | 'archived';
  start_date: string;
  end_date: string;
  created_at: string;
}

interface RawChallenge {
  id: number;
  title: string;
  ideas_count?: number;
  status: ChallengeStatus;
  created_at: string;
  start_date?: string | null;
  end_date?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  submission_deadline?: string | null;
  voting_deadline?: string | null;
  creator_name?: string;
  first_name?: string;
  last_name?: string;
}

type ChallengeStatus = Challenge['status'];

const statusColors: Record<ChallengeStatus, 'success' | 'warning' | 'default' | 'secondary' | 'primary' | 'danger'> = {
  draft: 'default',
  open: 'success',
  voting: 'primary',
  evaluating: 'warning',
  closed: 'danger',
  archived: 'secondary',
};

function normalizeChallenge(item: RawChallenge): Challenge {
  const creatorName = item.creator_name
    ?? resolveUserDisplayName(item)
    ?? '';

  return {
    id: item.id,
    title: item.title,
    creator_name: creatorName,
    ideas_count: item.ideas_count ?? 0,
    status: item.status,
    start_date: item.start_date ?? item.starts_at ?? item.created_at ?? item.submission_deadline ?? '',
    end_date: item.end_date ?? item.ends_at ?? item.voting_deadline ?? '',
    created_at: item.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ChallengeActions — extracted to module level to avoid remount on every render
// ─────────────────────────────────────────────────────────────────────────────

interface ChallengeActionsProps {
  challenge: Challenge;
  onStatusChange: (challenge: Challenge, status: ChallengeStatus) => void;
  onDelete: (challenge: Challenge) => void;
  onView: (challenge: Challenge) => void;
}

function ChallengeActions({ challenge, onStatusChange, onDelete, onView }: ChallengeActionsProps) {
  const { t } = useTranslation('admin_ideation');
  type ActionKey = 'view' | ChallengeStatus | 'delete';

  const handleAction = (key: React.Key) => {
    const action = key as ActionKey;
    if (action === 'view') {
      onView(challenge);
    } else if (action === 'delete') {
      onDelete(challenge);
    } else {
      onStatusChange(challenge, action);
    }
  };

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('common.actions')}>
          <MoreVertical size={16} />
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={t('ideation.label_challenge_actions')} onAction={handleAction}>
        <DropdownItem key="view" id="view" startContent={<Eye aria-hidden="true" size={14} />}>
          {t('ideation.view_details')}
        </DropdownItem>
        <DropdownItem
          key="draft" id="draft"
          startContent={<FileEdit aria-hidden="true" size={14} />}
          className={challenge.status !== 'draft' ? '' : 'hidden'}
        >
          {t('ideation.mark_as_draft')}
        </DropdownItem>
        <DropdownItem
          key="open" id="open"
          startContent={<CheckCircle aria-hidden="true" size={14} />}
          color="success"
          className={challenge.status !== 'open' ? 'text-success' : 'hidden'}
        >
          {t('ideation.mark_as_open')}
        </DropdownItem>
        <DropdownItem
          key="voting" id="voting"
          startContent={<Vote aria-hidden="true" size={14} />}
          className={challenge.status !== 'voting' ? 'text-accent' : 'hidden'}
        >
          {t('ideation.mark_as_voting')}
        </DropdownItem>
        <DropdownItem
          key="evaluating" id="evaluating"
          startContent={<ClipboardCheck aria-hidden="true" size={14} />}
          color="warning"
          className={challenge.status !== 'evaluating' ? 'text-warning' : 'hidden'}
        >
          {t('ideation.mark_as_evaluating')}
        </DropdownItem>
        <DropdownItem
          key="closed" id="closed"
          startContent={<XCircle aria-hidden="true" size={14} />}
          className={challenge.status !== 'closed' ? '' : 'hidden'}
        >
          {t('ideation.mark_as_closed')}
        </DropdownItem>
        <DropdownItem
          key="archived" id="archived"
          startContent={<Archive aria-hidden="true" size={14} />}
          className={challenge.status !== 'archived' ? '' : 'hidden'}
        >
          {t('ideation.mark_as_archived')}
        </DropdownItem>
        <DropdownItem
          key="delete" id="delete"
          startContent={<Trash2 aria-hidden="true" size={14} />}
          className="text-danger"
          variant="danger"
        >
          {t('common.delete')}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function IdeationAdmin() {
  const { t } = useTranslation('admin_ideation');
  usePageTitle(t('ideation.ideation_admin_title'));
  const toast = useToast();

  const [items, setItems] = useState<Challenge[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Challenge | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [detailItem, setDetailItem] = useState<Challenge | null>(null);

  // ── Load challenges ─────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (search) params.set('search', search);
      if (status !== 'all') params.set('status', status);

      const res = await api.get(`/v2/admin/ideation?${params.toString()}`);
      if (res.success && res.data) {
        const items = Array.isArray(res.data)
          ? (res.data as RawChallenge[]).map(normalizeChallenge)
          : [];
        setItems(items);
        setTotal(res.meta?.total ?? 0);
      }
    } catch {
      toast.error(t('ideation.failed_to_load_ideation_challenges'));
    } finally {
      setLoading(false);
    }
  }, [page, search, status, t, toast])


  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // ── Status change handler ───────────────────────────────────────────────

  const handleStatusChange = async (challenge: Challenge, newStatus: ChallengeStatus) => {
    try {
      const res = await api.post(`/v2/admin/ideation/${challenge.id}/status`, {
        status: newStatus,
      });
      if (res?.success) {
        toast.success(t('ideation.challenge_status_changed'));
        loadItems();
      } else {
        toast.error(t('ideation.failed_to_update_challenge_status'));
      }
    } catch {
      toast.error(t('common.an_unexpected_error'));
    }
  };

  // ── Delete handler ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await api.delete(`/v2/admin/ideation/${confirmDelete.id}`);
      if (res?.success) {
        toast.success(t('ideation.challenge_deleted_successfully'));
        loadItems();
      } else {
        toast.error(t('ideation.failed_to_delete_challenge'));
      }
    } catch {
      toast.error(t('common.an_unexpected_error'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  // ── Table columns ───────────────────────────────────────────────────────

  const columns: Column<Challenge>[] = [
    {
      key: 'title',
      label: t('ideation.col_title'),
      sortable: true,
      render: (item) => (
        <span className="font-medium text-foreground line-clamp-1">{item.title}</span>
      ),
    },
    {
      key: 'creator_name',
      label: t('ideation.col_creator'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.creator_name || t('common.unknown')}</span>
      ),
    },
    {
      key: 'ideas_count',
      label: t('ideation.col_ideas'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.ideas_count}</span>
      ),
    },
    {
      key: 'status',
      label: t('ideation.col_status'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={statusColors[item.status] || 'default'}
          className="capitalize"
        >
          {t(`ideation.status_${item.status}`)}
        </Chip>
      ),
    },
    {
      key: 'start_date',
      label: t('ideation.col_start_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.start_date ? new Date(item.start_date).toLocaleDateString(getFormattingLocale()) : '\u2014'}
        </span>
      ),
    },
    {
      key: 'end_date',
      label: t('ideation.col_end_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.end_date ? new Date(item.end_date).toLocaleDateString(getFormattingLocale()) : '\u2014'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('common.actions'),
      render: (item) => (
        <ChallengeActions
          challenge={item}
          onStatusChange={handleStatusChange}
          onDelete={setConfirmDelete}
          onView={setDetailItem}
        />
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title={t('ideation.ideation_admin_title')}
        description={t('ideation.ideation_admin_desc')}
        actions={
          <div className="flex gap-2 items-center">
            <Chip variant="soft" startContent={<Lightbulb aria-hidden="true" size={14} />}>
              {t('ideation.total_count', { count: total })}
            </Chip>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={loadItems}
              aria-label={t('common.refresh')}
            >
              <RefreshCw size={14} />
            </Button>
          </div>
        }
      />

      <div className="mb-4">
        <Tabs
          aria-label={t('ideation.tabs_aria')}
          selectedKey={status}
          onSelectionChange={(key) => {
            setStatus(key as string);
            setPage(1);
          }}
          variant="underlined"
          size="sm"
        >
          <Tab key="all" title={t('common.all')} />
          <Tab key="draft" title={t('ideation.status_draft')} />
          <Tab key="open" title={t('ideation.status_open')} />
          <Tab key="voting" title={t('ideation.status_voting')} />
          <Tab key="evaluating" title={t('ideation.status_evaluating')} />
          <Tab key="closed" title={t('ideation.status_closed')} />
          <Tab key="archived" title={t('ideation.status_archived')} />
        </Tabs>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchPlaceholder={t('ideation.search_challenges_placeholder')}
        emptyContent={
          search
            ? t('ideation.no_matching_challenges')
            : status === 'all'
              ? t('ideation.no_challenges_found')
              : t('ideation.no_status_challenges')
        }
        onSearch={(q) => {
          setSearch(q);
          setPage(1);
        }}
        onRefresh={loadItems}
        totalItems={total}
        page={page}
        pageSize={50}
        onPageChange={setPage}
      />

      {/* Delete confirmation */}
      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={t('ideation.delete_challenge')}
          message={t('ideation.confirm_delete_challenge')}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}

      {/* Detail view modal */}
      {detailItem && (
        <ConfirmModal
          isOpen={!!detailItem}
          onClose={() => setDetailItem(null)}
          onConfirm={() => setDetailItem(null)}
          title={t('ideation.challenge_details')}
          message=""
          confirmLabel={t('common.close')}
          confirmColor="primary"
        >
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-muted">{t('ideation.ideation')}</span>
              <p className="text-foreground">{detailItem.title}</p>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-sm font-medium text-muted">{t('ideation.col_creator')}</span>
                <p className="text-foreground">{detailItem.creator_name || t('common.unknown')}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted">{t('ideation.col_ideas')}</span>
                <p className="text-foreground">{detailItem.ideas_count}</p>
              </div>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-sm font-medium text-muted">{t('ideation.col_status')}</span>
                <p>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={statusColors[detailItem.status] || 'default'}
                    className="capitalize"
                  >
                    {t(`ideation.status_${detailItem.status}`)}
                  </Chip>
                </p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted">{t('ideation.col_start_date')}</span>
                <p className="text-foreground">
                  {detailItem.start_date
                    ? new Date(detailItem.start_date).toLocaleDateString(getFormattingLocale())
                    : '\u2014'}
                </p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted">{t('ideation.col_end_date')}</span>
                <p className="text-foreground">
                  {detailItem.end_date
                    ? new Date(detailItem.end_date).toLocaleDateString(getFormattingLocale())
                    : '\u2014'}
                </p>
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-muted">{t('ideation.col_created')}</span>
              <p className="text-foreground">
                {new Date(detailItem.created_at).toLocaleString(getFormattingLocale())}
              </p>
            </div>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

export default IdeationAdmin;
