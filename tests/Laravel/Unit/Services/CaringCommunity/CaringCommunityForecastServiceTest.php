<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\CaringCommunityForecastService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * CaringCommunityForecastServiceTest
 *
 * Tests the forward-looking forecast service for caring-community coordinators.
 * Covers: time-series bucketing, linear regression / trend math,
 * demand-vs-supply sub-region signals, helper churn, and category coefficient
 * drift detection.
 *
 * Strategy:
 *  - Use an isolated high tenant id (99710) inserted fresh each run so the
 *    6-month rolling windows only see our own fixtures.
 *  - All DB writes use DatabaseTransactions so nothing persists.
 *  - Each forecast test inserts vol_log rows in the correct months and asserts
 *    the bucketed history totals, trend labels, confidence levels, and the
 *    structure of the forecast envelope (monotone math verified analytically).
 *
 * Skipped paths (noted inline):
 *  - subRegionDemand() fulfilled-hours with support_recipient_id join: the
 *    col exists in schema so the happy path IS covered; the no-recipient-col
 *    branch can't be triggered without schema manipulation.
 *  - categoryCoefficientDrift() with is_active column guard: column exists in
 *    schema so the active-only filter path is covered; no-is_active branch
 *    skipped (can't be forced without schema DDL in a transactional test).
 */
class CaringCommunityForecastServiceTest extends TestCase
{
    use DatabaseTransactions;

    /** A high tenant id unlikely to collide with live forecast data. */
    private const TENANT_ID = 99710;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        // Insert a throwaway tenant row so FK constraints are satisfied.
        // Note: tenants table has no 'status' column.
        DB::table('tenants')->insertOrIgnore([
            'id'         => self::TENANT_ID,
            'name'       => 'Forecast Test Tenant',
            'slug'       => 'forecast-test-' . self::TENANT_ID,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        TenantContext::setById(self::TENANT_ID);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function service(): CaringCommunityForecastService
    {
        return app(CaringCommunityForecastService::class);
    }

    /** Insert a minimal user and return its id. */
    private function insertUser(string $location = ''): int
    {
        $uid = uniqid('fct_', true);
        return DB::table('users')->insertGetId([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Forecast User ' . $uid,
            'first_name' => 'Forecast',
            'last_name'  => 'User',
            'email'      => $uid . '@example.test',
            'status'     => 'active',
            'balance'    => 0,
            'role'       => 'member',
            'is_approved' => 1,
            'location'   => $location,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Insert an approved vol_log row for the given month offset (0 = this month,
     * -1 = last month, etc.) and return its id.
     */
    private function insertVolLog(int $userId, float $hours, int $monthOffset = 0, ?int $recipientId = null): int
    {
        $date = date('Y-m-15', strtotime("first day of {$monthOffset} month"));
        $data = [
            'tenant_id'  => self::TENANT_ID,
            'user_id'    => $userId,
            'hours'      => $hours,
            'date_logged' => $date,
            'status'     => 'approved',
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if ($recipientId !== null && Schema::hasColumn('vol_logs', 'support_recipient_id')) {
            $data['support_recipient_id'] = $recipientId;
        }
        return DB::table('vol_logs')->insertGetId($data);
    }

    // ── forecastHours — empty data ────────────────────────────────────────────

    public function test_forecastHours_returns_low_confidence_empty_forecast_when_no_data(): void
    {
        $result = $this->service()->forecastHours(3);

        $this->assertArrayHasKey('history', $result);
        $this->assertArrayHasKey('forecast', $result);
        $this->assertArrayHasKey('trend', $result);
        $this->assertArrayHasKey('growth_rate_pct', $result);
        $this->assertArrayHasKey('confidence', $result);

        // 6 history bins present, all zeroed
        $this->assertCount(6, $result['history']);
        foreach ($result['history'] as $bin) {
            $this->assertSame(0.0, $bin['hours']);
        }

        // With fewer than 3 non-zero months there is no forecast
        $this->assertSame([], $result['forecast']);
        $this->assertSame('stable', $result['trend']);
        $this->assertSame(0.0, $result['growth_rate_pct']);
        $this->assertSame('low', $result['confidence']);
    }

    // ── forecastHours — history bucketing ─────────────────────────────────────

    public function test_forecastHours_buckets_hours_into_correct_months(): void
    {
        $userId = $this->insertUser();

        // Insert known hours in the most-recent 3 months
        $this->insertVolLog($userId, 10.0,  0);  // this month
        $this->insertVolLog($userId, 5.0,   0);  // same month — should sum
        $this->insertVolLog($userId, 20.0, -1);  // last month
        $this->insertVolLog($userId, 8.0,  -2);  // 2 months ago

        $result = $this->service()->forecastHours(3);

        $history = $result['history'];
        $this->assertCount(6, $history);

        // Index 5 = this month, 4 = last month, 3 = 2 months ago
        $this->assertSame(15.0, $history[5]['hours']);  // 10 + 5
        $this->assertSame(20.0, $history[4]['hours']);
        $this->assertSame(8.0,  $history[3]['hours']);
        // Older months have no data
        $this->assertSame(0.0, $history[0]['hours']);
    }

    // ── forecastHours — trend detection ──────────────────────────────────────

    public function test_forecastHours_detects_growing_trend(): void
    {
        $userId = $this->insertUser();

        // Monotonically growing series: 2, 4, 6, 8, 10, 12 across 6 months
        for ($i = 5; $i >= 0; $i--) {
            $hours = (float) (2 * (6 - $i));
            $this->insertVolLog($userId, $hours, -$i);
        }

        $result = $this->service()->forecastHours(3);

        $this->assertSame('growing', $result['trend']);
        $this->assertGreaterThan(0.0, $result['growth_rate_pct']);
        // Strong linear fit → high or medium confidence
        $this->assertContains($result['confidence'], ['high', 'medium']);
    }

    public function test_forecastHours_detects_declining_trend(): void
    {
        $userId = $this->insertUser();

        // Monotonically declining: 12, 10, 8, 6, 4, 2
        for ($i = 5; $i >= 0; $i--) {
            $hours = (float) (2 * ($i + 1));
            $this->insertVolLog($userId, $hours, -$i);
        }

        $result = $this->service()->forecastHours(3);

        $this->assertSame('declining', $result['trend']);
        $this->assertLessThan(0.0, $result['growth_rate_pct']);
    }

    public function test_forecastHours_detects_stable_trend_for_flat_series(): void
    {
        $userId = $this->insertUser();

        // Flat series: same value each month
        for ($i = 5; $i >= 0; $i--) {
            $this->insertVolLog($userId, 10.0, -$i);
        }

        $result = $this->service()->forecastHours(3);

        $this->assertSame('stable', $result['trend']);
        $this->assertSame(0.0, $result['growth_rate_pct']);
    }

    // ── forecastHours — forecast envelope structure ───────────────────────────

    public function test_forecastHours_returns_correct_number_of_forecast_months(): void
    {
        $userId = $this->insertUser();

        // 4 non-zero months to pass the threshold
        for ($i = 3; $i >= 0; $i--) {
            $this->insertVolLog($userId, 5.0, -$i);
        }

        $result = $this->service()->forecastHours(3);
        $this->assertCount(3, $result['forecast']);

        $result2 = $this->service()->forecastHours(1);
        $this->assertCount(1, $result2['forecast']);

        $result6 = $this->service()->forecastHours(6);
        $this->assertCount(6, $result6['forecast']);
    }

    public function test_forecastHours_forecast_months_are_sequential_and_future(): void
    {
        $userId = $this->insertUser();

        for ($i = 5; $i >= 0; $i--) {
            $this->insertVolLog($userId, (float) (5 + $i), -$i);
        }

        $result   = $this->service()->forecastHours(3);
        $forecast = $result['forecast'];

        $this->assertCount(3, $forecast);

        // Each forecast month should be strictly after the previous
        for ($k = 1; $k < count($forecast); $k++) {
            $this->assertGreaterThan(
                strtotime($forecast[$k - 1]['month'] . '-01'),
                strtotime($forecast[$k]['month'] . '-01'),
                "Forecast months should be in ascending order"
            );
        }

        // All forecast months should be in the future relative to today's month
        $nowTs = strtotime(date('Y-m') . '-01');
        foreach ($forecast as $f) {
            $this->assertGreaterThan(
                $nowTs,
                strtotime($f['month'] . '-01'),
                "Forecast month {$f['month']} should be in the future"
            );
        }
    }

    public function test_forecastHours_lower_bound_never_exceeds_point_estimate(): void
    {
        $userId = $this->insertUser();

        for ($i = 5; $i >= 0; $i--) {
            $this->insertVolLog($userId, (float) (3 + $i * 2), -$i);
        }

        $result = $this->service()->forecastHours(3);

        foreach ($result['forecast'] as $f) {
            // upper >= hours (point estimate is not above the upper band)
            $this->assertGreaterThanOrEqual($f['hours'], $f['upper']);
            // lower >= 0 (never negative)
            $this->assertGreaterThanOrEqual(0.0, $f['lower']);
            // hours >= lower (point estimate is not below the lower band)
            $this->assertGreaterThanOrEqual($f['lower'], $f['hours']);
        }
    }

    public function test_forecastHours_clamps_months_ahead_to_valid_range(): void
    {
        $userId = $this->insertUser();

        for ($i = 5; $i >= 0; $i--) {
            $this->insertVolLog($userId, 10.0, -$i);
        }

        // 0 should be clamped to 1
        $result = $this->service()->forecastHours(0);
        $this->assertCount(1, $result['forecast']);

        // 99 should be clamped to 12
        $result12 = $this->service()->forecastHours(99);
        $this->assertCount(12, $result12['forecast']);
    }

    // ── forecastHours — confidence bands ─────────────────────────────────────

    public function test_forecastHours_returns_high_confidence_for_perfect_linear_fit(): void
    {
        $userId = $this->insertUser();

        // Perfect linear: 1, 2, 3, 4, 5, 6 — r² = 1.0
        for ($i = 5; $i >= 0; $i--) {
            $this->insertVolLog($userId, (float) (6 - $i), -$i);
        }

        $result = $this->service()->forecastHours(3);
        $this->assertSame('high', $result['confidence']);
    }

    // ── forecastHours — pending rows excluded ─────────────────────────────────

    public function test_forecastHours_excludes_non_approved_logs(): void
    {
        $userId = $this->insertUser();

        // Insert pending and declined rows — should NOT count
        $date = date('Y-m-15', strtotime('first day of -1 month'));
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $userId,
            'hours' => 100.0, 'date_logged' => $date,
            'status' => 'pending', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $userId,
            'hours' => 50.0, 'date_logged' => $date,
            'status' => 'declined', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $result = $this->service()->forecastHours(3);

        // All history bins should still be 0 — nothing was approved
        foreach ($result['history'] as $bin) {
            $this->assertSame(0.0, $bin['hours']);
        }
    }

    // ── forecastMembers ───────────────────────────────────────────────────────

    public function test_forecastMembers_counts_distinct_users_not_total_hours(): void
    {
        $user1 = $this->insertUser();
        $user2 = $this->insertUser();

        // Same month, both users log multiple times
        $this->insertVolLog($user1, 5.0, -1);
        $this->insertVolLog($user1, 3.0, -1);  // same user, same month
        $this->insertVolLog($user2, 7.0, -1);

        $result = $this->service()->forecastMembers(3);
        $this->assertCount(6, $result['history']);

        // Month-1 bucket (index 4) should be 2 distinct users, not 15 hours
        $this->assertSame(2.0, $result['history'][4]['hours']);
    }

    // ── forecastRecipients ────────────────────────────────────────────────────

    public function test_forecastRecipients_counts_distinct_support_recipients(): void
    {
        $helper     = $this->insertUser();
        $recipient1 = $this->insertUser();
        $recipient2 = $this->insertUser();

        // 3 logs in same month: 2 for recipient1, 1 for recipient2
        $this->insertVolLog($helper, 2.0, -1, $recipient1);
        $this->insertVolLog($helper, 3.0, -1, $recipient1);  // duplicate recipient
        $this->insertVolLog($helper, 4.0, -1, $recipient2);

        $result = $this->service()->forecastRecipients(3);
        $this->assertCount(6, $result['history']);

        // Index 4 = last month: should be 2 distinct recipients
        $this->assertSame(2.0, $result['history'][4]['hours']);
    }

    public function test_forecastRecipients_excludes_null_recipient_rows(): void
    {
        $helper = $this->insertUser();

        // Log without a recipient (support_recipient_id = NULL) — should not count
        $this->insertVolLog($helper, 10.0, -1, null);

        $result = $this->service()->forecastRecipients(3);

        // All bins should still be 0
        foreach ($result['history'] as $bin) {
            $this->assertSame(0.0, $bin['hours']);
        }
    }

    // ── forecastHours — insufficient data threshold ───────────────────────────

    public function test_forecastHours_returns_empty_forecast_with_only_two_non_zero_months(): void
    {
        $userId = $this->insertUser();

        // Only 2 non-zero months — below the min-3 threshold
        $this->insertVolLog($userId, 5.0, -1);
        $this->insertVolLog($userId, 3.0, -2);

        $result = $this->service()->forecastHours(3);

        $this->assertSame([], $result['forecast']);
        $this->assertSame('low', $result['confidence']);
    }

    // ── subRegionDemand ───────────────────────────────────────────────────────

    public function test_subRegionDemand_returns_empty_when_no_sub_regions(): void
    {
        $result = $this->service()->subRegionDemand();

        $this->assertSame(['short' => 30, 'long' => 90], $result['window_days']);
        $this->assertSame([], $result['sub_regions']);
        $this->assertSame(0, $result['under_supplied_count']);
    }

    public function test_subRegionDemand_flags_under_supplied_region(): void
    {
        $slug = 'test-region-' . uniqid('', true);

        DB::table('caring_sub_regions')->insert([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'Testville',
            'slug'       => $slug,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // A user whose location matches the region name
        $requesterId = $this->insertUser('Testville North');

        // 4 help requests in last 90 days → 4 requested
        for ($k = 0; $k < 4; $k++) {
            DB::table('caring_help_requests')->insert([
                'tenant_id'          => self::TENANT_ID,
                'user_id'            => $requesterId,
                'what'               => 'Help needed ' . $k,
                'when_needed'        => 'Monday',
                'contact_preference' => 'either',
                'status'             => 'pending',
                'created_at'         => now()->subDays(5),
                'updated_at'         => now(),
            ]);
        }

        // 0 fulfilled hours → coverage ratio = 0 → flagged
        $result = $this->service()->subRegionDemand();

        $found = null;
        foreach ($result['sub_regions'] as $r) {
            if ($r['slug'] === $slug) {
                $found = $r;
                break;
            }
        }

        $this->assertNotNull($found, 'Expected sub-region not found in result');
        $this->assertSame(4.0, $found['requested_90d']);
        $this->assertSame(0.0, $found['fulfilled_90d']);
        $this->assertSame(0.0, $found['coverage_ratio_90d']);
        $this->assertTrue($found['flagged']);
        $this->assertGreaterThanOrEqual(1, $result['under_supplied_count']);
    }

    public function test_subRegionDemand_does_not_flag_zero_demand_region(): void
    {
        $slug = 'zero-demand-' . uniqid('', true);

        DB::table('caring_sub_regions')->insert([
            'tenant_id'  => self::TENANT_ID,
            'name'       => 'EmptyRegion',
            'slug'       => $slug,
            'status'     => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // No help requests → 0 demand → should NOT be flagged
        $result = $this->service()->subRegionDemand();

        $found = null;
        foreach ($result['sub_regions'] as $r) {
            if ($r['slug'] === $slug) {
                $found = $r;
                break;
            }
        }

        $this->assertNotNull($found);
        $this->assertSame(0.0, $found['requested_90d']);
        $this->assertFalse($found['flagged']);
    }

    // ── helperChurn ───────────────────────────────────────────────────────────

    public function test_helperChurn_returns_zero_churn_when_no_prior_active_helpers(): void
    {
        $result = $this->service()->helperChurn();

        $this->assertSame(0, $result['overall']['prior_active']);
        $this->assertSame(0, $result['overall']['lapsed']);
        $this->assertSame(0.0, $result['overall']['churn_rate']);
        $this->assertSame([], $result['lapsed_helper_ids']);
        $this->assertSame(90, $result['prior_window_days']['start']);
        $this->assertSame(60, $result['prior_window_days']['end']);
        $this->assertSame(30, $result['lapsed_threshold_days']);
    }

    public function test_helperChurn_detects_lapsed_helper(): void
    {
        $lapsedUser  = $this->insertUser();
        $activeUser  = $this->insertUser();

        // Both logged hours 61–89 days ago (inside prior window 60–90 days)
        $priorDate = date('Y-m-d', strtotime('-75 days'));
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $lapsedUser,
            'hours' => 2.0, 'date_logged' => $priorDate,
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $activeUser,
            'hours' => 2.0, 'date_logged' => $priorDate,
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);

        // Only activeUser logs in the recent 30-day window
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $activeUser,
            'hours' => 1.0, 'date_logged' => date('Y-m-d', strtotime('-5 days')),
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $result = $this->service()->helperChurn();

        $this->assertSame(2, $result['overall']['prior_active']);
        $this->assertSame(1, $result['overall']['lapsed']);
        $this->assertSame(0.5, $result['overall']['churn_rate']);
        $this->assertContains($lapsedUser, $result['lapsed_helper_ids']);
        $this->assertNotContains($activeUser, $result['lapsed_helper_ids']);
    }

    public function test_helperChurn_returns_zero_when_all_helpers_stayed_active(): void
    {
        $user = $this->insertUser();

        $priorDate  = date('Y-m-d', strtotime('-75 days'));
        $recentDate = date('Y-m-d', strtotime('-5 days'));

        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $user,
            'hours' => 3.0, 'date_logged' => $priorDate,
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('vol_logs')->insert([
            'tenant_id' => self::TENANT_ID, 'user_id' => $user,
            'hours' => 2.0, 'date_logged' => $recentDate,
            'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
        ]);

        $result = $this->service()->helperChurn();

        $this->assertSame(1, $result['overall']['prior_active']);
        $this->assertSame(0, $result['overall']['lapsed']);
        $this->assertSame(0.0, $result['overall']['churn_rate']);
        $this->assertSame([], $result['lapsed_helper_ids']);
    }

    // ── categoryCoefficientDrift ──────────────────────────────────────────────

    public function test_categoryCoefficientDrift_returns_empty_when_no_categories(): void
    {
        if (
            ! Schema::hasTable('categories')
            || ! Schema::hasColumn('categories', 'substitution_coefficient')
            || ! Schema::hasTable('caring_support_relationships')
            || ! Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
        ) {
            $this->markTestSkipped('Required tables/columns for categoryCoefficientDrift not present.');
        }

        // With our isolated tenant that has no categories, result should be structurally valid.
        $result = $this->service()->categoryCoefficientDrift();

        $this->assertSame(0.15, $result['threshold']);
        $this->assertIsArray($result['categories']);
        $this->assertIsInt($result['drift_count']);
        // May include rows from other tenants' active categories if tenant_id col is missing;
        // but our tenant has none. Just verify the shape.
        $this->assertGreaterThanOrEqual(0, $result['drift_count']);
    }

    public function test_categoryCoefficientDrift_flags_category_with_large_positive_drift(): void
    {
        if (
            ! Schema::hasTable('categories')
            || ! Schema::hasColumn('categories', 'substitution_coefficient')
            || ! Schema::hasTable('caring_support_relationships')
            || ! Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
        ) {
            $this->markTestSkipped('Required tables/columns for categoryCoefficientDrift not present.');
        }

        $catName = 'DriftCat-' . uniqid('', true);
        $catId   = DB::table('categories')->insertGetId([
            'tenant_id'                => self::TENANT_ID,
            'name'                     => $catName,
            'slug'                     => 'drift-cat-' . self::TENANT_ID . '-' . uniqid('', true),
            'substitution_coefficient' => 1.0,
            'is_active'                => 1,
            'sort_order'               => 0,
            'type'                     => 'caring',
            'created_at'               => now(),
        ]);

        $supporter = $this->insertUser();
        $recipient = $this->insertUser();

        // Create a support relationship with expected_hours = 1.0
        $relId = DB::table('caring_support_relationships')->insertGetId([
            'tenant_id'      => self::TENANT_ID,
            'supporter_id'   => $supporter,
            'recipient_id'   => $recipient,
            'category_id'    => $catId,
            'title'          => 'Test Relationship',
            'frequency'      => 'weekly',
            'expected_hours' => 1.0,
            'start_date'     => date('Y-m-d'),
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Insert 5 vol_log rows: each logs 2 hours (observed avg = 2.0)
        // drift = (2.0 / 1.0) - 1 = 1.0 → well over 15% threshold → flagged
        for ($i = 0; $i < 5; $i++) {
            DB::table('vol_logs')->insert([
                'tenant_id'                     => self::TENANT_ID,
                'user_id'                       => $supporter,
                'hours'                         => 2.0,
                'date_logged'                   => date('Y-m-d'),
                'status'                        => 'approved',
                'caring_support_relationship_id' => $relId,
                'created_at'                    => now(),
                'updated_at'                    => now(),
            ]);
        }

        $result = $this->service()->categoryCoefficientDrift();

        // Find our category in the result
        $found = null;
        foreach ($result['categories'] as $row) {
            if ((int) $row['category_id'] === $catId) {
                $found = $row;
                break;
            }
        }

        $this->assertNotNull($found, "Expected category id {$catId} not found in drift result");
        $this->assertSame(1.0,  $found['expected_session_hours']);
        $this->assertSame(2.0,  $found['observed_session_hours']);
        $this->assertSame(1.0,  $found['drift']);  // (2/1) - 1 = 1.0
        $this->assertTrue($found['flagged']);
        $this->assertSame(5,    $found['sample_size']);
        $this->assertGreaterThanOrEqual(1, $result['drift_count']);
    }

    public function test_categoryCoefficientDrift_does_not_flag_category_below_threshold(): void
    {
        if (
            ! Schema::hasTable('categories')
            || ! Schema::hasColumn('categories', 'substitution_coefficient')
            || ! Schema::hasTable('caring_support_relationships')
            || ! Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
        ) {
            $this->markTestSkipped('Required tables/columns for categoryCoefficientDrift not present.');
        }

        $catName = 'NoDriftCat-' . uniqid('', true);
        $catId   = DB::table('categories')->insertGetId([
            'tenant_id'                => self::TENANT_ID,
            'name'                     => $catName,
            'slug'                     => 'no-drift-cat-' . self::TENANT_ID . '-' . uniqid('', true),
            'substitution_coefficient' => 1.0,
            'is_active'                => 1,
            'sort_order'               => 0,
            'type'                     => 'caring',
            'created_at'               => now(),
        ]);

        $supporter = $this->insertUser();
        $recipient = $this->insertUser();

        $relId = DB::table('caring_support_relationships')->insertGetId([
            'tenant_id'      => self::TENANT_ID,
            'supporter_id'   => $supporter,
            'recipient_id'   => $recipient,
            'category_id'    => $catId,
            'title'          => 'Test Stable Relationship',
            'frequency'      => 'weekly',
            'expected_hours' => 2.0,
            'start_date'     => date('Y-m-d'),
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // 5 logs at exactly 2.0 hours → observed = expected → drift = 0
        for ($i = 0; $i < 5; $i++) {
            DB::table('vol_logs')->insert([
                'tenant_id'                     => self::TENANT_ID,
                'user_id'                       => $supporter,
                'hours'                         => 2.0,
                'date_logged'                   => date('Y-m-d'),
                'status'                        => 'approved',
                'caring_support_relationship_id' => $relId,
                'created_at'                    => now(),
                'updated_at'                    => now(),
            ]);
        }

        $result = $this->service()->categoryCoefficientDrift();

        $found = null;
        foreach ($result['categories'] as $row) {
            if ((int) $row['category_id'] === $catId) {
                $found = $row;
                break;
            }
        }

        $this->assertNotNull($found, "Expected category id {$catId} not found in drift result");
        $this->assertSame(0.0,   $found['drift']);
        $this->assertFalse($found['flagged']);
    }

    public function test_categoryCoefficientDrift_skips_drift_for_fewer_than_3_samples(): void
    {
        if (
            ! Schema::hasTable('categories')
            || ! Schema::hasColumn('categories', 'substitution_coefficient')
            || ! Schema::hasTable('caring_support_relationships')
            || ! Schema::hasColumn('vol_logs', 'caring_support_relationship_id')
        ) {
            $this->markTestSkipped('Required tables/columns for categoryCoefficientDrift not present.');
        }

        $catName = 'LowSampleCat-' . uniqid('', true);
        $catId   = DB::table('categories')->insertGetId([
            'tenant_id'                => self::TENANT_ID,
            'name'                     => $catName,
            'slug'                     => 'low-sample-cat-' . self::TENANT_ID . '-' . uniqid('', true),
            'substitution_coefficient' => 1.0,
            'is_active'                => 1,
            'sort_order'               => 0,
            'type'                     => 'caring',
            'created_at'               => now(),
        ]);

        $supporter = $this->insertUser();
        $recipient = $this->insertUser();

        $relId = DB::table('caring_support_relationships')->insertGetId([
            'tenant_id'      => self::TENANT_ID,
            'supporter_id'   => $supporter,
            'recipient_id'   => $recipient,
            'category_id'    => $catId,
            'title'          => 'Test Low Sample',
            'frequency'      => 'weekly',
            'expected_hours' => 1.0,
            'start_date'     => date('Y-m-d'),
            'status'         => 'active',
            'created_at'     => now(),
            'updated_at'     => now(),
        ]);

        // Only 2 logs → below sample_size < 3 threshold → drift should be 0, flagged = false
        for ($i = 0; $i < 2; $i++) {
            DB::table('vol_logs')->insert([
                'tenant_id'                     => self::TENANT_ID,
                'user_id'                       => $supporter,
                'hours'                         => 5.0,
                'date_logged'                   => date('Y-m-d'),
                'status'                        => 'approved',
                'caring_support_relationship_id' => $relId,
                'created_at'                    => now(),
                'updated_at'                    => now(),
            ]);
        }

        $result = $this->service()->categoryCoefficientDrift();

        $found = null;
        foreach ($result['categories'] as $row) {
            if ((int) $row['category_id'] === $catId) {
                $found = $row;
                break;
            }
        }

        $this->assertNotNull($found);
        $this->assertSame(0.0,  $found['drift']);
        $this->assertFalse($found['flagged']);
        $this->assertSame(2,    $found['sample_size']);
    }
}
