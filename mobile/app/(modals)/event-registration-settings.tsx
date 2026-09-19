// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/NativeButton';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import EventRegistrationSettingsEditor from '@/components/events/EventRegistrationSettingsEditor';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { useRegistrationSettingsOperations } from '@/lib/hooks/useRegistrationSettingsOperations';
import { getEvent } from '@/lib/api/events';
import { getOrganizerRegistrationSettings, type OrganizerRegistrationSettings } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';
import { registrationSettingsDraft } from '@/lib/eventRegistrationSettingsDraft';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['events', 'common', 'event_communications', 'eventRegistration']);
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const state = useApi(async () => {
    const [event, policy] = await Promise.all([getEvent(eventId), getOrganizerRegistrationSettings(eventId)]);
    return { event: event.data, settings: policy.data.settings };
  }, [eventId], { enabled: active, clearOnRefusal: true });
  const [accepted, setAccepted] = useState<OrganizerRegistrationSettings | null>(null);
  const permitted = active && !state.isLoading && !state.error && Boolean(state.data?.event.permissions.manage_registration);
  const operation = useRegistrationSettingsOperations({ eventId, tenantId, userId }, permitted,
    response => { setAccepted(response.data.settings); });
  const data = state.data;
  // Keep a draft's base stable through background refreshes; server revisions detect concurrent edits.
  const base = useRef<typeof data>(null);
  useEffect(() => {
    if (isRefusalStatus(state.errorStatus) || (data && !data.event.permissions.manage_registration)) {
      base.current = null;
      setAccepted(null);
    }
  }, [data, state.errorStatus]);
  if (!base.current && data) base.current = data;
  const current = base.current;
  const review = operation.saved?.status === 'review' ? operation.saved : null;
  const settings = review?.settings ?? accepted ?? current?.settings ?? null;
  const schedule = review?.schedule ?? current?.event.schedule;
  const recoveredDraft = review?.intent.action === 'save' && current
    ? registrationSettingsDraft({ ...review.settings, ...review.intent.input }, schedule!.timezone) : undefined;
  if (!data) return state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline"
    title={t(isRefusalStatus(state.errorStatus) ? 'manage.access_denied_title' : 'manage.load_error_title')}
    actionLabel={isRefusalStatus(state.errorStatus) ? undefined : t('common:buttons.retry')} onAction={state.refresh} />;
  if (!data.event.permissions.manage_registration) return <EmptyState icon="lock-closed-outline" title={t('manage.access_denied_title')} />;
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <View className="gap-4">
        <Button isDisabled={!permitted || operation.busy} onPress={() => router.push({
          pathname: '/(modals)/event-registration-forms', params: { id: String(eventId) },
        } as Href)}>{t('eventRegistration:forms.title')}</Button>
        <Button isDisabled={!permitted || operation.busy} onPress={() => router.push({
          pathname: '/(modals)/event-registration-submissions', params: { id: String(eventId) },
        } as Href)}>{t('eventRegistration:submissions.title')}</Button>
        {state.error && <><Text accessibilityRole="alert">{t('manage.load_error_title')}</Text><Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></>}
        {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-3">
          <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_title' : 'recovery_title'}`)}</Text>
          <Text className="text-muted-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'}`)}</Text>
          <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.submit()).catch(() => undefined); }}>
            {t(`event_communications:${operation.storageFailed ? 'recovery_reload' : 'recovery_button'}`)}
          </Button>
        </View>}
        {operation.operationFailed && <Text accessibilityRole="alert" className="text-danger">{t('common:errors.generic')}</Text>}
        {operation.saved?.status === 'rejected' && <View className="gap-3">
          <Text accessibilityRole="alert" className="text-foreground">{t('registrationSettings.conflict_hint')}</Text>
          <Button isDisabled={!permitted || operation.busy} onPress={() => { void operation.review().catch(() => undefined); }}>{t('registrationSettings.review')}</Button>
        </View>}
        {review && <Text className="text-foreground">{t('registrationSettings.review_hint')}</Text>}
        {current && <EventRegistrationSettingsEditor key={review ? `review:${review.key}` : accepted?.revision ?? 'initial'} settings={settings} recoveredDraft={recoveredDraft}
          recoveredInput={review?.intent.action === 'save' ? review.intent.input : undefined}
          timezone={schedule!.timezone} eventStart={schedule!.start_at ?? ''}
          blocked={operation.blocked} onSave={input => operation.submit({ action: 'save', input })}
          onPublish={expectedRevision => operation.submit({ action: 'publish', expectedRevision })} />}
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
    <AppTopBar title={t('registrationSettings.title')} backLabel={t('common:back')}
      fallbackHref={{ pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={`${tenant.id}:${user.id}:${eventId}`} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} />
      : <EmptyState icon="warning-outline" title={t('detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-settings');
