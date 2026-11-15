<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminDeliverabilityController.
 *
 * Covers dashboard, analytics, CRUD for deliverables, and comments.
 */
class AdminDeliverabilityControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/deliverability/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/deliverability/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['total', 'by_status', 'overdue', 'completion_rate', 'recent_activity'],
        ]);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/deliverability/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/deliverability/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // ANALYTICS — GET /v2/admin/deliverability/analytics
    // ================================================================

    public function test_analytics_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/deliverability/analytics');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_analytics_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/deliverability/analytics');

        $response->assertStatus(403);
    }

    // ================================================================
    // LIST DELIVERABLES — GET /v2/admin/deliverability
    // ================================================================

    public function test_get_deliverables_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/deliverability');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_deliverables_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/deliverability');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE DELIVERABLE — POST /v2/admin/deliverability
    // ================================================================

    public function test_create_deliverable_returns_success_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/deliverability', [
            'title' => 'Test Deliverable',
            'description' => 'A test deliverable item',
            'status' => 'draft',
            'priority' => 'medium',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
        $response->assertJsonStructure(['data']);
    }

    public function test_create_deliverable_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/deliverability', [
            'title' => 'Should Fail',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // DELETE DELIVERABLE — DELETE /v2/admin/deliverability/{id}
    // ================================================================

    public function test_delete_deliverable_returns_404_for_nonexistent(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/deliverability/999999');

        $response->assertStatus(404);
    }

    public function test_delete_deliverable_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiDelete('/v2/admin/deliverability/1');

        $response->assertStatus(401);
    }
}
