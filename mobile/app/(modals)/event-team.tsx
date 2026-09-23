// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { Card, Text } from 'heroui-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import NativePressable from '@/components/ui/NativePressable';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useApi } from '@/lib/hooks/useApi';
import { useStaffOperations } from '@/lib/hooks/useStaffOperations';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { getEvent } from '@/lib/api/events';
import { getEventStaff, eventStaffRoles, type EventStaffGrant } from '@/lib/api/eventStaff';
import { searchEventInviteMembers, type EventInviteMember } from '@/lib/api/eventPeople';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import { dateLocale } from '@/lib/utils/dateLocale';

function EventTeamScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary key={JSON.stringify([tenant?.id, user?.id, id])}>
    <TeamWorkspace eventId={eventId} tenantId={Number(tenant?.id)} userId={Number(user?.id)} />
  </ModalErrorBoundary>;
}

export function TeamWorkspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['events', 'common', 'event_communications']);
  const theme = useTheme(); const primary = usePrimaryColor(); const locale = dateLocale();
  const { confirm, confirmDialog } = useConfirm();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const subscription = AppState.addEventListener('change', setAppState); return () => subscription.remove(); }, []);
  const active = focused && appState === 'active';
  const valid = [eventId, tenantId, userId].every(id => Number.isSafeInteger(id) && id > 0);
  const state = useApi(async () => {
    const [event, staff] = await Promise.all([getEvent(eventId), getEventStaff(eventId)]);
    if (event.data.id !== eventId) throw new ApiResponseError(422, t('common:errors.contractDrift'));
    return { event: event.data, assignments: staff.data };
  }, [eventId, tenantId, userId], { enabled: valid && active, clearOnRefusal: true });
  const label = (key: string, values?: Record<string, string | number>) => t(`manage.team.${key}`, values);
  const name = (member: EventInviteMember) => {
    const display = member.name?.trim() || [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
    const identifier = label('member_fallback', { id: member.id });
    // Directory privacy can return identical first names. Preserve that privacy
    // while making the target verifiable in results, selection and confirmation.
    return display ? `${display} · ${identifier}` : identifier;
  };
  const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : label('not_recorded');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<EventInviteMember | null>(null);
  const [results, setResults] = useState<EventInviteMember[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [role, setRole] = useState<EventStaffGrant['role']>('registration_manager');
  const [expiry, setExpiry] = useState<Date | null>(null);
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  const [expiryError, setExpiryError] = useState(false);
  const [minimum, setMinimum] = useState<{ id: number; version: number } | null>(null);
  const awaitingLatest = !!minimum && !state.data?.assignments.some(item => item.id === minimum.id && item.version >= minimum.version);
  const permitted = active && !!state.data?.event.permissions.manage_staff && !state.isLoading && !state.error && !awaitingLatest;
  const privileged = !!state.data?.event.permissions.transfer_ownership;
  const roles = useMemo(() => eventStaffRoles.filter(item => privileged || !['co_organizer', 'finance_manager'].includes(item)), [privileged]);
  const authority = useRef({ permitted, roles }); authority.current = { permitted, roles };
  useEffect(() => { if (!roles.includes(role)) setRole('registration_manager'); }, [role, roles]);
  const operation = useStaffOperations({ eventId, tenantId, userId }, permitted, active, response => {
    setQuery(''); setSelected(null); setExpiry(null); setExpiryError(false);
    setMinimum({ id: response.data.assignment.id, version: response.data.assignment.version });
    state.refresh();
  });
  const blocked = !permitted || operation.blocked;
  const scroll = useRef<ScrollView>(null);
  const saved = operation.saved;
  const needsAttention = operation.storageFailed || operation.operationFailed || saved?.status === 'pending' || saved?.status === 'rejected';
  useEffect(() => { if (needsAttention) scroll.current?.scrollTo({ y: 0, animated: true }); }, [needsAttention]);
  useEffect(() => { if (!permitted) setPicker(null); }, [permitted]);
  useEffect(() => {
    let cancelled = false;
    setResults([]); setSearchState('idle');
    if (!permitted || selected || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      setSearchState('loading');
      void searchEventInviteMembers(query).then(members => {
        if (!cancelled) { setResults(members.filter(member => member.id !== state.data?.event.organizer.id)); setSearchState('success'); }
      }).catch(() => { if (!cancelled) setSearchState('error'); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, selected, permitted, state.data?.event.organizer.id]);
  useUnsavedChangesGuard({ isDirty: operation.busy || (!saved || saved.status === 'acknowledged') && Boolean(query || selected || expiry),
    isSaving: operation.busy, confirm, title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel') });
  function assign() {
    if (blocked || !selected || !roles.includes(role)) return;
    // The canonical API stores whole seconds. Normalize before saving the
    // operation so an accepted receipt matches its exact durable request.
    const expiryMillis = expiry ? Math.floor(expiry.getTime() / 1000) * 1000 : null;
    if (expiryMillis !== null && (!Number.isFinite(expiryMillis) || expiryMillis <= Date.now())) { setExpiryError(true); return; }
    const payload = { user_id: selected.id, role, expires_at: expiryMillis === null ? null : new Date(expiryMillis).toISOString() };
    confirm({ title: label('assign'), message: [name(selected), t(`manage.roles.${role}`), expiry ? timestamp(payload.expires_at) : label('no_expiry')].join('\n'),
      confirmLabel: label('assign'), cancelLabel: t('common:buttons.cancel'), onConfirm: async () => {
        if (!authority.current.permitted || !authority.current.roles.includes(payload.role)) return;
        if (payload.expires_at && Date.parse(payload.expires_at) <= Date.now()) { setExpiryError(true); return; }
        await operation.submit({ action: 'grant', payload });
      } });
  }
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={label('title')} backLabel={t('common:back')} fallbackHref={eventId > 0 ? { pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href : '/(tabs)/events'} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      refreshControl={valid ? <RefreshControl refreshing={state.isLoading && Boolean(state.data)} onRefresh={state.refresh} tintColor={primary} colors={[primary]} /> : undefined}>
      {!valid ? <EmptyState icon="warning-outline" title={t('detail.invalidId')} />
        : isRefusalStatus(state.errorStatus) || state.data && !state.data.event.permissions.manage_staff ? <EmptyState icon="lock-closed-outline" title={label('load_error_title')} subtitle={label('mobile.access_hint')} />
        : !state.data ? state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline" title={label('load_error_title')} subtitle={label('load_error_desc')} actionLabel={t('common:buttons.retry')} onAction={state.refresh} />
        : <>
          <RefreshFailedNotice error={state.error} onRetry={state.refresh} isRetrying={state.isLoading} />
          {awaitingLatest && !state.isLoading && <EmptyState icon="refresh-outline" title={label('mobile.refresh_title')} subtitle={label('mobile.refresh_hint')} actionLabel={t('common:buttons.retry')} onAction={state.refresh} />}
          {operation.storageFailed && <EmptyState icon="warning-outline" title={t('event_communications:recovery_storage_title')} subtitle={t('event_communications:recovery_storage_description')} actionLabel={t('event_communications:recovery_reload')} onAction={operation.reload} />}
          {saved && saved.status !== 'acknowledged' && <Card><Card.Body className="gap-3 p-4">
            <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{saved.status === 'pending' ? t('event_communications:recovery_title') : label('mobile.rejected_title')}</Text>
            <Text className="text-base text-foreground">{saved.status === 'pending' ? t('event_communications:recovery_description') : label('mobile.rejected_hint')}</Text>
            <Text className="text-base text-foreground">{saved.intent.action === 'grant' ? [label('member_fallback', { id: saved.intent.payload.user_id }), t(`manage.roles.${saved.intent.payload.role}`), saved.intent.payload.expires_at ? timestamp(saved.intent.payload.expires_at) : label('no_expiry')].join('\n') : label('mobile.saved_revoke', { id: saved.intent.assignmentId })}</Text>
            {saved.status === 'pending' ? <Button disabled={!permitted || operation.busy} onPress={operation.recover}>{t('event_communications:recovery_button')}</Button>
              : <Button variant="danger" disabled={!permitted || operation.busy} onPress={() => confirm({ title: label('mobile.discard_title'), message: label('mobile.discard_hint'), confirmLabel: label('mobile.discard_label'), cancelLabel: t('common:buttons.cancel'), variant: 'danger', onConfirm: operation.discard })}>{label('mobile.discard_label')}</Button>}
          </Card.Body></Card>}
          {operation.operationFailed && <Text accessibilityRole="alert" className="text-base text-foreground">{label('mobile.action_error')}</Text>}
          <Card><Card.Body className="gap-4 p-4">
            <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{label('add_title')}</Text>
            <Text className="text-base text-muted-foreground">{label('add_description')}</Text>
            <Input label={label('search_label')} accessibilityLabel={label('search_label')} placeholder={label('search_placeholder')} helper={label('search_hint')} value={query} onChangeText={value => { setQuery(value); setSelected(null); }} editable={!blocked} />
            {selected && <Text className="text-base text-foreground">{label('selected_member')}: {name(selected)}</Text>}
            {(query || selected) && <Button variant="ghost" disabled={blocked} onPress={() => { setQuery(''); setSelected(null); }}>{label('clear_search')}</Button>}
            {searchState === 'loading' && <Text accessibilityLiveRegion="polite">{label('searching')}</Text>}
            {searchState === 'error' && <Text accessibilityRole="alert">{label('search_error')}</Text>}
            {searchState === 'success' && results.length === 0 && <Text>{label('no_results')}</Text>}
            {!selected && results.map(member => <Button key={member.id} variant="secondary" disabled={blocked} accessibilityLabel={label('select_member', { name: name(member) })} onPress={() => { setSelected(member); setResults([]); setSearchState('idle'); }}>{name(member)}</Button>)}
            <Text accessibilityRole="header" className="text-base font-bold text-foreground">{label('role_label')}</Text>
            {roles.map(item => <NativePressable key={item} disabled={blocked} accessibilityRole="radio" accessibilityState={{ checked: role === item, disabled: blocked }} accessibilityLabel={t(`manage.roles.${item}`)} onPress={() => setRole(item)}>
              <View className="rounded-xl border border-border p-4"><Text className="text-base text-foreground">{role === item ? '◉ ' : '○ '}{t(`manage.roles.${item}`)}</Text></View>
            </NativePressable>)}
            <Text className="text-sm text-muted-foreground">{label('role_hint')}</Text>
            <Button variant="secondary" disabled={blocked} onPress={() => setPicker('date')}>{label('expiry_label')}</Button>
            {expiry && <><Text className="text-base text-foreground">{timestamp(expiry.toISOString())}</Text>
              <Text className="text-sm text-muted-foreground">{label('mobile.timezone', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</Text>
              <Button variant="secondary" disabled={blocked} onPress={() => setPicker('time')}>{label('mobile.time')}</Button>
              <Button variant="ghost" disabled={blocked} onPress={() => { setExpiry(null); setPicker(null); setExpiryError(false); }}>{label('no_expiry')}</Button></>}
            {picker && permitted && <><DateTimePicker value={expiry ?? new Date(Date.now() + 86400000)} mode={picker} minimumDate={picker === 'date' ? new Date() : undefined}
              onChange={(event, date) => { if (Platform.OS !== 'ios') setPicker(null); if (event.type === 'set' && date && authority.current.permitted) { setExpiry(date); setExpiryError(false); } }} />
              {Platform.OS === 'ios' && <Button variant="ghost" onPress={() => setPicker(null)}>{t('common:buttons.done')}</Button>}</>}
            {expiryError && <Text accessibilityRole="alert">{label('expiry_invalid')}</Text>}
            <Button disabled={blocked || !selected} isLoading={operation.busy} onPress={assign}>{label('assign')}</Button>
          </Card.Body></Card>
          <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{label('assignment_count', { count: state.data.assignments.length })}</Text>
          <Text className="text-base text-muted-foreground">{label('description')}</Text>
          {state.data.assignments.length === 0 && <EmptyState icon="people-outline" title={label('empty_title')} subtitle={label('empty_desc')} />}
          {state.data.assignments.map(assignment => <Card key={assignment.id}><Card.Body className="gap-3 p-4">
            <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{name(assignment.member)}</Text>
            <Text className="text-base text-foreground">{t(`manage.roles.${assignment.role}`)}</Text>
            <Text className="text-base text-foreground">{label(assignment.status === 'revoked' ? 'status_revoked' : !assignment.effective ? 'status_expired' : 'status_active')}</Text>
            <Text>{label('version_value', { version: assignment.version })}</Text>
            <Text>{label('granted_at')}: {timestamp(assignment.granted_at)}</Text>
            <Text>{label('expires_at')}: {assignment.expires_at ? timestamp(assignment.expires_at) : label('no_expiry')}</Text>
            <Text accessibilityRole="header" className="font-bold">{label('capabilities')}</Text>
            {assignment.capabilities.map(capability => <Text key={capability}>{t(`manage.capabilities.${capability}`, { defaultValue: label('mobile.unknown_capability') })}</Text>)}
            {assignment.capabilities.length === 0 && <Text>{label('no_capabilities')}</Text>}
            {assignment.status === 'active' && roles.includes(assignment.role) && <Button variant="danger" disabled={blocked} onPress={() => confirm({ title: label('revoke_title'), message: label('revoke_desc', { role: t(`manage.roles.${assignment.role}`), name: name(assignment.member) }), confirmLabel: label('revoke_confirm'), cancelLabel: label('revoke_cancel'), variant: 'danger', onConfirm: async () => {
              if (authority.current.permitted && authority.current.roles.includes(assignment.role)) await operation.submit({ action: 'revoke', assignmentId: assignment.id });
            } })}>{label('revoke')}</Button>}
            <Text accessibilityRole="header" className="font-bold">{label('audit_title', { count: assignment.history.length })}</Text>
            {assignment.history.length === 0 && <Text>{label('no_audit_entries')}</Text>}
            {assignment.history.map(entry => <View key={entry.id} className="gap-2 border-t border-border pt-3">
              <Text>{t(`manage.team.audit_actions.${entry.action}`)} · {label('version_value', { version: entry.version })}</Text>
              <Text>{label('audit_actor_time', { actor: entry.actor_user_id, time: timestamp(entry.created_at) })}</Text>
              <Text className="text-sm text-muted-foreground">{label('history_immutable')}</Text>
            </View>)}
          </Card.Body></Card>)}
        </>}
    </ScrollView>
    </KeyboardAvoidingView>
    {confirmDialog}
  </SafeAreaView>;
}
export default withRouteGate(EventTeamScreen, 'event-team');
