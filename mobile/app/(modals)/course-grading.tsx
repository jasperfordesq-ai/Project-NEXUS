// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Grading queue — the native equivalent of
 * `react-frontend/src/pages/courses/CourseGradingPage.tsx`.
 *
 * Quiz attempts containing short-answer or essay questions cannot be marked by the server,
 * so they sit at `grading_status = pending_review` until an instructor decides. Until now
 * that decision could only be made on the website, which meant a course authored in the app
 * could never be finished in the app.
 *
 * Opened as `/(modals)/course-grading?id=<courseId>`.
 */

import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Card as HeroCard, Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import FeatureGate from '@/components/FeatureGate';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';
import Toggle from '@/components/ui/Toggle';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { useAuthContext } from '@/lib/context/AuthContext';
import { parseDecimalInput } from '@/lib/utils/decimal';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import {
  gradeCourseAttempt,
  getCourseGradingQueue,
  type PendingAttempt,
  type QuizQuestion,
} from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withRouteGate } from '@/components/withRouteGate';

/**
 * A learner's answer in words: an objective answer arrives as option id(s) and has to be
 * mapped back to its label, while short-answer and essay text is already readable.
 * Returns '' when there is nothing — the caller shows the "no answer" wording instead.
 */
export function formatAnswer(question: QuizQuestion, answers: PendingAttempt['answers']): string {
  if (!answers) return '';
  const raw = answers[String(question.id)];
  if (raw === null || raw === undefined || raw === '') return '';
  if (question.options && question.options.length > 0) {
    const ids = Array.isArray(raw) ? raw.map(String) : [String(raw)];
    return ids.map((id) => question.options?.find((option) => option.id === id)?.label ?? id).join(', ');
  }
  return Array.isArray(raw) ? raw.map(String).join(', ') : String(raw);
}

function CourseGradingRoute() {
  /*
    Gated like the React route (`<FeatureGate feature="courses">`). Hiding the "+"
    menu entry was never a gate: a deep link, a notification or a shared URL all
    reach this screen directly. See components/FeatureGate.tsx.
  */
  const { t } = useTranslation('courses');
  const params = useLocalSearchParams<{ id?: string }>();
  const { user } = useAuthContext();
  const { tenant } = useTenant();
  return (
    <FeatureGate feature="courses" title={t('grading.title')} fallbackHref="/(modals)/course-instructor">
      <ModalErrorBoundary key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}:${params.id ?? 'invalid'}`}>
        <CourseGradingScreen />
      </ModalErrorBoundary>
    </FeatureGate>
  );
}

function CourseGradingScreen() {
  const { t } = useTranslation(['courses', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { confirm, confirmDialog } = useConfirm();

  const courseId = Number(params.id);
  const hasCourse = Number.isFinite(courseId) && courseId > 0;

  const { data, isLoading, error, errorStatus, refresh } = useApi(
    () => getCourseGradingQueue(courseId),
    [courseId],
    { enabled: hasCourse },
  );

  /*
    Attempts graded during this visit. The server drops them from the queue on the next
    read, but the member must see the row leave the moment they grade it — not after a
    round trip they did not ask for.
  */
  const [gradedIds, setGradedIds] = useState<number[]>([]);
  const [draftStates, setDraftStates] = useState<Record<number, { dirty: boolean; saving: boolean }>>({});

  const attempts = (data ?? []).filter((attempt) => !gradedIds.includes(attempt.id));

  const onRefresh = useCallback(() => {
    refresh();
  }, [refresh]);

  const onGraded = useCallback((attemptId: number) => {
    setGradedIds((current) => (current.includes(attemptId) ? current : [...current, attemptId]));
    setDraftStates((current) => {
      if (!current[attemptId]) return current;
      const next = { ...current };
      delete next[attemptId];
      return next;
    });
  }, []);

  const onDraftStateChange = useCallback((attemptId: number, dirty: boolean, saving: boolean) => {
    setDraftStates((current) => {
      const previous = current[attemptId];
      if (!dirty && !saving) {
        if (!previous) return current;
        const next = { ...current };
        delete next[attemptId];
        return next;
      }
      if (previous?.dirty === dirty && previous.saving === saving) return current;
      return { ...current, [attemptId]: { dirty, saving } };
    });
  }, []);

  const hasDirtyDraft = Object.values(draftStates).some((state) => state.dirty);
  const hasPendingGrade = Object.values(draftStates).some((state) => state.saving);

  useUnsavedChangesGuard({
    isDirty: hasDirtyDraft || hasPendingGrade,
    isSaving: hasPendingGrade,
    confirm,
    title: t('courses:instructor.unsaved_title'),
    message: t('courses:instructor.unsaved_message'),
    discardLabel: t('courses:instructor.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  function body() {
    if (isLoading && !data) {
      return (
        <View className="py-12">
          <LoadingSpinner />
        </View>
      );
    }
    /* 🔴 Grading is course-owner-only, so somebody who is not the instructor — or who
       stopped being one — gets 403 here, and a Retry could never clear it. */
    if (isRefusalStatus(errorStatus)) {
      return (
        <EmptyState
          icon="lock-closed-outline"
          title={t('common:errors.notAvailableTitle')}
          subtitle={t('common:errors.notAvailableHint')}
          testID="course-grading-refused"
        />
      );
    }
    if (error && !data) {
      return (
        <ErrorState
          subtitle={error}
          retryLabel={t('common:buttons.retry')}
          onRetry={() => refresh()}
          testID="course-grading-error"
        />
      );
    }
    if (attempts.length === 0) {
      return (
        <EmptyState
          icon="checkmark-done-outline"
          title={t('grading.empty')}
          testID="course-grading-empty"
        />
      );
    }
    return attempts.map((attempt) => (
      <GradeCard
        key={attempt.id}
        attempt={attempt}
        onGraded={onGraded}
        onDraftStateChange={onDraftStateChange}
      />
    ));
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('grading.title')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/course-instructor"
      />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          className="flex-1"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={isLoading && Boolean(data)}
              onRefresh={onRefresh}
              tintColor={primary}
              colors={[primary]}
            />
          }
        >
          <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
            <View className="h-1" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-1 p-4">
              <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('grading.title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('instructor.dashboard')}
              </Text>
            </HeroCard.Body>
          </HeroCard>
          <RefreshFailedNotice error={data && !isRefusalStatus(errorStatus) ? error : null} onRetry={refresh} isRetrying={isLoading} />
          {body()}
        </ScrollView>
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

function GradeCard({
  attempt,
  onGraded,
  onDraftStateChange,
}: {
  attempt: PendingAttempt;
  onGraded: (attemptId: number) => void;
  onDraftStateChange: (attemptId: number, dirty: boolean, saving: boolean) => void;
}) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  const [score, setScore] = useState('70');
  const [passed, setPassed] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const reportDraft = (nextScore: string, nextPassed: boolean, nextFeedback: string, saving: boolean) => {
    const dirty = nextScore !== '70' || !nextPassed || nextFeedback !== '';
    onDraftStateChange(attempt.id, dirty, saving);
  };

  const questions = attempt.quiz?.questions ?? [];
  const rawAnswers = Object.entries(attempt.answers ?? {});

  async function submit() {
    if (savingRef.current) return;
    /*
      🔴 `Number(score) || 0` recorded a mistyped grade as ZERO, silently.

      An instructor in a comma-decimal locale (de, es, fr, it, pt) types "82,5", taps
      Submit, sees a success toast — and the learner is recorded at 0%. Any other slip did
      the same, because `|| 0` turns NaN into a real, wrong mark. Found by the 2026-09-07
      audit (G/F-9). The grade is now parsed properly and refused if it is not a number
      between 0 and 100, rather than coerced into one.
    */
    const parsedScore = parseDecimalInput(score);
    if (parsedScore === null || !Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 100) {
      showToast({
        title: t('grading.scoreInvalidTitle'),
        description: t('grading.scoreInvalidMessage'),
        variant: 'warning',
      });
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    reportDraft(score, passed, feedback, true);
    try {
      const payload = {
        score_percent: parsedScore,
        passed,
        feedback: feedback.trim(),
      };
      try {
        await gradeCourseAttempt(attempt.id, payload);
      } catch (err) {
        // Grading is a desired-state write. The server accepts an exact replay
        // by the same instructor, so one response-loss retry can recover the
        // committed result without overwriting another grader's decision.
        if (!(err instanceof ApiResponseError) || err.status !== 0) throw err;
        await gradeCourseAttempt(attempt.id, payload);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('grading.graded'), variant: 'success' });
      savingRef.current = false;
      setIsSaving(false);
      onDraftStateChange(attempt.id, false, false);
      onGraded(attempt.id);
    } catch (err) {
      savingRef.current = false;
      setIsSaving(false);
      const wasGradedElsewhere = err instanceof ApiResponseError && err.code === 'DECISION_CONFLICT';
      if (wasGradedElsewhere) {
        onDraftStateChange(attempt.id, false, false);
        onGraded(attempt.id);
      } else {
        reportDraft(score, passed, feedback, false);
      }
      showToast({
        title: t('grading.error'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    }
  }

  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Avatar uri={attempt.user?.avatar_url} name={attempt.user?.name} size={36} decorative />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-bold" style={{ color: theme.text }}>
              {attempt.user?.name ?? `#${attempt.user_id}`}
            </Text>
            {attempt.quiz?.title ? (
              <Text className="text-xs" style={{ color: theme.textMuted }}>{attempt.quiz.title}</Text>
            ) : null}
          </View>
        </View>

        {questions.length > 0 ? (
          <View className="gap-2">
            {questions.map((question) => {
              const answer = formatAnswer(question, attempt.answers);
              return (
                <View
                  key={question.id}
                  className="gap-1 rounded-panel-inner p-3"
                  style={{ borderWidth: 1, borderColor: theme.border }}
                >
                  <Text className="text-sm font-semibold" style={{ color: theme.text }}>{question.prompt}</Text>
                  <Text className="text-sm" style={{ color: answer ? theme.text : theme.textMuted }}>
                    {`${t('grading.answer')}: ${answer || t('grading.no_answer')}`}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : rawAnswers.length > 0 ? (
          /*
            Defensive fallback, exactly as on the web page: if the question metadata did
            not come back, show readable "#id: value" lines rather than a JSON blob.
          */
          <View className="gap-1">
            {rawAnswers.map(([questionId, value]) => (
              <Text key={questionId} className="text-sm" style={{ color: theme.text }}>
                {`#${questionId}: ${Array.isArray(value) ? value.map(String).join(', ') : String(value ?? '')}`}
              </Text>
            ))}
          </View>
        ) : null}

        <Input
          label={t('grading.score')}
          value={score}
          onChangeText={(next) => {
            setScore(next);
            reportDraft(next, passed, feedback, isSaving);
          }}
          editable={!isSaving}
          keyboardType="number-pad"
          style={{ color: theme.text }}
          accessibilityLabel={t('grading.score')}
        />
        <Toggle
          value={passed}
          onValueChange={(next) => {
            setPassed(next);
            reportDraft(score, next, feedback, isSaving);
          }}
          disabled={isSaving}
          label={t('grading.passed')}
          accessibilityLabel={t('grading.passed')}
        />
        <TextArea
          label={t('grading.feedback')}
          value={feedback}
          onChangeText={(next) => {
            setFeedback(next);
            reportDraft(score, passed, next, isSaving);
          }}
          editable={!isSaving}
          placeholder={t('grading.feedback')}
          placeholderTextColor={theme.textMuted}
          style={{ color: theme.text }}
          accessibilityLabel={t('grading.feedback')}
        />
        <HeroButton size="sm" isDisabled={isSaving} onPress={() => void submit()}>
          <HeroButton.Label>{t('grading.submit')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

export default withRouteGate(CourseGradingRoute, 'course-grading');
