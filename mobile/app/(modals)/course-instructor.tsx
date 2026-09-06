// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Instructor dashboard — the native equivalent of
 * `react-frontend/src/pages/courses/InstructorDashboardPage.tsx`.
 *
 * 🔴 Owner's report, 2026-09-04: "I couldn't see anything for courses". The Create menu
 * handed the member to the WEBSITE to author a course, because the app had no builder at
 * all. This screen and `new-course.tsx` are that builder.
 */

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Chip } from '@/components/ui/StatusChip';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import { getAuthoredCourses, publishCourse, unpublishCourse, type Course } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function CourseInstructorRoute() {
  return (
    <ModalErrorBoundary>
      <CourseInstructorScreen />
    </ModalErrorBoundary>
  );
}

function CourseInstructorScreen() {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { data, isLoading, error, refresh } = useApi(() => getAuthoredCourses(), []);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const courses = data ?? [];

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    refresh();
    // `useApi` owns the request; the spinner is released as soon as the member sees it move.
    setIsRefreshing(false);
  }, [refresh]);

  async function togglePublish(course: Course) {
    if (togglingId !== null) return;
    setTogglingId(course.id);
    try {
      const updated = course.status === 'published'
        ? await unpublishCourse(course.id)
        : await publishCourse(course.id);
      showToast({
        title: updated.status === 'published'
          ? updated.moderation_status === 'approved'
            ? t('builder.published_toast')
            : t('instructor.pending_review')
          : t('builder.unpublished_toast'),
        variant: 'success',
      });
      refresh();
    } catch (err) {
      showToast({
        title: t('instructor.create_error'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      setTogglingId(null);
    }
  }

  function statusLabel(course: Course): string {
    if (course.status === 'published' && course.moderation_status === 'approved') {
      return t('instructor.published');
    }
    if (course.moderation_status === 'pending' && course.status !== 'draft') {
      return t('instructor.pending_review');
    }
    return t('instructor.draft');
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('instructor.dashboard')} backLabel={t('common:back')} fallbackHref="/(modals)/courses" />
      <FlatList
        data={courses}
        keyExtractor={(course) => String(course.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={primary} colors={[primary]} />
        }
        ListHeaderComponent={
          <View className="mb-4 gap-3">
            <HeroCard className="overflow-hidden rounded-panel p-0">
              <View className="h-1" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-1 p-4">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                  {t('instructor.dashboard')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('instructor.my_courses')}
                </Text>
              </HeroCard.Body>
            </HeroCard>
            <HeroButton onPress={() => router.push('/(modals)/new-course')}>
              <HeroButton.Label>{t('instructor.create_course')}</HeroButton.Label>
            </HeroButton>
          </View>
        }
        renderItem={({ item: course }) => (
          <HeroCard className="mb-3 rounded-panel">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row flex-wrap items-center gap-2">
                <Chip size="sm" variant="secondary"><Chip.Label>{statusLabel(course)}</Chip.Label></Chip>
              </View>
              <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {course.title}
              </Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {`${t('instructor.enrollments')}: ${course.enrollment_count ?? 0} · ${t('instructor.completions')}: ${course.completion_count ?? 0}`}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <HeroButton
                  size="sm"
                  variant="secondary"
                  onPress={() => router.push({ pathname: '/(modals)/new-course', params: { id: String(course.id) } })}
                >
                  <HeroButton.Label>{t('instructor.edit_course')}</HeroButton.Label>
                </HeroButton>
                <HeroButton
                  size="sm"
                  isDisabled={togglingId === course.id}
                  onPress={() => void togglePublish(course)}
                >
                  <HeroButton.Label>
                    {course.status === 'published' ? t('instructor.unpublish') : t('instructor.publish')}
                  </HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-12"><LoadingSpinner /></View>
          ) : error ? (
            <ErrorState
              title={t('instructor.create_error')}
              subtitle={error}
              retryLabel={t('common:buttons.retry')}
              onRetry={() => refresh()}
              testID="course-instructor-error"
            />
          ) : (
            <EmptyState
              icon="school-outline"
              title={t('instructor.no_courses')}
              actionLabel={t('instructor.create_course')}
              onAction={() => router.push('/(modals)/new-course')}
              testID="course-instructor-empty"
            />
          )
        }
      />
    </SafeAreaView>
  );
}
