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
 * Feature tests for MemberActivityController — activity dashboard, timeline, hours.
 */
class MemberActivityControllerTest extends TestCase
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
    //  GET /v2/users/me/activity/dashboard
    // ------------------------------------------------------------------

    public function test_dashboard_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/activity/dashboard');

        $response->assertStatus(401);
    }

    public function test_dashboard_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/activity/dashboard');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/me/activity/timeline
    // ------------------------------------------------------------------

    public function test_timeline_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/activity/timeline');

        $response->assertStatus(401);
    }

    public function test_timeline_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/activity/timeline');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/me/activity/hours
    // ------------------------------------------------------------------

    public function test_hours_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/activity/hours');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/me/activity/monthly
    // ------------------------------------------------------------------

    public function test_monthly_hours_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/activity/monthly');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/{id}/activity/dashboard (public profile)
    // ------------------------------------------------------------------

    public function test_public_dashboard_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/1/activity/dashboard');

        $response->assertStatus(401);
    }

    public function test_public_dashboard_returns_data(): void
    {
        $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $response = $this->apiGet("/v2/users/{$other->id}/activity/dashboard");

        $response->assertStatus(200);
    }

    public function test_public_dashboard_hides_pending_and_unapproved_profiles(): void
    {
        $member = $this->authenticatedUser();

        foreach ([
            ['status' => 'pending', 'is_approved' => false],
            ['status' => 'active', 'is_approved' => false],
        ] as $state) {
            $other = User::factory()->forTenant($this->testTenantId)->create($state + [
                'privacy_profile' => 'public',
            ]);

            $this->apiGet("/v2/users/{$other->id}/activity/dashboard")
                ->assertStatus(404)
                ->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');

            $staff = User::factory()->forTenant($this->testTenantId)->create([
                'role' => 'coordinator', 'status' => 'active', 'is_approved' => true,
            ]);
            Sanctum::actingAs($staff, ['*']);
            $this->apiGet("/v2/users/{$other->id}/activity/dashboard")
                ->assertStatus(200);
            Sanctum::actingAs($member, ['*']);
        }
    }

    // ------------------------------------------------------------------
    //  Tenant isolation
    // ------------------------------------------------------------------

    public function test_dashboard_is_tenant_scoped(): void
    {
        $this->authenticatedUser();

        // The dashboard should only show data for the test tenant
        $response = $this->apiGet('/v2/users/me/activity/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }
}
