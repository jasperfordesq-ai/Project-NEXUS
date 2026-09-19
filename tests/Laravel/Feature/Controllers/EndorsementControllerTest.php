<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for EndorsementController — skill endorsements between members.
 */
class EndorsementControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /v2/members/{id}/endorse
    // ------------------------------------------------------------------

    public function test_endorse_requires_auth(): void
    {
        $response = $this->apiPost('/v2/members/1/endorse', ['skill_id' => 1]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/members/{id}/endorse
    // ------------------------------------------------------------------

    public function test_remove_endorsement_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/members/1/endorse');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/members/{id}/endorsements
    // ------------------------------------------------------------------

    public function test_get_endorsements_requires_auth(): void
    {
        $response = $this->apiGet('/v2/members/1/endorsements');

        $response->assertStatus(401);
    }

    public function test_get_endorsements_returns_data(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/members/{$other->id}/endorsements");

        $response->assertStatus(200);
    }

    public function test_grouped_endorsements_preserve_each_member_and_record(): void
    {
        $viewer = $this->authenticatedUser();
        $first = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Alex, Jr.', 'last_name' => 'Smith', 'avatar_url' => null,
        ]);
        $second = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Sam', 'last_name' => 'Jones', 'avatar_url' => '/uploads/sam.png',
        ]);
        $records = [];
        foreach ([$first, $second] as $member) {
            $records[] = \App\Models\SkillEndorsement::create([
                'tenant_id' => $this->testTenantId, 'endorsed_id' => $viewer->id,
                'endorser_id' => $member->id, 'skill_name' => 'Gardening', 'comment' => 'Thoughtful help',
            ]);
        }
        $response = $this->apiGet("/v2/members/{$viewer->id}/endorsements")->assertOk();
        $group = $response->json('data.endorsements.0');
        $this->assertSame('Gardening', $group['skill_name']);
        $this->assertEquals(2, $group['count']);
        $this->assertArrayHasKey('endorsed_by_names', $group);
        $this->assertArrayHasKey('endorsements', $group);
        $byMember = collect($group['endorsements'])->keyBy('endorser_id');
        $this->assertSame('Alex, Jr. Smith', $byMember[$first->id]['endorser_name']);
        $this->assertNull($byMember[$first->id]['endorser_avatar']);
        $this->assertSame('/uploads/sam.png', $byMember[$second->id]['endorser_avatar']);
        $this->assertEquals($records[0]->id, $byMember[$first->id]['id']);
        $this->assertSame('Thoughtful help', $byMember[$first->id]['comment']);
    }

    public function test_grouped_endorsements_keep_database_skill_name_equivalence(): void
    {
        $viewer = $this->authenticatedUser();
        foreach (['Café help', 'CAFE HELP', 'Plumbing'] as $skillName) {
            $member = User::factory()->forTenant($this->testTenantId)->create(['avatar_url' => null]);
            \App\Models\SkillEndorsement::create([
                'tenant_id' => $this->testTenantId, 'endorsed_id' => $viewer->id,
                'endorser_id' => $member->id, 'skill_name' => $skillName,
            ]);
        }
        $groups = $this->apiGet("/v2/members/{$viewer->id}/endorsements")
            ->assertOk()->json('data.endorsements');
        $this->assertCount(2, $groups);
        $this->assertEquals(2, $groups[0]['count']);
        $this->assertCount(2, $groups[0]['endorsements']);
        $this->assertNull($groups[0]['endorsed_by_avatars']);
        $this->assertSame('Plumbing', $groups[1]['skill_name']);
        $this->assertEquals(1, $groups[1]['count']);
    }

    // ------------------------------------------------------------------
    //  GET /v2/members/top-endorsed
    // ------------------------------------------------------------------

    public function test_top_endorsed_requires_auth(): void
    {
        $response = $this->apiGet('/v2/members/top-endorsed');

        $response->assertStatus(401);
    }

    public function test_top_endorsed_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/members/top-endorsed');

        $response->assertStatus(200);
    }
}
