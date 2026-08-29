// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import { Chip } from '@/components/ui/StatusChip';
import { getPodcastShows, type PodcastShow } from '@/lib/api/podcasts';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function PodcastsScreen() {
  const { t } = useTranslation(['podcasts', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const { data, isLoading, error, refresh } = useApi(() => getPodcastShows({ query: query || undefined, sort: 'newest' }), [query]);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<PodcastShow>
          data={data?.items ?? []}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 44 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh()} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={<View className="mb-4 gap-4"><HeroCard className="overflow-hidden rounded-panel p-0"><View className="h-1" style={{ backgroundColor: primary }} /><HeroCard.Body className="gap-1 p-4"><Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('title')}</Text><Text className="leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text></HeroCard.Body></HeroCard><SearchInput value={search} onChangeText={(value) => { setSearch(value); if (!value) setQuery(''); }} onSubmitEditing={() => setQuery(search.trim())} placeholder={t('browse.search_placeholder')} accessibilityLabel={t('browse.search_placeholder')} clearLabel={t('common:actions.clear')} returnKeyType="search" /></View>}
          renderItem={({ item }) => <NativePressable accessibilityLabel={item.title} feedback="highlight" onPress={() => router.push({ pathname: '/(modals)/podcast-show', params: { slug: item.slug } })}><HeroCard className="mb-3 rounded-panel"><HeroCard.Body className="gap-2 p-4"><View className="flex-row flex-wrap gap-2">{item.category ? <Chip size="sm" variant="secondary"><Chip.Label>{item.category}</Chip.Label></Chip> : null}<Chip size="sm" variant="secondary"><Chip.Label>{t('show.episode_count', { count: item.episode_count })}</Chip.Label></Chip></View><Text className="text-lg font-bold" style={{ color: theme.text }}>{item.title}</Text>{item.summary ? <Text className="leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{item.summary}</Text> : null}</HeroCard.Body></HeroCard></NativePressable>}
          ListEmptyComponent={isLoading ? <View className="py-12"><LoadingSpinner /></View> : <EmptyState icon={error ? 'warning-outline' : 'mic-outline'} title={error ?? t('browse.empty')} subtitle={error ? undefined : t('browse.empty_hint')} actionLabel={error ? t('browse.retry') : undefined} onAction={error ? () => refresh() : undefined} />}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
