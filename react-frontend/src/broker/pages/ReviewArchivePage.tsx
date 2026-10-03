// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Review Archive
 * Compliance archive of reviewed broker message copies.
 * Read-only listing with filtering by decision status.
 * Parity: PHP BrokerControlsController::archives()
 *
 * The compliance record, so it can be narrowed by date and exported to CSV
 * with every column the record has (October 2026). Every member name opens
 * the member window; the record itself opens from the Actions column. This
 * page stays read-only — no mutations, ever.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Archive from 'lucide-react/icons/archive';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import Flag from 'lucide-react/icons/flag';
import Inbox from 'lucide-react/icons/inbox';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import SearchX from 'lucide-react/icons/search-x';
import Users from 'lucide-react/icons/users';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { BrokerArchive, BrokerArchiveDetail } from '@/admin/api/types';
import { Avatar, Button, Chip, Input, Tabs, Tab } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import { useCsvExport, type CsvColumn } from '@/broker/useCsvExport';
import { BrokerPageShell, BrokerStatCard, BrokerEmptyState, BrokerSkeleton, BrokerStatusChip } from '../components';
import { BrokerDateRangeFilter, type DateRangeValue } from '../components/messages';

// The list endpoint returns the party and reviewer ids as well; the shared
// BrokerArchive type does not declare them yet, so they are optional here.
type ArchiveRow = BrokerArchive & Partial<Pick<BrokerArchiveDetail, 'sender_id' | 'receiver_id' | 'decided_by'>>;

// The decision filter is driven by the URL so the KPI cards (and any future
// dashboard tiles) can deep-link straight into a filtered archive view.
const ALLOWED_DECISIONS = ['all', 'approved', 'flagged'] as const;
type DecisionFilter = (typeof ALLOWED_DECISIONS)[number];

const EXPORT_PAGE_SIZE = 100;

// Decision chip — 'flagged' keeps its flag-badged danger chip; every other
// decision (approved, or anything unexpected) goes through BrokerStatusChip,
// which names the unknown with a translated "Unknown" rather than a
// capitalised slug.
function DecisionChip({ decision }: { decision: string }) {
  const { t } = useTranslation('broker');
  if (decision !== 'flagged') {
    return <BrokerStatusChip status={decision} />;
  }
  return (
    <Chip size="sm" variant="soft" color="danger">
      <Flag size={12} aria-hidden="true" />
      <Chip.Label>{t('archives.decision_flagged')}</Chip.Label>
    </Chip>
  );
}

/** Reads the paginated total out of a getArchives response. */
function readTotal(res: Awaited<ReturnType<typeof adminBroker.getArchives>>): number | null {
  if (!res.success || !Array.isArray(res.data)) return null;
  const meta = res.meta as Record<string, unknown> | undefined;
  const value = Number(meta?.total ?? meta?.total_items ?? res.data.length);
  return Number.isFinite(value) ? value : null;
}

export function ReviewArchive() {
  const { t } = useTranslation('broker');
  usePageTitle(t('archives.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Deep-linkable decision filter (?decision=approved|flagged) — 'all' keeps
  // the URL clean by dropping the param entirely.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDecision = searchParams.get('decision') as DecisionFilter | null;
  const filter: DecisionFilter = urlDecision && ALLOWED_DECISIONS.includes(urlDecision) ? urlDecision : 'all';
  const setFilter = useCallback(
    (next: DecisionFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') params.delete('decision');
          else params.set('decision', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [items, setItems] = useState<ArchiveRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });

  // Server-side search over both people's names. Debounced so typing doesn't
  // fire a request on every keystroke (same pattern as the Messages page).
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);

  // Whole-archive totals for the Approved / Flagged cards: one-row probes of
  // the list endpoint read for meta.total only, so each card shows the same
  // number its tab would list. Reviewers has no such probe and stays per-page.
  const [archiveTotals, setArchiveTotals] = useState<{ approved: number | null; flagged: number | null }>({
    approved: null,
    flagged: null,
  });
  const [totalsLoading, setTotalsLoading] = useState(true);

  // Stash the latest `t`/`toast` in refs so the fetch effect is keyed on the
  // page/filter/search params only — keeping them in the dep array re-fetches
  // on every language switch and risks a render loop with unstable toast refs.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const listParams = useCallback(
    (overrides: Partial<Parameters<typeof adminBroker.getArchives>[0]> = {}) => ({
      page,
      decision: filter === 'all' ? undefined : filter,
      search: debouncedSearch || undefined,
      from: dateRange.from ?? undefined,
      to: dateRange.to ?? undefined,
      ...overrides,
    }),
    [page, filter, debouncedSearch, dateRange.from, dateRange.to],
  );

  // `quiet` keeps the rows on screen while new ones load (auto-refresh).
  const loadItems = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(false);
      try {
        const res = await adminBroker.getArchives(listParams());
        if (res.success && Array.isArray(res.data)) {
          setItems(res.data as ArchiveRow[]);
          setTotal(readTotal(res) ?? res.data.length);
        } else {
          // A success:false answer is a failure, not an empty archive.
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
        if (!quiet) toastRef.current.error(tRef.current('archives.load_failed'));
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    },
    [listParams],
  );

  const loadArchiveTotals = useCallback(async (quiet = false) => {
    if (!quiet) setTotalsLoading(true);
    try {
      const [approvedRes, flaggedRes] = await Promise.all([
        adminBroker.getArchives({ page: 1, per_page: 1, decision: 'approved' }),
        adminBroker.getArchives({ page: 1, per_page: 1, decision: 'flagged' }),
      ]);
      setArchiveTotals({ approved: readTotal(approvedRes), flagged: readTotal(flaggedRes) });
    } catch {
      // KPI header degrades to em-dashes; the list load owns error messaging.
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadArchiveTotals();
  }, [loadArchiveTotals]);

  const refreshAll = useCallback(
    (quiet = false) => {
      void loadItems(quiet);
      void loadArchiveTotals(quiet);
    },
    [loadItems, loadArchiveTotals],
  );

  // A review elsewhere in the panel adds a record here: refresh quietly.
  useBrokerAutoRefresh(() => refreshAll(true));

  const handleFilterChange = (key: string | number) => {
    setFilter(key as DecisionFilter);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleDateRange = (next: DateRangeValue) => {
    setDateRange(next);
    setPage(1);
  };

  // ── Export — the compliance record, every column it has ──────────────────

  const csv = useCsvExport();
  const exportColumns: CsvColumn<ArchiveRow>[] = [
    { label: t('archives.export_col_id'), value: (row) => row.id },
    { label: t('archives.export_col_archived_at'), value: (row) => formatServerDateTime(row.decided_at) },
    { label: t('archives.col_decision'), value: (row) => (row.decision === 'flagged' ? t('archives.decision_flagged') : t(`status.${row.decision}`)) },
    { label: t('archives.col_sender'), value: (row) => row.sender_name },
    { label: t('archives.col_receiver'), value: (row) => row.receiver_name },
    { label: t('archives.col_decided_by'), value: (row) => row.decided_by_name },
    { label: t('archives.label_decision_notes'), value: (row) => row.decision_notes },
    { label: t('archives.col_listing'), value: (row) => row.listing_title },
    { label: t('archives.col_copy_reason'), value: (row) => t(`archives.copy_reason_${row.copy_reason}`, { defaultValue: row.copy_reason.replace(/_/g, ' ') }) },
    { label: t('archives.label_flag_reason'), value: (row) => row.flag_reason },
    { label: t('archives.label_severity'), value: (row) => (row.flag_severity ? t(`status.${row.flag_severity}`, { defaultValue: row.flag_severity }) : '') },
    { label: t('archives.export_col_created_at'), value: (row) => formatServerDateTime(row.created_at) },
  ];
  const exportCsv = () => {
    const parts = ['broker-review-archive', filter];
    if (debouncedSearch) parts.push('search');
    if (dateRange.from && dateRange.to) parts.push(`${dateRange.from}_${dateRange.to}`);
    void csv.run<ArchiveRow>({
      filename: parts.join('_'),
      columns: exportColumns,
      fetchPage: async (exportPage) => {
        const res = await adminBroker.getArchives(listParams({ page: exportPage, per_page: EXPORT_PAGE_SIZE }));
        if (!res.success || !Array.isArray(res.data)) throw new Error('export');
        const pageTotal = readTotal(res) ?? 0;
        return { rows: res.data as ArchiveRow[], hasMore: exportPage * EXPORT_PAGE_SIZE < pageTotal };
      },
    });
  };

  // Reviewers is the one card still derived from the rows on screen — there
  // is no endpoint that counts distinct reviewers — and its label says so.
  const reviewersInView = new Set(items.map((i) => i.decided_by_name)).size;

  const isFiltered = filter !== 'all' || debouncedSearch !== '' || !!dateRange.from;

  const nameCell = (userId: number | undefined, name: string) => (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={name} size="sm" className="shrink-0" />
      <MemberName userId={userId} name={name} className="min-w-0 truncate text-sm" />
    </div>
  );

  const columns: Column<ArchiveRow>[] = [
    { key: 'sender_name', label: t('archives.col_sender'), sortable: true, render: (item) => nameCell(item.sender_id, item.sender_name) },
    { key: 'receiver_name', label: t('archives.col_receiver'), sortable: true, render: (item) => nameCell(item.receiver_id, item.receiver_name) },
    {
      key: 'listing_title',
      label: t('archives.col_listing'),
      sortable: true,
      render: (item) =>
        item.listing_title ? (
          <span className="line-clamp-1 min-w-0 max-w-[200px] text-sm text-muted">{item.listing_title}</span>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'copy_reason',
      label: t('archives.col_copy_reason'),
      render: (item) => (
        <Chip size="sm" variant="tertiary" color="default">
          {t(`archives.copy_reason_${item.copy_reason}`, { defaultValue: item.copy_reason.replace(/_/g, ' ') })}
        </Chip>
      ),
    },
    { key: 'decision', label: t('archives.col_decision'), render: (item) => <DecisionChip decision={item.decision} /> },
    { key: 'decided_by_name', label: t('archives.col_decided_by'), sortable: true, render: (item) => nameCell(item.decided_by, item.decided_by_name) },
    {
      key: 'decided_at',
      label: t('archives.col_date'),
      sortable: true,
      render: (item) => <span className="text-sm tabular-nums text-muted">{formatServerDate(item.decided_at)}</span>,
    },
    {
      key: 'actions',
      label: t('archives.col_actions'),
      render: (item) => (
        <Button
          as={Link}
          to={tenantPath(`/broker/archives/${item.id}`)}
          size="sm"
          variant="tertiary"
          startContent={<Eye size={14} aria-hidden="true" />}
          aria-label={t('archives.open_record')}
        >
          {t('archives.open_record')}
        </Button>
      ),
    },
  ];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_review_archive' }}
      title={t('archives.title')}
      description={t('archives.description')}
      icon={Archive}
      color="neutral"
      actions={
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download size={16} aria-hidden="true" />}
            onPress={exportCsv}
            isLoading={csv.exporting}
            isDisabled={!hasLoaded || loadError}
          >
            {csv.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<RefreshCw size={16} aria-hidden="true" />}
            onPress={() => refreshAll()}
            isLoading={(loading && hasLoaded) || totalsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-full sm:max-w-xs"
              placeholder={t('archives.search_placeholder')}
              aria-label={t('archives.search_aria')}
              startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
              value={search}
              onValueChange={handleSearchChange}
              size="sm"
              variant="secondary"
              isClearable
              onClear={() => handleSearchChange('')}
            />
            <BrokerDateRangeFilter
              value={dateRange}
              onChange={handleDateRange}
              label={t('archives.date_range_label')}
              clearLabel={t('archives.date_range_clear')}
            />
          </div>
          <Tabs aria-label={t('archives.tabs_aria')} selectedKey={filter} onSelectionChange={handleFilterChange} variant="underlined" size="sm">
            <Tab
              key="all"
              title={
                <div className="flex items-center gap-2">
                  <Inbox size={14} aria-hidden="true" />
                  <span>{t('archives.tab_all')}</span>
                </div>
              }
            />
            <Tab
              key="approved"
              title={
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} aria-hidden="true" />
                  <span>{t('archives.tab_approved')}</span>
                </div>
              }
            />
            <Tab
              key="flagged"
              title={
                <div className="flex items-center gap-2">
                  <Flag size={14} aria-hidden="true" />
                  <span>{t('archives.tab_flagged')}</span>
                </div>
              }
            />
          </Tabs>
        </div>
      }
    >
      {/* KPI header — whole-archive totals, plus the per-page reviewer count */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard label={t('archives.stat_records')} value={total} icon={Archive} color="neutral" loading={!hasLoaded} description={t('archives.stat_records_hint')} />
        <BrokerStatCard
          label={t('archives.stat_approved_total')}
          value={archiveTotals.approved}
          icon={CheckCircle}
          color="success"
          loading={totalsLoading}
          to={tenantPath('/broker/archives?decision=approved')}
          description={t('archives.stat_approved_total_hint')}
        />
        <BrokerStatCard
          label={t('archives.stat_flagged_total')}
          value={archiveTotals.flagged}
          icon={Flag}
          color="danger"
          loading={totalsLoading}
          to={tenantPath('/broker/archives?decision=flagged')}
          description={t('archives.stat_flagged_total_hint')}
        />
        <BrokerStatCard label={t('archives.stat_reviewers')} value={reviewersInView} icon={Users} color="accent" loading={!hasLoaded} description={t('archives.stat_reviewers_hint')} />
      </div>

      {!hasLoaded ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest error state — a failed load must never masquerade as an
        // empty archive.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('archives.error_title')}
          hint={t('archives.error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={() => refreshAll()}>
              {t('archives.retry')}
            </Button>
          }
        />
      ) : (
        <DataTable
          stickyActions
          mobileCards
          columns={columns}
          data={items}
          isLoading={loading}
          searchable={false}
          onRefresh={() => refreshAll()}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={
            <BrokerEmptyState
              bare
              icon={isFiltered ? SearchX : Archive}
              color="neutral"
              title={isFiltered ? t('archives.empty_filtered_title') : t('archives.empty')}
              hint={isFiltered ? t('archives.empty_filtered_hint') : t('archives.empty_hint')}
            />
          }
        />
      )}
    </BrokerPageShell>
  );
}

export default ReviewArchive;
