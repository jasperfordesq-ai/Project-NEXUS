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
 * Feature tests for LegalAcceptanceController — legal doc acceptance status.
 */
class LegalAcceptanceControllerTest extends TestCase
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
    //  GET /v2/legal/acceptance/status
    // ------------------------------------------------------------------

    public function test_get_status_requires_auth(): void
    {
        $response = $this->apiGet('/v2/legal/acceptance/status');

        $response->assertStatus(401);
    }

    public function test_get_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/legal/acceptance/status');

        $response->assertStatus(200);
    }

    public function test_admin_status_matches_the_server_side_gate_exemption(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($admin, ['*']);

        $response = $this->apiGet('/v2/legal/acceptance/status');

        $response->assertStatus(200);
        $response->assertJsonPath('data.has_pending', false);
        $response->assertJsonPath('data.enforcement_blocking', false);
        $response->assertJsonPath('data.blocking_pending', false);
        $response->assertJsonCount(0, 'data.documents');
    }

    // ------------------------------------------------------------------
    //  POST /v2/legal/acceptance/accept-all
    // ------------------------------------------------------------------

    public function test_accept_all_requires_auth(): void
    {
        $response = $this->apiPost('/v2/legal/acceptance/accept-all');

        $response->assertStatus(401);
    }

    public function test_accept_all_works(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/legal/acceptance/accept-all');

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }
}
