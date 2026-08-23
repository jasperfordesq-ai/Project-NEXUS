// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { createGroupExchange, type CreateGroupExchangePayload, type GroupExchange } from '@/lib/api/groupExchanges';
import { getMembers, type Member } from '@/lib/api/members';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

const splitTypes: GroupExchange['split_type'][] = ['equal', 'custom', 'weighted'];

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

export default function NewGroupExchangeRoute() {
  return (
    <ModalErrorBoundary>
      <NewGroupExchangeScreen />
    </ModalErrorBoundary>
  );
}

function NewGroupExchangeScreen() {
  const { t } = useTranslation(['exchanges', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [totalHours, setTotalHours] = useState('');
  const [splitType, setSplitType] = useState<GroupExchange['split_type']>('equal');
  const [participantQuery, setParticipantQuery] = useState('');
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const parsedHours = useMemo(() => Number.parseFloat(totalHours), [totalHours]);
  const canSubmit = title.trim().length >= 3 && Number.isFinite(parsedHours) && parsedHours > 0 && !isSubmitting;
  const selectedIds = useMemo(() => new Set(participants.map((participant) => participant.user_id)), [participants]);
  const providerCount = participants.filter((participant) => participant.role === 'provider').length;
  const receiverCount = participants.filter((participant) => participant.role === 'receiver').length;

  async function searchMembers() {
    const query = participantQuery.trim();
    if (query.length < 2) {
      setMemberResults([]);
      return;
    }
    try {
      setIsSearching(true);
      const response = await getMembers(0, query);
      setMemberResults((response.data ?? []).filter((member) => !selectedIds.has(member.id)));
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('groupExchanges.create.searchError'), variant: 'danger' });
    } finally {
      setIsSearching(false);
    }
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
        hours: '',
        weight: '1',
      },
    ]);
    setMemberResults((current) => current.filter((result) => result.id !== member.id));
  }

  function updateParticipant(userId: number, values: Partial<Pick<ParticipantDraft, 'hours' | 'weight'>>) {
    setParticipants((current) => current.map((participant) => (
      participant.user_id === userId ? { ...participant, ...values } : participant
    )));
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    try {
      setIsSubmitting(true);
      const payload: CreateGroupExchangePayload = {
        title: title.trim(),
        description: description.trim() || null,
        split_type: splitType,
        total_hours: parsedHours,
        participants: participants.length > 0
          ? participants.map((participant) => ({
              user_id: participant.user_id,
              role: participant.role,
              hours: Number.parseFloat(participant.hours) || 0,
              weight: Number.parseFloat(participant.weight) || 1,
            }))
          : undefined,
      };
      const response = await createGroupExchange(payload);
      const id = response.data?.id;
      if (id) {
        router.replace({ pathname: '/(modals)/group-exchange-detail', params: { id: String(id) } } as unknown as Href);
        return;
      }
      router.replace('/(modals)/group-exchanges' as Href);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('groupExchanges.create.error'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
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
            <Input
              label={t('groupExchanges.create.fields.totalHours')}
              value={totalHours}
              onChangeText={setTotalHours}
              placeholder={t('groupExchanges.create.placeholders.totalHours')}
              keyboardType="decimal-pad"
            />

            <View className="gap-2">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                {t('groupExchanges.create.fields.splitType')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {splitTypes.map((value) => (
                  <HeroButton
                    key={value}
                    size="sm"
                    variant={splitType === value ? 'primary' : 'secondary'}
                    onPress={() => setSplitType(value)}
                    accessibilityState={{ selected: splitType === value }}
                  >
                    <HeroButton.Label>{t(`groupExchanges.split.${value}`)}</HeroButton.Label>
                  </HeroButton>
                ))}
              </View>
            </View>

            <View className="gap-2 rounded-panel-inner bg-surface-secondary p-3">
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t('groupExchanges.create.summaryHours', { count: Number.isFinite(parsedHours) ? parsedHours : 0 })}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`groupExchanges.split.${splitType}`)}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t('groupExchanges.create.summaryParticipants', { count: participants.length })}</Chip.Label>
                </Chip>
              </View>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('groupExchanges.create.participantNote')}
              </Text>
            </View>

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
                  onChangeText={setParticipantQuery}
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
                      <View className="flex-row gap-2">
                        <Input
                          containerClassName="flex-1"
                          label={t('groupExchanges.create.fields.participantHours')}
                          value={participant.hours}
                          onChangeText={(value) => updateParticipant(participant.user_id, { hours: value })}
                          placeholder={t('groupExchanges.create.placeholders.participantHours')}
                          keyboardType="decimal-pad"
                        />
                        <Input
                          containerClassName="flex-1"
                          label={t('groupExchanges.create.fields.participantWeight')}
                          value={participant.weight}
                          onChangeText={(value) => updateParticipant(participant.user_id, { weight: value })}
                          placeholder={t('groupExchanges.create.placeholders.participantWeight')}
                          keyboardType="decimal-pad"
                        />
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            <HeroButton variant="primary" onPress={handleSubmit} isDisabled={!canSubmit}>
              <HeroButton.Label>{isSubmitting ? t('groupExchanges.create.saving') : t('groupExchanges.create.submit')}</HeroButton.Label>
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
