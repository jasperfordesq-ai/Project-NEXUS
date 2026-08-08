<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Caring\Forecast;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Tests for the new depth metrics added to CaringCommunityForecastService:
 *  - subRegionDemand()
 *  - helperChurn()
 *  - categoryCoefficientDrift()
 */
class ForecastDepthMetricsTest extends TestCase
{
    use DatabaseTransactions;

    private function bootTenant(): void
    {
        TenantContext::setById($this->testTenantId);
    }

    public function test_sub_region_demand_flags_under_supplied_region(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->bootTenant();
        if (!Schema::hasTable('caring_sub_regions') || !Schema::hasTable('caring_help_requests')) {
            $this->markTestSkipped('Required caring-community tables missing.');
        }

        // Sub-region "Altstadt" with postal code 8001
        $regionId = DB::table('caring_sub_regions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Altstadt',
            'slug' => 'altstadt-' . uniqid(),
            'type' => 'quartier',
            'postal_codes' => json_encode(['8001']),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertGreaterThan(0, $regionId);

        // Requester in Altstadt
        $requester = User::factory()->forTenant($this->testTenantId)->create([
            'location' => '8001 Altstadt, Zurich',
        ]);

        // Five pending help requests over the last 30 days (demand)
        for ($i = 0; $i < 5; $i++) {
            DB::table('caring_help_requests')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $requester->id,
                'what' => 'Need shopping help',
                'when_needed' => 'tomorrow',
                'contact_preference' => 'either',
                'status' => 'pending',
                'created_at' => now()->subDays(5 + $i),
                'updated_at' => now()->subDays(5 + $i),
            ]);
        }

        // No fulfilled hours → coverage = 0 → flagged
        $service = app(CaringCommunityForecastService::class);
        $result = $service->subRegionDemand();

        $row = collect($result['sub_regions'])->firstWhere('id', $regionId);
        $this->assertNotNull($row);
        $this->assertGreaterThan(0, $row['requested_90d']);
        $this->assertSame(0.0, $row['coverage_ratio_90d']);
        $this->assertTrue($row['flagged']);
        $this->assertGreaterThanOrEqual(1, $result['under_supplied_count']);
    }

    public function test_helper_churn_flags_lapsed_helpers(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->bootTenant();
        // Helper A: active 70 days ago, no recent activity → lapsed
        // Helper B: active 70 days ago AND 5 days ago → still active
        $helperA = User::factory()->forTenant($this->testTenantId)->create();
        $helperB = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('vol_logs')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $helperA->id,
                'date_logged' => date('Y-m-d', strtotime('-70 days')),
                'hours' => 2.0,
                'description' => 'Old',
                'status' => 'approved',
                'created_at' => now()->subDays(70),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $helperB->id,
                'date_logged' => date('Y-m-d', strtotime('-70 days')),
                'hours' => 2.0,
                'description' => 'Old',
                'status' => 'approved',
                'created_at' => now()->subDays(70),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $helperB->id,
                'date_logged' => date('Y-m-d', strtotime('-5 days')),
                'hours' => 1.5,
                'description' => 'Recent',
                'status' => 'approved',
                'created_at' => now()->subDays(5),
            ],
        ]);

        $result = app(CaringCommunityForecastService::class)->helperChurn();

        $this->assertGreaterThanOrEqual(2, $result['overall']['prior_active']);
        $this->assertContains($helperA->id, $result['lapsed_helper_ids']);
        $this->assertNotContains($helperB->id, $result['lapsed_helper_ids']);
        $this->assertGreaterThan(0, $result['overall']['churn_rate']);
    }

    public function test_category_coefficient_drift_flags_when_observed_exceeds_threshold(): void
    {
        $this->markTestSkipped(
            'Quarantine [isolation-debt]: order-dependent — passes in full-suite run order, fails when run in a sharded subset under CI. Re-enable after fixing test isolation. Tracked in PR #130.'
        );

        $this->bootTenant();
        if (
            !Schema::hasTable('categories')
            || !Schema::hasColumn('categories', 'substitution_coefficient')
            || !Schema::hasTable('caring_support_relationships')
            || !Schema::hasTable('vol_logs')
            || !Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
        ) {
            $this->markTestSkipped('Required schema for coefficient drift not present.');
        }

        // Pick or create a category for the test tenant
        $catQuery = DB::table('categories');
        if (Schema::hasColumn('categories', 'tenant_id')) {
            $catQuery->where('tenant_id', $this->testTenantId);
        }
        $catRow = $catQuery->first();
        if ($catRow === null) {
            $catData = [
                'name' => 'Test Drift Cat',
                'substitution_coefficient' => 1.00,
                'created_at' => now(),
                'updated_at' => now(),
            ];
            if (Schema::hasColumn('categories', 'tenant_id')) {
                $catData['tenant_id'] = $this->testTenantId;
            }
            if (Schema::hasColumn('categories', 'is_active')) {
                $catData['is_active'] = 1;
            }
            $catId = (int) DB::table('categories')->insertGetId($catData);
        } else {
            $catId = (int) $catRow->id;
            DB::table('categories')->where('id', $catId)->update(['substitution_coefficient' => 1.00]);
        }

        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        // Active relationship with expected_hours = 1.00
        $relId = DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'category_id' => $catId,
            'title' => 'Drift test',
            'frequency' => 'weekly',
            'expected_hours' => 1.00,
            'start_date' => date('Y-m-d', strtotime('-60 days')),
            'status' => 'active',
            'created_at' => now()->subDays(60),
            'updated_at' => now(),
        ]);

        // Observed sessions consistently 2.5 hrs → drift = +150%
        for ($i = 0; $i < 4; $i++) {
            DB::table('vol_logs')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => $supporter->id,
                'caring_support_relationship_id' => $relId,
                'date_logged' => date('Y-m-d', strtotime('-' . (5 + $i) . ' days')),
                'hours' => 2.50,
                'description' => 'Drift seed',
                'status' => 'approved',
                'created_at' => now()->subDays(5 + $i),
            ]);
        }

        $result = app(CaringCommunityForecastService::class)->categoryCoefficientDrift();
        $row = collect($result['categories'])->firstWhere('category_id', $catId);

        $this->assertNotNull($row);
        $this->assertSame(2.5, $row['observed_session_hours']);
        $this->assertSame(1.0, $row['expected_session_hours']);
        $this->assertGreaterThan($result['threshold'], abs($row['drift']));
        $this->assertTrue($row['flagged']);
    }
}
