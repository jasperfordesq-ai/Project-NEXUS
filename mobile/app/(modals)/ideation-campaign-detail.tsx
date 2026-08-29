// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { Chip } from '@/components/ui/StatusChip';
import { getIdeationCampaign } from '@/lib/api/ideation';
import { useApi } from '@/lib/hooks/useApi';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function IdeationCampaignDetailScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const campaignId = Number(id ?? 0);
  const { hasFeature } = useTenant();
  const theme = useTheme();
  const campaignState = useApi(() => getIdeationCampaign(campaignId), [campaignId], { enabled: hasFeature('ideation_challenges') && campaignId > 0 });
  const campaign = campaignState.data;

  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={campaign?.title ?? t('ideation:campaigns.fallback_title')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation-campaigns' as Href} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {campaignState.isLoading && !campaign ? <LoadingSpinner /> : campaignState.error || !campaign ? <EmptyState icon="warning-outline" title={t('ideation:challenges.load_error')} subtitle={campaignState.error ?? undefined} actionLabel={t('ideation:actions.retry')} onAction={campaignState.refresh} /> : <View className="gap-4">
        <HeroCard className="rounded-panel"><HeroCard.Body className="gap-3 p-5"><Text accessibilityRole="header" className="text-2xl font-bold" style={{ color: theme.text }}>{campaign.title}</Text>{campaign.description ? <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>{campaign.description}</Text> : null}<Text className="text-sm" style={{ color: theme.textSecondary }}>{t('ideation:campaigns.challenges_count', { count: campaign.challenges_count ?? campaign.challenges?.length ?? 0 })}</Text></HeroCard.Body></HeroCard>
        {(campaign.challenges?.length ?? 0) === 0 ? <EmptyState icon="bulb-outline" title={t('ideation:challenges.empty_title')} /> : campaign.challenges?.map((challenge) => <NativePressable key={challenge.id} accessibilityLabel={challenge.title} onPress={() => router.push({ pathname: '/(modals)/ideation-detail', params: { id: String(challenge.id) } } as unknown as Href)} feedback="highlight"><HeroCard className="rounded-panel"><HeroCard.Body className="gap-2 p-4"><View className="flex-row items-start justify-between gap-3"><Text className="min-w-0 flex-1 text-lg font-bold" style={{ color: theme.text }}>{challenge.title}</Text><Chip size="sm" variant="secondary"><Chip.Label>{t(`ideation:status.${challenge.status}`)}</Chip.Label></Chip></View><Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{challenge.description}</Text><Text className="text-sm" style={{ color: theme.textSecondary }}>{t('ideation:ideasCount', { count: challenge.ideas_count ?? 0 })}</Text></HeroCard.Body></HeroCard></NativePressable>)}
      </View>}
    </ScrollView>
  </SafeAreaView></ModalErrorBoundary>;
}
