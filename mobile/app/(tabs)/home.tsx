// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText , withAlpha } from '@/lib/utils/color';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, Tabs } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';

import { reportException } from '@/lib/observability/report';
import { useTranslation } from 'react-i18next';
import { excludeGamificationMilestones, getFeed, type FeedFilter, type FeedItem as FeedItemType, type FeedMode, type FeedResponse } from '@/lib/api/feed';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useRealtimeContext } from '@/lib/context/RealtimeContext';
import FeedItem, { type FeedCommentTarget, type FeedReactorsTarget } from '@/components/FeedItem';
import CommentSheet from '@/components/comments/CommentSheet';
import ReactorsSheet from '@/components/reactions/ReactorsSheet';
import OfflineBanner from '@/components/OfflineBanner';
import TenantBanner from '@/components/TenantBanner';
import { FeedItemSkeleton } from '@/components/ui/Skeleton';
import FAB from '@/components/ui/FAB';
import * as Haptics from '@/lib/haptics';
import { feedVersion } from '@/lib/feedRefreshSignal';
import NativePressable from '@/components/ui/NativePressable';

function extractFeedPage(response: FeedResponse) {
  if (!response?.data || !response?.meta) {
    console.error('Unexpected feed response shape:', response);
    reportException(new Error('Unexpected feed response shape'));
    return { items: [], cursor: null, hasMore: false };
  }
  const seen = new Set<string>();
  // Gamification milestone cards are not feed content — see
  // excludeGamificationMilestones. Dropped before dedupe so a stale cached page
  // cannot leave a blank row behind.
  const unique = excludeGamificationMilestones(response.data).filter((item) => {
    const key = `${item.type}-${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    items: unique,
    cursor: response.meta.cursor ?? null,
    hasMore: response.meta.has_more ?? false,
  };
}

const FILTER_OPTIONS: { key: FeedFilter; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', icon: 'albums-outline' },
  { key: 'following', icon: 'people-outline' },
  { key: 'saved', icon: 'bookmark-outline' },
  { key: 'posts', icon: 'chatbox-ellipses-outline' },
  { key: 'listings', icon: 'swap-horizontal-outline' },
  { key: 'events', icon: 'calendar-outline' },
  { key: 'polls', icon: 'stats-chart-outline' },
  { key: 'challenges', icon: 'trophy-outline' },
  { key: 'volunteering', icon: 'heart-outline' },
];

const LISTING_SUBFILTERS = ['offer', 'request'] as const;

export default function HomeScreen() {
  const { t } = useTranslation(['home', 'common', 'exchanges']);
  const { displayName } = useAuth();
  const { hasModule } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [feedMode, setFeedMode] = useState<FeedMode>('ranking');
  const [filter, setFilter] = useState<FeedFilter>('all');
  const [subFilter, setSubFilter] = useState<string | null>(null);
  const [commentTarget, setCommentTarget] = useState<FeedCommentTarget | null>(null);
  const [reactorsTarget, setReactorsTarget] = useState<FeedReactorsTarget | null>(null);
  const [commentCountOverrides, setCommentCountOverrides] = useState<Record<string, number>>({});
  // Mirror for stable callbacks — handleOpenComments must not be recreated on
  // every count change or the memoized FeedItem rows all re-render.
  const commentCountOverridesRef = useRef<Record<string, number>>({});
  commentCountOverridesRef.current = commentCountOverrides;

  const fetchFeed = useCallback(
    (cursor: string | null) => getFeed(1, cursor, { filter, mode: feedMode, subtype: subFilter }),
    [feedMode, filter, subFilter],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<FeedItemType, FeedResponse>(fetchFeed, extractFeedPage, [feedMode, filter, subFilter]);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const wasRefreshingRef = useRef(false);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    wasRefreshingRef.current = true;
    refresh();
  }, [refresh]);

  /*
    🔴 Re-read on focus ONLY when a writer says the feed moved on.
    This screen deliberately does not refetch on every focus — it is the app's busiest
    list and a request per tab switch is real cost. But a member who writes a post and
    comes back to a list without it in reads that as a post that was not saved. The
    marker in lib/feedRefreshSignal.ts is the narrow fix: one comparison, no extra fetch
    unless something was written.
  */
  const seenFeedVersion = useRef(feedVersion());
  useFocusEffect(
    useCallback(() => {
      const current = feedVersion();
      if (current !== seenFeedVersion.current) {
        seenFeedVersion.current = current;
        refresh();
      }
    }, [refresh]),
  );

  useEffect(() => {
    if (wasRefreshingRef.current && !isLoading) {
      wasRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [isLoading]);

  const { unreadNotifications } = useRealtimeContext();
  const notificationBadgeText =
    unreadNotifications > 99 ? '99+' : unreadNotifications > 0 ? String(unreadNotifications) : null;

  const handleOpenComments = useCallback((target: FeedCommentTarget) => {
    const key = `${target.targetType}-${target.targetId}`;
    setCommentTarget({
      ...target,
      initialCount: commentCountOverridesRef.current[key] ?? target.initialCount,
    });
  }, []);

  const handleOpenReactors = useCallback((target: FeedReactorsTarget) => {
    setReactorsTarget(target);
  }, []);

  const handleCommentCountChange = useCallback((count: number) => {
    if (!commentTarget) return;
    const key = `${commentTarget.targetType}-${commentTarget.targetId}`;
    setCommentCountOverrides((previous) => ({ ...previous, [key]: count }));
    setCommentTarget({ ...commentTarget, initialCount: count });
  }, [commentTarget]);

  const renderItem = useCallback(({ item }: { item: FeedItemType }) => {
    const commentKey = `${item.type}-${item.id}`;
    return (
      <FeedItem
        item={item}
        commentsCountOverride={commentCountOverrides[commentKey]}
        onOpenComments={handleOpenComments}
        onOpenReactors={handleOpenReactors}
      />
    );
  }, [commentCountOverrides, handleOpenComments, handleOpenReactors]);
  const keyExtractor = useCallback((item: FeedItemType) => `${item.type}-${item.id}`, []);

  const handleFilterChange = useCallback((nextFilter: FeedFilter) => {
    setFilter(nextFilter);
    if (nextFilter !== 'listings') {
      setSubFilter(null);
    }
  }, []);

  /**
   * 🔴 `style={{ flex: 1 }}` on the SafeAreaView is REQUIRED; the className is inert.
   * uniwind does not patch className onto react-native-safe-area-context's SafeAreaView
   * — see components/safeAreaFlex.test.ts — so `flex-1` here does nothing. The feed
   * itself survived that, which is why home was left out of the earlier sweep. The
   * COMMENT SHEET did not: tapping Comment fetched the comments (confirmed in the API
   * log: `GET /api/v2/comments?target_type=listing&target_id=515`) and nothing ever
   * appeared on screen, because a gorhom bottom sheet inside a zero-height parent has
   * nowhere to draw.
   */
  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <TenantBanner />
      <OfflineBanner />

      <FlatList<FeedItemType>
        testID="feed-list"
        data={items}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.7}
        removeClippedSubviews
        maxToRenderPerBatch={8}
        windowSize={5}
        ListHeaderComponent={
          <View className="pb-2">
            <Surface
              variant="default"
              className="mx-3 mt-2 gap-2.5 overflow-hidden rounded-panel px-3 py-2.5"
              style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
            >
              <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
              <View className="flex-row items-center justify-between gap-2 pl-1">
                <View className="min-w-0 flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <View className="h-7 w-7 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="albums-outline" size={15} color={primary} />
                    </View>
                    <Text className="min-w-0 flex-1 text-lg font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>
                      {t('feed.title')}
                    </Text>
                  </View>
                  <Text className="text-xs font-semibold" style={{ color: primary }} numberOfLines={1}>
                    {t('feed.greeting', { name: (displayName || '').split(' ')[0] || t('common:labels.friend') })}
                  </Text>
                  <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {t('feed.subtitle')}
                  </Text>
                </View>
                {/*
                  🔴 The only in-app door to hashtag discovery. `feed-hashtags` — and
                  through it `feed-hashtag`, the single-tag feed — was reachable by
                  deep link alone, so hashtags shown on a post led somewhere a member
                  could never navigate to deliberately. The web feed carries the same
                  entry point (`TrendingHashtags` → /feed/hashtags). Found by the
                  2026-09-06 audit.
                */}
                <HeroButton
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  testID="home-hashtags"
                  className="mr-2 h-10 w-10 rounded-2xl"
                  onPress={() => router.push('/(modals)/feed-hashtags')}
                  accessibilityLabel={t('hashtags.title')}
                  accessibilityRole="button"
                  style={{
                    backgroundColor: withAlpha(primary, 0.12),
                    borderColor: withAlpha(primary, 0.24),
                    borderWidth: 1,
                  }}
                >
                  <Ionicons name="pricetags-outline" size={20} color={primary} />
                </HeroButton>
                <View className="relative h-10 w-10 items-center justify-center">
                  <HeroButton
                    isIconOnly
                    size="sm"
                    variant="secondary"
                    className="h-10 w-10 rounded-2xl"
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      router.push('/(modals)/notifications');
                    }}
                    accessibilityLabel={t('notifications.title')}
                    accessibilityRole="button"
                    style={{
                      backgroundColor: withAlpha(primary, 0.12),
                      borderColor: withAlpha(primary, 0.24),
                      borderWidth: 1,
                    }}
                  >
                    <Ionicons name="notifications-outline" size={20} color={primary} />
                  </HeroButton>
                  {notificationBadgeText ? (
                    <View
                      className="absolute right-0 top-0 h-5 min-w-5 items-center justify-center rounded-full border-2 border-background px-1"
                      style={{ backgroundColor: primary }}
                    >
                      <Text className="text-[10px] font-bold leading-3" style={{ color: contrastText(primary) }}>
                        {notificationBadgeText}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              <View className="flex-row items-center justify-between gap-3">
                <Tabs value={feedMode} onValueChange={(value) => setFeedMode(value as FeedMode)} variant="secondary" className="flex-1">
                  <Tabs.List>
                    <Tabs.Indicator />
                    <Tabs.Trigger value="ranking">
                      <Ionicons name="sparkles-outline" size={15} color={primary} />
                      <Tabs.Label>{t('mode.forYou')}</Tabs.Label>
                    </Tabs.Trigger>
                    <Tabs.Trigger value="recent">
                      <Ionicons name="time-outline" size={15} color={primary} />
                      <Tabs.Label>{t('mode.recent')}</Tabs.Label>
                    </Tabs.Trigger>
                  </Tabs.List>
                </Tabs>
                {filter !== 'all' || subFilter ? (
                  <HeroButton
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    className="h-9 w-9 rounded-2xl"
                    onPress={() => {
                      setFilter('all');
                      setSubFilter(null);
                    }}
                    accessibilityLabel={t('filter.clear')}
                    style={{ backgroundColor: withAlpha(primary, 0.08) }}
                  >
                    <Ionicons name="close-circle-outline" size={20} color={primary} />
                  </HeroButton>
                ) : null}
              </View>

              {/*
                The filter row scrolls, and it has to LOOK like it scrolls. It was
                laid out inside the Surface's padding, so the last visible chip was
                sliced mid-word ("Exchan") with a gap after it — which reads as broken
                text rather than as more content to the right.

                `-mx-4` cancels the Surface's base `p-4` so the row bleeds to the
                card's own edge, and `px-4` inside the content container keeps the
                first chip aligned with the heading above it. A chip cut at the card
                boundary is the conventional "scroll for more" cue.

                🔴 A gradient fade would be better still, and `heroui-native` ships
                `ScrollShadow` for exactly this — but it requires
                `LinearGradientComponent`, and `expo-linear-gradient` is not a
                dependency of this app. Adding a native module and a rebuild for a
                fade was not worth it here; revisit if that dependency arrives for
                another reason.
              */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="-mx-4"
                contentContainerClassName="gap-2 px-4"
              >
                {FILTER_OPTIONS.map((option) => (
                  <Chip
                    key={option.key}
                    size="sm"
                    variant={filter === option.key ? 'secondary' : 'soft'}
                    color={filter === option.key ? 'accent' : 'default'}
                    onPress={() => handleFilterChange(option.key)}
                    accessibilityLabel={t(`filter.${option.key}`)}
                  >
                    <Ionicons name={option.icon} size={13} color={filter === option.key ? primary : theme.textSecondary} />
                    <Chip.Label>{t(`filter.${option.key}`)}</Chip.Label>
                  </Chip>
                ))}
              </ScrollView>

              {filter === 'listings' ? (
                <View className="flex-row flex-wrap gap-2">
                  {LISTING_SUBFILTERS.map((option) => (
                    <Chip
                      key={option}
                      size="sm"
                      variant={subFilter === option ? 'primary' : 'soft'}
                      color={subFilter === option ? 'accent' : 'default'}
                      onPress={() => setSubFilter(subFilter === option ? null : option)}
                    >
                      <Chip.Label>{t(`subFilter.${option}`)}</Chip.Label>
                    </Chip>
                  ))}
                </View>
              ) : null}
            </Surface>

            {/*
              🔴 The way in to writing a post. There was none at all until 2026-08-23 —
              this app could read a community's feed and never add to it (journey 2.9).
              A NativePressable rather than a HeroButton because a button caps its own
              height and crops row-shaped content, which cost two other screens their
              contents in the same week.
            */}
            {hasModule('feed') ? (
              <NativePressable
                feedback="scale"
                testID="feed-composer-trigger"
                className="mx-3 mt-2"
                accessibilityRole="button"
                accessibilityLabel={t('newPost.title')}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push('/(modals)/new-post');
                }}
              >
                <Surface
                  variant="default"
                  className="flex-row items-center gap-3 overflow-hidden rounded-panel px-3 py-2.5"
                  style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: withAlpha(primary, 0.14) }}
                  >
                    <Ionicons name="create-outline" size={18} color={primary} />
                  </View>
                  <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {t('newPost.placeholder')}
                  </Text>
                  <Ionicons name="chevron-forward-outline" size={18} color={theme.textSecondary} />
                </Surface>
              </NativePressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <>
              <FeedItemSkeleton />
              <FeedItemSkeleton />
              <FeedItemSkeleton />
            </>
          ) : error ? (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-4">
                <Ionicons name="cloud-offline-outline" size={30} color={primary} />
                <Text className="text-center text-sm leading-5 text-danger">{error}</Text>
                <HeroButton
                  variant="primary"
                  onPress={() => void refresh()}
                >
                  <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-2">
                <Ionicons name="sparkles-outline" size={30} color={primary} />
                <Text className="text-center text-[17px] font-semibold" style={{ color: theme.text }}>{t('feed.emptyTitle')}</Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{t('feed.emptySubtitle')}</Text>
              </HeroCard.Body>
            </HeroCard>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <>
              <FeedItemSkeleton />
              <FeedItemSkeleton />
            </>
          ) : !hasMore && items.length > 0 && !isLoading ? (
            <View className="items-center py-4">
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 28 }}
      />

      {/*
        🔴 An explicit name, because the default is "Action button" — measured with TalkBack
        on 2026-08-24, where the only floating button on the home screen announced itself as
        "Action button" and told a blind member nothing about what it does.
      */}
      <FAB
        icon="add"
        onPress={() => router.push('/(modals)/new-exchange')}
        position="bottom-right"
        accessibilityLabel={t('home:composer.exchange')}
      />
      <ReactorsSheet
        visible={Boolean(reactorsTarget)}
        targetType={reactorsTarget?.targetType ?? 'post'}
        targetId={reactorsTarget?.targetId ?? 0}
        reactions={reactorsTarget?.reactions ?? null}
        onClose={() => setReactorsTarget(null)}
      />
      <CommentSheet
        visible={Boolean(commentTarget)}
        targetType={commentTarget?.targetType ?? 'post'}
        targetId={commentTarget?.targetId ?? 0}
        initialCount={commentTarget?.initialCount ?? 0}
        strings={{
          title: t('comment'),
          placeholder: t('exchanges:detail.commentPlaceholder'),
          empty: t('exchanges:detail.noComments'),
          loadFailed: t('exchanges:detail.commentsFailed'),
          submitFailed: t('exchanges:detail.commentFailed'),
          actionFailedTitle: t('exchanges:detail.actionFailedTitle'),
          reactionFailed: t('exchanges:detail.likeFailed'),
          send: t('common:buttons.send'),
          authorFallback: t('common:labels.member'),
          reply: t('exchanges:detail.commentReply'),
          replyingTo: t('exchanges:detail.commentReplyingTo'),
          edit: t('common:buttons.edit'),
          editing: t('exchanges:detail.commentEditing'),
          delete: t('common:buttons.delete'),
          deleteConfirmTitle: t('exchanges:detail.commentDeleteTitle'),
          deleteConfirmMessage: t('exchanges:detail.commentDeleteMessage'),
          edited: t('exchanges:detail.commentEdited'),
          cancel: t('common:buttons.cancel'),
          like: t('exchanges:detail.commentLike'),
          editFailed: t('exchanges:detail.commentEditFailed'),
          deleteFailed: t('exchanges:detail.commentDeleteFailed'),
        }}
        onClose={() => setCommentTarget(null)}
        onCountChange={handleCommentCountChange}
      />
    </SafeAreaView>
  );
}
