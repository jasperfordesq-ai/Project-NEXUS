<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gamification;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The XP leaderboard ranked lifetime XP whatever period was chosen, and
 * "season" was mapped to all-time for every type (29 Oct 2026). XP for a period
 * is now the XP logged in it; "season" is the current calendar month, the span
 * LeaderboardSeasonService creates seasons for.
 */
final class LeaderboardPeriodTest extends TestCase
{
    use DatabaseTransactions;

    public function test_xp_ranking_uses_the_chosen_period(): void
    {
        DB::table('users')->where('tenant_id', $this->testTenantId)->update(['xp' => 0]);
        DB::table('user_xp_log')->where('tenant_id', $this->testTenantId)->delete();
        Cache::flush();

        $veteran = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'xp' => 5000]);
        $newcomer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true, 'xp' => 40]);
        DB::table('user_xp_log')->insert([
            ['tenant_id' => $this->testTenantId, 'user_id' => $veteran->id, 'xp_amount' => 5000, 'action' => 'old', 'source_reference' => 'p1', 'created_at' => now()->subMonths(3)],
            ['tenant_id' => $this->testTenantId, 'user_id' => $newcomer->id, 'xp_amount' => 40, 'action' => 'new', 'source_reference' => 'p2', 'created_at' => now()],
        ]);
        Sanctum::actingAs($veteran, ['*']);

        $ids = fn (string $period): array => array_map(
            static fn (array $row): int => (int) $row['user']['id'],
            $this->apiGet('/v2/gamification/leaderboard?type=xp&limit=50&period=' . $period)->json('data') ?? []
        );

        $this->assertSame([(int) $veteran->id, (int) $newcomer->id], array_slice($ids('all'), 0, 2), 'all time: lifetime XP');
        $this->assertSame([(int) $newcomer->id], $ids('season'), 'season: only XP earned this month');
        $this->assertSame([(int) $newcomer->id], $ids('month'));
        $this->assertSame([(int) $newcomer->id], $ids('week'));
    }
}
