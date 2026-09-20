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
import { useInvitationRevocationOperations } from '@/lib/hooks/useInvitationRevocationOperations';
import { getOrganizerInvitations, type OrganizerInvitation } from '@/lib/api/eventRegistration';
import { isRefusalStatus } from '@/lib/api/refusal';
import { eventIsoToLocalInput } from '@/lib/utils/eventDateTime';

function Workspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventRegistration', 'events', 'common', 'event_communications']);
  const focused = useIsFocused(); const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const listener = AppState.addEventListener('change', setAppState); return () => listener.remove(); }, []);
  const active = focused && appState === 'active';
  const [page, setPage] = useState(1); const [selected, setSelected] = useState<OrganizerInvitation | null>(null);
  const [reviewedStates, setReviewedStates] = useState<Record<number, Pick<OrganizerInvitation, 'status' | 'invitation_version' | 'accepted_at' | 'revoked_at' | 'expired_at'>>>({});
  const [reason, setReason] = useState(''); const [editing, setEditing] = useState(false); const [confirming, setConfirming] = useState(false);
  const [invalid, setInvalid] = useState(false); const [refused, setRefused] = useState(false);
  const state = useApi(async () => (await getOrganizerInvitations(eventId, page)).data, [eventId, page], { enabled: active, clearOnRefusal: true });
  const permitted = active && !refused && !state.isLoading && !state.error && Boolean(state.data?.permissions.manage_invitations);
  function clearEditor() { setReason(''); setEditing(false); setConfirming(false); setInvalid(false); }
  const operation = useInvitationRevocationOperations({ eventId, tenantId, userId }, permitted, active, receipt => {
    setSelected(previous => previous?.id === receipt.data.invitation.id ? { ...previous, ...receipt.data.invitation } : null); clearEditor();
  }, invitation => {
    const { status, invitation_version, accepted_at, revoked_at, expired_at } = invitation;
    setReviewedStates(previous => ({ ...previous, [invitation.id]: { status, invitation_version, accepted_at, revoked_at, expired_at } }));
    setSelected(invitation); clearEditor();
  });
  useEffect(() => { if (isRefusalStatus(operation.errorStatus)) setRefused(true); }, [operation.errorStatus]);
  useEffect(() => { if (!permitted) { setSelected(null); clearEditor(); } }, [permitted]);
  if (!active) return null;
  if (state.isLoading) return <LoadingSpinner />;
  if (refused || isRefusalStatus(operation.errorStatus) || isRefusalStatus(state.errorStatus) || (state.data && !state.data.permissions.manage_invitations)) return <EmptyState icon="lock-closed-outline" title={t('events:manage.access_denied_title')} />;
  if (state.error || !state.data) return <View className="gap-3 p-4"><Text accessibilityRole="alert" className="text-danger">{t('load_error.title')}</Text><Button onPress={state.refresh}>{t('common:buttons.retry')}</Button></View>;
  const data = state.data; const pagination = data.pagination; const blocked = !permitted || operation.blocked;
  const receipt = operation.saved?.status === 'acknowledged' ? operation.saved.invitation : null;
  const invitations = data.invitations.map(item => {
    const reviewed = reviewedStates[item.id];
    return reviewed && reviewed.invitation_version >= item.invitation_version ? { ...item, ...reviewed } : item;
  }).map(item => receipt?.id === item.id && receipt.invitation_version >= item.invitation_version ? { ...item, ...receipt } : item);
  const effectiveSelected = selected && receipt?.id === selected.id && receipt.invitation_version >= selected.invitation_version ? { ...selected, ...receipt } : selected;
  const showName = data.permissions.view_roster; const showEmail = data.permissions.view_recipient_email;
  function review() {
    if (blocked || effectiveSelected?.status !== 'issued') return;
    if (!reason.trim() || Array.from(reason.trim()).length > 500) { setInvalid(true); return; }
    Keyboard.dismiss(); setInvalid(false); setConfirming(true);
  }
  return <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 48 }}><View className="gap-4">
      {(operation.storageFailed || operation.saved?.status === 'pending') && <View className="gap-3">
        <Text className="text-foreground">{t('event_communications:' + (operation.storageFailed ? 'recovery_storage_description' : 'recovery_description'))}</Text>
        {operation.saved?.status === 'pending' && <Text className="text-foreground">{t('revocation.reference', { id: operation.saved.intent.invitationId })}</Text>}
        <Button isDisabled={!permitted || operation.busy} onPress={() => { void (operation.storageFailed ? operation.reload() : operation.recover()); }}>{t('event_communications:' + (operation.storageFailed ? 'recovery_reload' : 'recovery_button'))}</Button>
      </View>}
      {operation.saved?.status === 'rejected' && <View className="gap-3"><Text accessibilityRole="alert" className="text-foreground">{t('revocation.rejected')}</Text>
        <Button isDisabled={!permitted || operation.busy} onPress={() => { void operation.review(); }}>{t('revocation.review_current')}</Button></View>}
      {operation.operationFailed && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="text-danger">{t('common:errors.generic')}</Text>}
      {receipt && <Text accessibilityLiveRegion="polite" className="text-foreground">{t('revocation.completed', { id: receipt.id })}</Text>}
      <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(null); clearEditor(); state.refresh(); }}>{t('eventRegistration:common.refresh')}</Button>
      {!invitations.length && !selected && <Text className="text-muted-foreground">{t('revocation.empty')}</Text>}
      {(effectiveSelected ? [effectiveSelected] : invitations).map(invitation => <View key={invitation.id} className="gap-3 rounded-xl border border-separator p-4">
        <Text accessibilityRole="header" className="font-semibold text-foreground">{t('revocation.reference', { id: invitation.id })}</Text>
        {showName && invitation.member_name && <Text className="text-foreground">{invitation.member_name}</Text>}
        {showEmail && invitation.recipient_email && <Text className="text-foreground">{invitation.recipient_email}</Text>}
        <Text className="text-foreground">{t('statuses.' + invitation.status)}</Text>
        <Text className="text-muted-foreground">{t('revocation.campaign', { id: invitation.campaign_id })}</Text>
        <Text className="text-foreground">{t('invitations.expires_at')}: {eventIsoToLocalInput(invitation.token_expires_at, 'UTC')} UTC</Text>
        {selected ? <>
          {invitation.status === 'issued' && (!editing ? <Button isDisabled={blocked} onPress={() => setEditing(true)}>{t('revocation.revoke')}</Button> : <>
            <Text className="text-foreground">{t('revocation.warning')}</Text>
            {confirming ? <><Text className="text-foreground">{t('revocation.reason')}: {reason.trim()}</Text>
              <Button isDisabled={blocked} onPress={() => { if (!blocked && effectiveSelected?.status === 'issued') void operation.submit({ invitationId: effectiveSelected.id, reason: reason.trim() }); }}>{t('common:buttons.confirm')}</Button>
              <Button variant="secondary" isDisabled={operation.busy} onPress={() => setConfirming(false)}>{t('common:buttons.cancel')}</Button></>
              : <><Input label={t('revocation.reason')} value={reason} onChangeText={value => { setReason(value); setInvalid(false); }} editable={!blocked}
                multiline helper={t('revocation.reason_hint')} error={invalid ? t('revocation.reason_hint') : undefined} />
                <Button isDisabled={blocked} onPress={review}>{t('revocation.review')}</Button></>}
          </>)}
          <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(null); clearEditor(); }}>{t('common:close')}</Button>
        </> : <Button variant="secondary" isDisabled={operation.busy} onPress={() => { setSelected(invitation); clearEditor(); }}>{t('revocation.view')}</Button>}
      </View>)}
      {!selected && pagination.last_page > 1 && <View className="gap-2">
        <Text className="text-muted-foreground">{t('events:attendance.pageSummary', { page: pagination.page, total: pagination.last_page })}</Text>
        <Button variant="secondary" isDisabled={!pagination.previous_page || operation.busy} onPress={() => { if (pagination.previous_page) setPage(pagination.previous_page); }}>{t('events:attendance.previous')}</Button>
        <Button variant="secondary" isDisabled={!pagination.next_page || operation.busy} onPress={() => { if (pagination.next_page) setPage(pagination.next_page); }}>{t('events:attendance.next')}</Button>
      </View>}
    </View></ScrollView>
  </KeyboardAvoidingView>;
}
function Screen() {
  const { t } = useTranslation(['eventRegistration', 'events', 'common']);
  const { id } = useLocalSearchParams<{ id?: string | string[] }>(); const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary><SafeAreaView style={{ flex: 1 }} className="bg-background" edges={['top', 'left', 'right']}>
    <AppTopBar title={t('revocation.title')} backLabel={t('common:back')} fallbackHref={{ pathname: '/(modals)/event-registration-settings', params: { id: String(eventId) } } as Href} />
    {eventId && tenant?.id && user?.id ? <Workspace key={tenant.id + ':' + user.id + ':' + eventId} eventId={eventId} tenantId={Number(tenant.id)} userId={Number(user.id)} /> : <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}
export default withRouteGate(Screen, 'event-invitation-recipients');
