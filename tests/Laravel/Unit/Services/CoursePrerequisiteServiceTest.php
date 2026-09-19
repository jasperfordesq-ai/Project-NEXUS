<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\Course;
use App\Services\CoursePrerequisiteService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class CoursePrerequisiteServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId = 99320;
    private int $userId;

    /** @var array<int> Course IDs created for this test run */
    private array $courseIds = [];

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->insertOrIgnore([
            'id'                => $this->tenantId,
            'name'              => 'Prereq Tenant',
            'slug'              => 'test-99320',
            'is_active'         => true,
            'depth'             => 0,
            'allows_subtenants' => false,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        TenantContext::setById($this->tenantId);

        $this->userId = DB::table('users')->insertGetId([
            'tenant_id'  => $this->tenantId,
            'name'       => 'Prereq User',
            'email'      => 'prerequser99320@example.com',
            'password'   => bcrypt('secret'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ── helpers ──────────────────────────────────────────────────────

    /**
     * Insert a minimal course row and return its id.
     */
    private function insertCourse(string $slugSuffix, ?array $prerequisites = null): int
    {
        $id = DB::table('courses')->insertGetId([
            'tenant_id'         => $this->tenantId,
            'author_user_id'    => $this->userId,
            'title'             => "Course $slugSuffix",
            'slug'              => "course-{$slugSuffix}-99320",
            'status'            => 'published',
            'moderation_status' => 'approved',
            'level'             => 'beginner',
            'visibility'        => 'members',
            'enrollment_type'   => 'self_paced',
            'prerequisites'     => $prerequisites !== null ? json_encode($prerequisites) : null,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
        $this->courseIds[] = $id;
        return $id;
    }

    /**
     * Insert a completed enrollment for $this->userId into the given course.
     */
    private function enrollCompleted(int $courseId): void
    {
        DB::table('course_enrollments')->insertOrIgnore([
            'tenant_id'   => $this->tenantId,
            'course_id'   => $courseId,
            'user_id'     => $this->userId,
            'status'      => 'completed',
            'completed_at'=> now(),
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    /**
     * Load a Course model by id (tenant-scoped, so TenantContext must be set).
     */
    private function loadCourse(int $id): Course
    {
        $c = Course::find($id);
        $this->assertNotNull($c, "Course $id should exist in tenant $this->tenantId");
        return $c;
    }

    // ── statusFor() — no prerequisites ───────────────────────────────

    public function test_statusFor_returns_empty_when_course_has_no_prerequisites(): void
    {
        $courseId = $this->insertCourse('no-prereq', null);
        $course   = $this->loadCourse($courseId);

        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertSame([], $result);
    }

    public function test_statusFor_returns_empty_when_prerequisites_is_empty_array(): void
    {
        $courseId = $this->insertCourse('empty-prereq', []);
        $course   = $this->loadCourse($courseId);

        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertSame([], $result);
    }

    // ── statusFor() — with prerequisites ─────────────────────────────

    public function test_legacy_completion_requires_a_graded_quiz_pass_to_satisfy_prerequisites(): void
    {
        $prereqId = $this->insertCourse('legacy-quiz');
        $mainId = $this->insertCourse('requires-quiz', [$prereqId]);
        $this->enrollCompleted($prereqId);
        $lesson = \App\Models\CourseLesson::create(['course_id' => $prereqId, 'title' => 'Assessment', 'content_type' => 'quiz']);
        $course = $this->loadCourse($mainId);
        $this->assertSame([$prereqId], CoursePrerequisiteService::unmetIds($course, $this->userId));
        $quiz = \App\Models\CourseQuiz::create(['course_id' => $prereqId, 'lesson_id' => $lesson->id, 'title' => 'Quiz']);
        $attempt = \App\Models\CourseQuizAttempt::create([
            'quiz_id' => $quiz->id, 'user_id' => $this->userId, 'answers' => [],
            'score_percent' => 80, 'passed' => true, 'grading_status' => 'pending_review', 'submitted_at' => now(),
        ]);
        $this->assertFalse(CoursePrerequisiteService::statusFor($course, $this->userId)[0]['completed']);
        $attempt->update(['passed' => false, 'grading_status' => 'graded']);
        $this->assertSame([$prereqId], CoursePrerequisiteService::unmetIds($course, $this->userId));
        $attempt->update(['passed' => true]);
        $this->assertSame([], CoursePrerequisiteService::unmetIds($course, $this->userId));
        $this->assertTrue(CoursePrerequisiteService::statusFor($course, $this->userId)[0]['completed']);
        $this->assertSame('completed', DB::table('course_enrollments')->where('course_id', $prereqId)->where('user_id', $this->userId)->value('status'));
    }

    public function test_statusFor_marks_completed_prerequisite_as_true(): void
    {
        $prereqId = $this->insertCourse('prereq-a');
        $mainId   = $this->insertCourse('main-a', [$prereqId]);

        $this->enrollCompleted($prereqId);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertCount(1, $result);
        $this->assertSame($prereqId, $result[0]['id']);
        $this->assertTrue($result[0]['completed']);
    }

    public function test_statusFor_marks_incomplete_prerequisite_as_false(): void
    {
        $prereqId = $this->insertCourse('prereq-b');
        $mainId   = $this->insertCourse('main-b', [$prereqId]);
        // No enrollment — user has not completed prereqId

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertCount(1, $result);
        $this->assertSame($prereqId, $result[0]['id']);
        $this->assertFalse($result[0]['completed']);
    }

    public function test_statusFor_handles_multiple_prerequisites_mixed_completion(): void
    {
        $prereq1 = $this->insertCourse('prereq-c1');
        $prereq2 = $this->insertCourse('prereq-c2');
        $mainId  = $this->insertCourse('main-c', [$prereq1, $prereq2]);

        $this->enrollCompleted($prereq1);
        // prereq2 is not completed

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertCount(2, $result);
        $indexed = array_column($result, 'completed', 'id');
        $this->assertTrue($indexed[$prereq1]);
        $this->assertFalse($indexed[$prereq2]);
    }

    public function test_statusFor_returns_correct_shape_per_entry(): void
    {
        $prereqId = $this->insertCourse('prereq-shape');
        $mainId   = $this->insertCourse('main-shape', [$prereqId]);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertCount(1, $result);
        $entry = $result[0];
        $this->assertArrayHasKey('id', $entry);
        $this->assertArrayHasKey('title', $entry);
        $this->assertArrayHasKey('slug', $entry);
        $this->assertArrayHasKey('completed', $entry);
        $this->assertIsInt($entry['id']);
        $this->assertIsBool($entry['completed']);
    }

    public function test_statusFor_returns_empty_when_userId_is_null(): void
    {
        $prereqId = $this->insertCourse('prereq-null-user');
        $mainId   = $this->insertCourse('main-null-user', [$prereqId]);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, null);

        // When userId is null all prerequisites are returned with completed=false
        $this->assertCount(1, $result);
        $this->assertFalse($result[0]['completed']);
    }

    // ── statusFor() — active enrollment is NOT completed ─────────────

    public function test_statusFor_active_enrollment_does_not_count_as_completed(): void
    {
        $prereqId = $this->insertCourse('prereq-active');
        $mainId   = $this->insertCourse('main-active', [$prereqId]);

        // Insert an active (not completed) enrollment
        DB::table('course_enrollments')->insertOrIgnore([
            'tenant_id'  => $this->tenantId,
            'course_id'  => $prereqId,
            'user_id'    => $this->userId,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::statusFor($course, $this->userId);

        $this->assertCount(1, $result);
        $this->assertFalse($result[0]['completed']);
    }

    // ── unmetIds() ───────────────────────────────────────────────────

    public function test_unmetIds_returns_empty_when_all_prerequisites_met(): void
    {
        $prereq1 = $this->insertCourse('prereq-met1');
        $prereq2 = $this->insertCourse('prereq-met2');
        $mainId  = $this->insertCourse('main-all-met', [$prereq1, $prereq2]);

        $this->enrollCompleted($prereq1);
        $this->enrollCompleted($prereq2);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::unmetIds($course, $this->userId);

        $this->assertSame([], $result);
    }

    public function test_unmetIds_returns_ids_of_unmet_prerequisites(): void
    {
        $prereq1 = $this->insertCourse('prereq-unmet1');
        $prereq2 = $this->insertCourse('prereq-unmet2');
        $mainId  = $this->insertCourse('main-partial', [$prereq1, $prereq2]);

        $this->enrollCompleted($prereq1);
        // prereq2 not completed

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::unmetIds($course, $this->userId);

        $this->assertSame([$prereq2], $result);
    }

    public function test_unmetIds_returns_all_ids_when_none_are_met(): void
    {
        $prereq1 = $this->insertCourse('prereq-none1');
        $prereq2 = $this->insertCourse('prereq-none2');
        $mainId  = $this->insertCourse('main-none-met', [$prereq1, $prereq2]);

        $course = $this->loadCourse($mainId);
        $result = CoursePrerequisiteService::unmetIds($course, $this->userId);

        sort($result);
        $expected = [$prereq1, $prereq2];
        sort($expected);
        $this->assertSame($expected, $result);
    }

    public function test_unmetIds_returns_empty_when_course_has_no_prerequisites(): void
    {
        $mainId = $this->insertCourse('main-no-prereq-unmet', null);
        $course = $this->loadCourse($mainId);

        $result = CoursePrerequisiteService::unmetIds($course, $this->userId);

        $this->assertSame([], $result);
    }
}
