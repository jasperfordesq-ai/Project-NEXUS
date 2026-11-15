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
 * Feature tests for AdminCronController.
 *
 * Covers cron logs, log detail, clear logs, global settings, health metrics,
 * and per-job settings.
 */
class AdminCronControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // LOGS — GET /v2/admin/system/cron-jobs/logs
    // ================================================================

    public function test_get_logs_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/logs');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_logs_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/logs');

        $response->assertStatus(403);
    }

    public function test_get_logs_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/system/cron-jobs/logs');

        $response->assertStatus(401);
    }

    // ================================================================
    // CLEAR LOGS — DELETE /v2/admin/system/cron-jobs/logs
    // ================================================================

    public function test_clear_logs_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/system/cron-jobs/logs');

        $response->assertStatus(200);
    }

    public function test_clear_logs_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/system/cron-jobs/logs');

        $response->assertStatus(403);
    }

    // ================================================================
    // GLOBAL SETTINGS — GET /v2/admin/system/cron-jobs/settings
    // ================================================================

    public function test_get_global_settings_returns_200_for_the_platform_team(): void
    {
        // Global cron settings live in the platform-wide `cron_settings` table
        // (no tenant_id): a Platform team page (E-128), is_god AND super admin.
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/settings');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_global_settings_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/settings');

        $response->assertStatus(403);
    }

    // ================================================================
    // UPDATE GLOBAL SETTINGS — PUT /v2/admin/system/cron-jobs/settings
    // ================================================================

    public function test_update_global_settings_returns_200_for_the_platform_team(): void
    {
        // Updating global cron settings touches the platform-wide `cron_settings`
        // table: the platform team only (E-128).
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/system/cron-jobs/settings', [
            'enabled' => true,
        ]);

        $response->assertStatus(200);
    }

    // ================================================================
    // HEALTH METRICS — GET /v2/admin/system/cron-jobs/health
    // ================================================================

    public function test_get_health_metrics_returns_200_for_the_platform_team(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create(['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/health');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_get_health_metrics_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/system/cron-jobs/health');

        $response->assertStatus(403);
    }

    public function test_get_health_metrics_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/system/cron-jobs/health');

        $response->assertStatus(401);
    }
}
