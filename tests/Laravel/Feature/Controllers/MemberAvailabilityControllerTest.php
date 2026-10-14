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
 * Feature tests for MemberAvailabilityController — user availability slots.
 */
class MemberAvailabilityControllerTest extends TestCase
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

    // ------------------------------------------------------------------
    //  GET /v2/users/me/availability
    // ------------------------------------------------------------------

    public function test_get_my_availability_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/me/availability');

        $response->assertStatus(401);
    }

    public function test_get_my_availability_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/users/me/availability');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  PUT /v2/users/me/availability
    // ------------------------------------------------------------------

    public function test_set_bulk_availability_requires_auth(): void
    {
        $response = $this->apiPut('/v2/users/me/availability', ['slots' => []]);

        $response->assertStatus(401);
    }

    public function test_set_bulk_availability_works(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/users/me/availability', [
            'slots' => [
                ['day' => 'monday', 'start_time' => '09:00', 'end_time' => '12:00'],
            ],
        ]);

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    // ------------------------------------------------------------------
    //  PUT /v2/users/me/availability/{day}
    // ------------------------------------------------------------------

    public function test_set_day_availability_requires_auth(): void
    {
        $response = $this->apiPut('/v2/users/me/availability/monday', [
            'start_time' => '09:00',
            'end_time' => '17:00',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/users/{id}/availability
    // ------------------------------------------------------------------

    public function test_get_user_availability_requires_auth(): void
    {
        $response = $this->apiGet('/v2/users/1/availability');

        $response->assertStatus(401);
    }

    public function test_get_user_availability_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);

        $response = $this->apiGet("/v2/users/{$other->id}/availability");

        $response->assertStatus(200);
    }

    public function test_get_user_availability_hides_pending_and_unapproved_profiles(): void
    {
        $this->authenticatedUser();

        foreach ([
            ['status' => 'pending', 'is_approved' => false],
            ['status' => 'active', 'is_approved' => false],
        ] as $state) {
            $other = User::factory()->forTenant($this->testTenantId)->create($state + [
                'privacy_profile' => 'public',
            ]);

            $this->apiGet("/v2/users/{$other->id}/availability")
                ->assertStatus(404)
                ->assertJsonPath('errors.0.code', 'PROFILE_PRIVATE');
        }
    }

    // ------------------------------------------------------------------
    //  GET /v2/members/availability/compatible
    // ------------------------------------------------------------------

    public function test_find_compatible_times_requires_auth(): void
    {
        $response = $this->apiGet('/v2/members/availability/compatible');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/members/availability/available
    // ------------------------------------------------------------------

    public function test_get_available_members_requires_auth(): void
    {
        $response = $this->apiGet('/v2/members/availability/available');

        $response->assertStatus(401);
    }

    public function test_get_available_members_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/members/availability/available');

        $response->assertStatus(200);
    }
}
