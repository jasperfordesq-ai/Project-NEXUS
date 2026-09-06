// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import { completeCourseLesson, getCourse, getCourseProgress, type CourseProgress } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function CoursePlayerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const courseId = Number(id);
  const { t } = useTranslation(['courses', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show } = useAppToast();
  const [saving, setSaving] = useState(false);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [progressPercent, setProgressPercent] = useState(0);
  const courseState = useApi(() => getCourse(courseId), [courseId], { enabled: Number.isFinite(courseId) && courseId > 0 });
  const progressState = useApi(() => getCourseProgress(courseId), [courseId], { enabled: Number.isFinite(courseId) && courseId > 0 });
  const lessons = useMemo(() => courseState.data?.sections?.flatMap((section) => section.lessons ?? []) ?? [], [courseState.data]);
  const [lessonIndex, setLessonIndex] = useState(0);
  const lesson = lessons[lessonIndex];

  useEffect(() => {
    const progress = progressState.data as CourseProgress | null;
    if (!progress) return;
    const percent = Number(progress.enrollment.progress_percent);
    // `progress_percent` is typed `string | number`; a missing one made the bar `NaN%` wide.
    setProgressPercent(Number.isFinite(percent) ? percent : 0);
    setCompletedIds(new Set(progress.lessons.filter((item) => item.status === 'completed').map((item) => item.lesson_id)));
  }, [progressState.data]);

  async function markComplete() {
    if (!lesson || saving) return;
    setSaving(true);
    try {
      const result = await completeCourseLesson(courseId, lesson.id);
      setCompletedIds((current) => new Set(current).add(lesson.id));
      setProgressPercent(result.progress_percent);
      show({ title: t('player.lesson_completed'), variant: 'success' });
    } catch (err) {
      // The server's reason was discarded, so "please try again" was the only thing a member
      // ever saw — including when trying again could not work (audit 2026-09-06).
      show({ title: t('player.action_failed'), description: describeApiError(err, ''), variant: 'danger' });
    } finally {
      setSaving(false);
    }
  }

  const isLoading = courseState.isLoading || progressState.isLoading;
  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={courseState.data?.title ?? t('title')} backLabel={t('common:back')} fallbackHref="/(modals)/courses" />
        {isLoading ? <View className="flex-1 items-center justify-center"><LoadingSpinner /></View> : !lesson ? (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <Text style={{ color: theme.textSecondary }}>{courseState.error ?? progressState.error ?? t('detail.no_lessons')}</Text>
            {courseState.error || progressState.error ? (
              <HeroButton onPress={() => { void courseState.refresh(); void progressState.refresh(); }}>
                <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
            <Text className="mb-2 text-sm font-semibold" style={{ color: theme.textSecondary }}>{t('player.course_progress')}: {Math.round(progressPercent)}%</Text>
            <View
              accessibilityLabel={t('player.course_progress')}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPercent) }}
              className="mb-5 h-2.5 overflow-hidden rounded-full bg-default-200"
            >
              <View className="h-2.5 rounded-full" style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%`, backgroundColor: primary }} />
            </View>
            <HeroCard className="rounded-panel">
              <HeroCard.Body className="gap-4 p-5">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{lesson.title}</Text>
                {lesson.body ? <Text className="text-base leading-7" style={{ color: theme.text }}>{lesson.body}</Text> : null}
                {lesson.transcript ? <View className="gap-2"><Text className="font-bold" style={{ color: theme.text }}>{t('player.transcript')}</Text><Text className="leading-6" style={{ color: theme.textSecondary }}>{lesson.transcript}</Text></View> : null}
                <HeroButton isDisabled={saving || completedIds.has(lesson.id)} onPress={() => void markComplete()}>
                  <HeroButton.Label>{completedIds.has(lesson.id) ? t('player.completed') : t('player.mark_complete')}</HeroButton.Label>
                </HeroButton>
                <View className="flex-row justify-between gap-3">
                  <HeroButton variant="secondary" isDisabled={lessonIndex === 0} onPress={() => setLessonIndex((value) => Math.max(0, value - 1))}><HeroButton.Label>{t('player.prev_lesson')}</HeroButton.Label></HeroButton>
                  <HeroButton variant="secondary" isDisabled={lessonIndex >= lessons.length - 1} onPress={() => setLessonIndex((value) => Math.min(lessons.length - 1, value + 1))}><HeroButton.Label>{t('player.next_lesson')}</HeroButton.Label></HeroButton>
                </View>
              </HeroCard.Body>
            </HeroCard>
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
