<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseCohort;
use App\Models\CourseEnrollment;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * CourseEnrollmentService — tenant-scoped enrollment lifecycle.
 * Phase 1 supports free + members-only enrollment. Credit-based enrollment and
 * teach/learn-to-earn rewards are layered in via CourseCreditService in Phase 3.
 */
class CourseEnrollmentService
{
    public static function isEnrolled(int $courseId, int $userId): bool
    {
        $tenantId = self::tenantIdForCourse($courseId);
        if ($tenantId !== null && TenantContext::currentId() !== $tenantId) {
            return TenantContext::runForTenant($tenantId, fn () => self::isEnrolled($courseId, $userId));
        }

        return CourseEnrollment::where('course_id', $courseId)
            ->where('user_id', $userId)
            ->whereIn('status', ['active', 'completed'])
            ->exists();
    }

    public static function find(int $courseId, int $userId): ?CourseEnrollment
    {
        $tenantId = self::tenantIdForCourse($courseId);
        if ($tenantId !== null && TenantContext::currentId() !== $tenantId) {
            return TenantContext::runForTenant($tenantId, fn () => self::find($courseId, $userId));
        }

        return CourseEnrollment::where('course_id', $courseId)
            ->where('user_id', $userId)
            ->whereIn('status', ['active', 'completed'])
            ->first();
    }

    /**
     * Enroll a user. Idempotent — returns the existing enrollment if present.
     */
    public static function enroll(int $courseId, int $userId, ?int $cohortId = null, bool $notify = true): CourseEnrollment
    {
        $tenantId = self::tenantIdForCourse($courseId);
        if ($tenantId !== null && TenantContext::currentId() !== $tenantId) {
            return TenantContext::runForTenant($tenantId, fn () => self::enroll($courseId, $userId, $cohortId, $notify));
        }

        $existing = self::findAny($courseId, $userId);
        if ($existing && in_array($existing->status, ['active', 'completed'], true)) {
            return $existing;
        }

        // Ignore a cohort that doesn't belong to this course (tenant-scoped check) —
        // prevents roster/analytics pollution from an arbitrary or cross-course cohort id.
        if ($cohortId !== null
            && !CourseCohort::where('id', $cohortId)->where('course_id', $courseId)->exists()) {
            $cohortId = null;
        }

        if ($existing && $existing->status === 'dropped') {
            $existing->cohort_id = $cohortId;
            $existing->status = 'active';
            $existing->enrolled_at = Carbon::now();
            $existing->completed_at = null;
            $existing->last_accessed_at = Carbon::now();
            $existing->save();

            Course::where('id', $courseId)->increment('enrollment_count');
            if ($notify) {
                CourseNotificationService::enrolled($courseId, $userId);
            }

            return $existing;
        }

        $enrollment = new CourseEnrollment([
            'course_id' => $courseId,
            'user_id' => $userId,
            'cohort_id' => $cohortId,
            'status' => 'active',
            'progress_percent' => 0,
            'enrolled_at' => Carbon::now(),
        ]);
        $enrollment->tenant_id = (int) TenantContext::getId();
        $enrollment->save();

        Course::where('id', $courseId)->increment('enrollment_count');

        if ($notify) {
            CourseNotificationService::enrolled($courseId, $userId);
        }

        return $enrollment;
    }

    /**
     * Enroll a user and charge any configured course credit cost exactly once.
     */
    public static function enrollWithPayment(Course $course, int $userId, ?int $cohortId = null, ?float $expectedCreditCost = null): CourseEnrollment
    {
        $tenantId = (int) ($course->tenant_id ?: TenantContext::getId());
        if ($tenantId > 0 && TenantContext::currentId() !== $tenantId) {
            return TenantContext::runForTenant($tenantId, fn () => self::enrollWithPayment($course, $userId, $cohortId, $expectedCreditCost));
        }

        $existing = self::findAny((int) $course->id, $userId);
        if ($existing && in_array($existing->status, ['active', 'completed'], true)) {
            return $existing;
        }

        // A dropped learner has already paid once. Reactivate without charging
        // again, preserving the module's "charge exactly once" contract.
        if ($existing && $existing->status === 'dropped') {
            return self::enroll((int) $course->id, $userId, $cohortId);
        }

        // Run the charge + enrollment atomically under a row lock, but defer the
        // enrollment notification (push/HTTP I/O) until AFTER commit so we never hold
        // the locked course/wallet rows open across network calls.
        [$enrollment, $shouldNotify] = DB::transaction(function () use ($course, $userId, $cohortId, $expectedCreditCost) {
            // Re-read the course under the lock so credit_cost / author_user_id are the
            // freshest values, not the (possibly stale) instance passed into the method.
            $locked = Course::whereKey($course->id)->lockForUpdate()->first() ?? $course;

            $existing = self::findAny((int) $course->id, $userId);
            if ($existing && in_array($existing->status, ['active', 'completed'], true)) {
                return [$existing, false];
            }
            if ($existing && $existing->status === 'dropped') {
                return [self::enroll((int) $course->id, $userId, $cohortId, false), true];
            }

            // Compare the displayed quote to the locked price before any wallet mutation.
            // Existing enrolments above remain safe to replay without another charge.
            if ($expectedCreditCost !== null
                && (!is_finite($expectedCreditCost) || $expectedCreditCost < 0
                    || round($expectedCreditCost * 100) !== round((float) $locked->credit_cost * 100))) {
                throw new \DomainException('course_price_changed');
            }

            $payment = CourseCreditService::chargeEnrollment($locked, $userId);
            $cost = (float) $locked->credit_cost;

            if ($cost > 0 && (int) $locked->author_user_id !== $userId && empty($payment['charged'])) {
                throw new \RuntimeException((string) ($payment['reason'] ?? 'insufficient_credits'));
            }

            $enrollment = self::enroll((int) $course->id, $userId, $cohortId, false);
            $enrollment->credits_paid = (float) ($payment['amount'] ?? 0);
            $enrollment->save();

            return [$enrollment, true];
        });

        if ($shouldNotify) {
            CourseNotificationService::enrolled((int) $course->id, $userId);
        }

        return $enrollment;
    }

    /**
     * Courses the user is enrolled in, with the course attached.
     *
     * @return array<int,array<string,mixed>>
     */
    public static function forUser(int $userId): array
    {
        $rows = CourseEnrollment::where('user_id', $userId)
            ->whereIn('status', ['active', 'completed'])
            ->with(['course:id,title,slug,cover_image,level,author_user_id'])
            ->orderByDesc('last_accessed_at')
            ->orderByDesc('enrolled_at')
            ->get()
            ->toArray();

        $unmet = CourseProgressService::unmetQuizLessonsByCourse(array_column($rows, 'course_id'), $userId);
        if ($unmet === []) return $rows;

        $lessons = \App\Models\CourseLesson::whereIn('course_id', array_keys($unmet))->get(['id', 'course_id']);
        $totals = $lessons->countBy('course_id');
        $blockedIds = array_merge(...array_values($unmet));
        $completed = \App\Models\CourseLessonProgress::whereIn('enrollment_id', array_column($rows, 'id'))
            ->where('user_id', $userId)->where('status', 'completed')
            ->whereIn('lesson_id', $lessons->pluck('id'))->whereNotIn('lesson_id', $blockedIds)
            ->selectRaw('enrollment_id, COUNT(*) AS total')->groupBy('enrollment_id')->pluck('total', 'enrollment_id');

        foreach ($rows as &$row) {
            if (!isset($unmet[$row['course_id']])) continue;
            $total = (int) ($totals[$row['course_id']] ?? 0);
            $row['progress_percent'] = $total > 0 ? round((int) ($completed[$row['id']] ?? 0) / $total * 100, 2) : 0;
            if ($row['status'] === 'completed') {
                $row['status'] = 'active';
                $row['completed_at'] = null;
            }
        }
        unset($row);
        return $rows;
    }

    /**
     * Enrollment roster for a course (instructor view).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function roster(int $courseId): array
    {
        return CourseEnrollment::where('course_id', $courseId)
            ->with(['user:id,name,avatar_url'])
            ->orderByDesc('enrolled_at')
            ->get()
            ->toArray();
    }

    public static function drop(int $courseId, int $userId): bool
    {
        $tenantId = self::tenantIdForCourse($courseId);
        if ($tenantId !== null && TenantContext::currentId() !== $tenantId) {
            return TenantContext::runForTenant($tenantId, fn () => self::drop($courseId, $userId));
        }

        $enrollment = self::findAny($courseId, $userId);
        if (!$enrollment || $enrollment->status !== 'active') {
            return false;
        }

        $enrollment->status = 'dropped';
        $enrollment->save();
        Course::where('id', $courseId)
            ->where('enrollment_count', '>', 0)
            ->decrement('enrollment_count');

        return true;
    }

    private static function findAny(int $courseId, int $userId): ?CourseEnrollment
    {
        return CourseEnrollment::where('course_id', $courseId)
            ->where('user_id', $userId)
            ->first();
    }

    private static function tenantIdForCourse(int $courseId): ?int
    {
        $tenantId = Course::withoutGlobalScopes()
            ->whereKey($courseId)
            ->value('tenant_id');

        return $tenantId !== null ? (int) $tenantId : null;
    }
}
