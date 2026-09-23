<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseCohort;
use App\Models\CourseLesson;
use App\Models\CourseQuestion;
use App\Models\CourseQuiz;
use App\Models\CourseSection;
use App\Models\Group;
use App\Models\GroupMember;
use App\Models\User;
use App\Services\CourseGroupService;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Smoke + feature-gate tests for the Courses module (alpha).
 */
class CourseControllerTest extends TestCase
{
    use DatabaseTransactions;

    /** Defensively reset auth + tenant state leaked by earlier tests. */
    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function enableCourses(bool $enabled = true): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode(['courses' => $enabled])]);
        // Reload tenant context so hasFeature() sees the change.
        TenantContext::setById($this->testTenantId);
    }

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        return $user;
    }

    /** @return array<string,string> */
    private function authHeaders(User $user): array
    {
        $token = app(TokenService::class)->generateToken(
            (int) $user->id,
            (int) $user->tenant_id
        );

        return ['Authorization' => 'Bearer ' . $token];
    }

    private function linkCourseToGroup(Course $course, Group $group): void
    {
        TenantContext::setById($this->testTenantId);
        CourseGroupService::attach($course->id, $group->id);
    }

    private function publishedCourse(array $attributes = []): Course
    {
        $author = $attributes['author'] ?? User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        unset($attributes['author']);

        $course = new Course(array_merge([
            'title' => 'Course ' . uniqid(),
            'slug' => 'course-' . uniqid(),
            'visibility' => 'public',
            'level' => 'beginner',
        ], $attributes));
        $course->tenant_id = $this->testTenantId;
        $course->author_user_id = $author->id;
        $course->status = 'published';
        $course->moderation_status = 'approved';
        $course->published_at = now();
        $course->save();

        return $course;
    }

    public function test_course_detail_hides_protected_lesson_content_until_enrollment_but_keeps_free_previews(): void
    {
        $this->enableCourses();
        $viewer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $course = $this->publishedCourse();
        $section = CourseSection::create(['course_id' => $course->id, 'title' => 'Syllabus section']);
        $protected = CourseLesson::create([
            'course_id' => $course->id,
            'section_id' => $section->id,
            'title' => 'Paid lesson',
            'content_type' => 'text',
            'body' => 'paid-body-secret',
            'transcript' => 'paid-transcript-secret',
            'video_url' => 'https://media.invalid/paid-video-secret',
            'attachment_url' => 'https://media.invalid/paid-attachment-secret',
            'embed_url' => 'https://media.invalid/paid-embed-secret',
            'is_preview' => false,
        ]);
        CourseQuiz::create([
            'course_id' => $course->id,
            'lesson_id' => $protected->id,
            'title' => 'paid-quiz-secret',
            'description' => 'paid-quiz-description-secret',
        ]);
        $preview = CourseLesson::create([
            'course_id' => $course->id,
            'section_id' => $section->id,
            'title' => 'Free preview',
            'content_type' => 'text',
            'body' => 'free-preview-body',
            'is_preview' => true,
        ]);
        $unassigned = CourseLesson::create([
            'course_id' => $course->id,
            'title' => 'Unassigned paid lesson',
            'content_type' => 'file',
            'body' => 'unassigned-body-secret',
            'attachment_url' => 'https://media.invalid/unassigned-attachment-secret',
            'is_preview' => false,
        ]);

        foreach ([$course->id, $course->slug] as $identifier) {
            $response = $this->apiGet('/v2/courses/' . $identifier, $this->authHeaders($viewer))
                ->assertOk()
                ->assertJsonPath('data.sections.0.title', 'Syllabus section')
                ->assertJsonPath('data.sections.0.lessons.0.id', $protected->id)
                ->assertJsonPath('data.sections.0.lessons.0.title', 'Paid lesson')
                ->assertJsonPath('data.sections.0.lessons.1.id', $preview->id)
                ->assertJsonPath('data.sections.0.lessons.1.body', 'free-preview-body')
                ->assertJsonPath('data.unassigned_lessons.0.id', $unassigned->id)
                ->assertJsonPath('data.unassigned_lessons.0.title', 'Unassigned paid lesson');

            foreach (['body', 'transcript', 'video_url', 'attachment_url', 'embed_url', 'quiz'] as $field) {
                $response->assertJsonMissingPath('data.sections.0.lessons.0.' . $field);
            }
            foreach (['body', 'attachment_url'] as $field) {
                $response->assertJsonMissingPath('data.unassigned_lessons.0.' . $field);
            }
            $response
                ->assertJsonMissing(['paid-body-secret'])
                ->assertJsonMissing(['paid-quiz-secret'])
                ->assertJsonMissing(['unassigned-body-secret']);
        }
    }

    public function test_course_detail_exposes_only_available_content_to_enrolled_learners_and_all_content_to_managers(): void
    {
        $this->enableCourses();
        $learner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $course = $this->publishedCourse(['author' => $owner]);
        $section = CourseSection::create(['course_id' => $course->id, 'title' => 'Timed section']);
        $available = CourseLesson::create([
            'course_id' => $course->id,
            'section_id' => $section->id,
            'title' => 'Available now',
            'content_type' => 'text',
            'body' => 'available-enrolled-body',
            'drip_type' => 'none',
        ]);
        $locked = CourseLesson::create([
            'course_id' => $course->id,
            'section_id' => $section->id,
            'title' => 'Available later',
            'content_type' => 'text',
            'body' => 'locked-future-body-secret',
            'drip_type' => 'fixed_date',
            'drip_date' => now()->addWeek(),
        ]);
        \App\Models\CourseEnrollment::create([
            'course_id' => $course->id,
            'user_id' => $learner->id,
            'status' => 'active',
            'enrolled_at' => now(),
        ]);

        $this->apiGet('/v2/courses/' . $course->id, $this->authHeaders($learner))
            ->assertOk()
            ->assertJsonPath('data.is_enrolled', true)
            ->assertJsonPath('data.sections.0.lessons.0.id', $available->id)
            ->assertJsonPath('data.sections.0.lessons.0.body', 'available-enrolled-body')
            ->assertJsonPath('data.sections.0.lessons.1.id', $locked->id)
            ->assertJsonPath('data.sections.0.lessons.1.title', 'Available later')
            ->assertJsonMissingPath('data.sections.0.lessons.1.body')
            ->assertJsonMissing(['locked-future-body-secret']);

        $this->apiGet('/v2/courses/' . $course->id, $this->authHeaders($owner))
            ->assertOk()
            ->assertJsonPath('data.sections.0.lessons.1.body', 'locked-future-body-secret');

        \App\Models\CourseEnrollment::where('course_id', $course->id)
            ->where('user_id', $learner->id)
            ->update(['status' => 'dropped']);

        $this->apiGet('/v2/courses/' . $course->id, $this->authHeaders($learner))
            ->assertOk()
            ->assertJsonPath('data.is_enrolled', false)
            ->assertJsonMissingPath('data.sections.0.lessons.0.body')
            ->assertJsonMissing(['available-enrolled-body']);
    }

    public function test_deleted_section_lessons_remain_visible_and_can_be_reassigned(): void
    {
        $this->enableCourses();
        $owner = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $owner]);
        $section = CourseSection::create(['course_id' => $course->id, 'title' => 'Original']);
        $lesson = CourseLesson::create(['course_id' => $course->id, 'section_id' => $section->id, 'title' => 'Preserved lesson', 'content_type' => 'text', 'body' => 'Retained learning material']);
        $this->apiDelete('/v2/courses/' . $course->id . '/sections/' . $section->id)->assertOk();
        $this->assertNull($lesson->fresh()->section_id);
        foreach ([$course->id, $course->slug] as $identifier) {
            $this->apiGet('/v2/courses/' . $identifier)->assertOk()
                ->assertJsonPath('data.sections', [])
                ->assertJsonPath('data.unassigned_lessons.0.id', $lesson->id)
                ->assertJsonPath('data.unassigned_lessons.0.body', 'Retained learning material');
        }
        $replacement = CourseSection::create(['course_id' => $course->id, 'title' => 'Replacement']);
        $this->apiPut('/v2/courses/' . $course->id . '/lessons/' . $lesson->id, ['section_id' => $replacement->id])->assertOk();
        $this->apiGet('/v2/courses/' . $course->id)->assertOk()
            ->assertJsonPath('data.unassigned_lessons', [])
            ->assertJsonPath('data.sections.0.lessons.0.id', $lesson->id);
    }

    public function test_curriculum_section_order_is_atomic_replayable_and_rejects_stale_or_invalid_sets(): void
    {
        $this->enableCourses();
        $owner = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $owner]);
        $ids = [];
        foreach (['One', 'Two', 'Three'] as $position => $title) {
            $ids[] = CourseSection::create(['course_id' => $course->id, 'title' => $title, 'position' => $position])->id;
        }
        $path = '/v2/courses/' . $course->id . '/sections/reorder';
        $desired = [$ids[1], $ids[0], $ids[2]];
        $payload = ['expected_ids' => $ids, 'ordered_ids' => $desired];
        $this->apiPut($path, $payload)->assertOk()->assertJsonPath('data.ordered_ids', $desired);
        $this->apiPut($path, $payload)->assertOk();
        $this->apiPut($path, ['expected_ids' => $ids, 'ordered_ids' => array_reverse($ids)])->assertStatus(409);
        $this->apiPut($path, ['expected_ids' => $desired, 'ordered_ids' => [$ids[0], $ids[0], $ids[2]]])->assertStatus(422);
        $this->apiPut($path, ['expected_ids' => $desired, 'ordered_ids' => [$ids[0], $ids[2]]])->assertStatus(422);
        $this->assertSame($desired, CourseSection::where('course_id', $course->id)->orderBy('position')->pluck('id')->all());
        $this->authenticatedUser();
        $this->apiPut($path, ['expected_ids' => $desired, 'ordered_ids' => $ids])->assertForbidden();
    }

    public function test_curriculum_lesson_order_cannot_include_another_sections_lesson(): void
    {
        $this->enableCourses();
        $owner = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $owner]);
        $section = CourseSection::create(['course_id' => $course->id, 'title' => 'One']);
        $other = CourseSection::create(['course_id' => $course->id, 'title' => 'Other']);
        $ids = [];
        foreach ([0, 1] as $position) {
            $ids[] = CourseLesson::create(['course_id' => $course->id, 'section_id' => $section->id, 'title' => 'Lesson', 'content_type' => 'text', 'position' => $position])->id;
        }
        $foreign = CourseLesson::create(['course_id' => $course->id, 'section_id' => $other->id, 'title' => 'Other', 'content_type' => 'text']);
        $path = '/v2/courses/' . $course->id . '/sections/' . $section->id . '/lessons/reorder';
        $this->apiPut($path, ['expected_ids' => $ids, 'ordered_ids' => [$ids[0], $foreign->id]])->assertStatus(422);
        $this->apiPut($path, ['expected_ids' => $ids, 'ordered_ids' => array_reverse($ids)])->assertOk()->assertJsonPath('data.ordered_ids', array_reverse($ids));
        $this->assertSame($other->id, $foreign->fresh()->section_id);
    }

    public function test_curriculum_order_normalises_legacy_tied_positions(): void
    {
        $this->enableCourses();
        $owner = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $owner]);
        $first = CourseSection::create(['course_id' => $course->id, 'title' => 'One', 'position' => 5]);
        $second = CourseSection::create(['course_id' => $course->id, 'title' => 'Two', 'position' => 5]);
        $ids = [$first->id, $second->id];
        $this->apiPut('/v2/courses/' . $course->id . '/sections/reorder', ['expected_ids' => $ids, 'ordered_ids' => $ids])->assertOk();
        $this->assertSame(0, $first->fresh()->position);
        $this->assertSame(1, $second->fresh()->position);
    }

    public function test_curriculum_reorder_rolls_back_all_positions_if_a_write_fails(): void
    {
        $owner = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $owner]);
        $first = CourseSection::create(['course_id' => $course->id, 'title' => 'One', 'position' => 0]);
        $second = CourseSection::create(['course_id' => $course->id, 'title' => 'Two', 'position' => 1]);
        $dispatcher = CourseSection::getEventDispatcher();
        CourseSection::setEventDispatcher(clone $dispatcher);
        CourseSection::updating(function ($section) use ($second) {
            if ($section->id === $second->id) throw new \RuntimeException('Injected second-write failure');
        });
        try {
            try {
                \App\Services\CourseCurriculumOrderService::sections($course->id, [$first->id, $second->id], [$second->id, $first->id]);
                $this->fail('The second write must fail');
            } catch (\RuntimeException $error) {
                $this->assertSame('Injected second-write failure', $error->getMessage());
            }
        } finally {
            CourseSection::setEventDispatcher($dispatcher);
        }
        $this->assertSame(0, $first->fresh()->position);
        $this->assertSame(1, $second->fresh()->position);
    }

    public function test_enrolment_requires_the_confirmed_price_before_charging(): void
    {
        $this->enableCourses();
        $learner = $this->authenticatedUser();
        DB::table('users')->where('id', $learner->id)->update(['balance' => 0]);
        $course = $this->publishedCourse(['credit_cost' => 5]);
        $path = '/v2/courses/' . $course->id . '/enroll';
        foreach ([0, 2, 8] as $quote) {
            $this->apiPost($path, ['expected_credit_cost' => $quote])
                ->assertStatus(409)->assertJsonPath('errors.0.code', 'COURSE_PRICE_CHANGED');
        }
        foreach ([-1, 'invalid', 1.234, null] as $quote) {
            $this->apiPost($path, ['expected_credit_cost' => $quote])->assertStatus(422);
        }
        $this->assertFalse(\App\Services\CourseEnrollmentService::isEnrolled($course->id, $learner->id));
        $this->assertEquals(0, $learner->fresh()->balance);
        $this->apiPost($path, ['expected_credit_cost' => 5])
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'INSUFFICIENT_CREDITS');
    }

    public function test_browse_returns_403_when_feature_disabled(): void
    {
        $this->enableCourses(false);
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/courses');
        $this->assertSame(403, $response->status());
    }

    public function test_quiz_completion_and_legacy_certificate_require_a_pass(): void
    {
        $this->enableCourses();
        $learner = $this->authenticatedUser();
        $course = $this->publishedCourse();
        $enrollment = \App\Models\CourseEnrollment::create(['course_id' => $course->id, 'user_id' => $learner->id, 'status' => 'active', 'enrolled_at' => now()]);
        $lesson = CourseLesson::create(['course_id' => $course->id, 'title' => 'Assessment', 'content_type' => 'quiz', 'drip_type' => 'none']);
        CourseLesson::create(['course_id' => $course->id, 'title' => 'Later lesson', 'content_type' => 'text']);
        $quiz = CourseQuiz::create(['course_id' => $course->id, 'lesson_id' => $lesson->id, 'title' => 'Quiz']);
        $path = '/v2/courses/' . $course->id . '/lessons/' . $lesson->id . '/complete';
        $this->apiPost($path, [])->assertStatus(422)->assertJsonPath('errors.0.code', 'QUIZ_PASS_REQUIRED');
        $this->assertSame(0, DB::table('course_lesson_progress')->where('enrollment_id', $enrollment->id)->count());
        $enrollment->update(['status' => 'completed', 'progress_percent' => 100]);
        DB::table('course_lesson_progress')->insert(['tenant_id' => $this->testTenantId, 'enrollment_id' => $enrollment->id, 'lesson_id' => $lesson->id, 'user_id' => $learner->id, 'status' => 'completed', 'watch_percent' => 100, 'created_at' => now(), 'updated_at' => now()]);
        $before = $this->apiGet('/v2/courses/' . $course->id . '/progress')->assertOk();
        $before->assertJsonPath('data.enrollment.status', 'active')->assertJsonPath('data.lessons.0.status', 'not_started');
        $this->assertEquals(0, $before->json('data.enrollment.progress_percent'));
        $learning = $this->apiGet('/v2/me/courses')->assertOk();
        $listed = collect($learning->json('data'))->keyBy('id')[$enrollment->id];
        $this->assertSame('active', $listed['status']);
        $this->assertEquals($before->json('data.enrollment.progress_percent'), $listed['progress_percent']);
        $availability = collect($before->json('data.availability'))->keyBy('lesson_id');
        $this->assertFalse($availability[$lesson->id]['completion_allowed']);
        $this->assertSame('completed', $enrollment->fresh()->status); // Read projection has no write side effects.
        $this->apiGet('/v2/courses/' . $course->id . '/certificate')->assertStatus(422)->assertJsonPath('errors.0.code', 'QUIZ_PASS_REQUIRED');
        $enrollment->update(['status' => 'active', 'progress_percent' => 0]);
        \App\Models\CourseQuizAttempt::create(['quiz_id' => $quiz->id, 'user_id' => $learner->id, 'answers' => [], 'passed' => true, 'grading_status' => 'graded', 'score_percent' => 80, 'submitted_at' => now()]);
        $after = $this->apiGet('/v2/courses/' . $course->id . '/progress')->assertOk();
        $this->assertTrue(collect($after->json('data.availability'))->keyBy('lesson_id')[$lesson->id]['completion_allowed']);
        $this->apiPost($path, [])->assertOk()->assertJsonPath('data.course_completed', false);
    }

    public function test_quiz_attempt_replay_survives_limit_and_rejects_changed_answers(): void
    {
        $this->enableCourses();
        $learner = $this->authenticatedUser();
        $course = $this->publishedCourse();
        \App\Models\CourseEnrollment::create([
            'course_id' => $course->id, 'user_id' => $learner->id,
            'status' => 'active', 'enrolled_at' => now(),
        ]);
        $quiz = CourseQuiz::create(['course_id' => $course->id, 'title' => 'Replay quiz', 'max_attempts' => 1]);
        $question = CourseQuestion::create(['quiz_id' => $quiz->id, 'type' => 'mcq', 'prompt' => 'Choose A', 'correct' => ['A'], 'points' => 1]);
        $path = '/v2/courses/quizzes/' . $quiz->id . '/attempt';
        $payload = ['answers' => [$question->id => 'A'], 'idempotency_key' => 'quiz-api-stable-identity'];
        $first = $this->apiPost($path, $payload)->assertCreated();
        $retry = $this->apiPost($path, $payload)->assertCreated();
        $first->assertJsonPath('data.attempts_remaining', 0);
        $retry->assertJsonPath('data.attempts_remaining', 0);
        $this->apiGet('/v2/courses/quizzes/' . $quiz->id)->assertOk()->assertJsonPath('data.attempts_remaining', 0);
        $this->assertSame($first->json('data.attempt_id'), $retry->json('data.attempt_id'));
        $this->assertSame(1, \App\Models\CourseQuizAttempt::where('quiz_id', $quiz->id)->count());
        $this->apiPost($path, ['answers' => [$question->id => 'B'], 'idempotency_key' => $payload['idempotency_key']])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        $headerRetry = $this->apiPost($path, ['answers' => $payload['answers']], ['Idempotency-Key' => $payload['idempotency_key']])->assertCreated();
        $this->assertSame($first->json('data.attempt_id'), $headerRetry->json('data.attempt_id'));
        \App\Models\CourseEnrollment::where('course_id', $course->id)->where('user_id', $learner->id)->update(['status' => 'dropped']);
        $this->apiPost($path, $payload)->assertStatus(403)->assertJsonPath('errors.0.code', 'NOT_ENROLLED');
        $this->assertSame(1, \App\Models\CourseQuizAttempt::where('quiz_id', $quiz->id)->count());
    }

    public function test_quiz_attempt_rejects_malformed_retry_identity_before_spending_attempt(): void
    {
        $this->enableCourses();
        $learner = $this->authenticatedUser();
        $course = $this->publishedCourse();
        \App\Models\CourseEnrollment::create([
            'course_id' => $course->id, 'user_id' => $learner->id,
            'status' => 'active', 'enrolled_at' => now(),
        ]);
        $quiz = CourseQuiz::create(['course_id' => $course->id, 'title' => 'Validation quiz']);
        foreach (['short', ['invalid'], 1234, str_repeat('x', 192)] as $key) {
            $this->apiPost('/v2/courses/quizzes/' . $quiz->id . '/attempt', ['answers' => [], 'idempotency_key' => $key])
                ->assertStatus(422)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_INVALID');
        }
        $this->apiPost('/v2/courses/quizzes/' . $quiz->id . '/attempt', ['answers' => [], 'idempotency_key' => 'body-identity'], ['Idempotency-Key' => 'header-identity'])
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_INVALID');
        $this->assertSame(0, \App\Models\CourseQuizAttempt::where('quiz_id', $quiz->id)->count());
    }

    public function test_grading_preserves_fractional_score_and_stored_feedback(): void
    {
        $this->enableCourses();
        $author = $this->authenticatedUser();
        $learner = User::factory()->forTenant($this->testTenantId)->create();
        $course = $this->publishedCourse(['author' => $author]);
        $quiz = \App\Models\CourseQuiz::create(['course_id' => $course->id, 'title' => 'Review', 'pass_mark_percent' => 50]);
        $attempt = \App\Models\CourseQuizAttempt::create([
            'quiz_id' => $quiz->id, 'user_id' => $learner->id, 'answers' => [],
            'grading_status' => 'pending_review', 'score_percent' => 0, 'passed' => false, 'submitted_at' => now(),
        ]);
        $this->apiPost('/v2/courses/attempts/' . $attempt->id . '/grade', [
            'score_percent' => 82.5, 'passed' => true, 'feedback' => 'Clear explanation',
        ])->assertOk();
        $this->assertEquals(82.5, (float) $attempt->fresh()->score_percent);
        $this->assertSame('Clear explanation', $attempt->fresh()->feedback);
        $this->assertSame($author->id, $attempt->fresh()->graded_by);
        // A response lost after commit can replay the exact desired state, but
        // a stale or competing decision cannot overwrite the first grade.
        $this->apiPost('/v2/courses/attempts/' . $attempt->id . '/grade', [
            'score_percent' => 82.5, 'passed' => true, 'feedback' => 'Clear explanation',
        ])->assertOk();
        $this->apiPost('/v2/courses/attempts/' . $attempt->id . '/grade', [
            'score_percent' => 60, 'passed' => false, 'feedback' => 'Stale replacement',
        ])->assertStatus(409)->assertJsonPath('errors.0.code', 'DECISION_CONFLICT');
        $this->assertEquals(82.5, (float) $attempt->fresh()->score_percent);
        $this->assertSame('Clear explanation', $attempt->fresh()->feedback);
        foreach (['invalid', -1, 101] as $invalidScore) {
            $this->apiPost('/v2/courses/attempts/' . $attempt->id . '/grade', [
                'score_percent' => $invalidScore, 'passed' => false, 'feedback' => 'Must not replace',
            ])->assertStatus(422);
            $this->assertEquals(82.5, (float) $attempt->fresh()->score_percent);
            $this->assertSame('Clear explanation', $attempt->fresh()->feedback);
        }
        $this->authenticatedUser();
        $this->apiPost('/v2/courses/attempts/' . $attempt->id . '/grade', [
            'score_percent' => 10, 'passed' => false,
        ])->assertStatus(403);
        $this->assertEquals(82.5, (float) $attempt->fresh()->score_percent);
    }

    public function test_browse_requires_authentication_when_enabled(): void
    {
        $this->enableCourses(true);
        $response = $this->apiGet('/v2/courses');
        $this->assertSame(401, $response->status());
    }

    public function test_categories_require_authentication_when_enabled(): void
    {
        $this->enableCourses(true);
        $response = $this->apiGet('/v2/courses/categories');
        $this->assertSame(401, $response->status());
    }

    public function test_create_requires_auth(): void
    {
        $this->enableCourses(true);
        $response = $this->apiPost('/v2/courses', ['title' => 'X']);
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_create_allowed_for_any_member(): void
    {
        // Authoring is open to any authenticated member by default.
        $this->enableCourses(true);
        $this->authenticatedUser(); // plain member, no instructor grant
        $response = $this->apiPost('/v2/courses', ['title' => 'My course']);
        $this->assertSame(201, $response->status());
    }

    public function test_course_creation_replays_one_result_and_rejects_changed_content(): void
    {
        $this->enableCourses(true);
        $user = $this->authenticatedUser();
        $headers = ['Idempotency-Key' => 'mobile-course-create-stable-1'];
        $payload = [
            'title' => 'Repair skills ' . uniqid('', true),
            'summary' => 'One accepted draft despite a lost response.',
            'idempotency_key' => 'mobile-course-create-stable-1',
        ];

        $first = $this->apiPost('/v2/courses', $payload, $headers)->assertCreated();
        $replay = $this->apiPost('/v2/courses', $payload, $headers)->assertOk();

        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, Course::where('author_user_id', $user->id)->where('title', $payload['title'])->count());
        $this->assertSame(1, DB::table('course_creation_receipts')->where('actor_user_id', $user->id)->count());
        $this->assertArrayNotHasKey('idempotency_key_hash', $replay->json('data'));
        $this->assertArrayNotHasKey('request_hash', $replay->json('data'));

        $this->apiPost('/v2/courses', [...$payload, 'summary' => 'Changed content'], $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        $this->assertSame(1, Course::where('author_user_id', $user->id)->where('title', $payload['title'])->count());

        $this->apiPost('/v2/courses', [...$payload, 'idempotency_key' => 'different-course-create-key'], $headers)
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_INVALID');
        $this->apiPost('/v2/courses', [...$payload, 'idempotency_key' => 'short'], ['Idempotency-Key' => 'short'])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_INVALID');
        $this->assertSame(1, Course::where('author_user_id', $user->id)->where('title', $payload['title'])->count());
    }

    public function test_course_authoring_creates_replay_one_child_resource_after_response_loss(): void
    {
        $this->enableCourses(true);
        $user = $this->authenticatedUser();
        $course = $this->publishedCourse(['author' => $user]);

        $sectionPayload = ['title' => 'Week one', 'position' => 0, 'idempotency_key' => 'course-section-stable-1'];
        $sectionHeaders = ['Idempotency-Key' => 'course-section-stable-1'];
        $sectionFirst = $this->apiPost("/v2/courses/{$course->id}/sections", $sectionPayload, $sectionHeaders)->assertCreated();
        $sectionReplay = $this->apiPost("/v2/courses/{$course->id}/sections", $sectionPayload, $sectionHeaders)->assertOk();
        $sectionId = (int) $sectionFirst->json('data.id');
        $this->assertSame($sectionId, (int) $sectionReplay->json('data.id'));
        $this->assertSame(1, CourseSection::where('course_id', $course->id)->where('title', 'Week one')->count());

        $this->apiPost(
            "/v2/courses/{$course->id}/sections",
            [...$sectionPayload, 'title' => 'Changed week'],
            $sectionHeaders,
        )->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');
        $this->apiPost(
            "/v2/courses/{$course->id}/lessons",
            ['title' => 'Cross-endpoint reuse', 'idempotency_key' => 'course-section-stable-1'],
            $sectionHeaders,
        )->assertStatus(409)->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');

        $lessonPayload = [
            'section_id' => $sectionId,
            'title' => 'Introduction',
            'content_type' => 'text',
            'position' => 0,
            'idempotency_key' => 'course-lesson-stable-1',
        ];
        $lessonHeaders = ['Idempotency-Key' => 'course-lesson-stable-1'];
        $lessonFirst = $this->apiPost("/v2/courses/{$course->id}/lessons", $lessonPayload, $lessonHeaders)->assertCreated();
        $lessonReplay = $this->apiPost("/v2/courses/{$course->id}/lessons", $lessonPayload, $lessonHeaders)->assertOk();
        $lessonId = (int) $lessonFirst->json('data.id');
        $this->assertSame($lessonId, (int) $lessonReplay->json('data.id'));
        $this->assertSame(1, CourseLesson::where('course_id', $course->id)->where('title', 'Introduction')->count());

        $quizPayload = [
            'lesson_id' => $lessonId,
            'title' => 'Knowledge check',
            'pass_mark_percent' => 70,
            'idempotency_key' => 'course-quiz-stable-1',
        ];
        $quizHeaders = ['Idempotency-Key' => 'course-quiz-stable-1'];
        $quizFirst = $this->apiPost("/v2/courses/{$course->id}/quizzes", $quizPayload, $quizHeaders)->assertCreated();
        $quizReplay = $this->apiPost("/v2/courses/{$course->id}/quizzes", $quizPayload, $quizHeaders)->assertOk();
        $quizId = (int) $quizFirst->json('data.id');
        $this->assertSame($quizId, (int) $quizReplay->json('data.id'));
        $this->assertSame(1, CourseQuiz::where('course_id', $course->id)->where('title', 'Knowledge check')->count());

        $questionPayload = [
            'type' => 'mcq',
            'prompt' => 'Which answer is correct?',
            'options' => [['id' => 'a', 'label' => 'A'], ['id' => 'b', 'label' => 'B']],
            'correct' => ['b'],
            'position' => 1,
            'idempotency_key' => 'course-question-stable-1',
        ];
        $questionHeaders = ['Idempotency-Key' => 'course-question-stable-1'];
        $questionFirst = $this->apiPost(
            "/v2/courses/{$course->id}/quizzes/{$quizId}/questions", $questionPayload, $questionHeaders,
        )->assertCreated();
        $questionReplay = $this->apiPost(
            "/v2/courses/{$course->id}/quizzes/{$quizId}/questions", $questionPayload, $questionHeaders,
        )->assertOk();
        $this->assertSame($questionFirst->json('data.id'), $questionReplay->json('data.id'));
        $this->assertSame(1, CourseQuestion::where('quiz_id', $quizId)->where('prompt', 'Which answer is correct?')->count());

        $cohortPayload = ['name' => 'Autumn intake', 'idempotency_key' => 'course-cohort-stable-1'];
        $cohortHeaders = ['Idempotency-Key' => 'course-cohort-stable-1'];
        $cohortFirst = $this->apiPost("/v2/courses/{$course->id}/cohorts", $cohortPayload, $cohortHeaders)->assertCreated();
        $cohortReplay = $this->apiPost("/v2/courses/{$course->id}/cohorts", $cohortPayload, $cohortHeaders)->assertOk();
        $this->assertSame($cohortFirst->json('data.id'), $cohortReplay->json('data.id'));
        $this->assertSame(1, CourseCohort::where('course_id', $course->id)->where('name', 'Autumn intake')->count());

        $this->assertSame(5, DB::table('course_authoring_creation_receipts')
            ->where('actor_user_id', $user->id)
            ->where('course_id', $course->id)
            ->count());
    }

    public function test_my_enrolled_requires_auth(): void
    {
        $this->enableCourses(true);
        $response = $this->apiGet('/v2/me/courses');
        $this->assertContains($response->status(), [401, 403]);
    }

    public function test_members_only_course_detail_requires_authenticated_member(): void
    {
        $this->enableCourses(true);
        $course = $this->publishedCourse(['visibility' => 'members']);

        $anonymous = $this->apiGet('/v2/courses/' . $course->slug);
        $this->assertSame(401, $anonymous->status());

        $memberUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $member = $this->apiGet('/v2/courses/' . $course->slug, $this->authHeaders($memberUser));
        $this->assertSame(200, $member->status());
    }

    public function test_group_course_detail_requires_linked_group_membership(): void
    {
        $this->enableCourses(true);
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $outsider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $author->id,
            'visibility' => 'public',
        ]);
        GroupMember::factory()->forTenant($this->testTenantId)->create([
            'group_id' => $group->id,
            'user_id' => $member->id,
            'status' => 'active',
            'role' => 'member',
        ]);
        $course = $this->publishedCourse(['author' => $author, 'visibility' => 'group']);
        $this->linkCourseToGroup($course, $group);

        $anonymous = $this->apiGet('/v2/courses/' . $course->slug);
        $this->assertSame(401, $anonymous->status());

        $notMember = $this->apiGet('/v2/courses/' . $course->slug, $this->authHeaders($outsider));
        $this->assertSame(404, $notMember->status());

        $groupMember = $this->apiGet('/v2/courses/' . $course->slug, $this->authHeaders($member));
        $this->assertSame(200, $groupMember->status());
    }

    public function test_group_recommendations_require_membership_and_filter_course_visibility(): void
    {
        $this->enableCourses(true);
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $author->id,
            'visibility' => 'public',
        ]);
        GroupMember::factory()->forTenant($this->testTenantId)->create([
            'group_id' => $group->id,
            'user_id' => $member->id,
            'status' => 'active',
            'role' => 'member',
        ]);

        $publicCourse = $this->publishedCourse(['author' => $author, 'visibility' => 'public']);
        $groupCourse = $this->publishedCourse(['author' => $author, 'visibility' => 'group']);
        $this->linkCourseToGroup($publicCourse, $group);
        $this->linkCourseToGroup($groupCourse, $group);

        $outsider = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $outsiderResponse = $this->apiGet('/v2/groups/' . $group->id . '/courses', $this->authHeaders($outsider));
        $this->assertSame(200, $outsiderResponse->status());
        $outsiderIds = collect($outsiderResponse->json('data'))->pluck('id')->all();
        // A public group exposes its privacy-safe overview to same-tenant users,
        // but recommendations are child content and remain member-only.
        $this->assertSame([], $outsiderIds);
        $this->assertNotContains($groupCourse->id, $outsiderIds);

        $memberResponse = $this->apiGet('/v2/groups/' . $group->id . '/courses', $this->authHeaders($member));
        $this->assertSame(200, $memberResponse->status());
        $memberIds = collect($memberResponse->json('data'))->pluck('id')->all();
        $this->assertContains($publicCourse->id, $memberIds);
        $this->assertContains($groupCourse->id, $memberIds);
    }

    public function test_course_author_cannot_attach_course_to_group_they_do_not_manage(): void
    {
        $this->enableCourses(true);
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $groupOwner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $course = $this->publishedCourse(['author' => $author]);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $groupOwner->id,
            'visibility' => 'public',
        ]);

        Sanctum::actingAs($author, ['*']);
        $response = $this->apiPost("/v2/courses/{$course->id}/groups/{$group->id}");

        $response->assertStatus(403);
        $this->assertFalse(DB::table('course_group_links')
            ->where('tenant_id', $this->testTenantId)
            ->where('course_id', $course->id)
            ->where('group_id', $group->id)
            ->exists());
    }

    public function test_course_author_can_attach_course_to_group_they_manage(): void
    {
        $this->enableCourses(true);
        $author = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $course = $this->publishedCourse(['author' => $author]);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $author->id,
            'visibility' => 'public',
        ]);

        Sanctum::actingAs($author, ['*']);
        $response = $this->apiPost("/v2/courses/{$course->id}/groups/{$group->id}");

        $response->assertStatus(201);
        $this->assertTrue(DB::table('course_group_links')
            ->where('tenant_id', $this->testTenantId)
            ->where('course_id', $course->id)
            ->where('group_id', $group->id)
            ->exists());
    }
}
