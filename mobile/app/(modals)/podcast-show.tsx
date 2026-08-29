// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { Chip } from '@/components/ui/StatusChip';
import { useAppToast } from '@/components/ui/AppToast';
import { getPodcastShow, togglePodcastSubscription, type PodcastEpisode } from '@/lib/api/podcasts';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';

export default function PodcastShowScreen() {
  const { slug } = useLocalSearchParams<{ slug?: string }>();
  const { t } = useTranslation(['podcasts', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [subscribed, setSubscribed] = useState(false);
  const [saving, setSaving] = useState(false);
  const state = useApi(() => getPodcastShow(slug || ''), [slug], { enabled: Boolean(slug) });
  useEffect(() => { if (state.data) setSubscribed(Boolean(state.data.is_subscribed)); }, [state.data]);

  async function follow() {
    if (!state.data || saving) return;
    setSaving(true);
    try {
      const result = await togglePodcastSubscription(state.data.id);
      setSubscribed(result.subscribed);
      showToast({ title: t(result.subscribed ? 'show.subscribed' : 'show.unsubscribed'), variant: 'success' });
    } catch {
      showToast({ title: t('show.subscribe_failed'), variant: 'danger' });
    } finally { setSaving(false); }
  }

  if (state.isLoading) return <SafeAreaView className="flex-1 items-center justify-center bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><LoadingSpinner /></SafeAreaView>;
  const podcast = state.data;
  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}><AppTopBar title={podcast?.title ?? t('title')} backLabel={t('common:back')} fallbackHref="/(modals)/podcasts" />{!podcast ? <EmptyState icon="warning-outline" title={state.error ?? t('show.not_found')} actionLabel={t('show.retry')} onAction={() => state.refresh()} /> : <FlatList<PodcastEpisode> data={podcast.episodes ?? []} keyExtractor={(item) => String(item.id)} contentContainerStyle={{ padding: 16, paddingBottom: 44 }} ListHeaderComponent={<View className="mb-5 gap-3"><Text className="text-2xl font-bold" style={{ color: theme.text }}>{podcast.title}</Text><Text className="leading-6" style={{ color: theme.textSecondary }}>{podcast.summary || t('show.no_summary')}</Text><View className="flex-row flex-wrap gap-2"><Chip size="sm" variant="secondary"><Chip.Label>{t('show.episode_count', { count: podcast.episode_count })}</Chip.Label></Chip><Chip size="sm" variant="secondary"><Chip.Label>{t('show.follower_count', { count: podcast.subscriber_count })}</Chip.Label></Chip></View><HeroButton isDisabled={saving} variant={subscribed ? 'secondary' : 'primary'} onPress={() => void follow()}><HeroButton.Label>{t(subscribed ? 'show.unsubscribe' : 'show.subscribe')}</HeroButton.Label></HeroButton><Text className="mt-2 text-lg font-bold" style={{ color: theme.text }}>{t('show.episodes')}</Text></View>} renderItem={({ item }) => <NativePressable accessibilityLabel={item.title} feedback="highlight" onPress={() => router.push({ pathname: '/(modals)/podcast-episode', params: { showSlug: podcast.slug, episodeSlug: item.slug } })}><HeroCard className="mb-3 rounded-panel"><HeroCard.Body className="gap-2 p-4"><Text className="text-lg font-bold" style={{ color: theme.text }}>{item.title}</Text>{item.summary ? <Text style={{ color: theme.textSecondary }} numberOfLines={3}>{item.summary}</Text> : null}</HeroCard.Body></HeroCard></NativePressable>} ListEmptyComponent={<EmptyState icon="mic-outline" title={t('show.no_episodes')} />} />}</SafeAreaView></ModalErrorBoundary>;
}
