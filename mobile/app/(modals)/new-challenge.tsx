// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import AccentIcon from '@/components/ui/AccentIcon';
import EmptyState from '@/components/ui/EmptyState';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { createIdeationChallenge, getIdeationChallenge, updateIdeationChallenge, type IdeationStatus } from '@/lib/api/ideation';
import * as Haptics from '@/lib/haptics';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { withAlpha } from '@/lib/utils/color';
import { eventIsoToLocalInput, eventLocalInputToIso, localEventTimeZone } from '@/lib/utils/eventDateTime';

type ChallengeCreateStatus = Extract<IdeationStatus, 'draft' | 'open'>;

/**
 * 🔴 Deadlines are wall-clock times in the member's zone, sent as instants (S4-13).
 *
 * The old code sliced the server's UTC string as if it were local and saved a naive
 * "YYYY-MM-DD HH:mm:00" back, so every save shifted the deadline by the UTC offset —
 * an Irish organiser in summer lost an hour per edit. Both directions now go through the
 * shared helpers: the ISO from the server is rendered in the device zone, and the typed
 * wall-clock value is converted back to an ISO instant in that same zone.
 */
const DEADLINE_TIME_ZONE = localEventTimeZone();

function deadlineInputToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00` : trimmed.replace(' ', 'T');
  return eventLocalInputToIso(withTime, DEADLINE_TIME_ZONE);
}

function deadlineIsoToInput(value: string | null | undefined): string {
  return eventIsoToLocalInput(value, DEADLINE_TIME_ZONE).replace('T', ' ');
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
  const { confirm, confirmDialog } = useConfirm();
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
  const [hasSaved, setHasSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [hasHydrated, setHasHydrated] = useState(!isEdit);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const attemptedRetryRef = useRef<number | null>(null);
  // Mount tracking in its own effect: a re-render mid-fetch must not cancel the hydration.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isEdit || hasHydrated || attemptedRetryRef.current === retryToken) return;
    attemptedRetryRef.current = retryToken;
    setIsLoading(true);
    setLoadFailed(false);
    void getIdeationChallenge(challengeId)
      .then((challenge) => {
        if (!isMountedRef.current) return;
        setTitle(challenge.title ?? '');
        setDescription(challenge.description ?? '');
        setCategory(challenge.category ?? '');
        setPrizeDescription(challenge.prize_description ?? '');
        setSubmissionDeadline(deadlineIsoToInput(challenge.submission_deadline));
        setVotingDeadline(deadlineIsoToInput(challenge.voting_deadline));
        setMaxIdeasPerUser(challenge.max_ideas_per_user == null ? '' : String(challenge.max_ideas_per_user));
        setHasHydrated(true);
      })
      .catch((error) => {
        if (!isMountedRef.current) return;
        // 🔴 Not a dead form: a failed load used to leave empty fields under a live
        // "Update" button, which would have wiped the record (S4-03).
        setLoadFailed(true);
        showToastRef.current({
          title: tRef.current('ideation:challenges.load_error'),
          description: error instanceof Error ? error.message : tRef.current('ideation:toast.error_generic'),
          variant: 'danger',
        });
      })
      .finally(() => { if (isMountedRef.current) setIsLoading(false); });
  }, [challengeId, hasHydrated, isEdit, retryToken]);

  // Everything the member can type or choose, compared with the form as first shown.
  const formFingerprint = JSON.stringify([title, description, category, prizeDescription, submissionDeadline, votingDeadline, maxIdeasPerUser, status]);
  const baselineRef = useRef<string | null>(null);
  if (!isEdit && baselineRef.current === null) baselineRef.current = formFingerprint;
  useEffect(() => {
    if (isEdit && hasHydrated && baselineRef.current === null) baselineRef.current = formFingerprint;
  }, [formFingerprint, hasHydrated, isEdit]);
  const isDirty = baselineRef.current !== null && formFingerprint !== baselineRef.current;
  useUnsavedChangesGuard({
    isDirty,
    isBusy: isSubmitting || hasSaved,
    confirm,
    title: t('ideation:create.unsavedTitle'),
    message: t('ideation:create.unsavedMessage'),
    discardLabel: t('ideation:create.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const hasTitle = title.trim().length > 0;
  const hasDescription = description.trim().length > 0;
  const isValid = hasTitle && hasDescription && hasHydrated;
  // 🔴 The footer used to say "Ready" / "Open for ideas." over an empty form (S4-14).
  const footerTitle = isValid ? t('ideation:create.reviewTitle') : t('ideation:create.footerIncomplete');
  const footerSubtitle = !hasTitle
    ? t('ideation:create.footerMissingTitle')
    : !hasDescription
      ? t('ideation:create.footerMissingDescription')
      : t('ideation:create.reviewSubtitle');

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
    if (isEdit && !hasHydrated) return;
    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();
    if (!trimmedTitle || !trimmedDescription) {
      showToast({ title: t('ideation:create.validationTitle'), description: t('ideation:create.validationRequired'), variant: 'warning' });
      return;
    }

    const submissionDate = deadlineInputToIso(submissionDeadline);
    const votingDate = deadlineInputToIso(votingDeadline);
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
      setHasSaved(true);
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

    // `replace`, not `push`: going "back" to a form whose contents have already been
    // posted is a duplicate-post trap, and push is a no-op from a deep-link root (S4-14).
    if (successDestination) {
      setTimeout(() => router.replace(successDestination), 0);
    }
  }

  return (
    <SafeAreaView testID="new-challenge-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={isEdit ? t('ideation:edit_page.title') : t('ideation:create.title')} backLabel={t('common:back')} fallbackHref={isEdit ? ({ pathname: '/(modals)/ideation-detail', params: { id: String(challengeId) } } as unknown as Href) : ('/(modals)/ideation' as Href)} />
      {isEdit && loadFailed ? (
        <View className="flex-1 justify-center" style={{ flex: 1, backgroundColor: theme.bg }} testID="new-challenge-load-failed">
          <EmptyState
            icon="bulb-outline"
            title={t('ideation:create.loadFailedTitle')}
            subtitle={t('ideation:challenges.load_error')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => setRetryToken((value) => value + 1)}
          />
        </View>
      ) : isLoading || (isEdit && !hasHydrated) ? <View className="flex-1 items-center justify-center"><LoadingSpinner /></View> : (
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
                      accessibilityState={{ selected: status === item }}
                    >
                      {status === item
                        ? <AccentIcon name={item === 'open' ? 'radio-button-on-outline' : 'document-text-outline'} size={16} />
                        : (
                          <Ionicons
                            name={item === 'open' ? 'radio-button-on-outline' : 'document-text-outline'}
                            size={16}
                            color={primary}
                          />
                        )}
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
          title={footerTitle}
          subtitle={footerSubtitle}
          submitLabel={isSubmitting ? (isEdit ? t('ideation:form.updating') : t('ideation:create.saving')) : (isEdit ? t('ideation:form.update') : t('ideation:create.submit'))}
          secondaryLabel={t('common:buttons.cancel')}
          icon="checkmark-outline"
          primary={primary}
          isSubmitting={isSubmitting}
          isDisabled={!isValid}
          onSubmit={() => void submit()}
          onSecondary={() => router.back()}
        />
      </KeyboardAvoidingView>
      )}
      {confirmDialog}
    </SafeAreaView>
  );
}
