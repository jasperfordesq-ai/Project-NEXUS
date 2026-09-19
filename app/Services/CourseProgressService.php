<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\Course;
use App\Models\CourseEnrollment;
use App\Models\CourseLesson;
use App\Models\CourseLessonProgress;
use App\Models\CourseQuiz;
use App\Models\CourseQuizAttempt;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CourseProgressService — records lesson completion, recomputes course progress,
 * and finalises course completion (which triggers integrations in Phase 3:
 * gamification XP/badges, learn-to-earn credits, feed posts).
 */
class CourseProgressService
{
    /** A missing quiz or an unreviewed/failed attempt cannot satisfy an assessment. */
    public static function quizPassedForLesson(CourseLesson $lesson, int $userId): bool
    {
        if ($lesson->content_type !== 'quiz') {
            return true;
        }

        $quiz = CourseQuiz::where('course_id', $lesson->course_id)->where('lesson_id', $lesson->id)->first();
        return $quiz !== null && CourseQuizAttempt::where('quiz_id', $quiz->id)
            ->where('user_id', $userId)
            ->where('passed', true)
            ->whereIn('grading_status', ['auto', 'graded'])
            ->exists();
    }

    public static function unmetQuizLessonIds(int $courseId, int $userId): array
    {
        return self::unmetQuizLessonsByCourse([$courseId], $userId)[$courseId] ?? [];
    }

    /** @return array<int,array<int,int>> Unsatisfied quiz lessons, fetched together for course lists. */
    public static function unmetQuizLessonsByCourse(array $courseIds, int $userId): array
    {
        if ($courseIds === []) return [];

        return CourseLesson::whereIn('course_id', $courseIds)->where('content_type', 'quiz')
            ->whereDoesntHave('quiz', fn ($quiz) => $quiz
                ->whereColumn('course_quizzes.course_id', 'course_lessons.course_id')
                ->whereIn('course_quizzes.id', CourseQuizAttempt::where('user_id', $userId)
                    ->where('passed', true)->whereIn('grading_status', ['auto', 'graded'])->select('quiz_id')))
            ->get(['id', 'course_id'])->groupBy('course_id')
            ->map(fn ($lessons) => $lessons->pluck('id')->all())->all();
    }

    /**
     * Mark a lesson complete for a user and recompute course progress.
     *
     * @return array{enrollment:CourseEnrollment,progress_percent:float,course_completed:bool}
     */
    public static function completeLesson(CourseEnrollment $enrollment, int $lessonId, int $userId, int $watchPercent = 100): array
    {
        $lesson = CourseLesson::where('course_id', $enrollment->course_id)->findOrFail($lessonId);
        if (!self::quizPassedForLesson($lesson, $userId)) {
            throw \Illuminate\Validation\ValidationException::withMessages([
                'lesson' => __('api_controllers_2.courses.quiz_pass_required'),
            ]);
        }

        CourseLessonProgress::updateOrCreate(
            [
                'enrollment_id' => $enrollment->id,
                'lesson_id' => $lessonId,
            ],
            [
                'user_id' => $userId,
                'status' => 'completed',
                'watch_percent' => max(0, min(100, $watchPercent)),
                'completed_at' => Carbon::now(),
            ]
        );

        return self::recompute($enrollment, $userId);
    }

    /**
     * Recompute a course's completion percentage from lesson progress and
     * finalise completion when every lesson is done.
     *
     * @return array{enrollment:CourseEnrollment,progress_percent:float,course_completed:bool}
     */
    public static function recompute(CourseEnrollment $enrollment, int $userId): array
    {
        [$enrollment, $percent, $justCompleted] = DB::transaction(function () use ($enrollment, $userId) {
            // Requests can carry independently loaded, stale enrolments. Serialize
            // the transition against the persisted row before firing integrations.
            $enrollment = CourseEnrollment::whereKey($enrollment->id)->lockForUpdate()->firstOrFail();
            $totalLessons = CourseLesson::where('course_id', $enrollment->course_id)->count();

            $completedLessons = CourseLessonProgress::where('enrollment_id', $enrollment->id)
                ->where('status', 'completed')
                ->whereNotIn('lesson_id', self::unmetQuizLessonIds((int) $enrollment->course_id, $userId))
                ->count();

            $percent = $totalLessons > 0
                ? round(($completedLessons / $totalLessons) * 100, 2)
                : 0;

            $enrollment->progress_percent = $percent;
            $enrollment->last_accessed_at = Carbon::now();

            $justCompleted = false;
            if ($totalLessons > 0 && $completedLessons >= $totalLessons && $enrollment->status !== 'completed') {
                $enrollment->status = 'completed';
                $enrollment->completed_at = Carbon::now();
                $justCompleted = true;
            }

            $enrollment->save();
            if ($justCompleted) {
                Course::where('id', $enrollment->course_id)->increment('completion_count');
            }
            if ($enrollment->status === 'completed' && $percent >= 100) {
                CourseCompletionDeliveryService::record($enrollment);
            }
            return [$enrollment, $percent, $justCompleted];
        });

        if ($enrollment->status === 'completed' && $percent >= 100) {
            app(CourseCompletionDeliveryService::class)->dispatchForEnrollment(
                (int) $enrollment->tenant_id,
                (int) $enrollment->id,
                true,
            );
        }

        return [
            'enrollment' => $enrollment,
            'progress_percent' => $percent,
            'course_completed' => $justCompleted,
        ];
    }

}
