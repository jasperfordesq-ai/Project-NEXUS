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
import { getIdeationOutcomes } from '@/lib/api/ideation';
import { useApi } from '@/lib/hooks/useApi';
import { useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function IdeationOutcomesScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { hasFeature } = useTenant();
  const theme = useTheme();
  const dashboardState = useApi(getIdeationOutcomes, [], { enabled: hasFeature('ideation_challenges') });
  const dashboard = dashboardState.data;
  const metrics = dashboard ? [
    [t('ideation:outcomes.total_challenges'), dashboard.total],
    [t('ideation:outcomes.implemented_count'), dashboard.implemented],
    [t('ideation:outcomes.in_progress_count'), dashboard.in_progress],
    [t('ideation:outcomes.status_not_started'), dashboard.not_started],
  ] as const : [];

  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={t('ideation:outcomes.dashboard')} backLabel={t('common:back')} fallbackHref={'/(modals)/ideation' as Href} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      {dashboardState.isLoading && !dashboard ? <LoadingSpinner /> : dashboardState.error || !dashboard ? <EmptyState icon="warning-outline" title={t('ideation:challenges.load_error')} subtitle={dashboardState.error ?? undefined} actionLabel={t('ideation:actions.retry')} onAction={dashboardState.refresh} /> : <View className="gap-4">
        <View className="flex-row flex-wrap gap-3">{metrics.map(([label, value]) => <HeroCard key={label} className="min-w-[45%] flex-1 rounded-panel"><HeroCard.Body className="items-center gap-1 p-4"><Text className="text-2xl font-bold" style={{ color: theme.text }}>{value}</Text><Text className="text-center text-xs" style={{ color: theme.textSecondary }}>{label}</Text></HeroCard.Body></HeroCard>)}</View>
        {dashboard.outcomes.length === 0 ? <EmptyState icon="analytics-outline" title={t('ideation:outcomes.empty_title')} /> : dashboard.outcomes.map((entry) => <NativePressable key={entry.challenge_id} accessibilityLabel={entry.challenge_title} onPress={() => router.push({ pathname: '/(modals)/ideation-detail', params: { id: String(entry.challenge_id) } } as unknown as Href)} feedback="highlight"><HeroCard className="rounded-panel"><HeroCard.Body className="gap-2 p-4"><View className="flex-row items-start justify-between gap-3"><Text className="min-w-0 flex-1 text-lg font-bold" style={{ color: theme.text }}>{entry.challenge_title}</Text><Chip size="sm" variant="secondary"><Chip.Label>{t(`ideation:outcomes.status_${entry.implementation_status}`)}</Chip.Label></Chip></View>{entry.winning_idea_title ? <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('ideation:outcomes.winning_idea')}: {entry.winning_idea_title}</Text> : null}{entry.impact_description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{entry.impact_description}</Text> : null}</HeroCard.Body></HeroCard></NativePressable>)}
      </View>}
    </ScrollView>
  </SafeAreaView></ModalErrorBoundary>;
}
