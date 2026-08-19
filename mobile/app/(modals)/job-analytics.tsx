// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card as HeroCard, Chip, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getJobAnalytics, getJobPredictions } from '@/lib/api/jobs';
import type { JobAnalyticsData, JobPredictionsData } from '@/lib/api/jobs';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

const APPLICATION_STATUSES = new Set([
  'applied',
  'pending',
  'screening',
  'reviewed',
  'interview',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
]);

export default function JobAnalyticsScreen() {
  const { t } = useTranslation(['jobs', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const jobId = Number(id);
  const safeId = Number.isFinite(jobId) && jobId > 0 ? jobId : 0;

  const analyticsApi = useApi(
    () => getJobAnalytics(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );
  const predictionsApi = useApi(
    () => getJobPredictions(safeId),
    [safeId],
    { enabled: safeId > 0 },
  );

  const analytics = analyticsApi.data?.data ?? null;
  const predictions = predictionsApi.data?.data ?? null;

  if (safeId === 0) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('analytics.title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="analytics-outline"
          title={t('detail.invalidId')}
          subtitle={t('detail.invalidIdHint')}
          actionLabel={t('detail.browseJobs')}
          onAction={() => router.replace('/(modals)/jobs')}
        />
      </SafeAreaView>
    );
  }

  if (analyticsApi.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('analytics.title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <View className="flex-1 items-center justify-center">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (analyticsApi.error || !analytics) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('analytics.title')} backLabel={t('common:back')} fallbackHref="/(modals)/jobs" />
        <EmptyState
          icon="analytics-outline"
          title={analyticsApi.error ?? t('analytics.no_data')}
          subtitle={t('analytics.no_data_hint')}
          actionLabel={t('retry')}
          onAction={analyticsApi.refresh}
        />
      </SafeAreaView>
    );
  }

  const maxViews = Math.max(...analytics.views_by_day.map((day) => Number(day.count)), 1);
  const maxWeeklyApplications = Math.max(...analytics.weekly_trend.map((week) => Number(week.count)), 1);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar
          title={t('analytics.title')}
          backLabel={t('common:back')}
          fallbackHref={{ pathname: '/(modals)/job-detail', params: { id: String(safeId) } }}
          rightAction={{
            accessibilityLabel: t('retry'),
            icon: 'refresh-outline',
            onPress: analyticsApi.refresh,
          }}
        />

        <ScrollView contentContainerStyle={{ gap: 16, padding: 16, paddingBottom: 32 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="analytics-outline" size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                    {t('analytics.eyebrow')}
                  </Text>
                  <Text className="mt-1 text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {t('analytics.title')}
                  </Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('analytics.subtitle')}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <View className="flex-row flex-wrap gap-3">
            <MetricCard icon="eye-outline" label={t('analytics.total_views')} value={formatNumber(analytics.total_views)} tint={primary} theme={theme} />
            <MetricCard icon="people-outline" label={t('analytics.unique_viewers')} value={formatNumber(analytics.unique_viewers)} tint={theme.success} theme={theme} />
            <MetricCard icon="document-text-outline" label={t('analytics.total_applications')} value={formatNumber(analytics.total_applications)} tint={theme.warning} theme={theme} />
            <MetricCard icon="trending-up-outline" label={t('analytics.conversion_rate')} value={`${analytics.conversion_rate}%`} tint={theme.info ?? primary} theme={theme} />
          </View>

          {(analytics.referral_stats || analytics.scorecard_avg !== null) ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                  {t('analytics.quality_signals')}
                </Text>
                {analytics.referral_stats ? (
                  <View className="gap-3">
                    <InlineStat label={t('analytics.referral_shares')} value={formatNumber(analytics.referral_stats.total_shares)} theme={theme} />
                    <InlineStat label={t('analytics.referral_apps')} value={formatNumber(analytics.referral_stats.referral_applications)} theme={theme} />
                    <InlineStat label={t('analytics.referral_conversion')} value={`${analytics.referral_stats.referral_conversion_pct}%`} theme={theme} />
                  </View>
                ) : null}
                {analytics.scorecard_avg !== null ? (
                  <Chip size="sm" variant="secondary">
                    <Ionicons name="star-outline" size={13} color={analytics.scorecard_avg >= 60 ? (theme.success) : (theme.warning)} />
                    <Chip.Label>{t('analytics.scorecard_value', { value: analytics.scorecard_avg })}</Chip.Label>
                  </Chip>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          ) : null}

          <View className="flex-row gap-3">
            {analytics.avg_time_to_apply_hours !== null ? (
              <MetricCard icon="time-outline" label={t('analytics.avg_time_to_apply')} value={t('analytics.hours_value', { count: analytics.avg_time_to_apply_hours })} tint={theme.textSecondary} theme={theme} />
            ) : null}
            {analytics.time_to_fill_days !== null ? (
              <MetricCard icon="hourglass-outline" label={t('analytics.time_to_fill')} value={t('analytics.days_value', { count: analytics.time_to_fill_days })} tint={theme.textSecondary} theme={theme} />
            ) : null}
          </View>

          {analytics.views_by_day.length > 0 ? (
            <ChartCard
              title={t('analytics.views_over_time')}
              items={analytics.views_by_day.map((item) => ({
                key: item.date,
                label: formatShortDate(item.date),
                value: Number(item.count),
              }))}
              maxValue={maxViews}
              tint={primary}
              theme={theme}
            />
          ) : null}

          {analytics.weekly_trend.length > 0 ? (
            <ChartCard
              title={t('analytics.weekly_trend')}
              items={analytics.weekly_trend.map((item) => ({
                key: item.week,
                label: item.week,
                value: Number(item.count),
              }))}
              maxValue={maxWeeklyApplications}
              tint={theme.warning}
              theme={theme}
            />
          ) : null}

          {analytics.applications_by_stage.length > 0 ? (
            <ApplicationsByStageCard analytics={analytics} primary={primary} theme={theme} t={t} />
          ) : null}

          <PredictionsCard
            predictions={predictions}
            isLoading={predictionsApi.isLoading}
            primary={primary}
            theme={theme}
            t={t}
          />
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tint,
  theme,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  tint: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroCard className="min-w-[46%] flex-1 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="size-10 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(tint, 0.14) }}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
        <Text className="text-xs font-semibold" style={{ color: theme.textSecondary }} numberOfLines={2}>
          {label}
        </Text>
        <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
          {value}
        </Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function InlineStat({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <Surface variant="secondary" className="flex-row items-center justify-between rounded-panel-inner p-3">
      <Text className="flex-1 text-sm" style={{ color: theme.textSecondary }}>{label}</Text>
      <Text className="text-base font-bold" style={{ color: theme.text }}>{value}</Text>
    </Surface>
  );
}

function ChartCard({
  title,
  items,
  maxValue,
  tint,
  theme,
}: {
  title: string;
  items: { key: string; label: string; value: number }[];
  maxValue: number;
  tint: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
          {title}
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="h-44 flex-row items-end gap-2 pb-2">
            {items.map((item) => {
              const height = Math.max(8, Math.round((item.value / maxValue) * 120));
              return (
                <View key={item.key} className="w-10 items-center gap-2">
                  <Text className="text-[10px] font-semibold" style={{ color: theme.textSecondary }}>
                    {item.value}
                  </Text>
                  <View className="w-full rounded-t-2xl" style={{ height, backgroundColor: tint }} />
                  <Text className="text-[10px]" style={{ color: theme.textMuted }} numberOfLines={1}>
                    {item.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ApplicationsByStageCard({
  analytics,
  primary,
  theme,
  t,
}: {
  analytics: JobAnalyticsData;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const total = analytics.total_applications || 1;
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
          {t('analytics.applications_by_stage')}
        </Text>
        {analytics.applications_by_stage.map((item) => {
          const pct = Math.round((Number(item.count) / total) * 100);
          return (
            <View key={item.stage} className="gap-2">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm font-semibold" style={{ color: theme.text }}>
                  {t(getApplicationStatusKey(item.stage))}
                </Text>
                <Text className="text-sm font-bold" style={{ color: theme.textSecondary }}>
                  {t('analytics.stage_count', { count: Number(item.count), percentage: pct })}
                </Text>
              </View>
              <View className="h-2 overflow-hidden rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                <View className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: primary }} />
              </View>
            </View>
          );
        })}
      </HeroCard.Body>
    </HeroCard>
  );
}

function PredictionsCard({
  predictions,
  isLoading,
  primary,
  theme,
  t,
}: {
  predictions: JobPredictionsData | null;
  isLoading: boolean;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles-outline" size={18} color={primary} />
          <Text className="flex-1 text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
            {t('analytics.predictions')}
          </Text>
          {predictions ? (
            <Chip size="sm" variant="secondary">
              <Chip.Label>{t('analytics.based_on', { count: predictions.similar_jobs_analyzed })}</Chip.Label>
            </Chip>
          ) : null}
        </View>

        {isLoading ? (
          <LoadingSpinner />
        ) : !predictions ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('analytics.no_predictions')}</Text>
        ) : (
          <View className="gap-3">
            <View className="flex-row gap-3">
              <PredictionTile label={t('analytics.expected_apps')} value={formatNumber(predictions.expected_applications.value)} meta={t('analytics.current_value', { count: predictions.expected_applications.current })} theme={theme} />
              <PredictionTile
                label={t('analytics.conversion_comparison')}
                value={`${predictions.conversion_rate.yours}%`}
                meta={t('analytics.avg_value', { value: predictions.conversion_rate.average })}
                theme={theme}
              />
            </View>
            <PredictionTile
              label={t('analytics.time_to_fill')}
              value={predictions.estimated_time_to_fill.value ? t('analytics.days_value', { count: predictions.estimated_time_to_fill.value }) : t('analytics.not_available')}
              meta={t('analytics.posted_days_ago', { days: predictions.estimated_time_to_fill.days_posted })}
              theme={theme}
            />
            {predictions.salary_comparison ? (
              <PredictionTile
                label={t('analytics.salary_comparison')}
                value={t('analytics.salary_comparison_value', {
                  yours: formatNumber(predictions.salary_comparison.your_salary),
                  market: formatNumber(predictions.salary_comparison.market_avg),
                })}
                meta={t('analytics.salary_difference', {
                  value: predictions.salary_comparison.diff_percent,
                  label: predictions.salary_comparison.label,
                })}
                theme={theme}
              />
            ) : null}
            {(predictions.ai_insights ?? []).length > 0 ? (
              <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3">
                <Text className="text-sm font-bold" style={{ color: primary }}>{t('analytics.ai_insights')}</Text>
                {(predictions.ai_insights ?? []).map((insight) => (
                  <Text key={insight} className="text-sm leading-5" style={{ color: theme.text }}>
                    {insight}
                  </Text>
                ))}
              </Surface>
            ) : null}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function PredictionTile({ label, value, meta, theme }: { label: string; value: string; meta: string; theme: ReturnType<typeof useTheme> }) {
  return (
    <Surface variant="secondary" className="min-w-0 flex-1 rounded-panel-inner p-3">
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>{label}</Text>
      <Text className="mt-1 text-xl font-bold" style={{ color: theme.text }} numberOfLines={2}>{value}</Text>
      <Text className="mt-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>{meta}</Text>
    </Surface>
  );
}

function getApplicationStatusKey(stage: string) {
  return APPLICATION_STATUSES.has(stage)
    ? `applications.status.${stage}`
    : 'analytics.unknown_stage';
}

function formatNumber(value: number) {
  return Number(value).toLocaleString();
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
}
