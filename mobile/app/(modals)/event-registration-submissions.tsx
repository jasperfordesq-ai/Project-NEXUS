// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useState } from 'react';
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
import EventRegistrationAnswerReview from '@/components/events/EventRegistrationAnswerReview';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { getEvent } from '@/lib/api/events';
import { getOrganizerRegistrationSubmissions } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const focused = useIsFocused(); const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const [page, setPage] = useState(1); const [selection, setSelection] = useState<number | null>(null);
  const state = useApi(async () => {
    const [event, result] = await Promise.all([getEvent(eventId), getOrganizerRegistrationSubmissions(eventId, page)]);
    return { ...result.data, permitted: event.data.id === eventId && event.data.permissions.manage_registration };
  }, [eventId, page], { enabled: active, clearOnRefusal: true });
  const permitted = active && !state.isLoading && !state.error && Boolean(state.data?.permitted);
  useEffect(() => { if (!permitted) setSelection(null); }, [permitted]);
  if (!active) return null;
  if (state.isLoading) return <LoadingSpinner />;
  if (isRefusalStatus(state.errorStatus) || (state.data && !state.data.permitted)) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (state.error || !state.data) return <View className="gap-3 p-4"><Text accessibilityRole="alert" className="text-danger">{t('events:manage.load_error_title')}</Text>
    <Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></View>;
  const data = state.data; const pagination = data.pagination.submissions;
  const selected = data.submissions.find(item => item.id === selection);
  const move = (next: number | null) => { if (permitted && next) { setSelection(null); setPage(next); } };
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={selected ? undefined : <RefreshControl refreshing={state.isLoading} onRefresh={() => { setSelection(null); state.refresh(); }} />}>
      {selected ? <View className="gap-4"><Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{data.permissions.view_roster && selected.member_name ? selected.member_name : t('submissions.member_hidden')}</Text>
        <Text className="text-muted-foreground">{t('submissions.attempt', { attempt: selected.attempt_number })}</Text>
        <EventRegistrationAnswerReview key={selected.id + ':' + selected.revision} tenantId={tenantId} userId={userId} eventId={eventId}
        submissionId={selected.id} revision={selected.revision} form={data.forms.find(form => form.id === selected.form_version_id)}
        permitted={permitted} sensitive={data.permissions.view_sensitive_answers} active={active} onClose={() => setSelection(null)} /></View>
        : <View className="gap-4">
          <Text className="text-muted-foreground">{t('submissions.description')}</Text>
          {data.submissions.length === 0 && <Text className="text-muted-foreground">{t('submissions.empty')}</Text>}
          {data.submissions.map(item => <View key={item.id} className="gap-2 rounded-xl border border-separator p-4">
            <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{data.permissions.view_roster && item.member_name ? item.member_name : t('submissions.member_hidden')}</Text>
            <Text className="text-muted-foreground">{t('submissions.attempt', { attempt: item.attempt_number })}</Text>
            <Text className="text-foreground">{t('statuses.' + item.status)}</Text>
            {item.effective_slot === 1 && <Text className="text-foreground">{t('submissions.effective')}</Text>}
            {item.superseded_at && <Text className="text-muted-foreground">{t('submissions.superseded')}</Text>}
            <Button isDisabled={!permitted} onPress={() => { if (permitted) setSelection(item.id); }}>{t('submissions.review')}</Button>
          </View>)}
          {pagination.last_page > 1 && <View className="flex-row flex-wrap gap-2">
            <Button variant="secondary" isDisabled={!pagination.previous_page} onPress={() => move(pagination.previous_page)}>{t('events:attendance.previous')}</Button>
            <Button variant="secondary" isDisabled={!pagination.next_page} onPress={() => move(pagination.next_page)}>{t('events:attendance.next')}</Button>
          </View>}
        </View>}
    </ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background" edges={['top', 'left', 'right']}>
    <AppTopBar title={t('submissions.title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={tenant.id + ':' + user.id + ':' + eventId} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} />
      : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-submissions');
