// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Polls Management
 * List, search, view, and delete polls with pagination.
 */

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';import BarChart3 from 'lucide-react/icons/chart-column';
import Eye from 'lucide-react/icons/eye';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { Button, Chip } from '@/components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Poll {
  id: number;
  question: string;
  options_count: number;
  votes_count: number;
  creator_name: string;
  status: 'active' | 'ended';
  created_at: string;
}

interface RawPoll {
  id: number;
  question: string;
  created_at: string;
  end_date?: string | null;
  is_active?: boolean;
  options?: Array<{ id: number }>;
  total_votes?: number;
  user?: {
    first_name?: string;
    last_name?: string;
    name?: string;
  };
}

const statusColors: Record<string, 'success' | 'default'> = {
  active: 'success',
  ended: 'default',
};

function normalizePoll(item: RawPoll): Poll {
  const creatorName = resolveUserDisplayName(item.user);
  const isEnded = !!item.end_date && new Date(item.end_date).getTime() <= Date.now();

  return {
    id: item.id,
    question: item.question,
    options_count: item.options?.length ?? 0,
    votes_count: item.total_votes ?? 0,
    creator_name: creatorName,
    status: isEnded || item.is_active === false ? 'ended' : 'active',
    created_at: item.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function PollsAdmin() {
  const { t } = useTranslation('admin_polls');
  usePageTitle(t('polls.page_title'));
  const toast = useToast();

  const [items, setItems] = useState<Poll[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Poll | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [detailPoll, setDetailPoll] = useState<Poll | null>(null);

  // ── Load polls ──────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
      });
      if (search) params.set('search', search);

      const res = await api.get(`/v2/admin/polls?${params.toString()}`);
      if (res.success && res.data) {
        const items = Array.isArray(res.data)
          ? (res.data as RawPoll[]).map(normalizePoll)
          : [];
        setItems(items);
        setTotal(res.meta?.total ?? 0);
      }
    } catch {
      toast.error(t('polls.failed_to_load_polls'));
    } finally {
      setLoading(false);
    }
  }, [page, search, t, toast])


  useEffect(() => {
    loadItems();
  }, [loadItems]);

  // ── Delete handler ──────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(true);
    try {
      const res = await api.delete(`/v2/admin/polls/${confirmDelete.id}`);
      if (res?.success) {
        toast.success(t('polls.poll_deleted_successfully'));
        loadItems();
      } else {
        toast.error(t('polls.failed_to_delete_poll'));
      }
    } catch {
      toast.error(t('polls.an_unexpected_error_occurred'));
    } finally {
      setActionLoading(false);
      setConfirmDelete(null);
    }
  };

  // ── Columns ─────────────────────────────────────────────────────────────

  const columns: Column<Poll>[] = [
    {
      key: 'question',
      label: t('polls.col_question'),
      sortable: true,
      render: (item) => (
        <span className="font-medium text-foreground line-clamp-2">
          {item.question}
        </span>
      ),
    },
    {
      key: 'options_count',
      label: t('polls.col_options'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.options_count}</span>
      ),
    },
    {
      key: 'votes_count',
      label: t('polls.col_votes'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">{item.votes_count}</span>
      ),
    },
    {
      key: 'creator_name',
      label: t('polls.col_creator'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.creator_name || t('polls.unknown')}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('polls.col_status'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={statusColors[item.status] || 'default'}
          className="capitalize"
        >
          {t(`polls.status_${item.status}`)}
        </Chip>
      ),
    },
    {
      key: 'created_at',
      label: t('polls.col_created'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('polls.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setDetailPoll(item)}
            aria-label={t('polls.label_view_poll_details')}
          >
            <Eye size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger"
            onPress={() => setConfirmDelete(item)}
            aria-label={t('polls.label_delete_poll')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div>
      <PageHeader
        title={t('polls.polls_admin_title')}
        description={t('polls.polls_admin_desc')}
        actions={
          <Chip variant="soft" startContent={<BarChart3 aria-hidden="true" size={14} />}>
            {t('polls.total_count', { count: total })}
          </Chip>
        }
      />

      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchPlaceholder={t('polls.search_polls_placeholder')}
        emptyContent={
          search
            ? t('polls.no_matching_polls')
            : t('polls.no_polls_found')
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
          title={t('polls.delete_poll')}
          message={t('polls.confirm_delete_poll')}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}

      {/* Detail view modal */}
      {detailPoll && (
        <ConfirmModal
          isOpen={!!detailPoll}
          onClose={() => setDetailPoll(null)}
          onConfirm={() => setDetailPoll(null)}
          title={t('polls.poll_details')}
          message=""
          confirmLabel={t('common.close')}
          confirmColor="primary"
        >
          <div className="space-y-3">
            <div>
              <span className="text-sm font-medium text-muted">{t('polls.question')}</span>
              <p className="text-foreground">{detailPoll.question}</p>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-sm font-medium text-muted">{t('polls.options')}</span>
                <p className="text-foreground">{detailPoll.options_count}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted">{t('polls.votes')}</span>
                <p className="text-foreground">{detailPoll.votes_count}</p>
              </div>
            </div>
            <div className="flex gap-6">
              <div>
                <span className="text-sm font-medium text-muted">{t('polls.creator')}</span>
                <p className="text-foreground">{detailPoll.creator_name || t('polls.unknown')}</p>
              </div>
              <div>
                <span className="text-sm font-medium text-muted">{t('polls.status')}</span>
                <p>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={statusColors[detailPoll.status] || 'default'}
                    className="capitalize"
                  >
                    {t(`polls.status_${detailPoll.status}`)}
                  </Chip>
                </p>
              </div>
            </div>
            <div>
              <span className="text-sm font-medium text-muted">{t('polls.created')}</span>
              <p className="text-foreground">
                {new Date(detailPoll.created_at).toLocaleString(getFormattingLocale())}
              </p>
            </div>
          </div>
        </ConfirmModal>
      )}
    </div>
  );
}

export default PollsAdmin;
