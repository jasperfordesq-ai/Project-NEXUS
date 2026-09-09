// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import ActionSheet from '@/components/ui/ActionSheet';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import PodcastAudioPlayer, { type PodcastAudioPlayerHandle } from '@/components/podcasts/PodcastAudioPlayer';
import { Chip } from '@/components/ui/StatusChip';
import { useAppToast } from '@/components/ui/AppToast';
import { getPodcastEpisode, reportPodcastEpisode, togglePodcastReaction } from '@/lib/api/podcasts';
import { isRefusalStatus } from '@/lib/api/refusal';
import { describeApiError } from '@/lib/api/describeApiError';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withRouteGate } from '@/components/withRouteGate';

type ReportReason = 'safety' | 'spam' | 'rights' | 'other';
const REPORT_REASONS: ReportReason[] = ['safety', 'spam', 'rights', 'other'];

function PodcastEpisodeScreen() {
  const { showSlug, episodeSlug } = useLocalSearchParams<{ showSlug?: string; episodeSlug?: string }>();
  const { t } = useTranslation(['podcasts', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [reacted, setReacted] = useState(false);
  const [savingReaction, setSavingReaction] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const playerRef = useRef<PodcastAudioPlayerHandle>(null);
  const state = useApi(() => getPodcastEpisode(showSlug || '', episodeSlug || ''), [showSlug, episodeSlug], { enabled: Boolean(showSlug && episodeSlug) });
  useEffect(() => { if (state.data) setReacted(Boolean(state.data.viewer_has_reacted)); }, [state.data]);

  async function react() {
    if (!state.data || savingReaction) return;
    setSavingReaction(true);
    try {
      const result = await togglePodcastReaction(state.data.id);
      setReacted(result.active);
    } catch (error) {
      showToast({ title: t('episode.reaction_failed'), description: describeApiError(error, '') || undefined, variant: 'danger' });
    } finally { setSavingReaction(false); }
  }

  async function report(reason: ReportReason) {
    if (!state.data) return;
    try {
      await reportPodcastEpisode(state.data.id, reason);
      showToast({ title: t('episode.reported'), variant: 'success' });
    } catch (error) {
      showToast({ title: t('episode.report_failed'), description: describeApiError(error, '') || undefined, variant: 'danger' });
    }
  }

  if (state.isLoading) return <SafeAreaView className="flex-1 items-center justify-center bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><LoadingSpinner /></SafeAreaView>;
  const episode = state.data;
  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={episode?.title ?? t('episode.title')} backLabel={t('common:back')} fallbackHref="/(modals)/podcasts" />
        {!episode && isRefusalStatus(state.errorStatus) ? <EmptyState icon="lock-closed-outline" title={t('common:errors.notAvailableTitle')} subtitle={t('common:errors.notAvailableHint')} testID="podcast-episode-refused" />
          : !episode ? <EmptyState icon="warning-outline" title={state.error ?? t('episode.not_found')} actionLabel={t('episode.retry')} onAction={() => state.refresh()} /> : <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }} refreshControl={<RefreshControl refreshing={state.isLoading && Boolean(state.data)} onRefresh={state.refresh} tintColor={primary} colors={[primary]} />}>
            <RefreshFailedNotice error={state.data ? state.error : null} onRetry={state.refresh} />
            <HeroCard className="rounded-panel"><HeroCard.Body className="gap-4 p-5">
              <View className="flex-row flex-wrap gap-2"><Chip size="sm" variant="secondary"><Chip.Label>{t(`episode.type.${episode.episode_type}`)}</Chip.Label></Chip>{episode.explicit ? <Chip size="sm" variant="secondary"><Chip.Label>{t('episode.explicit')}</Chip.Label></Chip> : null}</View>
              <Text className="text-2xl font-bold" style={{ color: theme.text }}>{episode.title}</Text>
              {episode.summary ? <Text className="leading-6" style={{ color: theme.textSecondary }}>{episode.summary}</Text> : null}
              <PodcastAudioPlayer ref={playerRef} episodeId={episode.id} audioUrl={episode.audio_url} durationSeconds={episode.duration_seconds} primaryColor={primary} />
              <View className="flex-row flex-wrap gap-3"><HeroButton variant={reacted ? 'secondary' : 'primary'} isDisabled={savingReaction} onPress={() => void react()}><HeroButton.Label>{t(reacted ? 'episode.reacted' : 'episode.react')}</HeroButton.Label></HeroButton><HeroButton variant="secondary" onPress={() => setReportOpen(true)}><HeroButton.Label>{t('episode.report')}</HeroButton.Label></HeroButton></View>
            </HeroCard.Body></HeroCard>
            {episode.description ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.description')}</Text><Text className="leading-6" style={{ color: theme.textSecondary }}>{episode.description}</Text></View> : null}
            {episode.transcript ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.transcript')}</Text><Text className="leading-6" style={{ color: theme.text }}>{episode.transcript}</Text></View> : null}
            {episode.chapters?.length ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.chapters')}</Text>{episode.chapters.map((chapter) => { const time = `${Math.floor(chapter.starts_at_seconds / 60)}:${String(chapter.starts_at_seconds % 60).padStart(2, '0')}`; return <Pressable key={`${chapter.starts_at_seconds}-${chapter.title}`} accessibilityRole="button" accessibilityLabel={t('player.jump_to_chapter', { time, title: chapter.title })} className="py-2" onPress={() => playerRef.current?.seekToSeconds(chapter.starts_at_seconds)}><Text style={{ color: theme.textSecondary }}>{time} — {chapter.title}</Text></Pressable>; })}</View> : null}
          </ScrollView>
          <ActionSheet visible={reportOpen} onClose={() => setReportOpen(false)} title={t('episode.report_title')} actions={REPORT_REASONS.map((reason) => ({ label: t(`episode.report_reasons.${reason}`), icon: 'flag-outline', onPress: () => void report(reason), destructive: true }))} />
        </>}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

export default withRouteGate(PodcastEpisodeScreen, 'podcast-episode');
