// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
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
import TextArea from '@/components/ui/TextArea';
import Toggle from '@/components/ui/Toggle';
import Button from '@/components/ui/Button';
import NativePressable from '@/components/ui/NativePressable';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useApi } from '@/lib/hooks/useApi';
import { useSafetyOperations } from '@/lib/hooks/useSafetyOperations';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { getEvent } from '@/lib/api/events';
import { getEventSafety, type EventSafety } from '@/lib/api/eventSafety';
import { getEventSafetyReviews, safetyReviewDecisions, safetyReviewReasons, type SafetyReviews, type SafetyRequirementDraft } from '@/lib/api/eventSafetyManagement';
import { searchEventInviteMembers, type EventInviteMember } from '@/lib/api/eventPeople';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import { dateLocale } from '@/lib/utils/dateLocale';
import type { SafetyOperationIntent } from '@/lib/eventSafetyOperation';

const PAGE_SIZE = 25;
type Decision = typeof safetyReviewDecisions[number];
type Reason = typeof safetyReviewReasons[number];
type ReviewItem = SafetyReviews['items'][number];
type Subject = { id: number; name: string };
export type RequirementForm = { minimumAge: string; guardian: boolean; threshold: string; codeRequired: boolean; codeText: string; codeVersion: string };

export function formFromSafety(safety: EventSafety): RequirementForm {
  const version = safety.requirements?.version;
  return {
    minimumAge: version?.minimum_age == null ? '' : String(version.minimum_age),
    guardian: version?.guardian_consent_required ?? false,
    threshold: version?.minor_age_threshold == null ? '' : String(version.minor_age_threshold),
    codeRequired: version?.code_of_conduct.required ?? false,
    codeText: version?.code_of_conduct.text ?? '',
    codeVersion: version?.code_of_conduct.text_version ?? '',
  };
}

/** Whole numbers only; blank means "no value". Returns undefined when invalid. */
export function parseAge(value: string, minimum: number): number | null | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!/^\d{1,3}$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return parsed >= minimum && parsed <= 125 ? parsed : undefined;
}

export function draftFromForm(form: RequirementForm): SafetyRequirementDraft | null {
  const minimum = parseAge(form.minimumAge, 0);
  const threshold = form.guardian ? parseAge(form.threshold, 1) : null;
  if (minimum === undefined || threshold === undefined || (form.guardian && threshold === null)) return null;
  if (form.codeRequired && (!form.codeText.trim() || !form.codeVersion.trim())) return null;
  return {
    minimum_age: minimum,
    guardian_consent_required: form.guardian,
    minor_age_threshold: form.guardian ? threshold : null,
    code_of_conduct_required: form.codeRequired,
    code_of_conduct_text: form.codeRequired ? form.codeText.trim() : null,
    code_of_conduct_text_version: form.codeRequired ? form.codeVersion.trim() : null,
  };
}

const wholeSeconds = (date: Date) => new Date(Math.floor(date.getTime() / 1000) * 1000);

function EventSafetyScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth(); const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary key={JSON.stringify([tenant?.id, user?.id, id])}>
    <SafetyWorkspace eventId={eventId} tenantId={Number(tenant?.id)} userId={Number(user?.id)} />
  </ModalErrorBoundary>;
}

export function SafetyWorkspace({ eventId, tenantId, userId }: { eventId: number; tenantId: number; userId: number }) {
  const { t } = useTranslation(['eventSafety', 'events', 'common', 'event_communications']);
  const theme = useTheme(); const primary = usePrimaryColor(); const locale = dateLocale();
  const { confirm, confirmDialog } = useConfirm();
  const focused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  useEffect(() => { const subscription = AppState.addEventListener('change', setAppState); return () => subscription.remove(); }, []);
  const active = focused && appState === 'active';
  const valid = [eventId, tenantId, userId].every(value => Number.isSafeInteger(value) && value > 0);
  const [page, setPage] = useState(1);
  const state = useApi(async () => {
    const [event, safety] = await Promise.all([getEvent(eventId), getEventSafety(eventId)]);
    if (event.data.id !== eventId) throw new ApiResponseError(422, t('common:errors.contractDrift'));
    const reviews = safety.data.permissions.review_participation ? (await getEventSafetyReviews(eventId, page, PAGE_SIZE)).data : null;
    return { event: event.data, safety: safety.data, reviews };
  }, [eventId, tenantId, userId, page], { enabled: valid && active, clearOnRefusal: true });
  const s = (key: string, values?: Record<string, string | number>) => t(`safety.${key}`, values);
  const m = (key: string, values?: Record<string, string | number>) => t(`safety.mobile.${key}`, values);
  const timestamp = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString(locale) : '—';

  const safety = state.data?.safety;
  // An archived policy is final: the API refuses any further draft (event_safety_requirements_archived).
  const archived = safety?.requirements?.status === 'archived';
  const canManage = !!safety?.permissions.manage_requirements;
  const canEdit = canManage && !archived;
  const canReview = !!safety?.permissions.review_participation;
  // Stay permitted during a background refresh: toggling would reset the operation hook and hide a
  // failure or rejection the organiser still needs to see. The server checks revisions on every change.
  const permitted = active && !!state.data && !state.error && (canManage || canReview);
  const authority = useRef({ permitted, canManage, canReview }); authority.current = { permitted, canManage, canReview };

  // Requirements form. It is re-seeded from the server only when it has no unsaved edits,
  // or after one of our own changes was accepted (resync).
  const [form, setForm] = useState<RequirementForm | null>(null);
  const [base, setBase] = useState<string>('');
  const resync = useRef(true);
  useEffect(() => {
    if (!safety) return;
    const next = formFromSafety(safety);
    if (resync.current || form === null || JSON.stringify(form) === base) {
      setForm(next); setBase(JSON.stringify(next)); resync.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safety]);
  const [submitted, setSubmitted] = useState(false);
  const formDirty = form !== null && JSON.stringify(form) !== base;

  // Review form
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [results, setResults] = useState<EventInviteMember[]>([]);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [decision, setDecision] = useState<Decision>('deny');
  const [reason, setReason] = useState<Reason>('safety_review');
  const [from, setFrom] = useState<Date>(() => new Date());
  const [until, setUntil] = useState<Date | null>(null);
  const [expectedVersion, setExpectedVersion] = useState<number | null>(null);
  const [picker, setPicker] = useState<{ field: 'from' | 'until'; mode: 'date' | 'time' } | null>(null);
  const [untilError, setUntilError] = useState(false);
  const clearReview = () => { setQuery(''); setSubject(null); setResults([]); setDecision('deny'); setReason('safety_review'); setFrom(new Date()); setUntil(null); setExpectedVersion(null); setUntilError(false); setPicker(null); };

  const operation = useSafetyOperations({ eventId, tenantId, userId }, permitted, active, () => {
    resync.current = true; setSubmitted(false); clearReview(); state.refresh();
  });
  const blocked = !permitted || operation.blocked;
  const saved = operation.saved;
  const scroll = useRef<ScrollView>(null);
  const needsAttention = operation.storageFailed || operation.operationFailed || saved?.status === 'pending' || saved?.status === 'rejected';
  useEffect(() => { if (needsAttention) scroll.current?.scrollTo({ y: 0, animated: true }); }, [needsAttention]);
  useEffect(() => { if (!permitted) setPicker(null); }, [permitted]);
  // After a refused or failed change, reload the server's current values so the organiser can
  // review them. Once per saved change: a refresh briefly resets the operation state, so keying on
  // a boolean would loop.
  const badKey = saved?.status === 'rejected' ? `rejected:${saved.key}` : operation.operationFailed ? `failed:${saved?.key ?? ''}` : null;
  const refreshedFor = useRef<string | null>(null);
  const refresh = useRef(state.refresh); refresh.current = state.refresh;
  useEffect(() => { if (badKey && badKey !== refreshedFor.current) { refreshedFor.current = badKey; refresh.current(); } }, [badKey]);
  useEffect(() => {
    let cancelled = false;
    setResults([]); setSearchState('idle');
    if (!permitted || !canReview || subject || query.trim().length < 2) return;
    const timer = setTimeout(() => {
      setSearchState('loading');
      void searchEventInviteMembers(query).then(members => { if (!cancelled) { setResults(members); setSearchState('success'); } })
        .catch(() => { if (!cancelled) setSearchState('error'); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, subject, permitted, canReview]);
  useUnsavedChangesGuard({ isDirty: operation.busy || (!saved || saved.status === 'acknowledged') && (formDirty || Boolean(query || subject)),
    isSaving: operation.busy, confirm, title: t('common:unsavedChanges.title'), message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'), cancelLabel: t('common:buttons.cancel') });

  const memberName = (member: EventInviteMember) => {
    const display = member.name?.trim() || [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
    const identifier = m('member_fallback', { id: member.id });
    return display ? `${display} · ${identifier}` : identifier;
  };
  const submit = (intent: SafetyOperationIntent) => operation.submit(intent);

  function saveDraft() {
    setSubmitted(true);
    if (blocked || !form || !safety || !authority.current.canManage || archived) return;
    const draft = draftFromForm(form);
    if (!draft) return;
    void submit({ action: 'draft', payload: draft, expectedRevision: safety.requirements?.revision ?? null });
  }
  function publish() {
    const current = safety?.requirements;
    if (blocked || !current || current.status !== 'draft') return;
    confirm({ title: s('actions.publish'), message: s('requirements.description'), confirmLabel: s('actions.publish'), cancelLabel: s('actions.cancel'),
      onConfirm: async () => { if (authority.current.permitted && authority.current.canManage) await submit({ action: 'publish', expectedRevision: current.revision, expectedVersion: current.current_version }); } });
  }
  function archive() {
    const current = safety?.requirements;
    if (blocked || !current || current.status === 'archived') return;
    confirm({ title: s('requirements.archive_title'), message: s('requirements.archive_description'), confirmLabel: s('actions.confirm_archive'), cancelLabel: s('actions.cancel'), variant: 'danger',
      onConfirm: async () => { if (authority.current.permitted && authority.current.canManage) await submit({ action: 'archive', expectedRevision: current.revision, expectedVersion: current.current_version }); } });
  }
  function saveReview() {
    if (blocked || !subject || !authority.current.canReview) return;
    const start = wholeSeconds(from); const end = until ? wholeSeconds(until) : null;
    if (end && end.getTime() <= start.getTime()) { setUntilError(true); return; }
    const payload = { user_id: subject.id, decision, reason_code: reason, effective_from: start.toISOString(), effective_until: end ? end.toISOString() : null, expected_version: expectedVersion };
    confirm({ title: s(expectedVersion === null ? 'reviews.new_title' : 'reviews.edit_title'),
      message: [subject.name, s(`decisions.${decision}`), t(`safety.reasons.${reason}`), `${s('reviews.effective_from')}: ${timestamp(payload.effective_from)}`,
        `${s('reviews.effective_until')}: ${payload.effective_until ? timestamp(payload.effective_until) : m('clear_until')}`].join('\n'),
      confirmLabel: s('actions.save_review'), cancelLabel: s('actions.cancel'),
      onConfirm: async () => { if (authority.current.permitted && authority.current.canReview) await submit({ action: 'review', payload }); } });
  }
  function editReview(item: ReviewItem) {
    if (blocked) return;
    setSubject({ id: item.member.id, name: `${item.member.display_name} · ${m('member_fallback', { id: item.member.id })}` });
    setQuery(''); setDecision(item.denial.decision); setReason(item.denial.reason_code);
    setFrom(new Date(item.denial.effective_from)); setUntil(item.denial.effective_until ? new Date(item.denial.effective_until) : null);
    setExpectedVersion(item.denial.decision_version); setUntilError(false);
  }
  function withdrawReview(item: ReviewItem) {
    if (blocked) return;
    confirm({ title: s('confirmations.withdraw_review_title'), message: s('confirmations.withdraw_review_body', { name: item.member.display_name }),
      confirmLabel: s('actions.withdraw_review'), cancelLabel: s('actions.cancel'), variant: 'danger',
      onConfirm: async () => { if (authority.current.permitted && authority.current.canReview) await submit({ action: 'withdraw', denialId: item.denial.id, expectedVersion: item.denial.decision_version }); } });
  }
  function describe(intent: SafetyOperationIntent) {
    switch (intent.action) {
      case 'draft': return m('recovery_draft');
      case 'publish': return m('recovery_publish');
      case 'archive': return m('recovery_archive');
      case 'review': return [m('recovery_review', { id: intent.payload.user_id }), s(`decisions.${intent.payload.decision}`), t(`safety.reasons.${intent.payload.reason_code}`)].join('\n');
      case 'withdraw': return m('recovery_withdraw', { id: intent.denialId });
    }
  }
  const radio = <T extends string>(value: T, current: T, label: string, onPress: (value: T) => void) =>
    <NativePressable key={value} disabled={blocked} accessibilityRole="radio" accessibilityState={{ checked: current === value, disabled: blocked }} accessibilityLabel={label} onPress={() => onPress(value)}>
      <View className="rounded-xl border border-border p-4"><Text className="text-base text-foreground">{current === value ? '◉ ' : '○ '}{label}</Text></View>
    </NativePressable>;

  const requirements = safety?.requirements ?? null;
  const reviews = state.data?.reviews ?? null;
  const pages = reviews ? Math.max(1, Math.ceil(reviews.total / reviews.per_page)) : 1;
  const minimumInvalid = !!form && parseAge(form.minimumAge, 0) === undefined;
  const thresholdInvalid = !!form && form.guardian && !parseAge(form.threshold, 1);
  const codeInvalid = !!form && form.codeRequired && (!form.codeText.trim() || !form.codeVersion.trim());
  const update = (patch: Partial<RequirementForm>) => setForm(previous => previous && ({ ...previous, ...patch }));

  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={s('organizer.title')} backLabel={t('common:back')} fallbackHref={eventId > 0 ? { pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href : '/(tabs)/events'} />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      refreshControl={valid ? <RefreshControl refreshing={state.isLoading && Boolean(state.data)} onRefresh={state.refresh} tintColor={primary} colors={[primary]} /> : undefined}>
      {!valid ? <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />
        : isRefusalStatus(state.errorStatus) ? <EmptyState icon="lock-closed-outline" title={s('organizer.load_error_title')} subtitle={m('access_hint')} />
        : !state.data || !safety || !form ? state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline" title={s('organizer.load_error_title')} subtitle={s('organizer.load_error_description')} actionLabel={s('actions.retry')} onAction={state.refresh} />
        : !canManage && !canReview && !requirements ? <EmptyState icon="lock-closed-outline" title={s('organizer.load_error_title')} subtitle={m('access_hint')} />
        : <>
          <RefreshFailedNotice error={state.error} onRetry={state.refresh} isRetrying={state.isLoading} />
          {operation.storageFailed && <EmptyState icon="warning-outline" title={t('event_communications:recovery_storage_title')} subtitle={t('event_communications:recovery_storage_description')} actionLabel={t('event_communications:recovery_reload')} onAction={operation.reload} />}
          {saved && saved.status !== 'acknowledged' && <Card><Card.Body className="gap-3 p-4">
            <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{saved.status === 'pending' ? t('event_communications:recovery_title') : m('rejected_title')}</Text>
            <Text className="text-base text-foreground">{saved.status === 'pending' ? t('event_communications:recovery_description') : m('rejected_hint')}</Text>
            <Text className="text-base text-foreground">{describe(saved.intent)}</Text>
            {saved.status === 'pending' ? <Button disabled={!permitted || operation.busy} onPress={operation.recover}>{t('event_communications:recovery_button')}</Button>
              : <Button variant="danger" disabled={!permitted || operation.busy} onPress={() => confirm({ title: m('discard_title'), message: m('discard_hint'), confirmLabel: m('discard_label'), cancelLabel: s('actions.cancel'), variant: 'danger', onConfirm: async () => { await operation.discard(); state.refresh(); } })}>{m('discard_label')}</Button>}
          </Card.Body></Card>}
          {operation.operationFailed && <Text accessibilityRole="alert" className="text-base text-foreground">{m('action_error')}</Text>}

          <Card><Card.Body className="gap-3 p-4">
            <Text className="text-base text-muted-foreground">{s('organizer.description')}</Text>
            <Text className="text-base text-foreground">{s(`rollout.${safety.rollout.mode}`)}{requirements ? ` · ${s(`requirements.status.${requirements.status}`)}` : ''}</Text>
            {requirements && <Text className="text-sm text-muted-foreground">{m('policy_revision', { revision: requirements.revision, version: requirements.current_version })}</Text>}
            {!safety.rollout.configuration_valid && <Text accessibilityRole="alert" className="text-base text-foreground">{s('organizer.configuration_invalid')}</Text>}
            {safety.rollout.mode === 'shadow' && <><Text className="text-base font-bold text-foreground">{s('organizer.shadow_title')}</Text><Text className="text-base text-foreground">{s('organizer.shadow_description')}</Text></>}
          </Card.Body></Card>

          <Card><Card.Body className="gap-4 p-4">
            <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{s('requirements.title')}</Text>
            <Text className="text-base text-muted-foreground">{s('requirements.description')}</Text>
            {!requirements && <Text className="text-base text-foreground">{m('no_requirements')}</Text>}
            {requirements?.status === 'archived' && <Text className="text-base text-foreground">{m('archived_notice')}</Text>}
            {!canManage && <Text className="text-base text-foreground">{s('organizer.read_only')}</Text>}
            <Input label={s('requirements.minimum_age')} helper={s('requirements.minimum_age_hint')} keyboardType="number-pad" value={form.minimumAge} editable={canEdit && !blocked}
              onChangeText={value => update({ minimumAge: value })} error={submitted && minimumInvalid ? m('invalid_age') : undefined} />
            <Toggle label={s('requirements.guardian_required')} value={form.guardian} disabled={!canEdit || blocked} onValueChange={value => update({ guardian: value })} />
            <Text className="text-sm text-muted-foreground">{s('requirements.guardian_required_hint')}</Text>
            {form.guardian && <Input label={s('requirements.minor_threshold')} helper={s('requirements.minor_threshold_hint')} keyboardType="number-pad" value={form.threshold} editable={canEdit && !blocked}
              onChangeText={value => update({ threshold: value })} error={submitted && thresholdInvalid ? m('invalid_age') : undefined} />}
            <Toggle label={s('requirements.code_required')} value={form.codeRequired} disabled={!canEdit || blocked} onValueChange={value => update({ codeRequired: value })} />
            <Text className="text-sm text-muted-foreground">{s('requirements.code_required_hint')}</Text>
            {form.codeRequired && <>
              <Input label={s('requirements.code_version')} helper={s('requirements.code_version_hint')} value={form.codeVersion} editable={canEdit && !blocked} maxLength={64}
                onChangeText={value => update({ codeVersion: value })} error={submitted && codeInvalid && !form.codeVersion.trim() ? s('requirements.code_version_hint') : undefined} />
              <TextArea label={s('requirements.code_text')} placeholder={s('requirements.code_text_hint')} value={form.codeText} editable={canEdit && !blocked}
                onChangeText={value => update({ codeText: value })} error={submitted && codeInvalid && !form.codeText.trim() ? s('requirements.code_text_hint') : undefined} />
            </>}
            {canManage && <>
              {!archived && <Button disabled={blocked} isLoading={operation.busy} onPress={saveDraft}>{s('actions.save_draft')}</Button>}
              {requirements?.status === 'draft' && <Button variant="secondary" disabled={blocked || formDirty} onPress={publish}>{s('actions.publish')}</Button>}
              {requirements && requirements.status !== 'archived' && <Button variant="danger" disabled={blocked} onPress={archive}>{s('actions.archive')}</Button>}
            </>}
          </Card.Body></Card>

          {canReview && reviews && <>
            <Card><Card.Body className="gap-4 p-4">
              <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{s('reviews.title')}</Text>
              <Text className="text-base text-muted-foreground">{s('reviews.description')}</Text>
              <Text className="text-sm text-muted-foreground">{s('reviews.no_notes_notice')}</Text>
              <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{s(expectedVersion === null ? 'reviews.new_title' : 'reviews.edit_title')}</Text>
              {subject ? <>
                <Text className="text-base text-foreground">{subject.name}</Text>
                {expectedVersion === null && <Button variant="ghost" disabled={blocked} onPress={() => { setSubject(null); setQuery(''); }}>{s('actions.change_member')}</Button>}
              </> : <>
                <Input label={s('reviews.member_label')} accessibilityLabel={s('reviews.member_label')} helper={s('reviews.member_hint')} value={query} onChangeText={setQuery} editable={!blocked} />
                {searchState === 'loading' && <Text accessibilityLiveRegion="polite">{m('searching')}</Text>}
                {searchState === 'error' && <Text accessibilityRole="alert">{s('reviews.member_search_error')}</Text>}
                {searchState === 'success' && results.length === 0 && <Text>{m('no_results')}</Text>}
                {results.map(member => <Button key={member.id} variant="secondary" disabled={blocked} accessibilityLabel={m('select_member', { name: memberName(member) })}
                  onPress={() => { setSubject({ id: member.id, name: memberName(member) }); setResults([]); setSearchState('idle'); }}>{memberName(member)}</Button>)}
              </>}
              <Text accessibilityRole="header" className="text-base font-bold text-foreground">{s('reviews.decision_label')}</Text>
              {safetyReviewDecisions.map(value => radio(value, decision, s(`decisions.${value}`), setDecision))}
              <Text accessibilityRole="header" className="text-base font-bold text-foreground">{s('reviews.reason_label')}</Text>
              {safetyReviewReasons.map(value => radio(value, reason, t(`safety.reasons.${value}`), setReason))}
              <Text className="text-base font-bold text-foreground">{s('reviews.effective_from')}</Text>
              <Text className="text-base text-foreground">{timestamp(from.toISOString())}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" disabled={blocked} onPress={() => setPicker({ field: 'from', mode: 'date' })}>{m('change_date')}</Button>
                <Button variant="secondary" disabled={blocked} onPress={() => setPicker({ field: 'from', mode: 'time' })}>{m('change_time')}</Button>
              </View>
              <Text className="text-base font-bold text-foreground">{s('reviews.effective_until')}</Text>
              <Text className="text-base text-foreground">{until ? timestamp(until.toISOString()) : m('clear_until')}</Text>
              <Text className="text-sm text-muted-foreground">{s('reviews.effective_until_hint')}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" disabled={blocked} onPress={() => setPicker({ field: 'until', mode: 'date' })}>{until ? m('change_date') : m('set_until')}</Button>
                {until && <Button variant="secondary" disabled={blocked} onPress={() => setPicker({ field: 'until', mode: 'time' })}>{m('change_time')}</Button>}
                {until && <Button variant="ghost" disabled={blocked} onPress={() => { setUntil(null); setUntilError(false); }}>{m('clear_until')}</Button>}
              </View>
              <Text className="text-sm text-muted-foreground">{m('timezone', { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}</Text>
              {untilError && <Text accessibilityRole="alert">{m('until_invalid')}</Text>}
              {picker && permitted && <><DateTimePicker value={(picker.field === 'from' ? from : until) ?? new Date(from.getTime() + 86400000)} mode={picker.mode}
                onChange={(event, date) => {
                  if (Platform.OS !== 'ios') setPicker(null);
                  if (event.type !== 'set' || !date || !authority.current.permitted) return;
                  if (picker.field === 'from') setFrom(date); else setUntil(date);
                  setUntilError(false);
                }} />
                {Platform.OS === 'ios' && <Button variant="ghost" onPress={() => setPicker(null)}>{t('common:buttons.done')}</Button>}</>}
              <Button disabled={blocked || !subject} isLoading={operation.busy} onPress={saveReview}>{s('actions.save_review')}</Button>
              {(subject || expectedVersion !== null) && <Button variant="ghost" disabled={blocked} onPress={clearReview}>{s('actions.cancel_edit')}</Button>}
            </Card.Body></Card>

            <Text accessibilityRole="header" className="text-xl font-bold text-foreground">{s('reviews.history_title')}</Text>
            <Text className="text-base text-muted-foreground">{m('review_total', { count: reviews.total })}</Text>
            {reviews.items.length === 0 && <EmptyState icon="shield-checkmark-outline" title={s('reviews.empty')} />}
            {reviews.items.map(item => <Card key={item.denial.id}><Card.Body className="gap-2 p-4">
              <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{item.member.display_name} · {m('member_fallback', { id: item.member.id })}</Text>
              <Text className="text-base text-foreground">{s(`decisions.${item.denial.decision}`)} · {s(`review_status.${item.denial.status}`)}</Text>
              <Text className="text-base text-foreground">{t(`safety.reasons.${item.denial.reason_code}`)}</Text>
              <Text>{s('reviews.version')}: {item.denial.decision_version}</Text>
              <Text>{s('reviews.effective_from')}: {timestamp(item.denial.effective_from)}</Text>
              <Text>{s('reviews.effective_until')}: {item.denial.effective_until ? timestamp(item.denial.effective_until) : m('clear_until')}</Text>
              <Text>{s('reviews.reviewed_by')}: {item.reviewer.display_name} · {timestamp(item.denial.reviewed_at)}</Text>
              {item.denial.status === 'active' && <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" disabled={blocked} onPress={() => editReview(item)}>{s('actions.edit_review')}</Button>
                <Button variant="danger" disabled={blocked} onPress={() => withdrawReview(item)}>{s('actions.withdraw_review')}</Button>
              </View>}
              <Text accessibilityRole="header" className="font-bold">{m('audit_count', { count: item.history.length })}</Text>
              {item.history.map(entry => <View key={`${entry.decision_version}-${entry.action}-${entry.reviewed_at}`} className="gap-1 border-t border-border pt-2">
                <Text>{s('reviews.version')} {entry.decision_version} · {s(`review_status.${entry.status}`)} · {s(`decisions.${entry.decision}`)}</Text>
                <Text className="text-sm text-muted-foreground">{entry.reviewer.display_name} · {timestamp(entry.reviewed_at)}</Text>
              </View>)}
            </Card.Body></Card>)}
            {pages > 1 && <View className="gap-2">
              <Text className="text-base text-foreground" accessibilityLiveRegion="polite">{m('page_status', { page: reviews.page, pages })}</Text>
              <View className="flex-row flex-wrap gap-2">
                <Button variant="secondary" disabled={page <= 1 || state.isLoading} onPress={() => setPage(value => Math.max(1, value - 1))}>{m('previous_page')}</Button>
                <Button variant="secondary" disabled={page >= pages || state.isLoading} onPress={() => setPage(value => value + 1)}>{m('next_page')}</Button>
              </View>
            </View>}
          </>}
        </>}
    </ScrollView>
    </KeyboardAvoidingView>
    {confirmDialog}
  </SafeAreaView>;
}
export default withRouteGate(EventSafetyScreen, 'event-safety');
