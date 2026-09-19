<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Exceptions\MaxAttemptsExceededException;
use App\Models\CourseEnrollment;
use App\Models\CourseQuiz;
use App\Models\CourseQuizAttempt;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CourseQuizService — quiz delivery and grading.
 * Phase 1 auto-grades objective questions (mcq, multi, truefalse). Subjective
 * questions (short, essay) are flagged pending_review for instructor grading
 * in Phase 2.
 */
class CourseQuizService
{
    private const OBJECTIVE_TYPES = ['mcq', 'multi', 'truefalse'];

    /**
     * Quiz payload for a learner — questions WITHOUT correct answers/explanations.
     */
    public static function forLearner(int $quizId, ?int $userId = null): ?array
    {
        $quiz = CourseQuiz::with('questions')->find($quizId);
        if (!$quiz) {
            return null;
        }

        $questions = $quiz->questions->map(static function ($q) {
            return [
                'id' => $q->id,
                'type' => $q->type,
                'prompt' => $q->prompt,
                'options' => $q->options,
                'points' => $q->points,
                'position' => $q->position,
            ];
        })->values()->all();

        $latest = $userId === null ? null : CourseQuizAttempt::where('quiz_id', $quizId)
            ->where('user_id', $userId)->orderByDesc('id')->first();

        return [
            'id' => $quiz->id,
            'course_id' => $quiz->course_id,
            'lesson_id' => $quiz->lesson_id,
            'title' => $quiz->title,
            'description' => $quiz->description,
            'pass_mark_percent' => $quiz->pass_mark_percent,
            'max_attempts' => $quiz->max_attempts,
            'attempts_remaining' => $userId === null || $quiz->max_attempts <= 0
                ? null : max(0, $quiz->max_attempts - self::attemptsUsed($quizId, $userId)),
            'time_limit_minutes' => $quiz->time_limit_minutes,
            'questions' => $questions,
            'latest_attempt' => $latest === null ? null : [
                'attempt_id' => $latest->id,
                'score_percent' => (float) $latest->score_percent,
                'passed' => (bool) $latest->passed,
                'needs_review' => $latest->grading_status === 'pending_review',
            ],
        ];
    }

    public static function attemptsUsed(int $quizId, int $userId): int
    {
        return CourseQuizAttempt::where('quiz_id', $quizId)
            ->where('user_id', $userId)
            ->count();
    }

    /**
     * Grade and persist a quiz attempt.
     *
     * @param array<int|string,mixed> $answers map of question_id => answer(s)
     * @return array{attempt:CourseQuizAttempt,score_percent:float,passed:bool,needs_review:bool}
     */
    public static function submitAttempt(int $quizId, int $userId, array $answers, ?int $enrollmentId = null, ?string $idempotencyKey = null): array
    {
        $idempotencyKey = trim((string) $idempotencyKey);
        if ($idempotencyKey !== '' && (strlen($idempotencyKey) < 8 || strlen($idempotencyKey) > 191)) {
            throw new \InvalidArgumentException('Invalid quiz attempt identity');
        }
        $keyHash = $idempotencyKey === '' ? null : hash('sha256', $idempotencyKey);
        $canonicalAnswers = $answers;
        ksort($canonicalAnswers);
        $requestHash = $keyHash === null ? null : hash('sha256', json_encode($canonicalAnswers, JSON_THROW_ON_ERROR));

        return DB::transaction(function () use ($quizId, $userId, $answers, $enrollmentId, $keyHash, $requestHash) {
            // Serialize concurrent submissions for this learner so the max_attempts
            // ceiling can't be raced (count-then-insert was a TOCTOU hole). The
            // enrollment row is the natural lock target — one per learner+course, and
            // every quiz belongs to that course. When no enrollment id is supplied
            // (service-level callers), the count check below still enforces the cap.
            if ($enrollmentId !== null) {
                CourseEnrollment::whereKey($enrollmentId)->lockForUpdate()->first();
            }

            // Enrollment first, then quiz: keyed service callers without an enrollment
            // still serialize replay lookup and insertion on the same quiz row.
            $query = CourseQuiz::with('questions');
            if ($keyHash !== null) $query->lockForUpdate();
            $quiz = $query->findOrFail($quizId);

            if ($keyHash !== null) {
                $existing = CourseQuizAttempt::where('quiz_id', $quizId)
                    ->where('user_id', $userId)
                    ->where('idempotency_key_hash', $keyHash)
                    ->first();
                if ($existing) {
                    if (!hash_equals((string) $existing->request_hash, (string) $requestHash)) {
                        throw new \InvalidArgumentException('Quiz attempt identity was reused for different answers');
                    }
                    return [
                        'attempt' => $existing,
                        'score_percent' => (float) $existing->score_percent,
                        'passed' => (bool) $existing->passed,
                        'needs_review' => $existing->grading_status === 'pending_review',
                    ];
                }
            }

            $maxAttempts = (int) $quiz->max_attempts;
            if ($maxAttempts > 0 && self::attemptsUsed($quizId, $userId) >= $maxAttempts) {
                throw new MaxAttemptsExceededException();
            }

            $totalPoints = 0;
            $earnedPoints = 0;
            $needsReview = false;

            foreach ($quiz->questions as $question) {
                $points = max(1, (int) $question->points);
                $totalPoints += $points;

                $given = $answers[$question->id] ?? $answers[(string) $question->id] ?? null;

                if (!in_array($question->type, self::OBJECTIVE_TYPES, true)) {
                    // Subjective — defer to instructor grading.
                    $needsReview = true;
                    continue;
                }

                if (self::isCorrect($question->correct ?? [], $given)) {
                    $earnedPoints += $points;
                }
            }

            $scorePercent = $totalPoints > 0 ? round(($earnedPoints / $totalPoints) * 100, 2) : 0;
            $passed = !$needsReview && $scorePercent >= (int) $quiz->pass_mark_percent;

            $attempt = CourseQuizAttempt::create([
                'quiz_id' => $quizId,
                'user_id' => $userId,
                'enrollment_id' => $enrollmentId,
                'answers' => $answers,
                'score_percent' => $scorePercent,
                'passed' => $passed,
                'grading_status' => $needsReview ? 'pending_review' : 'auto',
                'submitted_at' => Carbon::now(),
                ...($keyHash === null ? [] : [
                    'idempotency_key_hash' => $keyHash,
                    'request_hash' => $requestHash,
                ]),
            ]);

            return [
                'attempt' => $attempt,
                'score_percent' => $scorePercent,
                'passed' => $passed,
                'needs_review' => $needsReview,
            ];
        });
    }

    /**
     * Attempts awaiting instructor review for a course (subjective questions).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function pendingReviewForCourse(int $courseId): array
    {
        $quizIds = CourseQuiz::where('course_id', $courseId)->pluck('id')->all();
        if (!$quizIds) {
            return [];
        }

        return CourseQuizAttempt::whereIn('quiz_id', $quizIds)
            ->where('grading_status', 'pending_review')
            ->with([
                'quiz:id,title',
                // Include question prompts/options so the grader sees readable
                // questions + the learner's answers (not a raw JSON blob). The
                // answer key is never exposed: 'correct'/'explanation' are omitted
                // by the column select AND by CourseQuestion::$hidden.
                'quiz.questions:id,quiz_id,type,prompt,options,points,position',
                'user:id,name,avatar_url',
            ])
            ->orderBy('submitted_at')
            ->get()
            ->toArray();
    }

    /**
     * Apply an instructor grade to an attempt.
     */
    public static function gradeAttempt(int $attemptId, float $scorePercent, bool $passed, ?string $feedback, int $gradedBy): ?CourseQuizAttempt
    {
        $result = self::gradeAttemptWithOutcome($attemptId, $scorePercent, $passed, $feedback, $gradedBy);

        return in_array($result['outcome'], ['completed', 'replayed'], true)
            ? $result['attempt']
            : null;
    }

    /**
     * Grade a pending attempt under one row lock.
     *
     * The exact same instructor/request is an idempotent replay, which lets a
     * mobile client recover a response lost after commit. A stale or competing
     * different grade is a conflict and cannot overwrite the first decision.
     *
     * @return array{outcome: 'completed'|'replayed'|'conflict'|'not_found', attempt: CourseQuizAttempt|null}
     */
    public static function gradeAttemptWithOutcome(
        int $attemptId,
        float $scorePercent,
        bool $passed,
        ?string $feedback,
        int $gradedBy
    ): array {
        return DB::transaction(function () use ($attemptId, $scorePercent, $passed, $feedback, $gradedBy): array {
            $attempt = CourseQuizAttempt::query()->lockForUpdate()->find($attemptId);
            if (!$attempt) {
                return ['outcome' => 'not_found', 'attempt' => null];
            }

            $score = max(0, min(100, $scorePercent));
            if ($attempt->grading_status !== 'pending_review') {
                $isExactReplay = $attempt->grading_status === 'graded'
                    && (int) $attempt->graded_by === $gradedBy
                    && abs((float) $attempt->score_percent - $score) < 0.00001
                    && (bool) $attempt->passed === $passed
                    && (string) ($attempt->feedback ?? '') === (string) ($feedback ?? '');

                return [
                    'outcome' => $isExactReplay ? 'replayed' : 'conflict',
                    'attempt' => $attempt,
                ];
            }

            $attempt->score_percent = $score;
            $attempt->passed = $passed;
            $attempt->feedback = $feedback;
            $attempt->grading_status = 'graded';
            $attempt->graded_by = $gradedBy;
            $attempt->save();

            return ['outcome' => 'completed', 'attempt' => $attempt];
        });
    }

    /**
     * The course id that owns a given attempt (via its quiz), or null.
     */
    public static function courseIdForAttempt(int $attemptId): ?int
    {
        $attempt = CourseQuizAttempt::find($attemptId);
        if (!$attempt) {
            return null;
        }
        $quiz = CourseQuiz::find($attempt->quiz_id);
        return $quiz?->course_id;
    }

    /**
     * Compare a learner's answer against the stored correct answer(s).
     * Handles single (mcq/truefalse) and multi-select (order-independent).
     */
    private static function isCorrect($correct, $given): bool
    {
        $correctArr = array_map('strval', (array) $correct);
        $givenArr = array_map('strval', (array) $given);

        sort($correctArr);
        sort($givenArr);

        return $correctArr === $givenArr && $correctArr !== [];
    }
}
