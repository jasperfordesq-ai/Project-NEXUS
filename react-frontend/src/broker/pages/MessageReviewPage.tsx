// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Message Review
 * Review broker message copies with flagged/unreviewed filtering.
 * Parity: PHP BrokerControlsController::messages()
 *
 * The list a broker works through most. KPI header (whole-queue totals, each
 * the same number its tab shows), deep-linkable status tabs (?status=), a
 * date range, keyboard triage (j / k / Enter / r / f), bulk "Mark reviewed"
 * for routine copies only, CSV export of the current filter, a quick view
 * that reviews without leaving the page, and a quiet auto-refresh so the
 * list never disagrees with the sidebar badge.
 *
 * The flag dialog, quick view, columns, tabs, KPI cards and date filter live
 * in `../components/messages` (shared with the message page and the archive).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Download from 'lucide-react/icons/download';
import MessageSquare from 'lucide-react/icons/message-square';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import SearchX from 'lucide-react/icons/search-x';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Sparkles from 'lucide-react/icons/sparkles';
import type { LucideIcon } from 'lucide-react';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import { BulkActionToolbar, DataTable } from '@/admin/components';
import type { BrokerMessage } from '@/admin/api/types';
import { Button } from '@/components/ui';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import { useCsvExport } from '@/broker/useCsvExport';
import { useHotkey } from '@/broker/useHotkey';
import { BrokerPageShell, BrokerEmptyState, BrokerSkeleton, type BrokerStatColor } from '../components';
import {
  BrokerDateRangeFilter,
  FlagMessageModal,
  HIGHLIGHT_ATTR,
  MESSAGE_FILTERS,
  MESSAGE_QUEUE_FILTERS,
  MessageHotkeyHints,
  MessageKpiCards,
  MessageQuickView,
  MessageStatusTabs,
  buildMessageColumns,
  buildMessageExportColumns,
  type DateRangeValue,
  type MessageFilter,
  type MessageQueueTotals,
} from '../components/messages';

type MessagesParams = Parameters<typeof adminBroker.getMessages>[0];
type MessagesResponse = Awaited<ReturnType<typeof adminBroker.getMessages>>;

/** Reads the paginated total out of a getMessages response. */
function readTotal(res: MessagesResponse): number | null {
  if (!res.success || !Array.isArray(res.data)) return null;
  const meta = res.meta as Record<string, unknown> | undefined;
  const value = Number(meta?.total ?? meta?.total_items ?? res.data.length);
  return Number.isFinite(value) ? value : null;
}

const EXPORT_PAGE_SIZE = 100;

// Per-filter empty states — an empty review queue is good news (success),
// an empty history filter is just neutral.
const EMPTY_META: Record<MessageFilter, { icon: LucideIcon; color: BrokerStatColor; titleKey: string; hintKey: string }> = {
  unreviewed: { icon: Sparkles, color: 'success', titleKey: 'messages.empty_unreviewed_title', hintKey: 'messages.empty_unreviewed_hint' },
  urgent: { icon: ShieldCheck, color: 'success', titleKey: 'messages.empty_urgent_title', hintKey: 'messages.empty_urgent_hint' },
  flagged: { icon: ShieldCheck, color: 'success', titleKey: 'messages.empty_flagged_title', hintKey: 'messages.empty_flagged_hint' },
  reviewed: { icon: CheckCircle, color: 'neutral', titleKey: 'messages.empty_reviewed_title', hintKey: 'messages.empty_reviewed_hint' },
  all: { icon: MessageSquare, color: 'neutral', titleKey: 'messages.empty_all_title', hintKey: 'messages.empty_all_hint' },
};

export function MessageReview() {
  const { t } = useTranslation('broker');
  usePageTitle(t('messages.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();

  // The active tab is driven by the URL so deep-links from the broker
  // dashboard stat cards land on the right filter.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') as MessageFilter | null;
  const filter: MessageFilter = urlStatus && MESSAGE_FILTERS.includes(urlStatus) ? urlStatus : 'unreviewed';
  const setFilter = useCallback(
    (next: MessageFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'unreviewed') params.delete('status');
          else params.set('status', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [items, setItems] = useState<BrokerMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>({ from: null, to: null });

  // Server-side search over the message text and both people's names.
  // Debounced so typing doesn't fire a request on every keystroke. `?q=` seeds
  // it so another page (an exchange, a member) can link straight to a search.
  const initialSearch = (searchParams.get('q') ?? '').trim();
  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);
  const handleDateRange = useCallback((next: DateRangeValue) => {
    setDateRange(next);
    setPage(1);
  }, []);

  // Global unreviewed KPI — from the existing broker messages stats endpoint.
  const [unreviewedCount, setUnreviewedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);

  // Whole-queue totals for the Flagged / Reviewed cards and the Urgent tab
  // badge. There is no stats endpoint for these, so each is a one-row probe
  // of the list endpoint read for meta.total only — the same number its tab
  // shows, so a card can never disagree with its list.
  const [queueTotals, setQueueTotals] = useState<MessageQueueTotals>({ flagged: null, reviewed: null, urgent: null });
  const [totalsLoading, setTotalsLoading] = useState(true);

  // Dialogs
  const [flagTargetId, setFlagTargetId] = useState<number | null>(null);
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [quickViewItem, setQuickViewItem] = useState<BrokerMessage | null>(null);

  // Keyboard: the row j / k have landed on, by id so a reload keeps it.
  const [highlightedId, setHighlightedId] = useState<number | null>(null);

  // Stash the latest `t`/`toast` in refs so the fetch effect is keyed on the
  // page/filter params only — keeping them in the dep array re-fetches on
  // every language switch and risks a render loop with unstable toast refs.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // The current filter as the list endpoint takes it. `from`/`to` were added
  // to messages() in October 2026; the client type does not know them yet.
  const listParams = useCallback(
    (overrides: Partial<MessagesParams> = {}): MessagesParams =>
      ({
        page,
        filter: filter === 'all' ? undefined : filter,
        q: debouncedSearch || undefined,
        from: dateRange.from ?? undefined,
        to: dateRange.to ?? undefined,
        ...overrides,
      }) as MessagesParams,
    [page, filter, debouncedSearch, dateRange.from, dateRange.to],
  );

  // `quiet` keeps the rows on screen while new ones load (auto-refresh): no
  // skeleton, no spinner, the page stays where the broker left it.
  const loadItems = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setLoadError(false);
      try {
        const res = await adminBroker.getMessages(listParams());
        if (res.success && Array.isArray(res.data)) {
          setItems(res.data as BrokerMessage[]);
          setTotal(readTotal(res) ?? res.data.length);
        } else {
          // A success:false answer is a failure, not an empty queue.
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
        if (!quiet) toastRef.current.error(tRef.current('messages.load_failed'));
      } finally {
        setLoading(false);
        setHasLoaded(true);
      }
    },
    [listParams],
  );

  const loadQueueTotals = useCallback(async (quiet = false) => {
    if (!quiet) setTotalsLoading(true);
    try {
      const [flaggedRes, reviewedRes, urgentRes] = await Promise.all([
        adminBroker.getMessages({ page: 1, per_page: 1, filter: 'flagged' }),
        adminBroker.getMessages({ page: 1, per_page: 1, filter: 'reviewed' }),
        adminBroker.getMessages({ page: 1, per_page: 1, filter: 'urgent' }),
      ]);
      setQueueTotals({ flagged: readTotal(flaggedRes), reviewed: readTotal(reviewedRes), urgent: readTotal(urgentRes) });
    } catch {
      // KPI header degrades to em-dashes; the list load owns error messaging.
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  const loadUnreviewedCount = useCallback(async (quiet = false) => {
    if (!quiet) setCountLoading(true);
    try {
      const res = await adminBroker.getUnreviewedCount();
      if (res.success && res.data) {
        const count = Number((res.data as { count?: unknown }).count);
        if (Number.isFinite(count)) setUnreviewedCount(count);
      }
    } catch {
      // Decorative KPI — the list load surfaces real failures.
    } finally {
      setCountLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);
  useEffect(() => {
    void loadUnreviewedCount();
  }, [loadUnreviewedCount]);
  useEffect(() => {
    void loadQueueTotals();
  }, [loadQueueTotals]);

  const refreshAll = useCallback(
    (quiet = false) => {
      void loadItems(quiet);
      void loadUnreviewedCount(quiet);
      void loadQueueTotals(quiet);
    },
    [loadItems, loadUnreviewedCount, loadQueueTotals],
  );

  // After any broker write, on return to the tab, and once a minute: refresh
  // quietly, so the list and the sidebar badge never disagree.
  useBrokerAutoRefresh(() => refreshAll(true));

  // ── Selection + bulk review (Unreviewed tab only) ─────────────────────────
  // A concern is read, never ticked off: flagged copies are dropped from the
  // selection client-side (and the server skips them too, belt and braces).
  const canBulkReview = filter === 'unreviewed';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  useEffect(() => {
    setSelectedIds(new Set());
    setHighlightedId(null);
  }, [filter, page]);

  const selectedRows = items.filter((item) => selectedIds.has(String(item.id)));
  const routineSelected = selectedRows.filter((item) => !item.flagged);

  const handleBulkReview = async () => {
    const flaggedCount = selectedRows.length - routineSelected.length;
    if (flaggedCount > 0) toast.info(t('messages.bulk_skipped_flagged', { count: flaggedCount }));
    const ids = routineSelected.map((item) => item.id);
    if (ids.length === 0) {
      if (flaggedCount === 0) toast.info(t('messages.bulk_none_routine'));
      setSelectedIds(new Set());
      return;
    }
    setBulkLoading(true);
    try {
      const res = await adminBroker.reviewMessagesBulk(ids);
      if (res?.success && res.data) {
        const skippedFlagged = res.data.skipped.filter((s) => s.reason === 'flagged').length;
        const other = res.data.skipped.length - skippedFlagged;
        toast.success(t('messages.bulk_reviewed', { count: res.data.reviewed.length }));
        if (skippedFlagged > 0) toast.info(t('messages.bulk_skipped_flagged', { count: skippedFlagged }));
        if (other > 0) toast.info(t('messages.bulk_skipped_other', { count: other }));
        setSelectedIds(new Set());
        refreshAll(true);
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setBulkLoading(false);
    }
  };

  // ── Row actions ───────────────────────────────────────────────────────────

  const handleReview = async (id: number) => {
    setReviewingId(id);
    try {
      const res = await adminBroker.reviewMessage(id);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        refreshAll(true);
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setReviewingId(null);
    }
  };

  const openFlagModal = (id: number) => {
    setFlagTargetId(id);
    setFlagModalOpen(true);
  };

  // Carry the tab into the message, so its "Next" stays in the same queue.
  const detailPath = (messageId: number) =>
    MESSAGE_QUEUE_FILTERS.includes(filter) ? `/broker/messages/${messageId}?queue=${filter}` : `/broker/messages/${messageId}`;

  // ── Keyboard triage ───────────────────────────────────────────────────────
  // j / k move the highlight, Enter opens, r reviews a routine copy, f flags.
  // A flagged copy is never reviewed from the keyboard: it is read first.

  const highlighted = items.find((item) => item.id === highlightedId) ?? null;
  const moveHighlight = (step: 1 | -1) => {
    if (items.length === 0) return;
    const index = items.findIndex((item) => item.id === highlightedId);
    const next = index === -1 ? (step === 1 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, index + step));
    setHighlightedId(items[next]?.id ?? null);
  };
  useHotkey(
    {
      j: () => moveHighlight(1),
      k: () => moveHighlight(-1),
      Enter: () => {
        if (highlighted) navigate(tenantPath(detailPath(highlighted.id)));
      },
      r: () => {
        if (!highlighted || highlighted.reviewed_at) return;
        if (highlighted.flagged) {
          toast.info(t('messages.hotkey_flagged_blocked'));
          return;
        }
        void handleReview(highlighted.id);
      },
      f: () => {
        if (highlighted && !highlighted.flagged) openFlagModal(highlighted.id);
      },
    },
    { enabled: hasLoaded && !loadError },
  );
  useEffect(() => {
    if (highlightedId === null) return;
    const row = document.querySelector(`[${HIGHLIGHT_ATTR}="true"]`);
    if (row && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' });
  }, [highlightedId]);

  // ── Export (current filter, paged through the same endpoint) ─────────────

  const csv = useCsvExport();
  const exportCsv = () => {
    const parts = ['broker-messages', filter];
    if (debouncedSearch) parts.push('search');
    if (dateRange.from && dateRange.to) parts.push(`${dateRange.from}_${dateRange.to}`);
    void csv.run<BrokerMessage>({
      filename: parts.join('_'),
      columns: buildMessageExportColumns(t),
      fetchPage: async (exportPage) => {
        const res = await adminBroker.getMessages(listParams({ page: exportPage, per_page: EXPORT_PAGE_SIZE }));
        if (!res.success || !Array.isArray(res.data)) throw new Error('export');
        const pageTotal = readTotal(res) ?? 0;
        return { rows: res.data as BrokerMessage[], hasMore: exportPage * EXPORT_PAGE_SIZE < pageTotal };
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const emptyMeta = EMPTY_META[filter];
  const columns = buildMessageColumns({
    t,
    detailHref: (id) => tenantPath(detailPath(id)),
    highlightedId,
    reviewingId,
    onReview: (id) => void handleReview(id),
    onQuickView: setQuickViewItem,
    onFlag: openFlagModal,
  });

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_message_review' }}
      title={t('messages.title')}
      description={t('messages.page_description')}
      icon={MessageSquareWarning}
      color="warning"
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
            isLoading={loading || countLoading || totalsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <MessageStatusTabs
            filter={filter}
            onChange={(next) => {
              setFilter(next);
              setPage(1);
            }}
            unreviewedCount={unreviewedCount}
            urgentCount={queueTotals.urgent}
          />
          <div className="flex flex-wrap items-center gap-3 px-1">
            <MessageHotkeyHints
              hints={[
                { keys: ['j', 'k'], label: t('messages.hotkey_move') },
                { keys: ['↵'], label: t('messages.hotkey_open') },
                { keys: ['r'], label: t('messages.review_action') },
                { keys: ['f'], label: t('messages.flag_action') },
              ]}
            />
            <BrokerDateRangeFilter
              value={dateRange}
              onChange={handleDateRange}
              label={t('messages.date_range_label')}
              clearLabel={t('messages.date_range_clear')}
            />
          </div>
        </div>
      }
    >
      <MessageKpiCards
        unreviewedCount={unreviewedCount}
        countLoading={countLoading}
        queueTotals={queueTotals}
        totalsLoading={totalsLoading}
        filteredTotal={total}
        hasLoaded={hasLoaded}
      />

      {!hasLoaded ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest error state — a failed load must never masquerade as an
        // empty (all-clear) review queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('messages.error_title')}
          hint={t('messages.error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={() => refreshAll()}>
              {t('messages.retry')}
            </Button>
          }
        />
      ) : (
        <>
          {canBulkReview && (
            <BulkActionToolbar
              selectedCount={selectedIds.size}
              isLoading={bulkLoading}
              onClearSelection={() => setSelectedIds(new Set())}
              actions={[
                {
                  key: 'review',
                  label: t('messages.bulk_review'),
                  color: 'success',
                  icon: <CheckCircle size={14} aria-hidden="true" />,
                  confirmTitle: t('messages.bulk_review'),
                  confirmMessage: t('messages.bulk_confirm_message', { count: routineSelected.length }),
                  onConfirm: handleBulkReview,
                },
              ]}
            />
          )}
          <DataTable
            stickyActions
            mobileCards
            selectable={canBulkReview}
            selectedKeys={canBulkReview ? selectedIds : undefined}
            onSelectionChange={canBulkReview ? setSelectedIds : undefined}
            columns={columns}
            data={items}
            isLoading={loading}
            searchable
            searchPlaceholder={t('messages.search_placeholder')}
            onSearch={handleSearch}
            onRefresh={() => refreshAll()}
            totalItems={total}
            page={page}
            pageSize={20}
            onPageChange={setPage}
            emptyContent={
              debouncedSearch || dateRange.from ? (
                <BrokerEmptyState bare icon={SearchX} color="neutral" title={t('messages.empty_search_title')} hint={t('messages.empty_search_hint')} />
              ) : (
                <BrokerEmptyState bare icon={emptyMeta.icon} color={emptyMeta.color} title={t(emptyMeta.titleKey)} hint={t(emptyMeta.hintKey)} />
              )
            }
          />
        </>
      )}

      <FlagMessageModal
        messageId={flagTargetId}
        isOpen={flagModalOpen}
        onClose={() => setFlagModalOpen(false)}
        onFlagged={() => refreshAll(true)}
      />

      <MessageQuickView item={quickViewItem} onClose={() => setQuickViewItem(null)} onReviewed={() => refreshAll(true)} />
    </BrokerPageShell>
  );
}

export default MessageReview;
