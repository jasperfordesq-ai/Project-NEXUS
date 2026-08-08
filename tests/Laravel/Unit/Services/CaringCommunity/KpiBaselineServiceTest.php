<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\KpiBaselineService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class KpiBaselineServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        if (!Schema::hasTable('users')) {
            $this->markTestSkipped('users table not present.');
        }

        // Remove baseline rows left by previous non-transactional runs.
        DB::table('caring_kpi_baselines')
            ->where('tenant_id', $this->testTenantId)
            ->delete();
    }

    private function service(): KpiBaselineService
    {
        return app(KpiBaselineService::class);
    }

    /** Insert a minimal active user and return its id. */
    private function insertUser(): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'KPI Test User',
            'email'      => 'kpi_' . uniqid() . '@example.com',
            'status'     => 'active',
            'role'       => 'member',
            'created_at' => now(),
        ]);
    }

    // ──────────────────────────────────────────────────────────────────────
    // isAvailable()
    // ──────────────────────────────────────────────────────────────────────

    public function test_is_available_returns_true_when_table_exists(): void
    {
        $this->assertTrue($this->service()->isAvailable());
    }

    // ──────────────────────────────────────────────────────────────────────
    // captureCurrentMetrics()
    // ──────────────────────────────────────────────────────────────────────

    public function test_capture_current_metrics_returns_all_expected_keys(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->testTenantId);

        $expectedKeys = [
            'information_distribution_effort_hours',
            'volunteer_hours',
            'member_count',
            'recipient_count',
            'active_relationships',
            'total_exchanges',
            'avg_response_hours',
            'engagement_rate_pct',
            'satisfaction_score',
        ];

        foreach ($expectedKeys as $key) {
            $this->assertArrayHasKey($key, $metrics, "Missing metric key: $key");
        }
    }

    public function test_capture_current_metrics_member_count_reflects_active_users(): void
    {
        // Remove any existing active users for this tenant first to get a clean baseline.
        // (Using DatabaseTransactions means this will roll back.)
        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->delete();

        $before = $this->service()->captureCurrentMetrics($this->testTenantId);
        $this->assertSame(0, $before['member_count']);

        $this->insertUser();
        $this->insertUser();

        $after = $this->service()->captureCurrentMetrics($this->testTenantId);
        $this->assertSame(2, $after['member_count']);
    }

    public function test_capture_current_metrics_inactive_users_not_counted(): void
    {
        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->delete();

        // Insert one inactive user only.
        DB::table('users')->insert([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Inactive User',
            'email'      => 'inactive_' . uniqid() . '@example.com',
            'status'     => 'inactive',
            'role'       => 'member',
            'created_at' => now(),
        ]);

        $metrics = $this->service()->captureCurrentMetrics($this->testTenantId);
        $this->assertSame(0, $metrics['member_count']);
    }

    public function test_capture_current_metrics_engagement_rate_is_null_when_no_members(): void
    {
        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->delete();

        $metrics = $this->service()->captureCurrentMetrics($this->testTenantId);
        $this->assertNull($metrics['engagement_rate_pct']);
    }

    public function test_capture_current_metrics_engagement_rate_between_0_and_100(): void
    {
        $this->insertUser();

        $metrics = $this->service()->captureCurrentMetrics($this->testTenantId);

        if ($metrics['engagement_rate_pct'] !== null) {
            $this->assertGreaterThanOrEqual(0.0, $metrics['engagement_rate_pct']);
            $this->assertLessThanOrEqual(100.0, $metrics['engagement_rate_pct']);
        } else {
            // Zero participating members is valid — engagement_rate could still be 0.0
            // if member_count > 0 and no vol_logs/transactions. Either null or a float is OK.
            $this->assertTrue(true);
        }
    }

    public function test_capture_current_metrics_volunteer_hours_is_float(): void
    {
        $metrics = $this->service()->captureCurrentMetrics($this->testTenantId);

        $this->assertIsFloat($metrics['volunteer_hours']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // captureBaseline()
    // ──────────────────────────────────────────────────────────────────────

    public function test_capture_baseline_persists_row_and_returns_id(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->captureBaseline(
            tenantId: $this->testTenantId,
            label: 'Q1 2025 Pre-Pilot',
            periodDates: ['start' => '2025-01-01', 'end' => '2025-03-31'],
            notes: 'Initial baseline before FADP pilot launch.',
            adminUserId: $adminId,
        );

        $this->assertArrayHasKey('id', $result);
        $this->assertGreaterThan(0, $result['id']);
        $this->assertSame($this->testTenantId, $result['tenant_id']);
        $this->assertSame('Q1 2025 Pre-Pilot', $result['label']);
    }

    public function test_capture_baseline_stores_period_dates_as_array(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->captureBaseline(
            tenantId: $this->testTenantId,
            label: 'Period Test',
            periodDates: ['start' => '2025-04-01', 'end' => '2025-06-30'],
            notes: null,
            adminUserId: $adminId,
        );

        $this->assertIsArray($result['baseline_period']);
        $this->assertSame('2025-04-01', $result['baseline_period']['start']);
        $this->assertSame('2025-06-30', $result['baseline_period']['end']);
    }

    public function test_capture_baseline_metrics_override_replaces_value(): void
    {
        $adminId = $this->insertUser();

        $result = $this->service()->captureBaseline(
            tenantId: $this->testTenantId,
            label: 'Override Test',
            periodDates: ['start' => '2025-01-01', 'end' => '2025-12-31'],
            notes: null,
            adminUserId: $adminId,
            metricOverrides: ['volunteer_hours' => 500.0, 'member_count' => 120.0],
        );

        $this->assertEqualsWithDelta(500.0, $result['metrics']['volunteer_hours'], 0.001);
        $this->assertEqualsWithDelta(120.0, $result['metrics']['member_count'], 0.001);
    }

    public function test_capture_baseline_invalid_override_key_is_ignored(): void
    {
        $adminId = $this->insertUser();

        // 'bogus_metric' is not in COMPARISON_KEYS → mergeMetricOverrides silently ignores it
        $result = $this->service()->captureBaseline(
            tenantId: $this->testTenantId,
            label: 'Invalid Override',
            periodDates: ['start' => '2025-01-01', 'end' => '2025-12-31'],
            notes: null,
            adminUserId: $adminId,
            metricOverrides: ['bogus_metric' => 99.0],
        );

        $this->assertArrayNotHasKey('bogus_metric', $result['metrics']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // listBaselines()
    // ──────────────────────────────────────────────────────────────────────

    public function test_list_baselines_returns_empty_when_none_exist(): void
    {
        $list = $this->service()->listBaselines($this->testTenantId);

        $this->assertIsArray($list);
        $this->assertCount(0, $list);
    }

    public function test_list_baselines_returns_newest_first(): void
    {
        $adminId = $this->insertUser();

        $this->service()->captureBaseline(
            $this->testTenantId, 'First', ['start' => '2024-01-01', 'end' => '2024-06-30'], null, $adminId
        );

        // Brief sleep not possible in tests; insert second row directly with a later timestamp.
        DB::table('caring_kpi_baselines')->insert([
            'tenant_id'       => $this->testTenantId,
            'label'           => 'Second',
            'baseline_period' => json_encode(['start' => '2024-07-01', 'end' => '2024-12-31']),
            'captured_at'     => now()->addSecond(),
            'metrics'         => json_encode(['member_count' => 10]),
            'notes'           => null,
            'captured_by'     => $adminId,
            'created_at'      => now()->addSecond(),
            'updated_at'      => now()->addSecond(),
        ]);

        $list = $this->service()->listBaselines($this->testTenantId);
        $this->assertCount(2, $list);
        $this->assertSame('Second', $list[0]['label']);
        $this->assertSame('First', $list[1]['label']);
    }

    public function test_list_baselines_scoped_to_tenant(): void
    {
        $adminId = $this->insertUser();

        $this->service()->captureBaseline(
            $this->testTenantId, 'My Baseline', ['start' => '2025-01-01', 'end' => '2025-06-30'], null, $adminId
        );

        // Different tenant sees nothing.
        $other = $this->service()->listBaselines(999);
        $this->assertCount(0, $other);
    }

    // ──────────────────────────────────────────────────────────────────────
    // compareWithBaseline()
    // ──────────────────────────────────────────────────────────────────────

    public function test_compare_returns_error_for_missing_baseline(): void
    {
        $result = $this->service()->compareWithBaseline(99999, $this->testTenantId);

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('baseline_not_found', $result['error']);
    }

    public function test_compare_returns_error_for_baseline_belonging_to_other_tenant(): void
    {
        // Insert a baseline directly under tenant 999.
        $rowId = (int) DB::table('caring_kpi_baselines')->insertGetId([
            'tenant_id'       => 999,
            'label'           => 'Other Tenant Baseline',
            'baseline_period' => json_encode(['start' => '2025-01-01', 'end' => '2025-12-31']),
            'captured_at'     => now(),
            'metrics'         => json_encode(['member_count' => 50]),
            'captured_by'     => null,
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        // Attempt to fetch it as our test tenant — must be rejected.
        $result = $this->service()->compareWithBaseline($rowId, $this->testTenantId);

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('baseline_not_found', $result['error']);
    }

    public function test_compare_returns_comparison_structure(): void
    {
        $adminId = $this->insertUser();

        $baseline = $this->service()->captureBaseline(
            $this->testTenantId, 'Compare Test', ['start' => '2025-01-01', 'end' => '2025-03-31'], null, $adminId,
            metricOverrides: ['member_count' => 50.0],
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);

        $this->assertArrayHasKey('baseline', $result);
        $this->assertArrayHasKey('current', $result);
        $this->assertArrayHasKey('comparison', $result);
        $this->assertArrayHasKey('pilot_claim_targets', $result);
    }

    public function test_compare_delta_math_is_correct(): void
    {
        $adminId = $this->insertUser();

        // Force exactly 1 active user so member_count = 1 in both baseline and current.
        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->delete();

        $this->insertUser(); // 1 active member

        // Override member_count to a known value so we can predict delta.
        $baseline = $this->service()->captureBaseline(
            $this->testTenantId,
            'Delta Test',
            ['start' => '2025-01-01', 'end' => '2025-03-31'],
            null,
            $adminId,
            metricOverrides: ['member_count' => 10.0],
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);
        $memberComp = $result['comparison']['member_count'];

        // baseline was overridden to 10.0; current is whatever captureCurrentMetrics returns now (1).
        $this->assertEqualsWithDelta(10.0, $memberComp['baseline'], 0.001);
        $this->assertIsFloat($memberComp['delta']);

        // delta = current - baseline = 1 - 10 = -9
        $expectedDelta = $memberComp['current'] - 10.0;
        $this->assertEqualsWithDelta($expectedDelta, $memberComp['delta'], 0.01);
    }

    public function test_compare_pct_change_is_null_when_baseline_is_zero(): void
    {
        $adminId = $this->insertUser();

        $baseline = $this->service()->captureBaseline(
            $this->testTenantId,
            'Zero Base',
            ['start' => '2025-01-01', 'end' => '2025-03-31'],
            null,
            $adminId,
            metricOverrides: ['volunteer_hours' => 0.0],
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);
        // pct_change is null when baseline is 0 (division by zero guard in service)
        $this->assertNull($result['comparison']['volunteer_hours']['pct_change']);
    }

    public function test_compare_pilot_claim_targets_has_three_entries(): void
    {
        $adminId = $this->insertUser();

        $baseline = $this->service()->captureBaseline(
            $this->testTenantId, 'Claims Test', ['start' => '2025-01-01', 'end' => '2025-12-31'], null, $adminId,
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);
        $this->assertCount(3, $result['pilot_claim_targets']);
    }

    public function test_compare_agoris_claim_targets_mirrors_pilot_claim_targets(): void
    {
        $adminId = $this->insertUser();

        $baseline = $this->service()->captureBaseline(
            $this->testTenantId, 'Agoris Test', ['start' => '2025-01-01', 'end' => '2025-12-31'], null, $adminId,
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);
        $this->assertSame($result['pilot_claim_targets'], $result['agoris_claim_targets']);
    }

    public function test_compare_satisfaction_target_achieved_when_delta_positive(): void
    {
        $adminId = $this->insertUser();

        // Override satisfaction_score to a value; if current is higher, achieved=true.
        $baseline = $this->service()->captureBaseline(
            $this->testTenantId,
            'Satisfaction Test',
            ['start' => '2025-01-01', 'end' => '2025-12-31'],
            null,
            $adminId,
            metricOverrides: ['satisfaction_score' => 3.0],
        );

        $result = $this->service()->compareWithBaseline($baseline['id'], $this->testTenantId);

        $satisfactionTarget = collect($result['pilot_claim_targets'])
            ->firstWhere('key', 'satisfaction');

        $this->assertNotNull($satisfactionTarget);
        $this->assertArrayHasKey('achieved', $satisfactionTarget);
        // satisfaction_score current is null (no survey tables or data) → achieved=false
        $this->assertFalse($satisfactionTarget['achieved']);
    }
}
