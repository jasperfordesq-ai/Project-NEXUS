<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\CourseEnrollment;
use App\Services\CourseProgressService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * CourseProgressServiceTest
 *
 * Tests progress recomputation (percent, completion detection, counter bumps)
 * and lesson completion recording.
 *
 * Strategy: insert real rows for courses, lessons, enrollments, and
 * lesson-progress via DB::table (exact schema columns). CourseProgressService
 * calls CourseCertificateService and CourseNotificationService on completion;
 * both are wrapped in try/catch so failures don't propagate — the tests
 * never need to mock them.
 *
 * Skipped: GamificationService side-effects (guarded by class_exists and
 * wrapped in try/catch — not testable without a seeded gamification config).
 */
class CourseProgressServiceTest extends TestCase
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
        $uid = uniqid('progtest_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Prog User ' . $uid,
            'first_name' => 'Prog',
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
            'title'             => 'Prog Course ' . $uid,
            'slug'              => 'prog-' . $uid,
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

    private function insertLesson(int $courseId, int $position = 0): int
    {
        $uid = uniqid('les_', true);
        return DB::table('course_lessons')->insertGetId([
            'tenant_id'    => self::TENANT_ID,
            'course_id'    => $courseId,
            'title'        => 'Lesson ' . $uid,
            'content_type' => 'text',
            'position'     => $position,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);
    }

    /**
     * Insert a bare enrollment row and return the Eloquent model.
     */
    private function insertEnrollment(int $courseId, int $userId): CourseEnrollment
    {
        $id = DB::table('course_enrollments')->insertGetId([
            'tenant_id'       => self::TENANT_ID,
            'course_id'       => $courseId,
            'user_id'         => $userId,
            'status'          => 'active',
            'progress_percent'=> 0,
            'credits_paid'    => 0,
            'credits_earned'  => 0,
            'enrolled_at'     => now(),
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        return CourseEnrollment::find($id);
    }

    // ── recompute — no lessons ────────────────────────────────────────────────

    public function test_recompute_returns_zero_percent_when_course_has_no_lessons(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $result = CourseProgressService::recompute($enrollment, $userId);

        $this->assertEquals(0.0, $result['progress_percent']);
        $this->assertFalse($result['course_completed']);
    }

    // ── recompute — partial completion ────────────────────────────────────────

    public function test_recompute_returns_correct_percent_when_half_lessons_done(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $l1 = $this->insertLesson($courseId, 0);
        $l2 = $this->insertLesson($courseId, 1);

        // Complete only lesson 1
        DB::table('course_lesson_progress')->insertOrIgnore([
            'tenant_id'     => self::TENANT_ID,
            'enrollment_id' => $enrollment->id,
            'lesson_id'     => $l1,
            'user_id'       => $userId,
            'status'        => 'completed',
            'watch_percent' => 100,
            'completed_at'  => now(),
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        $result = CourseProgressService::recompute($enrollment, $userId);

        $this->assertEqualsWithDelta(50.0, $result['progress_percent'], 0.01);
        $this->assertFalse($result['course_completed']);
    }

    public function test_recompute_updates_progress_percent_on_enrollment_row(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $l1 = $this->insertLesson($courseId, 0);
        $this->insertLesson($courseId, 1);

        DB::table('course_lesson_progress')->insertOrIgnore([
            'tenant_id'     => self::TENANT_ID,
            'enrollment_id' => $enrollment->id,
            'lesson_id'     => $l1,
            'user_id'       => $userId,
            'status'        => 'completed',
            'watch_percent' => 100,
            'completed_at'  => now(),
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        CourseProgressService::recompute($enrollment, $userId);

        $row = DB::table('course_enrollments')->where('id', $enrollment->id)->first();
        $this->assertEqualsWithDelta(50.0, (float) $row->progress_percent, 0.01);
    }

    // ── recompute — full completion ───────────────────────────────────────────

    public function test_recompute_marks_enrollment_completed_when_all_lessons_done(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $l1 = $this->insertLesson($courseId, 0);
        $l2 = $this->insertLesson($courseId, 1);

        foreach ([$l1, $l2] as $lessonId) {
            DB::table('course_lesson_progress')->insertOrIgnore([
                'tenant_id'     => self::TENANT_ID,
                'enrollment_id' => $enrollment->id,
                'lesson_id'     => $lessonId,
                'user_id'       => $userId,
                'status'        => 'completed',
                'watch_percent' => 100,
                'completed_at'  => now(),
                'created_at'    => now(),
                'updated_at'    => now(),
            ]);
        }

        $result = CourseProgressService::recompute($enrollment, $userId);

        $this->assertSame(100.0, $result['progress_percent']);
        $this->assertTrue($result['course_completed']);

        $row = DB::table('course_enrollments')->where('id', $enrollment->id)->first();
        $this->assertSame('completed', $row->status);
        $this->assertNotNull($row->completed_at);
    }

    public function test_recompute_increments_course_completion_count(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $lessonId = $this->insertLesson($courseId, 0);
        DB::table('course_lesson_progress')->insertOrIgnore([
            'tenant_id'     => self::TENANT_ID,
            'enrollment_id' => $enrollment->id,
            'lesson_id'     => $lessonId,
            'user_id'       => $userId,
            'status'        => 'completed',
            'watch_percent' => 100,
            'completed_at'  => now(),
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        $before = (int) DB::table('courses')->where('id', $courseId)->value('completion_count');
        CourseProgressService::recompute($enrollment, $userId);
        $after = (int) DB::table('courses')->where('id', $courseId)->value('completion_count');

        $this->assertSame($before + 1, $after);
    }

    public function test_recompute_does_not_re_complete_already_completed_enrollment(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);

        $lessonId = $this->insertLesson($courseId, 0);
        DB::table('course_lesson_progress')->insertOrIgnore([
            'tenant_id'     => self::TENANT_ID,
            'enrollment_id' => $enrollment->id,
            'lesson_id'     => $lessonId,
            'user_id'       => $userId,
            'status'        => 'completed',
            'watch_percent' => 100,
            'completed_at'  => now(),
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        // First recompute triggers completion
        CourseProgressService::recompute($enrollment, $userId);
        $enrollment->refresh();

        $countAfterFirst = (int) DB::table('courses')->where('id', $courseId)->value('completion_count');

        // Second recompute must NOT fire again
        $result = CourseProgressService::recompute($enrollment, $userId);
        $this->assertFalse($result['course_completed']);

        $countAfterSecond = (int) DB::table('courses')->where('id', $courseId)->value('completion_count');
        $this->assertSame($countAfterFirst, $countAfterSecond);
    }

    // ── completeLesson ────────────────────────────────────────────────────────

    public function test_quiz_completion_requires_a_fully_graded_pass_for_this_learner(): void
    {
        $userId = $this->insertUser();
        $otherId = $this->insertUser();
        $courseId = $this->insertCourse($otherId);
        $lessonId = $this->insertLesson($courseId);
        $this->insertLesson($courseId, 1); // Avoid completion integrations in this fixture.
        DB::table('course_lessons')->where('id', $lessonId)->update(['content_type' => 'quiz']);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $quiz = \App\Models\CourseQuiz::create(['course_id' => $courseId, 'lesson_id' => $lessonId, 'title' => 'Assessment']);

        foreach ([null, [$otherId, true, 'auto'], [$userId, false, 'auto'], [$userId, true, 'pending_review']] as $attempt) {
            if ($attempt !== null) {
                \App\Models\CourseQuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $attempt[0], 'answers' => [], 'score_percent' => 100, 'passed' => $attempt[1], 'grading_status' => $attempt[2], 'submitted_at' => now()]);
            }
            try {
                CourseProgressService::completeLesson($enrollment, $lessonId, $userId);
                $this->fail('An unpassed assessment was completed');
            } catch (\Illuminate\Validation\ValidationException $error) {
                $this->assertArrayHasKey('lesson', $error->errors());
            }
            $this->assertSame(0, DB::table('course_lesson_progress')->where('enrollment_id', $enrollment->id)->count());
        }

        \App\Models\CourseQuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $userId, 'answers' => [], 'score_percent' => 80, 'passed' => true, 'grading_status' => 'graded', 'submitted_at' => now()]);
        $result = CourseProgressService::completeLesson($enrollment, $lessonId, $userId);
        $this->assertSame(50.0, $result['progress_percent']);
        $this->assertFalse($result['course_completed']);
    }

    public function test_legacy_completed_quiz_without_a_pass_does_not_count_or_issue_a_certificate(): void
    {
        $userId = $this->insertUser();
        $courseId = $this->insertCourse($this->insertUser());
        $lessonId = $this->insertLesson($courseId);
        DB::table('course_lessons')->where('id', $lessonId)->update(['content_type' => 'quiz']);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        DB::table('course_lesson_progress')->insert(['tenant_id' => self::TENANT_ID, 'enrollment_id' => $enrollment->id, 'lesson_id' => $lessonId, 'user_id' => $userId, 'status' => 'completed', 'watch_percent' => 100, 'created_at' => now(), 'updated_at' => now()]);
        $result = CourseProgressService::recompute($enrollment, $userId);
        $this->assertSame(0.0, $result['progress_percent']);
        $this->assertFalse($result['course_completed']);
        $this->assertSame(0, DB::table('course_completion_delivery_outbox')->where('enrollment_id', $enrollment->id)->count());
        $this->expectException(\Illuminate\Validation\ValidationException::class);
        \App\Services\CourseCertificateService::issue($courseId, $userId);
    }

    public function test_completeLesson_creates_progress_row(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $lessonId = $this->insertLesson($courseId, 0);

        CourseProgressService::completeLesson($enrollment, $lessonId, $userId, 100);

        $row = DB::table('course_lesson_progress')
            ->where('enrollment_id', $enrollment->id)
            ->where('lesson_id', $lessonId)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('completed', $row->status);
        $this->assertSame(100, (int) $row->watch_percent);
        $this->assertNotNull($row->completed_at);
    }

    public function test_completeLesson_caps_watch_percent_at_100(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $lessonId = $this->insertLesson($courseId, 0);

        CourseProgressService::completeLesson($enrollment, $lessonId, $userId, 150);

        $row = DB::table('course_lesson_progress')
            ->where('enrollment_id', $enrollment->id)
            ->where('lesson_id', $lessonId)
            ->first();

        $this->assertSame(100, (int) $row->watch_percent);
    }

    public function test_completeLesson_clamps_watch_percent_at_zero_for_negative_input(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $lessonId = $this->insertLesson($courseId, 0);

        CourseProgressService::completeLesson($enrollment, $lessonId, $userId, -10);

        $row = DB::table('course_lesson_progress')
            ->where('enrollment_id', $enrollment->id)
            ->where('lesson_id', $lessonId)
            ->first();

        $this->assertSame(0, (int) $row->watch_percent);
    }

    public function test_completeLesson_is_idempotent_on_second_call(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $lessonId = $this->insertLesson($courseId, 0);

        CourseProgressService::completeLesson($enrollment, $lessonId, $userId, 80);
        CourseProgressService::completeLesson($enrollment, $lessonId, $userId, 100);

        $count = DB::table('course_lesson_progress')
            ->where('enrollment_id', $enrollment->id)
            ->where('lesson_id', $lessonId)
            ->count();

        $this->assertSame(1, $count);
    }

    public function test_completeLesson_returns_progress_percent_and_enrollment(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $enrollment = $this->insertEnrollment($courseId, $userId);
        $lessonId = $this->insertLesson($courseId, 0);
        $this->insertLesson($courseId, 1); // second lesson not completed

        $result = CourseProgressService::completeLesson($enrollment, $lessonId, $userId, 100);

        $this->assertArrayHasKey('enrollment', $result);
        $this->assertArrayHasKey('progress_percent', $result);
        $this->assertArrayHasKey('course_completed', $result);
        $this->assertEqualsWithDelta(50.0, $result['progress_percent'], 0.01);
        $this->assertFalse($result['course_completed']);
    }
}
