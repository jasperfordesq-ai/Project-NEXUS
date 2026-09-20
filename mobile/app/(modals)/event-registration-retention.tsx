// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Input from '@/components/ui/Input';
import { Button } from '@/components/ui/NativeButton';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { useRetentionOperations } from '@/lib/hooks/useRetentionOperations';
import { getEvent } from '@/lib/api/events';
import { getOrganizerRetentionHistory, getOrganizerRegistrationSettings, type OrganizerRetentionRun } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';
import { eventLocalInputToIso, eventIsoToLocalInput } from '@/lib/utils/eventDateTime';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common', 'event_communications']);
  const focused = useIsFocused(); const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const [page, setPage] = useState(1); const [asOf, setAsOf] = useState(''); const [invalid, setInvalid] = useState(false);
  const [selected, setSelected] = useState<OrganizerRetentionRun | null>(null); const [confirming, setConfirming] = useState(false);
  const [accepted, setAccepted] = useState<OrganizerRetentionRun | null>(null);
  const [refused, setRefused] = useState(false);
  const state = useApi(async () => {
    const [event, history, settings] = await Promise.all([getEvent(eventId), getOrganizerRetentionHistory(eventId, page), getOrganizerRegistrationSettings(eventId)]);
    return { ...history.data, schedule: event.data.schedule, configured: settings.data.settings !== null,
      permitted: event.data.id === eventId && history.data.permissions.manage_retention };
  }, [eventId, page], { enabled: active, clearOnRefusal: true });
  const permitted = active && !refused && !state.isLoading && !state.error && Boolean(state.data?.permitted);
  const operation = useRetentionOperations({ eventId, tenantId, userId }, permitted, active, receipt => {
    setAccepted(receipt.data.run); setSelected(receipt.data.run); setConfirming(false);
  });
  useEffect(() => { if (isRefusalStatus(operation.errorStatus)) setRefused(true); }, [operation.errorStatus]);
  useEffect(() => { if (!permitted) { setSelected(null); setAccepted(null); setConfirming(false); setAsOf(''); setInvalid(false); } }, [permitted]);
  if (!active) return null;
  if (state.isLoading) return <LoadingSpinner />;
  if (refused || isRefusalStatus(operation.errorStatus) || isRefusalStatus(state.errorStatus) || (state.data && !state.data.permitted)) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (state.error || !state.data) return <View className="gap-3 p-4"><Text accessibilityRole="alert" className="text-danger">{t('load_error.title')}</Text><Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></View>;
  const data = state.data; const pagination = data.pagination;
  const latest = accepted ?? (operation.saved?.status === 'acknowledged' ? operation.saved.run : null);
  const runs = latest && !data.runs.some(run => run.id === latest.id) ? [latest, ...data.runs] : data.runs;
  const blocked = !permitted || operation.blocked || !data.configured;
  const ended = data.schedule.end_at && Date.parse(data.schedule.end_at) <= Date.now();
  const canApply = selected?.mode === 'dry_run' && ended && Date.parse(selected.as_of_utc) >= Date.parse(data.schedule.end_at!) && Date.parse(selected.as_of_utc) <= Date.now();
  function preview() {
    if (blocked) return;
    const instant = eventLocalInputToIso(asOf.trim().replace(' ', 'T'), 'UTC');
    if (!instant || !ended || Date.parse(instant) < Date.parse(data.schedule.end_at!) || Date.parse(instant) > Date.now()) { setInvalid(true); return; }
    Keyboard.dismiss(); setInvalid(false); setConfirming(false); void operation.submit({ action: 'preview', asOf: instant });
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}><View className="gap-4">
      <Text className="text-foreground">{t('retention.description')}</Text>
      {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-3">
        <Text className="text-foreground">{t('event_communications:' + (operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'))}</Text>
        {operation.saved?.status === 'pending' && <><Text className="text-foreground">{t('retention.' + (operation.saved.intent.action === 'preview' ? 'preview' : 'apply'))}</Text>
          <Text className="text-foreground">{operation.saved.intent.action === 'preview' ? operation.saved.intent.asOf : t('retention.preview_reference', { id: operation.saved.intent.dryRunId })}</Text></>}
        <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.recover()); }}>{t('event_communications:' + (operation.storageFailed ? 'recovery_reload' : 'recovery_button'))}</Button>
      </View>}
      {operation.operationFailed && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{t('common:errors.generic')}</Text>}
      {!data.configured && <Text accessibilityRole="alert" className="text-foreground">{t('retention.settings_required')}</Text>}
      <Input label={t('retention.as_of')} value={asOf} onChangeText={value => { setAsOf(value); setInvalid(false); }} editable={!blocked}
        autoCapitalize="none" autoCorrect={false} helper={t('retention.time_hint')}
        error={invalid ? t('retention.time_hint') : undefined} />
      <Button isDisabled={blocked} onPress={preview}>{t('retention.preview')}</Button>
      <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(null); setAccepted(null); setConfirming(false); state.refresh(); }}>{t('eventRegistration:common.refresh')}</Button>
      <Text accessibilityRole="header" className="font-semibold text-foreground">{t('tabs.retention')}</Text>
      {!runs.length && <Text className="text-muted-foreground">{t('retention.empty')}</Text>}
      {(selected ? [selected] : runs).map(run => <View key={run.id} className="gap-3 rounded-xl border border-separator p-4">
        <Text accessibilityRole="header" className="font-semibold text-foreground">{t('retention.modes.' + run.mode)} · {run.id}</Text>
        <Text className="text-foreground">{t('retention.as_of')}: {eventIsoToLocalInput(run.as_of_utc, 'UTC')} UTC</Text>
        <Text className="text-foreground">{t('retention.eligible')}: {run.eligible_count}</Text>
        <Text className="text-foreground">{t('retention.affected')}: {run.affected_count}</Text>
        {run.dry_run_id && <Text className="text-muted-foreground">{t('retention.preview_reference', { id: run.dry_run_id })}</Text>}
        {selected ? <>
          {canApply && <><Text accessibilityRole="header" className="font-semibold text-foreground">{t('retention.warning_title')}</Text>
            <Text className="text-foreground">{t('retention.warning_description')}</Text>
            {!confirming ? <Button isDisabled={blocked} onPress={() => setConfirming(true)}>{t('retention.apply')}</Button>
              : <><Text accessibilityRole="alert" className="text-foreground">{t('retention.confirm', { id: run.id, count: run.eligible_count })}</Text>
                <Button isDisabled={blocked} onPress={() => { if (!blocked && canApply) void operation.submit({ action: 'apply', dryRunId: run.id }); }}>{t('common:buttons.confirm')}</Button>
                <Button variant="secondary" isDisabled={operation.busy} onPress={() => setConfirming(false)}>{t('common:buttons.cancel')}</Button></>}
          </>}
          <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(null); setConfirming(false); }}>{t('common:close')}</Button>
        </> : <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(run); setConfirming(false); }}>{t('retention.review')}</Button>}
      </View>)}
      {!selected && pagination.last_page > 1 && <View className="gap-2">
        <Text className="text-muted-foreground">{t('events:attendance.pageSummary', { page: pagination.page, total: pagination.last_page })}</Text>
        <Button variant="secondary" isDisabled={!pagination.previous_page || operation.busy} onPress={() => { if (pagination.previous_page) { setAccepted(null); setPage(pagination.previous_page); } }}>{t('events:attendance.previous')}</Button>
        <Button variant="secondary" isDisabled={!pagination.next_page || operation.busy} onPress={() => { if (pagination.next_page) { setAccepted(null); setPage(pagination.next_page); } }}>{t('events:attendance.next')}</Button>
      </View>}
    </View></ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background" edges={['top', 'left', 'right']}>
    <AppTopBar title={t('retention.title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={tenant.id + ':' + user.id + ':' + eventId} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} /> : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-retention');
