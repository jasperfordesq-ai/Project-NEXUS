// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { useConfirm } from '@/components/ui/useConfirm';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import {
  createGroupExchange,
  previewGroupExchange,
  type CreateGroupExchangePayload,
  type GroupExchange,
  type GroupExchangePreview,
  type PreviewGroupExchangePayload,
} from '@/lib/api/groupExchanges';
import { getMembers, type Member } from '@/lib/api/members';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeGroupExchangeCreationOperation,
  reserveGroupExchangeCreationOperation,
} from '@/lib/groupExchangeCreationOperation';

import { parseDecimalInput } from '@/lib/utils/decimal';
import { withRouteGate } from '@/components/withRouteGate';

type Kind = GroupExchange['split_type'];
/** The five kinds, in the order members see them. A new form starts on the first. */
const kinds: Kind[] = ['workshop', 'team', 'equal', 'weighted', 'custom'];

/** A short pause in typing before the server is asked what everyone will earn or pay. */
const PREVIEW_DELAY_MS = 300;

type ParticipantDraft = {
  user_id: number;
  name: string;
  avatar: string | null;
  role: 'provider' | 'receiver';
  hours: string;
  weight: string;
};

function memberName(member: Member) {
  return member.name || [member.first_name, member.last_name].filter(Boolean).join(' ') || String(member.id);
}

/**
 * Does this kind take the person's own hours? A workshop and a custom exchange do for everyone;
 * a team does for the helpers only (the person helped shares the cost and types nothing);
 * equal and weighted share one total and need no hours at all.
 */
function takesOwnHours(kind: Kind, role: ParticipantDraft['role']): boolean {
  if (kind === 'workshop' || kind === 'custom') return true;
  return kind === 'team' && role === 'provider';
}

/** Does the number typed above the people stand in for each person's hours until they change it? */
function fillsInHours(kind: Kind): boolean {
  return kind === 'workshop' || kind === 'team';
}

function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

type SignedInUser = NonNullable<ReturnType<typeof useAuth>['user']>;

/**
 * The signed-in user shaped as a participant draft. `LoginUser` (the shape cached straight
 * after sign-in) has no computed `name`, so the name falls back to first + last.
 */
function selfAsParticipant(user: SignedInUser, role: ParticipantDraft['role']): ParticipantDraft {
  const name = ('name' in user && user.name) || [user.first_name, user.last_name].filter(Boolean).join(' ') || String(user.id);
  return { user_id: user.id, name, avatar: user.avatar_url ?? null, role, hours: '', weight: '1' };
}

function NewGroupExchangeRoute() {
  return (
    <ModalErrorBoundary>
      <NewGroupExchangeScreen />
    </ModalErrorBoundary>
  );
}

function NewGroupExchangeScreen() {
  const submittingRef = useRef(false);
  const memberSearchRequestRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const { t } = useTranslation(['exchanges', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  // One number, whose meaning follows the kind: the session length (workshop), the hours each
  // helper spent (team) or the total to share (equal, weighted). A custom exchange has none.
  const [amount, setAmount] = useState('');
  const [kind, setKind] = useState<Kind>('workshop');
  const [participantQuery, setParticipantQuery] = useState('');
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  // What the server said about the numbers on the form. It is only trusted for the exact request
  // it answered: change a figure and it is stale until the next answer arrives.
  const [preview, setPreview] = useState<{ key: string; data: GroupExchangePreview } | null>(null);
  const [previewFailedKey, setPreviewFailedKey] = useState<string | null>(null);
  const latestPreviewKeyRef = useRef('');
  const { confirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard({
    isDirty: Boolean(title.trim() || description.trim() || amount.trim() || participants.length > 0),
    isSaving: isSubmitting,
    hasSaved: hasSubmitted,
    confirm,
    title: t('common:unsavedChanges.title'),
    message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  // parseDecimalInput, not parseFloat: parseFloat('1,5') is 1 — silently the wrong
  // number of hours for a comma-locale member (audit 2026-09-05, F06).
  const parsedAmount = useMemo(() => parseDecimalInput(amount) ?? Number.NaN, [amount]);
  const selectedIds = useMemo(() => new Set(participants.map((participant) => participant.user_id)), [participants]);
  const providerCount = participants.filter((participant) => participant.role === 'provider').length;
  const receiverCount = participants.filter((participant) => participant.role === 'receiver').length;

  /*
    The request the server is asked about, and the one sent on create, are built from the same
    place, so what is previewed is exactly what is saved. No split is worked out here: the server
    does the arithmetic for every kind.
  */
  const splitRequest = useMemo<PreviewGroupExchangePayload>(() => {
    const people = participants.map((participant) => ({
      user_id: participant.user_id,
      role: participant.role,
      hours: takesOwnHours(kind, participant.role) ? (parseDecimalInput(participant.hours) ?? 0) : 0,
      weight: kind === 'weighted' ? (parseDecimalInput(participant.weight) ?? 1) : 1,
    }));
    // A custom exchange has no typed total: the total is what the people giving time earn.
    const total = kind === 'custom'
      ? roundHours(people.filter((person) => person.role === 'provider').reduce((sum, person) => sum + person.hours, 0))
      : (Number.isFinite(parsedAmount) ? parsedAmount : 0);
    return { split_type: kind, total_hours: total, participants: people };
  }, [kind, participants, parsedAmount]);
  const splitRequestKey = JSON.stringify(splitRequest);
  latestPreviewKeyRef.current = splitRequestKey;

  useEffect(() => {
    // Nobody added yet: nothing to work out, and Create stays off until someone is.
    if (splitRequest.participants.length === 0) return undefined;
    const key = splitRequestKey;
    const timer = setTimeout(() => {
      previewGroupExchange(splitRequest)
        .then((response) => {
          if (!mountedRef.current || latestPreviewKeyRef.current !== key) return;
          setPreviewFailedKey(null);
          setPreview({ key, data: response.data });
        })
        .catch(() => {
          if (!mountedRef.current || latestPreviewKeyRef.current !== key) return;
          setPreviewFailedKey(key);
        });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // splitRequestKey is the serialised splitRequest, so it covers every field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitRequestKey]);

  const currentPreview = preview && preview.key === splitRequestKey ? preview.data : null;
  const previewFailed = previewFailedKey === splitRequestKey;
  const previewProblem = currentPreview?.problem ?? null;
  const canSubmit = title.trim().length >= 3
    && splitRequest.participants.length > 0
    && splitRequest.total_hours > 0
    && currentPreview !== null
    && previewProblem === null
    && !isSubmitting;

  async function searchMembers() {
    const requestId = ++memberSearchRequestRef.current;
    const query = participantQuery.trim();
    if (query.length < 2) {
      setMemberResults([]);
      setIsSearching(false);
      return;
    }
    try {
      setIsSearching(true);
      const response = await getMembers(0, query);
      if (!mountedRef.current || requestId !== memberSearchRequestRef.current) return;
      setMemberResults((response.data ?? []).filter((member) => !selectedIds.has(member.id)));
    } catch (err) {
      if (!mountedRef.current || requestId !== memberSearchRequestRef.current) return;
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('groupExchanges.create.searchError')), variant: 'danger' });
    } finally {
      if (mountedRef.current && requestId === memberSearchRequestRef.current) setIsSearching(false);
    }
  }

  function changeParticipantQuery(value: string) {
    memberSearchRequestRef.current += 1;
    setParticipantQuery(value);
    setMemberResults([]);
    setIsSearching(false);
  }

  /** A workshop's session length or a team's hours per helper is filled in for each person added. */
  function startingHours(role: ParticipantDraft['role'], forKind: Kind = kind, figure: string = amount): string {
    return fillsInHours(forKind) && takesOwnHours(forKind, role) && (parseDecimalInput(figure) ?? 0) > 0 ? figure : '';
  }

  /**
   * The figure above the people moves everyone who is still on the old figure (or on nothing), and
   * leaves anyone whose hours were changed by hand.
   */
  function changeAmount(value: string) {
    const previous = amount;
    setAmount(value);
    if (!fillsInHours(kind)) return;
    setParticipants((current) => current.map((participant) => (
      takesOwnHours(kind, participant.role) && (participant.hours === previous || participant.hours.trim() === '')
        ? { ...participant, hours: value }
        : participant
    )));
  }

  /** Switching kind keeps every person and every figure typed; it only fills hours that are empty. */
  function changeKind(next: Kind) {
    if (next === kind) return;
    setKind(next);
    if (!fillsInHours(next)) return;
    setParticipants((current) => current.map((participant) => (
      participant.hours.trim() === '' && takesOwnHours(next, participant.role)
        ? { ...participant, hours: startingHours(participant.role, next) }
        : participant
    )));
  }

  function addParticipant(member: Member, role: ParticipantDraft['role']) {
    if (selectedIds.has(member.id)) return;
    setParticipants((current) => [
      ...current,
      {
        user_id: member.id,
        name: memberName(member),
        avatar: member.avatar_url ?? member.avatar ?? null,
        role,
        hours: startingHours(role),
        weight: '1',
      },
    ]);
    setMemberResults((current) => current.filter((result) => result.id !== member.id));
  }

  function addSelf(role: ParticipantDraft['role']) {
    if (!user?.id || selectedIds.has(user.id)) return;
    setParticipants((current) => [...current, { ...selfAsParticipant(user, role), hours: startingHours(role) }]);
    setMemberResults((current) => current.filter((result) => result.id !== user.id));
  }

  function updateParticipant(userId: number, values: Partial<Pick<ParticipantDraft, 'hours' | 'weight'>>) {
    setParticipants((current) => current.map((participant) => (
      participant.user_id === userId ? { ...participant, ...values } : participant
    )));
  }

  async function handleSubmit() {
    if (!canSubmit || submittingRef.current || !mountedRef.current) return;
    /*
      🔴 An unparseable participant figure was silently sent as weight 1 (audit 2026-09-07,
      C/F-14), so the weight is checked here. An unparseable or empty number of hours is sent as 0
      and the server refuses it by name in the preview, which keeps Create switched off.
    */
    if (kind === 'weighted') {
      const bad = participants.find((participant) => !((parseDecimalInput(participant.weight) ?? 0) > 0));
      if (bad) {
        showToast({ title: t('common:errors.alertTitle'), description: t('groupExchanges.create.participantWeightInvalid'), variant: 'warning' });
        return;
      }
    }

    submittingRef.current = true;
    let accepted = false;
    try {
      setIsSubmitting(true);
      const payload: CreateGroupExchangePayload = {
        title: title.trim(),
        description: description.trim() || null,
        split_type: splitRequest.split_type,
        total_hours: splitRequest.total_hours,
        participants: splitRequest.participants,
      };
      const creationOperation = await reserveGroupExchangeCreationOperation(JSON.stringify(payload));
      const response = await createGroupExchange(payload, creationOperation.key);
      await completeGroupExchangeCreationOperation(creationOperation);
      accepted = true;
      if (!mountedRef.current) return;
      const id = response.data?.id;
      if (id) {
        setHasSubmitted(true);
        router.replace({ pathname: '/(modals)/group-exchange-detail', params: { id: String(id) } } as unknown as Href);
        return;
      }
      setHasSubmitted(true);
      router.replace('/(modals)/group-exchanges' as Href);
    } catch (err) {
      if (!mountedRef.current) return;
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('groupExchanges.create.error')), variant: 'danger' });
    } finally {
      if (!accepted) submittingRef.current = false;
      if (mountedRef.current) setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('groupExchanges.create.title')} backLabel={t('common:buttons.back')} fallbackHref={'/(modals)/group-exchanges' as Href} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-center gap-3">
              <View className="size-12 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="git-compare-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('groupExchanges.create.eyebrow')}
                </Text>
                <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                  {t('groupExchanges.create.title')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('groupExchanges.create.subtitle')}
                </Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel">
          <HeroCard.Body className="gap-4 p-4">
            <Input
              label={t('groupExchanges.create.fields.title')}
              value={title}
              onChangeText={setTitle}
              placeholder={t('groupExchanges.create.placeholders.title')}
              autoCapitalize="sentences"
              returnKeyType="next"
            />
            <Input
              label={t('groupExchanges.create.fields.description')}
              value={description}
              onChangeText={setDescription}
              placeholder={t('groupExchanges.create.placeholders.description')}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              style={{ minHeight: 96 }}
            />
            <View className="gap-2" accessibilityRole="radiogroup">
              <Text className="text-sm font-semibold" style={{ color: theme.text }} accessibilityRole="header">
                {t('groupExchanges.create.kinds.heading')}
              </Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('groupExchanges.create.kinds.rule')}
              </Text>
              {kinds.map((value) => {
                const selected = kind === value;
                return (
                  <NativePressable
                    key={value}
                    className="w-full p-0"
                    accessibilityRole="radio"
                    accessibilityState={{ selected, checked: selected }}
                    accessibilityLabel={`${t(`groupExchanges.split.${value}`)}. ${t(`groupExchanges.create.kinds.descriptions.${value}`)}`}
                    onPress={() => changeKind(value)}
                    feedback="highlight"
                  >
                    <View
                      className="gap-1 rounded-panel-inner border-2 p-3"
                      style={{
                        borderColor: selected ? primary : theme.border,
                        backgroundColor: selected ? withAlpha(primary, 0.1) : undefined,
                      }}
                    >
                      <View className="flex-row items-center gap-2">
                        <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? primary : theme.textSecondary} />
                        <Text className="flex-1 text-base font-semibold" style={{ color: theme.text }}>
                          {t(`groupExchanges.split.${value}`)}
                        </Text>
                      </View>
                      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {t(`groupExchanges.create.kinds.descriptions.${value}`)}
                      </Text>
                      <Text className="text-sm italic leading-5" style={{ color: theme.textSecondary }}>
                        {t(`groupExchanges.create.kinds.examples.${value}`)}
                      </Text>
                    </View>
                  </NativePressable>
                );
              })}
            </View>

            {kind === 'workshop' ? (
              <Input
                label={t('groupExchanges.create.inputs.sessionHours')}
                helper={t('groupExchanges.create.inputs.sessionHoursHint')}
                value={amount}
                onChangeText={changeAmount}
                placeholder={t('groupExchanges.create.placeholders.totalHours')}
                keyboardType="decimal-pad"
              />
            ) : null}
            {kind === 'team' ? (
              <Input
                label={t('groupExchanges.create.inputs.teamHours')}
                helper={t('groupExchanges.create.inputs.teamHoursHint')}
                value={amount}
                onChangeText={changeAmount}
                placeholder={t('groupExchanges.create.placeholders.totalHours')}
                keyboardType="decimal-pad"
              />
            ) : null}
            {kind === 'equal' || kind === 'weighted' ? (
              <Input
                label={t('groupExchanges.create.fields.totalHours')}
                value={amount}
                onChangeText={changeAmount}
                placeholder={t('groupExchanges.create.placeholders.totalHours')}
                keyboardType="decimal-pad"
              />
            ) : null}

            <View className="gap-3">
              <View>
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                  {t('groupExchanges.create.participantsTitle')}
                </Text>
                <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('groupExchanges.create.participantsDescription')}
                </Text>
              </View>
              <View className="gap-2 rounded-panel-inner bg-surface-secondary p-3">
                <Input
                  label={t('groupExchanges.create.fields.memberSearch')}
                  value={participantQuery}
                  onChangeText={changeParticipantQuery}
                  placeholder={t('groupExchanges.create.placeholders.memberSearch')}
                  returnKeyType="search"
                  onSubmitEditing={searchMembers}
                />
                <HeroButton variant="secondary" onPress={searchMembers} isDisabled={participantQuery.trim().length < 2 || isSearching}>
                  <HeroButton.Label>{isSearching ? t('groupExchanges.create.searching') : t('groupExchanges.create.searchMembers')}</HeroButton.Label>
                </HeroButton>
                {memberResults.map((member) => (
                  <View key={member.id} className="gap-2 rounded-panel-inner bg-background p-3">
                    <Text className="font-semibold" style={{ color: theme.text }}>
                      {memberName(member)}
                    </Text>
                    {member.location ? (
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {member.location}
                      </Text>
                    ) : null}
                    <View className="flex-row gap-2">
                      <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => addParticipant(member, 'provider')}>
                        <HeroButton.Label>{t('groupExchanges.create.addProvider')}</HeroButton.Label>
                      </HeroButton>
                      <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => addParticipant(member, 'receiver')}>
                        <HeroButton.Label>{t('groupExchanges.create.addReceiver')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  </View>
                ))}
              </View>

              {/*
                The member directory (/v2/users) never returns the viewer, so an organiser who
                is also taking part (a workshop leader delivering the session, say) could not
                add themselves at all. The API accepts the organiser as a participant, so offer
                it explicitly. Mirrors the web app's CreateGroupExchangePage.
              */}
              {user?.id && !selectedIds.has(user.id) ? (
                <View className="gap-2 rounded-panel-inner bg-surface-secondary p-3">
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>
                    {t('groupExchanges.create.addYourself')}
                  </Text>
                  <View className="flex-row gap-2">
                    <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => addSelf('provider')}>
                      <HeroButton.Label>{t('groupExchanges.detail.roles.provider')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => addSelf('receiver')}>
                      <HeroButton.Label>{t('groupExchanges.detail.roles.receiver')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </View>
              ) : null}

              {participants.length > 0 ? (
                <View className="gap-2">
                  <View className="flex-row flex-wrap gap-2">
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{t('groupExchanges.create.providers', { count: providerCount })}</Chip.Label>
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{t('groupExchanges.create.receivers', { count: receiverCount })}</Chip.Label>
                    </Chip>
                  </View>
                  {participants.map((participant) => (
                    <View key={participant.user_id} className="gap-3 rounded-panel-inner bg-surface-secondary p-3">
                      <View className="flex-row items-center gap-2">
                        <View className="min-w-0 flex-1">
                          <Text className="font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                            {participant.name}
                          </Text>
                          <Text className="text-xs" style={{ color: theme.textSecondary }}>
                            {t(`groupExchanges.detail.roles.${participant.role}`)}
                          </Text>
                        </View>
                        <HeroButton
                          size="sm"
                          variant="secondary"
                          onPress={() => setParticipants((current) => current.filter((item) => item.user_id !== participant.user_id))}
                          accessibilityLabel={t('groupExchanges.create.removeParticipant', { name: participant.name })}
                        >
                          <HeroButton.Label>{t('groupExchanges.create.remove')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                      {takesOwnHours(kind, participant.role) ? (
                        <Input
                          label={t('groupExchanges.create.fields.participantHours')}
                          accessibilityLabel={t('groupExchanges.create.inputs.hoursFor', { name: participant.name })}
                          value={participant.hours}
                          onChangeText={(value) => updateParticipant(participant.user_id, { hours: value })}
                          placeholder={t('groupExchanges.create.placeholders.participantHours')}
                          keyboardType="decimal-pad"
                        />
                      ) : null}
                      {kind === 'weighted' ? (
                        <Input
                          label={t('groupExchanges.create.inputs.weight', { name: participant.name })}
                          helper={t('groupExchanges.create.inputs.weightHint')}
                          value={participant.weight}
                          onChangeText={(value) => updateParticipant(participant.user_id, { weight: value })}
                          placeholder={t('groupExchanges.create.placeholders.participantWeight')}
                          keyboardType="decimal-pad"
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {participants.length > 0 ? (
              <View className="gap-2 rounded-panel-inner bg-surface-secondary p-3" accessibilityLiveRegion="polite">
                <Text className="text-sm font-semibold" style={{ color: theme.text }} accessibilityRole="header">
                  {t('groupExchanges.summary.heading')}
                </Text>
                {previewFailed ? (
                  <Text className="text-sm leading-5" style={{ color: theme.error }}>
                    {t('groupExchanges.summary.error')}
                  </Text>
                ) : currentPreview === null ? (
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('groupExchanges.summary.loading')}
                  </Text>
                ) : (
                  <>
                    {currentPreview.lines.map((line, index) => (
                      <Text key={`${line.user_id}-${line.role}-${index}`} className="text-sm leading-5" style={{ color: theme.text }}>
                        {t(line.role === 'provider' ? 'groupExchanges.summary.earns' : 'groupExchanges.summary.pays', {
                          name: line.name || t('groupExchanges.summary.unknownMember'),
                          count: Number(line.hours),
                        })}
                      </Text>
                    ))}
                    {Number(currentPreview.community_fund_hours) > 0 ? (
                      <Text className="text-sm leading-5" style={{ color: theme.text }}>
                        {t('groupExchanges.summary.fund', { count: Number(currentPreview.community_fund_hours) })}
                      </Text>
                    ) : null}
                    <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>
                      {Number(currentPreview.totals.to_fund) > 0
                        ? t('groupExchanges.summary.totalsWithFund', {
                            paid: t('groupExchanges.hours', { count: Number(currentPreview.totals.paid) }),
                            earned: t('groupExchanges.hours', { count: Number(currentPreview.totals.earned) }),
                            fund: t('groupExchanges.hours', { count: Number(currentPreview.totals.to_fund) }),
                          })
                        : t('groupExchanges.summary.totals', {
                            paid: t('groupExchanges.hours', { count: Number(currentPreview.totals.paid) }),
                            earned: t('groupExchanges.hours', { count: Number(currentPreview.totals.earned) }),
                          })}
                    </Text>
                    {previewProblem ? (
                      <Text className="text-sm font-semibold leading-5" style={{ color: theme.error }} accessibilityRole="alert">
                        {previewProblem.message}
                      </Text>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}

            <HeroButton variant="primary" onPress={handleSubmit} isDisabled={!canSubmit}>
              <HeroButton.Label>{isSubmitting ? t('groupExchanges.create.saving') : t('groupExchanges.create.submit')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

export default withRouteGate(NewGroupExchangeRoute, 'new-group-exchange');
