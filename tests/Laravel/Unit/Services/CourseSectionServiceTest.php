<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\CourseSectionService;
use App\Core\TenantContext;
use App\Models\CourseSection;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

/**
 * CourseSectionServiceTest
 *
 * CourseSectionService is a CRUD service backed by the course_sections and
 * course_lessons tables.  Every method is tested against the real nexus_test DB
 * using DatabaseTransactions so all fixtures roll back cleanly.
 *
 * Fixture strategy:
 *   - We need a real courses row (FK from course_sections.course_id).
 *   - We need a real users row for courses.author_user_id.
 *   - We insert these via DB::table() with explicit minimal columns so we don't
 *     trip on NULL constraints.
 *
 * CourseSectionService does NOT filter by tenant directly — CourseSection carries
 * HasTenantScope which auto-fills tenant_id on creating and scopes all queries to
 * TenantContext::getId() (set to 2 in parent setUp).
 */
class CourseSectionServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    /** @var int A course ID valid for all tests in this class */
    private int $courseId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);

        // Seed a minimal user + course for FK satisfaction.
        $uid = uniqid('sectest', true);
        $userId = DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Section Author ' . $uid,
            'first_name' => 'Section',
            'last_name'  => 'Author',
            'email'      => 'sectauthor.' . $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0.0,
            'role'       => 'member',
            'is_approved'=> 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $slug = 'test-course-' . $uid;
        $this->courseId = DB::table('courses')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'author_user_id'   => $userId,
            'title'            => 'Section Test Course',
            'slug'             => $slug,
            'level'            => 'beginner',
            'visibility'       => 'members',
            'enrollment_type'  => 'self_paced',
            'status'           => 'draft',
            'moderation_status'=> 'pending',
            'credit_cost'      => 0.00,
            'learner_credit_reward'    => 0.00,
            'instructor_credit_reward' => 0.00,
            'enrollment_count' => 0,
            'completion_count' => 0,
            'rating_avg'       => 0.00,
            'rating_count'     => 0,
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    // ── create ────────────────────────────────────────────────────────────────

    public function test_create_inserts_a_section_row_and_returns_model(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Intro', 'position' => 1]);

        $this->assertInstanceOf(CourseSection::class, $section);
        $this->assertSame($this->courseId, (int) $section->course_id);
        $this->assertSame('Intro', $section->title);
        $this->assertSame(1, (int) $section->position);
    }

    public function test_create_persists_section_to_database(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Chapter 1', 'position' => 1]);

        $row = DB::table('course_sections')->where('id', $section->id)->first();
        $this->assertNotNull($row);
        $this->assertSame('Chapter 1', $row->title);
    }

    public function test_create_trims_whitespace_from_title(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => '  Trimmed Title  ', 'position' => 1]);

        $this->assertSame('Trimmed Title', $section->title);
    }

    public function test_create_auto_assigns_position_when_not_provided(): void
    {
        // First section: position should be 1 (max=0 + 1).
        $s1 = CourseSectionService::create($this->courseId, ['title' => 'Section A']);
        $this->assertSame(1, (int) $s1->position);

        // Second section: position should be 2 (max=1 + 1).
        $s2 = CourseSectionService::create($this->courseId, ['title' => 'Section B']);
        $this->assertSame(2, (int) $s2->position);
    }

    public function test_create_sets_tenant_id_from_context(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Tenant Check', 'position' => 1]);

        $row = DB::table('course_sections')->where('id', $section->id)->first();
        $this->assertSame(self::TENANT_ID, (int) $row->tenant_id);
    }

    // ── update ────────────────────────────────────────────────────────────────

    public function test_update_returns_null_for_nonexistent_section(): void
    {
        $result = CourseSectionService::update(PHP_INT_MAX, ['title' => 'Ghost']);
        $this->assertNull($result);
    }

    public function test_update_changes_title(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Old Title', 'position' => 1]);
        $updated = CourseSectionService::update($section->id, ['title' => 'New Title']);

        $this->assertNotNull($updated);
        $this->assertSame('New Title', $updated->title);
    }

    public function test_update_trims_whitespace_from_title(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Before', 'position' => 1]);
        $updated = CourseSectionService::update($section->id, ['title' => '  After  ']);

        $this->assertSame('After', $updated->title);
    }

    public function test_update_changes_position(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Pos Test', 'position' => 1]);
        $updated = CourseSectionService::update($section->id, ['position' => 5]);

        $this->assertSame(5, (int) $updated->position);
    }

    public function test_update_persists_changes_to_database(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Persist Me', 'position' => 1]);
        CourseSectionService::update($section->id, ['title' => 'Persisted', 'position' => 3]);

        $row = DB::table('course_sections')->where('id', $section->id)->first();
        $this->assertSame('Persisted', $row->title);
        $this->assertSame(3, (int) $row->position);
    }

    public function test_update_does_not_change_title_when_key_absent(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Stable Title', 'position' => 1]);
        $updated = CourseSectionService::update($section->id, ['position' => 9]);

        $this->assertSame('Stable Title', $updated->title);
    }

    public function test_update_returns_CourseSection_instance_on_success(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Type Check', 'position' => 1]);
        $updated = CourseSectionService::update($section->id, ['title' => 'Updated']);

        $this->assertInstanceOf(CourseSection::class, $updated);
    }

    // ── delete ────────────────────────────────────────────────────────────────

    public function test_delete_returns_false_for_nonexistent_section(): void
    {
        $result = CourseSectionService::delete(PHP_INT_MAX);
        $this->assertFalse($result);
    }

    public function test_delete_removes_section_row_and_returns_true(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Delete Me', 'position' => 1]);
        $sectionId = $section->id;

        $result = CourseSectionService::delete($sectionId);

        $this->assertTrue($result);
        $this->assertNull(DB::table('course_sections')->where('id', $sectionId)->first());
    }

    public function test_delete_orphans_lessons_by_nullifying_section_id(): void
    {
        // Create a section, then attach a lesson to it.
        $section = CourseSectionService::create($this->courseId, ['title' => 'Has Lessons', 'position' => 1]);

        $lessonId = DB::table('course_lessons')->insertGetId([
            'tenant_id'    => self::TENANT_ID,
            'course_id'    => $this->courseId,
            'section_id'   => $section->id,
            'title'        => 'Orphan Lesson',
            'content_type' => 'text',
            'position'     => 1,
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        CourseSectionService::delete($section->id);

        $lesson = DB::table('course_lessons')->where('id', $lessonId)->first();
        $this->assertNotNull($lesson, 'Lesson row should still exist');
        $this->assertNull($lesson->section_id, 'Lesson section_id should be nullified, not deleted');
    }

    public function test_failed_section_delete_keeps_its_lessons_attached(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Keep curriculum']);
        $lesson = \App\Services\CourseLessonService::create($this->courseId, ['section_id' => $section->id, 'title' => 'Keep lesson']);
        $dispatcher = CourseSection::getEventDispatcher();
        CourseSection::setEventDispatcher(clone $dispatcher);
        CourseSection::deleted(function () { throw new \RuntimeException('Injected delete failure'); });
        try {
            try {
                CourseSectionService::delete($section->id);
                $this->fail('Expected injected failure');
            } catch (\RuntimeException $error) {
                $this->assertSame('Injected delete failure', $error->getMessage());
            }
            $this->assertNotNull($section->fresh());
            $this->assertSame($section->id, $lesson->fresh()->section_id);
        } finally {
            CourseSection::setEventDispatcher($dispatcher);
        }
    }

    public function test_vetoed_section_delete_keeps_its_lessons_attached(): void
    {
        $section = CourseSectionService::create($this->courseId, ['title' => 'Keep curriculum']);
        $lesson = \App\Services\CourseLessonService::create($this->courseId, ['section_id' => $section->id, 'title' => 'Keep lesson']);
        $dispatcher = CourseSection::getEventDispatcher();
        CourseSection::setEventDispatcher(clone $dispatcher);
        CourseSection::deleting(fn () => false);
        try {
            $this->assertFalse(CourseSectionService::delete($section->id));
            $this->assertNotNull($section->fresh());
            $this->assertSame($section->id, $lesson->fresh()->section_id);
        } finally {
            CourseSection::setEventDispatcher($dispatcher);
        }
    }
}
