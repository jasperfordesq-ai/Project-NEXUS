<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\MaxAttemptsExceededException;
use App\Models\CourseLesson;
use App\Http\Controllers\Api\Concerns\InteractsWithCourses;
use App\Models\CourseQuestion;
use App\Models\CourseQuiz;
use App\Services\CourseEnrollmentService;
use App\Services\CourseQuizService;
use Illuminate\Http\JsonResponse;

/**
 * CourseQuizController — quiz delivery/grading (learner) and quiz/question
 * authoring (instructor/admin). Phase 1 auto-grades objective questions.
 */
class CourseQuizController extends BaseApiController
{
    use InteractsWithCourses;

    protected bool $isV2Api = true;

    // ----- Learner -----

    /** GET /v2/courses/quizzes/{quizId} — learner view (no answers). */
    public function show(int $quizId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $quiz = CourseQuiz::find($quizId);
        if (!$quiz) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }
        $enrollment = CourseEnrollmentService::find($quiz->course_id, $userId);
        if (!$enrollment) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.not_enrolled'), null, 403);
        }
        if (!$this->quizLessonAvailable($quiz, $enrollment->enrolled_at)) {
            return $this->respondWithError('LESSON_LOCKED', __('api_controllers_2.courses.lesson_locked'), null, 403);
        }

        return $this->respondWithData(CourseQuizService::forLearner($quizId));
    }

    /** POST /v2/courses/quizzes/{quizId}/attempt — submit answers, auto-grade. */
    public function attempt(int $quizId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireAuth();

        $quiz = CourseQuiz::find($quizId);
        if (!$quiz) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        $enrollment = CourseEnrollmentService::find($quiz->course_id, $userId);
        if (!$enrollment) {
            return $this->respondWithError('NOT_ENROLLED', __('api_controllers_2.courses.not_enrolled'), null, 403);
        }
        if (!$this->quizLessonAvailable($quiz, $enrollment->enrolled_at)) {
            return $this->respondWithError('LESSON_LOCKED', __('api_controllers_2.courses.lesson_locked'), null, 403);
        }

        // max_attempts is enforced atomically inside submitAttempt (row-locked
        // transaction) so concurrent submissions can't race past the ceiling.
        $answers = (array) $this->input('answers', []);
        try {
            $result = CourseQuizService::submitAttempt($quizId, $userId, $answers, $enrollment->id);
        } catch (MaxAttemptsExceededException) {
            return $this->respondWithError('MAX_ATTEMPTS_REACHED', __('api_controllers_2.courses.max_attempts_reached'), null, 422);
        }

        return $this->respondWithData([
            'score_percent' => $result['score_percent'],
            'passed' => $result['passed'],
            'needs_review' => $result['needs_review'],
            'attempt_id' => $result['attempt']->id,
        ], null, 201);
    }

    // ----- Grading (instructor/admin) -----

    /** GET /v2/courses/{courseId}/grading — attempts pending instructor review. */
    public function gradingQueue(int $courseId): JsonResponse
    {
        $this->guardCourse($courseId);

        return $this->respondWithData(CourseQuizService::pendingReviewForCourse($courseId));
    }

    /** POST /v2/courses/attempts/{attemptId}/grade — grade a pending attempt. */
    public function gradeAttempt(int $attemptId): JsonResponse
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireCourseAuthor();

        $courseId = CourseQuizService::courseIdForAttempt($attemptId);
        if (!$courseId) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }
        // Authorise against the owning course.
        $course = $this->findCourseOrFail($courseId);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        $validated = request()->validate([
            'score_percent' => 'required|numeric|between:0,100',
            'feedback' => 'nullable|string',
        ]);
        $score = (float) $validated['score_percent'];
        $passed = $this->inputBool('passed', $score >= 50);
        $feedback = $this->input('feedback');

        $attempt = CourseQuizService::gradeAttempt($attemptId, $score, $passed, $feedback, $userId);
        if (!$attempt) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        return $this->respondWithData($attempt);
    }

    // ----- Authoring (instructor/admin) -----

    /** POST /v2/courses/{courseId}/quizzes */
    public function storeQuiz(int $courseId): JsonResponse
    {
        $this->guardCourse($courseId);

        $lessonId = $this->inputInt('lesson_id', null, 1);
        if ($lessonId !== null && !CourseLesson::where('id', $lessonId)->where('course_id', $courseId)->exists()) {
            return $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404);
        }

        $quiz = CourseQuiz::create([
            'course_id' => $courseId,
            'lesson_id' => $lessonId,
            'title' => trim((string) $this->input('title', '')),
            'description' => $this->input('description'),
            'pass_mark_percent' => $this->inputInt('pass_mark_percent', 70, 0, 100),
            'max_attempts' => $this->inputInt('max_attempts', 0, 0),
            'time_limit_minutes' => $this->inputInt('time_limit_minutes', null, 0),
            'shuffle_questions' => $this->inputBool('shuffle_questions', false),
        ]);

        return $this->respondWithData($quiz, null, 201);
    }

    /** POST /v2/courses/{courseId}/quizzes/{quizId}/questions */
    public function storeQuestion(int $courseId, int $quizId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureQuizInCourse($quizId, $courseId);

        $question = CourseQuestion::create([
            'quiz_id' => $quizId,
            'type' => $this->input('type', 'mcq'),
            'prompt' => (string) $this->input('prompt', ''),
            'options' => $this->input('options'),
            'correct' => $this->input('correct'),
            'explanation' => $this->input('explanation'),
            'points' => $this->inputInt('points', 1, 1),
            'position' => $this->inputInt('position', 0, 0),
        ]);

        return $this->respondWithData($question, null, 201);
    }

    /** DELETE /v2/courses/{courseId}/quizzes/{quizId}/questions/{questionId} */
    public function deleteQuestion(int $courseId, int $quizId, int $questionId): JsonResponse
    {
        $this->guardCourse($courseId);
        $this->ensureQuizInCourse($quizId, $courseId);

        // Scoped to the quiz, which is scoped to the guarded course — so a
        // question from another community could never be removed. But the
        // delete count was discarded and the response said `deleted: true`
        // regardless, which confirmed a foreign question id exists.
        // (CrossCommunityAccessSweepTest foreign-child sweep, 2026-09-10.)
        $deleted = CourseQuestion::where('id', $questionId)->where('quiz_id', $quizId)->delete();

        if ($deleted === 0) {
            return $this->respondWithError('NOT_FOUND', __('api.not_found', ['model' => 'Question']), null, 404);
        }

        return $this->respondWithData(['deleted' => true]);
    }

    // ----- Guards -----

    private function guardCourse(int $courseId): int
    {
        $this->ensureCoursesFeature();
        $userId = $this->requireInstructorOrAdmin();
        $course = $this->findCourseOrFail($courseId);
        $this->ensureCourseOwnerOrAdmin($course, $userId);

        return $userId;
    }

    private function ensureQuizInCourse(int $quizId, int $courseId): void
    {
        if (!CourseQuiz::where('id', $quizId)->where('course_id', $courseId)->exists()) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->respondWithError('RESOURCE_NOT_FOUND', __('api_controllers_2.courses.not_found'), null, 404)
            );
        }
    }

    private function quizLessonAvailable(CourseQuiz $quiz, $enrolledAt): bool
    {
        if (!$quiz->lesson_id) {
            return true;
        }

        $lesson = CourseLesson::where('id', $quiz->lesson_id)
            ->where('course_id', $quiz->course_id)
            ->first();
        if (!$lesson) {
            return true;
        }

        return (bool) \App\Services\CourseLessonService::availability($lesson, $enrolledAt)['available'];
    }
}
