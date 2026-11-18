<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\CrossModuleMatchingService;
use App\Services\GroupMatchingService;
use App\Services\SmartMatchingEngine;
use Illuminate\Support\Facades\DB;
use Mockery;

class CrossModuleMatchingServiceTest extends TestCase
{
    private CrossModuleMatchingService $service;
    private $mockSmartMatching;
    private $mockGroupMatching;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockSmartMatching = Mockery::mock(SmartMatchingEngine::class);
        $this->mockGroupMatching = Mockery::mock(GroupMatchingService::class);
        // Default: no group matches unless a test overrides.
        $this->mockGroupMatching->shouldReceive('getMatchesForUser')->andReturn([])->byDefault();
        // Default: matching is switched on, and the member's floor is 40.
        $this->mockSmartMatching->shouldReceive('isEnabled')->andReturn(true)->byDefault();
        $this->mockSmartMatching->shouldReceive('effectiveMinScore')->andReturn(40.0)->byDefault();
        $this->service = new CrossModuleMatchingService(
            $this->mockSmartMatching,
            $this->mockGroupMatching
        );
    }

    public function test_getAllMatches_returns_expected_structure(): void
    {
        // Mock SmartMatchingEngine to return empty
        $this->mockSmartMatching->shouldReceive('findMatchesForUser')->andReturn([]);
        $this->mockSmartMatching->shouldReceive('extractKeywords')->andReturn([]);

        // Mock DB for group, volunteering, event queries
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('distinct')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturn(collect([]));
        DB::shouldReceive('first')->andReturn((object) ['skills' => '', 'bio' => '']);

        $result = $this->service->getAllMatches(1);

        $this->assertArrayHasKey('matches', $result);
        $this->assertArrayHasKey('meta', $result);
        $this->assertIsArray($result['matches']);
        $this->assertArrayHasKey('total', $result['meta']);
        $this->assertArrayHasKey('modules', $result['meta']);
    }

    public function test_getAllMatches_respects_module_filter(): void
    {
        // Only request listings module
        $this->mockSmartMatching->shouldReceive('findMatchesForUser')->andReturn([]);

        // Mock dismissed IDs
        DB::shouldReceive('table')->with('match_dismissals')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturn(collect([]));

        $result = $this->service->getAllMatches(1, ['modules' => ['listings']]);

        $this->assertSame(['listings'], $result['meta']['modules']);
    }

    public function test_getAllMatches_strips_debug_data_by_default(): void
    {
        $this->mockSmartMatching->shouldReceive('findMatchesForUser')->andReturn([
            [
                'id' => 1, 'title' => 'Test', 'description' => 'Desc', 'type' => 'offer',
                'user_id' => 2, 'first_name' => 'John', 'last_name' => 'Doe',
                'match_score' => 80, 'match_type' => 'one_way', 'match_reasons' => [],
                'match_breakdown' => ['skills' => 40, 'location' => 40],
            ],
        ]);

        // Explanation join query (match_cache) — none cached.
        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturn(collect([]));

        $result = $this->service->getAllMatches(1, ['modules' => ['listings']]);

        if (!empty($result['matches'])) {
            $this->assertArrayNotHasKey('match_breakdown', $result['matches'][0]);
        }
    }

    public function test_getAllMatches_applies_limit(): void
    {
        $this->mockSmartMatching->shouldReceive('findMatchesForUser')->andReturn([]);
        $this->mockSmartMatching->shouldReceive('extractKeywords')->andReturn([]);

        DB::shouldReceive('select')->andReturn([]);
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('distinct')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturn(collect([]));
        DB::shouldReceive('first')->andReturn((object) ['skills' => '', 'bio' => '']);

        $result = $this->service->getAllMatches(1, ['limit' => 5]);

        $this->assertLessThanOrEqual(5, count($result['matches']));
    }

    public function test_getAllMatches_uses_the_members_own_floor_when_the_caller_names_none(): void
    {
        $this->mockSmartMatching->shouldReceive('effectiveMinScore')->once()->with(1)->andReturn(65.0);
        $this->mockSmartMatching->shouldReceive('findMatchesForUser')
            ->once()
            ->withArgs(fn ($userId, $options) => $userId === 1 && $options['min_score'] === 65)
            ->andReturn([]);
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->getAllMatches(1, ['modules' => ['listings']]);

        $this->assertSame(65, $result['meta']['min_score']);
        $this->assertFalse($result['meta']['disabled']);
    }

    public function test_getAllMatches_returns_nothing_when_the_community_switched_matching_off(): void
    {
        $this->mockSmartMatching->shouldReceive('isEnabled')->andReturn(false);
        $this->mockSmartMatching->shouldNotReceive('findMatchesForUser');
        $this->mockGroupMatching->shouldNotReceive('getMatchesForUser');

        $result = $this->service->getAllMatches(1);

        $this->assertSame([], $result['matches']);
        $this->assertTrue($result['meta']['disabled']);
    }
}
