// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Edit3 from 'lucide-react/icons/edit-3';
import History from 'lucide-react/icons/history';
import MailPlus from 'lucide-react/icons/mail-plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import ShieldCheck from 'lucide-react/icons/shield-check';
import XCircle from 'lucide-react/icons/x-circle';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts/ToastContext';
import {
  eventCommunicationsApi,
  type EventBroadcast,
  type EventBroadcastChannel,
  type EventBroadcastContentInput,
  type EventBroadcastDetail,
  type EventBroadcastPreview,
  type EventBroadcastSegment,
  type EventBroadcastVariant,
} from '@/lib/event-communications-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface EventCommunicationsWorkspaceProps {
  eventId: number;
  eventTitle?: string;
}

const SEGMENTS: EventBroadcastSegment[] = [
  'registration_confirmed',
  'waitlist_active',
  'attendance_attended',
  'attendance_no_show',
];
const CHANNELS: EventBroadcastChannel[] = ['email', 'in_app', 'push'];

function newIdempotencyKey(action: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `event-broadcast-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function initialContent(): EventBroadcastContentInput {
  return {
    variant: 'announcement',
    segments: ['registration_confirmed'],
    channels: ['email', 'in_app'],
    body: '',
  };
}

export function EventCommunicationsWorkspace({ eventId, eventTitle }: EventCommunicationsWorkspaceProps) {
  const { t } = useTranslation('event_communications');
  const toast = useToast();
  const generation = useRef(0);
  const auditGeneration = useRef(0);
  const [broadcasts, setBroadcasts] = useState<EventBroadcast[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{
    current_page: number;
    per_page: number;
    total: number;
    total_pages: number;
    has_more: boolean;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<EventBroadcast | null>(null);
  const [content, setContent] = useState<EventBroadcastContentInput>(initialContent);
  const [preview, setPreview] = useState<EventBroadcastPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [scheduleTarget, setScheduleTarget] = useState<EventBroadcast | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'later'>('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<EventBroadcast | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [auditTarget, setAuditTarget] = useState<EventBroadcast | null>(null);
  const [auditDetail, setAuditDetail] = useState<EventBroadcastDetail | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [isAuditLoadingMore, setIsAuditLoadingMore] = useState(false);

  const load = useCallback(async () => {
    const requestGeneration = ++generation.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventCommunicationsApi.list(eventId, page);
      if (requestGeneration !== generation.current) return;
      if (!response.success || !response.data) {
        setLoadError(true);
        return;
      }
      setBroadcasts(response.data);
      setPagination(response.meta ?? null);
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      logError('Failed to load event communications', error);
      setLoadError(true);
    } finally {
      if (requestGeneration === generation.current) setIsLoading(false);
    }
  }, [eventId, page]);

  useEffect(() => {
    setPage(1);
  }, [eventId]);

  useEffect(() => {
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => () => { auditGeneration.current += 1; }, []);

  function updateContent(next: Partial<EventBroadcastContentInput>) {
    setContent((current) => ({ ...current, ...next }));
    setPreview(null);
  }

  function openNewComposer() {
    setEditing(null);
    setContent(initialContent());
    setPreview(null);
    setComposerOpen(true);
  }

  async function openEditComposer(broadcast: EventBroadcast) {
    try {
      const response = await eventCommunicationsApi.get(broadcast.id, 1, 1);
      if (!response.success || !response.data || response.data.broadcast.body === null) {
        toast.error(t('load_detail_error'));
        return;
      }
      const detail = response.data.broadcast;
      const body = detail.body;
      if (body === null) {
        toast.error(t('load_detail_error'));
        return;
      }
      setEditing(detail);
      setContent({
        variant: detail.variant,
        segments: detail.audience.segments,
        channels: detail.channels,
        body,
      });
      setPreview(null);
      setComposerOpen(true);
    } catch (error) {
      logError('Failed to load event communication draft', error);
      toast.error(t('load_detail_error'));
    }
  }

  function toggleSegment(segment: EventBroadcastSegment, selected: boolean) {
    const next = selected
      ? [...new Set([...content.segments, segment])]
      : content.segments.filter((value) => value !== segment);
    updateContent({ segments: next });
  }

  function toggleChannel(channel: EventBroadcastChannel, selected: boolean) {
    const next = selected
      ? [...new Set([...content.channels, channel])]
      : content.channels.filter((value) => value !== channel);
    updateContent({ channels: next });
  }

  async function previewAudience() {
    if (content.segments.length === 0 || content.channels.length === 0) return;
    setIsPreviewing(true);
    try {
      const response = await eventCommunicationsApi.preview(eventId, {
        variant: content.variant,
        segments: content.segments,
        channels: content.channels,
      });
      if (!response.success || !response.data) {
        toast.error(t('preview_error'));
        return;
      }
      setPreview(response.data);
    } catch (error) {
      logError('Failed to preview event communication audience', error);
      toast.error(t('preview_error'));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function saveDraft() {
    if (!preview || !content.body.trim()) return;
    setIsSaving(true);
    try {
      const response = editing
        ? await eventCommunicationsApi.revise(
          editing.id,
          editing.version,
          content,
          newIdempotencyKey('revise'),
        )
        : await eventCommunicationsApi.create(
          eventId,
          content,
          newIdempotencyKey('create'),
        );
      if (!response.success || !response.data) {
        toast.error(t('save_error'));
        return;
      }
      const saved = response.data.broadcast;
      setBroadcasts((current) => {
        const exists = current.some((item) => item.id === saved.id);
        return exists
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [saved, ...current];
      });
      toast.success(t(editing ? 'revise_success' : 'create_success'));
      setComposerOpen(false);
      setEditing(null);
      setPreview(null);
    } catch (error) {
      logError('Failed to save event communication draft', error);
      toast.error(t('save_error'));
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmSchedule() {
    if (!scheduleTarget || (scheduleMode === 'later' && !scheduledAt)) return;
    setIsScheduling(true);
    try {
      const timestamp = scheduleMode === 'later' ? new Date(scheduledAt).toISOString() : null;
      const response = await eventCommunicationsApi.schedule(
        scheduleTarget.id,
        scheduleTarget.version,
        timestamp,
        newIdempotencyKey('schedule'),
      );
      if (!response.success || !response.data) {
        toast.error(t('schedule_error'));
        return;
      }
      replaceBroadcast(response.data.broadcast);
      toast.success(t('schedule_success'));
      setScheduleTarget(null);
      setScheduleMode('now');
      setScheduledAt('');
    } catch (error) {
      logError('Failed to schedule event communication', error);
      toast.error(t('schedule_error'));
    } finally {
      setIsScheduling(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget || !cancelReason.trim()) return;
    setIsCancelling(true);
    try {
      const response = await eventCommunicationsApi.cancel(
        cancelTarget.id,
        cancelTarget.version,
        cancelReason.trim(),
        newIdempotencyKey('cancel'),
      );
      if (!response.success || !response.data) {
        toast.error(t('cancel_error'));
        return;
      }
      replaceBroadcast(response.data.broadcast);
      toast.success(t('cancel_success'));
      setCancelTarget(null);
      setCancelReason('');
    } catch (error) {
      logError('Failed to cancel event communication', error);
      toast.error(t('cancel_error'));
    } finally {
      setIsCancelling(false);
    }
  }

  async function retryFailed(broadcast: EventBroadcast) {
    setRetryingId(broadcast.id);
    try {
      const response = await eventCommunicationsApi.retry(
        broadcast.id,
        broadcast.version,
        newIdempotencyKey('retry'),
      );
      if (!response.success || !response.data) {
        toast.error(t('retry_error'));
        return;
      }
      replaceBroadcast(response.data.broadcast);
      toast.success(t('retry_success'));
    } catch (error) {
      logError('Failed to retry event communication', error);
      toast.error(t('retry_error'));
    } finally {
      setRetryingId(null);
    }
  }

  async function openAudit(broadcast: EventBroadcast) {
    const requestGeneration = ++auditGeneration.current;
    setAuditTarget(broadcast);
    setAuditDetail(null);
    setIsAuditLoading(true);
    setIsAuditLoadingMore(false);
    try {
      const response = await eventCommunicationsApi.get(broadcast.id, 1, 50);
      if (requestGeneration !== auditGeneration.current) return;
      if (!response.success || !response.data) {
        toast.error(t('load_history_error'));
        return;
      }
      setAuditDetail(response.data);
    } catch (error) {
      if (requestGeneration !== auditGeneration.current) return;
      logError('Failed to load event communication history', error);
      toast.error(t('load_history_error'));
    } finally {
      if (requestGeneration === auditGeneration.current) setIsAuditLoading(false);
    }
  }

  async function loadMoreAuditHistory() {
    if (!auditTarget || !auditDetail?.history_meta.has_more || isAuditLoadingMore) return;
    const broadcastId = auditTarget.id;
    const requestGeneration = auditGeneration.current;
    const nextPage = auditDetail.history_meta.current_page + 1;
    setIsAuditLoadingMore(true);
    try {
      const response = await eventCommunicationsApi.get(broadcastId, nextPage, 50);
      if (requestGeneration !== auditGeneration.current || auditTarget.id !== broadcastId) return;
      if (!response.success || !response.data || response.data.broadcast.id !== broadcastId) {
        toast.error(t('load_history_error'));
        return;
      }
      const detail = response.data;
      setAuditDetail((current) => {
        if (!current || current.broadcast.id !== broadcastId) return current;
        const byId = new Map(current.history.map((entry) => [entry.id, entry]));
        detail.history.forEach((entry) => byId.set(entry.id, entry));
        return {
          ...detail,
          history: [...byId.values()],
        };
      });
    } catch (error) {
      if (requestGeneration !== auditGeneration.current) return;
      logError('Failed to load more event communication history', error);
      toast.error(t('load_history_error'));
    } finally {
      if (requestGeneration === auditGeneration.current) setIsAuditLoadingMore(false);
    }
  }

  function closeAudit() {
    auditGeneration.current += 1;
    setAuditTarget(null);
    setAuditDetail(null);
    setIsAuditLoading(false);
    setIsAuditLoadingMore(false);
  }

  function replaceBroadcast(saved: EventBroadcast) {
    setBroadcasts((current) => current.map((item) => item.id === saved.id ? saved : item));
  }

  function dateLabel(value: string | null): string {
    if (!value) return t('not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('not_recorded');
    return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  return (
    <section aria-labelledby={`event-communications-${eventId}`} className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={`event-communications-${eventId}`} className="text-xl font-semibold text-theme-primary">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">{t('description')}</p>
        </div>
        <Button startContent={<MailPlus className="h-4 w-4" aria-hidden="true" />} onPress={openNewComposer}>
          {t('new_message')}
        </Button>
      </div>

      <Alert
        color="primary"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title={t('privacy_title')}
        description={t('privacy_description')}
      />

      {loadError ? (
        <Alert
          color="danger"
          title={t('load_error_title')}
          description={t('load_error_description')}
          endContent={<Button size="sm" variant="danger-soft" onPress={() => void load()}>{t('retry')}</Button>}
        />
      ) : isLoading ? (
        <div className="flex min-h-48 items-center justify-center" aria-label={t('loading')}><Spinner /></div>
      ) : broadcasts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-theme-default p-8 text-center">
          <Send className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-theme-primary">{t('empty_title')}</h3>
          <p className="mt-1 text-sm text-theme-muted">{t('empty_description')}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2" aria-live="polite">
            {broadcasts.map((broadcast) => (
            <Card key={broadcast.id} className="border border-theme-default">
              <CardHeader className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-theme-primary">{t(`variants.${broadcast.variant}`)}</h3>
                  <p className="mt-1 text-xs text-theme-subtle">{t('version', { version: broadcast.version })}</p>
                </div>
                <Chip color={statusColor(broadcast.status)} variant="flat" size="sm">
                  {t(`statuses.${broadcast.status}`)}
                </Chip>
              </CardHeader>
              <CardBody className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-theme-subtle">{t('audience')}</dt>
                    <dd className="font-medium text-theme-primary">{t('recipient_count', { count: broadcast.audience.recipient_count })}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('channels')}</dt>
                    <dd className="font-medium text-theme-primary">{broadcast.channels.map((channel) => t(`channel_labels.${channel}`)).join(', ')}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('delivery')}</dt>
                    <dd className="font-medium text-theme-primary">{t('delivery_progress', {
                      delivered: broadcast.delivery.delivered,
                      total: broadcast.delivery.total,
                    })}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('scheduled_for')}</dt>
                    <dd className="font-medium text-theme-primary">{dateLabel(broadcast.scheduled_at)}</dd>
                  </div>
                </dl>
                {broadcast.delivery.dead_lettered > 0 && (
                  <Alert color="danger" title={t('dead_letter_title')} description={t('dead_letter_description', {
                    count: broadcast.delivery.dead_lettered,
                  })} />
                )}
                <div className="flex flex-wrap gap-2">
                  {broadcast.audience.segments.map((segment) => (
                    <Chip key={segment} size="sm" variant="flat">{t(`segment_labels.${segment}`)}</Chip>
                  ))}
                </div>
              </CardBody>
              <CardFooter className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" startContent={<History className="h-4 w-4" aria-hidden="true" />} onPress={() => void openAudit(broadcast)}>
                  {t('view_history')}
                </Button>
                {broadcast.capabilities.edit && (
                  <Button size="sm" variant="secondary" startContent={<Edit3 className="h-4 w-4" aria-hidden="true" />} onPress={() => void openEditComposer(broadcast)}>
                    {t('edit')}
                  </Button>
                )}
                {broadcast.capabilities.schedule && (
                  <Button size="sm" startContent={<CalendarClock className="h-4 w-4" aria-hidden="true" />} onPress={() => setScheduleTarget(broadcast)}>
                    {t('schedule')}
                  </Button>
                )}
                {broadcast.capabilities.cancel && (
                  <Button size="sm" variant="danger-soft" startContent={<XCircle className="h-4 w-4" aria-hidden="true" />} onPress={() => setCancelTarget(broadcast)}>
                    {t('cancel')}
                  </Button>
                )}
                {broadcast.capabilities.retry && (
                  <Button size="sm" variant="secondary" isPending={retryingId === broadcast.id} startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />} onPress={() => void retryFailed(broadcast)}>
                    {t('retry_failed')}
                  </Button>
                )}
              </CardFooter>
            </Card>
            ))}
          </div>
          {pagination && pagination.total_pages > 1 && (
            <div className="flex justify-end border-t border-theme-default pt-4">
              <Pagination
                page={pagination.current_page}
                total={pagination.total_pages}
                showControls
                aria-label={t('title')}
                onChange={setPage}
              />
            </div>
          )}
        </>
      )}

      <Modal isOpen={composerOpen} size="3xl" scrollBehavior="inside" onOpenChange={setComposerOpen}>
        <ModalContent>
          <ModalHeader>{t(editing ? 'composer_edit_title' : 'composer_new_title', { title: eventTitle ?? '' })}</ModalHeader>
          <ModalBody className="space-y-5">
            <Select
              label={t('variant_label')}
              selectedKeys={new Set([content.variant])}
              onSelectionChange={(keys) => {
                const value = [...keys][0] as EventBroadcastVariant | undefined;
                if (value) updateContent({
                  variant: value,
                  segments: value === 'announcement' ? content.segments : ['attendance_attended'],
                });
              }}
            >
              <SelectItem id="announcement">{t('variants.announcement')}</SelectItem>
              <SelectItem id="follow_up">{t('variants.follow_up')}</SelectItem>
              <SelectItem id="review_request">{t('variants.review_request')}</SelectItem>
            </Select>

            <fieldset className="space-y-2">
              <legend className="font-medium text-theme-primary">{t('segments_label')}</legend>
              <p className="text-sm text-theme-muted">{t('segments_description')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {SEGMENTS.map((segment) => {
                  const postEventOnly = content.variant !== 'announcement';
                  const disabled = content.variant === 'review_request'
                    ? segment !== 'attendance_attended'
                    : postEventOnly && !segment.startsWith('attendance_');
                  return (
                    <Checkbox
                      key={segment}
                      isDisabled={disabled}
                      isSelected={content.segments.includes(segment)}
                      onValueChange={(selected) => toggleSegment(segment, selected)}
                    >
                      {t(`segment_labels.${segment}`)}
                    </Checkbox>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="font-medium text-theme-primary">{t('channels_label')}</legend>
              <div className="flex flex-wrap gap-4">
                {CHANNELS.map((channel) => (
                  <Checkbox
                    key={channel}
                    isSelected={content.channels.includes(channel)}
                    onValueChange={(selected) => toggleChannel(channel, selected)}
                  >
                    {t(`channel_labels.${channel}`)}
                  </Checkbox>
                ))}
              </div>
            </fieldset>

            <Textarea
              label={t('body_label')}
              description={t('body_description')}
              value={content.body}
              maxLength={20000}
              minRows={6}
              onValueChange={(body) => updateContent({ body })}
            />

            {preview && (
              <Alert
                color={preview.recipient_count > 0 ? 'success' : 'warning'}
                title={t('preview_title')}
                description={t('preview_summary', {
                  recipients: preview.recipient_count,
                  deliveries: preview.delivery_count,
                })}
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setComposerOpen(false)}>{t('close')}</Button>
            <Button
              variant="secondary"
              isDisabled={content.segments.length === 0 || content.channels.length === 0}
              isPending={isPreviewing}
              onPress={() => void previewAudience()}
            >
              {t('preview_audience')}
            </Button>
            <Button
              isDisabled={!preview || preview.recipient_count === 0 || !content.body.trim()}
              isPending={isSaving}
              onPress={() => void saveDraft()}
            >
              {t('save_draft')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={auditTarget !== null}
        size="2xl"
        scrollBehavior="inside"
        onOpenChange={(open) => {
          if (!open) closeAudit();
        }}
      >
        <ModalContent>
          <ModalHeader>{t('history_title')}</ModalHeader>
          <ModalBody>
            {isAuditLoading ? (
              <div className="flex min-h-32 items-center justify-center" aria-label={t('loading_history')}>
                <Spinner />
              </div>
            ) : auditDetail ? (
              <div className="space-y-4">
                <ol className="space-y-3">
                  {auditDetail.history.map((entry) => (
                    <li key={entry.id} className="rounded-xl border border-theme-default p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-theme-primary">{t(`history_actions.${entry.action}`)}</p>
                        <Chip size="sm" variant="flat" color={statusColor(entry.to_status)}>
                          {t(`statuses.${entry.to_status}`)}
                        </Chip>
                      </div>
                      <p className="mt-1 text-sm text-theme-muted">
                        {t('history_entry_meta', {
                          version: entry.version,
                          date: dateLabel(entry.created_at),
                        })}
                      </p>
                    </li>
                  ))}
                </ol>
                {auditDetail.history_meta.has_more && (
                  <Button
                    variant="secondary"
                    isPending={isAuditLoadingMore}
                    onPress={() => void loadMoreAuditHistory()}
                  >
                    {t('history_load_more')}
                  </Button>
                )}
              </div>
            ) : (
              <Alert color="danger" title={t('load_history_error')} />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={closeAudit}>
              {t('close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={scheduleTarget !== null} onOpenChange={(open) => !open && setScheduleTarget(null)}>
        <ModalContent>
          <ModalHeader>{t('schedule_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <Select label={t('schedule_mode')} selectedKeys={new Set([scheduleMode])} onSelectionChange={(keys) => {
              const value = [...keys][0];
              if (value === 'now' || value === 'later') setScheduleMode(value);
            }}>
              <SelectItem id="now">{t('send_now')}</SelectItem>
              <SelectItem id="later">{t('schedule_later')}</SelectItem>
            </Select>
            {scheduleMode === 'later' && (
              <Input type="datetime-local" label={t('schedule_at')} value={scheduledAt} onValueChange={setScheduledAt} />
            )}
            <Alert color="warning" title={t('schedule_warning_title')} description={t('schedule_warning_description')} />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setScheduleTarget(null)}>{t('close')}</Button>
            <Button isDisabled={scheduleMode === 'later' && !scheduledAt} isPending={isScheduling} onPress={() => void confirmSchedule()}>
              {t('confirm_schedule')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <ModalContent>
          <ModalHeader>{t('cancel_title')}</ModalHeader>
          <ModalBody>
            <Textarea label={t('cancel_reason_label')} value={cancelReason} maxLength={500} onValueChange={setCancelReason} />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setCancelTarget(null)}>{t('close')}</Button>
            <Button variant="danger" isDisabled={!cancelReason.trim()} isPending={isCancelling} onPress={() => void confirmCancel()}>
              {t('confirm_cancel')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}

function statusColor(status: EventBroadcast['status']): 'default' | 'primary' | 'success' | 'warning' | 'danger' {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'scheduled' || status === 'sending') return 'warning';
  return 'primary';
}
