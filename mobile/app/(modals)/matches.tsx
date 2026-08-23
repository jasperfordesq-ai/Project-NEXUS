// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  dismissMatch,
  getMatches,
  type MatchItem,
  type MatchSourceType,
} from '@/lib/api/matches';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import * as Haptics from '@/lib/haptics';

type Filter = 'all' | MatchSourceType;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const FILTERS: Filter[] = ['all', 'listing', 'job', 'volunteering', 'group'];

const SOURCE_CONFIG: Record<MatchSourceType, { icon: IoniconName; tone: string; route: (id: number) => Parameters<typeof router.push>[0] }> = {
  listing: {
    icon: 'list-outline',
    tone: '#2563eb',
    route: (id) => ({ pathname: '/(modals)/exchange-detail', params: { id: String(id) } }),
  },
  job: {
    icon: 'briefcase-outline',
    tone: '#f59e0b',
    route: (id) => ({ pathname: '/(modals)/job-detail', params: { id: String(id) } }),
  },
  volunteering: {
    icon: 'heart-outline',
    tone: '#e11d48',
    route: (id) => ({ pathname: '/(modals)/volunteering-detail', params: { id: String(id) } }),
  },
  group: {
    icon: 'people-outline',
    tone: '#14b8a6',
    route: (id) => ({ pathname: '/(modals)/group-detail', params: { id: String(id) } }),
  },
};

export default function MatchesScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { data, isLoading, error, refresh } = useApi(() => getMatches());
  const [filter, setFilter] = useState<Filter>('all');
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const [dismissingId, setDismissingId] = useState<number | null>(null);

  const matches = useMemo(
    () => (data?.data ?? []).filter((match) => !dismissedIds.has(match.id)),
    [data?.data, dismissedIds],
  );
  const filteredMatches = filter === 'all' ? matches : matches.filter((match) => match.source_type === filter);
  const averageScore = matches.length
    ? Math.round(matches.reduce((total, match) => total + match.match_score, 0) / matches.length)
    : 0;
  const hotMatches = matches.filter((match) => match.match_score >= 80).length;
  const sourceCount = new Set(matches.map((match) => match.source_type)).size;

  async function handleDismiss(match: MatchItem) {
    if (match.source_type !== 'listing' || dismissingId !== null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDismissingId(match.id);
    try {
      await dismissMatch(match.source_id);
      setDismissedIds((current) => new Set(current).add(match.id));
    } finally {
      setDismissingId(null);
    }
  }

  function openMatch(match: MatchItem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(SOURCE_CONFIG[match.source_type].route(match.source_id));
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('matches.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<MatchItem>
          data={filteredMatches}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <MatchCard
              item={item}
              isDismissing={dismissingId === item.id}
              onDismiss={() => void handleDismiss(item)}
              onOpen={() => openMatch(item)}
            />
          )}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} tintColor={primary} colors={[primary]} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <View className="gap-3 pb-2">
              <HeroCard variant="default" className="mx-4 overflow-hidden rounded-panel p-0">
                <View className="h-1 w-full" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-4 p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="sparkles-outline" size={25} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                        {t('matches.title')}
                      </Text>
                      <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {t('matches.subtitle')}
                      </Text>
                    </View>
                  </View>
                </HeroCard.Body>
              </HeroCard>

              <View className="mx-4 flex-row flex-wrap gap-3">
                <StatTile icon="radio-button-on-outline" label={t('matches.total')} value={matches.length} tone={primary} />
                <StatTile icon="trending-up-outline" label={t('matches.average')} value={`${averageScore}%`} tone="#22c55e" />
                <StatTile icon="flash-outline" label={t('matches.hot')} value={hotMatches} tone="#f59e0b" />
                <StatTile icon="filter-outline" label={t('matches.sources')} value={sourceCount} tone="#8b5cf6" />
              </View>

              <Surface variant="default" className="mx-4 rounded-panel-inner p-2">
                <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} variant="secondary">
                  <Tabs.List>
                    <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1">
                      <Tabs.Indicator />
                      {FILTERS.map((value) => (
                        <Tabs.Trigger key={value} value={value}>
                          <Tabs.Label>{t(`matches.filter.${value}`)}</Tabs.Label>
                        </Tabs.Trigger>
                      ))}
                    </Tabs.ScrollView>
                  </Tabs.List>
                </Tabs>
              </Surface>
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <View className="items-center justify-center py-14">
                <LoadingSpinner />
              </View>
            ) : (
              <View className="px-4 py-8">
                <EmptyState
                  icon={error ? 'warning-outline' : 'sparkles-outline'}
                  title={error ? t('matches.errorTitle') : t('matches.emptyTitle')}
                  subtitle={error ? String(error) : t('matches.emptySubtitle')}
                  actionLabel={error ? t('common:buttons.retry') : undefined}
                  onAction={error ? () => void refresh() : undefined}
                />
              </View>
            )
          }
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function MatchCard({
  item,
  isDismissing,
  onDismiss,
  onOpen,
}: {
  item: MatchItem;
  isDismissing: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation(['profile']);
  const theme = useTheme();
  const config = SOURCE_CONFIG[item.source_type];
  const scoreTone = item.match_score >= 80 ? theme.success : item.match_score >= 60 ? theme.warning : config.tone;

  return (
    <HeroCard variant="default" className="mx-4 my-2 overflow-hidden rounded-panel p-0">
      <View className="h-1 w-full" style={{ backgroundColor: config.tone }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(config.tone, 0.14) }}>
            <Ionicons name={config.icon} size={22} color={config.tone} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary">
                <Chip.Label>{t(`matches.source.${item.source_type}`)}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary">
                <Ionicons name="analytics-outline" size={12} color={scoreTone} />
                <Chip.Label>{t('matches.score', { score: item.match_score })}</Chip.Label>
              </Chip>
            </View>
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
              {item.title}
            </Text>
            {item.description ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </View>
        </View>

        {item.reasons.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {item.reasons.slice(0, 4).map((reason) => (
              <Chip key={reason} size="sm" variant="secondary">
                <Chip.Label>{reason}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}

        <View className="flex-row gap-2">
          <HeroButton className="flex-1" size="sm" variant="primary" onPress={onOpen} accessibilityLabel={t('matches.open')}>
            <HeroButton.Label>{t('matches.open')}</HeroButton.Label>
            <Ionicons name="chevron-forward-outline" size={16} color={theme.onPrimary} />
          </HeroButton>
          {item.source_type === 'listing' ? (
            <HeroButton
              className="flex-1"
              size="sm"
              variant="danger-soft"
              onPress={onDismiss}
              isDisabled={isDismissing}
              accessibilityLabel={t('matches.dismiss')}
            >
              <Ionicons name="close-outline" size={16} color={theme.error} />
              <HeroButton.Label>{t('matches.dismiss')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: IoniconName;
  label: string;
  value: number | string;
  tone: string;
}) {
  const theme = useTheme();

  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-4">
      <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>
        {label}
      </Text>
    </Surface>
  );
}
