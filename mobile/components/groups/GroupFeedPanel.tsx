// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Card as HeroCard, Spinner, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import FeedItem from '@/components/FeedItem';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import AccentIcon from '@/components/ui/AccentIcon';
import { Ionicons } from '@/components/ui/Icon';
import { excludeGamificationMilestones, getFeed, type FeedItem as FeedItemType, type FeedResponse } from '@/lib/api/feed';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

function extractGroupFeed(response: FeedResponse) {
  return {
    items: excludeGamificationMilestones(response.data ?? []),
    cursor: response.meta?.cursor ?? null,
    hasMore: response.meta?.has_more ?? false,
  };
}

export default function GroupFeedPanel({
  groupId,
  canView,
  refreshToken,
}: {
  groupId: number;
  canView: boolean;
  refreshToken: number;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const fetchFeed = useCallback(
    (cursor: string | null) => getFeed(1, cursor, { groupId, mode: 'recent', perPage: 20 }),
    [groupId],
  );
  const feed = usePaginatedApi<FeedItemType, FeedResponse>(
    fetchFeed,
    extractGroupFeed,
    [groupId, canView],
    { enabled: canView && groupId > 0, clearOnRefusal: true, getKey: item => `${item.type}:${item.id}` },
  );

  useEffect(() => {
    if (refreshToken > 0 && canView) feed.refresh();
    // refreshToken is the parent's explicit pull-to-refresh signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  if (!canView) {
    return <EmptyState icon="lock-closed-outline" title={t('detail.feed.joinTitle')} subtitle={t('detail.feed.joinSubtitle')} />;
  }

  const createPost = () => router.push({ pathname: '/(modals)/new-post', params: { group_id: String(groupId) } } as never);
  const createPoll = () => router.push({ pathname: '/(modals)/polls', params: { create: '1', group_id: String(groupId) } } as never);

  return (
    <View className="gap-3" testID="group-feed-panel">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="newspaper-outline" size={23} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('detail.feed.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('detail.feed.subtitle')}</Text>
            </View>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <HeroButton testID="group-feed-create-post" className="min-w-[132px] flex-1" onPress={createPost}>
              <AccentIcon name="create-outline" size={16} />
              <HeroButton.Label>{t('detail.feed.createPost')}</HeroButton.Label>
            </HeroButton>
            <HeroButton testID="group-feed-create-poll" className="min-w-[132px] flex-1" variant="secondary" onPress={createPoll}>
              <Ionicons name="stats-chart-outline" size={16} color={primary} />
              <HeroButton.Label>{t('detail.feed.createPoll')}</HeroButton.Label>
            </HeroButton>
          </View>
        </HeroCard.Body>
      </HeroCard>

      {feed.isLoading && feed.items.length === 0 ? (
        <HeroCard className="rounded-panel p-0"><HeroCard.Body className="min-h-[150px] items-center justify-center"><Spinner size="md" /></HeroCard.Body></HeroCard>
      ) : feed.error && feed.items.length === 0 ? (
        <ErrorState subtitle={feed.error} onRetry={feed.refresh} isRetrying={feed.isLoading} />
      ) : feed.items.length === 0 ? (
        <EmptyState icon="newspaper-outline" title={t('detail.feed.emptyTitle')} subtitle={t('detail.feed.emptySubtitle')} actionLabel={t('detail.feed.createPost')} onAction={createPost} />
      ) : (
        <>
          {feed.items.map(item => <FeedItem key={`${item.type}:${item.id}`} item={item} />)}
          {feed.error ? <ErrorState subtitle={feed.error} onRetry={feed.loadMore} isRetrying={feed.isLoadingMore} /> : null}
          {feed.hasMore ? (
            <HeroButton testID="group-feed-load-more" variant="secondary" isDisabled={feed.isLoadingMore} onPress={feed.loadMore}>
              {feed.isLoadingMore ? <Spinner size="sm" /> : <HeroButton.Label>{t('common:buttons.loadMore')}</HeroButton.Label>}
            </HeroButton>
          ) : null}
        </>
      )}
    </View>
  );
}
