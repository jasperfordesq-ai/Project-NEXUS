<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\GroupMatchingService;
use App\Services\GroupRecommendationEngine;
use Illuminate\Support\Facades\DB;
use Mockery;

class GroupMatchingServiceTest extends TestCase
{
    private $mockEngine;
    private GroupMatchingService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockEngine = Mockery::mock(GroupRecommendationEngine::class);
        $this->service = new GroupMatchingService($this->mockEngine);
        $this->setTenantId(7);
    }

    protected function tearDown(): void
    {
        \App\Core\TenantContext::reset();
        parent::tearDown();
    }

    private function setTenantId(int $id): void
    {
        $prop = new \ReflectionProperty(\App\Core\TenantContext::class, 'cachedId');
        $prop->setAccessible(true);
        $prop->setValue(null, $id);
    }

    public function test_warmUpCache_scales_scores_to_0_100_and_preserves_status_on_rewarm(): void
    {
        // Table-exists probe succeeds.
        DB::shouldReceive('selectOne')->andReturn((object) ['1' => 1]);
        // Expired, never-acted-on suggestions are removed first.
        DB::shouldReceive('delete')->once()->withArgs(function ($sql) {
            $normalised = preg_replace('/\s+/', ' ', $sql);
            // Dismissed and joined rows are the member's decision: never pruned.
            return str_contains($normalised, "status IN ('new', 'viewed')");
        })->andReturn(0);
        // One user needing a warm.
        DB::shouldReceive('select')->once()->andReturn([(object) ['id' => 42]]);

        $this->mockEngine->shouldReceive('getRecommendations')->once()->with(42, 10)->andReturn([
            ['id' => 9, 'recommendation_score' => 0.85, 'recommendation_reason' => 'Users like you joined'],
        ]);

        DB::shouldReceive('insert')->once()->withArgs(function ($sql, $bindings) {
            $normalised = preg_replace('/\s+/', ' ', $sql);
            return str_contains($normalised, 'group_match_cache')
                // Re-warm must NOT reset status (dismissals stick).
                && str_contains($normalised, 'ON DUPLICATE KEY UPDATE')
                && !str_contains(explode('ON DUPLICATE KEY UPDATE', $normalised)[1], 'status')
                && (int) $bindings[0] === 7          // tenant_id
                && (int) $bindings[1] === 42         // user_id
                && (int) $bindings[2] === 9          // group_id
                && abs(((float) $bindings[3]) - 85.0) < 0.01; // 0.85 → 85.00
        })->andReturn(true);

        $result = $this->service->warmUpCache(20);

        $this->assertSame(['processed' => 1, 'cached' => 1], $result);
    }

    public function test_getMatchesForUser_serves_cache_in_cross_module_shape(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['1' => 1]);
        DB::shouldReceive('select')->once()->andReturn([(object) [
            'group_id' => 9,
            'match_score' => 72.5,
            'match_reasons' => json_encode(['3 of your connections are members']),
            'matched_at' => '2026-07-01 10:00:00',
            'name' => 'Gardeners United',
            'description' => 'A group for garden lovers',
            'image_url' => null,
            'visibility' => 'public',
            'member_count' => 14,
        ]]);

        // Engine must NOT be called when the cache serves.
        $this->mockEngine->shouldNotReceive('getRecommendations');

        $matches = $this->service->getMatchesForUser(42, 30, 10);

        $this->assertCount(1, $matches);
        $this->assertSame('group', $matches[0]['module']);
        $this->assertSame(9, $matches[0]['group_id']);
        $this->assertSame('Gardeners United', $matches[0]['title']);
        $this->assertEqualsWithDelta(72.5, $matches[0]['match_score'], 0.01);
        $this->assertSame(['3 of your connections are members'], $matches[0]['match_reasons']);
        $this->assertSame('group_recommendation', $matches[0]['match_type']);
    }

    public function test_getMatchesForUser_live_computes_when_cache_is_cold(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['1' => 1]);
        DB::shouldReceive('select')->once()->andReturn([]); // cold cache
        // Groups this member already dismissed or joined: none.
        DB::shouldReceive('table->where->where->whereIn->pluck')->once()->andReturn(collect([]));

        $this->mockEngine->shouldReceive('getRecommendations')->once()->with(42, 10)->andReturn([
            [
                'id' => 5, 'name' => 'Bakers Circle', 'description' => 'Bread and cakes',
                'image_url' => null, 'visibility' => 'public', 'member_count' => 6,
                'recommendation_score' => 0.6, 'recommendation_reason' => 'Popular in your community',
                'created_at' => '2026-06-01 09:00:00',
            ],
            [
                'id' => 6, 'name' => 'Low relevance', 'description' => '',
                'recommendation_score' => 0.1, 'recommendation_reason' => '',
            ],
        ]);

        $matches = $this->service->getMatchesForUser(42, 30, 10);

        // 0.6 → 60 passes min_score 30; 0.1 → 10 is filtered.
        $this->assertCount(1, $matches);
        $this->assertSame(5, $matches[0]['group_id']);
        $this->assertEqualsWithDelta(60.0, $matches[0]['match_score'], 0.01);
    }

    public function test_markStatus_rejects_unknown_status(): void
    {
        $this->assertFalse($this->service->markStatus(42, 9, 'exploded'));
    }
}
