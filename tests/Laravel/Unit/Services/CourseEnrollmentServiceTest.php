<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\CourseEnrollmentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * CourseEnrollmentServiceTest
 *
 * Tests the enrollment lifecycle: enroll (fresh, idempotent, re-activate dropped),
 * drop, and isEnrolled / find helpers.
 *
 * Strategy: insert real rows via DB::table (exact schema columns from
 * mysql-schema.sql).  CourseNotificationService calls are naturally skipped
 * because the test DB has no notification config and the service guards
 * them with try/catch internally.  We call enroll(..., notify: false) to
 * avoid the outbound path entirely in the happy-path tests.
 */
class CourseEnrollmentServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function insertUser(): int
    {
        $uid = uniqid('enrtest_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Enr User ' . $uid,
            'first_name' => 'Enr',
            'last_name'  => 'User',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertCourse(int $authorId): int
    {
        $uid = uniqid('crs_', true);
        return DB::table('courses')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'author_user_id'    => $authorId,
            'title'             => 'Test Course ' . $uid,
            'slug'              => 'test-' . $uid,
            'status'            => 'published',
            'moderation_status' => 'approved',
            'level'             => 'beginner',
            'visibility'        => 'public',
            'enrollment_type'   => 'self_paced',
            'enrollment_count'  => 0,
            'completion_count'  => 0,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    // ── isEnrolled ───────────────────────────────────────────────────────────

    public function test_isEnrolled_returns_false_when_no_enrollment_exists(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $result = CourseEnrollmentService::isEnrolled($courseId, $userId);

        $this->assertFalse($result);
    }

    public function test_isEnrolled_returns_true_after_enrollment(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);

        $this->assertTrue(CourseEnrollmentService::isEnrolled($courseId, $userId));
    }

    public function test_isEnrolled_returns_false_for_dropped_enrollment(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        CourseEnrollmentService::drop($courseId, $userId);

        $this->assertFalse(CourseEnrollmentService::isEnrolled($courseId, $userId));
    }

    // ── enroll — fresh enrollment ─────────────────────────────────────────────

    public function test_enroll_creates_enrollment_row_with_active_status(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $enrollment = CourseEnrollmentService::enroll($courseId, $userId, null, false);

        $this->assertSame('active', $enrollment->status);
        $this->assertSame($courseId, (int) $enrollment->course_id);
        $this->assertSame($userId, (int) $enrollment->user_id);
        $this->assertNotNull($enrollment->enrolled_at);
    }

    public function test_enroll_increments_course_enrollment_count(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $before = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');
        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $after = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');

        $this->assertSame($before + 1, $after);
    }

    public function test_enroll_sets_progress_percent_to_zero(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $enrollment = CourseEnrollmentService::enroll($courseId, $userId, null, false);

        $this->assertEquals(0, (float) $enrollment->progress_percent);
    }

    // ── enroll — idempotent (already active) ──────────────────────────────────

    public function test_enroll_is_idempotent_when_already_active(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $first  = CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $second = CourseEnrollmentService::enroll($courseId, $userId, null, false);

        $this->assertSame($first->id, $second->id);

        $rowCount = DB::table('course_enrollments')
            ->where('course_id', $courseId)
            ->where('user_id', $userId)
            ->count();
        $this->assertSame(1, $rowCount);
    }

    public function test_enroll_does_not_double_increment_count_when_idempotent(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $before = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');
        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $after = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');

        $this->assertSame($before, $after);
    }

    // ── enroll — re-activate a dropped enrollment ─────────────────────────────

    public function test_enroll_reactivates_dropped_enrollment(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $enrollment = CourseEnrollmentService::enroll($courseId, $userId, null, false);
        CourseEnrollmentService::drop($courseId, $userId);

        $reactivated = CourseEnrollmentService::enroll($courseId, $userId, null, false);

        $this->assertSame($enrollment->id, $reactivated->id);
        $this->assertSame('active', $reactivated->status);
    }

    public function test_enroll_increments_count_when_reactivating_dropped(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        CourseEnrollmentService::drop($courseId, $userId);

        $before = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');
        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $after = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');

        $this->assertSame($before + 1, $after);
    }

    // ── enroll — invalid cohort is ignored ────────────────────────────────────

    public function test_enroll_ignores_cohort_that_does_not_belong_to_course(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        // 99999 is a non-existent cohort
        $enrollment = CourseEnrollmentService::enroll($courseId, $userId, 99999, false);

        $this->assertNull($enrollment->cohort_id);
    }

    // ── drop ──────────────────────────────────────────────────────────────────

    public function test_drop_sets_status_to_dropped(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $result = CourseEnrollmentService::drop($courseId, $userId);

        $this->assertTrue($result);

        $row = DB::table('course_enrollments')
            ->where('course_id', $courseId)
            ->where('user_id', $userId)
            ->first();
        $this->assertSame('dropped', $row->status);
    }

    public function test_drop_decrements_enrollment_count(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $before = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');
        CourseEnrollmentService::drop($courseId, $userId);
        $after = (int) DB::table('courses')->where('id', $courseId)->value('enrollment_count');

        $this->assertSame($before - 1, $after);
    }

    public function test_drop_returns_false_when_not_enrolled(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $result = CourseEnrollmentService::drop($courseId, $userId);

        $this->assertFalse($result);
    }

    // ── find ──────────────────────────────────────────────────────────────────

    public function test_learning_list_projects_unpassed_quizzes_without_changing_history(): void
    {
        $userId = $this->insertUser();
        $authorId = $this->insertUser();
        $enrollments = [];
        foreach (range(1, 3) as $index) {
            $courseId = $this->insertCourse($authorId);
            $enrollment = CourseEnrollmentService::enroll($courseId, $userId, null, false);
            $enrollment->update(['status' => 'completed', 'progress_percent' => 100, 'completed_at' => now()]);
            foreach (['text', 'quiz'] as $type) {
                $lesson = \App\Models\CourseLesson::create(['course_id' => $courseId, 'title' => $type, 'content_type' => $type]);
                \App\Models\CourseLessonProgress::create(['enrollment_id' => $enrollment->id, 'lesson_id' => $lesson->id, 'user_id' => $userId, 'status' => 'completed', 'completed_at' => now()]);
                if ($type === 'quiz') {
                    $quiz = \App\Models\CourseQuiz::create(['course_id' => $courseId, 'lesson_id' => $lesson->id, 'title' => 'Quiz']);
                    \App\Models\CourseQuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $index === 1 ? $authorId : $userId, 'answers' => [], 'score_percent' => 90, 'passed' => true, 'grading_status' => $index === 2 ? 'pending_review' : 'graded', 'submitted_at' => now()]);
                }
            }
            $enrollments[] = $enrollment;
        }

        DB::enableQueryLog();
        DB::flushQueryLog();
        try {
            $rows = array_column(CourseEnrollmentService::forUser($userId), null, 'id');
            $queries = count(DB::getQueryLog());
        } finally {
            DB::disableQueryLog();
        }
        foreach ($enrollments as $index => $enrollment) {
            $row = $rows[$enrollment->id];
            $this->assertSame($index === 2 ? 'completed' : 'active', $row['status']);
            $this->assertEquals($index === 2 ? 100 : 50, $row['progress_percent']);
            if ($index !== 2) $this->assertNull($row['completed_at']);
            $this->assertNotEmpty($row['course']['title']);
            $this->assertSame('completed', $enrollment->fresh()->status);
            $this->assertEquals(100, $enrollment->fresh()->progress_percent);
        }
        $this->assertLessThanOrEqual(6, $queries, 'Learning list eligibility must use batched queries');
    }

    public function test_find_returns_null_when_not_enrolled(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        $result = CourseEnrollmentService::find($courseId, $userId);

        $this->assertNull($result);
    }

    public function test_find_returns_enrollment_when_active(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);

        CourseEnrollmentService::enroll($courseId, $userId, null, false);
        $result = CourseEnrollmentService::find($courseId, $userId);

        $this->assertNotNull($result);
        $this->assertSame($courseId, (int) $result->course_id);
        $this->assertSame($userId, (int) $result->user_id);
    }
}
