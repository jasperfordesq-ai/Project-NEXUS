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
import ShieldCheck from 'lucide-react/icons/shield-check';
import Sparkles from 'lucide-react/icons/sparkles';
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

type SeverityChipColor = 'default' | 'warning' | 'danger';
type SeverityChipVariant = 'tertiary' | 'primary';

function severityColor(severity?: string): { color: SeverityChipColor; variant: SeverityChipVariant } {
  switch (severity?.toLowerCase()) {
    case 'medium':
    case 'warning':
      return { color: 'warning', variant: 'tertiary' };
    case 'high':
    case 'concern':
      return { color: 'danger', variant: 'tertiary' };
    case 'critical':
    case 'urgent':
      return { color: 'danger', variant: 'primary' };
    default:
      return { color: 'default', variant: 'tertiary' };
  }
}

// Severities that map onto the panel-wide status vocabulary render through
// BrokerStatusChip so their colors match every other broker page; the
// message-specific scale (info/warning/concern/urgent) keeps its own chips.
const PANEL_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

// The active tab is driven by the URL so deep-links from the broker
// dashboard stat cards land on the right filter.
const ALLOWED_FILTERS = ['unreviewed', 'flagged', 'reviewed', 'all'] as const;
type MessageFilter = (typeof ALLOWED_FILTERS)[number];

// Per-filter empty states — an empty review queue is good news (success),
// an empty history filter is just neutral.
const EMPTY_META: Record<
  MessageFilter,
  { icon: LucideIcon; color: BrokerStatColor; titleKey: string; hintKey: string }
> = {
  unreviewed: { icon: Sparkles, color: 'success', titleKey: 'messages.empty_unreviewed_title', hintKey: 'messages.empty_unreviewed_hint' },
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

  // Global unreviewed KPI — from the existing broker messages stats endpoint.
  const [unreviewedCount, setUnreviewedCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(true);

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
      });
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as BrokerMessage[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('messages.load_failed'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [page, filter]);

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

  const refreshAll = () => {
    loadItems();
    loadUnreviewedCount();
  };

  const handleReview = async (id: number) => {
    setReviewingId(id);
    try {
      const res = await adminBroker.reviewMessage(id);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        loadItems();
        loadUnreviewedCount();
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
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setDetailReviewLoading(false);
    }
  }, [detailItem, detailReviewNotes, closeDetail, loadItems, loadUnreviewedCount, toast, t]);

  const isDetailReviewed = !!(detailItem?.reviewed_at);

  // Severity chip — panel-wide values route through BrokerStatusChip so the
  // colors match every other broker page; the message-domain scale keeps a
  // flag-badged chip with its translated label.
  const renderSeverity = (severityRaw: string) => {
    const severity = severityRaw.toLowerCase();
    if (PANEL_SEVERITIES.has(severity)) {
      return <BrokerStatusChip status={severity} />;
    }
    const { color, variant } = severityColor(severity);
    return (
      <Chip size="sm" variant={variant} color={color} className="capitalize">
        <Flag size={12} aria-hidden="true" />
        <Chip.Label>
          {t(`messages.severity_${severity}`, { defaultValue: severity.replace(/_/g, ' ') })}
        </Chip.Label>
      </Chip>
    );
  };

  // In-view KPI tallies — derived from the rows the page already fetched.
  const flaggedInView = items.filter((i) => i.flagged).length;
  const reviewedInView = items.filter((i) => !!i.reviewed_at).length;

  const emptyMeta = EMPTY_META[filter];

  const columns: Column<BrokerMessage>[] = [
    {
      key: 'sender_name',
      label: t('messages.col_participants'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.sender_name} size="sm" className="shrink-0" />
          <Link
            to={tenantPath(`/broker/messages/${item.id}`)}
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
      render: (item) => (
        <span className="line-clamp-1 min-w-0 max-w-[240px] text-sm text-muted">
          {item.message_body ? item.message_body.substring(0, 80) + (item.message_body.length > 80 ? '…' : '') : '—'}
        </span>
      ),
    },
    {
      key: 'copy_reason',
      label: t('messages.col_reason'),
      render: (item) => (
        item.copy_reason ? (
          <Chip size="sm" variant="tertiary" color="default">
            {t(`messages.copy_reason_${item.copy_reason}`, {
              defaultValue: item.copy_reason.replace(/_/g, ' '),
            })}
          </Chip>
        ) : <span className="text-sm text-muted">—</span>
      ),
    },
    {
      key: 'flagged',
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
            isLoading={loading && countLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {/* KPI header — global unreviewed queue + in-view tallies */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          label={t('messages.stat_flagged')}
          value={flaggedInView}
          icon={Flag}
          color="danger"
          loading={!hasLoaded}
          to={tenantPath('/broker/messages?status=flagged')}
          description={t('messages.stat_flagged_hint')}
        />
        <BrokerStatCard
          label={t('messages.stat_reviewed')}
          value={reviewedInView}
          icon={CheckCircle}
          color="success"
          loading={!hasLoaded}
          to={tenantPath('/broker/messages?status=reviewed')}
          description={t('messages.stat_reviewed_hint')}
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
        <DataTable
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
              icon={emptyMeta.icon}
              color={emptyMeta.color}
              title={t(emptyMeta.titleKey)}
              hint={t(emptyMeta.hintKey)}
            />
          }
        />
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
                        {detailItem.flag_reason || detailItem.copy_reason}
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
              {t('messages.cancel')}
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
