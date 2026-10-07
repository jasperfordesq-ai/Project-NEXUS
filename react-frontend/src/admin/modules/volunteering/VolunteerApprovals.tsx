// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Select, SelectItem, Button, Input, Avatar, Tabs, Tab, Checkbox } from '@/components/ui';

/**
 * Volunteer Approvals
 * The community's volunteer applications, one page at a time. Search, the
 * status tabs, the opportunity filter and the tab counts all run on the server
 * (gap D5, 7 Oct 2026): this page used to load one list capped at 150 rows and
 * filter it here, so a busy community silently lost its oldest applications from
 * every tab, count, search and export. The filters live in the address so a
 * reload or a shared link keeps them.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Search from 'lucide-react/icons/search';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import {
  adminVolunteering,
  type AdminVolunteerApplication,
  type VolunteerApplicationsPage,
  type VolunteerApplicationsQuery,
} from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';

import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 25;
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 200;
const SEARCH_DEBOUNCE_MS = 350;
const STATUS_TABS = ['all', 'pending', 'approved', 'declined'] as const;
type StatusTab = (typeof STATUS_TABS)[number];
const isStatusTab = (value: string | null): value is StatusTab =>
  value !== null && (STATUS_TABS as readonly string[]).includes(value);

type Counts = VolunteerApplicationsPage['counts'];
const EMPTY_COUNTS: Counts = { all: 0, pending: 0, approved: 0, declined: 0 };

// Prefix cells that spreadsheet apps would treat as formulas (=, +, -, @)
// so member-supplied text can't execute when the CSV is opened in Excel.
function csvCell(value: unknown): string {
  const str = String(value ?? '');
  return JSON.stringify(/^[=+\-@\t\r]/.test(str) ? `'${str}` : str);
}

function exportToCsv(headers: string[], rows: unknown[][], filename: string) {
  if (rows.length === 0) return;
  const csv = [
    headers.map(csvCell).join(','),
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function VolunteerApprovals() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.volunteer_approvals_title'));
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- Filters: the address is the source of truth -----
  const rawStatus = searchParams.get('status');
  const statusTab: StatusTab = isStatusTab(rawStatus) ? rawStatus : 'all';
  const searchQuery = searchParams.get('q') || '';
  const opportunityFilter = Math.max(0, parseInt(searchParams.get('opportunity') || '0', 10) || 0);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const hasFilters = Boolean(searchQuery) || opportunityFilter > 0;

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

  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSearchInput(searchQuery); }, [searchQuery]);
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setFilter({ q: value.trim() || null }), SEARCH_DEBOUNCE_MS);
  }, [setFilter]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // ----- List state -----
  const [items, setItems] = useState<AdminVolunteerApplication[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [opportunities, setOpportunities] = useState<VolunteerApplicationsPage['opportunities']>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [actionId, setActionId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkConfirmAction, setBulkConfirmAction] = useState<'approve' | 'decline' | null>(null);
  const [declineConfirmId, setDeclineConfirmId] = useState<number | null>(null);

  const filterParams = useMemo((): VolunteerApplicationsQuery => {
    const params: VolunteerApplicationsQuery = {};
    if (statusTab !== 'all') params.status = statusTab;
    if (searchQuery) params.q = searchQuery;
    if (opportunityFilter > 0) params.opportunity_id = opportunityFilter;
    return params;
  }, [statusTab, searchQuery, opportunityFilter]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getApprovals({ ...filterParams, page, per_page: PAGE_SIZE });
      if (res.success && res.data) {
        const rows = Array.isArray(res.data.items) ? res.data.items : [];
        setItems(rows);
        setTotal(Number(res.data.total ?? rows.length) || 0);
        setCounts({ ...EMPTY_COUNTS, ...(res.data.counts ?? {}) });
        setOpportunities(Array.isArray(res.data.opportunities) ? res.data.opportunities : []);
        setHasLoaded(true);
      } else {
        toast.error(t('volunteering.failed_to_load_approvals'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_approvals'));
    }
    setLoading(false);
    setSelectedIds(new Set());
  }, [filterParams, page, toast, t]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleApprove = useCallback(async (id: number) => {
    setActionId(id);
    try {
      const res = await adminVolunteering.approveApplication(id);
      if (res.success) {
        toast.success(t('volunteering.application_approved'));
        void loadData();
      } else {
        toast.error(t('volunteering.failed_to_approve_application'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_approve_application'));
    } finally {
      setActionId(null);
    }
  }, [loadData, toast, t]);

  const handleDecline = useCallback(async (id: number) => {
    setActionId(id);
    try {
      const res = await adminVolunteering.declineApplication(id);
      if (res.success) {
        toast.success(t('volunteering.application_declined'));
        void loadData();
      } else {
        toast.error(t('volunteering.failed_to_decline_application'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_decline_application'));
    } finally {
      setActionId(null);
    }
  }, [loadData, toast, t]);

  // Pending applications on the page being shown — the only ones that can be selected.
  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);

  // Bulk operations act on the selected rows of this page, and both are gated
  // behind a ConfirmModal (see bulkConfirmAction).
  const runBulk = useCallback(async (action: 'approve' | 'decline') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    let successCount = 0;
    const pendingIds = new Set(pendingItems.map((item) => item.id));
    for (const id of selectedIds) {
      if (!pendingIds.has(id)) continue;
      try {
        const res = action === 'approve'
          ? await adminVolunteering.approveApplication(id)
          : await adminVolunteering.declineApplication(id);
        if (res.success) successCount++;
      } catch { /* continue with the rest */ }
    }
    toast.success(t(action === 'approve' ? 'volunteering.bulk_approved' : 'volunteering.bulk_declined', { count: successCount }));
    setBulkLoading(false);
    setBulkConfirmAction(null);
    void loadData();
  }, [loadData, pendingItems, selectedIds, toast, t]);

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === pendingItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingItems.map((i) => i.id)));
    }
  }, [pendingItems, selectedIds.size]);

  // The export covers every application matching the filters, not just this page.
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const all: AdminVolunteerApplication[] = [];
      let exportPage = 1;
      let truncated = false;
      for (;;) {
        const res = await adminVolunteering.getApprovals({ ...filterParams, page: exportPage, per_page: EXPORT_PAGE_SIZE });
        if (!res.success || !res.data) throw new Error('export page failed');
        all.push(...(res.data.items ?? []));
        if (exportPage * EXPORT_PAGE_SIZE >= (res.data.total ?? 0)) break;
        if (exportPage >= MAX_EXPORT_PAGES) { truncated = true; break; }
        exportPage++;
      }
      const headers = [
        t('volunteering.export_columns.name'),
        t('volunteering.export_columns.email'),
        t('volunteering.export_columns.opportunity'),
        t('volunteering.export_columns.status'),
        t('volunteering.export_columns.applied'),
      ];
      const rows = all.map((item) => [
        resolveUserDisplayName(item),
        item.email,
        item.opportunity_title,
        t(`volunteering.status_${item.status}`, { defaultValue: t('volunteering.status_unknown') }),
        item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '',
      ]);
      exportToCsv(headers, rows, 'volunteer-approvals.csv');
      if (truncated) {
        toast.warning(t('volunteering.export_truncated', { count: MAX_EXPORT_PAGES }));
      } else {
        toast.success(t('volunteering.export_success'));
      }
    } catch {
      toast.error(t('volunteering.export_failed'));
    }
    setExporting(false);
  }, [filterParams, toast, t]);

  const columns: Column<AdminVolunteerApplication>[] = [
    {
      key: 'select', label: '',
      render: (item) => (
        item.status === 'pending' ? (
          <Checkbox
            isSelected={selectedIds.has(item.id)}
            onValueChange={() => handleToggleSelect(item.id)}
            aria-label={t('volunteering.select_application')}
          />
        ) : null
      ),
    },
    {
      key: 'applicant', label: t('volunteering.col_applicant'),
      render: (item) => (
        <div className="flex items-center gap-3">
          <Avatar name={resolveUserDisplayName(item)} size="sm" className="ring-2 ring-surface" />
          <div>
            <p className="font-medium text-foreground">{resolveUserDisplayName(item)}</p>
            <p className="text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'opportunity_title', label: t('volunteering.col_opportunity') },
    {
      key: 'status', label: t('volunteering.col_status'),
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at', label: t('volunteering.col_applied'),
      render: (item) => <span className="text-sm text-muted">{item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '--'}</span>,
    },
    {
      key: 'actions', label: t('volunteering.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.status === 'pending' && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle size={14} />}
                onPress={() => handleApprove(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkLoading || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                startContent={<XCircle size={14} />}
                onPress={() => setDeclineConfirmId(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkLoading || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.decline')}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const opportunityItems = useMemo(() => [
    { key: '0', label: t('volunteering.tab_all') },
    ...opportunities.map((o) => ({ key: String(o.id), label: o.title })),
  ], [opportunities, t]);

  // Top content: search + filters + bulk actions
  const topContent = (
    <div className="flex flex-col gap-4 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
      {/* Status Tabs */}
      <Tabs
        aria-label={t('volunteering.approvals_tabs_aria')}
        selectedKey={statusTab}
        onSelectionChange={(key) => setFilter({ status: key === 'all' ? null : String(key) })}
        variant="underlined"
        size="sm"
      >
        <Tab key="all" title={`${t('volunteering.tab_all')} (${counts.all})`} />
        <Tab key="pending" title={`${t('volunteering.tab_pending')} (${counts.pending})`} />
        <Tab key="approved" title={`${t('volunteering.tab_approved')} (${counts.approved})`} />
        <Tab key="declined" title={`${t('volunteering.declined')} (${counts.declined})`} />
      </Tabs>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          {/* Search */}
          <Input type="search" name="admin-search" autoComplete="off"
            className="max-w-xs"
            placeholder={t('volunteering.search_applicants')}
            aria-label={t('volunteering.search_applicants')}
            startContent={<Search size={16} className="text-muted" />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable
            onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
            size="sm"
          />

          {/* Opportunity filter */}
          {opportunities.length > 1 && (
            <Select
              className="max-w-[220px]"
              label={t('volunteering.filter_opportunity')}
              size="sm"
              selectedKeys={new Set([String(opportunityFilter)])}
              onSelectionChange={(keys) => {
                const val = String(Array.from(keys)[0] ?? '0');
                setFilter({ opportunity: val === '0' ? null : val });
              }}
              items={opportunityItems}
            >
              {(item) => <SelectItem key={item.key} id={item.key}>{item.label}</SelectItem>}
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Select all pending on this page */}
          {pendingItems.length > 0 && (
            <Checkbox
              isSelected={selectedIds.size === pendingItems.length && pendingItems.length > 0}
              isIndeterminate={selectedIds.size > 0 && selectedIds.size < pendingItems.length}
              onValueChange={handleSelectAll}
              size="sm"
            >
              <span className="text-xs text-muted">
                {selectedIds.size > 0
                  ? t('volunteering.selected_count', { count: selectedIds.size })
                  : t('volunteering.select_all')}
              </span>
            </Checkbox>
          )}

          {/* Bulk actions — confirmed via ConfirmModal before firing */}
          {selectedIds.size > 0 && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle size={14} />}
                onPress={() => setBulkConfirmAction('approve')}
                isLoading={bulkLoading}
              >
                {t('volunteering.bulk_approve', { count: selectedIds.size })}
              </Button>
              <Button
                size="sm"
                variant="danger"
                startContent={<XCircle size={14} />}
                onPress={() => setBulkConfirmAction('decline')}
                isLoading={bulkLoading}
              >
                {t('volunteering.bulk_decline', { count: selectedIds.size })}
              </Button>
            </>
          )}

          {/* Export — every matching application, not just this page */}
          <Button
            size="sm"
            variant="tertiary"
            startContent={<Download size={14} />}
            onPress={() => void handleExport()}
            isLoading={exporting}
            isDisabled={total === 0}
          >
            {t('volunteering.export')}
          </Button>
        </div>
      </div>
    </div>
  );

  if (hasLoaded && !loading && counts.all === 0 && !hasFilters) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('volunteering.volunteer_approvals_title')} description={t('volunteering.volunteer_approvals_desc')} />
        <EmptyState icon={ClipboardCheck} title={t('volunteering.no_pending_approvals')} description={t('volunteering.desc_all_volunteer_applications_have_been_rev')} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.volunteer_approvals_title')}
        description={t('volunteering.volunteer_approvals_desc')}
        actions={<Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={() => void loadData()} isLoading={loading}>{t('volunteering.refresh')}</Button>}
      />
      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        onRefresh={() => void loadData()}
        searchable={false}
        topContent={topContent}
        totalItems={total}
        page={page}
        pageSize={PAGE_SIZE}
        onPageChange={(next) => updateParams({ page: next > 1 ? String(next) : null })}
        emptyContent={hasFilters ? t('volunteering.approvals_no_match') : undefined}
      />

      {/* Bulk approve/decline confirmation */}
      <ConfirmModal
        isOpen={bulkConfirmAction !== null}
        onClose={() => { if (!bulkLoading) setBulkConfirmAction(null); }}
        onConfirm={() => runBulk(bulkConfirmAction === 'approve' ? 'approve' : 'decline')}
        title={bulkConfirmAction === 'approve'
          ? t('volunteering.bulk_approve_title')
          : t('volunteering.bulk_decline_title')}
        message={bulkConfirmAction === 'approve'
          ? t('volunteering.bulk_approve_confirm', { count: selectedIds.size })
          : t('volunteering.bulk_decline_confirm', { count: selectedIds.size })}
        confirmLabel={bulkConfirmAction === 'approve' ? t('volunteering.approve') : t('volunteering.decline')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor={bulkConfirmAction === 'approve' ? 'primary' : 'danger'}
        isLoading={bulkLoading}
      />

      {/* Single-row decline confirmation — a misclick must not decline instantly */}
      <ConfirmModal
        isOpen={declineConfirmId !== null}
        onClose={() => { if (actionId === null) setDeclineConfirmId(null); }}
        onConfirm={async () => {
          if (declineConfirmId !== null) {
            await handleDecline(declineConfirmId);
          }
          setDeclineConfirmId(null);
        }}
        title={t('volunteering.decline')}
        message={t('volunteering.decline_confirm')}
        confirmLabel={t('volunteering.decline')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={actionId !== null && actionId === declineConfirmId}
      />
    </div>
  );
}

export default VolunteerApprovals;
