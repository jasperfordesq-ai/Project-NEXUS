// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { createIdeationChallenge, getIdeationChallenge, updateIdeationChallenge, type IdeationStatus } from '@/lib/api/ideation';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type ChallengeCreateStatus = Extract<IdeationStatus, 'draft' | 'open'>;

function normalizeDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace('T', ' ');
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;

  const [datePart = '', timePart = ''] = normalized.split(' ');
  const [hour = '00', minute = '00'] = timePart.split(':');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return `${datePart} ${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00`;
}

export default function NewChallengeRoute() {
  return (
    <ModalErrorBoundary>
      <NewChallengeScreen />
    </ModalErrorBoundary>
  );
}

function NewChallengeScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { hasFeature } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { id, mode } = useLocalSearchParams<{ id?: string; mode?: string }>();
  const challengeId = Number(id ?? 0);
  const isEdit = mode === 'edit' && challengeId > 0;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [prizeDescription, setPrizeDescription] = useState('');
  const [submissionDeadline, setSubmissionDeadline] = useState('');
  const [votingDeadline, setVotingDeadline] = useState('');
  const [maxIdeasPerUser, setMaxIdeasPerUser] = useState('');
  const [status, setStatus] = useState<ChallengeCreateStatus>('open');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(isEdit);

  useEffect(() => {
    if (!isEdit) return;
    let active = true;
    setIsLoading(true);
    void getIdeationChallenge(challengeId)
      .then((challenge) => {
        if (!active) return;
        setTitle(challenge.title ?? '');
        setDescription(challenge.description ?? '');
        setCategory(challenge.category ?? '');
        setPrizeDescription(challenge.prize_description ?? '');
        setSubmissionDeadline(challenge.submission_deadline?.slice(0, 16).replace('T', ' ') ?? '');
        setVotingDeadline(challenge.voting_deadline?.slice(0, 16).replace('T', ' ') ?? '');
        setMaxIdeasPerUser(challenge.max_ideas_per_user == null ? '' : String(challenge.max_ideas_per_user));
      })
      .catch((error) => {
        if (active) showToast({ title: t('ideation:challenges.load_error'), description: error instanceof Error ? error.message : t('ideation:toast.error_generic'), variant: 'danger' });
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [challengeId, isEdit, showToast, t]);

  if (!hasFeature('ideation_challenges')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('ideation:create.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation' as Href} />
        <View className="px-4 py-8" style={{ flex: 1, backgroundColor: theme.bg }}>
          <EmptyState icon="bulb-outline" title={t('ideation:disabledTitle')} subtitle={t('ideation:disabledSubtitle')} />
        </View>
      </SafeAreaView>
    );
  }

  async function submit() {
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription) {
      showToast({ title: t('ideation:create.validationTitle'), description: t('ideation:create.validationRequired'), variant: 'warning' });
      return;
    }

    const submissionDate = normalizeDateTime(submissionDeadline);
    const votingDate = normalizeDateTime(votingDeadline);
    if ((submissionDeadline.trim() && !submissionDate) || (votingDeadline.trim() && !votingDate)) {
      showToast({ title: t('ideation:create.validationTitle'), description: t('ideation:create.validationDates'), variant: 'warning' });
      return;
    }

    const maxIdeas = maxIdeasPerUser.trim() ? Number(maxIdeasPerUser.trim()) : null;
    if (maxIdeas !== null && (!Number.isInteger(maxIdeas) || maxIdeas < 1 || maxIdeas > 50)) {
      showToast({ title: t('ideation:create.validationTitle'), description: t('ideation:create.validationMaxIdeas'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    let successDestination: Parameters<typeof router.push>[0] | null = null;
    try {
      const payload = {
        title: trimmedTitle,
        description: trimmedDescription,
        category: category.trim() || null,
        submission_deadline: submissionDate,
        voting_deadline: votingDate,
        prize_description: prizeDescription.trim() || null,
        max_ideas_per_user: maxIdeas,
      };
      const challenge = isEdit
        ? await updateIdeationChallenge(challengeId, payload)
        : await createIdeationChallenge({ ...payload, status });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (challenge.id) {
        successDestination = { pathname: '/(modals)/ideation-detail', params: { id: String(challenge.id) } };
      } else {
        successDestination = '/(modals)/ideation' as Href;
      }
    } catch (error) {
      showToast({ title: t('ideation:create.failedTitle'), description: error instanceof Error ? error.message : t('ideation:create.failedDescription'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }

    if (successDestination) {
      setTimeout(() => {
        if (typeof router.push === 'function') router.push(successDestination);
        else router.replace(successDestination);
      }, 0);
    }
  }

  return (
    <SafeAreaView testID="new-challenge-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={isEdit ? t('ideation:edit_page.title') : t('ideation:create.title')} backLabel={t('common:back')} fallbackHref={isEdit ? ({ pathname: '/(modals)/ideation-detail', params: { id: String(challengeId) } } as unknown as Href) : ('/(modals)/ideation' as Href)} />
      {isLoading ? <View className="flex-1 items-center justify-center"><LoadingSpinner /></View> : (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          testID="new-challenge-scroll"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, gap: 14, padding: 16, paddingBottom: 120, backgroundColor: theme.bg }}
          keyboardShouldPersistTaps="handled"
        >
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="bulb-outline" size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-xs font-semibold uppercase text-muted-foreground">
                    {isEdit ? t('ideation:edit_page.page_title') : t('ideation:create.eyebrow')}
                  </Text>
                  <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {isEdit ? t('ideation:edit_page.title') : t('ideation:create.title')}
                  </Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('ideation:create.subtitle')}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary" className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <Input
                label={t('ideation:create.titleLabel')}
                value={title}
                onChangeText={setTitle}
                placeholder={t('ideation:create.titlePlaceholder')}
              />
              <Input
                label={t('ideation:create.descriptionLabel')}
                value={description}
                onChangeText={setDescription}
                placeholder={t('ideation:create.descriptionPlaceholder')}
                multiline
                numberOfLines={6}
              />
              <Input
                label={t('ideation:create.categoryLabel')}
                value={category}
                onChangeText={setCategory}
                placeholder={t('ideation:create.categoryPlaceholder')}
              />
              {!isEdit ? <View className="gap-2">
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                  {t('ideation:create.statusLabel')}
                </Text>
                <View className="flex-row gap-2">
                  {(['open', 'draft'] as ChallengeCreateStatus[]).map((item) => (
                    <HeroButton
                      key={item}
                      className="flex-1"
                      variant={status === item ? 'primary' : 'secondary'}
                      onPress={() => setStatus(item)}
                      accessibilityLabel={t(`ideation:create.status.${item}`)}
                    >
                      <Ionicons
                        name={item === 'open' ? 'radio-button-on-outline' : 'document-text-outline'}
                        size={16}
                        color={status === item ? theme.onPrimary : primary}
                      />
                      <HeroButton.Label>{t(`ideation:create.status.${item}`)}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              </View> : null}
              <Input
                label={t('ideation:create.submissionDeadlineLabel')}
                value={submissionDeadline}
                onChangeText={setSubmissionDeadline}
                placeholder={t('ideation:create.deadlinePlaceholder')}
              />
              <Input
                label={t('ideation:create.votingDeadlineLabel')}
                value={votingDeadline}
                onChangeText={setVotingDeadline}
                placeholder={t('ideation:create.deadlinePlaceholder')}
              />
              <Input
                label={t('ideation:create.maxIdeasLabel')}
                value={maxIdeasPerUser}
                onChangeText={setMaxIdeasPerUser}
                placeholder={t('ideation:create.maxIdeasPlaceholder')}
                keyboardType="number-pad"
              />
              <Input
                label={t('ideation:create.prizeLabel')}
                value={prizeDescription}
                onChangeText={setPrizeDescription}
                placeholder={t('ideation:create.prizePlaceholder')}
              />
            </HeroCard.Body>
          </HeroCard>

          <HeroCard variant="secondary" className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center gap-2">
                <Ionicons name="checkmark-circle-outline" size={18} color={primary} />
                <Text className="text-base font-bold" style={{ color: theme.text }}>
                  {t('ideation:create.reviewTitle')}
                </Text>
              </View>
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`ideation:create.status.${status}`)}</Chip.Label>
                </Chip>
                {category.trim() ? (
                  <Chip size="sm" variant="soft" color="default">
                    <Chip.Label>{category.trim()}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('ideation:create.reviewSubtitle')}
              </Text>
            </HeroCard.Body>
          </HeroCard>
        </ScrollView>
        <FormActionFooter
          title={t('ideation:create.footerTitle')}
          subtitle={t('ideation:create.footerSubtitle')}
          submitLabel={isSubmitting ? (isEdit ? t('ideation:form.updating') : t('ideation:create.saving')) : (isEdit ? t('ideation:form.update') : t('ideation:create.submit'))}
          secondaryLabel={t('common:buttons.cancel')}
          icon="checkmark-outline"
          primary={primary}
          isSubmitting={isSubmitting}
          onSubmit={() => void submit()}
          onSecondary={() => router.back()}
        />
      </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}
