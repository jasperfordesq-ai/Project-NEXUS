<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for GroupsController — CRUD, join, leave, members, discussions.
 */
class GroupsControllerTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Defensively reset auth + tenant state leaked by earlier tests in the full suite.
     *
     * Hypothesis for the polluted failure of test_members_returns_list:
     * GroupsController::members() takes a private-group branch (the Group factory's default
     * visibility is randomly public/private) that resolves the viewer via
     * BaseApiController::resolveSanctumUserOptionally() — which probes Auth::guard('sanctum')->user().
     * A stale Sanctum actingAs() user leaked from a prior test resolves as the "viewer" instead of
     * the group owner the test just authenticated, so the membership check fails and the endpoint
     * returns 403 ("must be a member to view members of a private group") instead of 200.
     *
     * forgetGuards() drops the leaked guard user so each test's Sanctum::actingAs() binds the
     * correct viewer, exactly as it does when this file runs on its own.
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createGroup(array $overrides = []): Group
    {
        return Group::factory()->forTenant($this->testTenantId)->create($overrides);
    }

    // ------------------------------------------------------------------
    //  INDEX
    // ------------------------------------------------------------------

    public function test_index_returns_groups(): void
    {
        $this->authenticatedUser();
        $this->createGroup(['visibility' => 'public']);
        $this->createGroup(['visibility' => 'public']);

        $response = $this->apiGet('/v2/groups');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_requires_authentication(): void
    {
        $this->createGroup(['visibility' => 'public']);

        $response = $this->apiGet('/v2/groups');

        $response->assertStatus(401);
    }

    public function test_index_is_tenant_scoped(): void
    {
        $this->authenticatedUser();
        $this->createGroup(['visibility' => 'public']);
        Group::factory()->forTenant(999)->create(['visibility' => 'public']);

        $response = $this->apiGet('/v2/groups');

        $response->assertStatus(200);
        $data = $response->json('data');
        $this->assertIsArray($data);
    }

    // ------------------------------------------------------------------
    //  SHOW
    // ------------------------------------------------------------------

    public function test_show_returns_group(): void
    {
        $this->authenticatedUser();
        $group = $this->createGroup(['visibility' => 'public']);

        $response = $this->apiGet("/v2/groups/{$group->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_returns_404_for_nonexistent_group(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/groups/999999');

        $response->assertStatus(404);
    }

    public function test_show_returns_404_for_other_tenant_group(): void
    {
        $this->authenticatedUser();
        $otherGroup = Group::factory()->forTenant(999)->create();

        $response = $this->apiGet("/v2/groups/{$otherGroup->id}");

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  CREATE
    // ------------------------------------------------------------------

    public function test_authenticated_user_can_create_group(): void
    {
        Event::fake([\App\Events\GroupCreated::class]);
        $this->authenticatedUser(['email' => 'group-create@partner-demo.test']);

        $response = $this->apiPost('/v2/groups', [
            'name' => 'Test Group',
            'description' => 'A test group for unit testing.',
            'visibility' => 'public',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    public function test_create_group_replays_the_same_result_after_a_lost_response(): void
    {
        Event::fake([\App\Events\GroupCreated::class]);
        $user = $this->authenticatedUser(['email' => 'group-replay@partner-demo.test']);
        $payload = [
            'name' => 'Response loss repair group',
            'description' => 'A complete group description used to verify one durable creation result.',
            'visibility' => 'public',
            'idempotency_key' => 'mobile-group-create-response-loss-1',
        ];
        $headers = ['Idempotency-Key' => $payload['idempotency_key']];

        $first = $this->apiPost('/v2/groups', $payload, $headers)->assertCreated();
        $second = $this->apiPost('/v2/groups', $payload, $headers)->assertCreated();

        $this->assertSame($first->json('data.id'), $second->json('data.id'));
        $this->assertSame(1, Group::query()->where('owner_id', $user->id)->where('name', $payload['name'])->count());
        $this->assertSame(1, DB::table('group_content_creation_receipts')
            ->where('tenant_id', $this->testTenantId)
            ->where('actor_user_id', $user->id)
            ->where('operation_type', 'group')
            ->count());
        $this->assertSame(1, DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('action', 'create_group')
            ->count());
    }

    public function test_create_group_rejects_reusing_a_key_for_changed_content(): void
    {
        Event::fake([\App\Events\GroupCreated::class]);
        $user = $this->authenticatedUser(['email' => 'group-conflict@partner-demo.test']);
        $payload = [
            'name' => 'Original repair group',
            'description' => 'The original group creation request has stable content for replay.',
            'visibility' => 'public',
            'idempotency_key' => 'mobile-group-create-content-conflict-1',
        ];
        $headers = ['Idempotency-Key' => $payload['idempotency_key']];

        $this->apiPost('/v2/groups', $payload, $headers)->assertCreated();
        $this->apiPost('/v2/groups', [...$payload, 'name' => 'Changed repair group'], $headers)
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'IDEMPOTENCY_CONFLICT');

        $this->assertSame(1, Group::query()->where('owner_id', $user->id)
            ->whereIn('name', ['Original repair group', 'Changed repair group'])->count());
    }

    public function test_unauthenticated_user_cannot_create_group(): void
    {
        $response = $this->apiPost('/v2/groups', [
            'name' => 'Unauthorized Group',
            'description' => 'Should fail.',
        ]);

        $response->assertStatus(401);
    }

    public function test_create_group_fails_without_required_fields(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/groups', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ------------------------------------------------------------------
    //  UPDATE
    // ------------------------------------------------------------------

    public function test_owner_can_update_group(): void
    {
        $user = $this->authenticatedUser();
        $group = $this->createGroup(['owner_id' => $user->id]);

        $response = $this->apiPut("/v2/groups/{$group->id}", [
            'name' => 'Updated Group Name',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_non_owner_cannot_update_group(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = $this->createGroup(['owner_id' => $owner->id]);
        $this->authenticatedUser();

        $response = $this->apiPut("/v2/groups/{$group->id}", [
            'name' => 'Hijacked Name',
        ]);

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    public function test_update_nonexistent_group_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/groups/999999', [
            'name' => 'No such group',
        ]);

        $response->assertStatus(404);
    }

    public function test_unauthenticated_user_cannot_update_group(): void
    {
        $group = $this->createGroup();

        $response = $this->apiPut("/v2/groups/{$group->id}", [
            'name' => 'Unauthorized',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE
    // ------------------------------------------------------------------

    public function test_owner_can_delete_group(): void
    {
        $user = $this->authenticatedUser();
        $group = $this->createGroup(['owner_id' => $user->id]);

        $response = $this->apiDelete("/v2/groups/{$group->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_non_owner_cannot_delete_group(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = $this->createGroup(['owner_id' => $owner->id]);
        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/groups/{$group->id}");

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    public function test_delete_nonexistent_group_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/groups/999999');

        $response->assertStatus(404);
    }

    public function test_unauthenticated_user_cannot_delete_group(): void
    {
        $group = $this->createGroup();

        $response = $this->apiDelete("/v2/groups/{$group->id}");

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  JOIN
    // ------------------------------------------------------------------

    public function test_user_can_join_public_group(): void
    {
        $user = $this->authenticatedUser();
        $group = $this->createGroup(['visibility' => 'public']);

        $response = $this->apiPost("/v2/groups/{$group->id}/join");

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data' => ['status']]);
    }

    public function test_unauthenticated_user_cannot_join_group(): void
    {
        $group = $this->createGroup(['visibility' => 'public']);

        $response = $this->apiPost("/v2/groups/{$group->id}/join");

        $response->assertStatus(401);
    }

    public function test_join_nonexistent_group_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/groups/999999/join');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  LEAVE
    // ------------------------------------------------------------------

    public function test_unauthenticated_user_cannot_leave_group(): void
    {
        $group = $this->createGroup();

        $response = $this->apiDelete("/v2/groups/{$group->id}/membership");

        $response->assertStatus(401);
    }

    public function test_leave_nonexistent_group_returns_error(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/groups/999999/membership');

        $this->assertContains($response->getStatusCode(), [400, 404, 409]);
    }

    // ------------------------------------------------------------------
    //  MEMBERS
    // ------------------------------------------------------------------

    public function test_members_returns_list(): void
    {
        $user = $this->authenticatedUser();
        // Pin visibility: the factory randomises public/private, and a private
        // group 403s for an owner with no group_members row (factory bypasses
        // the create flow that would add one) — the test was a coin flip.
        $group = $this->createGroup(['owner_id' => $user->id, 'visibility' => 'public']);

        $response = $this->apiGet("/v2/groups/{$group->id}/members");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_members_for_nonexistent_group_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/groups/999999/members');

        $response->assertStatus(404);
    }

    public function test_non_member_cannot_enumerate_public_group_roster(): void
    {
        $viewer = $this->authenticatedUser();
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $group = $this->createGroup([
            'owner_id' => $owner->id,
            'visibility' => 'public',
        ]);

        $this->assertNotSame($owner->id, $viewer->id);

        $this->apiGet("/v2/groups/{$group->id}/members")
            ->assertForbidden();
    }

    // ------------------------------------------------------------------
    //  UPDATE MEMBER ROLE
    // ------------------------------------------------------------------

    public function test_unauthenticated_user_cannot_update_member_role(): void
    {
        $group = $this->createGroup();

        $response = $this->apiPut("/v2/groups/{$group->id}/members/1", [
            'role' => 'admin',
        ]);

        $response->assertStatus(401);
    }

    public function test_update_member_role_requires_role_field(): void
    {
        $this->authenticatedUser();
        $group = $this->createGroup();

        $response = $this->apiPut("/v2/groups/{$group->id}/members/1", []);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  PENDING REQUESTS
    // ------------------------------------------------------------------

    public function test_unauthenticated_user_cannot_view_pending_requests(): void
    {
        $group = $this->createGroup();

        $response = $this->apiGet("/v2/groups/{$group->id}/requests");

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DISCUSSIONS
    // ------------------------------------------------------------------

    public function test_unauthenticated_user_cannot_view_discussions(): void
    {
        $group = $this->createGroup();

        $response = $this->apiGet("/v2/groups/{$group->id}/discussions");

        $response->assertStatus(401);
    }

    public function test_unauthenticated_user_cannot_create_discussion(): void
    {
        $group = $this->createGroup();

        $response = $this->apiPost("/v2/groups/{$group->id}/discussions", [
            'title' => 'Test Discussion',
            'content' => 'Some content.',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  ANNOUNCEMENTS
    // ------------------------------------------------------------------

    public function test_unauthenticated_user_cannot_view_announcements(): void
    {
        $group = $this->createGroup();

        $response = $this->apiGet("/v2/groups/{$group->id}/announcements");

        $response->assertStatus(401);
    }

    public function test_unauthenticated_user_cannot_create_announcement(): void
    {
        $group = $this->createGroup();

        $response = $this->apiPost("/v2/groups/{$group->id}/announcements", [
            'title' => 'Test Announcement',
            'body' => 'Announcement body.',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_access_other_tenant_group_via_join(): void
    {
        $this->authenticatedUser();
        $otherGroup = Group::factory()->forTenant(999)->create(['visibility' => 'public']);

        $response = $this->apiPost("/v2/groups/{$otherGroup->id}/join");

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }
}
