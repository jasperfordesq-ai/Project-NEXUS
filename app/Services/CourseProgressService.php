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
use Carbon\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\DB;

/**
 * CourseProgressService — records lesson completion, recomputes course progress,
 * and finalises course completion (which triggers integrations in Phase 3:
 * gamification XP/badges, learn-to-earn credits, feed posts).
 */
class CourseProgressService
{
    /**
     * Mark a lesson complete for a user and recompute course progress.
     *
     * @return array{enrollment:CourseEnrollment,progress_percent:float,course_completed:bool}
     */
    public static function completeLesson(CourseEnrollment $enrollment, int $lessonId, int $userId, int $watchPercent = 100): array
    {
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
        [$enrollment, $percent, $justCompleted] = DB::transaction(function () use ($enrollment) {
            // Requests can carry independently loaded, stale enrolments. Serialize
            // the transition against the persisted row before firing integrations.
            $enrollment = CourseEnrollment::whereKey($enrollment->id)->lockForUpdate()->firstOrFail();
            $totalLessons = CourseLesson::where('course_id', $enrollment->course_id)->count();

            $completedLessons = CourseLessonProgress::where('enrollment_id', $enrollment->id)
                ->where('status', 'completed')
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
            return [$enrollment, $percent, $justCompleted];
        });

        if ($justCompleted) {
            self::onCourseCompleted($enrollment, $userId);
        }

        return [
            'enrollment' => $enrollment,
            'progress_percent' => $percent,
            'course_completed' => $justCompleted,
        ];
    }

    /**
     * Fired exactly once when a learner finishes a course.
     *
     * Phase 1: bump the course completion counter + award gamification XP/badge.
     * Phase 3 extends this with learn/teach-to-earn credits, certificate issuance,
     * and feed posts. Each integration is wrapped defensively so a failure in one
     * never blocks course completion.
     */
    private static function onCourseCompleted(CourseEnrollment $enrollment, int $userId): void
    {
        // Issue a completion certificate (idempotent). Guarded so a certificate
        // failure never blocks the learner's progress.
        try {
            CourseCertificateService::issue($enrollment->course_id, $userId);
        } catch (\Throwable $e) {
            Log::warning('[CourseProgress] certificate issue failed', ['error' => $e->getMessage()]);
        }

        // Completion notification (in-app + email), rendered in the learner's locale.
        try {
            CourseNotificationService::completed($enrollment->course_id, $userId);
        } catch (\Throwable $e) {
            Log::warning('[CourseProgress] completion notification failed', ['error' => $e->getMessage()]);
        }

        // Gamification: award XP + a course-completion badge. Guarded so a
        // gamification outage never blocks the learner's progress.
        try {
            if (class_exists(\App\Services\GamificationService::class)) {
                $courseTitle = (string) (Course::where('id', $enrollment->course_id)->value('title') ?? '');
                \App\Services\GamificationService::awardXP(
                    $userId,
                    50,
                    'course.completed',
                    __('svc_notifications_2.course.completed', ['title' => $courseTitle])
                );
                \App\Services\GamificationService::awardBadgeByKey($userId, 'course_graduate');
            }
        } catch (\Throwable $e) {
            Log::warning('[CourseProgress] gamification award failed', ['error' => $e->getMessage()]);
        }
    }
}
