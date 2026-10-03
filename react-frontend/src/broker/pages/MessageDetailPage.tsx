// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Message Detail
 * Broker message copy detail view with full conversation thread and moderation
 * actions, restyled to the broker design language: severity banner, metadata
 * card with party avatars, chat-style thread bubbles, and a decision bar.
 * Parity: PHP BrokerControlsController::showMessage()
 *
 * This is where a concern is spotted, so the quick actions live here too:
 * both people open the member window, the sender can be put under
 * monitoring, and the listing can be risk-tagged. Keyboard: r reviews,
 * f flags, a approves and archives, n opens the next in the queue.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Flag from 'lucide-react/icons/flag';
import Archive from 'lucide-react/icons/archive';
import Shield from 'lucide-react/icons/shield';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import Calendar from 'lucide-react/icons/calendar';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import FileText from 'lucide-react/icons/file-text';
import Tag from 'lucide-react/icons/tag';
import UserPlus from 'lucide-react/icons/user-plus';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerMessageDetail } from '@/admin/api/types';
import { Card, CardBody, CardHeader, Button, Chip, Avatar, Separator, Tooltip } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { useBrokerBreadcrumbLabel } from '@/broker/BrokerBreadcrumbContext';
import { useHotkey } from '@/broker/useHotkey';
import { BrokerPageShell, BrokerSkeleton, BrokerEmptyState, BrokerStatusChip } from '../components';
import { BrokerQueueNav } from '../components/BrokerQueueNav';
import { useBrokerQueue } from '../useBrokerQueue';
import {
  ApproveArchiveModal,
  FlagMessageModal,
  MESSAGE_QUEUE_FILTERS,
  MessageThreadCard,
  MonitorSenderModal,
  normalizeSeverity,
  type FlagSeverity,
  type MessageFilter,
} from '../components/messages';

/** The message queues a broker works through; history tabs have no "next". */
type MessageQueue = Extract<MessageFilter, 'unreviewed' | 'urgent' | 'flagged'>;

const cardClass = 'rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]';

// ─── Copy reason chip colors ──────────────────────────────────────────────────

const COPY_REASON_COLORS: Record<string, 'accent' | 'danger' | 'success' | 'warning' | 'default'> = {
  first_contact: 'accent',
  high_risk_listing: 'danger',
  new_member: 'success',
  flagged_user: 'warning',
  manual_monitoring: 'default',
  random_sample: 'default',
};

// ─── Flag severity presentation ───────────────────────────────────────────────
// The chip itself is BrokerStatusChip (one colour map for every broker page:
// info→accent, warning→warning, concern→danger, urgent→filled danger). The
// banner and medallion tints below follow that same scale and the
// dashboard's gradient hero pattern. Tailwind JIT needs literal classes.

const SEVERITY_BANNER_CLASSES: Record<FlagSeverity, string> = {
  info: 'border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface',
  warning: 'border-warning/30 bg-gradient-to-br from-warning/10 via-surface to-surface',
  concern: 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface',
  urgent: 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface',
};

const SEVERITY_MEDALLION_CLASSES: Record<FlagSeverity, string> = {
  info: 'bg-accent/10 text-accent',
  warning: 'bg-warning/10 text-warning',
  concern: 'bg-danger/10 text-danger',
  urgent: 'bg-danger/10 text-danger',
};

/** Guide article for this page: reviewing one message copy. */
const HELP = { sectionId: 'broker_safeguarding', articleId: 'broker_review_message' } as const;

// ─── Component ────────────────────────────────────────────────────────────────

export function MessageDetail() {
  const { t } = useTranslation('broker');
  usePageTitle(t('messages.detail_title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const numericId = id ? Number(id) : null;

  // Data state
  const [detail, setDetail] = useState<BrokerMessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Dialogs
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [monitorModalOpen, setMonitorModalOpen] = useState(false);

  // Who is already under monitoring, so the quick action can say so instead
  // of offering to add the sender a second time. Null until known.
  const [monitoredIds, setMonitoredIds] = useState<Set<number> | null>(null);

  // The breadcrumb names the record once it has loaded ("Alice → Bob").
  useBrokerBreadcrumbLabel(detail ? `${detail.copy.sender_name} → ${detail.copy.receiver_name}` : null);

  // The queue this message was opened from (?queue=), so "next" stays in it.
  const [searchParams] = useSearchParams();
  const queueParam = searchParams.get('queue');
  const hasKnownQueue = (MESSAGE_QUEUE_FILTERS as readonly string[]).includes(queueParam ?? '');
  const queueName: MessageQueue = hasKnownQueue ? (queueParam as MessageQueue) : 'unreviewed';
  // Back returns to the tab the message was opened from; with no ?queue= it
  // goes to the plain list (which opens on Unreviewed anyway).
  const backPath = hasKnownQueue ? `/broker/messages?status=${queueName}` : '/broker/messages';
  const queue = useBrokerQueue({
    currentId: numericId,
    fetchQueue: async () => {
      const res = await adminBroker.getMessages({ filter: queueName });
      if (!res.success || !Array.isArray(res.data)) return null;
      return { ids: res.data.map((m) => m.id), total: res.meta?.total ?? res.data.length };
    },
    itemPath: (next) => `/broker/messages/${next}?queue=${queueName}`,
    listPath: `/broker/messages?status=${queueName}`,
  });

  // ── Load data ─────────────────────────────────────────────────────────────

  const loadDetail = useCallback(async () => {
    if (!id) return;
    const parsed = Number(id);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t('messages.detail_invalid_id'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminBroker.showMessage(parsed);
      if (res.success && res.data) {
        setDetail(res.data);
      } else {
        setError(t('messages.detail_not_found'));
      }
    } catch {
      setError(t('messages.detail_load_failed'));
    } finally {
      setLoading(false);
    }
    // Fetch is keyed on the record id only — `t` lives in render scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    let cancelled = false;
    adminBroker
      .getMonitoring()
      .then((res) => {
        if (cancelled || !res?.success || !Array.isArray(res.data)) return;
        setMonitoredIds(new Set(res.data.filter((m) => m.under_monitoring).map((m) => m.user_id)));
      })
      .catch(() => {
        // Unknown stays unknown: the action is offered, the server decides.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleReview = async () => {
    if (!numericId) return;
    setReviewLoading(true);
    try {
      const res = await adminBroker.reviewMessage(numericId);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        // Straight on to the next message waiting, or back to the list if none.
        void queue.goNext();
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setReviewLoading(false);
    }
  };

  const copy = detail?.copy ?? null;
  const isArchived = !!detail && detail.archive !== null;
  const isReviewed = !!copy?.reviewed_at;
  const isFlagged = !!copy?.flagged;
  const canAct = !!detail && !isArchived;
  const senderMonitored = !!copy && (monitoredIds?.has(copy.sender_id) ?? false);

  // Keyboard: r / f / a act on this copy, n opens the next one waiting.
  useHotkey(
    {
      r: () => {
        if (canAct && !isReviewed && !reviewLoading) void handleReview();
      },
      f: () => {
        if (canAct && !isFlagged) setFlagModalOpen(true);
      },
      a: () => {
        if (canAct) setApproveModalOpen(true);
      },
      n: () => {
        if (queue.nextId) void queue.goNext();
      },
    },
    { enabled: !loading && !!detail },
  );

  // ── Shared header action ──────────────────────────────────────────────────

  const backButton = (
    <Button variant="tertiary" size="sm" startContent={<ArrowLeft size={16} aria-hidden="true" />} onPress={() => navigate(tenantPath(backPath))}>
      {t('messages.back')}
    </Button>
  );

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <BrokerPageShell help={HELP} title={t('messages.detail_page_title')} description={t('messages.detail_page_description')} icon={MessageSquareWarning} color="warning" actions={backButton}>
        <BrokerSkeleton variant="detail" />
      </BrokerPageShell>
    );
  }

  // ── Error state (honest — never renders an ok-looking page on failure) ────

  if (error || !detail || !copy) {
    return (
      <BrokerPageShell help={HELP} title={t('messages.detail_page_title')} description={t('messages.detail_page_description')} icon={MessageSquareWarning} color="warning" actions={backButton}>
        <BrokerEmptyState
          icon={XCircle}
          color="danger"
          title={error || t('messages.detail_not_found')}
          hint={t('messages.detail_not_found_hint')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="danger-soft" size="sm" startContent={<RefreshCw size={16} aria-hidden="true" />} onPress={loadDetail}>
                {t('messages.retry')}
              </Button>
              <Button variant="tertiary" size="sm" startContent={<ArrowLeft size={16} aria-hidden="true" />} onPress={() => navigate(tenantPath(backPath))}>
                {t('messages.detail_back_to_messages')}
              </Button>
            </div>
          }
        />
      </BrokerPageShell>
    );
  }

  const { thread, archive } = detail;
  const severity = normalizeSeverity(copy.flag_severity);
  // Same label the status chip shows, for the "Flagged (Urgent)" text.
  const severityLabel = copy.flag_severity ? t(`status.${severity}`) : t('messages.flagged_label');

  const monitorButton = (
    <Button
      variant="tertiary"
      size="sm"
      color="warning"
      startContent={<UserPlus size={16} aria-hidden="true" />}
      onPress={() => setMonitorModalOpen(true)}
      isDisabled={senderMonitored}
    >
      {t('messages.add_sender_to_monitoring')}
    </Button>
  );

  return (
    <BrokerPageShell
      help={HELP}
      title={t('messages.detail_page_title')}
      description={t('messages.detail_page_description')}
      icon={MessageSquareWarning}
      color="warning"
      actions={
        <>
          <BrokerQueueNav queue={queue} />
          {senderMonitored ? (
            <Tooltip content={t('messages.sender_already_monitored')}>
              <span className="inline-flex">{monitorButton}</span>
            </Tooltip>
          ) : (
            monitorButton
          )}
          {copy.related_listing_id && (
            <Button
              as={Link}
              to={tenantPath(`/broker/risk-tags?listing=${copy.related_listing_id}`)}
              variant="tertiary"
              size="sm"
              startContent={<Tag size={16} aria-hidden="true" />}
            >
              {t('messages.tag_listing')}
            </Button>
          )}
          {backButton}
        </>
      }
    >
      {/* ── Flag severity banner ───────────────────────────────────────────── */}
      {isFlagged && (
        <Card className={`mb-6 rounded-2xl border shadow-sm shadow-black/[0.03] ${SEVERITY_BANNER_CLASSES[severity]}`}>
          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${SEVERITY_MEDALLION_CLASSES[severity]}`}
              aria-hidden="true"
            >
              <Flag size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold tracking-tight text-foreground">{t('messages.detail_flag_banner_title')}</h3>
                {copy.flag_severity ? (
                  <BrokerStatusChip status={severity} />
                ) : (
                  <Chip size="sm" variant="soft" color="danger">
                    {severityLabel}
                  </Chip>
                )}
              </div>
              {copy.flag_reason ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">{copy.flag_reason}</p>
              ) : (
                <p className="mt-1 text-sm italic text-muted">{t('messages.detail_none')}</p>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Metadata card ──────────────────────────────────────────────────── */}
      <Card className={`${cardClass} mb-6`}>
        <CardHeader className="flex flex-wrap items-center gap-2 pb-0">
          <Shield size={18} className="text-warning" aria-hidden="true" />
          <h3 className="font-semibold tracking-tight">{t('messages.detail_metadata')}</h3>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {isFlagged && (
              <Chip size="sm" variant="soft" color="danger">
                <Flag size={12} aria-hidden="true" />
                <Chip.Label>
                  {t('messages.flagged_label')}
                  {copy.flag_severity ? ` (${severityLabel})` : ''}
                </Chip.Label>
              </Chip>
            )}
            {isReviewed && <BrokerStatusChip status="reviewed" />}
            {isArchived && (
              <Chip size="sm" variant="soft" color="default">
                <Archive size={12} aria-hidden="true" />
                <Chip.Label>{t('messages.detail_archived')}</Chip.Label>
              </Chip>
            )}
            {!isFlagged && !isReviewed && !isArchived && <BrokerStatusChip status="unreviewed" />}
          </div>
        </CardHeader>
        <CardBody>
          {/* Parties — both names open the member window */}
          <div className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden="true" className="shrink-0">
                <Avatar name={copy.sender_name} size="md" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('messages.col_sender')}</p>
                <MemberName userId={copy.sender_id} name={copy.sender_name} className="truncate text-sm font-semibold" />
              </div>
            </div>
            <ArrowRight size={18} className="hidden shrink-0 text-muted sm:block" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden="true" className="shrink-0">
                <Avatar name={copy.receiver_name} size="md" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('messages.col_receiver')}</p>
                <MemberName userId={copy.receiver_id} name={copy.receiver_name} className="truncate text-sm font-semibold" />
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-1 text-xs text-muted">
                <FileText size={12} aria-hidden="true" /> {t('messages.detail_listing')}
              </p>
              <p className="truncate text-sm text-foreground">
                {copy.listing_title || <span className="text-muted">{t('messages.detail_none')}</span>}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted">{t('messages.detail_copy_reason')}</p>
              <Chip size="sm" variant="soft" color={COPY_REASON_COLORS[copy.copy_reason] ?? 'default'}>
                {t(`messages.copy_reason_${copy.copy_reason}`)}
              </Chip>
            </div>
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-xs text-muted">
                <Calendar size={12} aria-hidden="true" /> {t('messages.detail_sent')}
              </p>
              <p className="text-sm tabular-nums text-foreground">{formatServerDateTime(copy.sent_at)}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* ── Conversation thread (chat bubbles) ─────────────────────────────── */}
      {id && (
        <MessageThreadCard
          className={`${cardClass} mb-6`}
          copyId={id}
          thread={thread}
          originalMessageId={copy.original_message_id}
          senderId={copy.sender_id}
        />
      )}

      {/* ── Archive record (if archived) ───────────────────────────────────── */}
      {isArchived && archive && (
        <Card className={`${cardClass} mb-6`}>
          <CardHeader className="flex items-center gap-2 pb-0">
            <Archive size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold tracking-tight">{t('messages.detail_archive_record')}</h3>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-xs text-muted">{t('messages.detail_decision')}</p>
                {/* The decision actually recorded (approved / flagged / …), never an assumed "Flagged". */}
                <BrokerStatusChip status={archive.decision} />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-muted">{t('messages.detail_decided_by')}</p>
                <p className="truncate text-sm font-medium text-foreground">{archive.decided_by_name}</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Calendar size={12} aria-hidden="true" /> {t('messages.detail_date')}
                </p>
                <p className="text-sm tabular-nums text-foreground">{formatServerDateTime(archive.decided_at)}</p>
              </div>
            </div>
            {archive.decision_notes && (
              <>
                <Separator className="my-3" />
                <div className="space-y-1">
                  <p className="text-xs text-muted">{t('messages.detail_notes')}</p>
                  <p className="rounded-lg bg-surface-secondary p-3 text-sm text-foreground">{archive.decision_notes}</p>
                </div>
              </>
            )}
          </CardBody>
        </Card>
      )}

      {/* ── Decision bar ───────────────────────────────────────────────────── */}
      <Card className={cardClass}>
        <CardBody className="p-4 sm:p-5">
          {isArchived ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Archive size={16} aria-hidden="true" />
              {t('messages.detail_archived_no_actions')}
            </p>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-muted">
                <Shield size={16} aria-hidden="true" />
                {t('messages.detail_decision_prompt')}
              </p>
              <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                {!isReviewed && (
                  <Button color="success" variant="flat" startContent={!reviewLoading && <CheckCircle size={16} aria-hidden="true" />} onPress={handleReview} isLoading={reviewLoading}>
                    {t('messages.detail_mark_reviewed')}
                  </Button>
                )}
                {!isFlagged && (
                  <Button color="warning" variant="flat" startContent={<Flag size={16} aria-hidden="true" />} onPress={() => setFlagModalOpen(true)}>
                    {t('messages.flag_action')}
                  </Button>
                )}
                <Button color="primary" startContent={<Archive size={16} aria-hidden="true" />} onPress={() => setApproveModalOpen(true)}>
                  {t('messages.detail_approve_archive')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <FlagMessageModal messageId={numericId} isOpen={flagModalOpen} onClose={() => setFlagModalOpen(false)} onFlagged={() => void loadDetail()} />

      <ApproveArchiveModal messageId={numericId} isOpen={approveModalOpen} onClose={() => setApproveModalOpen(false)} onApproved={() => void queue.goNext()} />

      <MonitorSenderModal
        isOpen={monitorModalOpen}
        onClose={() => setMonitorModalOpen(false)}
        sender={{ id: copy.sender_id, name: copy.sender_name }}
        messageId={copy.id}
        onAdded={(userId) => setMonitoredIds((prev) => new Set([...(prev ?? []), userId]))}
      />
    </BrokerPageShell>
  );
}

export default MessageDetail;
