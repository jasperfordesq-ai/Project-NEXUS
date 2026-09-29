<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\Course;
use App\Models\CourseQuestion;
use App\Models\CourseQuiz;
use App\Models\User;
use App\Services\CourseEnrollmentService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-313 (partial) — a quiz with the default `max_attempts = 0` (unlimited) and
 * a score in every response is an answer-key oracle: vary one answer, read the
 * score, repeat. The advertised time limit is not enforced either. The durable
 * fix (a recorded start time and an owner decision on what a failed attempt
 * reveals) is written up in E-064/notes-j.md; this pins the mitigation that
 * needs no product decision — a per-learner ceiling on submissions, so an
 * automated key search is slow instead of instant.
 */
final class CourseQuizAttemptThrottleTest extends TestCase
{
    use DatabaseTransactions;

    private const CEILING = 20;

    private function quizFor(User $learner): CourseQuiz
    {
        $course = new Course([
            'title' => 'F-313 course',
            'slug' => 'f313-course-' . uniqid(),
            'visibility' => 'members',
        ]);
        $course->tenant_id = $this->testTenantId;
        $course->author_user_id = 1;
        $course->status = 'published';
        $course->moderation_status = 'approved';
        $course->published_at = now();
        $course->save();

        $quiz = CourseQuiz::create([
            'course_id' => $course->id,
            'title' => 'F-313 quiz',
            'pass_mark_percent' => 100,
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
        CourseEnrollmentService::enroll($course->id, (int) $learner->id);

        return $quiz;
    }

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['courses'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_a_learner_cannot_submit_quiz_attempts_without_limit(): void
    {
        $learner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        RateLimiter::clear('api:course_quiz_attempt:user:' . $learner->id);
        Sanctum::actingAs($learner);
        $quiz = $this->quizFor($learner);
        $question = CourseQuestion::where('quiz_id', $quiz->id)->firstOrFail();

        for ($i = 1; $i <= self::CEILING; $i++) {
            $this->apiPost("/v2/courses/quizzes/{$quiz->id}/attempt", ['answers' => [$question->id => 'a']])
                ->assertStatus(201);
        }

        $over = $this->apiPost("/v2/courses/quizzes/{$quiz->id}/attempt", ['answers' => [$question->id => 'b']]);

        $this->assertSame(429, $over->status(), $over->getContent());
        $this->assertNull($over->json('data.score_percent'), 'a refused attempt must not grade anything');
    }

    public function test_control_an_ordinary_learner_attempt_is_graded(): void
    {
        $learner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        RateLimiter::clear('api:course_quiz_attempt:user:' . $learner->id);
        Sanctum::actingAs($learner);
        $quiz = $this->quizFor($learner);
        $question = CourseQuestion::where('quiz_id', $quiz->id)->firstOrFail();

        $response = $this->apiPost("/v2/courses/quizzes/{$quiz->id}/attempt", ['answers' => [$question->id => 'b']]);

        $this->assertSame(201, $response->status(), $response->getContent());
        $this->assertSame(100.0, (float) $response->json('data.score_percent'));
        $this->assertTrue((bool) $response->json('data.passed'));
    }
}
