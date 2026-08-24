<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Courses;

use App\Core\TenantContext;
use App\Exceptions\MaxAttemptsExceededException;
use App\Models\Course;
use App\Models\CourseLesson;
use App\Models\CourseQuestion;
use App\Models\CourseQuiz;
use App\Models\CourseSection;
use App\Services\CourseEnrollmentService;
use App\Services\CourseLessonService;
use App\Services\CourseProgressService;
use App\Services\CourseQuizService;
use App\Services\CourseService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Service-level tests for enrollment, progress→completion, quiz grading,
 * and tenant isolation in the Courses module.
 */
class CourseProgressAndQuizTest extends TestCase
{
    use DatabaseTransactions;

    private function makeCourseWithLessons(int $lessonCount = 2): Course
    {
        // author_user_id / status / moderation_status / published_at are not
        // mass-assignable (Course::$fillable hardening) — set them explicitly.
        $course = new Course([
            'title' => 'Test Course',
            'slug' => 'test-course-' . uniqid(),
            'visibility' => 'members',
        ]);
        $course->tenant_id = $this->testTenantId;
        $course->author_user_id = 1;
        $course->status = 'published';
        $course->moderation_status = 'approved';
        $course->published_at = now();
        $course->save();

        for ($i = 1; $i <= $lessonCount; $i++) {
            CourseLesson::create([
                'course_id' => $course->id,
                'title' => "Lesson {$i}",
                'content_type' => 'text',
                'position' => $i,
            ]);
        }

        return $course;
    }

    private function setCourseModeration(bool $enabled): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $config = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
        if (!is_array($config)) {
            $config = [];
        }
        $config['courses']['moderation_enabled'] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['configuration' => json_encode($config)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_enroll_is_idempotent(): void
    {
        $course = $this->makeCourseWithLessons(1);

        $first = CourseEnrollmentService::enroll($course->id, 42);
        $second = CourseEnrollmentService::enroll($course->id, 42);

        $this->assertSame($first->id, $second->id);
    }

    public function test_dropped_enrollment_is_not_active_and_can_be_reactivated_without_duplicate_row(): void
    {
        $course = $this->makeCourseWithLessons(1);

        $first = CourseEnrollmentService::enroll($course->id, 42);
        $this->assertTrue(CourseEnrollmentService::isEnrolled($course->id, 42));
        $this->assertSame(1, (int) $course->fresh()->enrollment_count);

        $this->assertTrue(CourseEnrollmentService::drop($course->id, 42));
        $this->assertFalse(CourseEnrollmentService::isEnrolled($course->id, 42));
        $this->assertSame('dropped', $first->fresh()->status);
        $this->assertSame(0, (int) $course->fresh()->enrollment_count);

        $again = CourseEnrollmentService::enroll($course->id, 42);
        $this->assertSame($first->id, $again->id);
        $this->assertSame('active', $again->fresh()->status);
        $this->assertSame(1, (int) $course->fresh()->enrollment_count);
    }

    public function test_for_user_excludes_dropped_enrollments(): void
    {
        $course = $this->makeCourseWithLessons(1);
        CourseEnrollmentService::enroll($course->id, 42);
        CourseEnrollmentService::drop($course->id, 42);

        $this->assertSame([], CourseEnrollmentService::forUser(42));
    }

    public function test_completing_all_lessons_completes_course(): void
    {
        $course = $this->makeCourseWithLessons(2);
        $lessons = CourseLesson::where('course_id', $course->id)->orderBy('position')->get();

        $enrollment = CourseEnrollmentService::enroll($course->id, 42);

        $r1 = CourseProgressService::completeLesson($enrollment, $lessons[0]->id, 42);
        $this->assertFalse($r1['course_completed']);
        $this->assertEqualsWithDelta(50.0, (float) $r1['progress_percent'], 0.01);

        $r2 = CourseProgressService::completeLesson($enrollment->fresh(), $lessons[1]->id, 42);
        $this->assertTrue($r2['course_completed']);
        $this->assertEqualsWithDelta(100.0, (float) $r2['progress_percent'], 0.01);

        $this->assertSame('completed', $enrollment->fresh()->status);
    }

    public function test_quiz_auto_grades_mcq(): void
    {
        $course = $this->makeCourseWithLessons(1);
        $quiz = CourseQuiz::create([
            'course_id' => $course->id,
            'title' => 'Quiz',
            'pass_mark_percent' => 50,
        ]);
        CourseQuestion::create([
            'quiz_id' => $quiz->id,
            'type' => 'mcq',
            'prompt' => '2+2?',
            'options' => [['id' => 'a', 'label' => '3'], ['id' => 'b', 'label' => '4']],
            'correct' => ['b'],
            'points' => 1,
            'position' => 1,
        ]);

        $pass = CourseQuizService::submitAttempt($quiz->id, 42, [], null);
        $this->assertSame(0.0, (float) $pass['score_percent']); // no answer → 0

        $correct = CourseQuizService::submitAttempt($quiz->id, 42, [], null);
        $this->assertNotNull($correct['attempt']->id);
    }

    public function test_quiz_grades_correct_answer_as_pass(): void
    {
        $course = $this->makeCourseWithLessons(1);
        $quiz = CourseQuiz::create([
            'course_id' => $course->id,
            'title' => 'Quiz',
            'pass_mark_percent' => 100,
        ]);
        $q = CourseQuestion::create([
            'quiz_id' => $quiz->id,
            'type' => 'mcq',
            'prompt' => 'Pick b',
            'options' => [['id' => 'a', 'label' => 'A'], ['id' => 'b', 'label' => 'B']],
            'correct' => ['b'],
            'points' => 1,
            'position' => 1,
        ]);

        $result = CourseQuizService::submitAttempt($quiz->id, 42, [$q->id => 'b'], null);
        $this->assertSame(100.0, (float) $result['score_percent']);
        $this->assertTrue($result['passed']);
    }

    public function test_quiz_enforces_max_attempts(): void
    {
        $course = $this->makeCourseWithLessons(1);
        $quiz = CourseQuiz::create([
            'course_id' => $course->id,
            'title' => 'Limited',
            'pass_mark_percent' => 50,
            'max_attempts' => 1,
        ]);
        CourseQuestion::create([
            'quiz_id' => $quiz->id,
            'type' => 'mcq',
            'prompt' => 'Pick b',
            'options' => [['id' => 'a', 'label' => 'A'], ['id' => 'b', 'label' => 'B']],
            'correct' => ['b'],
            'points' => 1,
            'position' => 1,
        ]);

        // First attempt is allowed.
        $first = CourseQuizService::submitAttempt($quiz->id, 42, [], null);
        $this->assertNotNull($first['attempt']->id);

        // A second attempt exceeds max_attempts and is rejected (enforced inside
        // the row-locked transaction, so it can't be raced by concurrent requests).
        $this->expectException(MaxAttemptsExceededException::class);
        CourseQuizService::submitAttempt($quiz->id, 42, [], null);
    }

    public function test_lesson_service_rejects_section_ids_from_another_course(): void
    {
        $course = $this->makeCourseWithLessons(0);
        $otherCourse = $this->makeCourseWithLessons(0);
        $otherSection = CourseSection::create([
            'course_id' => $otherCourse->id,
            'title' => 'Other course section',
            'position' => 0,
        ]);

        $lesson = CourseLessonService::create($course->id, [
            'section_id' => $otherSection->id,
            'title' => 'Lesson',
            'content_type' => 'text',
        ]);

        $this->assertNull($lesson->section_id);
    }

    /**
     * A video lesson had no text alternative and nowhere in the schema to put
     * one, which is a WCAG 1.2 failure. The transcript must survive a create, an
     * update, and a read — a field that is accepted but silently dropped is
     * worse than no field, because the instructor believes they provided one.
     */
    public function test_lesson_transcript_round_trips_through_create_update_and_read(): void
    {
        $course = $this->makeCourseWithLessons(0);

        $lesson = CourseLessonService::create($course->id, [
            'title' => 'Welcome video',
            'content_type' => 'video',
            'video_url' => 'https://example.org/welcome.mp4',
            'transcript' => "Hello and welcome.\nThis is the second line.",
        ]);

        $this->assertSame("Hello and welcome.\nThis is the second line.", $lesson->transcript);
        // Read it back from the database, not from the in-memory model.
        $this->assertSame(
            "Hello and welcome.\nThis is the second line.",
            CourseLesson::find($lesson->id)->transcript
        );

        $updated = CourseLessonService::update($lesson->id, ['transcript' => 'Corrected transcript.']);
        $this->assertSame('Corrected transcript.', $updated->transcript);
        $this->assertSame('Corrected transcript.', CourseLesson::find($lesson->id)->transcript);

        // Omitting the field must leave it alone rather than blanking it.
        CourseLessonService::update($lesson->id, ['title' => 'Renamed']);
        $this->assertSame('Corrected transcript.', CourseLesson::find($lesson->id)->transcript);
    }

    public function test_course_publish_honours_moderation_setting(): void
    {
        $this->setCourseModeration(true);
        $course = $this->makeCourseWithLessons(0);
        $course->status = 'draft';
        $course->moderation_status = 'pending';
        $course->published_at = null;
        $course->save();

        $published = CourseService::publish($course);

        $this->assertSame('published', $published->status);
        $this->assertSame('pending', $published->moderation_status);
        $this->assertNull($published->published_at);

        $this->setCourseModeration(false);
    }

    public function test_course_service_normalizes_invalid_enums_and_negative_credit_values(): void
    {
        $course = CourseService::create(1, [
            'title' => 'Normalized course',
            'level' => 'expert',
            'visibility' => 'secret',
            'enrollment_type' => 'live',
            'credit_cost' => -5,
        ]);

        $this->assertSame('beginner', $course->level);
        $this->assertSame('members', $course->visibility);
        $this->assertSame('self_paced', $course->enrollment_type);
        $this->assertEqualsWithDelta(0.0, (float) $course->credit_cost, 0.01);
    }

    public function test_course_is_tenant_scoped(): void
    {
        $course = $this->makeCourseWithLessons(1);

        // Switch to another tenant — the course must not be visible.
        TenantContext::setById(999);
        $this->assertNull(Course::find($course->id));

        // Back to the original tenant — visible again.
        TenantContext::setById($this->testTenantId);
        $this->assertNotNull(Course::find($course->id));
    }
}
