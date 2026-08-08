<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Safeguarding;

use App\Support\Safeguarding\SupportTiers;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The linked-account immutable trail (guardian redesign, phase 5a).
 *
 * account_relationships grants real power over another member's listings and
 * credits, and until now had NO event history at all — less audit rigor than
 * the record-only safeguarding_assignments table. Every lifecycle transition
 * now lands in account_relationship_events, append-only at the database
 * level, walked here through the real endpoints.
 */
class AccountRelationshipEventsTest extends TestCase
{
    use DatabaseTransactions;

    private function actingUser(array $attributes = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create($attributes + [
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function events(int $relationshipId): array
    {
        return DB::table('account_relationship_events')
            ->where('relationship_id', $relationshipId)
            ->orderBy('id')
            ->get()
            ->all();
    }

    public function test_the_full_lifecycle_leaves_a_complete_trail(): void
    {
        // Request …
        $parent = $this->actingUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $this->apiPost('/v2/users/me/sub-accounts', ['child_user_id' => $child->id])->assertStatus(201);
        $relationshipId = (int) DB::table('account_relationships')
            ->where('parent_user_id', $parent->id)->where('child_user_id', $child->id)->value('id');
        $this->assertGreaterThan(0, $relationshipId);

        // … approve (as the child) …
        Sanctum::actingAs($child, ['*']);
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/approve")->assertStatus(200);

        // … grant a tier (as the supported member) …
        $this->apiPut("/v2/users/me/parent-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['credits' => SupportTiers::CO_DECIDE]],
        ])->assertStatus(200);

        // … and revoke.
        Sanctum::actingAs($parent, ['*']);
        $this->apiDelete("/v2/users/me/sub-accounts/{$relationshipId}")->assertStatus(200);

        $events = $this->events($relationshipId);
        $this->assertSame(
            ['requested', 'approved', 'permissions_changed', 'revoked'],
            array_column($events, 'action'),
        );

        // Each event names its actor: the parent requested, the CHILD approved.
        $this->assertEquals($parent->id, (int) $events[0]->actor_user_id);
        $this->assertEquals($child->id, (int) $events[1]->actor_user_id);
        $this->assertSame('member', $events[0]->actor_role);

        // The permission change carries the tier before/after, so "who could
        // do what, when" is answerable later.
        $details = json_decode((string) $events[2]->details, true);
        $this->assertSame(SupportTiers::NONE, $details['tiers_before']['credits']);
        $this->assertSame(SupportTiers::CO_DECIDE, $details['tiers_after']['credits']);
    }

    public function test_resending_an_unchanged_grant_writes_no_event(): void
    {
        $parent = $this->actingUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $relationshipId = (int) DB::table('account_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'parent_user_id' => $parent->id,
            'child_user_id' => $child->id,
            'relationship_type' => 'family',
            'permissions' => json_encode(['tiers' => ['credits' => SupportTiers::CO_DECIDE]]),
            'status' => 'active',
            'approved_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // Same tier again — nothing changed, so nothing to record.
        $this->apiPut("/v2/users/me/sub-accounts/{$relationshipId}/permissions", [
            'permissions' => ['tiers' => ['credits' => SupportTiers::CO_DECIDE]],
        ])->assertStatus(200);

        $this->assertCount(0, $this->events($relationshipId));
    }

    public function test_the_trail_refuses_updates_at_the_database_level(): void
    {
        $parent = $this->actingUser();
        $child = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $this->apiPost('/v2/users/me/sub-accounts', ['child_user_id' => $child->id])->assertStatus(201);
        $relationshipId = (int) DB::table('account_relationships')
            ->where('parent_user_id', $parent->id)->where('child_user_id', $child->id)->value('id');

        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('account_relationship_events')
            ->where('relationship_id', $relationshipId)
            ->update(['action' => 'approved']);
    }
}
