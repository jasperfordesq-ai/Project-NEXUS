<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\LeaderboardSeasonService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * getUserSeasonRank() against the real season_rankings table.
 *
 * The sibling LeaderboardSeasonServiceTest mocks the DB facade, which is why it
 * never noticed that this method read `season_rankings.season_xp`. That column
 * does not exist — the points live in `score` — so as soon as a member had a
 * stored ranking row the method threw "Undefined array key season_xp" and then
 * ordered by a missing column. Nothing catches it, so the gamification endpoints
 * that call this returned a 500. These tests use the real table on purpose.
 */
class LeaderboardSeasonRankingTest extends TestCase
{
    use DatabaseTransactions;

    private LeaderboardSeasonService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LeaderboardSeasonService();
        TenantContext::setById($this->testTenantId);
    }

    private function makeSeason(): int
    {
        return (int) DB::table('leaderboard_seasons')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'name'       => 'Ranking regression season',
            'start_date' => now()->subDay(),
            'end_date'   => now()->addDay(),
            'status'     => 'active',
            'created_at' => now(),
        ]);
    }

    private function rank(int $seasonId, int $userId, int $score, int $position): void
    {
        DB::table('season_rankings')->insert([
            'season_id'        => $seasonId,
            'user_id'          => $userId,
            'rank_position'    => $position,
            'leaderboard_type' => 'xp',
            'score'            => $score,
            'created_at'       => now(),
        ]);
    }

    public function test_returns_the_stored_ranking_without_throwing(): void
    {
        $seasonId = $this->makeSeason();
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $this->rank($seasonId, (int) $user->id, 500, 1);

        $result = $this->service->getUserSeasonRank((int) $user->id, $seasonId);

        $this->assertIsArray($result);
        $this->assertSame(500, (int) $result['season_xp']);
    }

    public function test_position_counts_the_members_scoring_higher(): void
    {
        $seasonId = $this->makeSeason();
        $leader = User::factory()->forTenant($this->testTenantId)->create();
        $runnerUp = User::factory()->forTenant($this->testTenantId)->create();
        $third = User::factory()->forTenant($this->testTenantId)->create();

        $this->rank($seasonId, (int) $leader->id, 900, 1);
        $this->rank($seasonId, (int) $runnerUp->id, 500, 2);
        $this->rank($seasonId, (int) $third->id, 100, 3);

        $this->assertSame(1, $this->service->getUserSeasonRank((int) $leader->id, $seasonId)['position']);
        $this->assertSame(2, $this->service->getUserSeasonRank((int) $runnerUp->id, $seasonId)['position']);
        $this->assertSame(3, $this->service->getUserSeasonRank((int) $third->id, $seasonId)['position']);
    }

    public function test_stored_ranking_and_fallback_return_the_same_keys(): void
    {
        // A member with no season_rankings row falls back to the users table.
        // Both branches must expose season_xp and position, or a caller reading
        // one shape breaks on the other.
        $seasonId = $this->makeSeason();
        $ranked = User::factory()->forTenant($this->testTenantId)->create();
        $unranked = User::factory()->forTenant($this->testTenantId)->create(['xp' => 42]);
        $this->rank($seasonId, (int) $ranked->id, 500, 1);

        $stored = $this->service->getUserSeasonRank((int) $ranked->id, $seasonId);
        $fallback = $this->service->getUserSeasonRank((int) $unranked->id, $seasonId);

        foreach (['season_xp', 'position'] as $key) {
            $this->assertArrayHasKey($key, $stored, "stored ranking is missing {$key}");
            $this->assertArrayHasKey($key, $fallback, "fallback ranking is missing {$key}");
        }
        $this->assertSame(42, (int) $fallback['season_xp']);
    }
}
