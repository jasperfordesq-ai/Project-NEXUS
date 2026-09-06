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

import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import FeatureGate from '@/components/FeatureGate';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';
import Toggle from '@/components/ui/Toggle';
import { useAppToast } from '@/components/ui/AppToast';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  gradeCourseAttempt,
  getCourseGradingQueue,
  type PendingAttempt,
  type QuizQuestion,
} from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

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

export default function CourseGradingRoute() {
  /*
    Gated like the React route (`<FeatureGate feature="courses">`). Hiding the "+"
    menu entry was never a gate: a deep link, a notification or a shared URL all
    reach this screen directly. See components/FeatureGate.tsx.
  */
  const { t } = useTranslation('courses');
  return (
    <FeatureGate feature="courses" title={t('grading.title')} fallbackHref="/(modals)/course-instructor">
      <ModalErrorBoundary>
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

  const courseId = Number(params.id);
  const hasCourse = Number.isFinite(courseId) && courseId > 0;

  const { data, isLoading, error, refresh } = useApi(
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
  const [isRefreshing, setIsRefreshing] = useState(false);

  const attempts = (data ?? []).filter((attempt) => !gradedIds.includes(attempt.id));

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    setGradedIds([]);
    refresh();
    setIsRefreshing(false);
  }, [refresh]);

  const onGraded = useCallback((attemptId: number) => {
    setGradedIds((current) => (current.includes(attemptId) ? current : [...current, attemptId]));
  }, []);

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
      <GradeCard key={attempt.id} attempt={attempt} onGraded={onGraded} />
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
              refreshing={isRefreshing}
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
          {body()}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function GradeCard({
  attempt,
  onGraded,
}: {
  attempt: PendingAttempt;
  onGraded: (attemptId: number) => void;
}) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();

  const [score, setScore] = useState('70');
  const [passed, setPassed] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const questions = attempt.quiz?.questions ?? [];
  const rawAnswers = Object.entries(attempt.answers ?? {});

  async function submit() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await gradeCourseAttempt(attempt.id, {
        score_percent: Number(score) || 0,
        passed,
        feedback: feedback.trim(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('grading.graded'), variant: 'success' });
      onGraded(attempt.id);
    } catch (err) {
      showToast({
        title: t('grading.error'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
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
          onChangeText={setScore}
          keyboardType="number-pad"
          style={{ color: theme.text }}
          accessibilityLabel={t('grading.score')}
        />
        <Toggle
          value={passed}
          onValueChange={setPassed}
          label={t('grading.passed')}
          accessibilityLabel={t('grading.passed')}
        />
        <TextArea
          label={t('grading.feedback')}
          value={feedback}
          onChangeText={setFeedback}
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
