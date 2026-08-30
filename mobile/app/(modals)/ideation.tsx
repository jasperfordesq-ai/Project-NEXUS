// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getIdeationCategories,
  getIdeationChallenges,
  type IdeationCategory,
  type IdeationChallenge,
  type IdeationStatus,
} from '@/lib/api/ideation';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type FilterStatus = 'all' | IdeationStatus;

const STATUS_FILTERS: FilterStatus[] = ['all', 'open', 'voting', 'evaluating', 'closed'];

export default function IdeationScreen() {
  const { t } = useTranslation(['ideation', 'common']);
  const { hasFeature } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [status, setStatus] = useState<FilterStatus>('all');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const {
    data: challengesPage,
    isLoading,
    error,
    refresh: refreshChallenges,
  } = useApi(() => getIdeationChallenges({ status, search, categoryId }), [status, search, categoryId], {
    enabled: hasFeature('ideation_challenges'),
  });
  const {
    data: categories,
    refresh: refreshCategories,
  } = useApi(() => getIdeationCategories(), [], { enabled: hasFeature('ideation_challenges') });

  function refresh() {
    refreshChallenges();
    refreshCategories();
  }

  if (!hasFeature('ideation_challenges')) {
    return (
      <ModalErrorBoundary>
        <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
          <AppTopBar title={t('ideation:title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
          <View className="px-4 py-8" style={{ flex: 1, backgroundColor: theme.bg }}>
            <EmptyState icon="bulb-outline" title={t('ideation:disabledTitle')} subtitle={t('ideation:disabledSubtitle')} />
          </View>
        </SafeAreaView>
      </ModalErrorBoundary>
    );
  }

  const challenges = challengesPage?.items ?? [];

  return (
    <ModalErrorBoundary>
      <SafeAreaView testID="ideation-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('ideation:title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: theme.bg }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView
          testID="ideation-scroll"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 40, backgroundColor: theme.bg }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        >
          <View className="gap-3 pb-2">
            <HeroCard variant="default" className="mx-4 overflow-hidden rounded-panel p-0">
              <View className="h-1 w-full" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-center gap-3">
                  <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="bulb-outline" size={24} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[26px] font-bold leading-8" style={{ color: theme.text }} numberOfLines={1}>
                      {t('ideation:title')}
                    </Text>
                    <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {t('ideation:subtitle')}
                    </Text>
                  </View>
                </View>
              </HeroCard.Body>
            </HeroCard>

            <View className="mx-4 flex-row gap-2">
              <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/ideation-campaigns' as Href)}>
                <Ionicons name="layers-outline" size={17} color={primary} />
                <HeroButton.Label>{t('ideation:campaigns.title')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/ideation-outcomes' as Href)}>
                <Ionicons name="analytics-outline" size={17} color={primary} />
                <HeroButton.Label>{t('ideation:outcomes.dashboard')}</HeroButton.Label>
              </HeroButton>
            </View>

            <Surface
              variant="default"
              className="mx-4 gap-3 overflow-hidden rounded-panel p-3.5"
              style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
            >
              <Input
                label={t('ideation:searchLabel')}
                placeholder={t('ideation:searchPlaceholder')}
                value={search}
                onChangeText={setSearch}
                leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
                containerClassName="mb-0"
              />

              <Tabs value={status} onValueChange={(value) => setStatus(value as FilterStatus)} variant="secondary">
                <Tabs.List>
                  <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1 pr-2">
                    <Tabs.Indicator />
                    {STATUS_FILTERS.map((item) => (
                      <Tabs.Trigger key={item} value={item}>
                        <Tabs.Label>{t(`ideation:filters.${item}`)}</Tabs.Label>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.ScrollView>
                </Tabs.List>
              </Tabs>

              <CategoryStrip categories={categories ?? []} selectedId={categoryId} onSelect={setCategoryId} />
            </Surface>

            {isLoading ? (
              <View className="items-center justify-center py-14">
                <LoadingSpinner />
              </View>
            ) : error ? (
              <View className="px-4 py-8">
                <EmptyState icon="warning-outline" title={t('ideation:errorTitle')} subtitle={String(error)} actionLabel={t('common:buttons.retry')} onAction={refresh} />
              </View>
            ) : challenges.length > 0 ? (
              <View className="gap-3 px-4">
                {challenges.map((challenge) => <ChallengeCard key={challenge.id} challenge={challenge} />)}
              </View>
            ) : (
              <View className="px-4 py-8">
                <EmptyState icon="bulb-outline" title={t('ideation:emptyTitle')} subtitle={t('ideation:emptySubtitle')} />
              </View>
            )}
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function CategoryStrip({
  categories,
  selectedId,
  onSelect,
}: {
  categories: IdeationCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { t } = useTranslation(['ideation']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-2">
      <FilterPill
        label={t('ideation:allCategories')}
        isSelected={selectedId === null}
        primary={primary}
        theme={theme}
        onPress={() => onSelect(null)}
      />
      {categories.map((category) => (
        <FilterPill
          key={category.id}
          label={category.name}
          detail={t('ideation:categoryCount', { count: category.challenges_count ?? 0 })}
          isSelected={selectedId === category.id}
          primary={primary}
          theme={theme}
          onPress={() => onSelect(category.id)}
        />
      ))}
    </ScrollView>
  );
}

function FilterPill({
  label,
  detail,
  isSelected,
  primary,
  theme,
  onPress,
}: {
  label: string;
  detail?: string;
  isSelected: boolean;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  onPress: () => void;
}) {
  return (
    <HeroButton
      className="min-h-10 flex-row items-center gap-2 rounded-full px-3.5"
      accessibilityLabel={label}
      onPress={onPress}
      size="sm"
      variant={isSelected ? 'primary' : 'secondary'}
      style={{
        backgroundColor: isSelected ? primary : withAlpha(primary, 0.08),
        borderColor: isSelected ? primary : theme.borderSubtle,
        borderWidth: 1,
      }}
    >
      <HeroButton.Label className="text-sm font-bold" style={{ color: isSelected ? '#fff' : theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
      {detail ? (
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: isSelected ? withAlpha('#ffffff', 0.2) : withAlpha(primary, 0.12) }}
        >
          <Text className="text-[11px] font-semibold" style={{ color: isSelected ? '#fff' : primary }} numberOfLines={1}>
            {detail}
          </Text>
        </View>
      ) : null}
    </HeroButton>
  );
}

function ChallengeCard({ challenge }: { challenge: IdeationChallenge }) {
  const { t } = useTranslation(['ideation']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const description = truncateText(stripHtml(challenge.description), 220);
  const openChallenge = () => router.push({ pathname: '/(modals)/ideation-detail', params: { id: String(challenge.id) } } as unknown as Href);

  return (
    <NativePressable
      accessibilityLabel={[
        challenge.title,
        t(`ideation:status.${challenge.status}`),
        challenge.category ?? '',
        t('ideation:ideasCount', { count: challenge.ideas_count ?? 0 }),
      ].filter(Boolean).join(', ')}
      onPress={openChallenge}
      feedback="highlight"
    >
      <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-3 p-4 pl-5">
          <View className="flex-row items-start gap-3">
            <View className="h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
              <Ionicons name="bulb-outline" size={21} color={primary} />
            </View>
            <View className="min-w-0 flex-1 gap-2">
              <View className="flex-row items-start justify-between gap-2">
                <Text className="min-w-0 flex-1 text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>
                  {challenge.title}
                </Text>
                <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
              </View>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
                {description}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2 pl-14">
            <Surface variant="secondary" className="rounded-full px-3 py-1.5">
              <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t(`ideation:status.${challenge.status}`)}</Text>
            </Surface>
            {challenge.category ? (
              <Surface variant="secondary" className="rounded-full px-3 py-1.5">
                <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{challenge.category}</Text>
              </Surface>
            ) : null}
            <Surface variant="secondary" className="rounded-full px-3 py-1.5">
              <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t('ideation:ideasCount', { count: challenge.ideas_count ?? 0 })}</Text>
            </Surface>
          </View>

          <View className="pl-14">
            <View
              className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderColor: withAlpha(primary, 0.18), borderWidth: 1 }}
            >
              <Text className="text-sm font-bold" style={{ color: primary }}>
                {t('ideation:viewChallenge')}
              </Text>
              <Ionicons name="chevron-forward-outline" size={16} color={primary} />
            </View>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trimEnd()}...`;
}
