// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/NativeButton';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import EventInvitationSourceEditor from '@/components/events/EventInvitationSourceEditor';
import EventInvitationCampaignActions from '@/components/events/EventInvitationCampaignActions';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { useInvitationCampaignOperations } from '@/lib/hooks/useInvitationCampaignOperations';
import { getEvent } from '@/lib/api/events';
import { getOrganizerInvitationCampaigns, type OrganizerInvitationCampaign } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';
import { eventIsoToLocalInput } from '@/lib/utils/eventDateTime';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common', 'event_communications']);
  const focused = useIsFocused(); const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const [page, setPage] = useState(1); const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<number | null>(null); const [errorPage, setErrorPage] = useState(0);
  const [accepted, setAccepted] = useState<OrganizerInvitationCampaign | null>(null);
  const scroll = useRef<ScrollView>(null);
  const state = useApi(async () => {
    const [event, result] = await Promise.all([getEvent(eventId), getOrganizerInvitationCampaigns(eventId, page)]);
    return { ...result.data, schedule: event.data.schedule, permitted: event.data.id === eventId && event.data.permissions.manage_registration };
  }, [eventId, page], { enabled: active, clearOnRefusal: true });
  const permitted = active && !state.isLoading && !state.error && Boolean(state.data?.permitted);
  const operation = useInvitationCampaignOperations({ eventId, tenantId, userId }, permitted, active, receipt => {
    setAccepted(receipt.data.campaign); setSelection(receipt.data.campaign.id); setEditing(false); setErrorPage(0);
  });
  useEffect(() => { if (!permitted) { setSelection(null); setEditing(false); setAccepted(null); } }, [permitted]);
  if (!active) return null;
  if (state.isLoading) return <LoadingSpinner />;
  if (isRefusalStatus(state.errorStatus) || (state.data && !state.data.permitted)) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (state.error || !state.data) return <View className="gap-3 p-4"><Text accessibilityRole="alert" className="text-danger">{t('events:manage.load_error_title')}</Text>
    <Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></View>;
  const data = state.data; const pagination = data.pagination.campaigns;
  const campaigns = data.campaigns.map(item => accepted?.id === item.id && accepted.revision >= item.revision ? accepted : item);
  if (accepted && !campaigns.some(item => item.id === accepted.id)) campaigns.unshift(accepted);
  const selected = campaigns.find(item => item.id === selection);
  const blocked = !permitted || operation.blocked;
  const refresh = () => { setSelection(null); setEditing(false); setAccepted(null); state.refresh(); };
  const previewErrors = selected?.preview_errors ?? [];
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View className="gap-4">
        {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-3">
          <Text className="text-foreground">{t('event_communications:' + (operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'))}</Text>
          {operation.saved?.status === 'pending' && <Text className="text-foreground">{t('invitations.' + ({ preview: 'preview', issue: 'send_now', schedule: 'schedule', cancel: 'cancel' }[operation.saved.intent.action]))}</Text>}
          <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.recover()); }}>
            {t('event_communications:' + (operation.storageFailed ? 'recovery_reload' : 'recovery_button'))}</Button>
        </View>}
        {operation.operationFailed && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{t('common:errors.generic')}</Text>}
        {!operation.ready && !operation.storageFailed && <Text className="text-muted-foreground">{t('common:loading')}</Text>}
        {editing ? <>
          <Button variant="secondary" isDisabled={operation.busy} onPress={() => setEditing(false)}>{t('common:close')}</Button>
          <EventInvitationSourceEditor disabled={blocked} onPreview={intent => { void operation.submit(intent); }}
            onErrorLayout={() => scroll.current?.scrollToEnd({ animated: false })} />
        </> : <>
          <Button isDisabled={blocked} onPress={() => { setSelection(null); setEditing(true); }}>{t('invitations.builder_title')}</Button>
          <Button variant="secondary" isDisabled={operation.busy} onPress={refresh}>{t('events:analytics.refresh')}</Button>
          <Text accessibilityRole="header" className="font-semibold text-foreground">{t('invitations.history_title')}</Text>
          {!campaigns.length && <Text className="text-muted-foreground">{t('invitations.empty')}</Text>}
          {(selected ? [selected] : campaigns).map(campaign => <View key={campaign.id} className="gap-3 rounded-xl border border-separator p-4">
            <Text accessibilityRole="header" className="font-semibold text-foreground">{t('invitations.types.' + campaign.campaign_type)} · {campaign.id}</Text>
            <Text className="text-foreground">{t('statuses.' + campaign.status)}</Text>
            <Text className="text-muted-foreground">{t('invitations.locale_label')}: {t('locales.' + campaign.default_locale)}</Text>
            {campaign.scheduled_for_utc && <Text className="text-foreground">{t('invitations.scheduled_for')}: {eventIsoToLocalInput(campaign.scheduled_for_utc, data.schedule.timezone)} ({data.schedule.timezone})</Text>}
            <Text className="text-foreground">{t('invitations.previewed')}: {campaign.preview_count} · {t('invitations.valid')}: {campaign.valid_count} · {t('invitations.errors')}: {campaign.error_count}</Text>
            {campaign.invitations_count !== undefined && campaign.delivery_counts !== undefined && <Text className="text-muted-foreground">{t('invitations.delivery_summary', { invitations: campaign.invitations_count ?? 0, delivered: campaign.delivery_counts?.delivered ?? 0, failed: campaign.delivery_counts?.failed ?? 0 })}</Text>}
            {selected ? <>
              <Button variant="secondary" isDisabled={operation.busy} onPress={() => setSelection(null)}>{t('common:close')}</Button>
              <Text className="text-foreground">{t('invitations.snapshot_notice')}</Text>
              {previewErrors.slice(errorPage * 25, (errorPage + 1) * 25).map((error, index) => <Text key={errorPage * 25 + index} className="text-danger">
                {t('invitations.row_error', { row: error.row, code: t('invitations.error_codes.' + error.code, { defaultValue: t('accessible.validation_error') }) })}</Text>)}
              {previewErrors.length > 25 && <View className="gap-2">
                <Text className="text-muted-foreground">{t('events:attendance.pageSummary', { page: errorPage + 1, total: Math.ceil(previewErrors.length / 25) })}</Text>
                <Button variant="secondary" isDisabled={errorPage === 0} onPress={() => setErrorPage(value => value - 1)}>{t('events:attendance.previous')}</Button>
                <Button variant="secondary" isDisabled={(errorPage + 1) * 25 >= previewErrors.length} onPress={() => setErrorPage(value => value + 1)}>{t('events:attendance.next')}</Button>
              </View>}
              <EventInvitationCampaignActions key={campaign.id + ':' + campaign.revision} campaign={campaign} timezone={data.schedule.timezone}
                eventStart={data.schedule.start_at} disabled={blocked} onSubmit={intent => { void operation.submit(intent); }} />
            </> : <Button variant="secondary" onPress={() => { setSelection(campaign.id); setErrorPage(0); }}>{t('events:registrationSettings.review')}</Button>}
          </View>)}
          {!selected && pagination.last_page > 1 && <View className="gap-2">
            <Text className="text-muted-foreground">{t('events:attendance.pageSummary', { page: pagination.page, total: pagination.last_page })}</Text>
            <Button variant="secondary" isDisabled={!pagination.previous_page || operation.busy} onPress={() => { if (pagination.previous_page) { setAccepted(null); setPage(pagination.previous_page); } }}>{t('events:attendance.previous')}</Button>
            <Button variant="secondary" isDisabled={!pagination.next_page || operation.busy} onPress={() => { if (pagination.next_page) { setAccepted(null); setPage(pagination.next_page); } }}>{t('events:attendance.next')}</Button>
          </View>}
        </>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background" edges={['top', 'left', 'right']}>
    <AppTopBar title={t('invitations.builder_title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={tenant.id + ':' + user.id + ':' + eventId} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} />
      : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-invitations');
