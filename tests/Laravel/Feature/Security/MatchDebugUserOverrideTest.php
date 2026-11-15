<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * `GET /v2/matches/all` lets the Match debug page look at ANOTHER member's
 * matches (`user_id`) and at the scoring breakdown (`debug=true`).
 *
 * Until E-128 the override was open to any caller whose role STRING was an
 * admin one, and the requested member was never checked against the caller's
 * community — so an admin could run the matching engine for a member of a
 * different community (F-625). The page is the platform team's, so the
 * override is too, and the member must belong to the community being worked on.
 */
final class MatchDebugUserOverrideTest extends TestCase
{
    use DatabaseTransactions;

    private const OTHER_TENANT_ID = 999;

    private function member(int $tenantId, array $attributes = []): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
    }

    private function actAs(array $attributes): User
    {
        $user = $this->member($this->testTenantId, $attributes);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function actAsPlatformTeam(): User
    {
        return $this->actAs(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
    }

    public function test_a_community_admin_cannot_ask_for_another_members_matches(): void
    {
        $member = $this->member($this->testTenantId);
        $this->actAs(['role' => 'admin']);

        $this->apiGet('/v2/matches/all?user_id=' . $member->id)->assertStatus(403);
    }

    public function test_a_community_admin_cannot_reach_a_member_of_another_community(): void
    {
        $outsider = $this->member(self::OTHER_TENANT_ID);
        $this->actAs(['role' => 'admin']);

        $this->apiGet('/v2/matches/all?user_id=' . $outsider->id)->assertStatus(403);
    }

    public function test_a_flag_only_admin_is_refused_not_silently_given_their_own(): void
    {
        $member = $this->member($this->testTenantId);
        $this->actAs(['is_admin' => true, 'role' => 'member']);

        $this->apiGet('/v2/matches/all?user_id=' . $member->id)->assertStatus(403);
    }

    public function test_the_platform_team_cannot_reach_a_member_of_another_community(): void
    {
        $outsider = $this->member(self::OTHER_TENANT_ID);
        $this->actAsPlatformTeam();

        $this->apiGet('/v2/matches/all?user_id=' . $outsider->id)->assertStatus(404);
    }

    public function test_the_platform_team_cannot_reach_a_member_who_is_not_active(): void
    {
        $suspended = $this->member($this->testTenantId, ['status' => 'suspended']);
        $this->actAsPlatformTeam();

        $this->apiGet('/v2/matches/all?user_id=' . $suspended->id)->assertStatus(404);
    }

    public function test_the_platform_team_can_debug_a_member_of_this_community(): void
    {
        $member = $this->member($this->testTenantId);
        $this->actAsPlatformTeam();

        $this->apiGet('/v2/matches/all?debug=true&user_id=' . $member->id)->assertOk();
    }

    public function test_a_member_asking_for_their_own_matches_is_unchanged(): void
    {
        $self = $this->actAs(['role' => 'member']);

        $this->apiGet('/v2/matches/all')->assertOk();
        $this->apiGet('/v2/matches/all?user_id=' . $self->id)->assertOk();
    }

    public function test_debug_is_ignored_for_everyone_else(): void
    {
        $this->actAs(['role' => 'admin']);

        $response = $this->apiGet('/v2/matches/all?debug=true');

        $response->assertOk();
        $this->assertStringNotContainsString('match_breakdown', (string) $response->getContent());
        $this->assertStringNotContainsString('"debug"', (string) $response->getContent());
    }
}
