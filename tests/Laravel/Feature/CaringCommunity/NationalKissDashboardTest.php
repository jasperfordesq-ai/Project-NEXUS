<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Models\User;
use App\Services\CaringCommunity\NationalKissDashboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for the cross-tenant National KISS Foundation dashboard.
 *
 * Each test seeds two KISS-cooperative tenants, plus one non-KISS tenant
 * that must not appear in the dashboard. Cache is flushed before every test
 * because the service caches results for an hour.
 */
class NationalKissDashboardTest extends TestCase
{
    use DatabaseTransactions;

    private int $kissTenantA;
    private int $kissTenantB;
    private int $nonKissTenant;

    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();

        DB::table('tenants')
            ->where('tenant_category', 'kiss_cooperative')
            ->update(['tenant_category' => 'community']);

        $this->kissTenantA = (int) DB::table('tenants')->insertGetId([
            'name' => 'Test KISS Coop Alpha',
            'slug' => 'test-kiss-coop-alpha-' . uniqid(),
            'tenant_category' => 'kiss_cooperative',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->kissTenantB = (int) DB::table('tenants')->insertGetId([
            'name' => 'Test KISS Coop Beta',
            'slug' => 'test-kiss-coop-beta-' . uniqid(),
            'tenant_category' => 'kiss_cooperative',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->nonKissTenant = (int) DB::table('tenants')->insertGetId([
            'name' => 'Test Non-KISS Tenant',
            'slug' => 'test-non-kiss-' . uniqid(),
            'tenant_category' => 'community',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function service(): NationalKissDashboardService
    {
        return app(NationalKissDashboardService::class);
    }

    private function seedApprovedHours(int $tenantId, float $hours, ?string $date = null): void
    {
        $date = $date ?? date('Y-m-d');

        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $tenantId,
            'first_name' => 'Vol',
            'last_name'  => 'Untreer',
            'email'      => 'vol.' . uniqid() . '@example.com',
            'username'   => 'u_' . substr(md5((string) microtime(true)), 0, 8),
            'password'   => password_hash('password', PASSWORD_BCRYPT),
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('vol_logs')->insert([
            'tenant_id'    => $tenantId,
            'user_id'      => $userId,
            'date_logged'  => $date,
            'hours'        => $hours,
            'description'  => 'Test logged hours',
            'status'       => 'approved',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);
    }

    public function test_lists_only_kiss_cooperative_tenants(): void
    {
        $coops = $this->service()->listCooperatives();

        $tenantIds = array_column($coops, 'tenant_id');
        $this->assertContains($this->kissTenantA, $tenantIds, 'KISS tenant A should appear');
        $this->assertContains($this->kissTenantB, $tenantIds, 'KISS tenant B should appear');
        $this->assertNotContains($this->nonKissTenant, $tenantIds, 'Non-KISS tenant must not appear');
    }

    public function test_summary_aggregates_across_cooperatives(): void
    {
        $today = date('Y-m-d');
        $weekAgo = date('Y-m-d', strtotime('-7 days'));

        $this->seedApprovedHours($this->kissTenantA, 10.5, $today);
        $this->seedApprovedHours($this->kissTenantB, 5.5, $today);
        // Non-KISS hours must be excluded.
        $this->seedApprovedHours($this->nonKissTenant, 999.0, $today);

        Cache::flush();
        $summary = $this->service()->nationalSummary($weekAgo, $today);

        // 10.5 + 5.5 = 16.0; non-KISS 999 must NOT be included.
        $this->assertEqualsWithDelta(16.0, $summary['total_approved_hours_national'], 0.01);
        $this->assertGreaterThanOrEqual(2, $summary['cooperatives_count']);
        $this->assertGreaterThanOrEqual(2, $summary['active_cooperatives_count']);
        $this->assertArrayHasKey('top_5_cooperatives_by_hours', $summary);
        $this->assertArrayHasKey('bottom_5_active_cooperatives_by_hours', $summary);
    }

    public function test_comparative_returns_status_label(): void
    {
        $today = date('Y-m-d');
        $weekAgo = date('Y-m-d', strtotime('-7 days'));

        $this->seedApprovedHours($this->kissTenantA, 12.0, $today);

        Cache::flush();
        $rows = $this->service()->comparativeMetrics($weekAgo, $today);

        $this->assertNotEmpty($rows);
        foreach ($rows as $row) {
            $this->assertContains(
                $row['status'],
                ['thriving', 'stable', 'struggling'],
                'status must be one of the three classifications'
            );
        }
    }

    public function test_member_counts_are_bucketed_never_raw(): void
    {
        // Seed 17 active members for a KISS tenant.
        for ($i = 0; $i < 17; $i++) {
            DB::table('users')->insert([
                'tenant_id'  => $this->kissTenantA,
                'first_name' => 'Bucket',
                'last_name'  => 'Test' . $i,
                'email'      => 'bucket' . $i . '.' . uniqid() . '@example.com',
                'username'   => 'b_' . substr(md5((string) ($i . microtime(true))), 0, 8),
                'password'   => password_hash('p', PASSWORD_BCRYPT),
                'status'     => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        Cache::flush();
        $coops = $this->service()->listCooperatives();
        $alpha = null;
        foreach ($coops as $c) {
            if ($c['tenant_id'] === $this->kissTenantA) {
                $alpha = $c;
                break;
            }
        }

        $this->assertNotNull($alpha, 'Tenant A should be in cooperative list');
        // Bucket label must be a string in the 10-24 bracket — never the raw 17.
        $this->assertSame('10-24', $alpha['member_count_bracket']);
        $this->assertIsString($alpha['member_count_bracket']);
        $this->assertStringNotContainsString('17', $alpha['member_count_bracket']);
    }

    public function test_endpoint_requires_national_kiss_dashboard_view_permission(): void
    {
        // A plain member with no special role/permission must get 403.
        $userId = (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'first_name' => 'Plain',
            'last_name'  => 'Member',
            'email'      => 'plain.' . uniqid() . '@example.com',
            'username'   => 'plain_' . substr(md5(uniqid()), 0, 8),
            'password'   => password_hash('p', PASSWORD_BCRYPT),
            'role'       => 'member',
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $user = User::query()->find($userId);
        $this->assertNotNull($user);
        Sanctum::actingAs($user);

        $resp = $this->getJson(
            '/api/v2/admin/national/kiss/summary',
            ['X-Tenant-ID' => (string) $this->testTenantId, 'Accept' => 'application/json']
        );
        $resp->assertStatus(403);
    }

    public function test_trend_returns_12_months_of_data(): void
    {
        Cache::flush();
        $trend = $this->service()->nationalTrend();

        $this->assertCount(12, $trend, 'Trend must always return exactly 12 months');
        foreach ($trend as $point) {
            $this->assertArrayHasKey('month', $point);
            $this->assertArrayHasKey('total_hours_all_cooperatives', $point);
            $this->assertArrayHasKey('active_cooperatives', $point);
            $this->assertMatchesRegularExpression('/^\d{4}-\d{2}$/', $point['month']);
        }
    }
}
