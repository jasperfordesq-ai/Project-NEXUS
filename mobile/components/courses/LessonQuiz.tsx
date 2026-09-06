// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A quiz lesson, taken inside the app.
 *
 * 🔴 The native player had no quiz at all before this. A `quiz` lesson rendered as its
 * title and a "Mark as complete" button, so a learner could pass a graded assessment
 * without being shown a single question — and the app then reported the lesson 100%
 * watched. This is the missing half of journey 4.x on mobile.
 *
 * The quiz is fetched rather than read off the lesson: `CourseQuizService::forLearner` is
 * the shape with the answer key removed, and it is the only shape a learner may see. That
 * endpoint also re-checks enrolment and drip availability, so a locked quiz is refused
 * here as well as at completion.
 */

import { useCallback, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button as HeroButton } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  getCourseQuiz,
  submitCourseQuizAttempt,
  type CourseQuiz,
  type QuizAttemptResult,
  type QuizQuestion,
} from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type AnswerMap = Record<string, string | string[]>;

/**
 * True/false questions carry no `options` from the authoring side, so the two choices are
 * synthesised here. The submitted values match what `CourseQuizService` grades against.
 */
function optionsFor(question: QuizQuestion, trueLabel: string, falseLabel: string) {
  if (question.options && question.options.length > 0) return question.options;
  if (question.type === 'truefalse') {
    return [{ id: 'true', label: trueLabel }, { id: 'false', label: falseLabel }];
  }
  return [];
}

function isChoiceSelected(answer: string | string[] | undefined, optionId: string): boolean {
  if (Array.isArray(answer)) return answer.includes(optionId);
  return answer === optionId;
}

export default function LessonQuiz({ quizId }: { quizId: number }) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const quizState = useApi(() => getCourseQuiz(quizId), [quizId], { enabled: quizId > 0 });
  const quiz = quizState.data as CourseQuiz | null;
  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);

  const toggleChoice = useCallback((question: QuizQuestion, optionId: string) => {
    setAnswers((current) => {
      const key = String(question.id);
      if (question.type !== 'multi') return { ...current, [key]: optionId };
      const existing = Array.isArray(current[key]) ? (current[key] as string[]) : [];
      return {
        ...current,
        [key]: existing.includes(optionId)
          ? existing.filter((id) => id !== optionId)
          : [...existing, optionId],
      };
    });
  }, []);

  const submit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      setResult(await submitCourseQuizAttempt(quizId, answers));
    } catch (err) {
      // 🔴 The server's own words, not a generic retry prompt. MAX_ATTEMPTS_REACHED is
      // authoritative and final — telling a learner to "try again" would be a lie, and
      // hiding the reason leaves them tapping a button that cannot ever work.
      setSubmitError(describeApiError(err, t('player.action_failed')));
    } finally {
      setSubmitting(false);
    }
  }, [answers, quizId, submitting, t]);

  if (quizState.isLoading) {
    return <View className="items-center py-8"><LoadingSpinner /></View>;
  }

  if (quizState.error || !quiz) {
    return (
      <View className="gap-3 py-4">
        <Text style={{ color: theme.textSecondary }}>
          {quizState.error ?? t('quiz.unavailable')}
        </Text>
        {quizState.error ? (
          <HeroButton variant="secondary" onPress={() => void quizState.refresh()}>
            <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-4" testID="lesson-quiz">
      <View className="gap-1">
        <Text className="text-lg font-semibold" style={{ color: theme.text }}>{quiz.title}</Text>
        {quiz.description ? (
          <Text className="text-sm leading-6" style={{ color: theme.textSecondary }}>{quiz.description}</Text>
        ) : null}
        {typeof quiz.pass_mark_percent === 'number' ? (
          <Text className="text-xs" style={{ color: theme.textSecondary }}>
            {t('quiz.pass_mark', { percent: quiz.pass_mark_percent })}
          </Text>
        ) : null}
      </View>

      {questions.length === 0 ? (
        <Text style={{ color: theme.textSecondary }}>{t('quiz.unavailable')}</Text>
      ) : null}

      {questions.map((question, index) => {
        const key = String(question.id);
        const choices = optionsFor(question, t('quiz.true'), t('quiz.false'));
        const answer = answers[key];

        return (
          <View
            key={question.id}
            className="gap-3 rounded-panel border p-4"
            style={{ borderColor: theme.border }}
          >
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
              {t('quiz.question_position', { index: index + 1, total: questions.length })}
            </Text>
            <Text className="text-base font-medium" style={{ color: theme.text }}>{question.prompt}</Text>

            {choices.length > 0 ? (
              <View className="gap-2">
                {choices.map((option) => {
                  const selected = isChoiceSelected(answer, option.id);
                  return (
                    <HeroButton
                      key={option.id}
                      variant={selected ? 'primary' : 'secondary'}
                      /*
                        Both roles are stated: `radio` / `checkbox` tells a screen reader
                        that this is a choice and which state it is in, which a plain
                        button label cannot. Single-choice and multi-choice really do
                        behave differently, so they must not announce identically.
                      */
                      accessibilityRole={question.type === 'multi' ? 'checkbox' : 'radio'}
                      accessibilityState={{ checked: selected }}
                      onPress={() => toggleChoice(question, option.id)}
                    >
                      <HeroButton.Label>{option.label}</HeroButton.Label>
                    </HeroButton>
                  );
                })}
              </View>
            ) : (
              <TextInput
                accessibilityLabel={question.prompt}
                multiline
                numberOfLines={question.type === 'essay' ? 6 : 3}
                onChangeText={(text) => setAnswers((current) => ({ ...current, [key]: text }))}
                placeholder={t('quiz.answer_placeholder')}
                placeholderTextColor={theme.textSecondary}
                style={{
                  borderColor: theme.border,
                  borderWidth: 1,
                  borderRadius: 10,
                  color: theme.text,
                  minHeight: question.type === 'essay' ? 120 : 72,
                  padding: 12,
                  textAlignVertical: 'top',
                }}
                value={typeof answer === 'string' ? answer : ''}
              />
            )}
          </View>
        );
      })}

      {result ? (
        <View
          className="gap-1 rounded-panel p-4"
          style={{
            backgroundColor: withAlpha(
              result.needs_review ? theme.warning : result.passed ? theme.success : theme.error,
              0.12,
            ),
          }}
          testID="quiz-result"
        >
          <Text className="font-semibold" style={{ color: theme.text }}>
            {result.needs_review
              ? t('quiz.pending_review')
              : result.passed
                ? t('quiz.passed')
                : t('quiz.failed')}
          </Text>
          {/* A score is meaningless while free-text answers are still with a human. */}
          {result.needs_review ? null : (
            <Text style={{ color: theme.textSecondary }}>
              {t('quiz.score', { score: Math.round(result.score_percent) })}
            </Text>
          )}
        </View>
      ) : null}

      {submitError ? (
        <Text testID="quiz-error" style={{ color: theme.error }}>{submitError}</Text>
      ) : null}

      <HeroButton isDisabled={submitting || questions.length === 0} onPress={() => void submit()}>
        <HeroButton.Label>
          {submitting
            ? t('quiz.submitting')
            : result
              ? t('quiz.retry')
              : t('quiz.submit')}
        </HeroButton.Label>
      </HeroButton>
    </View>
  );
}
