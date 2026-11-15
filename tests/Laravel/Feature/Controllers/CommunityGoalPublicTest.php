<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Services\RedisCache;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The shared community goal on the signed-out front page (warmth phase 6, D1).
 *
 * GET /v2/platform/stats — the public, community-scoped figures the front
 * page already reads — carries the running goal's name, what it counts, the
 * target and the community's total so far. Nothing else: no dates, no id, and
 * never a figure for one member. Null when no goal is running.
 */
class CommunityGoalPublicTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::create(2037, 3, 15, 12, 0, 0));
        Cache::flush();
        $this->forgetStats();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['modules' => ['events' => true]]),
        ]);
    }

    protected function tearDown(): void
    {
        $this->forgetStats();
        Carbon::setTestNow();
        Cache::flush();
        parent::tearDown();
    }

    private function forgetStats(): void
    {
        // Cached in the redis store, which Cache::flush() does not reach.
        $redis = app(RedisCache::class);
        $redis->delete('platform_stats_public:tenant:' . $this->testTenantId);
        $redis->delete('platform_stats_public');
    }

    private function storeGoal(array $overrides = []): void
    {
        $config = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('configuration'), true) ?: [];
        $config['community_goal'] = array_merge([
            'id' => 'b0a1c2d3e4f5',
            'title' => "Let's share 500 hours by spring",
            'metric' => 'hours',
            'target' => 500,
            'starts_on' => '2037-03-01',
            'ends_on' => '2037-05-31',
        ], $overrides);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['configuration' => json_encode($config)]);
    }

    public function test_no_goal_means_nothing_new_on_the_front_page(): void
    {
        $data = $this->apiGet('/v2/platform/stats')->assertOk()->json('data');

        $this->assertSame('tenant', $data['scope']);
        $this->assertArrayHasKey('community_goal', $data);
        $this->assertNull($data['community_goal']);
    }

    public function test_a_running_goal_shows_its_name_target_and_the_community_total_only(): void
    {
        $this->storeGoal();
        DB::table('transactions')->insert([
            'tenant_id' => $this->testTenantId,
            'sender_id' => 1,
            'receiver_id' => 1,
            'amount' => 4,
            'transaction_type' => 'exchange',
            'status' => 'completed',
            'created_at' => '2037-03-05 10:00:00',
            'updated_at' => '2037-03-05 10:00:00',
        ]);

        $goal = $this->apiGet('/v2/platform/stats')->assertOk()->json('data.community_goal');

        $this->assertSame(['title', 'metric', 'target', 'current'], array_keys($goal));
        $this->assertSame("Let's share 500 hours by spring", $goal['title']);
        $this->assertSame('hours', $goal['metric']);
        $this->assertSame(500, $goal['target']);
        $this->assertEqualsWithDelta(4.0, (float) $goal['current'], 0.001);
    }

    public function test_a_goal_whose_end_date_has_passed_is_not_shown(): void
    {
        $this->storeGoal(['starts_on' => '2037-01-01', 'ends_on' => '2037-02-28']);

        $this->assertNull($this->apiGet('/v2/platform/stats')->assertOk()->json('data.community_goal'));
    }
}
