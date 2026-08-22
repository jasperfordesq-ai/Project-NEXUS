// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Image, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { getGroups, type Group, type GroupsResponse } from '@/lib/api/groups';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import AppTopBar from '@/components/ui/AppTopBar';
import OfflineBanner from '@/components/OfflineBanner';
import EmptyState from '@/components/ui/EmptyState';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import { SkeletonBox } from '@/components/ui/Skeleton';

type FilterValue = 'all' | 'public' | 'private';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ApiGroup = Group & {
  viewer_membership?: { status?: string; role?: string } | null;
  avatar_url?: string | null;
  image_url?: string | null;
  type?: string | null;
};

function extractGroupPage(response: GroupsResponse) {
  return {
    items: response.data,
    cursor: response.meta.cursor,
    hasMore: response.meta.has_more,
  };
}

function isJoined(group: ApiGroup) {
  return group.is_member === true || group.viewer_membership?.status === 'active';
}

function groupCover(group: ApiGroup) {
  return resolveImageUrl(group.cover_image ?? group.image_url ?? group.avatar_url ?? null);
}

function GroupCardSkeleton() {
  return (
    <HeroCard className="mx-4 my-1 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row gap-3">
          <SkeletonBox width={54} height={54} style={{ borderRadius: 18 }} />
          <View className="flex-1 gap-2">
            <SkeletonBox width="65%" height={16} />
            <SkeletonBox width="90%" height={12} />
            <SkeletonBox width="55%" height={12} />
          </View>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function StatTile({
  label,
  value,
  tone,
  theme,
}: {
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-1 rounded-panel-inner p-4">
      <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {label}
      </Text>
      <View className="flex-row items-end justify-between gap-2">
        <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
          {value}
        </Text>
        <View className="h-1.5 w-10 rounded-full" style={{ backgroundColor: tone }} />
      </View>
    </Surface>
  );
}

function GroupsHero({
  groups,
  primary,
  theme,
  t,
}: {
  groups: ApiGroup[];
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const featuredCount = groups.filter((group) => group.is_featured).length;
  const joinedCount = groups.filter((group) => isJoined(group)).length;
  const membersCount = groups.reduce((sum, group) => sum + (group.member_count ?? 0), 0);

  return (
    <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-5 p-4 pt-0">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="people-outline" size={24} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('heroEyebrow')}</Text>
            <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('title')}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-3">
          <StatTile label={t('stats.groups')} value={String(groups.length)} tone={primary} theme={theme} />
          <StatTile label={t('stats.featured')} value={String(featuredCount)} tone="#f59e0b" theme={theme} />
          <StatTile label={t('stats.members')} value={String(membersCount)} tone="#22c55e" theme={theme} />
          <StatTile label={t('stats.joined')} value={String(joinedCount)} tone="#8b5cf6" theme={theme} />
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function FilterButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <HeroButton
      className="flex-1"
      size="sm"
      variant={selected ? 'primary' : 'secondary'}
      onPress={onPress}
      accessibilityState={{ selected }}
    >
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function GroupImage({
  group,
  primary,
}: {
  group: ApiGroup;
  primary: string;
}) {
  const image = groupCover(group);
  if (image) {
    return <Image source={{ uri: image }} className="size-16 rounded-2xl bg-default-200" resizeMode="cover" />;
  }

  return (
    <View className="size-16 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
      <Ionicons name="people-outline" size={26} color={primary} />
    </View>
  );
}

function GroupCard({
  item,
  primary,
  theme,
  t,
  onPress,
}: {
  item: ApiGroup;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onPress: () => void;
}) {
  const joined = isJoined(item);
  const visibilityIcon: IoniconName = item.visibility === 'private' ? 'lock-closed-outline' : 'globe-outline';

  return (
    <NativePressable
      className="mx-4 my-2"
      onPress={onPress}
      accessibilityLabel={item.name ?? ''}
      feedback="highlight"
    >
      <HeroCard className="min-h-[148px] w-full rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row gap-3">
            <GroupImage group={item} primary={primary} />
            <View className="min-w-0 flex-1 gap-2">
              <View className="flex-row items-start gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.type ? (
                    <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {item.type}
                    </Text>
                  ) : null}
                </View>
                {item.is_featured ? (
                  <Chip size="sm" variant="secondary" color="warning">
                    <Ionicons name="star-outline" size={12} color="#f59e0b" />
                    <Chip.Label>{t('featured')}</Chip.Label>
                  </Chip>
                ) : null}
              </View>

              {item.description ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                  {item.description}
                </Text>
              ) : null}
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary" color="default">
              <Ionicons name="people-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{t('members', { count: item.member_count ?? 0 })}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="secondary" color="default">
              <Ionicons name="chatbubble-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{t('posts', { count: item.posts_count ?? 0 })}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="secondary" color={item.visibility === 'private' ? 'warning' : 'default'}>
              <Ionicons name={visibilityIcon} size={12} color={theme.textMuted} />
              <Chip.Label>{t(item.visibility === 'private' ? 'private' : 'public')}</Chip.Label>
            </Chip>
            {joined ? (
              <Chip size="sm" variant="secondary" color="success">
                <Ionicons name="checkmark-circle-outline" size={12} color={theme.success} />
                <Chip.Label>{t('joined')}</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

export default function GroupsScreen() {
  const { t } = useTranslation(['groups', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 400);
  const [filter, setFilter] = useState<FilterValue>('all');

  const fetchGroups = useCallback(
    (cursor: string | null) => {
      const params: { search?: string; visibility?: string } = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter !== 'all') params.visibility = filter;
      return getGroups(cursor, params);
    },
    [debouncedSearch, filter],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<Group, GroupsResponse>(fetchGroups, extractGroupPage, [debouncedSearch, filter]);

  const groups = useMemo(() => items as ApiGroup[], [items]);
  const filterOptions: { value: FilterValue; label: string }[] = [
    { value: 'all', label: t('filter.all') },
    { value: 'public', label: t('filter.public') },
    { value: 'private', label: t('filter.private') },
  ];

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/home"
        rightAction={{
          accessibilityLabel: t('newGroup'),
          icon: 'add-outline',
          onPress: () => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push('/(modals)/new-group' as Href);
          },
        }}
      />

      <OfflineBanner />

      <FlatList<ApiGroup>
        data={groups}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <GroupCard
            item={item}
            primary={primary}
            theme={theme}
            t={t}
            onPress={() => {
              router.push({ pathname: '/(modals)/group-detail', params: { id: String(item.id) } });
            }}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && groups.length > 0}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
        onEndReached={() => { if (hasMore) loadMore(); }}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View className="gap-3 px-4 pb-3">
            <GroupsHero groups={groups} primary={primary} theme={theme} t={t} />

            <Surface variant="default" className="gap-3 rounded-panel p-3">
              <SearchInput
                testID="groups-search"
                value={search}
                onChangeText={setSearch}
                placeholder={t('searchPlaceholder')}
                clearLabel={t('clearSearch')}
                returnKeyType="search"
                accessibilityLabel={t('searchPlaceholder')}
                containerClassName="mb-0"
                groupClassName="min-h-12 rounded-full bg-content2"
              />

              <View className="flex-row gap-2">
                {filterOptions.map((option) => (
                  <FilterButton
                    key={option.value}
                    label={option.label}
                    selected={filter === option.value}
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setFilter(option.value);
                    }}
                  />
                ))}
              </View>
            </Surface>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <><GroupCardSkeleton /><GroupCardSkeleton /><GroupCardSkeleton /></>
          ) : error ? (
            <Surface variant="secondary" className="mx-4 items-center gap-3 rounded-panel p-6">
              <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
              <Text className="text-center text-sm text-danger">{error}</Text>
              <HeroButton variant="secondary" onPress={() => void refresh()}>
                <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
              </HeroButton>
            </Surface>
          ) : (
            <View className="px-4 pt-4">
              <EmptyState icon="people-outline" title={t('empty')} />
            </View>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="items-center py-4"><Spinner size="sm" /></View>
          ) : !hasMore && groups.length > 0 && !isLoading ? (
            <View className="items-center py-4">
              <Text className="text-xs text-muted-foreground">{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 112 }}
      />
    </SafeAreaView>
  );
}
