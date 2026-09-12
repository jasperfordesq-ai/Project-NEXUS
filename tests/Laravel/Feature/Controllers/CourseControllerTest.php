<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\Course;
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

    public function test_browse_returns_403_when_feature_disabled(): void
    {
        $this->enableCourses(false);
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/courses');
        $this->assertSame(403, $response->status());
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
