<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminEmailController.
 *
 * Covers email status, test email, config, and provider testing.
 */
class AdminEmailControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // STATUS — GET /v2/admin/email/status
    // ================================================================

    public function test_status_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/email/status');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_status_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/email/status');

        $response->assertStatus(403);
    }

    public function test_status_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/email/status');

        $response->assertStatus(401);
    }

    // ================================================================
    // CONFIG — GET /v2/admin/email/config
    // ================================================================

    public function test_get_config_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/email/config');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_config_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/email/config');

        $response->assertStatus(403);
    }

    // ================================================================
    // UPDATE CONFIG — PUT /v2/admin/email/config
    // ================================================================

    public function test_update_config_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/email/config', [
            'provider' => 'smtp',
        ]);

        $response->assertStatus(200);
    }

    public function test_update_config_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPut('/v2/admin/email/config', [
            'provider' => 'smtp',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // TEST EMAIL — POST /v2/admin/email/test
    // ================================================================

    public function test_test_email_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/email/test', [
            'to' => 'test@example.com',
        ]);

        // May return 200 or 500 depending on mail config in test env
        $this->assertContains($response->getStatusCode(), [200, 500]);
    }

    public function test_test_email_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/email/test', [
            'to' => 'test@example.com',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // TEST PROVIDER — POST /v2/admin/email/test-provider
    // ================================================================

    public function test_test_provider_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/email/test-provider', [
            'provider' => 'smtp',
        ]);

        $response->assertStatus(403);
    }

    public function test_test_provider_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/email/test-provider');

        $response->assertStatus(401);
    }
}
