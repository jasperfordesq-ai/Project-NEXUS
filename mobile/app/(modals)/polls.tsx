// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import PollCard from '@/components/PollCard';
import { getFeed, getFeedAuthor, type FeedItem, type FeedResponse } from '@/lib/api/feed';
import { createPoll } from '@/lib/api/polls';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

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

export default function PollsScreen() {
  const { t } = useTranslation(['home', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const params = useLocalSearchParams<{ create?: string | string[] }>();
  const createParam = Array.isArray(params.create) ? params.create[0] : params.create;
  const shouldOpenCreate = createParam === '1' || createParam === 'true';
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(shouldOpenCreate);
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [isCreating, setIsCreating] = useState(false);
  const wasRefreshingRef = useRef(false);

  const fetchPolls = useCallback(
    (cursor: string | null) => getFeed(1, cursor, { filter: 'polls', mode: 'recent', perPage: 20 }),
    [],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<FeedItem, FeedResponse>(fetchPolls, extractPollsPage, []);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    wasRefreshingRef.current = true;
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

    setIsCreating(true);
    try {
      await createPoll({
        question: trimmedQuestion,
        description: description.trim() || undefined,
        options: validOptions,
        poll_type: 'standard',
        is_anonymous: false,
      });
      setQuestion('');
      setDescription('');
      setOptions(['', '']);
      setShowCreate(false);
      showToast({ title: t('pollsScreen.createdTitle'), description: t('pollsScreen.createdMessage'), variant: 'success' });
      refresh();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('pollsScreen.createError'), variant: 'danger' });
    } finally {
      setIsCreating(false);
    }
  }

  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((option, optionIndex) => (optionIndex === index ? value : option)));
  }

  function addOption() {
    setOptions((current) => (current.length >= 6 ? current : [...current, '']));
  }

  function removeOption(index: number) {
    setOptions((current) => (current.length <= 2 ? current : current.filter((_, optionIndex) => optionIndex !== index)));
  }

  const renderItem = useCallback(
    ({ item }: { item: FeedItem }) => (
      <PollFeedCard item={item} primary={primary} t={t} onVoted={() => void refresh()} />
    ),
    [primary, refresh, t],
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
          data={items}
          keyExtractor={(item) => `poll-${item.id}`}
          renderItem={renderItem}
          style={{ flex: 1, backgroundColor: theme.bg }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListHeaderComponent={
            <View className="gap-3 px-4 pb-4">
              <HeroCard className="overflow-hidden rounded-panel p-0">
                <View className="h-1.5" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-4 p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="stats-chart-outline" size={24} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="text-xs font-semibold uppercase text-muted-foreground">
                        {t('pollsScreen.heroEyebrow')}
                      </Text>
                      <Text className="text-2xl font-bold leading-8 text-foreground">
                        {t('pollsScreen.title')}
                      </Text>
                      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {t('pollsScreen.subtitle')}
                      </Text>
                    </View>
                  </View>

                  <HeroButton
                    variant={showCreate ? 'secondary' : 'primary'}
                    onPress={() => setShowCreate((value) => !value)}
                    accessibilityLabel={t('pollsScreen.createPoll')}
                  >
                    <Ionicons name={showCreate ? 'close-outline' : 'add-circle-outline'} size={18} color={showCreate ? primary : theme.onPrimary} />
                    <HeroButton.Label>{showCreate ? t('common:buttons.cancel') : t('pollsScreen.createPoll')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>
              {showCreate ? (
                <HeroCard variant="secondary" className="rounded-panel p-0">
                  <HeroCard.Body className="gap-4 p-4">
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
                      onChangeText={setQuestion}
                      placeholder={t('pollsScreen.questionPlaceholder')}
                    />
                    <Input
                      label={t('pollsScreen.descriptionLabel')}
                      value={description}
                      onChangeText={setDescription}
                      placeholder={t('pollsScreen.descriptionPlaceholder')}
                      multiline
                    />
                    <View className="gap-2">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('pollsScreen.optionsLabel')}</Text>
                      {options.map((option, index) => (
                        <View key={`option-${index}`} className="flex-row items-center gap-2">
                          <Input
                            containerClassName="mb-0 flex-1"
                            value={option}
                            onChangeText={(value) => updateOption(index, value)}
                            placeholder={t('pollsScreen.optionPlaceholder', { number: index + 1 })}
                          />
                          {options.length > 2 ? (
                            <HeroButton
                              size="sm"
                              isIconOnly
                              variant="danger-soft"
                              onPress={() => removeOption(index)}
                              accessibilityLabel={t('pollsScreen.removeOption', { number: index + 1 })}
                            >
                              <Ionicons name="trash-outline" size={16} color={theme.error} />
                            </HeroButton>
                          ) : null}
                        </View>
                      ))}
                    </View>
                    <View className="gap-2">
                      <HeroButton variant="secondary" isDisabled={options.length >= 6} onPress={addOption}>
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
                        {isCreating ? <LoadingSpinner /> : <Ionicons name="checkmark-outline" size={16} color={theme.onPrimary} />}
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
            isLoadingMore ? (
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
  if (!item.poll_data) return null;

  const author = getFeedAuthor(item, t('common:labels.member'));

  return (
    <HeroCard variant="default" className="mx-4 mb-4 overflow-hidden rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="stats-chart-outline" size={19} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-semibold leading-6 text-foreground" numberOfLines={3}>
              {t('pollsScreen.feedItemTitle', { title: item.title || item.poll_data.question })}
            </Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={1}>
              {author.name}
            </Text>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2 pl-[52px]">
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
