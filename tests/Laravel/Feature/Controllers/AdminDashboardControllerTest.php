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
    // STATS — the figures the polished dashboard depends on
    // ================================================================

    /**
     * A brand-new community so every count below is exact. The shared tenant 2
     * carries whatever earlier tests and fixtures left behind.
     */
    private function freshTenant(): int
    {
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Dashboard fixture community', 'slug' => 'dashboard-fixture-' . uniqid(), 'domain' => null,
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->withTenant($tenantId);

        return $tenantId;
    }

    private function member(int $tenantId, array $attributes = []): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge([
            'is_approved' => 1, 'status' => 'active', 'created_at' => now()->subYear(),
        ], $attributes));
    }

    /** @param array<string, mixed> $row */
    private function insertTransaction(int $tenantId, array $row): void
    {
        DB::table('transactions')->insert(array_merge([
            'tenant_id' => $tenantId,
            'amount' => 1.0,
            'status' => 'completed',
            'transaction_type' => 'transfer',
            'description' => 'fixture',
            'created_at' => now(),
        ], $row));
    }

    public function test_active_users_counts_members_seen_in_the_last_30_days_only(): void
    {
        $tenantId = $this->freshTenant();
        $admin = $this->member($tenantId, ['role' => 'admin', 'last_login_at' => now()->subDays(2)]);
        // Counted: seen by the heartbeat, or merely signed in, within the window.
        $this->member($tenantId, ['last_active_at' => now()->subDays(3), 'last_login_at' => null]);
        $this->member($tenantId, ['last_active_at' => null, 'last_login_at' => now()->subDays(29)]);
        // Not counted: stale, never seen, removed, or barred — even if recently seen.
        $this->member($tenantId, ['last_active_at' => now()->subDays(31), 'last_login_at' => now()->subDays(45)]);
        $this->member($tenantId, ['last_active_at' => null, 'last_login_at' => null]);
        $this->member($tenantId, ['last_login_at' => now()->subDay(), 'deleted_at' => now()->subHour()]);
        $this->member($tenantId, ['last_login_at' => now()->subDay(), 'status' => 'suspended']);
        $this->member($tenantId, ['last_login_at' => now()->subDay(), 'status' => 'banned']);
        Sanctum::actingAs($admin);

        $data = $this->apiGet('/v2/admin/dashboard/stats')->assertOk()->json('data');

        $this->assertSame(3, $data['active_users'], 'admin + heartbeat member + login-only member');
        $this->assertSame(30, $data['active_users_window_days']);
        // Regression: this figure used to be "approved accounts", which is nearly everyone.
        $this->assertSame(7, $data['approved_users'], 'every account but the deleted one is approved');
        $this->assertNotSame($data['approved_users'], $data['active_users']);
        $this->assertSame(7, $data['total_users'], 'a deleted account is not a member');
    }

    public function test_exchange_figures_exclude_system_credit_and_count_real_exchanges(): void
    {
        $tenantId = $this->freshTenant();
        $admin = $this->member($tenantId, ['role' => 'admin']);
        $a = $this->member($tenantId);
        $b = $this->member($tenantId);
        Sanctum::actingAs($admin);

        // Counted: two completed member-to-member rows, one left at the column default.
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 1.5]);
        $this->insertTransaction($tenantId, ['sender_id' => $b->id, 'receiver_id' => $a->id, 'amount' => 2.0, 'transaction_type' => 'exchange']);
        // Not counted: an opening balance (sender 0), an admin grant (sender NULL),
        // the community fund, a donation, a self-transfer welcome bonus, a reversal,
        // and a row that is still pending — 3,000 hours that are not exchanges.
        $this->insertTransaction($tenantId, ['sender_id' => 0, 'receiver_id' => $a->id, 'amount' => 1000, 'transaction_type' => 'starting_balance']);
        $this->insertTransaction($tenantId, ['sender_id' => null, 'receiver_id' => $a->id, 'amount' => 500, 'transaction_type' => 'admin_grant']);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 500, 'transaction_type' => 'community_fund']);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 300, 'transaction_type' => 'donation']);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $a->id, 'amount' => 400, 'description' => '[Welcome Bonus] import']);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 200, 'transaction_type' => 'exchange_reversal']);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 100, 'status' => 'pending']);

        $data = $this->apiGet('/v2/admin/dashboard/stats')->assertOk()->json('data');

        $this->assertSame(2, $data['total_transactions']);
        $this->assertEqualsWithDelta(3.5, $data['total_hours_exchanged'], 0.01);
        $this->assertSame(2, $data['exchanges_this_month']);
        $this->assertEqualsWithDelta(3.5, $data['exchange_hours_this_month'], 0.01);
        $this->assertFalse($data['_partial']);
        $this->assertSame([], $data['_failed_metrics']);
    }

    public function test_month_on_month_change_is_a_percentage_or_null_without_a_baseline(): void
    {
        $tenantId = $this->freshTenant();
        $admin = $this->member($tenantId, ['role' => 'admin']);
        $a = $this->member($tenantId);
        $b = $this->member($tenantId);
        Sanctum::actingAs($admin);

        $thisMonth = now()->startOfMonth()->addHours(6);
        $lastMonth = now()->startOfMonth()->subMonth()->addHours(6);
        foreach ([1, 2, 3] as $i) {
            $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 1.0, 'created_at' => $thisMonth]);
        }
        foreach ([1, 2] as $i) {
            $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 2.0, 'created_at' => $lastMonth]);
        }
        // Three accounts existed before this month, one joined this month.
        $this->member($tenantId, ['created_at' => $thisMonth]);

        $data = $this->apiGet('/v2/admin/dashboard/stats')->assertOk()->json('data');

        $this->assertSame(3, $data['exchanges_this_month']);
        $this->assertSame(2, $data['exchanges_last_month']);
        $this->assertEqualsWithDelta(50.0, $data['exchanges_delta_pct'], 0.01, '3 against 2');
        $this->assertEqualsWithDelta(3.0, $data['exchange_hours_this_month'], 0.01);
        $this->assertEqualsWithDelta(4.0, $data['exchange_hours_last_month'], 0.01);
        $this->assertEqualsWithDelta(-25.0, $data['exchange_hours_delta_pct'], 0.01);
        $this->assertSame(4, $data['total_users']);
        $this->assertSame(3, $data['total_users_start_of_month']);
        $this->assertEqualsWithDelta(33.3, $data['members_delta_pct'], 0.01);
        $this->assertSame(1, $data['new_users_this_month']);
        $this->assertSame(0, $data['new_users_last_month']);
        $this->assertNull($data['new_users_delta_pct'], 'no change can be stated against a baseline of zero');
        $this->assertNull($data['active_listings_delta_pct'], 'listings keep no status history');
    }

    public function test_a_metric_that_cannot_be_computed_is_null_and_named_not_zero(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        \Illuminate\Support\Facades\Schema::shouldReceive('hasTable')
            ->with('vol_organizations')
            ->andThrow(new \RuntimeException('simulated outage'));
        \Illuminate\Support\Facades\Schema::shouldReceive('hasColumn')->andReturn(true)->byDefault();

        $data = $this->apiGet('/v2/admin/dashboard/stats')->assertOk()->json('data');

        $this->assertNull($data['pending_organisations']);
        $this->assertTrue($data['_partial']);
        $this->assertSame(['pending_organisations'], $data['_failed_metrics']);
        $this->assertIsInt($data['total_users'], 'the other figures still load');
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

    public function test_trends_buckets_twelve_whole_calendar_months_oldest_first(): void
    {
        $tenantId = $this->freshTenant();
        $admin = $this->member($tenantId, ['role' => 'admin']);
        $a = $this->member($tenantId);
        $b = $this->member($tenantId);
        Sanctum::actingAs($admin);

        $oldestMonth = now()->startOfMonth()->subMonths(11);
        // The 1st of the oldest month at 00:30 is inside the window. The old
        // DATE_SUB(NOW(), INTERVAL 12 MONTH) window started mid-month and lost it.
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 2.5, 'created_at' => $oldestMonth->copy()->addMinutes(30)]);
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 1.0, 'created_at' => now()]);
        // Just before the window, and an opening balance inside it: neither counts.
        $this->insertTransaction($tenantId, ['sender_id' => $a->id, 'receiver_id' => $b->id, 'amount' => 9.0, 'created_at' => $oldestMonth->copy()->subMinute()]);
        $this->insertTransaction($tenantId, ['sender_id' => 0, 'receiver_id' => $a->id, 'amount' => 3000, 'transaction_type' => 'starting_balance', 'created_at' => now()]);
        // The fixture members joined a year ago, before the window; one joins today.
        $this->member($tenantId, ['created_at' => now()]);

        $response = $this->apiGet('/v2/admin/dashboard/trends')->assertOk();
        $rows = $response->json('data');

        $this->assertCount(12, $rows);
        $this->assertSame($oldestMonth->format('Y-m'), $rows[0]['month']);
        $this->assertSame(now()->format('Y-m'), $rows[11]['month']);
        $this->assertSame(1, $rows[0]['transactions']);
        $this->assertEqualsWithDelta(2.5, $rows[0]['hours'], 0.01);
        $this->assertSame(1, $rows[11]['transactions']);
        $this->assertEqualsWithDelta(1.0, $rows[11]['hours'], 0.01, 'the 3,000-hour opening balance is not an exchange');
        $this->assertSame(1, $rows[11]['users'], 'only the member who joined today');
        $this->assertSame(0, $rows[0]['users'], 'the fixture members joined a year ago, before the window');
        $this->assertSame(12, $response->json('meta.months'));
        $this->assertFalse($response->json('meta._partial'));
        $this->assertSame([], $response->json('meta._failed_metrics'));
    }

    public function test_trends_months_parameter_is_clamped(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->assertCount(3, $this->apiGet('/v2/admin/dashboard/trends?months=3')->assertOk()->json('data'));
        $this->assertCount(24, $this->apiGet('/v2/admin/dashboard/trends?months=99')->assertOk()->json('data'));
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
