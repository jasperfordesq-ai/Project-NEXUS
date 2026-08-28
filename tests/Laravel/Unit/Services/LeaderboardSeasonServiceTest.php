<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\LeaderboardSeasonService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

class LeaderboardSeasonServiceTest extends TestCase
{
    private LeaderboardSeasonService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LeaderboardSeasonService();
    }

    public function test_getCurrentSeason_returns_null_when_no_table(): void
    {
        DB::shouldReceive('select')->with("SHOW TABLES LIKE 'leaderboard_seasons'")->andReturn([]);

        $this->assertNull($this->service->getCurrentSeason(2));
    }

    public function test_getCurrentSeason_returns_null_when_no_active(): void
    {
        DB::shouldReceive('select')->with("SHOW TABLES LIKE 'leaderboard_seasons'")->andReturn(['x']);

        DB::shouldReceive('table')->with('leaderboard_seasons')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull($this->service->getCurrentSeason(2));
    }

    public function test_getCurrentSeason_returns_array_when_found(): void
    {
        DB::shouldReceive('select')->with("SHOW TABLES LIKE 'leaderboard_seasons'")->andReturn(['x']);

        DB::shouldReceive('table')->with('leaderboard_seasons')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['id' => 1, 'name' => 'March 2026', 'status' => 'active']);

        $result = $this->service->getCurrentSeason(2);
        $this->assertIsArray($result);
        $this->assertSame(1, $result['id']);
    }

    public function test_getAllSeasons_returns_array(): void
    {
        DB::shouldReceive('table')->with('leaderboard_seasons')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getAllSeasons();
        $this->assertSame([], $result);
    }

    public function test_getAllSeasons_handles_error(): void
    {
        DB::shouldReceive('table')->andThrow(new \Exception('Error'));

        $result = $this->service->getAllSeasons();
        $this->assertSame([], $result);
    }

    public function test_getUserSeasonRank_returns_null_when_no_season(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->getUserSeasonRank(1);
        $this->assertNull($result);
    }
}
