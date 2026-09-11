// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { Ionicons } from '@/components/ui/Icon';
import SearchInput from '@/components/ui/SearchInput';
import { Chip } from '@/components/ui/StatusChip';
import { getPodcastShows, type PodcastPage, type PodcastShow } from '@/lib/api/podcasts';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withRouteGate } from '@/components/withRouteGate';

function PodcastsScreen() {
  const { t } = useTranslation(['podcasts', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  /*
    🔴 The catalogue asked for one page and stopped. `getPodcastShows` has always
    returned `page`, `total` and `hasMore` and this screen read none of them, so a
    community with more than twenty shows had the rest invisible from the phone — and
    because the search box submits to the server, a show on page two could at least be
    searched for, which is the only reason this was survivable. Audit 2026-09-07.

    Page-NUMBER paging, like the course catalogue: the "cursor" handed to
    `usePaginatedApi` is the next page number as a string.
  */
  const fetchShows = useCallback(
    (cursor: string | null) => getPodcastShows({
      query: query || undefined,
      sort: 'newest',
      page: cursor ? Number(cursor) : 1,
    }),
    [query],
  );

  const extractShows = useCallback((page: PodcastPage) => ({
    items: page.items,
    cursor: page.hasMore ? String(page.page + 1) : null,
    hasMore: page.hasMore,
  }), []);

  // Keyed on the search term: changing it restarts at page one, because appending page
  // two of a filtered list under page one of an unfiltered one is worse than not paging.
  const shows = usePaginatedApi<PodcastShow, PodcastPage>(fetchShows, extractShows, [query]);
  const { items, isLoading, isLoadingMore, error, refresh, loadMore } = shows;

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<PodcastShow>
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 44 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh()} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={<View className="mb-4 gap-4"><HeroCard className="overflow-hidden rounded-panel p-0"><View className="h-1" style={{ backgroundColor: primary }} /><HeroCard.Body className="gap-1 p-4"><Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('title')}</Text><Text className="leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
                {/*
                  🔴 The studio needs a door on this screen, exactly as
                  `PodcastsPage.tsx` gives it one. Without these two it is reachable
                  only from the "+" menu, so a member who already has a show has no
                  way back to it — the same "the feature must not exist" conclusion
                  the 2026-09-06 report was about, one level down.
                */}
                <View className="mt-3 flex-row gap-2">
                  <HeroButton className="flex-1" size="sm" variant="secondary" testID="podcasts-studio" onPress={() => router.push('/(modals)/podcast-studio')}>
                    <HeroButton.Label>{t('studio.title')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" size="sm" variant="primary" testID="podcasts-create-show" onPress={() => router.push('/(modals)/podcast-studio')}>
                    <Ionicons name="add-outline" size={16} color={theme.text} />
                    <HeroButton.Label>{t('studio.create_show')}</HeroButton.Label>
                  </HeroButton>
                </View></HeroCard.Body></HeroCard><SearchInput value={search} onChangeText={(value) => { setSearch(value); if (!value) setQuery(''); }} onSubmitEditing={() => setQuery(search.trim())} placeholder={t('browse.search_placeholder')} accessibilityLabel={t('browse.search_placeholder')} clearLabel={t('common:actions.clear')} returnKeyType="search" /></View>}
          onEndReachedThreshold={0.5}
          onEndReached={() => loadMore()}
          ListFooterComponent={isLoadingMore ? <View className="py-6"><LoadingSpinner /></View> : null}
          renderItem={({ item }) => <NativePressable accessibilityLabel={item.title} feedback="highlight" onPress={() => router.push({ pathname: '/(modals)/podcast-show', params: { slug: item.slug } })}><HeroCard className="mb-3 rounded-panel"><HeroCard.Body className="gap-2 p-4"><View className="flex-row flex-wrap gap-2">{item.category ? <Chip size="sm" variant="secondary"><Chip.Label>{item.category}</Chip.Label></Chip> : null}<Chip size="sm" variant="secondary"><Chip.Label>{t('show.episode_count', { count: item.episode_count })}</Chip.Label></Chip></View><Text className="text-lg font-bold" style={{ color: theme.text }}>{item.title}</Text>{item.summary ? <Text className="leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{item.summary}</Text> : null}</HeroCard.Body></HeroCard></NativePressable>}
          ListEmptyComponent={isLoading ? <View className="py-12"><LoadingSpinner /></View> : <EmptyState icon={error ? 'warning-outline' : 'mic-outline'} title={error ?? t('browse.empty')} subtitle={error ? undefined : t('browse.empty_hint')} actionLabel={error ? t('browse.retry') : undefined} onAction={error ? () => refresh() : undefined} />}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

export default withRouteGate(PodcastsScreen, 'podcasts');
