<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Models\CourseLesson;
use App\Models\CourseLessonProgress;
use App\Models\CourseReview;
use App\Services\CourseEnrollmentService;
use App\Services\CourseLessonService;
use App\Services\CourseProgressService;
use Illuminate\Http\JsonResponse;

/**
 * CourseEnrollmentController — learner enrollment, progress, and reviews.
 * All endpoints require authentication (registered under auth:sanctum).
 */
class CourseEnrollmentController extends BaseApiController
{
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    /** POST /v2/courses/{id}/enroll */
    public function enroll(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $course = $this->findCourseOrFail($id);

        if ($course->status !== 'published' || $course->moderation_status !== 'approved') {
            return $this->respondWithError('COURSE_NOT_AVAILABLE', __('api_controllers_2.courses.not_available'), null, 422);
        }
        $this->ensureCourseViewable($course, $userId);

        // Already enrolled? Return the existing enrollment without charging again.
        if (CourseEnrollmentService::isEnrolled($id, $userId)) {
            return $this->respondWithData(CourseEnrollmentService::find($id, $userId), null, 200);
        }

        // Prerequisites: block enrolment until required courses are completed.
        $unmet = \App\Services\CoursePrerequisiteService::unmetIds($course, $userId);
        if ($unmet) {
            return $this->respondWithError('PREREQUISITES_NOT_MET', __('api_controllers_2.courses.prerequisites_not_met'), null, 422);
        }

        $cohortId = $this->inputInt('cohort_id', null, 1);
        try {
            $enrollment = CourseEnrollmentService::enrollWithPayment($course, $userId, $cohortId);
        } catch (\RuntimeException) {
            return $this->respondWithError('INSUFFICIENT_CREDITS', __('api_controllers_2.courses.insufficient_credits'), null, 422);
        }

        return $this->respondWithData($enrollment, null, 201);
    }

    /** GET /v2/courses/{id}/prerequisites — prerequisite courses + completion state. */
    public function prerequisites(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseViewable($course, $userId);

        return $this->respondWithData(
            \App\Services\CoursePrerequisiteService::statusFor($course, $userId)
        );
    }

    /** GET /v2/me/courses — courses the caller is enrolled in. */
    public function myCourses(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        return $this->respondWithData(CourseEnrollmentService::forUser($userId));
    }

    /** GET /v2/courses/{id}/progress — enrollment + per-lesson progress. */
    public function progress(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $enrollment = CourseEnrollmentService::find($id, $userId);
        if (!$enrollment) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.not_enrolled'), null, 404);
        }

        $lessonProgress = CourseLessonProgress::where('enrollment_id', $enrollment->id)
            ->get(['lesson_id', 'status', 'watch_percent', 'completed_at'])
            ->toArray();

        // Drip availability per lesson (relative to enrolment date).
        $availability = [];
        foreach (CourseLesson::where('course_id', $id)->get() as $lesson) {
            $availability[] = array_merge(
                ['lesson_id' => $lesson->id],
                CourseLessonService::availability($lesson, $enrollment->enrolled_at)
            );
        }

        return $this->respondWithData([
            'enrollment' => $enrollment->toArray(),
            'lessons' => $lessonProgress,
            'availability' => $availability,
        ]);
    }

    /** POST /v2/courses/{id}/lessons/{lessonId}/complete */
    public function completeLesson(int $id, int $lessonId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $enrollment = CourseEnrollmentService::find($id, $userId);
        if (!$enrollment) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.not_enrolled'), null, 404);
        }

        // Lesson must belong to this course.
        $lesson = CourseLesson::where('id', $lessonId)->where('course_id', $id)->first();
        if (!$lesson) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        // Drip gate: a locked lesson cannot be completed yet.
        $availability = \App\Services\CourseLessonService::availability($lesson, $enrollment->enrolled_at);
        if (!$availability['available']) {
            return $this->respondWithError('LESSON_LOCKED', __('api_controllers_2.courses.lesson_locked'), null, 403);
        }

        $watchPercent = $this->inputInt('watch_percent', 100, 0, 100);
        $result = CourseProgressService::completeLesson($enrollment, $lessonId, $userId, $watchPercent);

        return $this->respondWithData([
            'progress_percent' => $result['progress_percent'],
            'course_completed' => $result['course_completed'],
        ]);
    }

    /** GET /v2/courses/{id}/certificate — completion certificate (enrolled + completed). */
    public function certificate(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $enrollment = CourseEnrollmentService::find($id, $userId);
        if (!$enrollment) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.not_enrolled'), null, 404);
        }
        if ($enrollment->status !== 'completed') {
            return $this->respondWithError('COURSE_NOT_COMPLETED', __('api_controllers_2.courses.certificate_requires_completion'), null, 403);
        }

        $cert = \App\Services\CourseCertificateService::issue($id, $userId);

        return $this->respondWithData([
            'certificate' => $cert->toArray(),
            'html' => \App\Services\CourseCertificateService::generateHtml($cert),
        ]);
    }

    /** DELETE /v2/courses/{id}/enroll — drop a course. */
    public function drop(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        // Resolve the course inside this community first. A foreign or missing
        // id previously answered 200 with `dropped: false` (CrossCommunityAccessSweepTest).
        $courseExists = \App\Models\Course::query()
            ->whereKey($id)
            ->where('tenant_id', $this->getTenantId())
            ->exists();
        if (! $courseExists) {
            return $this->respondWithError('NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        $dropped = CourseEnrollmentService::drop($id, $userId);

        return $this->respondWithData(['dropped' => $dropped]);
    }

    /** POST /v2/courses/{id}/reviews — leave a review (must be enrolled). */
    public function review(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        // Only an active or completed enrollment may review — a dropped learner
        // must not be able to post/overwrite a review feeding the public rating.
        $enrollment = CourseEnrollmentService::find($id, $userId);
        if (!$enrollment || !in_array($enrollment->status, ['active', 'completed'], true)) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.review_requires_enrollment'), null, 403);
        }

        $rating = $this->inputInt('rating', 0, 1, 5);
        if (!$rating) {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.courses.rating_required'), 'rating', 422);
        }

        $review = CourseReview::updateOrCreate(
            ['course_id' => $id, 'user_id' => $userId],
            ['rating' => $rating, 'body' => (string) $this->input('body', ''), 'status' => 'approved']
        );

        $this->recomputeCourseRating($id);

        return $this->respondWithData($review, null, 201);
    }

    /** Recompute the cached rating aggregate on the course. */
    private function recomputeCourseRating(int $courseId): void
    {
        $agg = CourseReview::where('course_id', $courseId)
            ->where('status', 'approved')
            ->selectRaw('AVG(rating) as avg_rating, COUNT(*) as cnt')
            ->first();

        \App\Models\Course::where('id', $courseId)->update([
            'rating_avg' => round((float) ($agg->avg_rating ?? 0), 2),
            'rating_count' => (int) ($agg->cnt ?? 0),
        ]);
    }
}
