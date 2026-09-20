// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Spinner } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import { excludeGamificationMilestones, getHashtagFeed, type FeedItem as FeedItemType } from '@/lib/api/feed';
import ReactorsSheet from '@/components/reactions/ReactorsSheet';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import FeedItem, { type FeedReactorsTarget } from '@/components/FeedItem';
import { withRouteGate } from '@/components/withRouteGate';

function normalizeTag(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  // Expo Router already decodes parameters. A second decode corrupts literal %
  // sequences and throws for otherwise harmless tags containing a percent sign.
  return raw ? raw.replace(/^#/, '').trim() : '';
}

function extractHashtagPage(response: Awaited<ReturnType<typeof getHashtagFeed>>) {
  return {
    items: excludeGamificationMilestones(response.data ?? []),
    cursor: response.meta?.cursor ?? null,
    hasMore: response.meta?.has_more ?? false,
  };
}

function FeedHashtagScreen() {
  const { t } = useTranslation(['home', 'common']);
  const params = useLocalSearchParams<{ tag?: string }>();
  const tag = useMemo(() => normalizeTag(params.tag), [params.tag]);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasModule } = useTenant();
  const [reactorsTarget, setReactorsTarget] = useState<FeedReactorsTarget | null>(null);
  const feedEnabled = hasModule('feed') && Boolean(tag);
  const fetchPosts = useCallback((cursor: string | null) => getHashtagFeed(tag, cursor), [tag]);
  const { items, response, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi(fetchPosts, extractHashtagPage, [tag], {
      enabled: feedEnabled,
      getKey: (item) => `${item.type}-${item.id}`,
    });
  const postCount = response?.meta?.total_items ?? items.length;
  const renderItem = useCallback(({ item }: { item: FeedItemType }) => <FeedItem item={item} onOpenReactors={setReactorsTarget} />, []);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={tag ? `#${tag}` : t('hashtag.title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/home" />
        {!hasModule('feed') || !tag ? (
          <EmptyState icon="pricetag-outline" title={t('common:errors.notFound')} subtitle={t('feed.emptySubtitle')} />
        ) : isLoading && items.length === 0 ? (
          <LoadingSpinner />
        ) : error && items.length === 0 ? (
          <EmptyState
            icon="warning-outline"
            title={t('hashtag.unableToLoad')}
            subtitle={t('hashtag.loadFailed')}
            actionLabel={t('common:buttons.retry')}
            onAction={refresh}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={isLoading && items.length > 0} onRefresh={refresh} tintColor={primary} colors={[primary]} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.3}
            ListHeaderComponent={
              <HeroCard variant="secondary" className="mx-4 mb-3">
                <HeroCard.Body className="flex-row items-center gap-3 p-4">
                  <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: primary }}>
                    <Ionicons name="pricetag-outline" size={20} color="#fff" />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>
                      #{tag}
                    </Text>
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>
                      {postCount > 0 ? t('hashtag.postCount', { count: postCount }) : t('hashtag.subtitle')}
                    </Text>
                  </View>
                </HeroCard.Body>
              </HeroCard>
            }
            ListEmptyComponent={
              <EmptyState icon="sparkles-outline" title={t('hashtag.emptyTitle')} subtitle={t('hashtag.emptySubtitle', { tag })} />
            }
            ListFooterComponent={
              error ? (
                <ErrorState title={t('hashtag.unableToLoad')} subtitle={t('hashtag.loadFailed')} onRetry={refresh} isRetrying={isLoading || isLoadingMore} />
              ) : isLoadingMore ? (
                <View className="items-center py-4">
                  <Spinner size="sm" />
                </View>
              ) : hasMore ? (
                <View className="mx-4 py-4">
                  <HeroButton variant="secondary" onPress={loadMore} className="w-full">
                    <HeroButton.Label>{t('common:buttons.loadMore')}</HeroButton.Label>
                  </HeroButton>
                </View>
              ) : items.length > 0 ? (
                <View className="items-center py-4">
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
                </View>
              ) : null
            }
            contentContainerStyle={{ paddingBottom: 28 }}
          />
        )}
        <ReactorsSheet
        visible={Boolean(reactorsTarget)}
        targetType={reactorsTarget?.targetType ?? 'post'}
        targetId={reactorsTarget?.targetId ?? 0}
        reactions={reactorsTarget?.reactions ?? null}
        onClose={() => setReactorsTarget(null)}
      />
    </SafeAreaView>
    </ModalErrorBoundary>
  );
}

export default withRouteGate(FeedHashtagScreen, 'feed-hashtag');
