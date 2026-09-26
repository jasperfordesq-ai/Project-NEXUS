<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\Goal;
use App\Models\User;
use App\Services\GoalService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Mockery;
use Tests\Laravel\TestCase;

class GoalServiceTest extends TestCase
{
    use DatabaseTransactions;

    // GoalService uses Eloquent Goal model with HasTenantScope
    public function test_getAll_requires_integration_test(): void
    {
        $this->markTestIncomplete('Requires integration test with Goal model and HasTenantScope');
    }

    public function test_getPublicForBuddy_requires_integration_test(): void
    {
        $this->markTestIncomplete('Requires integration test with Goal model');
    }

    public function test_offerBuddy_denial_leaves_goal_unassigned(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $buddy = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'mentor_id' => null,
            'is_public' => true,
            'status' => 'active',
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with((int) $buddy->id, (int) $owner->id, $this->testTenantId, 'goal_buddy')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            (new GoalService(new Goal()))->offerBuddy((int) $goal->id, (int) $buddy->id);
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertNull($goal->fresh()?->mentor_id);
        // F-004 (E-038): a refused offer must not leave a pending request behind.
        $this->assertDatabaseMissing('goal_buddy_requests', [
            'goal_id' => $goal->id,
            'requester_id' => $buddy->id,
        ]);
    }

    public function test_createBuddyNote_denial_writes_no_note(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $buddy = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);
        $goal = Goal::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $owner->id,
            'mentor_id' => $buddy->id,
            'is_public' => true,
            'status' => 'active',
        ]);

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with((int) $buddy->id, (int) $owner->id, $this->testTenantId, 'goal_buddy_note')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        try {
            (new GoalService(new Goal()))->createBuddyNote((int) $goal->id, (int) $buddy->id, [
                'type' => 'encouragement',
                'message' => 'Must not persist',
            ]);
            $this->fail('Expected safeguarding denial');
        } catch (SafeguardingPolicyException $e) {
            $this->assertSame('VETTING_REQUIRED', $e->reasonCode);
        }

        $this->assertDatabaseMissing('goal_buddy_notes', [
            'tenant_id' => $this->testTenantId,
            'goal_id' => $goal->id,
            'buddy_id' => $buddy->id,
            'message' => 'Must not persist',
        ]);
    }
}
