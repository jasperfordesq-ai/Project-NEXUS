// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import AccentIcon from '@/components/ui/AccentIcon';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Spinner, Surface } from 'heroui-native';

import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import { getMembers, type Member, type MemberListResponse } from '@/lib/api/members';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import MemberCard from '@/components/MemberCard';
import SearchInput from '@/components/ui/SearchInput';
import { SkeletonBox } from '@/components/ui/Skeleton';
import AppTopBar from '@/components/ui/AppTopBar';

function MemberCardSkeleton() {
  const theme = useTheme();
  return (
    <Surface
      variant="default"
      className="mx-4 my-1.5 overflow-hidden rounded-panel p-4"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="flex-row items-center gap-3">
        <SkeletonBox width={56} height={56} borderRadius={28} />
        <View className="flex-1 gap-2">
          <SkeletonBox width="62%" height={16} />
          <SkeletonBox width="82%" height={12} />
          <SkeletonBox width="46%" height={12} />
        </View>
      </View>
    </Surface>
  );
}

function extractMembersPage(response: MemberListResponse) {
  const nextOffset = response.meta.offset + response.data.length;
  return {
    items: response.data,
    cursor: response.meta.has_more ? String(nextOffset) : null,
    hasMore: response.meta.has_more,
  };
}

export default function MembersScreen() {
  const { t } = useTranslation(['members', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const debouncedSearch = useDebounce(search, 400);

  const fetchMembers = useCallback(
    async (cursor: string | null) => {
      const offset = cursor ? Number(cursor) : 0;
      const response = await getMembers(Number.isFinite(offset) ? offset : 0, debouncedSearch || undefined);
      setTotalMembers(response.meta.total_items ?? null);
      return response;
    },
    [debouncedSearch],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<Member, MemberListResponse>(fetchMembers, extractMembersPage, [debouncedSearch]);

  const hasSearch = search.trim().length > 0;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('title')} backLabel={t('back')} fallbackHref="/(tabs)/home" />
      <FlatList<Member>
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <MemberCard member={item} />}
        ListHeaderComponent={
          <MembersHeader
            t={t}
            primary={primary}
            theme={theme}
            search={search}
            setSearch={setSearch}
            totalCount={totalMembers ?? items.length}
            isLoading={isLoading}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading && items.length > 0}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
        onEndReached={() => { if (hasMore) void loadMore(); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          isLoading ? (
            <>
              <MemberCardSkeleton />
              <MemberCardSkeleton />
              <MemberCardSkeleton />
              <MemberCardSkeleton />
              <MemberCardSkeleton />
            </>
          ) : error ? (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-4">
                <Ionicons name="warning-outline" size={30} color={primary} />
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{error}</Text>
                <ActionPill label={t('common:buttons.retry')} primary={primary} onPress={() => void refresh()} />
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-3">
                <Ionicons name={hasSearch ? 'search-outline' : 'people-outline'} size={34} color={primary} />
                <Text className="text-center text-[17px] font-semibold" style={{ color: theme.text }}>
                  {hasSearch ? t('empty.noResults', { query: debouncedSearch }) : t('empty.title')}
                </Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('empty.subtitle')}
                </Text>
                {hasSearch ? (
                  <ActionPill
                    label={t('clearSearch')}
                    icon="close-circle-outline"
                    primary={primary}
                    tone="secondary"
                    onPress={() => setSearch('')}
                  />
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4 items-center"><Spinner size="sm" /></View>
          ) : !hasMore && items.length > 0 && !isLoading ? (
            <View className="py-4 items-center">
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      />
    </SafeAreaView>
  );
}

type TFunction = (key: string, options?: Record<string, unknown>) => string;

function MembersHeader({
  t,
  primary,
  theme,
  search,
  setSearch,
  totalCount,
  isLoading,
}: {
  t: TFunction;
  primary: string;
  theme: Theme;
  search: string;
  setSearch: (value: string) => void;
  totalCount: number;
  isLoading: boolean;
}) {
  return (
    <View className="gap-3 pb-3">
      <HeroCard variant="default" className="mx-4 mt-3 overflow-hidden rounded-panel p-0">
        <View className="h-1 w-full" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="people-outline" size={24} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {t('heroEyebrow')}
              </Text>
              <Text className="mt-1 text-[26px] font-bold leading-8" style={{ color: theme.text }} numberOfLines={1}>
                {t('title')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                {t('subtitle')}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="soft" color="accent">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{isLoading ? t('resultsLoading') : t('memberCount', { count: totalCount })}</Chip.Label>
            </Chip>
          </View>
        </HeroCard.Body>
      </HeroCard>

      <Surface
        variant="default"
        className="mx-4 gap-3 overflow-hidden rounded-panel p-3.5"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="min-w-0">
          <Text className="text-base font-semibold" style={{ color: theme.text }}>
            {t('directory')}
          </Text>
          <Text className="mt-0.5 text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {t('filtersIntro')}
          </Text>
        </View>

        <SearchInput
          testID="members-search"
          value={search}
          onChangeText={setSearch}
          placeholder={t('search.placeholder')}
          clearLabel={t('clearSearch')}
          returnKeyType="search"
          accessibilityLabel={t('search.placeholder')}
          containerClassName="mb-0"
          groupClassName="min-h-12 rounded-full bg-surface-secondary"
        />
      </Surface>
    </View>
  );
}

function ActionPill({
  label,
  icon,
  primary,
  tone = 'primary',
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  primary: string;
  tone?: 'primary' | 'secondary';
  onPress: () => void;
}) {
  const isPrimary = tone === 'primary';
  return (
    <HeroButton
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      accessibilityLabel={label}
      onPress={onPress}
      size="sm"
      variant={isPrimary ? 'primary' : 'secondary'}
      // The primary variant paints its own accent fill and picks a readable label for it;
      // a hardcoded white label was invisible on a pale community colour.
      style={isPrimary ? undefined : {
        backgroundColor: withAlpha(primary, 0.1),
        borderColor: withAlpha(primary, 0.18),
        borderWidth: 1,
      }}
    >
      {icon ? (isPrimary ? <AccentIcon name={icon} size={16} /> : <Ionicons name={icon} size={16} color={primary} />) : null}
      {isPrimary ? (
        <HeroButton.Label className="text-sm font-bold">{label}</HeroButton.Label>
      ) : (
        <HeroButton.Label className="text-sm font-bold" style={{ color: primary }}>{label}</HeroButton.Label>
      )}
    </HeroButton>
  );
}
