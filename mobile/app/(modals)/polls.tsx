// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import AccentIcon from '@/components/ui/AccentIcon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, KeyboardAvoidingView, Platform, RefreshControl, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import DraftStorageWarning from '@/components/ui/DraftStorageWarning';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import PollCard from '@/components/PollCard';
import { getFeed, getFeedAuthor, type FeedItem, type FeedResponse } from '@/lib/api/feed';
import { createPoll } from '@/lib/api/polls';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import { withRouteGate } from '@/components/withRouteGate';
import { completePollCreationOperation, reservePollCreationOperation } from '@/lib/pollCreationOperation';
import { useConfirm } from '@/components/ui/useConfirm';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import {
  clearCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  type CreationDraftScope,
} from '@/lib/creationDraftStore';

interface PollCreationDraft {
  question: string;
  description: string;
  options: string[];
  pollType: 'standard' | 'ranked';
  isAnonymous: boolean;
}

function isPollCreationDraft(value: unknown): value is PollCreationDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<PollCreationDraft>;
  return typeof draft.question === 'string'
    && typeof draft.description === 'string'
    && Array.isArray(draft.options)
    && draft.options.length >= 2
    && draft.options.length <= 6
    && draft.options.every(option => typeof option === 'string')
    && (draft.pollType === 'standard' || draft.pollType === 'ranked')
    && typeof draft.isAnonymous === 'boolean';
}

function extractPollsPage(response: FeedResponse) {
  if (!response?.data || !response?.meta) {
    return { items: [], cursor: null, hasMore: false };
  }

  const seen = new Set<number>();
  const polls = response.data.filter((item) => {
    if (item.type !== 'poll' || !item.poll_data || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return {
    items: polls,
    cursor: response.meta.cursor ?? null,
    hasMore: response.meta.has_more ?? false,
  };
}

function PollsScreen({ draftScope }: { draftScope: CreationDraftScope }) {
  const { t } = useTranslation(['home', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const isLargeText = width < 320 || fontScale > 1.3;
  const scaleKey = isLargeText ? 'large' : 'compact';
  const { show: showToast } = useAppToast();
  const { confirm: confirmDraftLeave, confirmDialog: draftLeaveDialog } = useConfirm();
  const params = useLocalSearchParams<{ create?: string | string[] }>();
  const createParam = Array.isArray(params.create) ? params.create[0] : params.create;
  const shouldOpenCreate = createParam === '1' || createParam === 'true';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(shouldOpenCreate);
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [pollType, setPollType] = useState<'standard' | 'ranked'>('standard');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [draftStorageFailed, setDraftStorageFailed] = useState(false);
  const creatingRef = useRef(false);
  const wasRefreshingRef = useRef(false);
  const mountedRef = useRef(true);
  const draftHydratedRef = useRef(false);
  const draftEditedRef = useRef(false);
  const draftSaveEnabledRef = useRef(false);
  const screenFocusedRef = useRef(false);
  const discardingDraftRef = useRef(false);
  const draftSnapshotRef = useRef<PollCreationDraft>({ question: '', description: '', options: ['', ''], pollType: 'standard', isAnonymous: false });
  const isDraftDirty = question.trim() !== ''
    || description.trim() !== ''
    || options.some((option) => option.trim() !== '')
    || options.length !== 2
    || pollType !== 'standard'
    || isAnonymous;

  useEffect(() => () => { mountedRef.current = false; }, []);
  useFocusEffect(useCallback(() => {
    screenFocusedRef.current = true;
    return () => { screenFocusedRef.current = false; };
  }, []));

  draftSnapshotRef.current = { question, description, options, pollType, isAnonymous };

  const persistDraft = useCallback(async () => {
    const saved = await saveCreationDraft(draftScope, draftSnapshotRef.current);
    if (mountedRef.current) setDraftStorageFailed(!saved);
    return saved;
  }, [draftScope]);
  const clearDraft = useCallback(async () => {
    const cleared = await clearCreationDraft(draftScope);
    if (mountedRef.current) setDraftStorageFailed(!cleared);
    return cleared;
  }, [draftScope]);

  useEffect(() => {
    let active = true;
    setDraftStorageFailed(false);
    void loadCreationDraft<PollCreationDraft>(draftScope).then((restored) => {
      if (!active || draftEditedRef.current || !isPollCreationDraft(restored)) return;
      const dirty = restored.question.trim() !== ''
        || restored.description.trim() !== ''
        || restored.options.some(option => option.trim() !== '')
        || restored.options.length !== 2
        || restored.pollType !== 'standard'
        || restored.isAnonymous;
      if (!dirty) return;
      setQuestion(restored.question);
      setDescription(restored.description);
      setOptions(restored.options);
      setPollType(restored.pollType);
      setIsAnonymous(restored.isAnonymous);
      draftSaveEnabledRef.current = true;
      setShowCreate(true);
    }).finally(() => {
      if (active) draftHydratedRef.current = true;
    });
    return () => { active = false; };
  }, [draftScope]);

  useEffect(() => {
    if (!draftHydratedRef.current) return;
    const timer = setTimeout(() => {
      if (isDraftDirty && draftSaveEnabledRef.current && screenFocusedRef.current) void persistDraft();
      else if (!isDraftDirty) void clearDraft();
    }, 400);
    return () => clearTimeout(timer);
  }, [clearDraft, description, draftScope, isAnonymous, isDraftDirty, options, persistDraft, pollType, question]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && screenFocusedRef.current && draftHydratedRef.current && draftSaveEnabledRef.current && isDraftDirty) {
        void persistDraft();
      }
    });
    return () => subscription.remove();
  }, [draftScope, isDraftDirty, persistDraft]);

  const requestedCursor = useRef<string | null>(null);
  const fetchPolls = useCallback(
    (cursor: string | null) => {
      requestedCursor.current = cursor;
      return getFeed(1, cursor, { filter: 'polls', mode: 'recent', perPage: 20 });
    },
    [],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<FeedItem, FeedResponse>(fetchPolls, extractPollsPage, []);

  /*
    🔴 Voting used to call `refresh()`, which resets the paginated list to page one.
    A member who had scrolled through four pages of polls, voted on one, and was thrown
    back to the top with everything below page one gone — and their place in the list
    lost. Audit 2026-09-07 F-17, fixed 2026-09-08.

    Refreshing was never needed: the vote endpoint returns the poll's new state and
    `PollCard` already renders from it. This keeps that authoritative copy, so the
    result survives any later re-render of the list, without discarding a single page.
  */
  const [votedPolls, setVotedPolls] = useState<Record<number, NonNullable<FeedItem['poll_data']>>>({});

  const visibleItems = useMemo(
    () => items.map((item) => (votedPolls[item.id] ? { ...item, poll_data: votedPolls[item.id] } : item)),
    [items, votedPolls],
  );

  const handleVoted = useCallback((itemId: number, updated: NonNullable<FeedItem['poll_data']>) => {
    setVotedPolls((current) => ({ ...current, [itemId]: updated }));
  }, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    wasRefreshingRef.current = true;
    // A deliberate pull-to-refresh DOES start over, so the server's counts win again.
    setVotedPolls({});
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (wasRefreshingRef.current && !isLoading && isRefreshing) {
      wasRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [isLoading, isRefreshing]);

  useEffect(() => {
    if (shouldOpenCreate) {
      setShowCreate(true);
    }
  }, [shouldOpenCreate]);

  async function handleCreatePoll() {
    if (creatingRef.current) return;
    const trimmedQuestion = question.trim();
    const validOptions = options.map((option) => option.trim()).filter(Boolean);

    if (!trimmedQuestion) {
      showToast({ title: t('pollsScreen.createMissingTitle'), description: t('pollsScreen.createQuestionRequired'), variant: 'warning' });
      return;
    }
    if (validOptions.length < 2) {
      showToast({ title: t('pollsScreen.createMissingTitle'), description: t('pollsScreen.createOptionsRequired'), variant: 'warning' });
      return;
    }

    creatingRef.current = true;
    setIsCreating(true);
    try {
      const payload = {
        question: trimmedQuestion,
        description: description.trim() || undefined,
        options: validOptions,
        poll_type: pollType,
        is_anonymous: isAnonymous,
      } as const;
      const operation = await reservePollCreationOperation(JSON.stringify(payload));
      await createPoll(payload, operation.key);
      draftSaveEnabledRef.current = false;
      const cleared = await clearDraft();
      if (!cleared) {
        draftSaveEnabledRef.current = true;
        showToast({ title: t('common:draftStorage.title'), description: t('common:draftStorage.message'), variant: 'warning' });
        return;
      }
      await completePollCreationOperation(operation);
      if (!mountedRef.current) return;
      setQuestion('');
      setDescription('');
      setOptions(['', '']);
      setPollType('standard');
      setIsAnonymous(false);
      setShowCreate(false);
      showToast({ title: t('pollsScreen.createdTitle'), description: t('pollsScreen.createdMessage'), variant: 'success' });
      refresh();
    } catch (err) {
      if (!mountedRef.current) return;
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('pollsScreen.createError')), variant: 'danger' });
    } finally {
      creatingRef.current = false;
      if (mountedRef.current) setIsCreating(false);
    }
  }

  function updateOption(index: number, value: string) {
    draftEditedRef.current = true;
    draftSaveEnabledRef.current = true;
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? value : option)));
  }

  function addOption() {
    draftEditedRef.current = true;
    draftSaveEnabledRef.current = true;
    setOptions((current) => (current.length >= 6 ? current : [...current, '']));
  }

  function removeOption(index: number) {
    draftEditedRef.current = true;
    draftSaveEnabledRef.current = true;
    setOptions((current) => (current.length <= 2 ? current : current.filter((_, optionIndex) => optionIndex !== index)));
  }

  const discardDraft = useCallback(async () => {
    if (discardingDraftRef.current) return;
    discardingDraftRef.current = true;
    draftEditedRef.current = true;
    draftSaveEnabledRef.current = false;
    if (isDraftDirty) {
      setIsCreating(true);
      const cleared = await clearCreationDraft(draftScope);
      if (!cleared) {
        discardingDraftRef.current = false;
        draftSaveEnabledRef.current = true;
        if (mountedRef.current) {
          setIsCreating(false);
          setDraftStorageFailed(true);
        }
        return;
      }
    }
    setQuestion('');
    setDescription('');
    setOptions(['', '']);
    setPollType('standard');
    setIsAnonymous(false);
    setShowCreate(false);
    setDraftStorageFailed(false);
    setIsCreating(false);
    discardingDraftRef.current = false;
  }, [draftScope, isDraftDirty]);

  const requestCloseCreate = useCallback(() => {
    if (isCreating) {
      confirmDraftLeave({
        title: t('common:unsavedSaving.title'),
        message: t('common:unsavedSaving.message'),
        confirmLabel: t('common:unsavedSaving.leave'),
        cancelLabel: t('common:unsavedSaving.wait'),
        variant: 'danger',
        onConfirm: discardDraft,
      });
      return;
    }
    if (isDraftDirty) {
      confirmDraftLeave({
        title: t('common:unsavedChanges.title'),
        message: t('common:unsavedChanges.message'),
        confirmLabel: t('common:unsavedChanges.discard'),
        cancelLabel: t('common:buttons.cancel'),
        variant: 'danger',
        onConfirm: discardDraft,
      });
      return;
    }
    discardDraft();
  }, [confirmDraftLeave, discardDraft, isCreating, isDraftDirty, t]);

  useUnsavedChangesGuard({
    isDirty: showCreate && isDraftDirty,
    isSaving: isCreating,
    confirm: confirmDraftLeave,
    title: t('common:unsavedChanges.title'),
    message: t('common:unsavedChanges.message'),
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <PollFeedCard item={item} primary={primary} t={t} onVoted={(updated) => handleVoted(item.id, updated)} />
    ),
    [handleVoted, primary, t],
  );

  return (
    <ModalErrorBoundary>
      <SafeAreaView testID="polls-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('pollsScreen.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/home" />

        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: theme.bg }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <FlatList
          testID="polls-list"
          data={visibleItems}
          keyExtractor={(item) => `poll-${item.id}`}
          renderItem={renderItem}
          style={{ flex: 1, backgroundColor: theme.bg }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
          }
          onEndReached={() => { if (hasMore && !error) loadMore(); }}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <View className="gap-3 px-4 pb-4">
              <HeroCard className="overflow-hidden rounded-panel p-0">
                <View className="h-1.5" style={{ backgroundColor: primary }} />
                <HeroCard.Body key={`poll-hero-${scaleKey}`} className="gap-4 p-4">
                  <View testID="polls-hero-layout" className={`${isLargeText ? '' : 'flex-row items-start'} gap-3`}>
                    <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="stats-chart-outline" size={24} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="text-xs font-semibold uppercase text-muted-foreground" numberOfLines={isLargeText ? 0 : 2}>
                        {t('pollsScreen.heroEyebrow')}
                      </Text>
                      <Text className="text-2xl font-bold leading-8 text-foreground">
                        {t('pollsScreen.title')}
                      </Text>
                      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={isLargeText ? 0 : 3}>
                        {t('pollsScreen.subtitle')}
                      </Text>
                    </View>
                  </View>

                  <HeroButton
                    variant={showCreate ? 'secondary' : 'primary'}
                    isDisabled={isCreating}
                    onPress={() => {
                      if (showCreate) requestCloseCreate();
                      else setShowCreate(true);
                    }}
                    accessibilityLabel={t('pollsScreen.createPoll')}
                  >
                    {showCreate ? <Ionicons name="close-outline" size={18} color={primary} /> : <AccentIcon name="add-circle-outline" size={18} />}
                    <HeroButton.Label>{showCreate ? t('common:buttons.cancel') : t('pollsScreen.createPoll')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>
              {showCreate ? (
                <HeroCard variant="secondary" className="rounded-panel p-0">
                  <HeroCard.Body className="gap-4 p-4">
                    <DraftStorageWarning visible={draftStorageFailed} testID="poll-draft-storage-warning" />
                    <View className="flex-row items-center gap-3">
                      <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                        <Ionicons name="create-outline" size={20} color={primary} />
                      </View>
                      <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }}>
                        {t('pollsScreen.createTitle')}
                      </Text>
                    </View>
                    <Input
                      label={t('pollsScreen.questionLabel')}
                      value={question}
                      onChangeText={(value) => {
                        draftEditedRef.current = true;
                        draftSaveEnabledRef.current = true;
                        setQuestion(value);
                      }}
                      editable={!isCreating}
                      placeholder={t('pollsScreen.questionPlaceholder')}
                    />
                    <Input
                      label={t('pollsScreen.descriptionLabel')}
                      value={description}
                      onChangeText={(value) => {
                        draftEditedRef.current = true;
                        draftSaveEnabledRef.current = true;
                        setDescription(value);
                      }}
                      editable={!isCreating}
                      placeholder={t('pollsScreen.descriptionPlaceholder')}
                      multiline
                    />
                    <View className="gap-2">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('pollsScreen.typeLabel')}</Text>
                      <View className="flex-row gap-2">
                        <HeroButton
                          className="flex-1"
                          variant={pollType === 'standard' ? 'primary' : 'secondary'}
                          isDisabled={isCreating}
                          onPress={() => {
                            draftEditedRef.current = true;
                            draftSaveEnabledRef.current = true;
                            setPollType('standard');
                          }}
                          accessibilityState={{ selected: pollType === 'standard' }}
                        >
                          <HeroButton.Label>{t('pollsScreen.typeStandard')}</HeroButton.Label>
                        </HeroButton>
                        <HeroButton
                          className="flex-1"
                          variant={pollType === 'ranked' ? 'primary' : 'secondary'}
                          isDisabled={isCreating}
                          onPress={() => {
                            draftEditedRef.current = true;
                            draftSaveEnabledRef.current = true;
                            setPollType('ranked');
                          }}
                          accessibilityState={{ selected: pollType === 'ranked' }}
                        >
                          <HeroButton.Label>{t('pollsScreen.typeRanked')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                      <HeroButton
                        variant={isAnonymous ? 'primary' : 'secondary'}
                        isDisabled={isCreating}
                        onPress={() => {
                          draftEditedRef.current = true;
                          draftSaveEnabledRef.current = true;
                          setIsAnonymous((value) => !value);
                        }}
                        accessibilityState={{ checked: isAnonymous }}
                      >
                        <Ionicons name={isAnonymous ? 'checkbox-outline' : 'square-outline'} size={18} color={isAnonymous ? theme.onPrimary : primary} />
                        <HeroButton.Label>{t('pollsScreen.anonymous')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                    <View className="gap-2">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('pollsScreen.optionsLabel')}</Text>
                      {options.map((option, index) => (
                        <View key={`option-${index}`} className="flex-row items-center gap-2">
                          <Input
                            containerClassName="mb-0 flex-1"
                            value={option}
                            onChangeText={(value) => updateOption(index, value)}
                            editable={!isCreating}
                            placeholder={t('pollsScreen.optionPlaceholder', { number: index + 1 })}
                          />
                          {options.length > 2 ? (
                            <HeroButton
                              size="sm"
                              isIconOnly
                              variant="danger-soft"
                              onPress={() => removeOption(index)}
                              isDisabled={isCreating}
                              accessibilityLabel={t('pollsScreen.removeOption', { number: index + 1 })}
                            >
                              <Ionicons name="trash-outline" size={16} color={theme.error} />
                            </HeroButton>
                          ) : null}
                        </View>
                      ))}
                    </View>
                    <View className="gap-2">
                      <HeroButton variant="secondary" isDisabled={isCreating || options.length >= 6} onPress={addOption}>
                        <Ionicons name="add-outline" size={16} color={primary} />
                        <HeroButton.Label>{t('pollsScreen.addOption')}</HeroButton.Label>
                      </HeroButton>
                      <HeroButton
                        variant="primary"
                        isDisabled={isCreating}
                        onPress={() => void handleCreatePoll()}
                        accessibilityLabel={t('pollsScreen.submitPoll')}
                        style={{ backgroundColor: isCreating ? theme.border : primary }}
                      >
                        {isCreating ? <LoadingSpinner /> : <AccentIcon name="checkmark-outline" size={16} />}
                        <HeroButton.Label>{isCreating ? t('pollsScreen.creating') : t('pollsScreen.submitPoll')}</HeroButton.Label>
                      </HeroButton>
                    </View>
                  </HeroCard.Body>
                </HeroCard>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <LoadingSpinner />
            ) : error ? (
              <HeroCard variant="secondary" className="mx-4 my-6">
                <HeroCard.Body className="items-center gap-4">
                  <Ionicons name="cloud-offline-outline" size={30} color={primary} />
                  <Text className="text-center text-base font-semibold text-foreground">
                    {t('pollsScreen.errorTitle')}
                  </Text>
                  <Text className="text-center text-sm text-danger">{error}</Text>
                  <HeroButton variant="primary" onPress={() => void refresh()}>
                    <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>
            ) : (
              <EmptyState
                icon="stats-chart-outline"
                title={t('pollsScreen.emptyTitle')}
                subtitle={t('pollsScreen.emptySubtitle')}
              />
            )
          }
          ListFooterComponent={
            error && items.length > 0 ? (
              <ErrorState subtitle={error} onRetry={() => { if (requestedCursor.current !== null) loadMore(); else refresh(); }} isRetrying={isLoading || isLoadingMore} />
            ) : isLoadingMore ? (
              <View className="items-center py-4">
                <Spinner size="sm" />
              </View>
            ) : !hasMore && items.length > 0 && !isLoading ? (
              <View className="items-center py-4">
                <Text className="text-xs text-muted-foreground">{t('common:endOfList')}</Text>
              </View>
            ) : null
          }
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 112, backgroundColor: theme.bg }}
        />
        </KeyboardAvoidingView>
        {draftLeaveDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function PollFeedCard({
  item,
  primary,
  t,
  onVoted,
}: {
  item: FeedItem;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onVoted: (updated: NonNullable<FeedItem['poll_data']>) => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const isLargeText = width < 320 || fontScale > 1.3;
  const scaleKey = isLargeText ? 'large' : 'compact';
  if (!item.poll_data) return null;

  const author = getFeedAuthor(item, t('common:labels.member'));

  return (
    <HeroCard variant="default" className="mx-4 mb-4 overflow-hidden rounded-panel p-0">
      <HeroCard.Body key={`poll-feed-${item.id}-${scaleKey}`} className="gap-4 p-4">
        <View testID={`poll-feed-header-${item.id}`} className={`${isLargeText ? '' : 'flex-row items-start'} gap-3`}>
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="stats-chart-outline" size={19} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text testID={`poll-feed-title-${item.id}`} className="text-base font-semibold leading-6 text-foreground" numberOfLines={isLargeText ? 0 : 3}>
              {t('pollsScreen.feedItemTitle', { title: item.title || item.poll_data.question })}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={isLargeText ? 0 : 1}>
              {author.name}
            </Text>
          </View>
        </View>

        <View className={`flex-row flex-wrap gap-2 ${isLargeText ? '' : 'pl-[52px]'}`}>
          <Chip size="sm" variant={item.poll_data.is_active ? 'secondary' : 'soft'} color={item.poll_data.is_active ? 'accent' : 'default'}>
            <Ionicons name={item.poll_data.is_active ? 'radio-button-on-outline' : 'lock-closed-outline'} size={12} color={primary} />
            <Chip.Label>{item.poll_data.is_active ? t('pollsScreen.statusOpen') : t('pollsScreen.statusClosed')}</Chip.Label>
          </Chip>
        </View>

        <Surface variant="secondary" className="rounded-panel-inner p-3">
          <PollCard pollData={item.poll_data} itemId={item.id} onVoted={onVoted} />
        </Surface>
      </HeroCard.Body>
    </HeroCard>
  );
}

function PollsRoute() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const tenantIdentity = tenant?.id ?? tenant?.slug ?? 'no-tenant';
  const userIdentity = user?.id ?? 'no-user';
  const draftScope = useMemo<CreationDraftScope>(() => ({
    kind: 'poll',
    tenantId: tenantIdentity,
    userId: userIdentity,
  }), [tenantIdentity, userIdentity]);
  return <PollsScreen key={`${tenantIdentity}:${userIdentity}`} draftScope={draftScope} />;
}

export default withRouteGate(PollsRoute, 'polls');
