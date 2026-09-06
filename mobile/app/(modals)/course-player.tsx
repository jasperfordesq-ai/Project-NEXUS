// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The course player — journey 4.x on mobile.
 *
 * Three things this screen got wrong before the 2026-09-06 audit, all of which changed
 * what a learner was told rather than merely how it looked:
 *
 * 1. It rendered `body` and `transcript` only, so four of the five declared lesson types
 *    had no content at all. See `components/courses/LessonContent`.
 * 2. It reported `watch_percent: 100` on every completion regardless of whether anything
 *    had been played, which is what an instructor's analytics then read back.
 * 3. It consumed only the completion ids and the percentage from the progress response and
 *    ignored `availability`, so a drip-locked lesson offered ordinary navigation and a
 *    completion button that the server then refused with `LESSON_LOCKED`.
 *
 * A fourth was quieter and is fixed here too: when the course loaded but PROGRESS failed,
 * `lesson` was truthy, so the error/retry panel was skipped and the screen presented
 * "0% complete, nothing done" as though that were the member's real progress.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import LessonContent from '@/components/courses/LessonContent';
import AppTopBar from '@/components/ui/AppTopBar';
import { Ionicons } from '@/components/ui/Icon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeCourseLesson,
  getCourse,
  getCourseProgress,
  type CourseProgress,
  type LessonAvailability,
} from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

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
  const [availability, setAvailability] = useState<Record<number, LessonAvailability>>({});
  /**
   * How much of the current lesson has actually been played. Reset whenever the lesson
   * changes, or lesson two would inherit lesson one's figure and report a video nobody
   * opened as watched.
   */
  const [watchPercent, setWatchPercent] = useState(100);

  const enabled = Number.isFinite(courseId) && courseId > 0;
  const courseState = useApi(() => getCourse(courseId), [courseId], { enabled });
  const progressState = useApi(() => getCourseProgress(courseId), [courseId], { enabled });
  const lessons = useMemo(
    () => courseState.data?.sections?.flatMap((section) => section.lessons ?? []) ?? [],
    [courseState.data],
  );
  const [lessonIndex, setLessonIndex] = useState(0);
  const lesson = lessons[lessonIndex];

  useEffect(() => {
    const progress = progressState.data as CourseProgress | null;
    if (!progress) return;
    const percent = Number(progress.enrollment.progress_percent);
    // `progress_percent` is typed `string | number`; a missing one made the bar `NaN%` wide.
    setProgressPercent(Number.isFinite(percent) ? percent : 0);
    setCompletedIds(new Set(
      progress.lessons.filter((item) => item.status === 'completed').map((item) => item.lesson_id),
    ));
    // 🔴 The drip gate the screen used to throw away. `CourseEnrollmentController::progress`
    // has always returned this; without reading it the app offered a locked lesson's
    // completion button and let the server explain the refusal afterwards.
    setAvailability(Object.fromEntries(
      (progress.availability ?? []).map((entry) => [entry.lesson_id, entry]),
    ));
  }, [progressState.data]);

  useEffect(() => {
    setWatchPercent(100);
  }, [lesson?.id]);

  const lessonAvailability = lesson ? availability[lesson.id] : undefined;
  // Absent availability means the server did not express an opinion — treat as available,
  // never as locked. A learner must not be shut out by a field that failed to arrive.
  const isLocked = lessonAvailability?.available === false;
  const isCompleted = lesson ? completedIds.has(lesson.id) : false;

  const markComplete = useCallback(async () => {
    if (!lesson || saving || isLocked) return;
    setSaving(true);
    try {
      // A video lesson sends what was actually played; every other type has no playback of
      // its own and correctly reports 100.
      const result = await completeCourseLesson(courseId, lesson.id, watchPercent);
      setCompletedIds((current) => new Set(current).add(lesson.id));
      setProgressPercent(result.progress_percent);
      show({ title: t('player.lesson_completed'), variant: 'success' });
    } catch (err) {
      // The server's reason was discarded, so "please try again" was the only thing a member
      // ever saw — including when trying again could not work (audit 2026-09-06).
      show({
        title: t('player.action_failed'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      setSaving(false);
    }
  }, [courseId, isLocked, lesson, saving, show, t, watchPercent]);

  const retryAll = useCallback(() => {
    void courseState.refresh();
    void progressState.refresh();
  }, [courseState, progressState]);

  const isLoading = courseState.isLoading || progressState.isLoading;

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={courseState.data?.title ?? t('title')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/courses"
        />
        {isLoading ? (
          <View className="flex-1 items-center justify-center"><LoadingSpinner /></View>
        ) : !lesson ? (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <Text style={{ color: theme.textSecondary }}>
              {courseState.error ?? progressState.error ?? t('detail.no_lessons')}
            </Text>
            {courseState.error || progressState.error ? (
              <HeroButton onPress={retryAll}>
                <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
            {/*
              🔴 Its own panel, and deliberately NOT folded into the empty state above. When
              the course loaded and only progress failed, `lesson` was truthy so that branch
              never ran, and the screen showed 0% and unticked lessons as if that were the
              member's real standing. Unavailable progress is not zero progress.
            */}
            {progressState.error ? (
              <View
                testID="course-progress-error"
                className="mb-5 gap-3 rounded-panel p-4"
                style={{ backgroundColor: theme.errorBg }}
              >
                <Text style={{ color: theme.error }}>
                  {t('player.progress_unavailable')}
                </Text>
                <HeroButton variant="secondary" onPress={() => void progressState.refresh()}>
                  <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : (
              <>
                <Text className="mb-2 text-sm font-semibold" style={{ color: theme.textSecondary }}>
                  {t('player.course_progress')}: {Math.round(progressPercent)}%
                </Text>
                <View
                  accessibilityLabel={t('player.course_progress')}
                  accessibilityRole="progressbar"
                  accessibilityValue={{ min: 0, max: 100, now: Math.round(progressPercent) }}
                  className="mb-5 h-2.5 overflow-hidden rounded-full bg-default-200"
                >
                  <View
                    className="h-2.5 rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                      backgroundColor: primary,
                    }}
                  />
                </View>
              </>
            )}

            <HeroCard className="rounded-panel">
              <HeroCard.Body className="gap-4 p-5">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{lesson.title}</Text>

                {isLocked ? (
                  /*
                    Shown INSTEAD of the lesson and its completion button, matching the web
                    player. Offering a member a button the server is certain to refuse, and
                    only then explaining why, is the shape of failure this replaces.
                  */
                  <View testID="lesson-locked" className="items-center gap-2 py-8">
                    <Ionicons name="lock-closed-outline" size={30} color={theme.textSecondary} />
                    <Text className="text-center text-sm leading-6" style={{ color: theme.textSecondary }}>
                      {lessonAvailability?.unlock_at
                        ? t('player.locked_until', {
                            date: new Date(lessonAvailability.unlock_at)
                              .toLocaleDateString(dateLocale()),
                          })
                        : t('player.locked')}
                    </Text>
                  </View>
                ) : (
                  <>
                    <LessonContent lesson={lesson} onWatchPercentChange={setWatchPercent} />
                    {/*
                      A minimum set by the instructor is stated, not enforced here: the API
                      does not gate completion on it, so blocking the button client-side
                      would only trap a learner whose video will not play while changing
                      nothing about what the server accepts.
                    */}
                    {lesson.content_type === 'video'
                      && typeof lesson.min_watch_percent === 'number'
                      && lesson.min_watch_percent > 0
                      && watchPercent < lesson.min_watch_percent ? (
                        <Text className="text-xs" style={{ color: theme.textSecondary }}>
                          {t('player.min_watch_hint', { percent: lesson.min_watch_percent })}
                        </Text>
                      ) : null}
                    <HeroButton
                      isDisabled={saving || isCompleted}
                      onPress={() => void markComplete()}
                    >
                      <HeroButton.Label>
                        {isCompleted ? t('player.completed') : t('player.mark_complete')}
                      </HeroButton.Label>
                    </HeroButton>
                  </>
                )}

                <View className="flex-row justify-between gap-3">
                  <HeroButton
                    variant="secondary"
                    isDisabled={lessonIndex === 0}
                    onPress={() => setLessonIndex((value) => Math.max(0, value - 1))}
                  >
                    <HeroButton.Label>{t('player.prev_lesson')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton
                    variant="secondary"
                    isDisabled={lessonIndex >= lessons.length - 1}
                    onPress={() => setLessonIndex((value) => Math.min(lessons.length - 1, value + 1))}
                  >
                    <HeroButton.Label>{t('player.next_lesson')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </HeroCard.Body>
            </HeroCard>
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
