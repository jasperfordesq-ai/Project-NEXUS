<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Http\Controllers\Api\Concerns\InteractsWithCourseAuthoringCreationReceipts;
use App\Models\CourseLesson;
use App\Models\CourseSection;
use App\Services\CourseLessonService;
use App\Services\CourseSectionService;
use Illuminate\Http\JsonResponse;

/**
 * CourseContentController — instructor course-builder endpoints for sections
 * and lessons. All endpoints require instructor/admin + course ownership.
 */
class CourseContentController extends BaseApiController
{
    use InteractsWithCourseAuthoringCreationReceipts;
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    // ----- Sections -----

    /** POST /v2/courses/{courseId}/sections */
    public function storeSection(int $courseId): JsonResponse
    {
        $userId = $this->guardCourse($courseId);

        $input = $this->getAllInput();
        $result = $this->createCourseAuthoringResource(
            $userId,
            $courseId,
            'section',
            $input,
            fn () => CourseSectionService::create($courseId, $input),
        );

        return $this->respondWithData($result['resource'], null, $result['replayed'] ? 200 : 201);
    }

    /** PUT /v2/courses/{courseId}/sections/{sectionId} */
    public function updateSection(int $courseId, int $sectionId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureSectionInCourse($sectionId, $courseId);

        $section = CourseSectionService::update($sectionId, $this->getAllInput());

        return $this->respondWithData($section);
    }

    /** DELETE /v2/courses/{courseId}/sections/{sectionId} */
    public function deleteSection(int $courseId, int $sectionId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureSectionInCourse($sectionId, $courseId);

        CourseSectionService::delete($sectionId);

        return $this->respondWithData(['deleted' => true]);
    }

    // ----- Lessons -----

    /** POST /v2/courses/{courseId}/lessons */
    public function storeLesson(int $courseId): JsonResponse
    {
        $userId = $this->guardCourse($courseId);

        $input = $this->getAllInput();
        $result = $this->createCourseAuthoringResource(
            $userId,
            $courseId,
            'lesson',
            $input,
            fn () => CourseLessonService::create($courseId, $input),
        );

        return $this->respondWithData($result['resource'], null, $result['replayed'] ? 200 : 201);
    }

    /** PUT /v2/courses/{courseId}/lessons/{lessonId} */
    public function updateLesson(int $courseId, int $lessonId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureLessonInCourse($lessonId, $courseId);

        $lesson = CourseLessonService::update($lessonId, $this->getAllInput());

        return $this->respondWithData($lesson);
    }

    /** DELETE /v2/courses/{courseId}/lessons/{lessonId} */
    public function deleteLesson(int $courseId, int $lessonId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureLessonInCourse($lessonId, $courseId);

        CourseLessonService::delete($lessonId);

        return $this->respondWithData(['deleted' => true]);
    }

    // ----- Guards -----

    /** Feature gate + instructor/admin + course ownership; returns user id. */
    private function guardCourse(int $courseId): int
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();
        $course = $this->findCourseOrFail($courseId);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        return $userId;
    }

    private function ensureSectionInCourse(int $sectionId, int $courseId): void
    {
        $exists = CourseSection::where('id', $sectionId)->where('course_id', $courseId)->exists();
        if (!$exists) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404)
            );
        }
    }

    private function ensureLessonInCourse(int $lessonId, int $courseId): void
    {
        $exists = CourseLesson::where('id', $lessonId)->where('course_id', $courseId)->exists();
        if (!$exists) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404)
            );
        }
    }
}
