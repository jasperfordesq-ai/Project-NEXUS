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
import { Button } from '@/components/ui/NativeButton';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import EventGuestAttendanceActions from '@/components/events/EventGuestAttendanceActions';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { getEvent } from '@/lib/api/events';
import { getOrganizerRegistrationGuests } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const focused = useIsFocused(); const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const [page, setPage] = useState(1); const [selection, setSelection] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  const state = useApi(async () => {
    const [event, result] = await Promise.all([getEvent(eventId), getOrganizerRegistrationGuests(eventId, page)]);
    return { ...result.data, permitted: event.data.id === eventId && event.data.permissions.manage_registration };
  }, [eventId, page], { enabled: active, clearOnRefusal: true });
  const permitted = active && !state.isLoading && !state.error && Boolean(state.data?.permitted);
  useEffect(() => { if (!permitted) setSelection(null); }, [permitted]);
  const shown = useRef({ guestId: selection, epoch: 0 });
  const visibleGuest = permitted ? selection : null;
  if (shown.current.guestId !== visibleGuest) shown.current = { guestId: visibleGuest, epoch: shown.current.epoch + 1 };
  const formEpoch = shown.current.epoch;
  const revealError = () => { if (shown.current.epoch === formEpoch && shown.current.guestId === selection) scroll.current?.scrollToEnd({ animated: false }); };
  if (!active) return null;
  if (state.isLoading) return <LoadingSpinner />;
  if (isRefusalStatus(state.errorStatus) || (state.data && !state.data.permitted)) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (state.error || !state.data) return <View className="gap-3 p-4"><Text accessibilityRole="alert" className="text-danger">{t('events:manage.load_error_title')}</Text>
    <Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></View>;
  const data = state.data; const pagination = data.pagination.guests;
  const selected = data.guests.find(guest => guest.id === selection);
  const refresh = () => { setSelection(null); state.refresh(); };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={selected ? undefined : <RefreshControl refreshing={state.isLoading} onRefresh={refresh} />}>
      <View className="gap-4">
        <Text className="text-muted-foreground">{t('guests.description')}</Text>
        {!data.guests.length && <Text className="text-muted-foreground">{t('guests.empty')}</Text>}
        {(selected ? [selected] : data.guests).map(guest => <View key={guest.id} className="gap-3 rounded-xl border border-separator p-4">
          <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{data.permissions.view_roster && guest.display_name ? guest.display_name : t('guests.name_hidden')}</Text>
          <Text className="text-muted-foreground">{t('guests.guest_number', { number: guest.guest_number })}</Text>
          <Text className="text-foreground">{t('statuses.' + guest.status)}</Text>
          <Text className="text-foreground">{t('events:attendance.states.' + (guest.attendance?.status ?? 'not_checked_in'))}</Text>
          {data.permissions.view_sensitive_answers && guest.email && <Text selectable className="text-foreground">{guest.email}</Text>}
          {data.permissions.view_sensitive_answers && guest.phone && <Text selectable className="text-foreground">{guest.phone}</Text>}
          <Text className="text-muted-foreground">{t(guest.ticket_entitlement_id ? 'guests.ticket_linked' : 'guests.no_ticket')}</Text>
          <Text className="text-muted-foreground">{t(guest.notification_consent ? 'guests.notifications_allowed' : 'guests.notifications_not_allowed')}</Text>
          {selected ? <>
            <Button variant="secondary" onPress={() => setSelection(null)}>{t('common:close')}</Button>
            <EventGuestAttendanceActions scope={{ eventId, tenantId, userId, guestId: guest.id }} guest={guest}
              permitted={permitted && data.permissions.manage_attendance} active={active} onRefresh={refresh}
              onErrorLayout={revealError} />
          </> : data.permissions.manage_attendance && <Button onPress={() => setSelection(guest.id)}>{t('guests.manage_attendance')}</Button>}
        </View>)}
        {!selected && pagination.last_page > 1 && <View className="gap-2">
          <Text className="text-muted-foreground">{t('events:attendance.pageSummary', { page: pagination.page, total: pagination.last_page })}</Text>
          <View className="flex-row flex-wrap gap-2">
            <Button variant="secondary" isDisabled={!pagination.previous_page} onPress={() => { if (pagination.previous_page) setPage(pagination.previous_page); }}>{t('events:attendance.previous')}</Button>
            <Button variant="secondary" isDisabled={!pagination.next_page} onPress={() => { if (pagination.next_page) setPage(pagination.next_page); }}>{t('events:attendance.next')}</Button>
          </View>
        </View>}
      </View>
    </ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background" edges={['top', 'left', 'right']}>
    <AppTopBar title={t('guests.title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={tenant.id + ':' + user.id + ':' + eventId} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} />
      : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-guests');
