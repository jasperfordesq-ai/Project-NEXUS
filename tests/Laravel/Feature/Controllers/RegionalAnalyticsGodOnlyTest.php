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
 * /v2/admin/regional-analytics/* — god accounts only (owner decision 2026-10-02).
 *
 * The Regional Analytics screen was open to every tenant admin, but its figures
 * come almost entirely from volunteering logs and Caring Community help
 * requests, so a timebank sees a page of zeros. Until it is reworked it is
 * restricted to god accounts. The sidebar hides it and GodOnlyRoute guards the
 * React route, but neither is a control on its own — this test pins the API.
 */
class RegionalAnalyticsGodOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private const GET_ENDPOINTS = [
        '/v2/admin/regional-analytics/overview',
        '/v2/admin/regional-analytics/heatmap',
        '/v2/admin/regional-analytics/demand-supply',
        '/v2/admin/regional-analytics/demographics',
        '/v2/admin/regional-analytics/engagement-trends',
        '/v2/admin/regional-analytics/volunteer-breakdown',
        '/v2/admin/regional-analytics/help-requests',
        '/v2/admin/regional-analytics/export',
    ];

    private const POST_ENDPOINT = '/v2/admin/regional-analytics/invalidate-cache';

    private function assertEveryEndpointForbidden(): void
    {
        foreach (self::GET_ENDPOINTS as $endpoint) {
            $this->apiGet($endpoint)->assertStatus(403);
        }
        $this->apiPost(self::POST_ENDPOINT)->assertStatus(403);
    }

    public function test_tenant_admin_is_refused_every_endpoint(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->assertEveryEndpointForbidden();
    }

    public function test_platform_super_admin_who_is_not_god_is_refused(): void
    {
        $superAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'is_super_admin' => 1,
        ]);
        Sanctum::actingAs($superAdmin);

        $this->assertEveryEndpointForbidden();
    }

    public function test_god_can_read_the_overview(): void
    {
        $god = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // is_god is a flag written straight to the column, never a role string.
        DB::table('users')->where('id', $god->id)->update(['is_god' => 1]);
        Sanctum::actingAs($god->fresh());

        $this->apiGet('/v2/admin/regional-analytics/overview')
            ->assertStatus(200)
            ->assertJsonStructure(['data' => ['active_members', 'vol_hours_this_month']]);
    }
}
