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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { describeApiError } from '@/lib/api/describeApiError';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import { acknowledgeQuizAttempt, loadQuizAttempt, prepareQuizAttempt, rejectQuizAttempt, QuizAttemptTooLargeError, type QuizAttemptScope, type SavedQuizAttempt } from '@/lib/quizAttemptStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';
import { useConfirm } from '@/components/ui/useConfirm';
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

/**
 * Whether a question has actually been answered.
 *
 * An untouched multi-choice question can still hold `[]`, and a free-text one can
 * hold whitespace the learner typed and deleted. Both used to count as answered,
 * which is part of why the submit button looked live on a blank quiz.
 */
function hasAnswer(answer: string | string[] | undefined): boolean {
  if (Array.isArray(answer)) return answer.length > 0;
  return typeof answer === 'string' && answer.trim().length > 0;
}

export default function LessonQuiz({ quizId, onAttemptResolved, gradeRevision = 0 }: { quizId: number; onAttemptResolved?: () => void; gradeRevision?: number }) {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const tenantId = Number(tenant?.id);
  const userId = Number(user?.id);
  return <LessonQuizBody key={`${tenantId}:${userId}:${quizId}`} quizId={quizId} tenantId={tenantId} userId={userId} onAttemptResolved={onAttemptResolved} gradeRevision={gradeRevision} />;
}

function LessonQuizBody({ quizId, tenantId, userId, onAttemptResolved, gradeRevision }: QuizAttemptScope & { onAttemptResolved?: () => void; gradeRevision: number }) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [result, setResult] = useState<QuizAttemptResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const scope = useMemo(() => ({ quizId, tenantId, userId }), [quizId, tenantId, userId]);
  const [restoring, setRestoring] = useState(true);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState(0);
  const [restoredEmpty, setRestoredEmpty] = useState(false);
  const editedAnswersRef = useRef(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [attemptsExhausted, setAttemptsExhausted] = useState(false);
  const attemptsExhaustedRef = useRef(false);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null | undefined>(undefined);
  const attemptsRemainingRef = useRef<number | null | undefined>(undefined);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    setRestoring(true);
    setRestoreFailed(false);
    void loadQuizAttempt(scope).then(saved => {
      if (cancelled) return;
      setRestoredEmpty(saved === null);
      if (saved) {
        setAnswers(saved.answers);
        setResult(saved.status === 'acknowledged' ? saved.result ?? null : null);
        pendingRef.current = saved.status === 'pending';
        setPending(pendingRef.current);
        const exhausted = saved.status === 'rejected' && saved.rejectionCode === 'MAX_ATTEMPTS_REACHED'
          && (attemptsRemainingRef.current === undefined || attemptsRemainingRef.current === 0);
        attemptsExhaustedRef.current = exhausted;
        setAttemptsExhausted(exhausted);
      }
    }).catch(() => { if (!cancelled) setRestoreFailed(true); })
      .finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, [scope, restoreRevision]);

  const quizState = useApi(() => getCourseQuiz(quizId), [quizId, gradeRevision], { enabled: quizId > 0 });
  const quiz = quizState.data as CourseQuiz | null;
  useEffect(() => {
    if (!quiz) return;
    attemptsRemainingRef.current = quiz.attempts_remaining;
    setAttemptsRemaining(quiz.attempts_remaining);
    if (quiz.attempts_remaining !== undefined && quiz.attempts_remaining !== 0) {
      if (attemptsExhaustedRef.current) setSubmitError(null);
      attemptsExhaustedRef.current = false;
      setAttemptsExhausted(false);
    }
  }, [quiz]);
  const limitReached = attemptsExhausted || (!pending && attemptsRemaining === 0);
  const questions = useMemo(() => quiz?.questions ?? [], [quiz]);
  useEffect(() => {
    const latest = quiz?.latest_attempt;
    if (!restoring && restoredEmpty && !editedAnswersRef.current && !pending && !submitting && latest && result !== latest) {
      setResult(latest);
      return;
    }
    // A fresh grade may resolve this receipt; another attempt must never replace the draft.
    if (!pending && !submitting && result?.needs_review && latest
        && latest.attempt_id === result.attempt_id && !latest.needs_review) {
      setResult(latest);
    }
  }, [pending, quiz?.latest_attempt, restoredEmpty, restoring, result, submitting]);

  const toggleChoice = useCallback((question: QuizQuestion, optionId: string) => {
    if (submittingRef.current || pendingRef.current) return;
    editedAnswersRef.current = true;
    setResult(null);
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

  const answeredCount = useMemo(
    () => questions.filter((question) => hasAnswer(answers[String(question.id)])).length,
    [answers, questions],
  );

  const submit = useCallback(async () => {
    if (!mountedRef.current || submittingRef.current || attemptsExhaustedRef.current
        || (!pendingRef.current && attemptsRemainingRef.current === 0) || restoring || restoreFailed) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setResult(null);
    let attempt: SavedQuizAttempt | null = null;
    try {
      attempt = await prepareQuizAttempt(scope, answers);
      if (!mountedRef.current) return;
      pendingRef.current = true;
      setPending(true);
      const nextResult = await submitCourseQuizAttempt(quizId, attempt.answers, attempt.key);
      if (mountedRef.current && nextResult.attempts_remaining !== undefined) {
        attemptsRemainingRef.current = nextResult.attempts_remaining;
        setAttemptsRemaining(nextResult.attempts_remaining);
      }
      if (mountedRef.current) setResult(nextResult);
      await acknowledgeQuizAttempt(scope, attempt.key, nextResult);
      pendingRef.current = false;
      if (mountedRef.current) setPending(false);
      if (mountedRef.current) onAttemptResolved?.();
    } catch (err) {
      if (attempt && err instanceof ApiResponseError && err.status === 422) {
        try {
          await rejectQuizAttempt(scope, attempt.key, err.code ?? 'VALIDATION_FAILED');
          pendingRef.current = false;
          if (mountedRef.current) setPending(false);
        } catch { /* Retain the replay identity until rejection is durable. */ }
      }
      // 🔴 The server's own words, not a generic retry prompt. MAX_ATTEMPTS_REACHED is
      // authoritative and final — telling a learner to "try again" would be a lie, and
      // hiding the reason leaves them tapping a button that cannot ever work.
      if (mountedRef.current) {
        if (err instanceof ApiResponseError && err.code === 'MAX_ATTEMPTS_REACHED') {
          attemptsExhaustedRef.current = true;
          setAttemptsExhausted(true);
        }
        setSubmitError(err instanceof ApiResponseError ? describeApiError(err, t('player.action_failed'))
          : err instanceof QuizAttemptTooLargeError ? t('quiz.answers_too_long') : t('quiz.storage_failed'));
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }, [answers, onAttemptResolved, quizId, restoreFailed, restoring, scope, t]);

  /**
   * 🔴 An attempt is a limited resource, and this button used to spend one on
   * anything — including a completely empty quiz. A stray tap while scrolling, or
   * pressing Submit before reading the questions, sent `{}`, scored 0%, and burned
   * one of (often) three tries. The learner had no way to get it back.
   *
   * So: nothing to submit is refused outright, and a partly-finished quiz asks
   * first and says plainly what it will cost. A complete quiz submits as before —
   * the point is to stop accidents, not to add a step to normal use.
   */
  const requestSubmit = useCallback(() => {
    if (submitting || attemptsExhaustedRef.current || (!pendingRef.current && attemptsRemainingRef.current === 0)) return;
    if (pendingRef.current) { void submit(); return; }
    if (result) {
      // Starting another attempt must not spend it before the learner reviews answers.
      editedAnswersRef.current = true;
      setResult(null);
      setSubmitError(null);
      return;
    }
    if (answeredCount === 0) return;

    if (answeredCount < questions.length) {
      confirm({
        title: t('quiz.incomplete_title'),
        message: quiz?.max_attempts
          ? t('quiz.incomplete_message_attempts', {
              answered: answeredCount,
              total: questions.length,
              max: quiz.max_attempts,
            })
          : t('quiz.incomplete_message', { answered: answeredCount, total: questions.length }),
        confirmLabel: t('quiz.incomplete_confirm'),
        cancelLabel: t('common:buttons.cancel'),
        variant: 'primary',
        confirmTestID: 'quiz-submit-incomplete-confirm',
        onConfirm: () => submit(),
      });
      return;
    }

    void submit();
  }, [answeredCount, confirm, questions.length, quiz?.max_attempts, result, submit, submitting, t]);

  if (quizState.isLoading || restoring) {
    return <View className="items-center py-8"><LoadingSpinner /></View>;
  }

  if (restoreFailed) {
    return <View className="gap-3 py-4">
      <Text style={{ color: theme.error }}>{t('quiz.storage_failed')}</Text>
      <HeroButton onPress={() => setRestoreRevision(value => value + 1)}><HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label></HeroButton>
    </View>;
  }

  if (quizState.error || !quiz) {
    return (
      <View className="gap-3 py-4">
        <Text style={{ color: theme.textSecondary }}>
          {quizState.error ?? t('quiz.unavailable')}
        </Text>
        {quizState.error && !isRefusalStatus(quizState.errorStatus) ? (
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
                      isDisabled={submitting || pending || limitReached}
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
                editable={!submitting && !pending && !limitReached}
                onChangeText={(text) => {
                  if (!submittingRef.current && !pendingRef.current) {
                    editedAnswersRef.current = true;
                    setResult(null);
                    setAnswers((current) => ({ ...current, [key]: text }));
                  }
                }}
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

      {pending ? <Text testID="quiz-pending" style={{ color: theme.textSecondary }}>{t('quiz.pending_attempt')}</Text> : null}
      {limitReached ? <Text style={{ color: theme.textSecondary }}>{t('quiz.attempts_exhausted')}</Text> : null}

      {!limitReached && !result && questions.length > 0 && answeredCount === 0 ? (
        <Text testID="quiz-nothing-answered" className="text-sm" style={{ color: theme.textSecondary }}>
          {t('quiz.nothing_answered')}
        </Text>
      ) : null}

      <HeroButton
        isDisabled={submitting || limitReached || (!pending && !result && (questions.length === 0 || answeredCount === 0))}
        testID="quiz-submit"
        onPress={requestSubmit}
      >
        <HeroButton.Label>
          {submitting
            ? t('quiz.submitting')
            : limitReached ? t('quiz.attempts_exhausted')
            : pending ? t('quiz.recover_attempt')
            : result
              ? t('quiz.retry')
              : t('quiz.submit')}
        </HeroButton.Label>
      </HeroButton>
      {confirmDialog}
    </View>
  );
}
