// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import ActionSheet from '@/components/ui/ActionSheet';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import PodcastAudioPlayer from '@/components/podcasts/PodcastAudioPlayer';
import { Chip } from '@/components/ui/StatusChip';
import { useAppToast } from '@/components/ui/AppToast';
import { getPodcastEpisode, reportPodcastEpisode, togglePodcastReaction } from '@/lib/api/podcasts';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

type ReportReason = 'safety' | 'spam' | 'rights' | 'other';
const REPORT_REASONS: ReportReason[] = ['safety', 'spam', 'rights', 'other'];

export default function PodcastEpisodeScreen() {
  const { showSlug, episodeSlug } = useLocalSearchParams<{ showSlug?: string; episodeSlug?: string }>();
  const { t } = useTranslation(['podcasts', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [reacted, setReacted] = useState(false);
  const [savingReaction, setSavingReaction] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const state = useApi(() => getPodcastEpisode(showSlug || '', episodeSlug || ''), [showSlug, episodeSlug], { enabled: Boolean(showSlug && episodeSlug) });
  useEffect(() => { if (state.data) setReacted(Boolean(state.data.viewer_has_reacted)); }, [state.data]);

  async function react() {
    if (!state.data || savingReaction) return;
    setSavingReaction(true);
    try {
      const result = await togglePodcastReaction(state.data.id);
      setReacted(result.active);
    } catch {
      showToast({ title: t('episode.reaction_failed'), variant: 'danger' });
    } finally { setSavingReaction(false); }
  }

  async function report(reason: ReportReason) {
    if (!state.data) return;
    try {
      await reportPodcastEpisode(state.data.id, reason);
      showToast({ title: t('episode.reported'), variant: 'success' });
    } catch {
      showToast({ title: t('episode.report_failed'), variant: 'danger' });
    }
  }

  if (state.isLoading) return <SafeAreaView className="flex-1 items-center justify-center bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><LoadingSpinner /></SafeAreaView>;
  const episode = state.data;
  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={episode?.title ?? t('episode.title')} backLabel={t('common:back')} fallbackHref="/(modals)/podcasts" />
        {!episode ? <EmptyState icon="warning-outline" title={state.error ?? t('episode.not_found')} actionLabel={t('episode.retry')} onAction={() => state.refresh()} /> : <>
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
            <HeroCard className="rounded-panel"><HeroCard.Body className="gap-4 p-5">
              <View className="flex-row flex-wrap gap-2"><Chip size="sm" variant="secondary"><Chip.Label>{t(`episode.type.${episode.episode_type}`)}</Chip.Label></Chip>{episode.explicit ? <Chip size="sm" variant="secondary"><Chip.Label>{t('episode.explicit')}</Chip.Label></Chip> : null}</View>
              <Text className="text-2xl font-bold" style={{ color: theme.text }}>{episode.title}</Text>
              {episode.summary ? <Text className="leading-6" style={{ color: theme.textSecondary }}>{episode.summary}</Text> : null}
              <PodcastAudioPlayer episodeId={episode.id} audioUrl={episode.audio_url} durationSeconds={episode.duration_seconds} primaryColor={primary} />
              <View className="flex-row flex-wrap gap-3"><HeroButton variant={reacted ? 'secondary' : 'primary'} isDisabled={savingReaction} onPress={() => void react()}><HeroButton.Label>{t(reacted ? 'episode.reacted' : 'episode.react')}</HeroButton.Label></HeroButton><HeroButton variant="secondary" onPress={() => setReportOpen(true)}><HeroButton.Label>{t('episode.report')}</HeroButton.Label></HeroButton></View>
            </HeroCard.Body></HeroCard>
            {episode.description ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.description')}</Text><Text className="leading-6" style={{ color: theme.textSecondary }}>{episode.description}</Text></View> : null}
            {episode.transcript ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.transcript')}</Text><Text className="leading-6" style={{ color: theme.text }}>{episode.transcript}</Text></View> : null}
            {episode.chapters?.length ? <View className="mt-5 gap-2"><Text className="text-lg font-bold" style={{ color: theme.text }}>{t('episode.chapters')}</Text>{episode.chapters.map((chapter) => <Text key={`${chapter.starts_at_seconds}-${chapter.title}`} style={{ color: theme.textSecondary }}>{Math.floor(chapter.starts_at_seconds / 60)}:{String(chapter.starts_at_seconds % 60).padStart(2, '0')} — {chapter.title}</Text>)}</View> : null}
          </ScrollView>
          <ActionSheet visible={reportOpen} onClose={() => setReportOpen(false)} title={t('episode.report_title')} actions={REPORT_REASONS.map((reason) => ({ label: t(`episode.report_reasons.${reason}`), icon: 'flag-outline', onPress: () => void report(reason), destructive: true }))} />
        </>}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
