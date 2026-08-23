// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  deleteSavedSearch,
  getSavedSearches,
  runSavedSearch,
  saveSearch,
  search,
  type SavedSearch,
  type SearchResult,
  type SearchResultType,
  type SearchResponse,
} from '@/lib/api/search';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import SearchInput from '@/components/ui/SearchInput';
import { SkeletonBox } from '@/components/ui/Skeleton';
import OfflineBanner from '@/components/OfflineBanner';

type FilterOption = SearchResultType | 'all';

function extractSearchPage(response: SearchResponse) {
  return {
    items: response.data,
    cursor: response.meta.cursor ?? null,
    hasMore: response.meta.has_more,
  };
}

const TYPE_ICONS: Record<SearchResultType, React.ComponentProps<typeof Ionicons>['name']> = {
  user: 'person-outline',
  listing: 'storefront-outline',
  event: 'calendar-outline',
  group: 'people-outline',
  blog_post: 'newspaper-outline',
};

const TYPE_TONES: Record<SearchResultType, string> = {
  user: '#10B981',
  listing: '#6366F1',
  event: '#F59E0B',
  group: '#8B5CF6',
  blog_post: '#0EA5E9',
};

function isSearchResultType(value: unknown): value is SearchResultType {
  return value === 'user' || value === 'listing' || value === 'event' || value === 'group' || value === 'blog_post';
}

function navigateToResult(item: SearchResult): void {
  switch (item.type) {
    case 'user':
      router.push({ pathname: '/(modals)/member-profile', params: { id: String(item.id) } });
      break;
    case 'listing':
      router.push({ pathname: '/(modals)/exchange-detail', params: { id: String(item.id) } });
      break;
    case 'event':
      router.push({ pathname: '/(modals)/event-detail', params: { id: String(item.id) } });
      break;
    case 'group':
      router.push({ pathname: '/(modals)/group-detail', params: { id: String(item.id) } });
      break;
    case 'blog_post': {
      const slug = getBlogSlug(item);
      router.push({ pathname: '/(modals)/blog-post', params: { id: slug } });
      break;
    }
  }
}

function getBlogSlug(item: SearchResult): string {
  if (item.url) {
    const cleanUrl = item.url.split('?')[0]?.replace(/\/$/, '') ?? '';
    const slug = cleanUrl.split('/').filter(Boolean).pop();
    if (slug) return slug;
  }
  return String(item.id);
}

function SearchResultSkeleton() {
  return (
    <HeroCard variant="default" className="mx-4 my-2 rounded-panel p-0">
      <HeroCard.Body className="flex-row items-center gap-3 p-4">
      <SkeletonBox width={40} height={40} borderRadius={20} />
        <View className="flex-1 gap-1.5">
        <SkeletonBox width="65%" height={14} />
        <SkeletonBox width="40%" height={11} />
      </View>
      <SkeletonBox width={48} height={20} borderRadius={6} style={{ marginLeft: 8 }} />
      </HeroCard.Body>
    </HeroCard>
  );
}

export default function SearchScreen() {
  const { t } = useTranslation(['search', 'common']);
  const params = useLocalSearchParams<{ q?: string; type?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const initialType = isSearchResultType(params.type) ? params.type : 'all';
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [activeFilter, setActiveFilter] = useState<FilterOption>(initialType);
  const [showSaveSearch, setShowSaveSearch] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState('');
  const [isSavingSearch, setIsSavingSearch] = useState(false);
  const debouncedQuery = useDebounce(query, 400);

  const activeType = activeFilter === 'all' ? undefined : activeFilter;

  const fetchSearch = useCallback(
    (cursor: string | null) => {
      if (!debouncedQuery.trim()) {
        return Promise.resolve({ data: [], meta: { total: 0, has_more: false, cursor: null } } as SearchResponse);
      }
      return search(debouncedQuery, cursor, activeType);
    },
    [debouncedQuery, activeType],
  );

  const { items: results, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<SearchResult, SearchResponse>(
      fetchSearch,
      extractSearchPage,
      [debouncedQuery, activeFilter],
    );
  const savedSearchesQuery = useApi(() => getSavedSearches(), []);
  const savedSearches = savedSearchesQuery.data?.data ?? [];

  const filters: FilterOption[] = ['all', 'user', 'listing', 'event', 'group', 'blog_post'];

  function filterLabel(f: FilterOption): string {
    if (f === 'all') return t('filterAll');
    return t(`types.${f}`);
  }

  async function handleSaveSearch() {
    const trimmedQuery = debouncedQuery.trim();
    const trimmedName = saveSearchName.trim();
    if (!trimmedQuery || !trimmedName) return;
    try {
      setIsSavingSearch(true);
      await saveSearch({
        name: trimmedName,
        query_params: {
          q: trimmedQuery,
          ...(activeFilter !== 'all' ? { type: activeFilter } : {}),
        },
      });
      setSaveSearchName('');
      setShowSaveSearch(false);
      savedSearchesQuery.refresh();
    } catch {
      showToast({ title: t('saved.saveFailedTitle'), description: t('saved.saveFailedMessage'), variant: 'danger' });
    } finally {
      setIsSavingSearch(false);
    }
  }

  async function handleRunSavedSearch(item: SavedSearch) {
    const savedQuery = item.query_params.q ?? '';
    const savedType = isSearchResultType(item.query_params.type) ? item.query_params.type : 'all';
    setQuery(savedQuery);
    setActiveFilter(savedType);
    try {
      await runSavedSearch(item.id, results.length);
      savedSearchesQuery.refresh();
    } catch {
      // Running the search locally is still useful if analytics bookkeeping fails.
    }
  }

  async function handleDeleteSavedSearch(item: SavedSearch) {
    try {
      await deleteSavedSearch(item.id);
      savedSearchesQuery.refresh();
    } catch {
      showToast({ title: t('saved.deleteFailedTitle'), description: t('saved.deleteFailedMessage'), variant: 'danger' });
    }
  }

  function renderResult({ item }: { item: SearchResult }) {
    const icon = TYPE_ICONS[item.type];
    const typeLabel = t(`types.${item.type}`);
    const tone = TYPE_TONES[item.type];
    return (
      <HeroButton
        className="mx-4 my-2"
        variant="ghost"
        feedbackVariant="scale"
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          navigateToResult(item);
        }}
        accessibilityLabel={item.title}
      >
        <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
          <View className="h-1 w-full" style={{ backgroundColor: tone }} />
          <HeroCard.Body className="flex-row items-center gap-3 p-4">
            {item.type === 'user' ? (
              <Avatar uri={item.avatar} name={item.title} size={44} />
            ) : (
              <View
                className="size-11 items-center justify-center rounded-2xl"
                style={{ backgroundColor: withAlpha(tone, 0.14) }}
              >
                <Ionicons name={icon} size={21} color={tone} />
              </View>
            )}
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>{item.title}</Text>
              {item.subtitle ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{item.subtitle}</Text>
              ) : null}
            </View>
            <View className="items-end gap-2">
              <Chip size="sm" variant="secondary">
                <Chip.Label>{typeLabel}</Chip.Label>
              </Chip>
              <Ionicons name="arrow-forward" size={17} color={primary} />
            </View>
          </HeroCard.Body>
        </HeroCard>
      </HeroButton>
    );
  }

  function renderEmpty() {
    if (isLoading && debouncedQuery.trim().length > 0 && results.length === 0) {
      return (
        <>
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
          <SearchResultSkeleton />
        </>
      );
    }
    if (debouncedQuery.trim().length === 0) {
      return (
        <View className="px-4 py-8">
          <EmptyState
            icon="search-outline"
            title={t('initialTitle')}
            subtitle={t('startTyping')}
          />
        </View>
      );
    }
    if (error) {
      return (
        <View className="px-4 py-8">
          <EmptyState
            icon="warning-outline"
            title={t('errorTitle')}
            subtitle={t('error')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => void refresh()}
          />
        </View>
      );
    }
    return (
      <View className="px-4 py-8">
        <EmptyState
          icon="search-outline"
          title={t('empty')}
          subtitle={t('emptyHint', { query: debouncedQuery })}
        />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />

      <OfflineBanner />

      {/* Results */}
      <FlatList<SearchResult>
        data={results}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        renderItem={renderResult}
        ListEmptyComponent={renderEmpty}
        onEndReached={() => { if (hasMore) void loadMore(); }}
        onEndReachedThreshold={0.3}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && results.length > 0}
            onRefresh={() => void refresh()}
            tintColor={primary}
            colors={[primary]}
          />
        }
        ListHeaderComponent={
          <SearchHeader
            query={query}
            setQuery={setQuery}
            isLoading={isLoading}
            activeFilter={activeFilter}
            setActiveFilter={setActiveFilter}
            filters={filters}
            filterLabel={filterLabel}
            resultCount={results.length}
            hasQuery={debouncedQuery.trim().length > 0}
            primary={primary}
            theme={theme}
            t={t}
            savedSearches={savedSearches}
            savedSearchesLoading={savedSearchesQuery.isLoading}
            showSaveSearch={showSaveSearch}
            setShowSaveSearch={setShowSaveSearch}
            saveSearchName={saveSearchName}
            setSaveSearchName={setSaveSearchName}
            isSavingSearch={isSavingSearch}
            onSaveSearch={handleSaveSearch}
            onRunSavedSearch={handleRunSavedSearch}
            onDeleteSavedSearch={handleDeleteSavedSearch}
          />
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4 items-center"><Spinner size="sm" /></View>
          ) : !hasMore && results.length > 0 && !isLoading ? (
            <View className="py-4 items-center">
              <Text className="text-xs text-muted-foreground">{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={results.length === 0 ? { flexGrow: 1, paddingBottom: 24 } : { paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

function SearchHeader({
  query,
  setQuery,
  isLoading,
  activeFilter,
  setActiveFilter,
  filters,
  filterLabel,
  resultCount,
  hasQuery,
  primary,
  theme,
  t,
  savedSearches,
  savedSearchesLoading,
  showSaveSearch,
  setShowSaveSearch,
  saveSearchName,
  setSaveSearchName,
  isSavingSearch,
  onSaveSearch,
  onRunSavedSearch,
  onDeleteSavedSearch,
}: {
  query: string;
  setQuery: (value: string) => void;
  isLoading: boolean;
  activeFilter: FilterOption;
  setActiveFilter: (value: FilterOption) => void;
  filters: FilterOption[];
  filterLabel: (filter: FilterOption) => string;
  resultCount: number;
  hasQuery: boolean;
  primary: string;
  theme: Theme;
  t: (key: string, options?: Record<string, unknown>) => string;
  savedSearches: SavedSearch[];
  savedSearchesLoading: boolean;
  showSaveSearch: boolean;
  setShowSaveSearch: (value: boolean) => void;
  saveSearchName: string;
  setSaveSearchName: (value: string) => void;
  isSavingSearch: boolean;
  onSaveSearch: () => void;
  onRunSavedSearch: (item: SavedSearch) => void;
  onDeleteSavedSearch: (item: SavedSearch) => void;
}) {
  const canSaveSearch = hasQuery && query.trim().length > 0;
  return (
    <View className="gap-3 pb-2">
      <HeroCard variant="default" className="mx-4 overflow-hidden rounded-panel p-0">
        <View className="h-1 w-full" style={{ backgroundColor: '#10B981' }} />
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#10B981', 0.14) }}>
              <Ionicons name="search-outline" size={24} color="#10B981" />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('heroEyebrow')}</Text>
              <Text className="mt-1 text-2xl font-bold leading-8" style={{ color: theme.text }}>{t('title')}</Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
            </View>
          </View>
          {hasQuery ? (
            <Chip size="sm" variant="soft" color="success" className="self-start">
              <Ionicons name="sparkles-outline" size={12} color="#10B981" />
              <Chip.Label>{isLoading ? t('searching') : t('resultsCount', { count: resultCount })}</Chip.Label>
            </Chip>
          ) : null}
        </HeroCard.Body>
      </HeroCard>

      <Surface variant="default" className="mx-4 gap-3 rounded-panel-inner p-3">
        <SearchInput
          testID="search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={t('placeholder')}
          clearLabel={t('clearSearch')}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel={t('placeholder')}
          containerClassName="mb-0"
        />

        <Tabs value={activeFilter} onValueChange={(value) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setActiveFilter(value as FilterOption);
        }} variant="secondary">
          <Tabs.List>
            <Tabs.Indicator />
            {filters.map((filter) => {
              const icon = filter === 'all' ? 'apps-outline' : TYPE_ICONS[filter];
              return (
                <Tabs.Trigger key={filter} value={filter}>
                  <Ionicons name={icon} size={15} color={activeFilter === filter ? primary : theme.textMuted} />
                  <Tabs.Label>{filterLabel(filter)}</Tabs.Label>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>
        </Tabs>

        <View className="gap-3 rounded-panel-inner bg-surface-secondary p-3">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('saved.title')}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('saved.subtitle')}</Text>
            </View>
            {canSaveSearch ? (
              <HeroButton size="sm" variant="secondary" onPress={() => setShowSaveSearch(!showSaveSearch)}>
                <Ionicons name="bookmark-outline" size={14} color={primary} />
                <HeroButton.Label>{t('saved.saveThis')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>

          {showSaveSearch ? (
            <View className="gap-2">
              <Input
                value={saveSearchName}
                onChangeText={setSaveSearchName}
                placeholder={t('saved.namePlaceholder')}
                returnKeyType="done"
                onSubmitEditing={onSaveSearch}
                accessibilityLabel={t('saved.namePlaceholder')}
              />
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" size="sm" variant="primary" onPress={onSaveSearch} isDisabled={!saveSearchName.trim() || isSavingSearch}>
                  <HeroButton.Label>{isSavingSearch ? t('saved.saving') : t('saved.save')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => {
                  setShowSaveSearch(false);
                  setSaveSearchName('');
                }}>
                  <HeroButton.Label>{t('saved.cancel')}</HeroButton.Label>
                </HeroButton>
              </View>
            </View>
          ) : null}

          {savedSearchesLoading ? (
            <View className="items-center py-2"><Spinner size="sm" /></View>
          ) : savedSearches.length > 0 ? (
            <View className="gap-2">
              {savedSearches.slice(0, 4).map((item) => (
                <View key={item.id} className="gap-2 rounded-panel-inner bg-background p-3">
                  <View className="flex-row items-center gap-2">
                    <Ionicons name="bookmark" size={14} color={primary} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{item.name}</Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                        {item.query_params.q || t('saved.noQuery')}
                      </Text>
                    </View>
                    {typeof item.last_result_count === 'number' ? (
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{t('saved.resultCount', { count: item.last_result_count })}</Chip.Label>
                      </Chip>
                    ) : null}
                  </View>
                  <View className="flex-row gap-2">
                    <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => onRunSavedSearch(item)}>
                      <HeroButton.Label>{t('saved.run')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => onDeleteSavedSearch(item)} accessibilityLabel={t('saved.deleteNamed', { name: item.name })}>
                      <HeroButton.Label>{t('saved.delete')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('saved.empty')}</Text>
          )}
        </View>
      </Surface>
    </View>
  );
}
