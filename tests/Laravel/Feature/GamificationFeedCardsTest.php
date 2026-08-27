<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Gamification milestones are NOT feed content.
 *
 * `badge_earned` / `level_up` rows used to be written to `feed_activity` by
 * GamificationService, and every client rendered them as a full-width
 * celebratory card. They were removed on the owner's instruction (2026-08-27)
 * because they crowded member content out of the feed.
 *
 * Two things must hold, and this file pins both:
 *
 *  1. No new milestone row is written, and no milestone (new OR historical) is
 *     ever served by the feed. Production databases still hold the rows written
 *     before this change, so the read filter matters as much as the write.
 *  2. Everything ELSE about gamification still works — the badge is granted, the
 *     XP is awarded, the level is raised. "Remove the feed cards" must not
 *     become "quietly disable gamification".
 *
 * Historical context worth keeping: these rows were originally written with a
 * literal source_id = 0, which the uq_tenant_source unique key collapsed into
 * ONE shared row per tenant per type — its author overwritten by each award, and
 * served with id = 0 so no admin action could address it. The fix was
 * source_id = user_id. If milestone cards are ever brought back, they must be
 * per-user rows, never source_id 0.
 */
class GamificationFeedCardsTest extends TestCase
{
    use DatabaseTransactions;

    private const BADGE_A = ['key' => 'test_badge_a', 'name' => 'Test Badge A', 'icon' => 'A'];

    protected function setUp(): void
    {
        parent::setUp();

        DB::table('tenant_settings')->insertOrIgnore([
            [
                'tenant_id'     => $this->testTenantId,
                'category'      => 'general',
                'setting_key'   => 'gamification_enabled',
                'setting_value' => '1',
                'setting_type'  => 'boolean',
            ],
        ]);
    }

    /**
     * Factory creates fire model events whose scoped listeners reset
     * TenantContext in CLI (see AwardXpOnVolLogApprovedTest) — re-pin it
     * before every direct GamificationService call so tenant-scoped writes
     * land on the test tenant instead of the fallback tenant.
     */
    private function pinTenant(): void
    {
        TenantContext::setById($this->testTenantId);
    }

    private function milestoneRowCount(string $sourceType, int $userId): int
    {
        return DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', $sourceType)
            ->where('source_id', $userId)
            ->count();
    }

    /**
     * Insert a milestone row the way GamificationService used to, bypassing
     * FeedActivityService (whose VALID_TYPES now rejects these types). This is
     * the state of every production database that ran the old code.
     */
    private function insertHistoricalMilestone(string $sourceType, int $userId, string $title): void
    {
        DB::table('feed_activity')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $userId,
            'source_type' => $sourceType,
            'source_id'   => $userId,
            'title'       => $title,
            'content'     => $title,
            'metadata'    => json_encode(['legacy' => true]),
            'is_visible'  => 1,
            'created_at'  => now(),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function feedItems(string $query): array
    {
        $response = $this->apiGet($query);
        $response->assertStatus(200);

        return $response->json('data.items') ?? $response->json('data') ?? [];
    }

    // =========================================================================
    // Write path — nothing is recorded any more
    // =========================================================================

    public function test_badge_award_writes_no_feed_card(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();

        $this->pinTenant();
        GamificationService::awardBadge($user->id, self::BADGE_A);

        $this->assertSame(
            0,
            $this->milestoneRowCount('badge_earned', $user->id),
            'Awarding a badge must not create a feed card',
        );
    }

    public function test_level_up_writes_no_feed_card(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['xp' => 0, 'level' => 1]);

        // 150 XP crosses the level-2 threshold (100).
        $this->pinTenant();
        GamificationService::awardXP($user->id, 150, 'test_action', 'Regression test XP');

        $this->assertSame(
            0,
            $this->milestoneRowCount('level_up', $user->id),
            'Levelling up must not create a feed card',
        );
    }

    // =========================================================================
    // The rest of gamification must be untouched
    // =========================================================================

    public function test_badge_is_still_granted_and_xp_still_awarded(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['xp' => 0, 'level' => 1]);

        $this->pinTenant();
        GamificationService::awardBadge($user->id, self::BADGE_A);

        $this->assertNotNull(
            DB::table('user_badges')
                ->where('user_id', $user->id)
                ->where('badge_key', self::BADGE_A['key'])
                ->first(),
            'The badge itself must still be granted',
        );
        $this->assertGreaterThan(
            0,
            (int) DB::table('users')->where('id', $user->id)->value('xp'),
            'Earning a badge must still award XP',
        );
    }

    public function test_level_is_still_raised(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['xp' => 0, 'level' => 1]);

        $this->pinTenant();
        GamificationService::awardXP($user->id, 150, 'test_action', 'Regression test XP');

        $this->assertGreaterThan(
            1,
            (int) DB::table('users')->where('id', $user->id)->value('level'),
            'Crossing the XP threshold must still raise the level',
        );
    }

    // =========================================================================
    // Read path — historical rows stay out of every feed
    // =========================================================================

    public function test_historical_milestone_rows_are_never_served_by_the_feed(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertHistoricalMilestone('badge_earned', $author->id, 'Legacy Badge');
        $this->insertHistoricalMilestone('level_up', $author->id, 'Level 7');

        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($viewer);

        $types = collect($this->feedItems('/v2/feed?type=all&limit=100'))
            ->pluck('type')
            ->all();

        $this->assertNotContains('badge_earned', $types, 'A historical badge card must not reach the feed');
        $this->assertNotContains('level_up', $types, 'A historical level-up card must not reach the feed');
    }

    public function test_type_filter_cannot_request_milestone_cards(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertHistoricalMilestone('badge_earned', $author->id, 'Legacy Badge');

        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($viewer);

        // The filter is not on the allowlist, so it falls back to 'all' — which
        // still excludes milestones. Asking for them by name yields none.
        $types = collect($this->feedItems('/v2/feed?type=badge_earned&limit=100'))
            ->pluck('type')
            ->all();

        $this->assertNotContains('badge_earned', $types);
    }

    public function test_profile_feed_never_serves_milestone_rows(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $this->insertHistoricalMilestone('badge_earned', $author->id, 'Legacy Badge');

        Sanctum::actingAs($author);

        $types = collect($this->feedItems("/v2/feed?type=all&limit=100&user_id={$author->id}"))
            ->pluck('type')
            ->all();

        $this->assertNotContains('badge_earned', $types, 'A profile feed must not show milestone cards either');
    }
}
