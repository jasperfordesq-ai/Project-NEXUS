// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Message Review
 * Review broker message copies with flagged/unreviewed filtering.
 * Parity: PHP BrokerControlsController::messages()
 *
 * Broker port retains the row-level "Quick view" detail modal that lets
 * brokers triage messages without leaving the list page, on top of the
 * admin's Review / Flag actions and navigation to the detail page.
 *
 * Restyled to the broker design language: BrokerPageShell frame, KPI header
 * (global unreviewed count from the existing unreviewed-count endpoint plus
 * in-view flagged/reviewed tallies), deep-linkable status tabs (?status=),
 * avatar sender → recipient cells, severity chips, shaped skeleton loading,
 * per-filter empty states and an honest error state with retry.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowRight from 'lucide-react/icons/arrow-right';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import Flag from 'lucide-react/icons/flag';
import Inbox from 'lucide-react/icons/inbox';
import MessageSquare from 'lucide-react/icons/message-square';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import SearchX from 'lucide-react/icons/search-x';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Sparkles from 'lucide-react/icons/sparkles';
import X from 'lucide-react/icons/x';
import type { LucideIcon } from 'lucide-react';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { BrokerMessage, BrokerMessageDetail } from '@/admin/api/types';
import {
  Avatar,
  Button,
  Chip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Select,
  SelectItem,
  Separator,
  Tabs,
  Tab,
  Textarea,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
  type BrokerStatColor,
} from '../components';

// Flag severities (info / warning / concern / urgent, and the older
// low…critical scale) all render through BrokerStatusChip, whose one colour
// map the Message detail and Archive pages read too.

/** Reads the paginated total out of a getMessages response. */
function readTotal(res: Awaited<ReturnType<typeof adminBroker.getMessages>>): number | null {
  if (!res.success || !Array.isArray(res.data)) return null;
  const meta = res.meta as Record<string, unknown> | undefined;
  const value = Number(meta?.total ?? meta?.total_items ?? res.data.length);
  return Number.isFinite(value) ? value : null;
}

// The active tab is driven by the URL so deep-links from the broker
// dashboard stat cards land on the right filter.
// `urgent` = flagged and not yet reviewed: what the dashboard's Safeguarding
// Alerts card counts. It replaced the safeguarding "Flagged messages" page
// (October 2026), which listed these same copies a second time.
const ALLOWED_FILTERS = ['unreviewed', 'urgent', 'flagged', 'reviewed', 'all'] as const;
type MessageFilter = (typeof ALLOWED_FILTERS)[number];

// Per-filter empty states — an empty review queue is good news (success),
// an empty history filter is just neutral.
const EMPTY_META: Record<
  MessageFilter,
  { icon: LucideIcon; color: BrokerStatColor; titleKey: string; hintKey: string }
> = {
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

  const [searchParams, setSearchParams] = useSearchParams();

  const urlStatus = searchParams.get('status') as MessageFilter | null;
  const filter: MessageFilter =
    urlStatus && ALLOWED_FILTERS.includes(urlStatus) ? urlStatus : 'unreviewed';
  const setFilter = useCallback(
    (next: MessageFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'unreviewed') {
            params.delete('status');
          } else {
            params.set('status', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [items, setItems] = useState<BrokerMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  // Server-side search over the message text and both people's names.
  // Debounced so typing doesn't fire a request on every keystroke.
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(handle);
  }, [search]);
  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  // Global unreviewed KPI — from the existing broker messages stats endpoint.
  const [unreviewedCount, setUnreviewedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);

  // Whole-queue totals for the Flagged / Reviewed cards and the Urgent tab
  // badge. There is no stats endpoint for these, so each is a one-page probe
  // of the list endpoint read for meta.total only — the same number its tab
  // shows, so a card can never disagree with its list.
  const [queueTotals, setQueueTotals] = useState<{
    flagged: number | null;
    reviewed: number | null;
    urgent: number | null;
  }>({ flagged: null, reviewed: null, urgent: null });
  const [totalsLoading, setTotalsLoading] = useState(true);

  // Flag modal state
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<number | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [flagSeverity, setFlagSeverity] = useState<'info' | 'warning' | 'concern' | 'urgent'>('concern');
  const [flagLoading, setFlagLoading] = useState(false);

  // Detail modal state (broker-only quick-view UX)
  const [detailItem, setDetailItem] = useState<BrokerMessage | null>(null);
  const [detail, setDetail] = useState<BrokerMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailReviewNotes, setDetailReviewNotes] = useState('');
  const [detailReviewLoading, setDetailReviewLoading] = useState(false);

  // Stash the latest `t`/`toast` in refs so the fetch effect is keyed on the
  // page/filter params only — keeping them in the dep array re-fetches on
  // every language switch and risks a render loop with unstable toast refs.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getMessages({
        page,
        filter: filter === 'all' ? undefined : filter,
        q: debouncedSearch || undefined,
      });
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as BrokerMessage[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      } else {
        // A success:false answer is a failure, not an empty queue.
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('messages.load_failed'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [page, filter, debouncedSearch]);

  const loadQueueTotals = useCallback(async () => {
    setTotalsLoading(true);
    try {
      const [flaggedRes, reviewedRes, urgentRes] = await Promise.all([
        adminBroker.getMessages({ page: 1, filter: 'flagged' }),
        adminBroker.getMessages({ page: 1, filter: 'reviewed' }),
        adminBroker.getMessages({ page: 1, filter: 'urgent' }),
      ]);
      setQueueTotals({
        flagged: readTotal(flaggedRes),
        reviewed: readTotal(reviewedRes),
        urgent: readTotal(urgentRes),
      });
    } catch {
      // KPI header degrades to em-dashes; the list load owns error messaging.
    } finally {
      setTotalsLoading(false);
    }
  }, []);

  const loadUnreviewedCount = useCallback(async () => {
    setCountLoading(true);
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
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadUnreviewedCount();
  }, [loadUnreviewedCount]);

  useEffect(() => {
    loadQueueTotals();
  }, [loadQueueTotals]);

  const refreshAll = () => {
    loadItems();
    loadUnreviewedCount();
    loadQueueTotals();
  };

  // Bulk review — Unreviewed tab only. The server skips flagged copies (a
  // concern is read one at a time) and the broker's own conversations.
  const canBulkReview = filter === 'unreviewed';
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, page]);

  const handleBulkReview = async () => {
    const ids = Array.from(selectedIds).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      const res = await adminBroker.reviewMessagesBulk(ids);
      if (res?.success && res.data) {
        const done = res.data.reviewed.length;
        const flagged = res.data.skipped.filter((s) => s.reason === 'flagged').length;
        const other = res.data.skipped.length - flagged;
        toast.success(t('messages.bulk_reviewed', { count: done }));
        if (flagged > 0) toast.info(t('messages.bulk_skipped_flagged', { count: flagged }));
        if (other > 0) toast.info(t('messages.bulk_skipped_other', { count: other }));
        setSelectedIds(new Set());
        loadItems();
        loadUnreviewedCount();
        loadQueueTotals();
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setBulkLoading(false);
    }
  };

  const handleReview = async (id: number) => {
    setReviewingId(id);
    try {
      const res = await adminBroker.reviewMessage(id);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        loadItems();
        loadUnreviewedCount();
        loadQueueTotals();
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
    setSelectedMessageId(id);
    setFlagReason('');
    setFlagSeverity('concern');
    setFlagModalOpen(true);
  };

  const handleFlag = async () => {
    if (!selectedMessageId) return;
    if (!flagReason.trim()) {
      toast.error(t('messages.flag_reason_required'));
      return;
    }
    setFlagLoading(true);
    try {
      const res = await adminBroker.flagMessage(selectedMessageId, flagReason, flagSeverity);
      if (res?.success) {
        toast.success(t('messages.flag_success'));
        setFlagModalOpen(false);
        loadItems();
        loadQueueTotals();
      } else {
        toast.error(res?.error || t('messages.flag_failed'));
      }
    } catch {
      toast.error(t('messages.flag_failed'));
    } finally {
      setFlagLoading(false);
    }
  };

  // ── Quick-view detail modal (broker enhancement) ──────────────────────────

  const openDetail = useCallback(async (item: BrokerMessage) => {
    setDetailItem(item);
    setDetail(null);
    setDetailReviewNotes('');
    setDetailLoading(true);
    try {
      const res = await adminBroker.showMessage(item.id);
      if (res.success && res.data) {
        setDetail(res.data as BrokerMessageDetail);
      }
    } catch {
      // Fall back to list-row info if detail fetch fails
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailItem(null);
    setDetail(null);
    setDetailReviewNotes('');
  }, []);

  const handleDetailReview = useCallback(async () => {
    if (!detailItem) return;
    setDetailReviewLoading(true);
    try {
      const res = await adminBroker.reviewMessage(detailItem.id, detailReviewNotes || undefined);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        closeDetail();
        loadItems();
        loadUnreviewedCount();
        loadQueueTotals();
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setDetailReviewLoading(false);
    }
  }, [detailItem, detailReviewNotes, closeDetail, loadItems, loadUnreviewedCount, loadQueueTotals, toast, t]);

  const isDetailReviewed = !!(detailItem?.reviewed_at);

  // Severity chip — one shared map for every broker page (see BrokerStatusChip).
  const renderSeverity = (severityRaw: string) => <BrokerStatusChip status={severityRaw} />;

  // Copy reasons are slugs (first_contact, random_sample…); the table column
  // and the quick view show the same translated label.
  const copyReasonLabel = (reason: string) =>
    t(`messages.copy_reason_${reason}`, { defaultValue: reason.replace(/_/g, ' ') });

  const emptyMeta = EMPTY_META[filter];

  // Carry the tab into the message, so its "Next" stays in the same queue.
  const detailPath = (messageId: number) =>
    ['unreviewed', 'urgent', 'flagged'].includes(filter)
      ? `/broker/messages/${messageId}?queue=${filter}`
      : `/broker/messages/${messageId}`;

  const columns: Column<BrokerMessage>[] = [
    {
      key: 'sender_name',
      label: t('messages.col_participants'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.sender_name} size="sm" className="shrink-0" />
          <Link
            to={tenantPath(detailPath(item.id))}
            className="min-w-0 truncate text-sm font-medium text-accent hover:underline"
          >
            {item.sender_name}
          </Link>
          <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
          <Avatar name={item.receiver_name} size="sm" className="shrink-0" />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {item.receiver_name}
          </span>
        </div>
      ),
    },
    {
      key: 'message_body',
      label: t('messages.col_preview'),
      // The preview opens the message too; until Oct 2026 only the sender's
      // name did, and brokers clicked the text and nothing happened.
      render: (item) => (
        <Link
          to={tenantPath(detailPath(item.id))}
          className="line-clamp-1 min-w-0 max-w-[240px] text-sm text-muted hover:text-foreground hover:underline"
        >
          {item.message_body ? item.message_body.substring(0, 80) + (item.message_body.length > 80 ? '…' : '') : '—'}
        </Link>
      ),
    },
    {
      key: 'copy_reason',
      label: t('messages.col_reason'),
      render: (item) => (
        item.copy_reason ? (
          <Chip size="sm" variant="tertiary" color="default">
            {copyReasonLabel(item.copy_reason)}
          </Chip>
        ) : <span className="text-sm text-muted">—</span>
      ),
    },
    {
      key: 'flagged',
      hideBelow: '2xl',
      label: t('messages.col_flagged'),
      render: (item) => {
        if (!item.flagged) {
          return <span className="text-sm text-muted">{t('messages.flagged_no')}</span>;
        }
        return renderSeverity(item.flag_severity || 'concern');
      },
    },
    {
      key: 'reviewed_at',
      label: t('messages.col_status'),
      render: (item) => (
        <BrokerStatusChip status={item.reviewed_at ? 'reviewed' : 'unreviewed'} />
      ),
    },
    {
      key: 'created_at',
      label: t('messages.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('messages.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {!item.reviewed_at && (
            <Button
              size="sm"
              variant="tertiary"
              color="success"
              startContent={<CheckCircle size={14} />}
              onPress={() => handleReview(item.id)}
              isLoading={reviewingId === item.id}
              aria-label={t('messages.mark_reviewed_aria')}
            >
              {t('messages.review_action')}
            </Button>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => openDetail(item)}
            aria-label={t('messages.quick_view_aria')}
          >
            <Eye size={14} />
          </Button>
          {!item.flagged && (
            <Button
              size="sm"
              variant="tertiary"
              color="warning"
              startContent={<Flag size={14} />}
              onPress={() => openFlagModal(item.id)}
              aria-label={t('messages.flag_message_aria')}
            >
              {t('messages.flag_action')}
            </Button>
          )}
        </div>
      ),
    },
  ];

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
            startContent={<RefreshCw size={16} />}
            onPress={refreshAll}
            isLoading={loading || countLoading || totalsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {/* KPI header — whole-queue totals, each the same number its tab shows */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('messages.stat_unreviewed')}
          value={unreviewedCount}
          icon={MessageSquareWarning}
          color="warning"
          loading={countLoading}
          to={tenantPath('/broker/messages?status=unreviewed')}
          description={t('messages.stat_unreviewed_hint')}
        />
        <BrokerStatCard
          label={t('messages.stat_flagged_total')}
          value={queueTotals.flagged}
          icon={Flag}
          color="danger"
          loading={totalsLoading}
          to={tenantPath('/broker/messages?status=flagged')}
          description={t('messages.stat_flagged_total_hint')}
        />
        <BrokerStatCard
          label={t('messages.stat_reviewed_total')}
          value={queueTotals.reviewed}
          icon={CheckCircle}
          color="success"
          loading={totalsLoading}
          to={tenantPath('/broker/messages?status=reviewed')}
          description={t('messages.stat_reviewed_total_hint')}
        />
        <BrokerStatCard
          label={t('messages.stat_filtered')}
          value={total}
          icon={Inbox}
          color="accent"
          loading={!hasLoaded}
          description={t('messages.stat_filtered_hint')}
        />
      </div>

      {/* Status tabs — deep-linkable via ?status= */}
      <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('messages.review_tabs_aria')}
          selectedKey={filter}
          onSelectionChange={(key) => { setFilter(key as MessageFilter); setPage(1); }}
          variant="underlined"
          size="sm"
        >
          <Tab
            key="unreviewed"
            title={
              <div className="flex items-center gap-2">
                <Clock size={14} />
                <span>{t('messages.tab_unreviewed')}</span>
                {unreviewedCount !== null && unreviewedCount > 0 && (
                  <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                    {unreviewedCount}
                  </Chip>
                )}
              </div>
            }
          />
          <Tab
            key="urgent"
            title={
              <div className="flex items-center gap-2">
                <AlertCircle size={14} />
                <span>{t('messages.tab_urgent')}</span>
                {queueTotals.urgent !== null && queueTotals.urgent > 0 && (
                  <Chip size="sm" variant="soft" color="danger" className="tabular-nums">
                    {queueTotals.urgent}
                  </Chip>
                )}
              </div>
            }
          />
          <Tab
            key="flagged"
            title={
              <div className="flex items-center gap-2">
                <Flag size={14} />
                <span>{t('messages.tab_flagged')}</span>
              </div>
            }
          />
          <Tab
            key="reviewed"
            title={
              <div className="flex items-center gap-2">
                <CheckCircle size={14} />
                <span>{t('messages.tab_reviewed')}</span>
              </div>
            }
          />
          <Tab
            key="all"
            title={
              <div className="flex items-center gap-2">
                <MessageSquare size={14} />
                <span>{t('messages.tab_all')}</span>
              </div>
            }
          />
        </Tabs>
      </div>

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
            <Button size="sm" variant="danger-soft" onPress={refreshAll}>
              {t('messages.retry')}
            </Button>
          }
        />
      ) : (
        <>
        {canBulkReview && selectedIds.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-2.5 shadow-sm shadow-black/[0.03]">
            <span className="text-sm font-medium tabular-nums text-foreground">
              {t('messages.bulk_selected', { count: selectedIds.size })}
            </span>
            <span className="text-xs text-muted">{t('messages.bulk_hint')}</span>
            <div className="flex-1" />
            <Button
              size="sm"
              color="success"
              variant="flat"
              startContent={<CheckCircle size={14} aria-hidden="true" />}
              onPress={handleBulkReview}
              isLoading={bulkLoading}
            >
              {t('messages.bulk_review')}
            </Button>
            <Button
              size="sm"
              variant="light"
              isIconOnly
              onPress={() => setSelectedIds(new Set())}
              aria-label={t('messages.bulk_clear')}
            >
              <X size={16} />
            </Button>
          </div>
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
          onRefresh={refreshAll}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={
            debouncedSearch ? (
              <BrokerEmptyState
                bare
                icon={SearchX}
                color="neutral"
                title={t('messages.empty_search_title')}
                hint={t('messages.empty_search_hint')}
              />
            ) : (
              <BrokerEmptyState
                bare
                icon={emptyMeta.icon}
                color={emptyMeta.color}
                title={t(emptyMeta.titleKey)}
                hint={t(emptyMeta.hintKey)}
              />
            )
          }
        />
        </>
      )}

      {/* Flag Message Modal */}
      <Modal
        isOpen={flagModalOpen}
        onClose={() => setFlagModalOpen(false)}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Flag size={20} className="text-warning" aria-hidden="true" />
            {t('messages.flag_modal_title')}
          </ModalHeader>
          <ModalBody>
            <Textarea
              label={t('messages.flag_reason_label')}
              placeholder={t('messages.flag_reason_placeholder')}
              value={flagReason}
              onValueChange={setFlagReason}
              minRows={3}
              variant="bordered"
              isRequired
            />
            <Select
              label={t('messages.severity_label')}
              selectedKeys={[flagSeverity]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as 'info' | 'warning' | 'concern' | 'urgent';
                if (val) setFlagSeverity(val);
              }}
              variant="bordered"
            >
              <SelectItem key="info" id="info">{t('messages.severity_info')}</SelectItem>
              <SelectItem key="warning" id="warning">{t('messages.severity_warning')}</SelectItem>
              <SelectItem key="concern" id="concern">{t('messages.severity_concern')}</SelectItem>
              <SelectItem key="urgent" id="urgent">{t('messages.severity_urgent')}</SelectItem>
            </Select>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => setFlagModalOpen(false)}
              isDisabled={flagLoading}
            >
              {t('messages.cancel')}
            </Button>
            <Button
              color="warning"
              onPress={handleFlag}
              isLoading={flagLoading}
              isDisabled={!flagReason.trim()}
              startContent={!flagLoading && <Flag size={14} />}
            >
              {t('messages.flag_action')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Quick-view Message Detail Modal (broker UX enhancement) */}
      <Modal
        isOpen={!!detailItem}
        onClose={closeDetail}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <MessageSquare size={18} className="shrink-0 text-accent" aria-hidden="true" />
            <span>{t('messages.quick_view_title')}</span>
          </ModalHeader>

          <ModalBody className="gap-4">
            {detailLoading && (
              <p className="py-8 text-center text-sm text-muted">{t('messages.loading')}</p>
            )}

            {!detailLoading && detailItem && (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase text-muted">{t('messages.detail_from')}</p>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={detailItem.sender_name} size="sm" className="shrink-0" />
                      <p className="truncate font-medium text-foreground">{detailItem.sender_name}</p>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-xs font-medium uppercase text-muted">{t('messages.detail_to')}</p>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar name={detailItem.receiver_name} size="sm" className="shrink-0" />
                      <p className="truncate font-medium text-foreground">{detailItem.receiver_name}</p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_date')}</p>
                    <p className="tabular-nums text-foreground">
                      {formatServerDateTime(detailItem.sent_at ?? detailItem.created_at)}
                    </p>
                  </div>
                  {(detailItem.flag_reason || detailItem.copy_reason) && (
                    <div>
                      <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_reason')}</p>
                      <p className="text-foreground">
                        {detailItem.flag_reason ||
                          (detailItem.copy_reason ? copyReasonLabel(detailItem.copy_reason) : '—')}
                      </p>
                    </div>
                  )}
                  {detailItem.flag_severity && (
                    <div>
                      <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_severity')}</p>
                      {renderSeverity(detailItem.flag_severity)}
                    </div>
                  )}
                </div>

                <Separator />

                <div>
                  <p className="mb-2 text-xs font-medium uppercase text-muted">{t('messages.content_label')}</p>
                  <div className="min-h-[80px] whitespace-pre-wrap rounded-lg bg-surface-secondary p-4 text-sm leading-relaxed text-foreground">
                    {detail?.copy?.message_body || detailItem.message_body || '--'}
                  </div>
                </div>

                {detail?.thread && detail.thread.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase text-muted">
                        {t('messages.conversation_label')} ({detail.thread.length})
                      </p>
                      <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                        {detail.thread.map((msg) => (
                          <div
                            key={msg.id}
                            className="rounded-md bg-surface-secondary px-3 py-2 text-sm"
                          >
                            <span className="mr-2 font-medium text-foreground">{msg.sender_name}</span>
                            <span className="text-xs tabular-nums text-muted">
                              {formatServerDateTime(msg.created_at)}
                            </span>
                            <p className="mt-1 whitespace-pre-wrap text-foreground">{msg.body}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}

                {isDetailReviewed ? (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-sm">
                      <BrokerStatusChip status="reviewed" />
                      <span className="tabular-nums text-muted">
                        {formatServerDateTime(detailItem.reviewed_at!)}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <Separator />
                    <Textarea
                      label={t('messages.review_notes_label')}
                      placeholder={t('messages.review_notes_placeholder')}
                      value={detailReviewNotes}
                      onValueChange={setDetailReviewNotes}
                      minRows={2}
                      variant="bordered"
                    />
                  </>
                )}
              </>
            )}
          </ModalBody>

          <ModalFooter>
            <Button variant="tertiary" onPress={closeDetail} isDisabled={detailReviewLoading}>
              {t('messages.close')}
            </Button>
            {!isDetailReviewed && detailItem && (
              <Button
                color="primary"
                startContent={<CheckCircle size={16} />}
                isLoading={detailReviewLoading}
                isDisabled={detailReviewLoading}
                onPress={handleDetailReview}
              >
                {t('messages.mark_as_reviewed')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BrokerPageShell>
  );
}

export default MessageReview;
