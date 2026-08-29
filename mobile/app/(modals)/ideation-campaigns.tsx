// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { Chip } from '@/components/ui/StatusChip';
import { getIdeationCampaigns } from '@/lib/api/ideation';
import { useApi } from '@/lib/hooks/useApi';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function IdeationCampaignsScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { hasFeature } = useTenant();
  const theme = useTheme();
  const campaignsState = useApi(getIdeationCampaigns, [], { enabled: hasFeature('ideation_challenges') });
  const campaigns = campaignsState.data?.items ?? [];

  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={t('ideation:campaigns.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation' as Href} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {!hasFeature('ideation_challenges') ? <EmptyState icon="bulb-outline" title={t('ideation:campaigns.feature_not_available')} subtitle={t('ideation:campaigns.feature_not_available_desc')} />
        : campaignsState.isLoading && !campaignsState.data ? <LoadingSpinner />
          : campaignsState.error ? <EmptyState icon="warning-outline" title={t('ideation:challenges.load_error')} subtitle={campaignsState.error} actionLabel={t('ideation:campaigns.retry')} onAction={campaignsState.refresh} />
            : campaigns.length === 0 ? <EmptyState icon="layers-outline" title={t('ideation:campaigns.empty_title')} subtitle={t('ideation:campaigns.empty_description')} />
              : <View className="gap-3">{campaigns.map((campaign) => <NativePressable key={campaign.id} accessibilityLabel={campaign.title} onPress={() => router.push({ pathname: '/(modals)/ideation-campaign-detail', params: { id: String(campaign.id) } } as unknown as Href)} feedback="highlight"><HeroCard className="rounded-panel"><HeroCard.Body className="gap-2 p-4"><View className="flex-row items-start justify-between gap-3"><Text accessibilityRole="header" className="min-w-0 flex-1 text-lg font-bold" style={{ color: theme.text }}>{campaign.title}</Text>{campaign.status ? <Chip size="sm" variant="secondary"><Chip.Label>{campaign.status}</Chip.Label></Chip> : null}</View>{campaign.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{campaign.description}</Text> : null}<Text className="text-sm" style={{ color: theme.textSecondary }}>{t('ideation:campaigns.challenges_count', { count: campaign.challenges_count ?? 0 })}</Text></HeroCard.Body></HeroCard></NativePressable>)}</View>}
    </ScrollView>
  </SafeAreaView></ModalErrorBoundary>;
}
