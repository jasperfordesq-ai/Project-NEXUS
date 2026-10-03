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
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Flag from 'lucide-react/icons/flag';
import Archive from 'lucide-react/icons/archive';
import Shield from 'lucide-react/icons/shield';
import MessageCircle from 'lucide-react/icons/message-circle';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import Calendar from 'lucide-react/icons/calendar';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import FileText from 'lucide-react/icons/file-text';
import Mic from 'lucide-react/icons/mic';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerMessageDetail, ConversationMessage } from '@/admin/api/types';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Chip,
  Textarea,
  Select,
  SelectItem,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Avatar,
  Separator,
  ScrollShadow,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerSkeleton,
  BrokerEmptyState,
  BrokerStatusChip,
} from '../components';
import { BrokerQueueNav } from '../components/BrokerQueueNav';
import { useBrokerQueue } from '../useBrokerQueue';

/** The message queues a broker works through; history tabs have no "next". */
const MESSAGE_QUEUES = ['unreviewed', 'urgent', 'flagged'] as const;
type MessageQueue = (typeof MESSAGE_QUEUES)[number];

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
// Chip colors mirror MessageReviewPage's severity mapping; banner tints follow
// the dashboard's gradient hero pattern. Tailwind JIT needs literal classes.

type FlagSeverity = 'info' | 'warning' | 'concern' | 'urgent';

const SEVERITY_CHIP_COLORS: Record<FlagSeverity, 'default' | 'warning' | 'danger'> = {
  info: 'default',
  warning: 'warning',
  concern: 'danger',
  urgent: 'danger',
};

const SEVERITY_BANNER_CLASSES: Record<FlagSeverity, string> = {
  info: 'border-divider/70 bg-gradient-to-br from-surface-secondary via-surface to-surface',
  warning: 'border-warning/30 bg-gradient-to-br from-warning/10 via-surface to-surface',
  concern: 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface',
  urgent: 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface',
};

const SEVERITY_MEDALLION_CLASSES: Record<FlagSeverity, string> = {
  info: 'bg-surface-tertiary text-muted',
  warning: 'bg-warning/10 text-warning',
  concern: 'bg-danger/10 text-danger',
  urgent: 'bg-danger/10 text-danger',
};

function normalizeSeverity(severity?: string | null): FlagSeverity {
  const s = (severity || '').toLowerCase();
  return s === 'info' || s === 'warning' || s === 'concern' || s === 'urgent' ? s : 'concern';
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MessageDetail() {
  const { t } = useTranslation('broker');
  usePageTitle(t('messages.detail_title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Data state
  const [detail, setDetail] = useState<BrokerMessageDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action loading states
  const [reviewLoading, setReviewLoading] = useState(false);
  const [approveLoading, setApproveLoading] = useState(false);

  // Flag modal state
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [flagSeverity, setFlagSeverity] = useState<FlagSeverity>('concern');
  const [flagLoading, setFlagLoading] = useState(false);

  // Approve modal state
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveNotes, setApproveNotes] = useState('');

  // The queue this message was opened from (?queue=), so "next" stays in it.
  const [searchParams] = useSearchParams();
  const queueParam = searchParams.get('queue');
  const queueName: MessageQueue = (MESSAGE_QUEUES as readonly string[]).includes(queueParam ?? '')
    ? (queueParam as MessageQueue)
    : 'unreviewed';
  const queue = useBrokerQueue({
    currentId: id ? Number(id) : null,
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
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setError(t('messages.detail_invalid_id'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await adminBroker.showMessage(numericId);
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
    loadDetail();
  }, [loadDetail]);

  // ── Actions ───────────────────────────────────────────────────────────────

  const handleReview = async () => {
    if (!id) return;
    setReviewLoading(true);
    try {
      const res = await adminBroker.reviewMessage(Number(id));
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

  const handleFlag = async () => {
    if (!id) return;
    if (!flagReason.trim()) {
      toast.error(t('messages.flag_reason_required'));
      return;
    }
    setFlagLoading(true);
    try {
      const res = await adminBroker.flagMessage(Number(id), flagReason, flagSeverity);
      if (res?.success) {
        toast.success(t('messages.flag_success'));
        setFlagModalOpen(false);
        setFlagReason('');
        setFlagSeverity('concern');
        loadDetail();
      } else {
        toast.error(res?.error || t('messages.flag_failed'));
      }
    } catch {
      toast.error(t('messages.flag_failed'));
    } finally {
      setFlagLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!id) return;
    setApproveLoading(true);
    try {
      const res = await adminBroker.approveMessage(Number(id), approveNotes || undefined);
      if (res?.success) {
        toast.success(t('messages.detail_approve_success'));
        setApproveModalOpen(false);
        void queue.goNext();
      } else {
        toast.error(res?.error || t('messages.detail_approve_failed'));
      }
    } catch {
      toast.error(t('messages.detail_approve_failed'));
    } finally {
      setApproveLoading(false);
    }
  };

  // ── Shared header action ──────────────────────────────────────────────────

  const backButton = (
    <Button
      variant="tertiary"
      size="sm"
      startContent={<ArrowLeft size={16} />}
      onPress={() => navigate(tenantPath('/broker/messages'))}
    >
      {t('messages.back')}
    </Button>
  );

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <BrokerPageShell
        title={t('messages.detail_page_title')}
        description={t('messages.detail_page_description')}
        icon={MessageSquareWarning}
        color="warning"
        actions={backButton}
      >
        <BrokerSkeleton variant="detail" />
      </BrokerPageShell>
    );
  }

  // ── Error state (honest — never renders an ok-looking page on failure) ────

  if (error || !detail) {
    return (
      <BrokerPageShell
        title={t('messages.detail_page_title')}
        description={t('messages.detail_page_description')}
        icon={MessageSquareWarning}
        color="warning"
        actions={backButton}
      >
        <BrokerEmptyState
          icon={XCircle}
          color="danger"
          title={error || t('messages.detail_not_found')}
          hint={t('messages.detail_not_found_hint')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="danger-soft"
                size="sm"
                startContent={<RefreshCw size={16} />}
                onPress={loadDetail}
              >
                {t('messages.retry')}
              </Button>
              <Button
                variant="tertiary"
                size="sm"
                startContent={<ArrowLeft size={16} />}
                onPress={() => navigate(tenantPath('/broker/messages'))}
              >
                {t('messages.detail_back_to_messages')}
              </Button>
            </div>
          }
        />
      </BrokerPageShell>
    );
  }

  const { copy, thread, archive } = detail;
  const isArchived = archive !== null;
  const isReviewed = !!copy.reviewed_at;
  const isFlagged = copy.flagged;
  const severity = normalizeSeverity(copy.flag_severity);
  const severityLabel = copy.flag_severity
    ? t(`messages.severity_${severity}`, { defaultValue: copy.flag_severity })
    : t('messages.flagged_label');

  return (
    <BrokerPageShell
      title={t('messages.detail_page_title')}
      description={t('messages.detail_page_description')}
      icon={MessageSquareWarning}
      color="warning"
      actions={
        <>
          <BrokerQueueNav queue={queue} />
          {backButton}
        </>
      }
    >
      {/* ── Flag severity banner ───────────────────────────────────────────── */}
      {isFlagged && (
        <Card
          className={`mb-6 rounded-2xl border shadow-sm shadow-black/[0.03] ${SEVERITY_BANNER_CLASSES[severity]}`}
        >
          <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4 sm:p-5">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${SEVERITY_MEDALLION_CLASSES[severity]}`}
              aria-hidden="true"
            >
              <Flag size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold tracking-tight text-foreground">
                  {t('messages.detail_flag_banner_title')}
                </h3>
                <Chip size="sm" variant="soft" color={SEVERITY_CHIP_COLORS[severity]}>
                  {severityLabel}
                </Chip>
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
          {/* Parties */}
          <div className="flex flex-col gap-3 rounded-xl bg-surface-secondary p-4 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden="true" className="shrink-0">
                <Avatar name={copy.sender_name} size="md" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('messages.col_sender')}</p>
                <p className="truncate text-sm font-semibold text-foreground">{copy.sender_name}</p>
              </div>
            </div>
            <ArrowRight size={18} className="hidden shrink-0 text-muted sm:block" aria-hidden="true" />
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span aria-hidden="true" className="shrink-0">
                <Avatar name={copy.receiver_name} size="md" />
              </span>
              <div className="min-w-0">
                <p className="text-xs text-muted">{t('messages.col_receiver')}</p>
                <p className="truncate text-sm font-semibold text-foreground">{copy.receiver_name}</p>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Listing */}
            <div className="min-w-0 space-y-1">
              <p className="flex items-center gap-1 text-xs text-muted">
                <FileText size={12} aria-hidden="true" /> {t('messages.detail_listing')}
              </p>
              <p className="truncate text-sm text-foreground">
                {copy.listing_title || <span className="text-muted">{t('messages.detail_none')}</span>}
              </p>
            </div>

            {/* Copy Reason */}
            <div className="space-y-1">
              <p className="text-xs text-muted">{t('messages.detail_copy_reason')}</p>
              <Chip size="sm" variant="soft" color={COPY_REASON_COLORS[copy.copy_reason] ?? 'default'}>
                {t(`messages.copy_reason_${copy.copy_reason}`)}
              </Chip>
            </div>

            {/* Sent At */}
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
      <Card className={`${cardClass} mb-6`}>
        <CardHeader className="flex items-center gap-2 pb-0">
          <MessageCircle size={18} className="text-warning" aria-hidden="true" />
          <h3 className="font-semibold tracking-tight">{t('messages.detail_conversation_thread')}</h3>
          <Chip size="sm" variant="soft" color="default" className="ml-auto tabular-nums">
            {t('messages.detail_message_count', { count: thread.length })}
          </Chip>
        </CardHeader>
        <CardBody>
          {thread.length === 0 ? (
            <BrokerEmptyState
              bare
              icon={MessageCircle}
              color="neutral"
              title={t('messages.detail_no_thread_messages')}
            />
          ) : (
            <ScrollShadow className="max-h-[500px]">
              <div className="space-y-4 pr-1">
                {thread.map((msg: ConversationMessage) => {
                  const isTarget = msg.id === copy.original_message_id;
                  const isFromSender = msg.sender_id === copy.sender_id;
                  return (
                    <div
                      key={msg.id}
                      className={`flex items-start gap-3 ${isFromSender ? '' : 'flex-row-reverse'}`}
                    >
                      <span aria-hidden="true" className="mt-0.5 shrink-0">
                        <Avatar name={msg.sender_name} size="sm" />
                      </span>
                      <div className={`flex min-w-0 max-w-[85%] flex-col ${isFromSender ? 'items-start' : 'items-end'}`}>
                        {/* Bubble header: name · timestamp · badges */}
                        <div
                          className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${
                            isFromSender ? '' : 'flex-row-reverse'
                          }`}
                        >
                          <span className="text-sm font-semibold text-foreground">{msg.sender_name}</span>
                          <span className="text-xs tabular-nums text-muted">
                            {formatServerDateTime(msg.created_at)}
                          </span>
                          {isTarget && (
                            <Chip size="sm" variant="soft" color="warning">
                              <AlertTriangle size={12} aria-hidden="true" />
                              <Chip.Label>{t('messages.detail_copied')}</Chip.Label>
                            </Chip>
                          )}
                          {!!msg.is_edited && (
                            <span className="text-xs italic text-muted">{t('messages.detail_edited')}</span>
                          )}
                        </div>

                        {/* Bubble */}
                        <div
                          className={`rounded-2xl px-4 py-2.5 ${
                            isFromSender ? 'rounded-tl-md bg-surface-secondary' : 'rounded-tr-md bg-accent/10'
                          } ${isTarget ? 'ring-1 ring-inset ring-warning/60' : ''}`}
                        >
                          {msg.subject && (
                            <p className="mb-1 text-xs font-medium text-muted">
                              {t('messages.detail_subject')}: {msg.subject}
                            </p>
                          )}
                          {msg.is_deleted ? (
                            <p className="text-sm italic text-muted">{t('messages.detail_message_deleted')}</p>
                          ) : msg.is_voice ? (
                            <div className="space-y-1">
                              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                                <Mic size={14} aria-hidden="true" />
                                {msg.audio_duration
                                  ? t('messages.detail_voice_message_length', { seconds: msg.audio_duration })
                                  : t('messages.detail_voice_message')}
                              </p>
                              {msg.transcript ? (
                                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                                  {t('messages.detail_voice_transcript', { text: msg.transcript })}
                                </p>
                              ) : (
                                <p className="text-xs text-muted">{t('messages.detail_voice_no_transcript')}</p>
                              )}
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words text-sm text-foreground">{msg.body}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollShadow>
          )}
        </CardBody>
      </Card>

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
                <Chip
                  size="sm"
                  variant="soft"
                  color={archive.decision === 'approved' ? 'success' : 'danger'}
                >
                  {archive.decision === 'approved'
                    ? t('status.approved')
                    : t('messages.flagged_label')}
                </Chip>
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-muted">{t('messages.detail_decided_by')}</p>
                <p className="truncate text-sm font-medium text-foreground">{archive.decided_by_name}</p>
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Calendar size={12} aria-hidden="true" /> {t('messages.detail_date')}
                </p>
                <p className="text-sm tabular-nums text-foreground">
                  {formatServerDateTime(archive.decided_at)}
                </p>
              </div>
            </div>
            {archive.decision_notes && (
              <>
                <Separator className="my-3" />
                <div className="space-y-1">
                  <p className="text-xs text-muted">{t('messages.detail_notes')}</p>
                  <p className="rounded-lg bg-surface-secondary p-3 text-sm text-foreground">
                    {archive.decision_notes}
                  </p>
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
                {/* Mark Reviewed */}
                {!isReviewed && (
                  <Button
                    color="success"
                    variant="flat"
                    startContent={!reviewLoading && <CheckCircle size={16} />}
                    onPress={handleReview}
                    isLoading={reviewLoading}
                  >
                    {t('messages.detail_mark_reviewed')}
                  </Button>
                )}

                {/* Flag */}
                {!isFlagged && (
                  <Button
                    color="warning"
                    variant="flat"
                    startContent={<Flag size={16} />}
                    onPress={() => {
                      setFlagReason('');
                      setFlagSeverity('concern');
                      setFlagModalOpen(true);
                    }}
                  >
                    {t('messages.flag_action')}
                  </Button>
                )}

                {/* Approve & Archive */}
                <Button
                  color="primary"
                  startContent={<Archive size={16} />}
                  onPress={() => {
                    setApproveNotes('');
                    setApproveModalOpen(true);
                  }}
                >
                  {t('messages.detail_approve_archive')}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Flag Modal ─────────────────────────────────────────────────────── */}
      <Modal isOpen={flagModalOpen} onClose={() => setFlagModalOpen(false)} size="md">
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
                const val = Array.from(keys)[0] as FlagSeverity;
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
              startContent={!flagLoading && <Flag size={16} />}
            >
              {t('messages.flag_action')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ── Approve & Archive Modal ────────────────────────────────────────── */}
      <Modal isOpen={approveModalOpen} onClose={() => setApproveModalOpen(false)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Archive size={20} className="text-accent" aria-hidden="true" />
            {t('messages.detail_approve_archive')}
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground">{t('messages.detail_approve_confirm')}</p>
            <p className="text-sm text-muted">{t('messages.detail_approve_warning')}</p>
            <Textarea
              label={t('messages.detail_decision_notes_label')}
              placeholder={t('messages.detail_decision_notes_placeholder')}
              value={approveNotes}
              onValueChange={setApproveNotes}
              minRows={3}
              variant="bordered"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => setApproveModalOpen(false)}
              isDisabled={approveLoading}
            >
              {t('messages.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={handleApprove}
              isLoading={approveLoading}
              startContent={!approveLoading && <Archive size={16} />}
            >
              {t('messages.detail_approve_archive')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BrokerPageShell>
  );
}

export default MessageDetail;
