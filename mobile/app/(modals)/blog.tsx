// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useState } from 'react';
import {
  FlatList,
  Image,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import { getBlogPosts, type BlogPost, type BlogListResponse } from '@/lib/api/blog';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

function extractBlogPage(response: BlogListResponse) {
  return {
    items: response.data,
    cursor: response.meta.cursor,
    hasMore: response.meta.has_more,
  };
}

function ActionPill({
  label,
  icon,
  onPress,
  primary,
  tone = 'secondary',
  accessibilityLabel,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary: string;
  tone?: 'primary' | 'secondary';
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const isPrimary = tone === 'primary';

  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant={isPrimary ? 'primary' : 'secondary'}
      style={{
        backgroundColor: isPrimary ? primary : withAlpha(primary, 0.12),
        borderWidth: isPrimary ? 0 : 1,
        borderColor: isPrimary ? 'transparent' : withAlpha(primary, 0.22),
      }}
    >
      <Ionicons name={icon} size={16} color={isPrimary ? '#ffffff' : primary} />
      <HeroButton.Label className="text-sm font-semibold" style={{ color: isPrimary ? '#ffffff' : theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

export default function BlogScreen() {
  const { t } = useTranslation(['blog', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');

  const fetchPosts = useCallback(
    (cursor: string | null) => getBlogPosts(cursor, committedSearch.trim() || undefined),
    [committedSearch],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<BlogPost, BlogListResponse>(fetchPosts, extractBlogPage, [committedSearch]);

  function submitSearch() {
    setCommittedSearch(search.trim());
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (value.length === 0 && committedSearch) {
      setCommittedSearch('');
    }
  }

  function openPost(item: BlogPost) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({ pathname: '/(modals)/blog-post', params: { id: item.slug } });
  }

  function renderHeader() {
    return (
      <View className="pb-3">
        <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}>
          <View className="h-1" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-5">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="book-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {t('heroEyebrow')}
                </Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
                  {t('title')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                  {t('subtitle')}
                </Text>
              </View>
            </View>
            {items.length > 0 ? (
              <Surface variant="secondary" className="self-start rounded-full px-3 py-2">
                <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {t('postsCount', { count: items.length })}
                </Text>
              </Surface>
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <Surface variant="secondary" className="mb-3 gap-2 rounded-panel p-2">
          <View className="min-w-0">
            <SearchInput
              placeholder={t('searchPlaceholder')}
              value={search}
              onChangeText={handleSearchChange}
              onSubmitEditing={submitSearch}
              returnKeyType="search"
              accessibilityLabel={t('searchPlaceholder')}
              clearLabel={t('clearSearch')}
              containerClassName="mb-0"
              groupClassName="min-h-12 rounded-full bg-content2"
            />
          </View>
          <View className="items-start">
            <ActionPill
              label={t('searchAction')}
              icon="search-outline"
              onPress={submitSearch}
              primary={primary}
              tone="primary"
              accessibilityLabel={t('searchAction')}
            />
          </View>
        </Surface>
      </View>
    );
  }

  function renderPost({ item, index }: { item: BlogPost; index: number }) {
    const imageHeight = index === 0 && !committedSearch ? 190 : 150;
    const coverImage = resolveImageUrl(item.featured_image);
    const publishedLabel = item.published_at
      ? t('publishedOn', { date: new Date(item.published_at).toLocaleDateString(dateLocale()) })
      : null;

    return (
      <NativePressable
        accessibilityLabel={item.title}
        onPress={() => openPost(item)}
        feedback="highlight"
      >
        <HeroCard
          className="mb-3 overflow-hidden rounded-panel p-0"
          style={{ borderWidth: 1, borderColor: index === 0 && !committedSearch ? withAlpha(primary, 0.18) : withAlpha(primary, 0.10) }}
        >
          {coverImage ? (
            <Image source={{ uri: coverImage }} className="w-full" style={{ height: imageHeight }} resizeMode="cover" />
          ) : (
            <View className="w-full items-center justify-center" style={{ height: imageHeight, backgroundColor: withAlpha(primary, 0.10) }}>
              <Ionicons name="newspaper-outline" size={36} color={primary} />
            </View>
          )}
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row flex-wrap items-center gap-2">
              {item.category ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="folder-open-outline" size={12} color={primary} />
                  <Chip.Label>{item.category.name}</Chip.Label>
                </Chip>
              ) : null}
              {item.reading_time ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                  <Chip.Label>{t('readingTime', { minutes: item.reading_time })}</Chip.Label>
                </Chip>
              ) : null}
            </View>

            <Text className={`${index === 0 && !committedSearch ? 'text-xl' : 'text-lg'} font-bold leading-6`} style={{ color: theme.text }} numberOfLines={3}>
              {item.title}
            </Text>
            {item.excerpt ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                {item.excerpt}
              </Text>
            ) : null}

            <View className="flex-row flex-wrap items-center gap-2">
              {publishedLabel ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="calendar-outline" size={12} color={theme.textSecondary} />
                  <Chip.Label>{publishedLabel}</Chip.Label>
                </Chip>
              ) : null}
            </View>
          </HeroCard.Body>
        </HeroCard>
      </NativePressable>
    );
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<BlogPost>
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderPost}
          ListHeaderComponent={renderHeader}
          refreshControl={
            <RefreshControl refreshing={isLoading && items.length > 0} onRefresh={refresh} tintColor={primary} colors={[primary]} />
          }
          onEndReached={() => { if (hasMore) loadMore(); }}
          onEndReachedThreshold={0.3}
          ListEmptyComponent={
            isLoading ? (
              <View className="items-center p-8">
                <LoadingSpinner />
              </View>
            ) : error ? (
              <Surface variant="secondary" className="rounded-panel p-6">
                <View className="items-center gap-3">
                  <Ionicons name="warning-outline" size={34} color={theme.error} />
                  <Text className="text-center text-sm" style={{ color: theme.text }}>{error}</Text>
                  <HeroButton variant="secondary" onPress={() => void refresh()}>
                    <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </Surface>
            ) : (
              <EmptyState
                icon="newspaper-outline"
                title={committedSearch ? t('emptyFiltered') : t('empty')}
                subtitle={committedSearch ? t('emptyFilteredHint') : t('emptyHint')}
              />
            )
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View className="items-center py-4">
                <LoadingSpinner />
              </View>
            ) : hasMore ? (
              <View className="py-3">
                <HeroButton variant="secondary" onPress={loadMore}>
                  <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : null
          }
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
