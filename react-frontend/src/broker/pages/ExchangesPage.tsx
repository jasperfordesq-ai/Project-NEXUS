// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Exchange Management
 * List and manage exchange requests with approve/reject actions,
 * restyled to the broker design language: KPI header, deep-linkable
 * status tabs and date range, party names that open the member window,
 * BrokerStatusChip statuses, CSV export, quiet auto-refresh.
 * Parity: PHP BrokerControlsController::exchanges()
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import AlertCircle from 'lucide-react/icons/circle-alert';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import Inbox from 'lucide-react/icons/inbox';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { ExchangeRequest } from '@/admin/api/types';
import { Button, Avatar } from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';
import { ExchangeDecisionModal, type ExchangeDecisionType } from '../components/exchanges/ExchangeDecisionModal';
import { ExchangeStatusTabs, EXCHANGE_STATUSES, type ExchangeStatus } from '../components/exchanges/ExchangeStatusTabs';
import { ExchangeDateRangeFilter } from '../components/exchanges/ExchangeDateRangeFilter';
import { MemberName } from '../BrokerMemberWindow';
import { useBrokerAutoRefresh } from '../useBrokerAutoRefresh';
import { useCsvExport } from '../useCsvExport';

type ExchangeListParams = Parameters<typeof adminBroker.getExchanges>[0];

/**
 * The list endpoint also returns who decided and when (for the export);
 * `adminApi.ts` does not carry these two fields yet.
 */
type ExchangeRow = ExchangeRequest & { broker_name?: string | null; broker_decided_at?: string | null };

/** Rows per page while exporting — the endpoint's maximum. */
const EXPORT_PAGE_SIZE = 100;

/** A Y-m-d string from the URL, or null for anything else. */
function readDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** Reads the paginated total out of a getExchanges response (same meta shape the list load uses). */
function readTotal(res: Awaited<ReturnType<typeof adminBroker.getExchanges>>): number | null {
  if (!res.success || !Array.isArray(res.data)) return null;
  const meta = res.meta as Record<string, unknown> | undefined;
  const value = Number(meta?.total ?? meta?.total_items ?? res.data.length);
  return Number.isFinite(value) ? value : null;
}

/** True when a page of results has a further page behind it. */
function readHasMore(res: Awaited<ReturnType<typeof adminBroker.getExchanges>>, page: number): boolean {
  const meta = res.meta as Record<string, unknown> | undefined;
  if (typeof meta?.has_more === 'boolean') return meta.has_more;
  const totalPages = Number(meta?.total_pages);
  return Number.isFinite(totalPages) ? page < totalPages : false;
}

export function ExchangeManagement() {
  const { t } = useTranslation('broker');
  usePageTitle(t('exchanges.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const csv = useCsvExport();

  // Status and date range are mirrored to the URL so stat-card deep-links and
  // browser back/forward work as expected.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') as ExchangeStatus | null;
  const status: ExchangeStatus =
    urlStatus && EXCHANGE_STATUSES.includes(urlStatus) ? urlStatus : 'all';
  const from = readDate(searchParams.get('from'));
  const to = readDate(searchParams.get('to'));
  const [page, setPage] = useState(1);

  const setParams = useCallback(
    (changes: Record<string, string | null>) => {
      setPage(1);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null) params.delete(key);
            else params.set(key, value);
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const setStatus = (next: ExchangeStatus) => setParams({ status: next === 'all' ? null : next });
  const setDates = (nextFrom: string | null, nextTo: string | null) => setParams({ from: nextFrom, to: nextTo });

  const [items, setItems] = useState<ExchangeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // KPI header state. There is no dedicated exchange-stats endpoint, so the
  // header reuses the page's own list endpoint: one probe per card reading
  // only meta.total (per_page 1 keeps the probes cheap). The cards and the
  // tab badges read the same numbers, so a card can never disagree with its list.
  const [stats, setStats] = useState<{
    total: number | null;
    pending: number | null;
    needsAction: number | null;
    disputed: number | null;
  }>({ total: null, pending: null, needsAction: null, disputed: null });
  const [statsLoading, setStatsLoading] = useState(true);

  const [decision, setDecision] = useState<{ type: ExchangeDecisionType; item: ExchangeRow } | null>(null);

  // Stash the latest `t`/`toast` in refs so the fetch callbacks key on the
  // page/filter params only — otherwise a language switch (or an unstable
  // toast identity) would refetch the whole list for no reason.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // The current filter as request params; `from`/`to` are accepted by the
  // endpoint but not yet declared on adminApi's type, hence the cast.
  const filterParams = useCallback(
    (extra: ExchangeListParams): ExchangeListParams => ({
      ...extra,
      status: status === 'all' ? undefined : status,
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    } as ExchangeListParams),
    [status, from, to],
  );

  // `quiet` refreshes (auto-refresh after a write, tab focus, interval) keep
  // the current rows on screen instead of flashing a loading state.
  const loadItems = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getExchanges(filterParams({ page }));
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as ExchangeRow[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      if (!quiet) toastRef.current.error(tRef.current('exchanges.load_failed'));
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [page, filterParams]);

  const loadStats = useCallback(async (quiet = false) => {
    if (!quiet) setStatsLoading(true);
    try {
      const [allRes, pendingRes, needsActionRes, disputedRes] = await Promise.all([
        adminBroker.getExchanges({ page: 1, per_page: 1 }),
        adminBroker.getExchanges({ page: 1, per_page: 1, status: 'pending_broker' }),
        adminBroker.getExchanges({ page: 1, per_page: 1, status: 'needs_action' }),
        adminBroker.getExchanges({ page: 1, per_page: 1, status: 'disputed' }),
      ]);
      setStats({
        total: readTotal(allRes),
        pending: readTotal(pendingRes),
        needsAction: readTotal(needsActionRes),
        disputed: readTotal(disputedRes),
      });
    } catch {
      // KPI header degrades to em-dashes; the list load owns error messaging.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const refreshAll = () => {
    void loadItems();
    void loadStats();
  };
  useBrokerAutoRefresh(() => {
    void loadItems(true);
    void loadStats(true);
  });

  const exportCsv = () =>
    csv.run<ExchangeRow>({
      filename: ['exchanges', status, from && to ? `${from}_${to}` : null].filter(Boolean).join('_'),
      columns: [
        { label: t('exchanges.detail_created_label'), value: (row) => formatServerDateTime(row.created_at) },
        { label: t('exchanges.col_status'), value: (row) => t(`status.${row.status}`, { defaultValue: row.status }) },
        { label: t('exchanges.col_requester'), value: (row) => row.requester_name },
        { label: t('exchanges.col_provider'), value: (row) => row.provider_name },
        { label: t('exchanges.col_listing'), value: (row) => row.listing_title ?? '' },
        { label: t('exchanges.col_hours'), value: (row) => row.final_hours ?? '' },
        { label: t('exchanges.col_broker'), value: (row) => row.broker_name ?? '' },
        {
          label: t('exchanges.col_decided_at'),
          value: (row) => (row.broker_decided_at ? formatServerDateTime(row.broker_decided_at) : ''),
        },
      ],
      fetchPage: async (exportPage) => {
        const res = await adminBroker.getExchanges(filterParams({ page: exportPage, per_page: EXPORT_PAGE_SIZE }));
        if (!res.success || !Array.isArray(res.data)) throw new Error('export page failed');
        return { rows: res.data as ExchangeRow[], hasMore: readHasMore(res, exportPage) };
      },
    });

  // Carry the current tab into the detail link so its Back button can return
  // to the same tab instead of the unfiltered list.
  const detailPath = (exchangeId: number) =>
    status === 'all' ? `/broker/exchanges/${exchangeId}` : `/broker/exchanges/${exchangeId}?queue=${status}`;

  const columns: Column<ExchangeRow>[] = [
    {
      key: 'parties',
      label: t('exchanges.col_parties'),
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.requester_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              <MemberName userId={item.requester_id} name={item.requester_name} />
            </p>
            <p className="truncate text-xs text-muted">{t('exchanges.col_requester')}</p>
          </div>
          <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
          <Avatar name={item.provider_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              <MemberName userId={item.provider_id} name={item.provider_name} />
            </p>
            <p className="truncate text-xs text-muted">{t('exchanges.col_provider')}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'listing_title',
      label: t('exchanges.col_listing'),
      sortable: true,
      render: (item) => (
        <span className="block max-w-[220px] truncate text-sm text-foreground/70">
          {item.listing_title || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('exchanges.col_status'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.status} />,
    },
    {
      key: 'final_hours',
      label: t('exchanges.col_hours'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-foreground">
          {item.final_hours != null
            ? t('exchanges.settle_hours_value', { count: Number(item.final_hours) })
            : '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t('exchanges.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('exchanges.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            as={Link}
            to={tenantPath(detailPath(item.id))}
            aria-label={t('exchanges.view_details_aria')}
          >
            <Eye size={14} />
          </Button>
          {item.status === 'pending_broker' && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                onPress={() => setDecision({ type: 'approve', item })}
                aria-label={t('exchanges.approve_aria')}
              >
                <CheckCircle size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                onPress={() => setDecision({ type: 'reject', item })}
                aria-label={t('exchanges.reject_aria')}
              >
                <XCircle size={14} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const isActionQueue = status === 'pending_broker' || status === 'needs_action';

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_exchanges', articleId: 'broker_exchange_list' }}
      title={t('exchanges.title')}
      description={t('exchanges.description')}
      icon={ArrowLeftRight}
      color="accent"
      actions={
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download size={16} aria-hidden="true" />}
            onPress={() => void exportCsv()}
            isLoading={csv.exporting}
            isDisabled={initialLoad}
          >
            {csv.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<RefreshCw size={16} />}
            onPress={refreshAll}
            isLoading={loading && statsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-col gap-2">
          <ExchangeStatusTabs
            status={status}
            onChange={setStatus}
            counts={{ needsAction: stats.needsAction, pending: stats.pending }}
          />
          <div className="px-1 pb-1">
            <ExchangeDateRangeFilter from={from} to={to} onChange={setDates} />
          </div>
        </div>
      }
    >
      {/* KPI header — deep-links into the matching filtered view */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('exchanges.stat_total')}
          value={stats.total}
          icon={ArrowLeftRight}
          color="accent"
          loading={statsLoading}
          description={t('exchanges.stat_total_hint')}
          to={tenantPath('/broker/exchanges')}
        />
        <BrokerStatCard
          label={t('exchanges.stat_pending')}
          value={stats.pending}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          description={t('exchanges.stat_pending_hint')}
          to={tenantPath('/broker/exchanges?status=pending_broker')}
        />
        <BrokerStatCard
          label={t('exchanges.stat_needs_action')}
          value={stats.needsAction}
          icon={AlertCircle}
          color="accent"
          loading={statsLoading}
          description={t('exchanges.stat_needs_action_hint')}
          to={tenantPath('/broker/exchanges?status=needs_action')}
        />
        <BrokerStatCard
          label={t('exchanges.stat_disputed')}
          value={stats.disputed}
          icon={AlertTriangle}
          color="danger"
          loading={statsLoading}
          description={t('exchanges.stat_disputed_hint')}
          to={tenantPath('/broker/exchanges?status=disputed')}
        />
      </div>

      {initialLoad ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest failure state — an errored load must never masquerade as an
        // empty-but-healthy queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('exchanges.load_error_title')}
          hint={t('exchanges.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={refreshAll}>
              {t('common.refresh')}
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
          onRefresh={refreshAll}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={
            <BrokerEmptyState
              bare
              icon={isActionQueue ? Sparkles : Inbox}
              color={isActionQueue ? 'success' : 'neutral'}
              title={
                status === 'needs_action'
                  ? t('exchanges.empty_needs_action_title')
                  : status === 'pending_broker'
                    ? t('exchanges.empty_pending_title')
                    : t('exchanges.no_exchanges')
              }
              hint={
                status === 'needs_action'
                  ? t('exchanges.empty_needs_action_hint')
                  : status === 'pending_broker'
                    ? t('exchanges.empty_pending_hint')
                    : t('exchanges.empty_hint')
              }
            />
          }
        />
      )}

      {decision && (
        <ExchangeDecisionModal
          exchangeId={decision.item.id}
          type={decision.type}
          onClose={() => setDecision(null)}
          onDecided={refreshAll}
        />
      )}
    </BrokerPageShell>
  );
}

export default ExchangeManagement;
