// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { excludeGamificationMilestones, getHashtagFeed, type FeedItem as FeedItemType } from '@/lib/api/feed';
import ReactorsSheet from '@/components/reactions/ReactorsSheet';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import FeedItem, { type FeedReactorsTarget } from '@/components/FeedItem';

function normalizeTag(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? decodeURIComponent(raw).replace(/^#/, '').trim() : '';
}

export default function FeedHashtagScreen() {
  const { t } = useTranslation(['home', 'common']);
  const params = useLocalSearchParams<{ tag?: string }>();
  const tag = useMemo(() => normalizeTag(params.tag), [params.tag]);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasModule } = useTenant();
  const [items, setItems] = useState<FeedItemType[]>([]);
  const [reactorsTarget, setReactorsTarget] = useState<FeedReactorsTarget | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPosts = useCallback(async (append = false) => {
    if (!tag || !hasModule('feed')) {
      setIsLoading(false);
      return;
    }
    if (append && (!hasMore || isLoadingMore)) return;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const response = await getHashtagFeed(tag, append ? cursor : null);
      // Gamification milestones are not feed content — see excludeGamificationMilestones.
      const nextItems = excludeGamificationMilestones(response.data ?? []);
      setItems((previous) => (append ? [...previous, ...nextItems] : nextItems));
      setCursor(response.meta?.cursor ?? null);
      setHasMore(response.meta?.has_more ?? false);
      setPostCount(response.meta?.total_items ?? (append ? postCount : nextItems.length));
    } catch {
      if (!append) {
        setError(t('hashtag.loadFailed'));
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [cursor, hasModule, hasMore, isLoadingMore, postCount, t, tag]);

  useEffect(() => {
    setItems([]);
    setCursor(null);
    setHasMore(false);
    void loadPosts(false);
    // Reload only when the route target or module availability changes.
    // Cursor updates are handled by explicit pagination calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, hasModule]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setCursor(null);
    void loadPosts(false);
  }, [loadPosts]);

  const renderItem = useCallback(({ item }: { item: FeedItemType }) => <FeedItem item={item} onOpenReactors={setReactorsTarget} />, []);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={tag ? `#${tag}` : t('hashtag.title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/home" />
        {!hasModule('feed') || !tag ? (
          <EmptyState icon="pricetag-outline" title={t('common:errors.notFound')} subtitle={t('feed.emptySubtitle')} />
        ) : isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <EmptyState
            icon="warning-outline"
            title={t('hashtag.unableToLoad')}
            subtitle={error}
            actionLabel={t('common:buttons.retry')}
            onAction={() => void loadPosts(false)}
          />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => `${item.type}-${item.id}`}
            renderItem={renderItem}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={refresh} tintColor={primary} colors={[primary]} />
            }
            onEndReached={() => void loadPosts(true)}
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
              isLoadingMore ? (
                <View className="items-center py-4">
                  <Spinner size="sm" />
                </View>
              ) : hasMore ? (
                <View className="mx-4 py-4">
                  <HeroButton variant="secondary" onPress={() => void loadPosts(true)} className="w-full">
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
