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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import LessonContent from '@/components/courses/LessonContent';
import AppTopBar from '@/components/ui/AppTopBar';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Ionicons } from '@/components/ui/Icon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import {
  completeCourseLesson,
  getCourse,
  getCourseProgress,
  type CourseProgress,
  type LessonAvailability,
} from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { withRouteGate } from '@/components/withRouteGate';

function CoursePlayerScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  return (
    <ModalErrorBoundary key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${id ?? 'invalid'}`}>
      <CoursePlayerScreenInner />
    </ModalErrorBoundary>
  );
}

function CoursePlayerScreenInner() {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { id } = useLocalSearchParams<{ id?: string }>();
  const courseId = Number(id);
  const { t } = useTranslation(['courses', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show } = useAppToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [progressPercent, setProgressPercent] = useState(0);
  /**
   * How much of the current lesson has actually been played. Reset whenever the lesson
   * changes, or lesson two would inherit lesson one's figure and report a video nobody
   * opened as watched.
   */
  const [watchPercent, setWatchPercent] = useState(100);

  useEffect(() => () => {
    isMountedRef.current = false;
  }, []);

  const enabled = Number.isFinite(courseId) && courseId > 0;
  const courseState = useApi(() => getCourse(courseId), [courseId], { enabled, clearOnRefusal: true });
  const progressState = useApi(() => getCourseProgress(courseId), [courseId], { enabled, clearOnRefusal: true });
  const refused = isRefusalStatus(courseState.errorStatus) || isRefusalStatus(progressState.errorStatus);
  const availability = useMemo<Record<number, LessonAvailability>>(
    () => Object.fromEntries((progressState.data?.availability ?? []).map((entry) => [entry.lesson_id, entry])),
    [progressState.data],
  );
  const canSaveRef = useRef(false);
  canSaveRef.current = Boolean(courseState.data && progressState.data && !refused);
  const lessons = useMemo(
    () => [
      ...(courseState.data?.sections?.flatMap((section) => section.lessons ?? []) ?? []),
      ...(courseState.data?.unassigned_lessons ?? []),
    ],
    [courseState.data],
  );
  const [selectedLessonId, setSelectedLessonId] = useState<number | null>(null);
  const lessonIndex = Math.max(0, lessons.findIndex((item) => item.id === selectedLessonId));
  const lesson = lessons[lessonIndex];
  useEffect(() => {
    if (lesson && lesson.id !== selectedLessonId) setSelectedLessonId(lesson.id);
  }, [lesson, selectedLessonId]);
  /*
    🔴 The player always opened at lesson one. A learner eleven lessons into a course
    reopened it and was put back at the beginning every single time, with nothing to say
    the app knew better — and `GET /v2/courses/{id}/progress` has always returned exactly
    which lessons are finished and which are still locked. Audit 2026-09-07.

    Once only, and only on the first arrival: the ref means a member who deliberately
    navigates back to lesson one is not dragged forward again on the next re-render.
  */
  const hasResumedRef = useRef(false);
  const [didResume, setDidResume] = useState(false);

  useEffect(() => {
    if (hasResumedRef.current) return;
    const progress = progressState.data as CourseProgress | null;
    if (!progress || lessons.length === 0) return;
    hasResumedRef.current = true;

    const completed = new Set(
      progress.lessons.filter((item) => item.status === 'completed').map((item) => item.lesson_id),
    );
    if (completed.size === 0) return;

    const unlocked = new Map((progress.availability ?? []).map((entry) => [entry.lesson_id, entry]));
    // A locked lesson is not somewhere to land: the drip gate would refuse it anyway.
    const isOpen = (lessonId: number) => unlocked.get(lessonId)?.available !== false;
    const next = lessons.findIndex((item) => !completed.has(item.id) && isOpen(item.id));

    // -1 means every lesson is either finished or still locked. If they are finished, the
    // last one is where the learner was; if they are locked, lesson one is right.
    const target = next >= 0 ? next : (completed.size >= lessons.length ? lessons.length - 1 : 0);
    if (target > 0) {
      setSelectedLessonId(lessons[target].id);
      setDidResume(true);
    }
  }, [lessons, progressState.data]);

  useEffect(() => {
    const progress = progressState.data as CourseProgress | null;
    if (!progress) return;
    const percent = Number(progress.enrollment.progress_percent);
    // `progress_percent` is typed `string | number`; a missing one made the bar `NaN%` wide.
    setProgressPercent(Number.isFinite(percent) ? percent : 0);
    setCompletedIds(new Set(
      progress.lessons.filter((item) => item.status === 'completed').map((item) => item.lesson_id),
    ));
  }, [progressState.data]);

  /*
    🔴 A video nobody played is not a video that was watched.

    This reset to 100 for EVERY lesson type, and `LessonContent` only reports a real figure
    once playback actually starts. So a learner who opened a video lesson, never pressed
    play, and tapped "Mark as complete" was recorded in the instructor's analytics as having
    watched all of it. The comment above says the reset exists to stop exactly that, and it
    was only doing half the job. Found by the 2026-09-07 audit (G/F-5).

    Non-video lessons — text, files, a link — have nothing to play, so 100 is right there.
  */
  useEffect(() => {
    setWatchPercent(lesson?.content_type === 'video' ? 0 : 100);
  }, [lesson?.id, lesson?.content_type, lesson?.video_url]);

  const lessonAvailability = lesson ? availability[lesson.id] : undefined;
  // Absent availability means the server did not express an opinion — treat as available,
  // never as locked. A learner must not be shut out by a field that failed to arrive.
  const isLocked = lessonAvailability?.available === false;
  const quizNeedsPass = lesson?.content_type === 'quiz' && lessonAvailability?.completion_allowed !== true;
  const isCompleted = lesson ? completedIds.has(lesson.id) && !quizNeedsPass : false;
  const refreshProgress = progressState.refresh;
  const [quizGradeRevision, setQuizGradeRevision] = useState(0);
  const refreshQuizProgress = useCallback(() => {
    refreshProgress();
    setQuizGradeRevision(value => value + 1);
  }, [refreshProgress]);

  const markComplete = useCallback(async () => {
    if (!isMountedRef.current || !canSaveRef.current || !lesson || savingRef.current || isLocked || quizNeedsPass) return;
    savingRef.current = true;
    setSaving(true);
    try {
      // A video lesson sends what was actually played; every other type has no playback of
      // its own and correctly reports 100.
      const result = await completeCourseLesson(courseId, lesson.id, watchPercent);
      if (!isMountedRef.current || !canSaveRef.current) return;
      setCompletedIds((current) => new Set(current).add(lesson.id));
      setProgressPercent(result.progress_percent);
      show({ title: t('player.lesson_completed'), variant: 'success' });
    } catch (err) {
      if (!isMountedRef.current || !canSaveRef.current) return;
      if (err instanceof ApiResponseError && err.status === 0) {
        try {
          const latest = await getCourseProgress(courseId);
          const completed = latest.lessons.some((item) => item.lesson_id === lesson.id && item.status === 'completed');
          if (completed && isMountedRef.current && canSaveRef.current) {
            setCompletedIds((current) => new Set(current).add(lesson.id));
            const percent = Number(latest.enrollment.progress_percent);
            setProgressPercent(Number.isFinite(percent) ? percent : progressPercent);
            show({ title: t('player.lesson_completed'), variant: 'success' });
            return;
          }
        } catch {
          // Keep the original indeterminate error if authoritative progress is unavailable.
        }
      }
      if (!isMountedRef.current || !canSaveRef.current) return;
      // The server's reason was discarded, so "please try again" was the only thing a member
      // ever saw — including when trying again could not work (audit 2026-09-06).
      show({
        title: t('player.action_failed'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      savingRef.current = false;
      if (isMountedRef.current) setSaving(false);
    }
  }, [courseId, isLocked, lesson, progressPercent, quizNeedsPass, show, t, watchPercent]);

  const retryAll = useCallback(() => {
    void courseState.refresh();
    void progressState.refresh();
  }, [courseState, progressState]);

  const isLoading = courseState.isLoading || progressState.isLoading;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={courseState.data?.title ?? t('title')}
          backLabel={t('common:back')}
          fallbackHref="/(modals)/courses"
        />
        {refused ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text style={{ color: theme.textSecondary }}>{t('common:errors.notAvailableHint')}</Text>
          </View>
        ) : isLoading && (!courseState.data || !progressState.data) ? (
          <View className="flex-1 items-center justify-center"><LoadingSpinner /></View>
        ) : !lesson ? (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <Text style={{ color: theme.textSecondary }}>
              {isRefusalStatus(courseState.errorStatus)
                ? t('common:errors.notAvailableHint')
                : courseState.error ?? progressState.error ?? t('detail.no_lessons')}
            </Text>
            {/* 🔴 No Retry on a refusal: a course a member is not enrolled on answers
                403/404 however many times it is asked. */}
            {(courseState.error || progressState.error) && !isRefusalStatus(courseState.errorStatus) ? (
              <HeroButton onPress={retryAll}>
                <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }} refreshControl={<RefreshControl refreshing={courseState.isLoading && Boolean(courseState.data)} onRefresh={() => { courseState.refresh(); progressState.refresh(); }} tintColor={primary} colors={[primary]} />}>
            <RefreshFailedNotice error={courseState.data ? courseState.error : null} onRetry={() => { courseState.refresh(); progressState.refresh(); }} />
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

            {progressState.data ? <HeroCard className="rounded-panel">
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
                    <LessonContent lesson={lesson} onWatchPercentChange={setWatchPercent} onQuizAttemptResolved={refreshQuizProgress} quizGradeRevision={quizGradeRevision} />
                    {quizNeedsPass ? (
                      <View className="gap-2">
                        <Text style={{ color: theme.textSecondary }}>{t('player.quiz_pass_required')}</Text>
                        <HeroButton testID="check-quiz-grade" variant="secondary" isDisabled={progressState.isLoading} onPress={refreshQuizProgress}>
                          <HeroButton.Label>{t('player.check_quiz_grade')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                    ) : null}
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
                      isDisabled={saving || isCompleted || quizNeedsPass || !progressState.data}
                      onPress={() => void markComplete()}
                    >
                      <HeroButton.Label>
                        {isCompleted ? t('player.completed') : t('player.mark_complete')}
                      </HeroButton.Label>
                    </HeroButton>
                  </>
                )}

                {didResume ? (
                  <View className="flex-row flex-wrap items-center gap-2" testID="course-player-resumed">
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('player.resumed')}</Text>
                    <HeroButton size="sm" variant="ghost" onPress={() => { setSelectedLessonId(lessons[0].id); setDidResume(false); }}>
                      <HeroButton.Label>{t('player.start_from_beginning')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                ) : null}

                <View testID="course-player-navigation" className={`${largeText ? '' : 'flex-row justify-between'} gap-3`}>
                  <HeroButton
                    className={largeText ? 'w-full' : undefined}
                    variant="secondary"
                    isDisabled={lessonIndex === 0}
                    onPress={() => setSelectedLessonId(lessons[Math.max(0, lessonIndex - 1)].id)}
                  >
                    <HeroButton.Label>{t('player.prev_lesson')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton
                    className={largeText ? 'w-full' : undefined}
                    variant="secondary"
                    isDisabled={lessonIndex >= lessons.length - 1}
                    onPress={() => setSelectedLessonId(lessons[Math.min(lessons.length - 1, lessonIndex + 1)].id)}
                  >
                    <HeroButton.Label>{t('player.next_lesson')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </HeroCard.Body>
            </HeroCard> : null}
          </ScrollView>
        )}
    </SafeAreaView>
  );
}

export default withRouteGate(CoursePlayerScreen, 'course-player');
