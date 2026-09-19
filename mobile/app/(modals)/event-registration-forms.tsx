// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { Button } from '@/components/ui/NativeButton';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAppToast } from '@/components/ui/AppToast';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import EventRegistrationFormEditor from '@/components/events/EventRegistrationFormEditor';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useApi } from '@/lib/hooks/useApi';
import { useRegistrationFormOperations } from '@/lib/hooks/useRegistrationFormOperations';
import { getEvent } from '@/lib/api/events';
import { getOrganizerRegistrationForms, type OrganizerRegistrationForm, type RegistrationFormIntent, type mutateOrganizerRegistrationForm } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';

const numericId = (value: unknown) => typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : 0;
function Workspace({ eventId, tenantId, userId, selection }: { eventId: number; tenantId: number; userId: number; selection: string | undefined }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common', 'event_communications']);
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const subscription = AppState.addEventListener('change', setAppState); return () => subscription.remove(); }, []);
  const active = focused && appState === 'active';
  const state = useApi(async () => {
    const [event, product] = await Promise.all([getEvent(eventId), getOrganizerRegistrationForms(eventId)]);
    return { event: event.data, ...product.data };
  }, [eventId], { enabled: active, clearOnRefusal: true });
  const permitted = active && !state.isLoading && !state.error && Boolean(state.data?.event.permissions.manage_registration);
  const [accepted, setAccepted] = useState<Awaited<ReturnType<typeof mutateOrganizerRegistrationForm>>['data'] | null>(null);
  const [acceptedForms, setAcceptedForms] = useState<OrganizerRegistrationForm[]>([]);
  const toast = useAppToast();
  const operation = useRegistrationFormOperations({ eventId, tenantId, userId }, permitted, response => {
    setAccepted(response.data);
    setAcceptedForms(previous => [...previous.filter(form => form.id !== response.data.form.id), response.data.form]);
    toast.show({ title: t(response.data.form.status === 'published' ? 'messages.form_published' : 'messages.form_saved'), variant: 'success' });
  });
  const base = useRef<typeof state.data>(null);
  if (!base.current && state.data) base.current = state.data;
  useEffect(() => {
    if (isRefusalStatus(state.errorStatus) || (state.data && !state.data.event.permissions.manage_registration)) {
      base.current = null; setAccepted(null); setAcceptedForms([]);
    }
  }, [state.data, state.errorStatus]);
  const review = operation.saved?.status === 'review' ? operation.saved : null;
  const source = selection ? base.current : state.data;
  const settings = review?.settings ?? source?.settings;
  const revision = review?.settings.revision ?? (Math.max(accepted?.settings_revision ?? 0, settings?.revision ?? 0) || undefined);
  let forms = review?.forms ?? source?.forms ?? [];
  if (!review) {
    for (const receiptForm of acceptedForms) {
      if (!forms.some(form => form.id === receiptForm.id && form.revision > receiptForm.revision)) {
        forms = [...forms.filter(form => form.id !== receiptForm.id), receiptForm];
      }
    }
  }
  const selected = accepted?.form ?? forms.find(form => form.id === numericId(selection));
  const current = useRef({ permitted, blocked: operation.blocked, revision, forms });
  current.current = { permitted, blocked: operation.blocked, revision, forms };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const { confirm, confirmDialog } = useConfirm();
  const open = (form: string) => router.push({ pathname: '/(modals)/event-registration-forms', params: { id: String(eventId), form } } as Href);
  function confirmAction(intent: RegistrationFormIntent) {
    if (operation.blocked) return;
    confirm({ title: t(intent.action === 'publish' ? 'forms.publish' : 'forms.create_revision'),
      message: t('forms.editor.rules_description'), confirmLabel: t(intent.action === 'publish' ? 'forms.publish' : 'forms.create_revision'),
      cancelLabel: t('common:buttons.cancel'), onConfirm: async () => {
        if (!mounted.current || !current.current.permitted || current.current.blocked || current.current.revision !== intent.settingsRevision) return;
        if ('formId' in intent && !current.current.forms.some(form => form.id === intent.formId
          && (!('formRevision' in intent) || form.revision === intent.formRevision))) return;
        await operation.submit(intent).catch(() => undefined);
      } });
  }
  if (!state.data) return state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline"
    title={t('load_error.title')} actionLabel={isRefusalStatus(state.errorStatus) ? undefined : t('common.retry')} onAction={state.refresh} />;
  if (!state.data.event.permissions.manage_registration) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (!settings || !revision) return <View className="gap-3"><EmptyState icon="information-circle-outline" title={t('forms.settings_missing_title')} />
    <Text className="text-muted-foreground">{t('forms.settings_missing_description')}</Text></View>;
  const recovered = review && 'definition' in review.intent ? review.intent.definition : undefined;
  const editing = Boolean(selection || recovered);
  const reviewedFormId = review && 'formId' in review.intent ? review.intent.formId : null;
  const target = review?.intent.action === 'create' ? undefined
    : reviewedFormId ? forms.find(form => form.id === reviewedFormId) : selected;
  const createRevision = review?.intent.action === 'update' && target?.status === 'published';
  const missingTarget = Boolean(reviewedFormId && !target)
    || (!review && selection !== 'new' && Boolean(selection) && !target);
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={!editing ? <RefreshControl refreshing={state.isLoading} onRefresh={state.refresh} /> : undefined}><View className="gap-4">
      {state.error && <Button onPress={state.refresh}>{t('common.retry')}</Button>}
      {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-3">
        <Text className="text-foreground">{t(`event_communications:${operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'}`)}</Text>
        <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.submit()).catch(() => undefined); }}>
          {t(`event_communications:${operation.storageFailed ? 'recovery_reload' : 'recovery_button'}`)}</Button>
      </View>}
      {operation.operationFailed && <Text accessibilityRole="alert" className="text-danger">{t('messages.form_save_error')}</Text>}
      {operation.saved?.status === 'rejected' && <Button isDisabled={!permitted || operation.busy}
        onPress={() => { void operation.review().catch(() => undefined); }}>{t('events:registrationSettings.review')}</Button>}
      {editing ? <EventRegistrationFormEditor key={review ? `review:${review.key}` : `${target?.id ?? 'new'}:${target?.revision ?? 0}`}
        form={target ?? null} recovered={recovered} createRevision={createRevision} blocked={operation.blocked || missingTarget}
        onSave={definition => operation.submit(target && !createRevision ? { action: 'update', definition, formId: target.id,
          formRevision: target.revision, settingsRevision: revision } : { action: 'create', definition, settingsRevision: revision })} />
        : <><Button isDisabled={operation.blocked} onPress={() => open('new')}>{t('forms.new')}</Button>
          {!forms.length && <Text className="text-muted-foreground">{t('forms.empty')}</Text>}
          {forms.map(form => <View key={form.id} className="gap-3 rounded-panel border border-border p-4">
            <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{form.name}</Text>
            <Text className="text-muted-foreground">{t('forms.version', { version: form.version_number })} · {t(`statuses.${form.status}`)}</Text>
            {form.status === 'draft' ? <><Button isDisabled={operation.blocked} onPress={() => open(String(form.id))}>{t('forms.edit')}</Button>
              <Button isDisabled={operation.blocked} onPress={() => confirmAction({ action: 'publish', formId: form.id, formRevision: form.revision, settingsRevision: revision })}>{t('forms.publish')}</Button></>
              : <Button isDisabled={operation.blocked} onPress={() => confirmAction({ action: 'fork', formId: form.id, settingsRevision: revision })}>{t('forms.create_revision')}</Button>}
          </View>)}
        </>}
      {confirmDialog}
    </View></ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { id, form } = useLocalSearchParams<{ id?: string | string[]; form?: string | string[] }>();
  const { user } = useAuth(); const { tenant } = useTenant();
  const { t } = useTranslation(['eventRegistration', 'common', 'events']);
  const eventId = numericId(id);
  const valid = form === undefined || form === 'new' || numericId(form) > 0;
  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
    <AppTopBar title={t('forms.title')} backLabel={t('common:back')}
      fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && valid && tenant?.id && user?.id ? <Workspace key={`${tenant.id}:${user.id}:${eventId}:${form ?? 'list'}`}
      eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} selection={form as string | undefined} />
      : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-registration-forms');
