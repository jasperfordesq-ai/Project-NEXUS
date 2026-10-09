// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import {
  Select, SelectItem, Button, Input, Avatar, Tabs, Tab, Checkbox,
  Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
} from '@/components/ui';

/**
 * Volunteer Approvals
 * The community's volunteer applications, one page at a time. Search, the
 * status tabs, the opportunity filter and the tab counts all run on the server
 * (gap D5, 7 Oct 2026): this page used to load one list capped at 150 rows and
 * filter it here, so a busy community silently lost its oldest applications from
 * every tab, count, search and export. The filters live in the address so a
 * reload or a shared link keeps them.
 *
 * Every row has a menu (8 Oct 2026): before, a decided row offered nothing at
 * all, so an approved volunteer could not be removed from an opportunity.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Search from 'lucide-react/icons/search';
import Download from 'lucide-react/icons/download';
import EllipsisVertical from 'lucide-react/icons/ellipsis-vertical';
import UserRound from 'lucide-react/icons/user-round';
import ExternalLink from 'lucide-react/icons/external-link';
import Mail from 'lucide-react/icons/mail';
import UserMinus from 'lucide-react/icons/user-minus';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
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
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
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
  const [removeTarget, setRemoveTarget] = useState<AdminVolunteerApplication | null>(null);

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

  const handleRemove = useCallback(async (item: AdminVolunteerApplication) => {
    setActionId(item.id);
    try {
      const res = await adminVolunteering.removeVolunteer(item.id);
      if (res.success) {
        toast.success(t('volunteering.approvals_removed'));
        void loadData();
      } else {
        toast.error(t('volunteering.approvals_remove_failed'));
      }
    } catch {
      toast.error(t('volunteering.approvals_remove_failed'));
    } finally {
      setActionId(null);
      setRemoveTarget(null);
    }
  }, [loadData, toast, t]);

  const handleRowAction = useCallback((item: AdminVolunteerApplication, action: string) => {
    switch (action) {
      case 'member':
        navigate(tenantPath(`/admin/users/${item.user_id}/edit`));
        break;
      case 'opportunity':
        window.open(tenantPath(`/volunteering/opportunities/${item.opportunity_id}`), '_blank', 'noopener');
        break;
      case 'email':
        if (item.email) window.location.href = `mailto:${item.email}`;
        break;
      case 'approve':
        void handleApprove(item.id);
        break;
      case 'decline':
        setDeclineConfirmId(item.id);
        break;
      case 'remove':
        setRemoveTarget(item);
        break;
    }
  }, [handleApprove, navigate, tenantPath]);

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

  const formatDate = (value: string | null | undefined) =>
    value ? new Date(value).toLocaleDateString(getFormattingLocale()) : '—';

  const renderRowMenu = (item: AdminVolunteerApplication) => {
    const name = resolveUserDisplayName(item);
    const busy = actionId === item.id;
    return (
      <Dropdown placement="bottom end">
        <DropdownTrigger>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            aria-label={t('volunteering.approvals_row_actions', { name })}
            isDisabled={bulkLoading || (actionId !== null && !busy)}
            isLoading={busy && item.status !== 'pending'}
          >
            <EllipsisVertical size={16} />
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={t('volunteering.approvals_row_actions', { name })}
          onAction={(key) => handleRowAction(item, String(key))}
        >
          <DropdownItem key="member" id="member" startContent={<UserRound size={14} />}>
            {t('volunteering.approvals_view_member')}
          </DropdownItem>
          <DropdownItem key="opportunity" id="opportunity" startContent={<ExternalLink size={14} />}>
            {t('volunteering.approvals_view_opportunity')}
          </DropdownItem>
          {item.email ? (
            <DropdownItem key="email" id="email" startContent={<Mail size={14} />}>
              {t('volunteering.approvals_email_applicant')}
            </DropdownItem>
          ) : null}
          {item.status === 'approved' ? (
            <DropdownItem key="remove" id="remove" color="danger" startContent={<UserMinus size={14} />}>
              {t('volunteering.approvals_remove')}
            </DropdownItem>
          ) : null}
        </DropdownMenu>
      </Dropdown>
    );
  };

  const allPendingSelected = pendingItems.length > 0 && selectedIds.size === pendingItems.length;

  const columns: Column<AdminVolunteerApplication>[] = [
    // Only pending applications can be decided in bulk, so the tick column
    // only appears when this page has one.
    ...(pendingItems.length > 0 ? [{
      key: 'select',
      label: (
        <Checkbox
          isSelected={allPendingSelected}
          isIndeterminate={selectedIds.size > 0 && !allPendingSelected}
          onValueChange={handleSelectAll}
          aria-label={t('volunteering.select_all')}
        />
      ),
      hideInCard: true,
      render: (item: AdminVolunteerApplication) => (
        item.status === 'pending' ? (
          <Checkbox
            isSelected={selectedIds.has(item.id)}
            onValueChange={() => handleToggleSelect(item.id)}
            aria-label={t('volunteering.select_application')}
          />
        ) : null
      ),
    }] : []),
    {
      key: 'applicant', label: t('volunteering.col_applicant'), isRowHeader: true,
      render: (item) => (
        <Link
          to={tenantPath(`/admin/users/${item.user_id}/edit`)}
          className="group flex min-w-0 max-w-[15rem] items-center gap-3"
        >
          <Avatar name={resolveUserDisplayName(item)} size="sm" className="shrink-0" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-foreground group-hover:text-accent">{resolveUserDisplayName(item)}</span>
            <span className="block truncate text-xs text-muted">{item.email}</span>
          </span>
        </Link>
      ),
    },
    {
      key: 'opportunity_title', label: t('volunteering.col_opportunity'),
      render: (item) => (
        <span className="block max-w-[16rem] whitespace-normal">
          <span className="block text-sm text-foreground">{item.opportunity_title}</span>
          {/* Narrower screens drop the Applied column; the date moves here so
              the table never has to scroll sideways. */}
          <span className="block text-xs text-muted 2xl:hidden">
            {t('volunteering.col_applied')}: {formatDate(item.created_at)}
          </span>
        </span>
      ),
    },
    {
      key: 'status', label: t('volunteering.col_status'),
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at', label: t('volunteering.col_applied'), hideBelow: '2xl', hideInCard: true,
      render: (item) => <span className="whitespace-nowrap text-sm text-muted">{formatDate(item.created_at)}</span>,
    },
    {
      key: 'actions', label: <span className="sr-only">{t('volunteering.col_actions')}</span>,
      render: (item) => (
        <div className="flex items-center justify-end gap-1.5">
          {item.status === 'pending' && (
            <>
              <Button
                size="sm"
                variant="secondary"
                startContent={<CheckCircle size={14} />}
                onPress={() => handleApprove(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkLoading || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.approve')}
              </Button>
              <Button
                size="sm"
                variant="danger-soft"
                startContent={<XCircle size={14} />}
                onPress={() => setDeclineConfirmId(item.id)}
                isDisabled={bulkLoading || actionId !== null}
              >
                {t('volunteering.decline')}
              </Button>
            </>
          )}
          {renderRowMenu(item)}
        </div>
      ),
    },
  ];

  const opportunityItems = useMemo(() => [
    { key: '0', label: t('volunteering.approvals_all_opportunities') },
    ...opportunities.map((o) => ({ key: String(o.id), label: o.title })),
  ], [opportunities, t]);

  // Filters sit in their own bar above the table (the same layout as the
  // Organisations page), not squeezed into the table's header slot.
  const toolbar = (
    <div className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <div className="flex flex-wrap items-center justify-between gap-3 p-3">
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

        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <Input type="search" name="admin-search" autoComplete="off"
            className="w-full sm:w-64"
            placeholder={t('volunteering.search_applicants')}
            aria-label={t('volunteering.search_applicants')}
            startContent={<Search size={16} className="text-muted" />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable={searchInput !== ''}
            onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
          />

          {opportunities.length > 1 && (
            <Select
              className="w-full sm:w-60"
              aria-label={t('volunteering.filter_opportunity')}
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

          {/* Export — every matching application, not just this page */}
          <Button
            variant="secondary"
            startContent={<Download size={16} />}
            onPress={() => void handleExport()}
            isLoading={exporting}
            isDisabled={total === 0}
          >
            {t('volunteering.export')}
          </Button>
        </div>
      </div>

      {/* Bulk actions — confirmed via ConfirmModal before firing */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-divider/70 bg-surface-secondary/40 px-3 py-2">
          <span className="mr-auto text-sm font-medium text-foreground">
            {t('volunteering.selected_count', { count: selectedIds.size })}
          </span>
          <Button size="sm" variant="ghost" onPress={() => setSelectedIds(new Set())} isDisabled={bulkLoading}>
            {t('volunteering.clear_selection')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            startContent={<CheckCircle size={14} />}
            onPress={() => setBulkConfirmAction('approve')}
            isLoading={bulkLoading}
          >
            {t('volunteering.bulk_approve', { count: selectedIds.size })}
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            startContent={<XCircle size={14} />}
            onPress={() => setBulkConfirmAction('decline')}
            isLoading={bulkLoading}
          >
            {t('volunteering.bulk_decline', { count: selectedIds.size })}
          </Button>
        </div>
      )}
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
      {toolbar}
      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchable={false}
        mobileCards
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

      {/* Remove an approved volunteer from the opportunity */}
      <ConfirmModal
        isOpen={removeTarget !== null}
        onClose={() => { if (actionId === null) setRemoveTarget(null); }}
        onConfirm={() => { if (removeTarget) void handleRemove(removeTarget); }}
        title={t('volunteering.approvals_remove_title')}
        message={removeTarget ? t('volunteering.approvals_remove_confirm', {
          name: resolveUserDisplayName(removeTarget),
          opportunity: removeTarget.opportunity_title,
        }) : ''}
        confirmLabel={t('volunteering.approvals_remove_button')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={removeTarget !== null && actionId === removeTarget.id}
      />
    </div>
  );
}

export default VolunteerApprovals;
