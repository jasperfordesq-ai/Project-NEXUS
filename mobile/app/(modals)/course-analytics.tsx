// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Course analytics — the native equivalent of
 * `react-frontend/src/pages/courses/CourseAnalyticsPage.tsx`.
 *
 * The enrolment funnel, completion rate, average progress and average quiz score, plus the
 * per-lesson completion curve that shows where learners stop.
 *
 * The web page draws that curve with Recharts. Here it is plain Views, the same decision
 * `components/podcasts/PodcastShowStatsPanel.tsx` already made: a charting library is not
 * worth the bundle for six numbers and a list of bars.
 *
 * Opened as `/(modals)/course-analytics?id=<courseId>`.
 */

import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import FeatureGate from '@/components/FeatureGate';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getCourseAnalytics, type CourseAnalytics } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export default function CourseAnalyticsRoute() {
  /*
    Gated like the React route (`<FeatureGate feature="courses">`). Hiding the "+"
    menu entry was never a gate: a deep link, a notification or a shared URL all
    reach this screen directly. See components/FeatureGate.tsx.
  */
  const { t } = useTranslation('courses');
  return (
    <FeatureGate feature="courses" title={t('analytics.title')} fallbackHref="/(modals)/course-instructor">
      <ModalErrorBoundary>
        <CourseAnalyticsScreen />
      </ModalErrorBoundary>
    </FeatureGate>
  );
}

function CourseAnalyticsScreen() {
  const { t } = useTranslation(['courses', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const primary = usePrimaryColor();

  const courseId = Number(params.id);
  const hasCourse = Number.isFinite(courseId) && courseId > 0;

  const { data, isLoading, error, refresh } = useApi<CourseAnalytics>(
    () => getCourseAnalytics(courseId),
    [courseId],
    { enabled: hasCourse },
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    refresh();
    setIsRefreshing(false);
  }, [refresh]);

  function body() {
    if (isLoading) {
      return (
        <View className="py-12">
          <LoadingSpinner />
        </View>
      );
    }
    if (error) {
      return (
        <ErrorState
          subtitle={error}
          retryLabel={t('common:buttons.retry')}
          onRetry={() => refresh()}
          testID="course-analytics-error"
        />
      );
    }
    /*
      The web page collapses "no course id", "the request returned nothing" and "analytics
      are off" into one sentence. Keep that: a course with no analytics is not a failure the
      member can act on, so it gets a statement rather than a retry button.
    */
    if (!hasCourse || !data) {
      return (
        <EmptyState
          icon="stats-chart-outline"
          title={t('analytics.unavailable')}
          testID="course-analytics-unavailable"
        />
      );
    }

    const stats: { key: string; label: string; value: string }[] = [
      { key: 'total', label: t('analytics.total_enrollments'), value: String(data.enrollments.total) },
      { key: 'active', label: t('analytics.active'), value: String(data.enrollments.active) },
      { key: 'completed', label: t('analytics.completed'), value: String(data.enrollments.completed) },
      { key: 'completion_rate', label: t('analytics.completion_rate'), value: `${data.completion_rate}%` },
      { key: 'avg_progress', label: t('analytics.avg_progress'), value: `${data.avg_progress}%` },
      { key: 'avg_quiz_score', label: t('analytics.avg_quiz_score'), value: `${data.avg_quiz_score}%` },
    ];

    const perLesson = data.per_lesson ?? [];
    // Never divide by zero, and never let an all-zero course draw full-width bars.
    const maxCompleted = Math.max(1, ...perLesson.map((lesson) => lesson.completed ?? 0));

    return (
      <>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-1 p-4">
            <Text className="text-2xl font-bold" style={{ color: theme.text }}>{data.course.title}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('analytics.title')}</Text>
          </HeroCard.Body>
        </HeroCard>

        <View className="mb-4 flex-row flex-wrap gap-2">
          {stats.map((stat) => (
            <View
              key={stat.key}
              className="min-w-[46%] flex-1 rounded-panel-inner px-3 py-2"
              style={{ backgroundColor: withAlpha(primary, 0.08) }}
            >
              <Text className="text-xl font-bold" style={{ color: theme.text }}>{stat.value}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('analytics.per_lesson')}</Text>
            {perLesson.length === 0 ? (
              <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('analytics.no_lessons')}</Text>
            ) : (
              perLesson.map((lesson) => (
                <View key={lesson.lesson_id} className="gap-1">
                  <View className="flex-row items-center justify-between gap-2">
                    <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.text }} numberOfLines={2}>
                      {lesson.title}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>
                      {String(lesson.completed ?? 0)}
                    </Text>
                  </View>
                  <View
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ backgroundColor: theme.borderSubtle }}
                  >
                    <View
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: primary,
                        width: `${Math.max(4, ((lesson.completed ?? 0) / maxCompleted) * 100)}%`,
                      }}
                    />
                  </View>
                </View>
              ))
            )}
          </HeroCard.Body>
        </HeroCard>
      </>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('analytics.title')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/course-instructor"
      />
      <ScrollView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
      >
        {body()}
      </ScrollView>
    </SafeAreaView>
  );
}
