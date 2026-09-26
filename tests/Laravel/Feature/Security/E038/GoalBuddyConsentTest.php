<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E038;

use App\Core\TenantContext;
use App\Models\Goal;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-004 (E-003, owner decision 26 Sep 2026, fixed in E-038): any member could
 * appoint themselves "buddy" of another member's public goal with one POST —
 * mentor_id was set immediately, the owner was only told afterwards, and the
 * self-appointed buddy could then send the owner notes.
 *
 * Decision: an offer is a pending request. Nothing changes on the goal until
 * the goal owner accepts; the owner may also decline. Only the owner can see,
 * accept or decline the requests on their goal.
 */
class GoalBuddyConsentTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private Goal $goal;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->owner = $this->member();
        $this->goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->owner->id,
            'mentor_id' => null,
            'is_public' => true,
            'status' => 'active',
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function actingAsUser(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function offer(User $buddy): \Illuminate\Testing\TestResponse
    {
        $this->actingAsUser($buddy);

        return $this->apiPost("/v2/goals/{$this->goal->id}/buddy");
    }

    private function pendingRequestId(User $buddy): int
    {
        return (int) DB::table('goal_buddy_requests')
            ->where('goal_id', $this->goal->id)
            ->where('requester_id', $buddy->id)
            ->where('status', 'pending')
            ->value('id');
    }

    private function mentorId(): ?int
    {
        $value = DB::table('goals')->where('id', $this->goal->id)->value('mentor_id');

        return $value === null ? null : (int) $value;
    }

    private function buddyJoinedEvents(): int
    {
        return DB::table('goal_progress_history')
            ->where('goal_id', $this->goal->id)
            ->where('event_type', 'buddy_joined')
            ->count();
    }

    public function test_an_offer_does_not_make_the_caller_buddy_until_the_owner_accepts(): void
    {
        $buddy = $this->member();

        $this->offer($buddy)
            ->assertOk()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.goal.buddy_id', null)
            ->assertJsonPath('data.goal.buddy_request_pending', true);

        $this->assertNull($this->mentorId(), 'an offer must not assign the buddy');
        $this->assertSame(0, $this->buddyJoinedEvents());
        $this->assertGreaterThan(0, $this->pendingRequestId($buddy));

        // A pending buddy cannot yet send the owner notes.
        $this->apiPost("/v2/goals/{$this->goal->id}/buddy/nudge", ['type' => 'nudge'])->assertStatus(403);
    }

    public function test_a_repeated_offer_while_pending_creates_no_second_request(): void
    {
        $buddy = $this->member();
        $this->offer($buddy)->assertOk();
        $this->offer($buddy)->assertStatus(409);

        $this->assertSame(1, DB::table('goal_buddy_requests')->where('goal_id', $this->goal->id)->count());
    }

    public function test_only_the_owner_can_list_accept_or_decline_requests(): void
    {
        $buddy = $this->member();
        $this->offer($buddy)->assertOk();
        $requestId = $this->pendingRequestId($buddy);

        foreach ([$this->member(), $buddy] as $intruder) {
            $this->actingAsUser($intruder);
            $this->apiGet("/v2/goals/{$this->goal->id}/buddy-requests")->assertStatus(403);
            $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$requestId}/accept")->assertStatus(403);
            $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$requestId}/decline")->assertStatus(403);
        }

        $this->assertNull($this->mentorId());
        $this->assertSame('pending', DB::table('goal_buddy_requests')->where('id', $requestId)->value('status'));
    }

    public function test_owner_sees_pending_requests_with_public_identity_only(): void
    {
        $buddy = $this->member();
        DB::table('users')->where('id', $buddy->id)->update(['phone' => '+1 555 010 0000']);
        $this->offer($buddy)->assertOk();

        $this->actingAsUser($this->owner);
        $response = $this->apiGet("/v2/goals/{$this->goal->id}/buddy-requests")
            ->assertOk()
            ->assertJsonPath('data.0.requester.id', $buddy->id)
            ->assertJsonPath('data.0.status', 'pending');

        foreach (['email', 'phone', 'date_of_birth', 'latitude', 'longitude', 'role'] as $privateField) {
            $response->assertJsonMissingPath("data.0.requester.{$privateField}");
        }
    }

    public function test_owner_accepting_assigns_the_buddy_and_closes_competing_offers(): void
    {
        $chosen = $this->member();
        $other = $this->member();
        $this->offer($chosen)->assertOk();
        $this->offer($other)->assertOk();
        $chosenRequest = $this->pendingRequestId($chosen);
        $otherRequest = $this->pendingRequestId($other);

        $this->actingAsUser($this->owner);
        $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$chosenRequest}/accept")
            ->assertOk()
            ->assertJsonPath('data.goal.buddy_id', $chosen->id)
            ->assertJsonPath('data.goal.mentor.id', $chosen->id);

        $this->assertSame((int) $chosen->id, $this->mentorId());
        $this->assertSame(1, $this->buddyJoinedEvents());
        $this->assertSame('accepted', DB::table('goal_buddy_requests')->where('id', $chosenRequest)->value('status'));
        $this->assertNotSame('pending', DB::table('goal_buddy_requests')->where('id', $otherRequest)->value('status'));

        // The competing offer can no longer be accepted.
        $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$otherRequest}/accept")->assertStatus(409);
        $this->assertSame((int) $chosen->id, $this->mentorId());
    }

    public function test_owner_declining_leaves_the_goal_unassigned_and_blocks_a_repeat_offer(): void
    {
        $buddy = $this->member();
        $this->offer($buddy)->assertOk();
        $requestId = $this->pendingRequestId($buddy);

        $this->actingAsUser($this->owner);
        $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$requestId}/decline")->assertOk();

        $this->assertNull($this->mentorId());
        $this->assertSame('declined', DB::table('goal_buddy_requests')->where('id', $requestId)->value('status'));

        // A declined member cannot keep re-offering (and re-notifying the owner).
        $this->offer($buddy)->assertStatus(409);
        $this->assertSame(1, DB::table('goal_buddy_requests')->where('goal_id', $this->goal->id)->count());
    }

    public function test_accept_consults_the_safeguarding_policy_and_a_refusal_assigns_nobody(): void
    {
        $buddy = $this->member();
        $this->offer($buddy)->assertOk();
        $requestId = $this->pendingRequestId($buddy);

        $policy = \Mockery::mock(\App\Services\SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with((int) $buddy->id, (int) $this->owner->id, $this->testTenantId, 'goal_buddy')
            ->andThrow(new \App\Exceptions\SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(\App\Services\SafeguardingInteractionPolicy::class, $policy);

        $this->actingAsUser($this->owner);
        $response = $this->apiPost("/v2/goals/{$this->goal->id}/buddy-requests/{$requestId}/accept");
        $this->assertGreaterThanOrEqual(400, $response->status());

        $this->assertNull($this->mentorId());
        $this->assertSame('pending', DB::table('goal_buddy_requests')->where('id', $requestId)->value('status'));
    }

    public function test_a_request_id_from_another_goal_is_refused(): void
    {
        $buddy = $this->member();
        $this->offer($buddy)->assertOk();
        $requestId = $this->pendingRequestId($buddy);

        $ownersOtherGoal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $this->owner->id,
            'mentor_id' => null,
            'is_public' => true,
            'status' => 'active',
        ]);

        $this->actingAsUser($this->owner);
        $this->apiPost("/v2/goals/{$ownersOtherGoal->id}/buddy-requests/{$requestId}/accept")->assertStatus(404);
        $this->assertNull(DB::table('goals')->where('id', $ownersOtherGoal->id)->value('mentor_id'));
        $this->assertNull($this->mentorId());
    }
}
