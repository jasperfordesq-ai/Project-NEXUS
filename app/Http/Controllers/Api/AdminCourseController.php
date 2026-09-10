<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Models\Course;
use App\Models\CourseEnrollment;
use App\Services\CourseCategoryService;
use App\Services\CourseInstructorService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;

/**
 * AdminCourseController — admin moderation, instructor grants, category
 * management, and tenant analytics for the Courses module. Admin-gated.
 */
class AdminCourseController extends BaseApiController
{
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    // ----- Moderation -----

    /** GET /v2/admin/courses — list courses (optionally filter by status). */
    public function index(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        $query = Course::with(['author:id,name', 'category:id,name'])->orderByDesc('created_at');

        if ($status = $this->query('moderation_status')) {
            $query->where('moderation_status', $status);
        }

        return $this->respondWithData($query->limit(200)->get()->toArray());
    }

    /** POST /v2/admin/courses/{id}/moderate — approve/reject/flag. */
    public function moderate(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $adminId = $this->requireAdmin();

        $course = $this->findCourseOrFail($id);

        $action = (string) $this->input('action', '');
        $map = ['approve' => 'approved', 'reject' => 'rejected', 'flag' => 'flagged'];
        if (!isset($map[$action])) {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.courses.invalid_moderation_action'), 'action', 422);
        }

        $course->moderation_status = $map[$action];
        $course->moderation_notes = $this->input('notes');
        $course->moderated_by = $adminId;
        $course->moderated_at = Carbon::now();
        if ($action === 'approve' && $course->status === 'published' && !$course->published_at) {
            $course->published_at = Carbon::now();
        }
        if ($action === 'reject') {
            $course->status = 'draft';
        }
        $course->save();

        return $this->respondWithData($course);
    }

    // ----- Instructor grants -----

    /** GET /v2/admin/courses/instructors */
    public function listInstructors(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        return $this->respondWithData(CourseInstructorService::list());
    }

    /** POST /v2/admin/courses/instructors */
    public function grantInstructor(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $adminId = $this->requireAdmin();

        $userId = $this->inputInt('user_id', 0, 1);
        if (!$userId) {
            return $this->respondWithError('VALIDATION_FAILED', __('api_controllers_2.courses.user_id_required'), 'user_id', 422);
        }

        $grant = CourseInstructorService::grant($userId, $adminId);

        return $this->respondWithData($grant, null, 201);
    }

    /** DELETE /v2/admin/courses/instructors/{userId} */
    public function revokeInstructor(int $userId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        // The user must belong to THIS community. A foreign or missing id
        // previously answered `revoked: true` (CrossCommunityAccessSweepTest).
        $userExists = \App\Models\User::query()
            ->whereKey($userId)
            ->where('tenant_id', $this->getTenantId())
            ->exists();
        if (! $userExists) {
            return $this->respondWithError('NOT_FOUND', __('api.user_not_found'), null, 404);
        }

        CourseInstructorService::revoke($userId);

        return $this->respondWithData(['revoked' => true]);
    }

    // ----- Categories -----

    /** POST /v2/admin/courses/categories */
    public function storeCategory(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        $category = CourseCategoryService::create($this->getAllInput());

        return $this->respondWithData($category, null, 201);
    }

    /** PUT /v2/admin/courses/categories/{id} */
    public function updateCategory(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        $category = CourseCategoryService::update($id, $this->getAllInput());
        if (!$category) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        return $this->respondWithData($category);
    }

    /** DELETE /v2/admin/courses/categories/{id} */
    public function deleteCategory(int $id): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        CourseCategoryService::delete($id);

        return $this->respondWithData(['deleted' => true]);
    }

    // ----- Analytics -----

    /** GET /v2/admin/courses/analytics — tenant-level summary. */
    public function analytics(): JsonResponse
    {
        $this->ensureCoursesFeature();
        $this->requireAdmin();

        return $this->respondWithData([
            'total_courses' => Course::count(),
            'published_courses' => Course::where('status', 'published')->count(),
            'pending_moderation' => Course::where('moderation_status', 'pending')->count(),
            'total_enrollments' => CourseEnrollment::count(),
            'completed_enrollments' => CourseEnrollment::where('status', 'completed')->count(),
            'instructors' => \App\Models\CourseInstructor::count(),
        ]);
    }
}
