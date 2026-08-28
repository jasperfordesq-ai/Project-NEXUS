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
 * Feature tests for AdminDashboardController.
 *
 * Covers stats, trends, and activity log endpoints.
 */
class AdminDashboardControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // STATS — GET /v2/admin/dashboard/stats
    // ================================================================

    public function test_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/dashboard/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_stats_returns_correct_data_structure(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        // Create some regular users so stats have data
        User::factory()->forTenant($this->testTenantId)->count(3)->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/dashboard/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /**
     * The dashboard could not surface this until 2026-08-28 — the endpoint
     * simply did not return the number, which is recorded as a known parity gap
     * in AdminDashboard.tsx's own notes. Without it a queue of volunteering
     * organisations awaiting approval built up entirely unseen, because
     * registering one notified nobody either.
     */
    public function test_stats_counts_volunteering_organisations_awaiting_approval(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $before = (int) ($this->apiGet('/v2/admin/dashboard/stats')->json('data.pending_organisations') ?? 0);

        \Illuminate\Support\Facades\DB::table('vol_organizations')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $admin->id,
            'name'        => 'Pending Org For Dashboard Test',
            'slug'        => 'pending-org-for-dashboard-test-' . uniqid(),
            'description' => 'Awaiting a decision.',
            'status'      => 'pending',
            'created_at'  => now(),
        ]);
        \Illuminate\Support\Facades\DB::table('vol_organizations')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $admin->id,
            'name'        => 'Already Approved Org For Dashboard Test',
            'slug'        => 'approved-org-for-dashboard-test-' . uniqid(),
            'description' => 'Already decided.',
            'status'      => 'active',
            'created_at'  => now(),
        ]);

        $after = (int) $this->apiGet('/v2/admin/dashboard/stats')->json('data.pending_organisations');

        self::assertSame($before + 1, $after, 'only the PENDING organisation should be counted');
    }

    public function test_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/dashboard/stats');

        $response->assertStatus(403);
    }

    public function test_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/dashboard/stats');

        $response->assertStatus(401);
    }

    // ================================================================
    // TRENDS — GET /v2/admin/dashboard/trends
    // ================================================================

    public function test_trends_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/dashboard/trends');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_trends_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/dashboard/trends');

        $response->assertStatus(403);
    }

    // ================================================================
    // ACTIVITY — GET /v2/admin/dashboard/activity
    // ================================================================

    public function test_activity_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/dashboard/activity');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_activity_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/dashboard/activity');

        $response->assertStatus(403);
    }

    public function test_activity_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/dashboard/activity');

        $response->assertStatus(401);
    }

    public function test_activity_formats_structured_safeguarding_details(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        DB::table('activity_log')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $admin->id,
                'action' => 'safeguarding_consent_revoked',
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $admin->id,
                'details' => json_encode(['option_id' => 7]),
                'created_at' => now()->addMinutes(4),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $admin->id,
                'action' => 'safeguarding_triggers_activated',
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $admin->id,
                'details' => json_encode([
                    'needs_monitoring' => true,
                    'needs_broker_approval' => false,
                    'triggers' => [
                        'requires_vetted_interaction' => true,
                        'requires_broker_approval' => false,
                        'restricts_messaging' => false,
                        'restricts_matching' => true,
                        'notify_admin_on_selection' => true,
                        'vetting_types_required' => ['garda_vetting'],
                    ],
                ]),
                'created_at' => now()->addMinutes(3),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $admin->id,
                'action' => 'safeguarding_triggers_activated',
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $admin->id,
                'details' => json_encode([
                    'needs_monitoring' => false,
                    'needs_broker_approval' => false,
                    'triggers' => [
                        'requires_vetted_interaction' => false,
                        'requires_broker_approval' => false,
                        'restricts_messaging' => false,
                        'restricts_matching' => false,
                        'notify_admin_on_selection' => false,
                    ],
                ]),
                'created_at' => now()->addMinutes(2),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $admin->id,
                'action' => 'safeguarding_preferences_updated',
                'action_type' => 'safeguarding',
                'entity_type' => 'user',
                'entity_id' => $admin->id,
                'details' => json_encode(['options_count' => 1]),
                'created_at' => now()->addMinute(),
            ],
        ]);

        $response = $this->apiGet('/v2/admin/dashboard/activity?limit=4');

        $response->assertStatus(200);

        $descriptions = array_column($response->json('data'), 'description');

        $this->assertContains('revoked safeguarding consent (option #7)', $descriptions);
        $this->assertContains(
            'updated safeguarding protections: monitoring required, vetted interaction required, matching restricted, admin notification enabled, garda vetting required',
            $descriptions
        );
        $this->assertContains('updated safeguarding protections: no active restrictions', $descriptions);
        $this->assertContains('updated safeguarding preferences (1 option)', $descriptions);
        $this->assertStringNotContainsString('{"', implode(' ', $descriptions));
    }

    // ================================================================
    // ACTIVITY LOG (alternate route) — GET /v2/admin/system/activity-log
    // ================================================================

    public function test_system_activity_log_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/system/activity-log');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_system_activity_log_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/system/activity-log');

        $response->assertStatus(403);
    }
}
