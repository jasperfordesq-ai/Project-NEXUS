<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SmartMatchingAnalyticsService;
use Illuminate\Support\Facades\DB;

class SmartMatchingAnalyticsServiceTest extends TestCase
{
    private SmartMatchingAnalyticsService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SmartMatchingAnalyticsService();
    }

    // ── getOverallStats ──

    public function test_getOverallStats_maps_the_single_pass_row_to_the_response_keys(): void
    {
        // One aggregate row over the community's live cache rows, then the
        // per-type breakdown.
        DB::shouldReceive('selectOne')->once()->andReturn((object) [
            'total' => 100, 'month_cnt' => 40, 'week_cnt' => 12, 'today_cnt' => 3,
            'avg_score' => 72.46, 'avg_dist' => 12.34, 'users_cnt' => 50,
            'hot_cnt' => 30, 'mutual_cnt' => 7,
        ]);
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['match_type' => 'mutual', 'cnt' => 7],
            (object) ['match_type' => 'one_way', 'cnt' => 93],
        ]);

        $result = $this->service->getOverallStats(65.0);

        $this->assertSame(100, $result['total_cached_matches']);
        $this->assertSame(40, $result['total_matches_month']);
        $this->assertSame(12, $result['total_matches_week']);
        $this->assertSame(3, $result['total_matches_today']);
        $this->assertSame(72.5, $result['average_score']);
        $this->assertSame(12.3, $result['average_distance_km']);
        $this->assertSame(50, $result['active_users_with_matches']);
        $this->assertSame(30, $result['hot_matches']);
        $this->assertSame(65.0, $result['hot_match_threshold']);
        $this->assertSame(7, $result['mutual_matches_count']);
        $this->assertSame(['mutual' => 7, 'one_way' => 93], $result['match_type_breakdown']);
    }

    public function test_every_match_cache_query_is_tenant_scoped_and_counts_only_unexpired_rows(): void
    {
        $seen = [];
        DB::shouldReceive('selectOne')->andReturnUsing(function (string $sql, array $bindings = []) use (&$seen) {
            $seen[] = [$sql, $bindings];

            return (object) ['cnt' => 0];
        });
        DB::shouldReceive('select')->andReturnUsing(function (string $sql, array $bindings = []) use (&$seen) {
            $seen[] = [$sql, $bindings];

            return [];
        });

        $this->service->getOverallStats();
        $this->service->getScoreDistribution();
        $this->service->getDistanceDistribution();
        $this->service->getGateImpact();
        $this->service->getPillarAverages();
        $this->service->getConversionFunnel();

        $cacheQueries = 0;
        foreach ($seen as [$sql, $bindings]) {
            $this->assertStringContainsString('tenant_id = ?', $sql, 'Every analytics query is scoped to the community');
            $this->assertNotEmpty($bindings);
            if (str_contains($sql, 'match_cache')) {
                $cacheQueries++;
                $this->assertStringContainsString('expires_at > NOW()', $sql, 'An expired cache row must not be counted: ' . $sql);
            }
        }
        $this->assertGreaterThanOrEqual(10, $cacheQueries);
    }

    public function test_getOverallStats_propagates_query_errors(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('fail'));

        $this->expectException(\RuntimeException::class);
        $this->service->getOverallStats();
    }

    // ── getScoreDistribution ──

    public function test_getScoreDistribution_returns_five_half_open_buckets(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn(
            (object) ['b0' => 1, 'b1' => 2, 'b2' => 3, 'b3' => 4, 'b4' => 5]
        );

        $result = $this->service->getScoreDistribution();

        // Ranges share their edges ("20-40" then "40-60"): each is [min, max),
        // so no score falls between two buckets. The old "21-40 / 41-60" keys
        // described integer bounds that a DECIMAL score of 40.70 slipped past.
        $this->assertSame(
            [
                ['range' => '0-20', 'count' => 1],
                ['range' => '20-40', 'count' => 2],
                ['range' => '40-60', 'count' => 3],
                ['range' => '60-80', 'count' => 4],
                ['range' => '80-100', 'count' => 5],
            ],
            $result
        );
        $this->assertSame(SmartMatchingAnalyticsService::SCORE_BUCKETS, array_column($result, 'range'));
    }

    public function test_getScoreDistribution_propagates_query_errors(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('fail'));
        $this->expectException(\RuntimeException::class);
        $this->service->getScoreDistribution();
    }

    // ── getDistanceDistribution ──

    public function test_getDistanceDistribution_returns_the_documented_bucket_keys(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn(
            (object) ['b0' => 3, 'b1' => 3, 'b2' => 3, 'b3' => 3, 'b4' => 3, 'b5' => 2]
        );

        $result = $this->service->getDistanceDistribution();

        $this->assertSame(SmartMatchingAnalyticsService::DISTANCE_BUCKETS, array_column($result, 'range'));
        $this->assertSame(['range' => 'unknown', 'count' => 2], $result[5]);
    }

    public function test_getDistanceDistribution_leaves_out_an_empty_unknown_bucket(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn(
            (object) ['b0' => 3, 'b1' => 0, 'b2' => 0, 'b3' => 0, 'b4' => 1, 'b5' => 0]
        );

        $result = $this->service->getDistanceDistribution();

        $this->assertSame(['0-5', '5-15', '15-30', '30-50', '50+'], array_column($result, 'range'));
    }

    public function test_getDistanceDistribution_propagates_query_errors(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('fail'));
        $this->expectException(\RuntimeException::class);
        $this->service->getDistanceDistribution();
    }

    // ── getConversionFunnel ──

    public function test_getConversionFunnel_returns_expected_keys(): void
    {
        DB::shouldReceive('selectOne')->times(5)->andReturn(
            (object) ['cnt' => 100],
            (object) ['cnt' => 50],
            (object) ['cnt' => 20],
            (object) ['cnt' => 10],
            (object) ['cnt' => 5],
        );

        $result = $this->service->getConversionFunnel();
        $this->assertArrayHasKey('total_generated', $result);
        $this->assertArrayHasKey('viewed', $result);
        $this->assertArrayHasKey('contacted', $result);
        $this->assertArrayHasKey('conversion_rate', $result);
        $this->assertEquals(20.0, $result['conversion_rate']);
    }

    public function test_getConversionFunnel_returns_zero_rate_when_empty(): void
    {
        DB::shouldReceive('selectOne')->times(5)->andReturn((object) ['cnt' => 0]);

        $result = $this->service->getConversionFunnel();
        $this->assertEquals(0, $result['conversion_rate']);
    }

    public function test_getConversionFunnel_propagates_query_errors(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('fail'));
        $this->expectException(\RuntimeException::class);
        $this->service->getConversionFunnel();
    }

    public function test_getGateImpact_propagates_query_errors(): void
    {
        DB::shouldReceive('selectOne')->andThrow(new \RuntimeException('fail'));
        $this->expectException(\RuntimeException::class);
        $this->service->getGateImpact();
    }

    public function test_getPillarAverages_propagates_query_errors(): void
    {
        DB::shouldReceive('select')->andThrow(new \RuntimeException('fail'));
        $this->expectException(\RuntimeException::class);
        $this->service->getPillarAverages();
    }

    // ── getDashboardSummary ──

    public function test_getDashboardSummary_returns_overview_and_conversion(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['cnt' => 0]);
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->getDashboardSummary();
        $this->assertArrayHasKey('overview', $result);
        $this->assertArrayHasKey('conversion', $result);
        $this->assertEquals('last_30_days', $result['period']);
    }
}
