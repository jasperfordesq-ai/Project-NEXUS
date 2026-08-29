// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button as HeroButton, Card as HeroCard, Slider, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import Toggle from '@/components/ui/Toggle';
import { getExchangeCategories, type ExchangeCategory } from '@/lib/api/exchanges';
import {
  getMatchPreferences,
  updateMatchPreferences,
  type MatchNotificationFrequency,
  type MatchPreferences,
} from '@/lib/api/matches';
import { describeApiError } from '@/lib/api/describeApiError';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

const FREQUENCIES: MatchNotificationFrequency[] = [
  'daily',
  'fortnightly',
  'monthly',
  'never',
];

interface MatchPreferenceFormData {
  preferences: MatchPreferences;
  categories: ExchangeCategory[];
}

function sliderValue(value: number | number[], fallback: number): number {
  const next = Array.isArray(value) ? value[0] : value;
  return typeof next === 'number' && Number.isFinite(next) ? next : fallback;
}

export default function MatchPreferencesScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show } = useAppToast();
  const [draft, setDraft] = useState<MatchPreferences | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadForm = useCallback(async (): Promise<MatchPreferenceFormData> => {
    const preferences = await getMatchPreferences();
    let categories: ExchangeCategory[] = [];
    try {
      const response = await getExchangeCategories();
      categories = Array.isArray(response.data) ? response.data : [];
    } catch {
      // Preferences remain editable when only the optional category catalogue is unavailable.
    }
    return { preferences, categories };
  }, []);

  const { data, isLoading, error, refresh } = useApi(loadForm, []);

  useEffect(() => {
    if (data?.preferences) setDraft(data.preferences);
  }, [data?.preferences]);

  const save = useCallback(async () => {
    if (!draft || isSaving) return;
    setIsSaving(true);
    try {
      const saved = await updateMatchPreferences(draft);
      setDraft(saved);
      show({ title: t('matchPreferences.save_success'), variant: 'success' });
    } catch (saveError) {
      show({
        title: t('matchPreferences.save_failed'),
        description: describeApiError(saveError, t('matchPreferences.save_failed')),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  }, [draft, isSaving, show, t]);

  const toggleCategory = useCallback((id: number) => {
    setDraft((current) => {
      if (!current) return current;
      const selected = current.categories.includes(id);
      return {
        ...current,
        categories: selected
          ? current.categories.filter((categoryId) => categoryId !== id)
          : [...current.categories, id],
      };
    });
  }, []);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={t('matchPreferences.heading')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/matches"
        />

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <LoadingSpinner />
          </View>
        ) : error || !draft ? (
          <View className="flex-1 justify-center px-4">
            <EmptyState
              icon="warning-outline"
              title={t('matchPreferences.load_failed')}
              subtitle={describeApiError(error, t('matchPreferences.load_failed'))}
              actionLabel={t('common:buttons.retry')}
              onAction={() => void refresh()}
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
            <View className="gap-4 px-4 py-3">
              <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
                <View className="h-1.5" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-2 p-4">
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                    {t('matchPreferences.heading')}
                  </Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('matchPreferences.subtitle')}
                  </Text>
                </HeroCard.Body>
              </HeroCard>

              <PreferenceCard title={t('matchPreferences.pause.title')}>
                <Toggle
                  value={draft.matching_paused}
                  onValueChange={(matchingPaused) => setDraft((current) => current && ({
                    ...current,
                    matching_paused: matchingPaused,
                  }))}
                  accessibilityLabel={t('matchPreferences.pause.title')}
                />
              </PreferenceCard>

              <PreferenceCard title={t('matchPreferences.thresholds.title')}>
                <Slider
                  value={draft.max_distance_km}
                  minValue={1}
                  maxValue={100}
                  step={1}
                  onChange={(value) => setDraft((current) => current && ({
                    ...current,
                    max_distance_km: sliderValue(value, current.max_distance_km),
                  }))}
                  accessibilityLabel={t('matchPreferences.thresholds.distance_label')}
                >
                  <ValueRow
                    label={t('matchPreferences.thresholds.distance_label')}
                    value={t('matchPreferences.thresholds.distance_value', { value: draft.max_distance_km })}
                    primary={primary}
                    text={theme.textSecondary}
                  />
                  <Slider.Track className="h-3 rounded-full bg-default">
                    <Slider.Fill className="rounded-full bg-accent" />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>

                <Slider
                  value={draft.min_match_score}
                  minValue={0}
                  maxValue={100}
                  step={5}
                  onChange={(value) => setDraft((current) => current && ({
                    ...current,
                    min_match_score: sliderValue(value, current.min_match_score),
                  }))}
                  accessibilityLabel={t('matchPreferences.thresholds.quality_label')}
                >
                  <ValueRow
                    label={t('matchPreferences.thresholds.quality_label')}
                    value={t('matchPreferences.thresholds.quality_value', { value: draft.min_match_score })}
                    primary={primary}
                    text={theme.textSecondary}
                  />
                  <Slider.Track className="h-3 rounded-full bg-default">
                    <Slider.Fill className="rounded-full bg-accent" />
                    <Slider.Thumb />
                  </Slider.Track>
                </Slider>
              </PreferenceCard>

              <PreferenceCard title={t('matchPreferences.categories.title')}>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('matchPreferences.categories.description')}
                </Text>
                {(data?.categories ?? []).length ? (
                  <View className="flex-row flex-wrap gap-2">
                    {(data?.categories ?? []).map((category) => {
                      const selected = draft.categories.includes(category.id);
                      return (
                        <HeroButton
                          key={category.id}
                          size="sm"
                          variant={selected ? 'primary' : 'secondary'}
                          onPress={() => toggleCategory(category.id)}
                          accessibilityState={{ selected }}
                        >
                          <HeroButton.Label>{category.name}</HeroButton.Label>
                        </HeroButton>
                      );
                    })}
                  </View>
                ) : (
                  <Text className="text-sm" style={{ color: theme.textSecondary }}>
                    {t('matchPreferences.categories.empty')}
                  </Text>
                )}
              </PreferenceCard>

              <PreferenceCard title={t('matchPreferences.notifications.title')}>
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                  {t('matchPreferences.notifications.frequency_label')}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {FREQUENCIES.map((frequency) => {
                    const selected = draft.notification_frequency === frequency;
                    return (
                      <HeroButton
                        key={frequency}
                        size="sm"
                        variant={selected ? 'primary' : 'secondary'}
                        onPress={() => setDraft((current) => current && ({
                          ...current,
                          notification_frequency: frequency,
                        }))}
                        accessibilityState={{ selected }}
                      >
                        <HeroButton.Label>
                          {t(`matchPreferences.notifications.${frequency}`)}
                        </HeroButton.Label>
                      </HeroButton>
                    );
                  })}
                </View>
                <Toggle
                  value={draft.notify_hot_matches}
                  onValueChange={(enabled) => setDraft((current) => current && ({
                    ...current,
                    notify_hot_matches: enabled,
                  }))}
                  label={t('matchPreferences.notifications.hot_matches')}
                />
                <Toggle
                  value={draft.notify_mutual_matches}
                  onValueChange={(enabled) => setDraft((current) => current && ({
                    ...current,
                    notify_mutual_matches: enabled,
                  }))}
                  label={t('matchPreferences.notifications.mutual_matches')}
                />
              </PreferenceCard>

              <HeroButton variant="primary" onPress={() => void save()} isDisabled={isSaving}>
                <HeroButton.Label>{t('matchPreferences.save')}</HeroButton.Label>
              </HeroButton>
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function PreferenceCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Surface variant="default" className="gap-4 rounded-panel p-4">
      <Text className="text-lg font-bold text-foreground">{title}</Text>
      {children}
    </Surface>
  );
}

function ValueRow({ label, value, primary, text }: {
  label: string;
  value: string;
  primary: string;
  text: string;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: text }}>{label}</Text>
      <Text className="text-sm font-bold" style={{ color: primary }}>{value}</Text>
    </View>
  );
}
