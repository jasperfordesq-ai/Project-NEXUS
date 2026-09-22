// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/NativeButton';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import EventAgendaEditor from '@/components/events/EventAgendaEditor';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { useAgendaOperations } from '@/lib/hooks/useAgendaOperations';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { getEvent, getEventAgenda, type EventAgendaSession } from '@/lib/api/events';
import type { AgendaSessionPayload } from '@/lib/api/eventAgendaManagement';
import { isRefusalStatus } from '@/lib/api/refusal';
import { formatEventSchedule } from '@/lib/utils/eventDateTime';

function CancelSession({ session, blocked, initialReason = '', onCancel, onClose }: {
  session: EventAgendaSession; blocked: boolean; initialReason?: string; onCancel: (reason: string) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation(['events', 'common']);
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const { confirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard({ isDirty: !!reason, isSaving: busy, confirm,
    title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel') });
  return <View className="gap-3">
    <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('manage.agenda.cancel_title')}</Text>
    <Text className="text-foreground">{t('manage.agenda.cancel_desc', { title: session.title })}</Text>
    <Input label={t('manage.agenda.cancel_reason')} accessibilityLabel={t('manage.agenda.cancel_reason')} value={reason}
      onChangeText={setReason} maxLength={500} multiline editable={!blocked && !busy} />
    <Button variant="danger" isDisabled={blocked || busy || !reason.trim()} onPress={() => {
      if (lock.current || blocked || !reason.trim()) return;
      lock.current = true; setBusy(true);
      void onCancel(reason.trim()).catch(() => undefined).finally(() => { lock.current = false; setBusy(false); });
    }}>{t('manage.agenda.confirm_cancel')}</Button>
    <Button variant="secondary" isDisabled={busy} onPress={onClose}>{t('manage.agenda.keep_session')}</Button>
    {confirmDialog}
  </View>;
}
export function AgendaWorkspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['events', 'common', 'event_communications']);
  const scroll = useRef<ScrollView>(null);
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const state = useApi(async () => {
    const [event, agenda] = await Promise.all([getEvent(eventId), getEventAgenda(eventId, true)]);
    if (event.data.id !== eventId || agenda.data.event_id !== eventId) throw new Error('Agenda owner mismatch');
    return { event: event.data, agenda: agenda.data };
  }, [eventId], { enabled: active, clearOnRefusal: true });
  const [editor, setEditor] = useState<{ session?: EventAgendaSession; input?: AgendaSessionPayload; key: string } | null>(null);
  const [cancel, setCancel] = useState<{ session: EventAgendaSession; reason?: string } | null>(null);
  const [minimumVersion, setMinimumVersion] = useState(0);
  const [reviewVisit, setReviewVisit] = useState(0);
  const permitted = active && !state.isLoading && !state.error && !!state.data?.event.permissions.manage_agenda
    && !!state.data.agenda.permissions.manage && state.data.agenda.agenda_version >= minimumVersion;
  const operation = useAgendaOperations({ eventId, tenantId, userId }, permitted, response => {
    setEditor(null); setCancel(null); setMinimumVersion(response.data.agenda_version); state.refresh();
  });
  const review = operation.saved?.status === 'review' ? operation.saved : null;
  const needsAttention = operation.storageFailed || operation.operationFailed
    || operation.saved?.status === 'pending' || operation.saved?.status === 'rejected';
  useEffect(() => {
    if (needsAttention) scroll.current?.scrollTo({ y: 0, animated: true });
  }, [needsAttention]);
  const reviewed = useRef<string | null>(null);
  useEffect(() => {
    if (!review || reviewed.current === review.key) return;
    reviewed.current = review.key;
    const intent = review.intent;
    if (intent.action === 'create') setEditor({ input: intent.payload, key: review.key });
    if (intent.action === 'update' || intent.action === 'cancel') {
      const session = review.agenda.sessions.find(s => s.id === intent.sessionId && s.status === 'scheduled');
      if (!session) return;
      if (intent.action === 'update') setEditor({ session, input: intent.payload, key: review.key });
      else setCancel({ session, reason: intent.reason });
    }
  }, [review, reviewVisit]);
  const data = state.data;
  if (!data) return state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline"
    title={t(isRefusalStatus(state.errorStatus) ? 'manage.access_denied_title' : 'manage.agenda.load_error_title')}
    actionLabel={isRefusalStatus(state.errorStatus) ? undefined : t('common:buttons.retry')} onAction={state.refresh} />;
  if (!data.event.permissions.manage_agenda || !data.agenda.permissions.manage) return <EmptyState icon="lock-closed-outline" title={t('manage.access_denied_title')} />;
  const agenda = review?.agenda ?? data.agenda;
  const scheduled = agenda.sessions.filter(s => s.status === 'scheduled');
  const frozen = operation.blocked || !!agenda.event_status?.is_cancelled;
  const awaiting = operation.saved?.status === 'pending' || operation.saved?.status === 'rejected';
  const reorder = (index: number, direction: number) => {
    if (frozen || index + direction < 0 || index + direction >= scheduled.length) return;
    const ids = scheduled.map(s => s.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void operation.submit({ action: 'reorder', orderedSessionIds: ids, expectedAgendaVersion: agenda.agenda_version }).catch(() => undefined);
  };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={state.isLoading} enabled={!operation.busy}
        onRefresh={() => { if (!operation.busy) state.refresh(); }} />}>
      <View className="gap-4">
        <Text className="text-foreground">{t('manage.agenda.description')}</Text>
        {state.error && <Text accessibilityRole="alert" className="text-danger">{t('manage.agenda.load_error_desc')}</Text>}
        <Button variant="secondary" isDisabled={operation.busy || state.isLoading} onPress={state.refresh}>{t(state.error ? 'agenda.retry' : 'analytics.refresh')}</Button>
        {agenda.event_status?.is_cancelled && <Text accessibilityRole="alert" className="text-foreground">{t('manage.agenda.event_cancelled_notice')}</Text>}
        {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-2">
          <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_title' : 'recovery_title'}`)}</Text>
          <Text className="text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'}`)}</Text>
          <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.submit()).catch(() => undefined); }}>
            {t(`event_communications:${operation.storageFailed ? 'recovery_reload' : 'recovery_button'}`)}</Button>
        </View>}
        {operation.operationFailed && <Text accessibilityRole="alert" className="text-danger">{t('common:errors.generic')}</Text>}
        {operation.saved?.status === 'rejected' && <View className="gap-2">
          <Text accessibilityRole="alert" className="text-foreground">{t('manage.agenda.review_hint')}</Text>
          <Button isDisabled={!permitted || operation.busy} onPress={() => { void operation.review().catch(() => undefined); }}>{t('manage.agenda.review')}</Button>
        </View>}
        {review && <View className="gap-2"><Text className="text-foreground">{t('manage.agenda.review_hint')}</Text>
          {!editor && !cancel && review.intent.action !== 'reorder' && <Button isDisabled={frozen} onPress={() => {
            reviewed.current = null; setReviewVisit(value => value + 1);
          }}>{t('manage.agenda.review')}</Button>}
        </View>}
        {editor ? <EventAgendaEditor key={editor.key} event={data.event} session={editor.session} recoveredInput={editor.input}
          blocked={frozen} onClose={() => setEditor(null)} onSave={payload => operation.submit(editor.session
            ? { action: 'update', sessionId: editor.session.id, expectedVersion: editor.session.version, payload }
            : { action: 'create', payload })} />
          : cancel ? <CancelSession key={`${cancel.session.id}:${cancel.session.version}`} session={cancel.session} initialReason={cancel.reason}
            blocked={frozen} onClose={() => setCancel(null)} onCancel={reason => operation.submit({ action: 'cancel',
              sessionId: cancel.session.id, expectedVersion: cancel.session.version, reason })} />
          : <>
            <Button isDisabled={frozen || !!review} onPress={() => setEditor({ key: 'create' })}>{t('manage.agenda.add_session')}</Button>
            {!scheduled.length && <Text className="text-foreground">{t('manage.agenda.empty_title')}</Text>}
            {scheduled.map((session, index) => {
              const formatted = formatEventSchedule({ start_at: session.start_at, end_at: session.end_at, timezone: session.timezone, all_day: false });
              return <View key={session.id} className="gap-3 rounded-panel border border-border p-4">
                <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{session.title}</Text>
                <Text className="text-muted-foreground">{t('agenda.starts')}: {formatted.startDateLabel} {formatted.timeLabel}</Text>
                <Text className="text-muted-foreground">{t('agenda.ends')}: {formatted.endDateLabel} {formatted.endTimeLabel}</Text>
                <Text className="text-muted-foreground">{t(`manage.agenda.types.${session.type}`)} · {t(`manage.agenda.visibilities.${session.visibility}`)}</Text>
                <Button variant="secondary" isDisabled={frozen || !!review || awaiting} onPress={() => setEditor({ session, key: `edit:${session.id}:${session.version}` })}>{t('manage.agenda.edit_session', { title: session.title })}</Button>
                <Button variant="secondary" isDisabled={frozen || !!review || awaiting} onPress={() => setCancel({ session })}>{t('manage.agenda.cancel_session', { title: session.title })}</Button>
                <Button variant="secondary" isDisabled={frozen || index === 0 || (!!review && review.intent.action !== 'reorder')} onPress={() => reorder(index, -1)}>{t('manage.agenda.move_up', { title: session.title })}</Button>
                <Button variant="secondary" isDisabled={frozen || index === scheduled.length - 1 || (!!review && review.intent.action !== 'reorder')} onPress={() => reorder(index, 1)}>{t('manage.agenda.move_down', { title: session.title })}</Button>
              </View>;
            })}
            {agenda.sessions.some(s => s.status === 'cancelled') && <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('manage.agenda.cancelled_title')}</Text>}
            {agenda.sessions.filter(s => s.status === 'cancelled').map(session => <View key={session.id} className="gap-2 rounded-panel border border-border p-4">
              <Text className="font-semibold text-foreground">{session.title}</Text>
              <Text className="text-foreground">{t('manage.agenda.cancelled_reason', { reason: session.cancellation_reason })}</Text>
            </View>)}
          </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth(); const { tenant } = useTenant();
  const { t } = useTranslation(['events', 'common']);
  const numeric = Number(id);
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(numeric) ? numeric : 0;
  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
    <AppTopBar title={t('manage.agenda.title')} backLabel={t('common:back')}
      fallbackHref={{ pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <AgendaWorkspace key={`${tenant.id}:${user.id}:${eventId}`} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} />
      : <EmptyState icon="warning-outline" title={t('detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-agenda');
