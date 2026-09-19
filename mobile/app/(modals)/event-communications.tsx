// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, Card, Input, Label, Spinner, TextField,  } from 'heroui-native';
import { Button } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { eventLocalInputToIso, localEventTimeZone } from '@/lib/utils/eventDateTime';
import { describeApiError } from '@/lib/api/describeApiError';
import { refusalStatus } from '@/lib/api/refusal';
import {
  getEventCommunicationDetail,
  getEventCommunications,
  previewEventCommunication,
  type MobileEventBroadcast,
  type MobileEventBroadcastChannel,
  type MobileEventBroadcastDetail,
  type MobileEventBroadcastInput,
  type MobileEventBroadcastPreview,
  type MobileEventBroadcastSegment,
  type MobileEventBroadcastVariant,
} from '@/lib/api/eventCommunications';
import { dateLocale } from '@/lib/utils/dateLocale';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { executeEventCommunicationOperation, recoverEventCommunicationOperation } from '@/lib/eventCommunicationOperation';
import { loadEventCommunicationOperation, type EventCommunicationIntent, type EventCommunicationScope, type SavedEventCommunicationOperation } from '@/lib/eventCommunicationOperationStore';
import { withRouteGate } from '@/components/withRouteGate';

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

function statusColor(status: MobileEventBroadcast['status']): 'accent' | 'success' | 'warning' | 'danger' {
  if (status === 'sent') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'scheduled' || status === 'sending') return 'warning';
  return 'accent';
}

function EventCommunicationsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const eventId = Number(id);
  const safeEventId = Number.isInteger(eventId) && eventId > 0 ? eventId : 0;
  return (
    <ModalErrorBoundary>
      <EventCommunicationsScreenInner key={`${tenant?.id}:${user?.id}:${safeEventId}`} safeEventId={safeEventId} tenantId={Number(tenant?.id)} userId={Number(user?.id)} />
    </ModalErrorBoundary>
  );
}

function EventCommunicationsScreenInner({ safeEventId, tenantId, userId }: { safeEventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['event_communications', 'common']);
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const scope = useMemo<EventCommunicationScope>(() => ({ tenantId, userId, eventId: safeEventId }), [tenantId, userId, safeEventId]);
  const mounted = useRef(true);
  const operationBusy = useRef(false);
  const [operationLoading, setOperationLoading] = useState(true);
  const [operationFailed, setOperationFailed] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<SavedEventCommunicationOperation | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const mutationsBlocked = operationLoading || operationFailed || pendingOperation !== null || isOperating;
  const refreshOperation = useCallback(async () => {
    try {
      const saved = await loadEventCommunicationOperation(scope);
      if (!mounted.current) return;
      setPendingOperation(saved?.status === 'pending' ? saved : null);
      setOperationFailed(false);
    } catch {
      if (mounted.current) setOperationFailed(true);
    } finally {
      if (mounted.current) setOperationLoading(false);
    }
  }, [scope]);
  useEffect(() => {
    mounted.current = true;
    void refreshOperation();
    return () => { mounted.current = false; };
  }, [refreshOperation]);

  async function performOperation(intent: EventCommunicationIntent) {
    if (mutationsBlocked || operationBusy.current) throw new Error('Event operation unavailable');
    operationBusy.current = true;
    setIsOperating(true);
    try {
      return await executeEventCommunicationOperation(scope, intent, () => mounted.current);
    } finally {
      await refreshOperation();
      operationBusy.current = false;
      if (mounted.current) setIsOperating(false);
    }
  }

  async function recoverOperation() {
    if (!pendingOperation || operationBusy.current) return;
    operationBusy.current = true;
    setIsOperating(true);
    const saved = pendingOperation;
    const generation = composerGeneration.current;
    try {
      const result = await recoverEventCommunicationOperation(scope, () => mounted.current);
      if (!mounted.current) return;
      upsertBroadcast(result);
      if ((saved.intent.action === 'create' || saved.intent.action === 'revise') && composerOpen && composerGeneration.current === generation) {
        setEditing(result);
        setComposerBaseline(saved.intent.input);
        invalidatePreview();
      }
      setScheduleTarget(null);
      setCancelTarget(null);
    } catch (err) {
      if (mounted.current) showToast({ title: t('recovery_title'), description: describeApiError(err, t('recovery_description')), variant: 'warning' });
    } finally {
      await refreshOperation();
      operationBusy.current = false;
      if (mounted.current) setIsOperating(false);
    }
  }
  const auditGeneration = useRef(0);
  const previewRequest = useRef<object | null>(null);
  const draftRequest = useRef<object | null>(null);
  const saveRequest = useRef<object | null>(null);
  const composerGeneration = useRef(0);
  const inputRevision = useRef(0);
  const listRequest = useRef<object | null>(null);
  const pageRequest = useRef<object | null>(null);
  const scheduleRequest = useRef<object | null>(null);
  const cancelRequest = useRef<object | null>(null);
  const retryRequest = useRef<object | null>(null);
  const [broadcasts, setBroadcasts] = useState<MobileEventBroadcast[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refusedStatus, setRefusedStatus] = useState<number | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<MobileEventBroadcast | null>(null);
  const [openingDraftId, setOpeningDraftId] = useState<number | null>(null);
  const [input, setInput] = useState<MobileEventBroadcastInput>(initialInput);
  /** The composer as opened; anything different from it is unsaved wording (S4-04). */
  const [composerBaseline, setComposerBaseline] = useState<MobileEventBroadcastInput>(initialInput);
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
    const request = {};
    listRequest.current = request;
    pageRequest.current = null;
    setIsLoadingMore(false);
    if (safeEventId <= 0) {
      setBroadcasts([]);
      setLoadFailed(true);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadFailed(false);
    setRefusedStatus(null);
    try {
      const response = await getEventCommunications(safeEventId);
      if (listRequest.current !== request) return;
      setBroadcasts(response.data);
      setPage(response.meta.current_page);
      setHasMore(response.meta.has_more);
    } catch (error) {
      if (listRequest.current !== request) return;
      setRefusedStatus(refusalStatus(error));
      setLoadFailed(true);
    } finally {
      if (listRequest.current === request) {
        listRequest.current = null;
        setIsLoading(false);
      }
    }
  }, [safeEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => () => {
    auditGeneration.current += 1;
    previewRequest.current = null;
    draftRequest.current = null;
    saveRequest.current = null;
    listRequest.current = null;
    pageRequest.current = null;
    scheduleRequest.current = null;
    cancelRequest.current = null;
    retryRequest.current = null;
  }, []);

  async function loadMore() {
    if (!hasMore || isLoading || pageRequest.current) return;
    const request = {};
    pageRequest.current = request;
    setIsLoadingMore(true);
    try {
      const response = await getEventCommunications(safeEventId, page + 1);
      if (pageRequest.current !== request) return;
      setBroadcasts((current) => {
        const byId = new Map(current.map((broadcast) => [broadcast.id, broadcast]));
        response.data.forEach((broadcast) => byId.set(broadcast.id, broadcast));
        return [...byId.values()];
      });
      setPage(response.meta.current_page);
      setHasMore(response.meta.has_more);
    } catch (err) {
      if (pageRequest.current !== request) return;
      showToast({
        title: t('load_failed_title'),
        description: describeApiError(err, t('load_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (pageRequest.current === request) {
        pageRequest.current = null;
        setIsLoadingMore(false);
      }
    }
  }

  function updateInput(next: Partial<MobileEventBroadcastInput>) {
    inputRevision.current += 1;
    invalidatePreview();
    setInput((current) => ({ ...current, ...next }));
  }

  function invalidatePreview() {
    previewRequest.current = null;
    setPreview(null);
    setIsPreviewing(false);
  }

  const composerDirty = composerOpen && JSON.stringify(input) !== JSON.stringify(composerBaseline);
  // 🔴 Back, a swipe or the composer's own Cancel used to drop organiser wording silently.
  useUnsavedChangesGuard({
    isDirty: composerDirty,
    isSaving,
    confirm,
    title: t('unsaved_title'),
    message: t('unsaved_message'),
    discardLabel: t('discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  function openNewComposer() {
    if (safeEventId <= 0 || isLoading || loadFailed || composerOpen) return;
    composerGeneration.current += 1;
    draftRequest.current = null;
    setOpeningDraftId(null);
    invalidatePreview();
    const fresh = initialInput();
    setEditing(null);
    setInput(fresh);
    setComposerBaseline(fresh);
    setPreview(null);
    setComposerOpen(true);
  }

  function closeComposer() {
    composerGeneration.current += 1;
    draftRequest.current = null;
    setOpeningDraftId(null);
    invalidatePreview();
    setComposerOpen(false);
    setEditing(null);
    setInput(initialInput());
    setComposerBaseline(initialInput());
    setPreview(null);
  }

  function requestCloseComposer() {
    if (!composerDirty) {
      closeComposer();
      return;
    }
    confirm({
      title: t('unsaved_title'),
      message: t('unsaved_message'),
      confirmLabel: t('discard'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: closeComposer,
    });
  }

  async function openEditComposer(broadcast: MobileEventBroadcast) {
    if (draftRequest.current) return;
    const request = {};
    draftRequest.current = request;
    invalidatePreview();
    setOpeningDraftId(broadcast.id);
    try {
      const detail = await getEventCommunicationDetail(broadcast.id, 1, 1);
      if (draftRequest.current !== request) return;
      const latest = detail.broadcast;
      replaceBroadcast(latest);
      if (!latest.capabilities.edit || latest.body === null) {
        throw new Error('event_broadcast_not_editable');
      }
      composerGeneration.current += 1;
      setEditing(latest);
      const loaded: MobileEventBroadcastInput = {
        variant: latest.variant,
        segments: [...latest.audience.segments],
        channels: [...latest.channels],
        body: latest.body,
      };
      setInput(loaded);
      setComposerBaseline(loaded);
      setPreview(null);
      setComposerOpen(true);
    } catch (err) {
      if (draftRequest.current !== request) return;
      showToast({
        title: t('detail_failed_title'),
        description: describeApiError(err, t('detail_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (draftRequest.current === request) {
        draftRequest.current = null;
        setOpeningDraftId(null);
      }
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
    if (previewRequest.current) return;
    if (!input.body.trim() || input.segments.length === 0 || input.channels.length === 0) {
      showToast({
        title: t('validation_title'),
        description: t('validation_description'),
        variant: 'warning',
      });
      return;
    }
    const request = {};
    previewRequest.current = request;
    setIsPreviewing(true);
    try {
      const result = await previewEventCommunication(safeEventId, {
        variant: input.variant,
        segments: input.segments,
        channels: input.channels,
      });
      if (previewRequest.current === request) setPreview(result);
    } catch (err) {
      if (previewRequest.current !== request) return;
      showToast({
        title: t('preview_failed_title'),
        description: describeApiError(err, t('preview_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (previewRequest.current === request) {
        previewRequest.current = null;
        setIsPreviewing(false);
      }
    }
  }

  async function saveDraft() {
    if (mutationsBlocked || (editing && !editing.capabilities.edit) || saveRequest.current || !preview || preview.recipient_count < 1 || !input.body.trim()) return;
    const request = {};
    saveRequest.current = request;
    const generation = composerGeneration.current;
    const revision = inputRevision.current;
    setIsSaving(true);
    try {
      const broadcast = await performOperation(editing
        ? { action: 'revise', broadcastId: editing.id, expectedVersion: editing.version, input }
        : { action: 'create', input });
      if (saveRequest.current !== request) return;
      upsertBroadcast(broadcast);
      const revised = editing !== null;
      if (composerGeneration.current === generation) {
        if (inputRevision.current === revision) {
          closeComposer();
        } else {
          // The accepted version is the baseline for the wording still being edited.
          // A subsequent save must revise this record, not create a duplicate draft.
          setEditing(broadcast);
          setComposerBaseline(input);
        }
      }
      showToast({
        title: t(revised ? 'revised_title' : 'created_title'),
        description: t(revised ? 'revised_description' : 'created_description'),
        variant: 'success',
      });
    } catch (err) {
      if (saveRequest.current !== request || composerGeneration.current !== generation) return;
      showToast({
        title: t('save_failed_title'),
        description: describeApiError(err, t('save_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (saveRequest.current === request) {
        saveRequest.current = null;
        setIsSaving(false);
      }
    }
  }

  async function confirmSchedule() {
    if (mutationsBlocked || !scheduleTarget || scheduleRequest.current) return;
    let timestamp: string | null = null;
    if (scheduledAt.trim()) {
      // The field is a local wall-clock time in the placeholder's format; the shared helper
      // turns it into the matching instant in the device zone (S4-25).
      const parsed = eventLocalInputToIso(scheduledAt.trim().replace(' ', 'T'), localEventTimeZone());
      if (!parsed) {
        showToast({
          title: t('schedule_invalid_title'),
          description: t('schedule_invalid_description'),
          variant: 'warning',
        });
        return;
      }
      timestamp = parsed;
    }
    const request = {};
    scheduleRequest.current = request;
    setIsScheduling(true);
    try {
      const broadcast = await performOperation({ action: 'schedule', broadcastId: scheduleTarget.id, expectedVersion: scheduleTarget.version, scheduledAt: timestamp });
      if (scheduleRequest.current !== request) return;
      replaceBroadcast(broadcast);
      setScheduleTarget(null);
      setScheduledAt('');
      showToast({
        title: t('scheduled_title'),
        description: t('scheduled_description'),
        variant: 'success',
      });
    } catch (err) {
      if (scheduleRequest.current !== request) return;
      showToast({
        title: t('schedule_failed_title'),
        description: describeApiError(err, t('schedule_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (scheduleRequest.current === request) {
        scheduleRequest.current = null;
        setIsScheduling(false);
      }
    }
  }

  async function confirmCancel() {
    if (mutationsBlocked || !cancelTarget || cancelRequest.current) return;
    const reason = cancelReason.trim();
    if (!reason || reason.length > 500) {
      showToast({
        title: t('cancel_invalid_title'),
        description: t('cancel_invalid_description'),
        variant: 'warning',
      });
      return;
    }
    const request = {};
    cancelRequest.current = request;
    setIsCancelling(true);
    try {
      const broadcast = await performOperation({ action: 'cancel', broadcastId: cancelTarget.id, expectedVersion: cancelTarget.version, reason });
      if (cancelRequest.current !== request) return;
      replaceBroadcast(broadcast);
      setCancelTarget(null);
      setCancelReason('');
      showToast({
        title: t('cancelled_title'),
        description: t('cancelled_description'),
        variant: 'success',
      });
    } catch (err) {
      if (cancelRequest.current !== request) return;
      showToast({
        title: t('cancel_failed_title'),
        description: describeApiError(err, t('cancel_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (cancelRequest.current === request) {
        cancelRequest.current = null;
        setIsCancelling(false);
      }
    }
  }

  async function retryFailed(broadcast: MobileEventBroadcast) {
    if (mutationsBlocked || retryRequest.current) return;
    const request = {};
    retryRequest.current = request;
    setRetryingId(broadcast.id);
    try {
      const result = await performOperation({ action: 'retry', broadcastId: broadcast.id, expectedVersion: broadcast.version });
      if (retryRequest.current !== request) return;
      replaceBroadcast(result);
      showToast({
        title: t('retry_queued_title'),
        description: t('retry_queued_description'),
        variant: 'success',
      });
    } catch (err) {
      if (retryRequest.current !== request) return;
      showToast({
        title: t('retry_failed_title'),
        description: describeApiError(err, t('retry_failed_description')),
        variant: 'danger',
      });
    } finally {
      if (retryRequest.current === request) {
        retryRequest.current = null;
        setRetryingId(null);
      }
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
      <ScrollView
        // iOS only: without it the keyboard covers the fields below. Android is already
        // covered by the manifest's windowSoftInputMode="adjustResize". Audit 2026-09-09.
        automaticallyAdjustKeyboardInsets contentContainerClassName="gap-4 px-4 pb-10">
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('privacy_title')}</Alert.Title>
            <Alert.Description>{t('privacy_description')}</Alert.Description>
          </Alert.Content>
        </Alert>

        {pendingOperation || operationFailed ? (
          <View className="gap-3" testID="event-operation-recovery">
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t(operationFailed ? 'recovery_storage_title' : 'recovery_title')}</Alert.Title>
                <Alert.Description>{t(operationFailed ? 'recovery_storage_description' : 'recovery_description')}</Alert.Description>
              </Alert.Content>
            </Alert>
            {pendingOperation ? (
              <View className="gap-2">
                <Text className="font-semibold text-foreground">{t({ create: 'compose_title', revise: 'compose_edit_title', schedule: 'schedule_title', cancel: 'cancel_title', retry: 'retry_button' }[pendingOperation.intent.action])}</Text>
                {pendingOperation.intent.action === 'create' || pendingOperation.intent.action === 'revise' ? (
                  <Text className="text-foreground" selectable>{pendingOperation.intent.input.body}</Text>
                ) : pendingOperation.intent.action === 'cancel' ? (
                  <Text className="text-foreground" selectable>{pendingOperation.intent.reason}</Text>
                ) : pendingOperation.intent.action === 'schedule' && pendingOperation.intent.scheduledAt ? (
                  <Text className="text-foreground">{t('scheduled_for', { date: dateLabel(pendingOperation.intent.scheduledAt) })}</Text>
                ) : null}
              </View>
            ) : null}
            <Button isDisabled={isOperating} onPress={() => void (operationFailed ? refreshOperation() : recoverOperation())} accessibilityState={{ busy: isOperating }}>
              {isOperating ? <Spinner size="sm" /> : null}
              <Button.Label>{t(operationFailed ? 'recovery_reload' : 'recovery_button')}</Button.Label>
            </Button>
          </View>
        ) : null}

        <Button
          variant="primary"
          isDisabled={mutationsBlocked || composerOpen || safeEventId <= 0 || isLoading || loadFailed}
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
                onPress={requestCloseComposer}
              >
                {t('common:buttons.cancel')}
              </Button>
              <Button
                variant="secondary"
                isDisabled={isPreviewing || isSaving}
                onPress={() => void previewAudience()}
                accessibilityState={{ busy: isPreviewing }}
              >
                {isPreviewing ? <Spinner size="sm" /> : null}
                <Button.Label>{t('preview_button')}</Button.Label>
              </Button>
              <Button
                isDisabled={mutationsBlocked || (editing !== null && !editing.capabilities.edit) || isSaving || !preview || preview.recipient_count < 1}
                onPress={() => void saveDraft()}
                accessibilityState={{ busy: isSaving }}
              >
                {isSaving ? <Spinner size="sm" /> : null}
                <Button.Label>{t(editing ? 'revise_draft_button' : 'save_draft_button')}</Button.Label>
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
                  editable={!mutationsBlocked}
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
              <Button isDisabled={mutationsBlocked || isScheduling} onPress={() => void confirmSchedule()} accessibilityState={{ busy: isScheduling }}>
                {isScheduling ? <Spinner size="sm" /> : null}
                <Button.Label>{t('confirm_schedule')}</Button.Label>
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
                  editable={!mutationsBlocked}
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
              <Button variant="danger" isDisabled={mutationsBlocked || isCancelling} onPress={() => void confirmCancel()} accessibilityState={{ busy: isCancelling }}>
                {isCancelling ? <Spinner size="sm" /> : null}
                <Button.Label>{t('confirm_cancel')}</Button.Label>
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
                      accessibilityState={{ busy: isAuditLoadingMore }}
                    >
                      {isAuditLoadingMore ? <Spinner size="sm" /> : null}
                      <Button.Label>{t('common:buttons.loadMore')}</Button.Label>
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
        ) : refusedStatus !== null ? (
        /*
          🔴 A refusal is not a failure. This organiser-only screen answered a 403 with
          "could not load" and a Try again button that can never work: the member is
          not the organiser, or no longer is. Same treatment as job-analytics and
          job-pipeline (audit 2026-09-07, E/F-9), applied here 2026-09-08.
        */
          <Card testID="event-communications-refused">
            <Card.Body>
              <Card.Title>{t('common:errors.notAvailableTitle')}</Card.Title>
              <Card.Description>{t('common:errors.notAvailableHint')}</Card.Description>
            </Card.Body>
          </Card>
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
              <Text className="text-sm text-foreground">{t(broadcast.status === 'draft' ? 'draft_audience_summary' : 'audience_summary', {
                count: broadcast.audience.recipient_count,
                segments: broadcast.audience.segments.map((segment) => t(`segments.${segment}`)).join(', '),
              })}</Text>
              <Text className="text-sm text-foreground">{t('channels_summary', {
                channels: broadcast.channels.map((channel) => t(`channels.${channel}`)).join(', '),
              })}</Text>
              {broadcast.status === 'draft' ? (
                <Text className="text-sm text-muted-foreground">{t('draft_delivery_description')}</Text>
              ) : <>
              <Text className="text-sm text-foreground">{t('delivery_summary', {
                delivered: broadcast.delivery.delivered,
                total: broadcast.delivery.total,
                suppressed: broadcast.delivery.suppressed,
                dead: broadcast.delivery.dead_lettered,
              })}</Text>
              <Text className="text-sm text-muted-foreground">{t('scheduled_for', {
                date: dateLabel(broadcast.scheduled_at),
              })}</Text>
              </>}
            </Card.Body>
            <Card.Footer className="flex-row flex-wrap gap-2">
              {broadcast.capabilities.edit ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={mutationsBlocked || openingDraftId !== null || isSaving || composerOpen}
                  onPress={() => void openEditComposer(broadcast)}
                  accessibilityState={{ busy: openingDraftId === broadcast.id }}
                >
                  {openingDraftId === broadcast.id ? <Spinner size="sm" /> : null}
                  <Button.Label>{t('common:buttons.edit')}</Button.Label>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                isDisabled={isAuditLoading && auditTarget?.id === broadcast.id}
                onPress={() => void openAudit(broadcast)}
                accessibilityState={{ busy: isAuditLoading && auditTarget?.id === broadcast.id }}
              >
                {isAuditLoading && auditTarget?.id === broadcast.id ? <Spinner size="sm" /> : null}
                <Button.Label>{t('history_button')}</Button.Label>
              </Button>
              {broadcast.capabilities.schedule ? (
                <Button size="sm" isDisabled={mutationsBlocked} onPress={() => {
                  setScheduleTarget(broadcast);
                  setScheduledAt('');
                }}>{t('schedule_button')}</Button>
              ) : null}
              {broadcast.capabilities.cancel ? (
                <Button size="sm" variant="danger-soft" isDisabled={mutationsBlocked} onPress={() => {
                  setCancelTarget(broadcast);
                  setCancelReason('');
                }}>{t('cancel_button')}</Button>
              ) : null}
              {broadcast.capabilities.retry ? (
                <Button
                  size="sm"
                  variant="secondary"
                  isDisabled={mutationsBlocked || retryingId !== null}
                  onPress={() => void retryFailed(broadcast)}
                  accessibilityState={{ busy: retryingId === broadcast.id }}
                >
                  {retryingId === broadcast.id ? <Spinner size="sm" /> : null}
                  <Button.Label>{t('retry_button')}</Button.Label>
                </Button>
              ) : null}
            </Card.Footer>
              </Card>
            ))}
            {hasMore ? (
              <Button variant="secondary" isDisabled={isLoadingMore} onPress={() => void loadMore()} accessibilityState={{ busy: isLoadingMore }}>
                {isLoadingMore ? <Spinner size="sm" /> : null}
                <Button.Label>{t('common:buttons.loadMore')}</Button.Label>
              </Button>
            ) : null}
          </>
        )}
      </ScrollView>
      {confirmDialog}
    </SafeAreaView>
  );
}

export default withRouteGate(EventCommunicationsScreen, 'event-communications');
