<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\MaxAttemptsExceededException;
use App\Services\CourseQuizService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * CourseQuizServiceTest
 *
 * Tests quiz delivery (forLearner), attempt counting (attemptsUsed),
 * auto-grading with pass/fail thresholds, multi-select scoring,
 * subjective (needs_review) deferral, max_attempts enforcement,
 * instructor grading, and courseIdForAttempt.
 *
 * All fixtures use a private high-range tenant (99400) to avoid collision
 * with real seeded data.  DatabaseTransactions rolls back after each test.
 */
class CourseQuizServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99400;

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenants')->insertOrIgnore([
            'id'                => self::TENANT_ID,
            'name'              => 'Quiz Test Tenant',
            'slug'              => 'test-99400',
            'is_active'         => true,
            'depth'             => 0,
            'allows_subtenants' => false,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);

        TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function insertUser(): int
    {
        $uid = uniqid('quiz', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Quiz User ' . $uid,
            'first_name' => 'Quiz',
            'last_name'  => 'User',
            'email'      => $uid . '@quiz.test',
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
        return DB::table('courses')->insertGetId([
            'tenant_id'        => self::TENANT_ID,
            'author_user_id'   => $authorId,
            'title'            => 'Quiz Course',
            'slug'             => 'quiz-course-' . uniqid(),
            'status'           => 'published',
            'moderation_status'=> 'approved',
            'level'            => 'beginner',
            'visibility'       => 'members',
            'enrollment_type'  => 'self_paced',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);
    }

    /**
     * Insert a quiz and return its ID.
     */
    private function insertQuiz(int $courseId, int $passMarkPercent = 70, int $maxAttempts = 0): int
    {
        return DB::table('course_quizzes')->insertGetId([
            'tenant_id'         => self::TENANT_ID,
            'course_id'         => $courseId,
            'title'             => 'Test Quiz',
            'pass_mark_percent' => $passMarkPercent,
            'max_attempts'      => $maxAttempts,
            'created_at'        => now(),
            'updated_at'        => now(),
        ]);
    }

    /**
     * Insert a question.  $correct is a JSON-encoded array of correct option IDs.
     */
    private function insertQuestion(
        int $quizId,
        string $type = 'mcq',
        array $options = ['A', 'B', 'C'],
        array $correct = ['A'],
        int $points = 1,
        int $position = 0
    ): int {
        return DB::table('course_questions')->insertGetId([
            'tenant_id' => self::TENANT_ID,
            'quiz_id'   => $quizId,
            'type'      => $type,
            'prompt'    => 'Question ' . uniqid(),
            'options'   => json_encode($options),
            'correct'   => json_encode($correct),
            'points'    => $points,
            'position'  => $position,
            'created_at'=> now(),
            'updated_at'=> now(),
        ]);
    }

    // ── forLearner ────────────────────────────────────────────────────────────

    public function test_forLearner_returns_null_for_nonexistent_quiz(): void
    {
        $result = CourseQuizService::forLearner(999999999);

        $this->assertNull($result);
    }

    public function test_forLearner_returns_quiz_metadata_without_correct_answers(): void
    {
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 80, 3);
        $this->insertQuestion($quizId, 'mcq', ['A', 'B'], ['A']);

        $result = CourseQuizService::forLearner($quizId);

        $this->assertIsArray($result);
        $this->assertSame($quizId, $result['id']);
        $this->assertSame($courseId, $result['course_id']);
        $this->assertSame(80, $result['pass_mark_percent']);
        $this->assertSame(3, $result['max_attempts']);
        $this->assertCount(1, $result['questions']);

        // Correct answers must NOT be exposed to learner.
        $q = $result['questions'][0];
        $this->assertArrayNotHasKey('correct', $q);
        $this->assertArrayNotHasKey('explanation', $q);
        $this->assertArrayHasKey('id', $q);
        $this->assertArrayHasKey('type', $q);
        $this->assertArrayHasKey('prompt', $q);
    }

    // ── attemptsUsed ─────────────────────────────────────────────────────────

    public function test_learner_result_refresh_is_scoped_and_exposes_only_the_grade(): void
    {
        $userId = $this->insertUser();
        $otherId = $this->insertUser();
        $quizId = $this->insertQuiz($this->insertCourse($otherId), 70, 0);
        $this->insertQuestion($quizId, 'essay', [], []);
        $submission = CourseQuizService::submitAttempt($quizId, $userId, []);
        CourseQuizService::submitAttempt($quizId, $otherId, []);
        $this->assertTrue(CourseQuizService::forLearner($quizId, $userId)['latest_attempt']['needs_review']);
        $this->assertNull(CourseQuizService::forLearner($quizId)['latest_attempt']);
        $submission['attempt']->update(['score_percent' => 85, 'passed' => true, 'grading_status' => 'graded']);
        $result = CourseQuizService::forLearner($quizId, $userId)['latest_attempt'];
        $this->assertSame(['attempt_id', 'score_percent', 'passed', 'needs_review'], array_keys($result));
        $this->assertSame($submission['attempt']->id, $result['attempt_id']);
        $this->assertSame(85.0, $result['score_percent']);
        $this->assertTrue($result['passed']);
        $this->assertFalse($result['needs_review']);
        $this->assertNull(CourseQuizService::forLearner($quizId, $userId)['attempts_remaining']);
        DB::table('course_quizzes')->where('id', $quizId)->update(['max_attempts' => 1]);
        $this->assertSame(0, CourseQuizService::forLearner($quizId, $userId)['attempts_remaining']);
        $this->assertSame(1, CourseQuizService::forLearner($quizId, $this->insertUser())['attempts_remaining']);
    }

    public function test_attemptsUsed_returns_zero_when_no_attempts_exist(): void
    {
        $count = CourseQuizService::attemptsUsed(999888777, 1);

        $this->assertSame(0, $count);
    }

    // ── submitAttempt — scoring and pass/fail ─────────────────────────────────

    public function test_keyed_retry_returns_original_attempt_before_enforcing_limit(): void
    {
        $userId = $this->insertUser();
        $quizId = $this->insertQuiz($this->insertCourse($this->insertUser()), 70, 1);
        $firstQuestion = $this->insertQuestion($quizId);
        $secondQuestion = $this->insertQuestion($quizId);
        $first = CourseQuizService::submitAttempt($quizId, $userId, [$firstQuestion => 'A', $secondQuestion => 'B'], null, 'quiz-retry-identity');
        $retry = CourseQuizService::submitAttempt($quizId, $userId, [$secondQuestion => 'B', $firstQuestion => 'A'], null, 'quiz-retry-identity');
        $this->assertSame($first['attempt']->id, $retry['attempt']->id);
        $this->assertSame((float) $first['score_percent'], (float) $retry['score_percent']);
        $this->assertSame(1, CourseQuizService::attemptsUsed($quizId, $userId));
    }

    public function test_keyed_retry_rejects_changed_answers_without_another_attempt(): void
    {
        $userId = $this->insertUser();
        $quizId = $this->insertQuiz($this->insertCourse($this->insertUser()));
        $question = $this->insertQuestion($quizId);
        CourseQuizService::submitAttempt($quizId, $userId, [$question => 'A'], null, 'quiz-conflict-identity');
        try {
            CourseQuizService::submitAttempt($quizId, $userId, [$question => 'B'], null, 'quiz-conflict-identity');
            $this->fail('Changed answers must not reuse a committed attempt identity');
        } catch (\InvalidArgumentException $exception) {
            $this->assertSame(1, CourseQuizService::attemptsUsed($quizId, $userId));
        }
    }

    public function test_new_identity_creates_a_deliberate_new_attempt(): void
    {
        $userId = $this->insertUser();
        $quizId = $this->insertQuiz($this->insertCourse($this->insertUser()));
        $question = $this->insertQuestion($quizId);
        $first = CourseQuizService::submitAttempt($quizId, $userId, [$question => 'A'], null, 'quiz-first-identity');
        $second = CourseQuizService::submitAttempt($quizId, $userId, [$question => 'A'], null, 'quiz-second-identity');
        $this->assertNotSame($first['attempt']->id, $second['attempt']->id);
        $this->assertSame(2, CourseQuizService::attemptsUsed($quizId, $userId));
    }

    public function test_replay_returns_current_grading_and_does_not_cross_learners(): void
    {
        $userId = $this->insertUser();
        $otherUserId = $this->insertUser();
        $quizId = $this->insertQuiz($this->insertCourse($this->insertUser()));
        $question = $this->insertQuestion($quizId, 'essay');
        $answers = [$question => 'An hour of help'];
        $first = CourseQuizService::submitAttempt($quizId, $userId, $answers, null, 'quiz-shared-client-key');
        $other = CourseQuizService::submitAttempt($quizId, $otherUserId, $answers, null, 'quiz-shared-client-key');
        $this->assertNotSame($first['attempt']->id, $other['attempt']->id);
        $first['attempt']->update(['grading_status' => 'graded', 'score_percent' => 90, 'passed' => true]);
        $retry = CourseQuizService::submitAttempt($quizId, $userId, $answers, null, 'quiz-shared-client-key');
        $this->assertSame($first['attempt']->id, $retry['attempt']->id);
        $this->assertSame(90.0, $retry['score_percent']);
        $this->assertTrue($retry['passed']);
        $this->assertFalse($retry['needs_review']);
        $this->assertArrayNotHasKey('idempotency_key_hash', $retry['attempt']->toArray());
    }

    public function test_submitAttempt_scores_100_percent_when_all_answers_correct(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70);
        $q1       = $this->insertQuestion($quizId, 'mcq',       ['A','B','C'], ['A'], 1);
        $q2       = $this->insertQuestion($quizId, 'truefalse', ['true','false'], ['true'], 1);

        $result = CourseQuizService::submitAttempt($quizId, $userId, [
            $q1 => 'A',
            $q2 => 'true',
        ]);

        $this->assertSame(100.0, (float) $result['score_percent']);
        $this->assertTrue($result['passed']);
        $this->assertFalse($result['needs_review']);
    }

    public function test_submitAttempt_scores_zero_when_all_answers_wrong(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70);
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B','C'], ['A'], 1);

        $result = CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'B']);

        $this->assertSame(0.0, (float) $result['score_percent']);
        $this->assertFalse($result['passed']);
    }

    public function test_submitAttempt_fails_when_score_is_below_pass_mark(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 80); // requires 80 %
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A'], 1);
        $q2       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A'], 1);

        // Only one of two correct → 50 % < 80 %
        $result = CourseQuizService::submitAttempt($quizId, $userId, [
            $q1 => 'A',
            $q2 => 'B', // wrong
        ]);

        $this->assertSame(50.0, (float) $result['score_percent']);
        $this->assertFalse($result['passed']);
    }

    public function test_submitAttempt_passes_when_score_equals_pass_mark(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 50); // 50 % threshold
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A'], 1);
        $q2       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A'], 1);

        $result = CourseQuizService::submitAttempt($quizId, $userId, [
            $q1 => 'A', // correct
            $q2 => 'B', // wrong  → 50 % == 50 % threshold → should pass
        ]);

        $this->assertSame(50.0, (float) $result['score_percent']);
        $this->assertTrue($result['passed']);
    }

    public function test_submitAttempt_handles_multi_select_question_order_independent(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70);
        // Correct is ['B','C']; learner answers in reverse order
        $q1 = $this->insertQuestion($quizId, 'multi', ['A','B','C'], ['B','C'], 2);

        $result = CourseQuizService::submitAttempt($quizId, $userId, [$q1 => ['C','B']]);

        $this->assertSame(100.0, (float) $result['score_percent']);
        $this->assertTrue($result['passed']);
    }

    public function test_submitAttempt_creates_attempt_row_in_database(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId);
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A'], 1);

        $result = CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'A']);

        $attemptId = $result['attempt']->id;
        $this->assertNotNull($attemptId);

        $row = DB::table('course_quiz_attempts')->where('id', $attemptId)->first();
        $this->assertNotNull($row);
        $this->assertEquals($quizId, $row->quiz_id);
        $this->assertEquals($userId, $row->user_id);
        $this->assertEquals('auto', $row->grading_status);
    }

    // ── Subjective questions — pending_review ─────────────────────────────────

    public function test_submitAttempt_sets_needs_review_true_for_essay_question(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70);
        $this->insertQuestion($quizId, 'essay', [], [], 5);

        $result = CourseQuizService::submitAttempt($quizId, $userId, []);

        $this->assertTrue($result['needs_review']);
        $this->assertFalse($result['passed']); // pending_review → not passed
        $this->assertSame('pending_review', $result['attempt']->grading_status);
    }

    // ── Max-attempts enforcement ──────────────────────────────────────────────

    public function test_submitAttempt_throws_when_max_attempts_exceeded(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70, 1); // max 1 attempt
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A']);

        // First attempt must succeed.
        CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'A']);

        // Second attempt must throw.
        $this->expectException(MaxAttemptsExceededException::class);
        CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'A']);
    }

    public function test_attemptsUsed_increments_after_each_submission(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId, 70, 0); // unlimited
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A','B'], ['A']);

        $this->assertSame(0, CourseQuizService::attemptsUsed($quizId, $userId));

        CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'A']);
        $this->assertSame(1, CourseQuizService::attemptsUsed($quizId, $userId));

        CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'B']);
        $this->assertSame(2, CourseQuizService::attemptsUsed($quizId, $userId));
    }

    // ── Instructor grading ────────────────────────────────────────────────────

    public function test_gradeAttempt_updates_score_and_status(): void
    {
        $userId     = $this->insertUser();
        $instructorId = $this->insertUser();
        $authorId   = $this->insertUser();
        $courseId   = $this->insertCourse($authorId);
        $quizId     = $this->insertQuiz($courseId, 70);
        $this->insertQuestion($quizId, 'short', [], [], 5);

        $submitResult = CourseQuizService::submitAttempt($quizId, $userId, []);
        $attemptId    = $submitResult['attempt']->id;

        $graded = CourseQuizService::gradeAttempt($attemptId, 85.0, true, 'Good work!', $instructorId);

        $this->assertNotNull($graded);
        $this->assertSame('85.00', $graded->score_percent); // decimal:2 cast
        $this->assertTrue($graded->passed);
        $this->assertSame('graded', $graded->grading_status);
        $this->assertSame('Good work!', $graded->feedback);
        $this->assertEquals($instructorId, $graded->graded_by);
    }

    public function test_gradeAttempt_returns_null_for_nonexistent_attempt(): void
    {
        $result = CourseQuizService::gradeAttempt(999999999, 90.0, true, null, 1);

        $this->assertNull($result);
    }

    // ── courseIdForAttempt ───────────────────────────────────────────────────

    public function test_courseIdForAttempt_returns_correct_course_id(): void
    {
        $userId   = $this->insertUser();
        $authorId = $this->insertUser();
        $courseId = $this->insertCourse($authorId);
        $quizId   = $this->insertQuiz($courseId);
        $q1       = $this->insertQuestion($quizId, 'mcq', ['A'], ['A']);

        $attempt = CourseQuizService::submitAttempt($quizId, $userId, [$q1 => 'A']);
        $attemptId = $attempt['attempt']->id;

        $resolvedCourseId = CourseQuizService::courseIdForAttempt($attemptId);

        $this->assertSame($courseId, $resolvedCourseId);
    }

    public function test_courseIdForAttempt_returns_null_for_nonexistent_attempt(): void
    {
        $result = CourseQuizService::courseIdForAttempt(999999999);

        $this->assertNull($result);
    }
}
