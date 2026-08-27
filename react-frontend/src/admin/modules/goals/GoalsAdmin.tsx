import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { CardBody, Card, Progress, Button, Chip, Spinner, Input, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Goals Management
 * View, search, and delete member goals with progress tracking.
 * API: GET  /api/v2/admin/goals
 *      DELETE /api/v2/admin/goals/{id}
 */

import { useState, useEffect, useCallback } from 'react';

import Target from 'lucide-react/icons/target';
import Search from 'lucide-react/icons/search';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trash2 from 'lucide-react/icons/trash-2';
import Eye from 'lucide-react/icons/eye';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Goal {
  id: number;
  title: string;
  member_name: string;
  member_id: number;
  target_value: number;
  current_value: number;
  status: 'active' | 'completed' | 'abandoned';
  has_buddy: boolean;
  created_at: string;
}

interface GoalsMeta {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface RawGoal {
  id: number;
  title: string;
  user_id: number;
  mentor_id?: number | null;
  buddy_id?: number | null;
  current_value?: number;
  target_value?: number;
  status: 'active' | 'completed' | 'abandoned';
  created_at: string;
  user?: {
    first_name?: string;
    last_name?: string;
    name?: string;
  };
}

// ---------------------------------------------------------------------------
// Status color map
// ---------------------------------------------------------------------------

const statusColors: Record<string, 'primary' | 'success' | 'danger'> = {
  active: 'primary',
  completed: 'success',
  abandoned: 'danger',
};

function statusLabelKey(status: Goal['status']): string {
  switch (status) {
    case 'active':
      return 'goals.status_active';
    case 'completed':
      return 'goals.status_completed';
    case 'abandoned':
      return 'goals.status_abandoned';
    default:
      return 'goals.status_unknown';
  }
}

function normalizeGoal(item: RawGoal): Goal {
  const memberName = resolveUserDisplayName(item.user);

  return {
    id: item.id,
    title: item.title,
    member_name: memberName,
    member_id: item.user_id,
    target_value: Number(item.target_value ?? 0),
    current_value: Number(item.current_value ?? 0),
    status: item.status,
    has_buddy: Boolean(item.mentor_id ?? item.buddy_id),
    created_at: item.created_at,
  };
}

const progressPercent = (goal: Goal): number => {
  if (!goal.target_value || goal.target_value <= 0) return 0;
  return Math.min(Math.round((goal.current_value / goal.target_value) * 100), 100);
};

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'short', day: 'numeric' });

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GoalsAdmin() {
  const { t } = useTranslation('admin_goals');
  usePageTitle(t('goals.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [meta, setMeta] = useState<GoalsMeta>({ page: 1, per_page: 50, total: 0, total_pages: 1 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Goal | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const loadGoals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (search) params.set('search', search);

      const res = await api.get(`/v2/admin/goals?${params.toString()}`);

      if (res.success && res.data) {
        const items = Array.isArray(res.data)
          ? (res.data as RawGoal[]).map(normalizeGoal)
          : [];
        setGoals(items);
        setMeta({
          page: res.meta?.current_page ?? page,
          per_page: res.meta?.per_page ?? 50,
          total: res.meta?.total ?? 0,
          total_pages: res.meta?.total_pages ?? 1,
        });
      }
    } catch {
      toast.error(t('goals.failed_to_load_goals'));
    } finally {
      setLoading(false);
    }
  }, [page, search, t, toast])


  useEffect(() => {
    loadGoals();
  }, [loadGoals]);

  // -----------------------------------------------------------------------
  // Search handler
  // -----------------------------------------------------------------------

  const handleSearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // -----------------------------------------------------------------------
  // Delete handler
  // -----------------------------------------------------------------------

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      const res = await api.delete(`/v2/admin/goals/${confirmDelete.id}`);
      if (res?.success) {
        toast.success(t('goals.goal_deleted'));
        loadGoals();
      } else {
        toast.error(t('goals.failed_to_delete_goal'));
      }
    } catch {
      toast.error(t('goals.an_unexpected_error_occurred'));
    } finally {
      setDeleteLoading(false);
      setConfirmDelete(null);
    }
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title={t('goals.goals_admin_title')}
        description={t('goals.goals_admin_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadGoals}
            isDisabled={loading}
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {/* Search bar */}
      <div className="mb-4 flex items-center gap-2">
        <Input type="search" name="admin-search" autoComplete="off"
          placeholder={t('goals.placeholder_search_goals_by_title_or_member')}
          aria-label={t('goals.label_search_goals')}
          value={searchInput}
          onValueChange={setSearchInput}
          onKeyDown={handleSearchKeyDown}
          startContent={<Search size={16} className="text-muted" />}
          isClearable
          onClear={() => { setSearchInput(''); setSearch(''); setPage(1); }}
          className="max-w-md"
        />
        <Button variant="tertiary" onPress={handleSearch}>
          {t('goals.search')}
        </Button>
      </div>

      {/* Main table */}
      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-16">
              <Spinner size="lg" label={t('goals.loading_goals')} />
            </div>
          ) : goals.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted">
              <Target size={48} aria-hidden="true" />
              <p className="text-lg font-medium">{t('goals.no_goals_found')}</p>
              <p className="text-sm">
                {search ? t('goals.try_adjusting_search') : t('goals.no_goals_created_yet')}
              </p>
            </div>
          ) : (
            <Table
              aria-label={t('goals.label_goals_administration_table')}
              removeWrapper
              isStriped
            >
              <TableHeader>
                <TableColumn>{t('goals.col_title')}</TableColumn>
                <TableColumn>{t('goals.col_member')}</TableColumn>
                <TableColumn>{t('goals.col_target')}</TableColumn>
                <TableColumn>{t('goals.col_progress')}</TableColumn>
                <TableColumn>{t('goals.col_status')}</TableColumn>
                <TableColumn>{t('goals.col_buddy')}</TableColumn>
                <TableColumn>{t('goals.col_created')}</TableColumn>
                <TableColumn>{t('goals.col_actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {goals.map((goal) => (
                  <TableRow key={goal.id}>
                    <TableCell>
                      <span className="font-medium text-foreground">{goal.title}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">{goal.member_name}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">{goal.target_value}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <Progress
                          size="sm"
                          value={progressPercent(goal)}
                          color={goal.status === 'completed' ? 'success' : 'primary'}
                          className="flex-1"
                          aria-label={t('goals.progress_complete', { percent: progressPercent(goal) })}
                        />
                        <span className="text-xs text-muted w-10 text-right">
                          {progressPercent(goal)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={statusColors[goal.status] || 'default'}
                      >
                        {t(statusLabelKey(goal.status))}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={goal.has_buddy ? 'success' : 'default'}
                      >
                        {goal.has_buddy ? t('goals.yes') : t('goals.no')}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">{formatDate(goal.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          aria-label={t('goals.label_view_goal')}
                          onPress={() => window.open(tenantPath(`/goals/${goal.id}`), '_blank')}
                        >
                          <Eye size={14} />
                        </Button>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="danger"
                          aria-label={t('goals.label_delete_goal')}
                          onPress={() => setConfirmDelete(goal)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Pagination */}
      {meta.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-muted">
            {t('goals.showing_of_total', { count: goals.length, total: meta.total })}
          </span>
          <Pagination
            total={meta.total_pages}
            page={page}
            onChange={setPage}
            showControls
          />
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <ConfirmModal
          isOpen={!!confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
          title={t('goals.delete_goal')}
          message={t('goals.confirm_delete_goal')}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={deleteLoading}
        />
      )}
    </div>
  );
}

export default GoalsAdmin;
