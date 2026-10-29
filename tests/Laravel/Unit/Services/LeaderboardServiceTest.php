<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\LeaderboardService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

class LeaderboardServiceTest extends TestCase
{
    private LeaderboardService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LeaderboardService();
    }

    public function test_getLeaderboardByType_invalid_type_returns_empty(): void
    {
        $result = $this->service->getLeaderboardByType(2, 'nonexistent');
        $this->assertSame([], $result);
    }

    public function test_getLeaderboardByType_xp_returns_ranked_results(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) ['user_id' => 1, 'name' => 'Alice', 'first_name' => 'Alice', 'last_name' => 'Smith', 'avatar_url' => null, 'score' => 500, 'level' => 5],
            (object) ['user_id' => 2, 'name' => 'Bob', 'first_name' => 'Bob', 'last_name' => 'Jones', 'avatar_url' => null, 'score' => 300, 'level' => 3],
        ]);

        $result = $this->service->getLeaderboardByType(2, 'xp', 'all_time', 10, 1);

        $this->assertCount(2, $result);
        $this->assertSame(1, $result[0]['rank']);
        $this->assertSame(2, $result[1]['rank']);
        $this->assertTrue($result[0]['is_current_user']);
        $this->assertFalse($result[1]['is_current_user']);
    }

    public function test_getLeaderboardByType_handles_error(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('Query failed'));
        Log::shouldReceive('warning')->once();

        $result = $this->service->getLeaderboardByType(2, 'credits_earned');
        $this->assertSame([], $result);
    }

    public function test_getLeaderboard_static_returns_credits_earned(): void
    {
        DB::shouldReceive('select')->once()->andReturn([]);

        $result = LeaderboardService::getLeaderboard(2, 'monthly', 20);
        $this->assertSame([], $result);
    }

    public function test_getUserRank_returns_rank_data(): void
    {
        DB::shouldReceive('raw')->andReturnUsing(fn ($v) => new \Illuminate\Database\Query\Expression($v));
        DB::shouldReceive('table')->with('users')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) [
            'user_id' => 1, 'name' => 'Alice', 'first_name' => 'Alice',
            'last_name' => 'Smith', 'avatar_url' => null, 'score' => 100,
        ]);
        DB::shouldReceive('count')->andReturn(3);

        $result = $this->service->getUserRank(2, 1);

        $this->assertNotNull($result);
        $this->assertSame(4, $result['rank']);
    }

    public function test_getUserRank_returns_null_for_missing_user(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull($this->service->getUserRank(2, 999));
    }

    public function test_getTopMembers_delegates_to_xp_type(): void
    {
        DB::shouldReceive('select')->once()->andReturn([]);

        $result = $this->service->getTopMembers(2, 10);
        $this->assertSame([], $result);
    }

    public function test_formatScore_credits(): void
    {
        $this->assertSame('100 credits', $this->service->formatScore(100, 'credits_earned'));
        $this->assertSame('100 credits', $this->service->formatScore(100, 'credits_spent'));
    }

    public function test_formatScore_hours(): void
    {
        $this->assertSame('25.5 hours', $this->service->formatScore(25.5, 'vol_hours'));
    }

    public function test_formatScore_xp(): void
    {
        $this->assertSame('1,000 XP', $this->service->formatScore(1000, 'xp'));
    }

    public function test_formatScore_default(): void
    {
        $this->assertSame('42', $this->service->formatScore(42, 'unknown'));
    }

    public function test_getMedalIcon_returns_medals(): void
    {
        $this->assertNotEmpty($this->service->getMedalIcon(1));
        $this->assertNotEmpty($this->service->getMedalIcon(2));
        $this->assertNotEmpty($this->service->getMedalIcon(3));
        $this->assertSame('', $this->service->getMedalIcon(4));
    }

    public function test_leaderboard_types_constant(): void
    {
        $this->assertCount(9, LeaderboardService::LEADERBOARD_TYPES);
    }

    public function test_periods_constant(): void
    {
        $this->assertSame(['all_time', 'season', 'monthly', 'weekly'], LeaderboardService::PERIODS);
    }
}
