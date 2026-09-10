<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Services\CourseCohortService;
use Illuminate\Http\JsonResponse;

/**
 * CourseCohortController — cohorts for cohort-paced courses. Listing is open to
 * authenticated members; create/delete is course-owner-or-admin.
 */
class CourseCohortController extends BaseApiController
{
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    /** GET /v2/courses/{courseId}/cohorts */
    public function index(int $courseId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();
        $course = $this->findCourseOrFail($courseId);
        $this->ensureCourseViewable($course, $userId);

        return $this->respondWithData(CourseCohortService::forCourse($courseId));
    }

    /** POST /v2/courses/{courseId}/cohorts */
    public function store(int $courseId): JsonResponse
    {
        $userId = $this->guardCourse($courseId);

        $name = trim((string) $this->input('name', ''));
        if ($name === '') {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.courses.cohort_name_required'), 'name', 422);
        }

        $cohort = CourseCohortService::create($courseId, $this->getAllInput());

        return $this->respondWithData($cohort, null, 201);
    }

    /** DELETE /v2/courses/{courseId}/cohorts/{cohortId} */
    public function destroy(int $courseId, int $cohortId): JsonResponse
    {
        $this->guardCourse($courseId);

        // The service already scopes the cohort to this course and returns
        // false when there is nothing of ours to delete — but its answer was
        // discarded, so a cohort belonging to another community was reported as
        // deleted. Nothing crossed; the response was simply untrue.
        // (CrossCommunityAccessSweepTest foreign-child sweep, 2026-09-10.)
        if (! CourseCohortService::delete($courseId, $cohortId)) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Cohort']), null, 404);
        }

        return $this->respondWithData(['deleted' => true]);
    }

    /** Feature gate + instructor/admin + course ownership; returns user id. */
    private function guardCourse(int $courseId): int
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireCourseAuthor();
        $course = $this->findCourseOrFail($courseId);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        return $userId;
    }
}
