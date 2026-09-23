import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Input, Textarea, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalHeading, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Separator } from '@/components/ui';
import Inbox from 'lucide-react/icons/inbox';
import Download from 'lucide-react/icons/download';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/check-circle';
import XCircle from 'lucide-react/icons/x-circle';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { canManageCaring } from '@/caring/access';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FeedbackStatus = 'new' | 'triaging' | 'in_progress' | 'resolved' | 'closed';
type FeedbackCategory = 'question' | 'idea' | 'issue_report' | 'sentiment';
type SentimentTag = 'positive' | 'neutral' | 'negative' | 'concerned' | null;

interface FeedbackRow {
  id: number;
  tenant_id: number;
  submitter_user_id: number | null;
  sub_region_id: number | null;
  category: FeedbackCategory;
  subject: string;
  body: string;
  sentiment_tag: SentimentTag;
  status: FeedbackStatus;
  assigned_user_id: number | null;
  assigned_role: string | null;
  triage_notes: string | null;
  resolution_notes: string | null;
  is_anonymous: boolean;
  is_public: boolean;
  created_at: string;
  updated_at: string;
}

interface DashboardStats {
  total_open: number;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  by_sub_region: Record<string, number>;
  recent_count_7d: number;
  sentiment_distribution: Record<string, number>;
}

interface PaginatedMeta {
  current_page: number;
  per_page: number;
  total: number;
  total_pages: number;
  has_more: boolean;
}

const STATUS_OPTIONS: FeedbackStatus[] = ['new', 'triaging', 'in_progress', 'resolved', 'closed'];
const CATEGORY_OPTIONS: FeedbackCategory[] = ['question', 'idea', 'issue_report', 'sentiment'];

const STATUS_COLOR: Record<FeedbackStatus, 'default' | 'primary' | 'warning' | 'success' | 'danger'> = {
  new: 'primary',
  triaging: 'warning',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'default',
};

const CATEGORY_COLOR: Record<FeedbackCategory, 'default' | 'primary' | 'secondary' | 'warning'> = {
  question: 'primary',
  idea: 'secondary',
  issue_report: 'warning',
  sentiment: 'default',
};

function fmtDate(iso: string, fallback: string): string {
  if (!iso) return fallback;
  return new Date(iso).toLocaleString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(iso: string, t: TFunction<'caring_community'>): string {
  if (!iso) return t('admin.feedback.common.date_unknown');
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('admin.feedback.relative.just_now');
  if (minutes < 60) return t('admin.feedback.relative.minutes_ago', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('admin.feedback.relative.hours_ago', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('admin.feedback.relative.days_ago', { count: days });
  const months = Math.floor(days / 30);
  return t('admin.feedback.relative.months_ago', { count: months });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MunicipalityFeedbackAdminPage() {
  const { t } = useTranslation('caring_community');
  const { t: tAdmin } = useTranslation('admin_caring_community');
  const { user } = useAuth();
  const canManage = canManageCaring(user);
  usePageTitle(t('admin.feedback.title'));
  const { showToast } = useToast();
  const dateFallback = t('admin.feedback.common.date_unknown');
  const statusLabel = useCallback((status: FeedbackStatus | string) => t(`admin.feedback.status.${status}`), [t]);
  const categoryLabel = useCallback((category: FeedbackCategory | string) => t(`admin.feedback.categories.${category}`), [t]);
  const sentimentLabel = useCallback((sentiment: string | null) => (
    sentiment ? t(`admin.feedback.sentiments.${sentiment}`) : dateFallback
  ), [dateFallback, t]);
  const yesNo = useCallback((value: boolean) => (
    value ? t('admin.feedback.common.yes') : t('admin.feedback.common.no')
  ), [t]);
  const submitterLabel = useCallback((row: FeedbackRow) => {
    if (row.is_anonymous) {
      return t('admin.feedback.submitter.anonymous');
    }
    return t('admin.feedback.submitter.user', { id: row.submitter_user_id ?? '?' });
  }, [t]);
  const adminSubmitterLabel = useCallback((row: FeedbackRow) => {
    if (row.is_anonymous) {
      // The API no longer returns the submitter of anonymous feedback (F-139).
      if (row.submitter_user_id == null) {
        return t('admin.feedback.submitter.anonymous');
      }
      return t('admin.feedback.submitter.anonymous_admin', { id: row.submitter_user_id });
    }
    return t('admin.feedback.submitter.user', { id: row.submitter_user_id ?? '?' });
  }, [t]);

  const [items, setItems] = useState<FeedbackRow[]>([]);
  const [meta, setMeta] = useState<PaginatedMeta | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [subRegionFilter, setSubRegionFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // Detail modal
  const [selected, setSelected] = useState<FeedbackRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [savingTriage, setSavingTriage] = useState(false);
  const [triageStatus, setTriageStatus] = useState<FeedbackStatus>('new');
  const [triageAssignedUserId, setTriageAssignedUserId] = useState<string>('');
  const [triageAssignedRole, setTriageAssignedRole] = useState<string>('');
  const [triageNotes, setTriageNotes] = useState<string>('');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get<DashboardStats>('/v2/admin/caring-community/feedback/dashboard');
      setStats(res.data ?? null);
    } catch {
      // Non-fatal
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      if (subRegionFilter.trim()) params.set('sub_region_id', subRegionFilter.trim());
      params.set('page', String(page));
      params.set('per_page', '25');

      const res = await api.get<FeedbackRow[]>(
        `/v2/admin/caring-community/feedback?${params.toString()}`,
      );
      setItems(Array.isArray(res.data) ? res.data : []);
      setMeta((res.meta as PaginatedMeta | undefined) ?? null);
    } catch {
      showToast(t('admin.feedback.errors.load'), 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, categoryFilter, subRegionFilter, page, showToast, t]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDetail = useCallback((row: FeedbackRow) => {
    setSelected(row);
    setTriageStatus(row.status);
    setTriageAssignedUserId(row.assigned_user_id !== null ? String(row.assigned_user_id) : '');
    setTriageAssignedRole(row.assigned_role ?? '');
    setTriageNotes(row.triage_notes ?? '');
    setResolutionNotes(row.resolution_notes ?? '');
    setDetailOpen(true);
  }, []);

  const handleSaveTriage = useCallback(async () => {
    if (!selected) return;
    setSavingTriage(true);
    try {
      const res = await api.put<FeedbackRow>(
        `/v2/admin/caring-community/feedback/${selected.id}/triage`,
        {
          status: triageStatus,
          assigned_user_id: triageAssignedUserId.trim() === '' ? null : Number(triageAssignedUserId),
          assigned_role: triageAssignedRole.trim() === '' ? null : triageAssignedRole.trim(),
          triage_notes: triageNotes.trim() === '' ? null : triageNotes.trim(),
        },
      );
      showToast(t('admin.feedback.messages.triage_saved'), 'success');
      if (res.data) setSelected(res.data);
      await loadList();
      await loadStats();
    } catch {
      showToast(t('admin.feedback.errors.save_triage'), 'error');
    } finally {
      setSavingTriage(false);
    }
  }, [selected, triageStatus, triageAssignedUserId, triageAssignedRole, triageNotes, loadList, loadStats, showToast, t]);

  const handleResolve = useCallback(async () => {
    if (!selected) return;
    if (resolutionNotes.trim() === '') {
      showToast(t('admin.feedback.errors.resolution_required'), 'error');
      return;
    }
    setSavingTriage(true);
    try {
      const res = await api.post<FeedbackRow>(
        `/v2/admin/caring-community/feedback/${selected.id}/resolve`,
        { resolution_notes: resolutionNotes.trim() },
      );
      showToast(t('admin.feedback.messages.resolved'), 'success');
      if (res.data) setSelected(res.data);
      await loadList();
      await loadStats();
    } catch {
      showToast(t('admin.feedback.errors.resolve'), 'error');
    } finally {
      setSavingTriage(false);
    }
  }, [selected, resolutionNotes, loadList, loadStats, showToast, t]);

  const handleClose = useCallback(async () => {
    if (!selected) return;
    setSavingTriage(true);
    try {
      const res = await api.post<FeedbackRow>(
        `/v2/admin/caring-community/feedback/${selected.id}/close`,
        {},
      );
      showToast(t('admin.feedback.messages.closed'), 'success');
      if (res.data) setSelected(res.data);
      await loadList();
      await loadStats();
    } catch {
      showToast(t('admin.feedback.errors.close'), 'error');
    } finally {
      setSavingTriage(false);
    }
  }, [selected, loadList, loadStats, showToast, t]);

  const handleExport = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      const url = `/v2/admin/caring-community/feedback/export.csv${params.toString() ? `?${params.toString()}` : ''}`;
      await api.download(url, { filename: 'municipality-feedback-export.csv' });
    } catch {
      showToast(t('admin.feedback.errors.export'), 'error');
    }
  }, [statusFilter, categoryFilter, showToast, t]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.feedback.title')}
        subtitle={t('admin.feedback.subtitle')}
        icon={<Inbox size={20} />}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="tertiary"
              startContent={<RefreshCw size={14} />}
              onPress={() => {
                void loadList();
                void loadStats();
              }}
              isLoading={loading}
            >
              {t('admin.feedback.actions.refresh')}
            </Button>
            {canManage && (
              <Button
                size="sm"
                startContent={<Download size={14} />}
                onPress={handleExport}
              >
                {t('admin.feedback.actions.export_csv')}
              </Button>
            )}
          </div>
        }
      />

      <Card className="border border-accent/30 bg-accent-soft shadow-sm shadow-accent/10 dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('admin.feedback.about.title')}</p>
              <p className="text-muted">{t('admin.feedback.about.body')}</p>
              <p className="text-muted text-xs pt-1">{t('admin.feedback.about.workflow')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Dashboard chips */}
      {stats && (
        <Card>
          <CardBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Chip variant="soft">
                {t('admin.feedback.stats.total_open')}: <span className="font-semibold ml-1">{stats.total_open}</span>
              </Chip>
              <Chip color="default" variant="soft">
                {t('admin.feedback.stats.last_7_days')}: <span className="font-semibold ml-1">{stats.recent_count_7d}</span>
              </Chip>
            </div>
            <Separator />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted mr-2">{t('admin.feedback.stats.by_status')}</span>
              {Object.entries(stats.by_status).map(([k, v]) => (
                <Chip key={k} size="sm" variant="soft">
                  {statusLabel(k)}: {v}
                </Chip>
              ))}
              {Object.keys(stats.by_status).length === 0 && (
                <span className="text-sm text-muted">{t('admin.feedback.empty.stats')}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted mr-2">{t('admin.feedback.stats.by_category')}</span>
              {Object.entries(stats.by_category).map(([k, v]) => (
                <Chip key={k} size="sm" variant="soft" color={CATEGORY_COLOR[k as FeedbackCategory] ?? 'default'}>
                  {categoryLabel(k)}: {v}
                </Chip>
              ))}
            </div>
            {Object.keys(stats.sentiment_distribution).length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wide text-muted mr-2">{t('admin.feedback.stats.sentiment')}</span>
                {Object.entries(stats.sentiment_distribution).map(([k, v]) => (
                  <Chip key={k} size="sm" variant="soft">
                    {sentimentLabel(k)}: {v}
                  </Chip>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Filter bar */}
      <Card>
        <CardBody className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label={t('admin.feedback.filters.status')}
            placeholder={t('admin.feedback.filters.all_statuses')}
            selectedKeys={statusFilter ? [statusFilter] : []}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            variant="secondary"
            size="sm"
          >
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} id={s}>{statusLabel(s)}</SelectItem>
            ))}
          </Select>
          <Select
            label={t('admin.feedback.filters.category')}
            placeholder={t('admin.feedback.filters.all_categories')}
            selectedKeys={categoryFilter ? [categoryFilter] : []}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            variant="secondary"
            size="sm"
          >
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c} id={c}>{categoryLabel(c)}</SelectItem>
            ))}
          </Select>
          <Input
            label={t('admin.feedback.filters.sub_region')}
            placeholder={t('admin.feedback.filters.sub_region_placeholder')}
            value={subRegionFilter}
            onValueChange={(v) => {
              setSubRegionFilter(v);
              setPage(1);
            }}
            variant="secondary"
            size="sm"
          />
        </CardBody>
      </Card>

      {/* Table */}
      <Card>
        <CardBody className="p-0">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-12">
              <Spinner size="lg" />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={t('admin.feedback.empty.title')}
              description={t('admin.feedback.empty.description')}
            />
          ) : (
            <div className="overflow-x-auto">
            <Table
              aria-label={t('admin.feedback.table.aria')}
              removeWrapper
              classNames={{ th: 'bg-surface-secondary text-xs font-semibold uppercase tracking-wide' }}
            >
              <TableHeader>
                <TableColumn>{t('admin.feedback.table.id')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.category')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.subject')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.submitter')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.status')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.created')}</TableColumn>
                <TableColumn>{t('admin.feedback.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-mono text-muted">#{row.id}</TableCell>
                    <TableCell>
                      <Chip size="sm" variant="soft" color={CATEGORY_COLOR[row.category]}>
                        {categoryLabel(row.category)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="tertiary"
                        className="min-h-10 justify-start px-0 text-left font-medium"
                        onPress={() => openDetail(row)}
                      >
                        {row.subject}
                      </Button>
                    </TableCell>
                    <TableCell className="text-xs text-muted">
                      <span className={row.is_anonymous ? 'italic' : undefined}>{submitterLabel(row)}</span>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" variant="soft" color={STATUS_COLOR[row.status]}>
                        {statusLabel(row.status)}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-xs text-muted whitespace-nowrap">
                      {relativeTime(row.created_at, t)}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="tertiary" onPress={() => openDetail(row)}>
                        {t('admin.feedback.actions.view')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
          {meta && meta.total_pages > 1 && (
            <div className="flex items-center justify-between p-3 border-t border-border">
              <span className="text-xs text-muted">
                {t('admin.feedback.pagination.summary', { page: meta.current_page, totalPages: meta.total_pages, total: meta.total })}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={meta.current_page <= 1}
                  onPress={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('admin.feedback.pagination.previous')}
                </Button>
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={!meta.has_more}
                  onPress={() => setPage((p) => p + 1)}
                >
                  {t('admin.feedback.pagination.next')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Detail / triage modal */}
      <Modal isOpen={detailOpen} onOpenChange={setDetailOpen} size="2xl" placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <ModalHeading className="flex items-center gap-2 text-base">
                  <Inbox size={18} className="text-accent" />
                  <span>{t('admin.feedback.modal.title', { id: selected?.id ?? '' })}</span>
                  {selected && (
                    <Chip size="sm" variant="soft" color={STATUS_COLOR[selected.status]} className="ml-2">
                      {statusLabel(selected.status)}
                    </Chip>
                  )}
                </ModalHeading>
                <p className="text-sm font-normal text-muted">{selected?.subject}</p>
              </ModalHeader>
              <ModalBody className="gap-4">
                {selected && (
                  <>
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <span className="text-muted">{t('admin.feedback.modal.category')}: </span>
                        <Chip size="sm" variant="soft" color={CATEGORY_COLOR[selected.category]}>
                          {categoryLabel(selected.category)}
                        </Chip>
                      </div>
                      <div>
                        <span className="text-muted">{t('admin.feedback.modal.submitter')}: </span>
                        {selected.is_anonymous ? (
                          <span className="italic">{adminSubmitterLabel(selected)}</span>
                        ) : (
                          <span>{submitterLabel(selected)}</span>
                        )}
                      </div>
                      <div>
                        <span className="text-muted">{t('admin.feedback.modal.sentiment')}: </span>
                        <span>{sentimentLabel(selected.sentiment_tag)}</span>
                      </div>
                      <div>
                        <span className="text-muted">{t('admin.feedback.modal.sub_region')}: </span>
                        <span>{selected.sub_region_id ?? dateFallback}</span>
                      </div>
                      <div className="sm:col-span-2">
                        <span className="text-muted">{t('admin.feedback.modal.public_visible')}: </span>
                        <span>{yesNo(selected.is_public)}</span>
                      </div>
                      <div className="text-xs text-muted sm:col-span-2">
                        {t('admin.feedback.modal.timestamps', {
                          created: fmtDate(selected.created_at, dateFallback),
                          updated: fmtDate(selected.updated_at, dateFallback),
                        })}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted mb-1">{t('admin.feedback.modal.body')}</p>
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{selected.body}</p>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label={t('admin.feedback.filters.status')}
                        selectedKeys={[triageStatus]}
                        onChange={(e) => setTriageStatus(e.target.value as FeedbackStatus)}
                        variant="secondary"
                        size="sm"
                        isDisabled={!canManage}
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} id={s}>{statusLabel(s)}</SelectItem>
                        ))}
                      </Select>
                      <Input
                        label={t('admin.feedback.fields.assigned_user_id')}
                        placeholder={t('admin.feedback.fields.assigned_user_id_placeholder')}
                        value={triageAssignedUserId}
                        onValueChange={setTriageAssignedUserId}
                        variant="secondary"
                        size="sm"
                        isDisabled={!canManage}
                      />
                      <Input
                        label={t('admin.feedback.fields.assigned_role')}
                        placeholder={t('admin.feedback.fields.assigned_role_placeholder')}
                        value={triageAssignedRole}
                        onValueChange={setTriageAssignedRole}
                        variant="secondary"
                        size="sm"
                        isDisabled={!canManage}
                      />
                    </div>
                    <Textarea
                      label={t('admin.feedback.fields.triage_notes')}
                      placeholder={t('admin.feedback.fields.triage_notes_placeholder')}
                      description={t('admin.feedback.fields.triage_notes_description')}
                      value={triageNotes}
                      onValueChange={setTriageNotes}
                      variant="secondary"
                      size="sm"
                      minRows={2}
                      isDisabled={!canManage}
                    />
                    <Textarea
                      label={t('admin.feedback.fields.resolution_notes')}
                      placeholder={t('admin.feedback.fields.resolution_notes_placeholder')}
                      description={t('admin.feedback.fields.resolution_notes_description')}
                      value={resolutionNotes}
                      onValueChange={setResolutionNotes}
                      variant="secondary"
                      size="sm"
                      minRows={2}
                      isDisabled={!canManage}
                    />
                  </>
                )}
              </ModalBody>
              <ModalFooter className="flex-wrap gap-2">
                <Button variant="tertiary" onPress={onClose} isDisabled={savingTriage}>
                  {t('admin.feedback.actions.cancel')}
                </Button>
                {canManage && (
                  <>
                    <Button
                      color="default"
                      variant="tertiary"
                      startContent={<XCircle size={14} />}
                      onPress={handleClose}
                      isLoading={savingTriage}
                    >
                      {t('admin.feedback.actions.close_no_resolution')}
                    </Button>
                    <Button
                      color="success"
                      startContent={<CheckCircle size={14} />}
                      onPress={handleResolve}
                      isLoading={savingTriage}
                    >
                      {t('admin.feedback.actions.resolve')}
                    </Button>
          <Button onPress={handleSaveTriage} isLoading={savingTriage}>
                      {t('admin.feedback.actions.save_triage')}
                    </Button>
                  </>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
