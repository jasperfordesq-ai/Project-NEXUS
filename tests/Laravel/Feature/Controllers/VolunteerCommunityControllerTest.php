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
use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * Feature tests for VolunteerCommunityController — swaps, waitlists, donations, community projects.
 */
class VolunteerCommunityControllerTest extends TestCase
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

    private function enableVolunteeringFeature(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_get_swap_requests_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/swaps');

        $response->assertStatus(401);
    }

    public function test_my_waitlists_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/my-waitlists');

        $response->assertStatus(401);
    }

    public function test_get_community_projects_requires_auth(): void
    {
        $response = $this->apiGet('/v2/volunteering/community-projects');

        $response->assertStatus(401);
    }

    public function test_get_swap_requests_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/swaps');

        $this->assertLessThan(500, $response->status());
    }

    public function test_swap_request_rejects_mismatched_header_and_body_idempotency_keys(): void
    {
        $this->authenticatedUser();
        $this->enableVolunteeringFeature();

        $this->withHeader('Idempotency-Key', 'header-shift-swap-key')
            ->apiPost('/v2/volunteering/swaps', [
                'from_shift_id' => 11,
                'to_shift_id' => 12,
                'idempotency_key' => 'different-body-key',
            ])
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'idempotency_key');
    }

    public function test_get_community_projects_authenticated_smoke(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/volunteering/community-projects');

        $this->assertLessThan(500, $response->status());
    }
}
