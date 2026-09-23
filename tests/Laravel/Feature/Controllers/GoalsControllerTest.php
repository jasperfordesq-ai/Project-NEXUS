<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Goal;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for GoalsController — CRUD, progress, checkins, templates.
 */
class GoalsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createGoal(array $overrides = []): Goal
    {
        return Goal::factory()->forTenant($this->testTenantId)->create($overrides);
    }

    // ------------------------------------------------------------------
    //  INDEX
    // ------------------------------------------------------------------

    public function test_index_returns_goals(): void
    {
        $user = $this->authenticatedUser();
        $this->createGoal(['user_id' => $user->id, 'is_public' => true]);

        $response = $this->apiGet('/v2/goals');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/goals');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  SHOW
    // ------------------------------------------------------------------

    public function test_show_returns_goal(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id, 'is_public' => true]);

        $response = $this->apiGet("/v2/goals/{$goal->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
        $response->assertJsonPath('data.is_owner', true);
    }

    public function test_show_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/goals/999999');

        $response->assertStatus(404);
    }

    public function test_show_private_goal_forbidden_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id, 'is_public' => false]);
        $this->authenticatedUser();

        $response = $this->apiGet("/v2/goals/{$goal->id}");

        $response->assertStatus(403);
    }

    public function test_show_public_goal_visible_to_others(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id, 'is_public' => true]);
        $this->authenticatedUser();

        $response = $this->apiGet("/v2/goals/{$goal->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.is_owner', false);
    }

    // ------------------------------------------------------------------
    //  CREATE
    // ------------------------------------------------------------------

    public function test_can_create_goal(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/goals', [
            'title' => 'Learn to Garden',
            'description' => 'Start a vegetable garden in the community plot.',
            'is_public' => true,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonPath('data.is_owner', true);
    }

    public function test_goal_creation_replay_returns_the_same_goal_without_duplicate_rows(): void
    {
        $user = $this->authenticatedUser();
        $payload = ['title' => 'One durable goal', 'description' => 'Created once after a lost response.'];
        $headers = ['Idempotency-Key' => 'goal-create-operation-123'];

        $first = $this->apiPost('/v2/goals', $payload, $headers);
        $replay = $this->apiPost('/v2/goals', $payload, $headers);

        $first->assertCreated();
        $replay->assertOk();
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('goals')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->where('title', 'One durable goal')->count());
        $this->assertSame(1, DB::table('goal_creation_receipts')->where('tenant_id', $this->testTenantId)
            ->where('actor_user_id', $user->id)->where('operation_type', 'goal')->count());

        $this->apiPost('/v2/goals', ['title' => 'Changed intent'], $headers)->assertStatus(409);
    }

    public function test_create_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/goals', [
            'title' => 'Unauthorized Goal',
        ]);

        $response->assertStatus(401);
    }

    public function test_create_requires_title(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/goals', [
            'description' => 'No title provided.',
        ]);

        $response->assertStatus(400);
    }

    public function test_create_fails_with_empty_title(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/goals', [
            'title' => '   ',
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  UPDATE
    // ------------------------------------------------------------------

    public function test_owner_can_update_goal(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id]);

        $response = $this->apiPut("/v2/goals/{$goal->id}", [
            'title' => 'Updated Goal Title',
        ]);

        $response->assertStatus(200);
    }

    public function test_non_owner_cannot_update_goal(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id]);
        $this->authenticatedUser();

        $response = $this->apiPut("/v2/goals/{$goal->id}", [
            'title' => 'Hijacked',
        ]);

        $response->assertStatus(404);
    }

    public function test_update_nonexistent_goal_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/goals/999999', [
            'title' => 'No such goal',
        ]);

        $response->assertStatus(404);
    }

    public function test_update_requires_authentication(): void
    {
        $goal = $this->createGoal();

        $response = $this->apiPut("/v2/goals/{$goal->id}", [
            'title' => 'Unauthorized',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE
    // ------------------------------------------------------------------

    public function test_owner_can_delete_goal(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id]);

        $response = $this->apiDelete("/v2/goals/{$goal->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_non_owner_cannot_delete_goal(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id]);
        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/goals/{$goal->id}");

        $response->assertStatus(404);
    }

    public function test_delete_nonexistent_goal_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/goals/999999');

        $response->assertStatus(404);
    }

    public function test_delete_requires_authentication(): void
    {
        $goal = $this->createGoal();

        $response = $this->apiDelete("/v2/goals/{$goal->id}");

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  PROGRESS
    // ------------------------------------------------------------------

    public function test_can_increment_progress(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id, 'status' => 'active']);

        $response = $this->apiPost("/v2/goals/{$goal->id}/progress", [
            'increment' => 10,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_progress_requires_increment(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id]);

        $response = $this->apiPost("/v2/goals/{$goal->id}/progress", []);

        $response->assertStatus(400);
    }

    public function test_progress_on_nonexistent_goal_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/goals/999999/progress', [
            'increment' => 10,
        ]);

        $response->assertStatus(404);
    }

    public function test_progress_requires_authentication(): void
    {
        $goal = $this->createGoal();

        $response = $this->apiPost("/v2/goals/{$goal->id}/progress", [
            'increment' => 10,
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  COMPLETE
    // ------------------------------------------------------------------

    public function test_can_complete_goal(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id, 'status' => 'active']);

        $response = $this->apiPost("/v2/goals/{$goal->id}/complete");

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_progress_desired_state_replay_does_not_apply_the_increment_twice(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal([
            'user_id' => $user->id,
            'status' => 'active',
            'current_value' => 4,
            'target_value' => 10,
        ]);
        $payload = ['increment' => 1.5, 'expected_current_value' => 4, 'desired_current_value' => 5.5];

        $first = $this->apiPost("/v2/goals/{$goal->id}/progress", $payload);
        $replay = $this->apiPost("/v2/goals/{$goal->id}/progress", $payload);

        $first->assertOk()->assertJsonPath('data.idempotent_replay', false);
        $replay->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertEqualsWithDelta(5.5, (float) $goal->fresh()->current_value, 0.000001);
        $this->assertSame(1, DB::table('goal_progress_history')->where('tenant_id', $this->testTenantId)
            ->where('goal_id', $goal->id)->where('event_type', 'progress_update')->count());

        $this->apiPost("/v2/goals/{$goal->id}/progress", [
            'increment' => 2,
            'expected_current_value' => 4,
            'desired_current_value' => 6,
        ])->assertStatus(409);
        $this->assertEqualsWithDelta(5.5, (float) $goal->fresh()->current_value, 0.000001);
    }

    public function test_complete_goal_replay_does_not_repeat_history_xp_or_notifications(): void
    {
        $user = $this->authenticatedUser(['xp' => 0]);
        $goal = $this->createGoal([
            'user_id' => $user->id,
            'status' => 'active',
            'current_value' => 0,
            'target_value' => 10,
        ]);

        $first = $this->apiPost("/v2/goals/{$goal->id}/complete");
        $replay = $this->apiPost("/v2/goals/{$goal->id}/complete");

        $first->assertOk()->assertJsonPath('data.idempotent_replay', false);
        $replay->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertSame(1, DB::table('goal_progress_history')
            ->where('tenant_id', $this->testTenantId)
            ->where('goal_id', $goal->id)
            ->where('event_type', 'completed')
            ->count());
        $this->assertSame(1, DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('action', 'complete_goal')
            ->where('source_reference', 'goal:' . $goal->id)
            ->count());
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('type', 'goal_completed')
            ->count());
    }

    public function test_generic_completed_update_uses_the_canonical_completion_transition(): void
    {
        $user = $this->authenticatedUser(['xp' => 0]);
        $goal = $this->createGoal(['user_id' => $user->id, 'status' => 'active']);

        $this->apiPut("/v2/goals/{$goal->id}", ['status' => 'completed'])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed');

        $this->assertSame(1, DB::table('goal_progress_history')
            ->where('goal_id', $goal->id)
            ->where('event_type', 'completed')
            ->count());
        $this->assertSame(1, DB::table('user_xp_log')
            ->where('user_id', $user->id)
            ->where('source_reference', 'goal:' . $goal->id)
            ->count());
    }

    public function test_complete_nonexistent_goal_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/goals/999999/complete');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  DISCOVER
    // ------------------------------------------------------------------

    public function test_discover_returns_public_goals(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/goals/discover');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_discover_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/goals/discover');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  MENTORING
    // ------------------------------------------------------------------

    public function test_mentoring_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/goals/mentoring');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_becoming_a_buddy_returns_only_public_goal_participant_fields(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $buddy = $this->authenticatedUser();
        DB::table('users')->whereIn('id', [$owner->id, $buddy->id])->update([
            'phone' => '+353 87 222 2222',
            'date_of_birth' => '1982-03-04',
            'location' => 'Private goal address',
            'latitude' => 52.6638,
            'longitude' => -8.6267,
            'last_login_at' => now(),
            'privacy_profile' => 'connections',
            'privacy_search' => false,
            'stripe_customer_id' => 'cus_private_goal_buddy_test',
        ]);
        $goal = $this->createGoal([
            'user_id' => $owner->id,
            'mentor_id' => null,
            'is_public' => true,
            'status' => 'active',
        ]);

        $response = $this->apiPost("/v2/goals/{$goal->id}/buddy")
            ->assertOk()
            ->assertJsonPath('data.goal.user.id', $owner->id)
            ->assertJsonPath('data.goal.mentor.id', $buddy->id)
            ->assertJsonPath('data.goal.buddy_id', $buddy->id);

        foreach (['user', 'mentor'] as $participant) {
            foreach ([
                'email',
                'phone',
                'date_of_birth',
                'location',
                'latitude',
                'longitude',
                'last_login_at',
                'role',
                'privacy_profile',
                'privacy_search',
                'stripe_customer_id',
                'status',
            ] as $privateField) {
                $response->assertJsonMissingPath("data.goal.{$participant}.{$privateField}");
            }
        }
    }

    // ------------------------------------------------------------------
    //  CHECKINS
    // ------------------------------------------------------------------

    public function test_create_checkin_on_own_goal(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal([
            'user_id' => $user->id,
            'target_value' => 100,
            'current_value' => 10,
        ]);

        $response = $this->apiPost("/v2/goals/{$goal->id}/checkins", [
            'progress_percent' => 50,
            'note' => 'Making progress!',
            'mood' => 'motivated',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonPath('data.progress_percent', 50);

        $this->assertDatabaseHas('goal_checkins', [
            'goal_id' => $goal->id,
            'user_id' => $user->id,
            'tenant_id' => $this->testTenantId,
            'note' => 'Making progress!',
            'mood' => 'motivated',
        ]);
        $this->assertDatabaseHas('goals', [
            'id' => $goal->id,
            'tenant_id' => $this->testTenantId,
            'current_value' => 50,
        ]);
        $this->assertDatabaseHas('goal_progress_history', [
            'goal_id' => $goal->id,
            'tenant_id' => $this->testTenantId,
            'event_type' => 'checkin',
        ]);

        $history = $this->apiGet("/v2/goals/{$goal->id}/history");
        $history->assertStatus(200);
        $history->assertJsonFragment(['description' => 'Check-in recorded at 50%']);
    }

    public function test_create_checkin_on_other_goal_returns_404(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id]);
        $this->authenticatedUser();

        $response = $this->apiPost("/v2/goals/{$goal->id}/checkins", [
            'progress_percent' => 50,
        ]);

        $response->assertStatus(404);
    }

    public function test_list_checkins_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal(['user_id' => $user->id]);

        $response = $this->apiGet("/v2/goals/{$goal->id}/checkins");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_insights_resolves_seeded_milestone_labels(): void
    {
        $user = $this->authenticatedUser();
        $goal = $this->createGoal([
            'user_id' => $user->id,
            'target_value' => 100,
            'current_value' => 0,
        ]);

        $this->apiPost("/v2/goals/{$goal->id}/checkins", [
            'progress_percent' => 25,
        ])->assertStatus(201);

        $response = $this->apiGet("/v2/goals/{$goal->id}/insights");

        $response->assertStatus(200);
        $response->assertJsonFragment(['title' => 'First quarter']);
        $response->assertJsonMissing(['title' => 'api_controllers_3.goals.milestone_quarter']);
    }

    public function test_list_private_goal_checkins_forbidden_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id, 'is_public' => false]);
        $this->authenticatedUser();

        $response = $this->apiGet("/v2/goals/{$goal->id}/checkins");

        $response->assertStatus(403);
    }

    public function test_private_goal_history_forbidden_for_non_owner(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $goal = $this->createGoal(['user_id' => $owner->id, 'is_public' => false]);
        $this->authenticatedUser();

        $this->apiGet("/v2/goals/{$goal->id}/history")->assertStatus(403);
        $this->apiGet("/v2/goals/{$goal->id}/history/summary")->assertStatus(403);
    }

    // ------------------------------------------------------------------
    //  TEMPLATES
    // ------------------------------------------------------------------

    public function test_templates_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/goals/templates');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_template_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/goals/templates/categories');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_template_goal_creation_replay_returns_the_same_goal(): void
    {
        $user = $this->authenticatedUser();
        $templateId = DB::table('goal_templates')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Durable template',
            'description' => 'Create this only once.',
            'default_target_value' => 8,
            'is_public' => true,
            'created_by' => $user->id,
            'created_at' => now(),
        ]);
        $headers = ['Idempotency-Key' => 'goal-template-operation-123'];

        $first = $this->apiPost("/v2/goals/from-template/{$templateId}", [], $headers);
        $replay = $this->apiPost("/v2/goals/from-template/{$templateId}", [], $headers);

        $first->assertCreated();
        $replay->assertOk();
        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, DB::table('goals')->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)->where('title', 'Durable template')->count());
    }

    public function test_missing_template_with_idempotency_key_still_returns_not_found(): void
    {
        $this->authenticatedUser();

        $this->apiPost('/v2/goals/from-template/999999', [], [
            'Idempotency-Key' => 'missing-template-operation-123',
        ])->assertNotFound();
    }

    public function test_create_template_requires_admin(): void
    {
        $this->authenticatedUser(); // Regular member

        $response = $this->apiPost('/v2/goals/templates', [
            'title' => 'Template Title',
        ]);

        $response->assertStatus(403);
    }

    public function test_admin_can_create_template(): void
    {
        $this->authenticatedUser(['role' => 'admin']);

        $response = $this->apiPost('/v2/goals/templates', [
            'title' => 'Admin Template',
            'description' => 'A template created by admin.',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_create_template_requires_title(): void
    {
        $this->authenticatedUser(['role' => 'admin']);

        $response = $this->apiPost('/v2/goals/templates', [
            'description' => 'No title provided.',
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_access_other_tenant_goal(): void
    {
        $this->authenticatedUser();
        $otherGoal = Goal::factory()->forTenant(999)->create(['is_public' => true]);

        $response = $this->apiGet("/v2/goals/{$otherGoal->id}");

        $response->assertStatus(404);
    }

    public function test_cannot_update_other_tenant_goal(): void
    {
        $this->authenticatedUser();
        $otherGoal = Goal::factory()->forTenant(999)->create();

        $response = $this->apiPut("/v2/goals/{$otherGoal->id}", [
            'title' => 'Cross-tenant update',
        ]);

        $response->assertStatus(404);
    }

    public function test_cannot_delete_other_tenant_goal(): void
    {
        $this->authenticatedUser();
        $otherGoal = Goal::factory()->forTenant(999)->create();

        $response = $this->apiDelete("/v2/goals/{$otherGoal->id}");

        $response->assertStatus(404);
    }
}
