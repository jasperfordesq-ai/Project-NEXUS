// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Spinner,
  TextField,
} from 'heroui-native';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  cancelEventCommunication,
  createEventCommunication,
  getEventCommunicationDetail,
  getEventCommunications,
  previewEventCommunication,
  reviseEventCommunication,
  retryEventCommunication,
  scheduleEventCommunication,
  type MobileEventBroadcast,
  type MobileEventBroadcastChannel,
  type MobileEventBroadcastDetail,
  type MobileEventBroadcastInput,
  type MobileEventBroadcastPreview,
  type MobileEventBroadcastSegment,
  type MobileEventBroadcastVariant,
} from '@/lib/api/eventCommunications';
import { dateLocale } from '@/lib/utils/dateLocale';

const SEGMENTS: MobileEventBroadcastSegment[] = [
  'registration_confirmed',
  'waitlist_active',
  'attendance_attended',
  'attendance_no_show',
];
const CHANNELS: MobileEventBroadcastChannel[] = ['email', 'in_app', 'push'];
const VARIANTS: MobileEventBroadcastVariant[] = ['announcement', 'follow_up', 'review_request'];

function initialInput(): MobileEventBroadcastInput {
  return {
    variant: 'announcement',
    segments: ['registration_confirmed'],
    channels: ['email', 'in_app'],
    body: '',
  };
}

function idempotencyKey(action: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `mobile-event-broadcast-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function statusColor(status: MobileEventBroadcast['status']): 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'scheduled' || status === 'sending') return 'warning';
  return 'accent';
}

export default function EventCommunicationsScreen() {
  return (
    <ModalErrorBoundary>
      <EventCommunicationsScreenInner />
    </ModalErrorBoundary>
  );
}

function EventCommunicationsScreenInner() {
  const { t } = useTranslation(['event_communications', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const eventId = Number(id);
  const safeEventId = Number.isInteger(eventId) && eventId > 0 ? eventId : 0;
  const { show: showToast } = useAppToast();
  const auditGeneration = useRef(0);
  const [broadcasts, setBroadcasts] = useState<MobileEventBroadcast[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<MobileEventBroadcast | null>(null);
  const [openingDraftId, setOpeningDraftId] = useState<number | null>(null);
  const [input, setInput] = useState<MobileEventBroadcastInput>(initialInput);
  const [preview, setPreview] = useState<MobileEventBroadcastPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<MobileEventBroadcast | null>(null);
  const [scheduledAt, setScheduledAt] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<MobileEventBroadcast | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [auditTarget, setAuditTarget] = useState<MobileEventBroadcast | null>(null);
  const [auditDetail, setAuditDetail] = useState<MobileEventBroadcastDetail | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [isAuditLoadingMore, setIsAuditLoadingMore] = useState(false);
  const [auditLoadFailed, setAuditLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (safeEventId <= 0) {
      setBroadcasts([]);
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const response = await getEventCommunications(safeEventId);
      setBroadcasts(response.data);
      setPage(response.meta.current_page);
      setHasMore(response.meta.has_more);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [safeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => { auditGeneration.current += 1; }, []);

  async function loadMore() {
    if (!hasMore || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const response = await getEventCommunications(safeEventId, page + 1);
      setBroadcasts((current) => {
        const byId = new Map(current.map((broadcast) => [broadcast.id, broadcast]));
        response.data.forEach((broadcast) => byId.set(broadcast.id, broadcast));
        return [...byId.values()];
      });
      setPage(response.meta.current_page);
      setHasMore(response.meta.has_more);
    } catch (err) {
      showToast({
        title: t('load_failed_title'),
        description: describeApiError(err, t('load_failed_description')),
        variant: 'danger',
      });
    } finally {
      setIsLoadingMore(false);
    }
  }

  function updateInput(next: Partial<MobileEventBroadcastInput>) {
    setInput((current) => ({ ...current, ...next }));
    setPreview(null);
  }

  function openNewComposer() {
    setEditing(null);
    setInput(initialInput());
    setPreview(null);
    setComposerOpen(true);
  }

  function closeComposer() {
    setComposerOpen(false);
    setEditing(null);
    setInput(initialInput());
    setPreview(null);
  }

  async function openEditComposer(broadcast: MobileEventBroadcast) {
    setOpeningDraftId(broadcast.id);
    try {
      const detail = await getEventCommunicationDetail(broadcast.id, 1, 1);
      const latest = detail.broadcast;
      replaceBroadcast(latest);
      if (!latest.capabilities.edit || latest.body === null) {
        throw new Error('event_broadcast_not_editable');
      }
      setEditing(latest);
      setInput({
        variant: latest.variant,
        segments: [...latest.audience.segments],
        channels: [...latest.channels],
        body: latest.body,
      });
      setPreview(null);
      setComposerOpen(true);
    } catch (err) {
      showToast({
        title: t('detail_failed_title'),
        description: describeApiError(err, t('detail_failed_description')),
        variant: 'danger',
      });
    } finally {
      setOpeningDraftId(null);
    }
  }

  async function openAudit(broadcast: MobileEventBroadcast) {
    const requestGeneration = ++auditGeneration.current;
    setAuditTarget(broadcast);
    setAuditDetail(null);
    setAuditLoadFailed(false);
    setIsAuditLoading(true);
    setIsAuditLoadingMore(false);
    try {
      const detail = await getEventCommunicationDetail(broadcast.id, 1, 50);
      if (requestGeneration !== auditGeneration.current) return;
      replaceBroadcast(detail.broadcast);
      setAuditTarget(detail.broadcast);
      setAuditDetail(detail);
    } catch {
      if (requestGeneration !== auditGeneration.current) return;
      setAuditLoadFailed(true);
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
      const detail = await getEventCommunicationDetail(broadcastId, nextPage, 50);
      if (requestGeneration !== auditGeneration.current || auditTarget.id !== broadcastId) return;
      setAuditDetail((current) => {
        if (!current || current.broadcast.id !== broadcastId || detail.broadcast.id !== broadcastId) {
          return current;
        }
        const byId = new Map(current.history.map((entry) => [entry.id, entry]));
        detail.history.forEach((entry) => byId.set(entry.id, entry));
        return { ...detail, history: [...byId.values()] };
      });
      replaceBroadcast(detail.broadcast);
    } catch (err) {
      if (requestGeneration !== auditGeneration.current) return;
      showToast({
        title: t('history_load_failed_title'),
        description: describeApiError(err, t('history_load_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (requestGeneration === auditGeneration.current) setIsAuditLoadingMore(false);
    }
  }

  function closeAudit() {
    auditGeneration.current += 1;
    setAuditTarget(null);
    setAuditDetail(null);
    setAuditLoadFailed(false);
    setIsAuditLoading(false);
    setIsAuditLoadingMore(false);
  }

  function selectVariant(variant: MobileEventBroadcastVariant) {
    updateInput({
      variant,
      segments: variant === 'announcement' ? input.segments : ['attendance_attended'],
    });
  }

  function toggleSegment(segment: MobileEventBroadcastSegment) {
    const selected = input.segments.includes(segment);
    updateInput({
      segments: selected
        ? input.segments.filter((value) => value !== segment)
        : [...input.segments, segment],
    });
  }

  function toggleChannel(channel: MobileEventBroadcastChannel) {
    const selected = input.channels.includes(channel);
    updateInput({
      channels: selected
        ? input.channels.filter((value) => value !== channel)
        : [...input.channels, channel],
    });
  }

  async function previewAudience() {
    if (!input.body.trim() || input.segments.length === 0 || input.channels.length === 0) {
      showToast({
        title: t('validation_title'),
        description: t('validation_description'),
        variant: 'warning',
      });
      return;
    }
    setIsPreviewing(true);
    try {
      const result = await previewEventCommunication(safeEventId, {
        variant: input.variant,
        segments: input.segments,
        channels: input.channels,
      });
      setPreview(result);
    } catch (err) {
      showToast({
        title: t('preview_failed_title'),
        description: describeApiError(err, t('preview_failed_description')),
        variant: 'danger',
      });
    } finally {
      setIsPreviewing(false);
    }
  }

  async function saveDraft() {
    if (!preview || preview.recipient_count < 1 || !input.body.trim()) return;
    setIsSaving(true);
    try {
      const broadcast = editing
        ? await reviseEventCommunication(
          editing.id,
          editing.version,
          input,
          idempotencyKey('revise'),
        )
        : await createEventCommunication(
          safeEventId,
          input,
          idempotencyKey('create'),
        );
      upsertBroadcast(broadcast);
      const revised = editing !== null;
      closeComposer();
      showToast({
        title: t(revised ? 'revised_title' : 'created_title'),
        description: t(revised ? 'revised_description' : 'created_description'),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t('save_failed_title'),
        description: describeApiError(err, t('save_failed_description')),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function confirmSchedule() {
    if (!scheduleTarget) return;
    let timestamp: string | null = null;
    if (scheduledAt.trim()) {
      const parsed = new Date(scheduledAt.trim());
      if (Number.isNaN(parsed.getTime())) {
        showToast({
          title: t('schedule_invalid_title'),
          description: t('schedule_invalid_description'),
          variant: 'warning',
        });
        return;
      }
      timestamp = parsed.toISOString();
    }
    setIsScheduling(true);
    try {
      const broadcast = await scheduleEventCommunication(
        scheduleTarget.id,
        scheduleTarget.version,
        timestamp,
        idempotencyKey('schedule'),
      );
      replaceBroadcast(broadcast);
      setScheduleTarget(null);
      setScheduledAt('');
      showToast({
        title: t('scheduled_title'),
        description: t('scheduled_description'),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t('schedule_failed_title'),
        description: describeApiError(err, t('schedule_failed_description')),
        variant: 'danger',
      });
    } finally {
      setIsScheduling(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    const reason = cancelReason.trim();
    if (!reason || reason.length > 500) {
      showToast({
        title: t('cancel_invalid_title'),
        description: t('cancel_invalid_description'),
        variant: 'warning',
      });
      return;
    }
    setIsCancelling(true);
    try {
      const broadcast = await cancelEventCommunication(
        cancelTarget.id,
        cancelTarget.version,
        reason,
        idempotencyKey('cancel'),
      );
      replaceBroadcast(broadcast);
      setCancelTarget(null);
      setCancelReason('');
      showToast({
        title: t('cancelled_title'),
        description: t('cancelled_description'),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t('cancel_failed_title'),
        description: describeApiError(err, t('cancel_failed_description')),
        variant: 'danger',
      });
    } finally {
      setIsCancelling(false);
    }
  }

  async function retryFailed(broadcast: MobileEventBroadcast) {
    setRetryingId(broadcast.id);
    try {
      replaceBroadcast(await retryEventCommunication(
        broadcast.id,
        broadcast.version,
        idempotencyKey('retry'),
      ));
      showToast({
        title: t('retry_queued_title'),
        description: t('retry_queued_description'),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t('retry_failed_title'),
        description: describeApiError(err, t('retry_failed_description')),
        variant: 'danger',
      });
    } finally {
      setRetryingId(null);
    }
  }

  function replaceBroadcast(next: MobileEventBroadcast) {
    setBroadcasts((current) => current.map((broadcast) => broadcast.id === next.id ? next : broadcast));
  }

  function upsertBroadcast(next: MobileEventBroadcast) {
    setBroadcasts((current) => current.some((broadcast) => broadcast.id === next.id)
      ? current.map((broadcast) => broadcast.id === next.id ? next : broadcast)
      : [next, ...current]);
  }

  function dateLabel(value: string | null): string {
    if (!value) return t('not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('not_recorded');
    return new Intl.DateTimeFormat(dateLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']} style={{ flex: 1 }}>
      <AppTopBar
        title={t('title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/events"
      />
      <ScrollView contentContainerClassName="gap-4 px-4 pb-10">
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('privacy_title')}</Alert.Title>
            <Alert.Description>{t('privacy_description')}</Alert.Description>
          </Alert.Content>
        </Alert>

        <Button
          variant="primary"
          isDisabled={composerOpen}
          onPress={openNewComposer}
        >
          {t('new_message')}
        </Button>

        {composerOpen ? (
          <Card>
            <Card.Body className="gap-4">
              <Card.Title>{t(editing ? 'compose_edit_title' : 'compose_title')}</Card.Title>
              <Card.Description>{t(editing ? 'compose_edit_description' : 'compose_description')}</Card.Description>

              <Text className="font-semibold text-foreground">{t('variant_label')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {VARIANTS.map((variant) => (
                  <Chip
                    key={variant}
                    color={input.variant === variant ? 'accent' : 'default'}
                    variant={input.variant === variant ? 'primary' : 'soft'}
                    onPress={() => selectVariant(variant)}
                    accessibilityState={{ selected: input.variant === variant }}
                  >
                    <Chip.Label>{t(`variants.${variant}`)}</Chip.Label>
                  </Chip>
                ))}
              </View>

              <Text className="font-semibold text-foreground">{t('segments_label')}</Text>
              <Text className="text-sm text-muted-foreground">{t('segments_description')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {SEGMENTS.map((segment) => {
                  const postEvent = input.variant !== 'announcement';
                  const disabled = input.variant === 'review_request'
                    ? segment !== 'attendance_attended'
                    : postEvent && !segment.startsWith('attendance_');
                  const selected = input.segments.includes(segment);
                  return (
                    <Chip
                      key={segment}
                      disabled={disabled}
                      color={selected ? 'accent' : 'default'}
                      variant={selected ? 'primary' : 'soft'}
                      onPress={() => toggleSegment(segment)}
                      accessibilityState={{ selected, disabled }}
                    >
                      <Chip.Label>{t(`segments.${segment}`)}</Chip.Label>
                    </Chip>
                  );
                })}
              </View>

              <Text className="font-semibold text-foreground">{t('channels_label')}</Text>
              <View className="flex-row flex-wrap gap-2">
                {CHANNELS.map((channel) => {
                  const selected = input.channels.includes(channel);
                  return (
                    <Chip
                      key={channel}
                      color={selected ? 'accent' : 'default'}
                      variant={selected ? 'primary' : 'soft'}
                      onPress={() => toggleChannel(channel)}
                      accessibilityState={{ selected }}
                    >
                      <Chip.Label>{t(`channels.${channel}`)}</Chip.Label>
                    </Chip>
                  );
                })}
              </View>

              <TextField isRequired>
                <Label>{t('body_label')}</Label>
                <Input
                  testID="event-communication-body"
                  value={input.body}
                  onChangeText={(body) => updateInput({ body })}
                  maxLength={20000}
                  multiline
                  numberOfLines={6}
                  textAlignVertical="top"
                />
              </TextField>

              {preview ? (
                <Alert status={preview.recipient_count > 0 ? 'success' : 'warning'}>
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t('preview_title')}</Alert.Title>
                    <Alert.Description>{t('preview_summary', {
                      recipients: preview.recipient_count,
                      deliveries: preview.delivery_count,
                    })}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
            </Card.Body>
            <Card.Footer className="flex-row flex-wrap gap-3">
              <Button
                variant="secondary"
                isDisabled={isPreviewing || isSaving}
                onPress={closeComposer}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                variant="secondary"
                isDisabled={isPreviewing || isSaving}
                onPress={() => void previewAudience()}
              >
                {isPreviewing ? <Spinner size="sm" /> : t('preview_button')}
              </Button>
              <Button
                isDisabled={isSaving || !preview || preview.recipient_count < 1}
                onPress={() => void saveDraft()}
              >
                {isSaving ? <Spinner size="sm" /> : t(editing ? 'revise_draft_button' : 'save_draft_button')}
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        {scheduleTarget ? (
          <Card>
            <Card.Body className="gap-4">
              <Card.Title>{t('schedule_title')}</Card.Title>
              <Card.Description>{t('schedule_description')}</Card.Description>
              <TextField>
                <Label>{t('schedule_label')}</Label>
                <Input
                  testID="event-communication-scheduled-at"
                  value={scheduledAt}
                  onChangeText={setScheduledAt}
                  placeholder={t('schedule_placeholder')}
                  autoCapitalize="none"
                />
              </TextField>
            </Card.Body>
            <Card.Footer className="gap-3">
              <Button variant="secondary" isDisabled={isScheduling} onPress={() => setScheduleTarget(null)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button isDisabled={isScheduling} onPress={() => void confirmSchedule()}>
                {isScheduling ? <Spinner size="sm" /> : t('confirm_schedule')}
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        {cancelTarget ? (
          <Card>
            <Card.Body className="gap-4">
              <Card.Title>{t('cancel_title')}</Card.Title>
              <Card.Description>{t('cancel_description')}</Card.Description>
              <TextField isRequired>
                <Label>{t('cancel_reason_label')}</Label>
                <Input
                  testID="event-communication-cancel-reason"
                  value={cancelReason}
                  onChangeText={setCancelReason}
                  maxLength={500}
                />
              </TextField>
            </Card.Body>
            <Card.Footer className="gap-3">
              <Button variant="secondary" isDisabled={isCancelling} onPress={() => setCancelTarget(null)}>
                {t('common:buttons.cancel')}
              </Button>
              <Button variant="danger" isDisabled={isCancelling} onPress={() => void confirmCancel()}>
                {isCancelling ? <Spinner size="sm" /> : t('confirm_cancel')}
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        {auditTarget ? (
          <Card testID={`event-communication-history-${auditTarget.id}`}>
            <Card.Body className="gap-4">
              <Card.Title>{t('history_title', {
                type: t(`variants.${auditTarget.variant}`),
              })}</Card.Title>
              <Card.Description>{t('history_description')}</Card.Description>
              <Alert status="accent">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>{t('history_immutable_title')}</Alert.Title>
                  <Alert.Description>{t('history_immutable_description')}</Alert.Description>
                </Alert.Content>
              </Alert>
              {isAuditLoading ? (
                <View className="items-center py-8" accessibilityLabel={t('history_loading')}>
                  <Spinner size="lg" />
                </View>
              ) : auditLoadFailed ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>{t('history_load_failed_title')}</Alert.Title>
                    <Alert.Description>{t('history_load_failed_description')}</Alert.Description>
                  </Alert.Content>
                  <Button size="sm" variant="danger" onPress={() => void openAudit(auditTarget)}>
                    {t('common:buttons.retry')}
                  </Button>
                </Alert>
              ) : auditDetail?.history.length === 0 ? (
                <Text className="text-sm text-muted-foreground">{t('history_empty')}</Text>
              ) : (
                <View className="gap-3">
                  {auditDetail?.history.map((entry) => (
                    <View key={entry.id} className="gap-1 rounded-xl bg-default/40 p-3">
                      <Text className="font-semibold text-foreground">
                        {t(`history_actions.${entry.action}`)}
                      </Text>
                      <Text className="text-sm text-muted-foreground">
                        {t('history_entry_version', {
                          version: entry.version,
                          date: dateLabel(entry.created_at),
                        })}
                      </Text>
                      <Text className="text-sm text-foreground">
                        {entry.from_status
                          ? t('history_transition', {
                            from: t(`statuses.${entry.from_status}`),
                            to: t(`statuses.${entry.to_status}`),
                          })
                          : t('history_initial_status', {
                            status: t(`statuses.${entry.to_status}`),
                          })}
                      </Text>
                    </View>
                  ))}
                  {auditDetail?.history_meta.has_more ? (
                    <Button
                      variant="secondary"
                      isDisabled={isAuditLoadingMore}
                      onPress={() => void loadMoreAuditHistory()}
                    >
                      {isAuditLoadingMore ? <Spinner size="sm" /> : t('common:buttons.loadMore')}
                    </Button>
                  ) : null}
                </View>
              )}
            </Card.Body>
            <Card.Footer>
              <Button variant="secondary" onPress={closeAudit}>
                {t('common:buttons.done')}
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        <Text className="text-xl font-semibold text-foreground">{t('status_title')}</Text>
        {isLoading ? (
          <View className="items-center py-16" accessibilityLabel={t('loading')}>
            <Spinner size="lg" />
          </View>
        ) : loadFailed ? (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('load_failed_title')}</Alert.Title>
              <Alert.Description>{t('load_failed_description')}</Alert.Description>
            </Alert.Content>
            <Button size="sm" variant="danger" onPress={() => void load()}>{t('common:buttons.retry')}</Button>
          </Alert>
        ) : broadcasts.length === 0 ? (
          <Card>
            <Card.Body>
              <Card.Title>{t('empty_title')}</Card.Title>
              <Card.Description>{t('empty_description')}</Card.Description>
            </Card.Body>
          </Card>
        ) : (
          <>
            {broadcasts.map((broadcast) => (
              <Card key={broadcast.id}>
            <Card.Header className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 font-semibold text-foreground">{t(`variants.${broadcast.variant}`)}</Text>
              <Chip size="sm" variant="soft" color={statusColor(broadcast.status)}>
                <Chip.Label>{t(`statuses.${broadcast.status}`)}</Chip.Label>
              </Chip>
            </Card.Header>
            <Card.Body className="gap-2">
              <Text className="text-sm text-muted-foreground">{t('version', { version: broadcast.version })}</Text>
              <Text className="text-sm text-foreground">{t('audience_summary', {
                count: broadcast.audience.recipient_count,
                segments: broadcast.audience.segments.map((segment) => t(`segments.${segment}`)).join(', '),
              })}</Text>
              <Text className="text-sm text-foreground">{t('channels_summary', {
                channels: broadcast.channels.map((channel) => t(`channels.${channel}`)).join(', '),
              })}</Text>
              <Text className="text-sm text-foreground">{t('delivery_summary', {
                delivered: broadcast.delivery.delivered,
                total: broadcast.delivery.total,
                suppressed: broadcast.delivery.suppressed,
                dead: broadcast.delivery.dead_lettered,
              })}</Text>
              <Text className="text-sm text-muted-foreground">{t('scheduled_for', {
                date: dateLabel(broadcast.scheduled_at),
              })}</Text>
            </Card.Body>
            <Card.Footer className="flex-row flex-wrap gap-2">
              {broadcast.capabilities.edit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={openingDraftId !== null || isSaving || composerOpen}
                  onPress={() => void openEditComposer(broadcast)}
                >
                  {openingDraftId === broadcast.id ? <Spinner size="sm" /> : t('common:buttons.edit')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                isDisabled={isAuditLoading && auditTarget?.id === broadcast.id}
                onPress={() => void openAudit(broadcast)}
              >
                {isAuditLoading && auditTarget?.id === broadcast.id
                  ? <Spinner size="sm" />
                  : t('history_button')}
              </Button>
              {broadcast.capabilities.schedule ? (
                <Button size="sm" onPress={() => {
                  setScheduleTarget(broadcast);
                  setScheduledAt('');
                }}>{t('schedule_button')}</Button>
              ) : null}
              {broadcast.capabilities.cancel ? (
                <Button size="sm" variant="danger-soft" onPress={() => {
                  setCancelTarget(broadcast);
                  setCancelReason('');
                }}>{t('cancel_button')}</Button>
              ) : null}
              {broadcast.capabilities.retry ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={retryingId !== null}
                  onPress={() => void retryFailed(broadcast)}
                >
                  {retryingId === broadcast.id ? <Spinner size="sm" /> : t('retry_button')}
                </Button>
              ) : null}
            </Card.Footer>
              </Card>
            ))}
            {hasMore ? (
              <Button variant="secondary" isDisabled={isLoadingMore} onPress={() => void loadMore()}>
                {isLoadingMore ? <Spinner size="sm" /> : t('common:buttons.loadMore')}
              </Button>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
