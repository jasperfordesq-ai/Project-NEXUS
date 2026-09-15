<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Models\Course;
use App\Models\CourseReview;
use App\Services\CourseCategoryService;
use App\Services\CourseCreationReceiptService;
use App\Services\CourseEnrollmentService;
use App\Services\CourseService;
use Illuminate\Http\JsonResponse;

/**
 * CourseController — Courses module (alpha) course endpoints.
 *
 * Public: browse, show, categories, reviews.
 * Instructor/admin: create, update, publish/unpublish, delete, authored list.
 *
 * Self-contained module; gated by the per-tenant `courses` feature flag.
 */
class CourseController extends BaseApiController
{
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    // =====================================================================
    //  Public browse / discovery
    // =====================================================================

    /** GET /v2/courses — browse published courses. */
    public function index(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->rateLimit('courses_browse', 60, 60);

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();

        $filters = [
            'page' => $this->queryInt('page', 1, 1),
            'per_page' => $this->queryInt('per_page', 12, 1, 50),
            // Logged-in members may see members-only courses in the catalogue.
            'include_member_only' => $userId !== null,
        ];
        if ($this->query('q')) {
            $filters['search'] = $this->query('q');
        }
        if ($this->query('category_id')) {
            $filters['category_id'] = $this->queryInt('category_id');
        }
        if ($this->query('level')) {
            $filters['level'] = $this->query('level');
        }

        $result = CourseService::browse($filters);

        return $this->respondWithPaginatedCollection(
            $result['items'],
            $result['total'],
            $result['page'],
            $result['per_page'],
        );
    }

    /** GET /v2/courses/categories — list course categories. */
    public function categories(): JsonResponse
    {
        $this->ensureCoursesFeature();

        return $this->respondWithData(CourseCategoryService::all());
    }

    /** GET /v2/courses/{idOrSlug} — course detail (syllabus). */
    public function show(string $idOrSlug): JsonResponse
    {
        $this->ensureCoursesFeature();

        $course = ctype_digit($idOrSlug)
            ? CourseService::findById((int) $idOrSlug)
            : CourseService::findBySlug($idOrSlug);

        if (!$course) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $this->ensureCourseViewable($course, $userId);

        $data = $course->toArray();
        $data['is_enrolled'] = $userId !== null && CourseEnrollmentService::isEnrolled($course->id, $userId);

        return $this->respondWithData($data);
    }

    /** GET /v2/courses/{id}/reviews — approved reviews for a course. */
    public function reviews(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();

        $course = $this->findCourseOrFail($id);
        $userId = $this->getOptionalUserId() ?? $this->resolveSanctumUserOptionally();
        $this->ensureCourseViewable($course, $userId);

        $reviews = CourseReview::where('course_id', $id)
            ->where('status', 'approved')
            ->with('user:id,name,avatar_url')
            ->orderByDesc('created_at')
            ->limit(100)
            ->get()
            ->toArray();

        return $this->respondWithData($reviews);
    }

    // =====================================================================
    //  Authoring (instructor or admin)
    // =====================================================================

    /** GET /v2/courses/mine — courses authored by the caller. */
    public function authored(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        return $this->respondWithData(CourseService::authoredBy($userId));
    }

    /** POST /v2/courses — create a draft course. */
    public function store(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        $title = trim((string) $this->input('title', ''));
        if ($title === '') {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.courses.title_required'), 'title', 422);
        }

        $input = $this->getAllInput();
        $headerKey = request()->header('Idempotency-Key');
        $bodyKey = $input['idempotency_key'] ?? null;
        if ($headerKey !== null && $bodyKey !== null && ! hash_equals(trim((string) $headerKey), trim((string) $bodyKey))) {
            return $this->respondWithError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422);
        }
        $identity = CourseCreationReceiptService::identity((string) ($headerKey ?? $bodyKey ?? ''), $input);
        if ($identity === false) {
            return $this->respondWithError('IDEMPOTENCY_INVALID', __('event_registration.idempotency_invalid'), 'idempotency_key', 422);
        }

        try {
            $result = $identity === null
                ? ['course' => CourseService::create($userId, $input), 'replayed' => false]
                : CourseCreationReceiptService::create($userId, $input, $identity);
        } catch (\InvalidArgumentException) {
            return $this->respondWithError('IDEMPOTENCY_CONFLICT', __('event_registration.idempotency_conflict'), 'idempotency_key', 409);
        } catch (\DomainException) {
            return $this->respondWithError('IDEMPOTENCY_RESULT_GONE', __('api.invalid_input'), 'idempotency_key', 409);
        }

        return $this->respondWithData($result['course'], null, $result['replayed'] ? 200 : 201);
    }

    /** PUT /v2/courses/{id} — update a course. */
    public function update(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        $course = CourseService::update($course, $this->getAllInput());

        return $this->respondWithData($course);
    }

    /** GET /v2/courses/{id}/analytics — per-course analytics (owner or admin). */
    public function analytics(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireCourseAuthor();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        $enrollments = \App\Models\CourseEnrollment::where('course_id', $id);
        $total = (clone $enrollments)->count();
        $completed = (clone $enrollments)->where('status', 'completed')->count();
        $active = (clone $enrollments)->where('status', 'active')->count();
        $dropped = (clone $enrollments)->where('status', 'dropped')->count();
        $avgProgress = (float) (clone $enrollments)->avg('progress_percent');

        // Per-lesson completion (drop-off curve).
        $lessons = \App\Models\CourseLesson::where('course_id', $id)
            ->orderBy('position')
            ->get(['id', 'title']);
        $perLesson = $lessons->map(function ($lesson) {
            return [
                'lesson_id' => $lesson->id,
                'title' => $lesson->title,
                'completed' => \App\Models\CourseLessonProgress::where('lesson_id', $lesson->id)
                    ->where('status', 'completed')
                    ->count(),
            ];
        })->all();

        // Average quiz score across the course's quizzes.
        $quizIds = \App\Models\CourseQuiz::where('course_id', $id)->pluck('id')->all();
        $avgQuizScore = $quizIds
            ? (float) \App\Models\CourseQuizAttempt::whereIn('quiz_id', $quizIds)->avg('score_percent')
            : 0.0;
        $quizAttempts = $quizIds
            ? \App\Models\CourseQuizAttempt::whereIn('quiz_id', $quizIds)->count()
            : 0;

        return $this->respondWithData([
            'course' => ['id' => $course->id, 'title' => $course->title],
            'enrollments' => [
                'total' => $total,
                'active' => $active,
                'completed' => $completed,
                'dropped' => $dropped,
            ],
            'completion_rate' => $total > 0 ? round(($completed / $total) * 100, 1) : 0.0,
            'avg_progress' => round($avgProgress, 1),
            'avg_quiz_score' => round($avgQuizScore, 1),
            'quiz_attempts' => $quizAttempts,
            'per_lesson' => $perLesson,
        ]);
    }

    /** POST /v2/courses/{id}/publish — publish a course. */
    public function publish(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        $course = CourseService::publish($course, true);

        return $this->respondWithData($course);
    }

    /** POST /v2/courses/{id}/unpublish — revert a course to draft. */
    public function unpublish(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        $course = CourseService::unpublish($course);

        return $this->respondWithData($course);
    }

    /** DELETE /v2/courses/{id} — delete a course. */
    public function destroy(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();

        $course = $this->findCourseOrFail($id);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        CourseService::delete($course);

        return $this->respondWithData(['deleted' => true]);
    }
}
