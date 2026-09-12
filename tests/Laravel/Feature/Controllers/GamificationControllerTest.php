<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for GamificationV2Controller — profile, badges, leaderboard, daily rewards, shop.
 *
 * Routes map to GamificationV2Controller (not GamificationController).
 */
class GamificationControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  PROFILE
    // ------------------------------------------------------------------

    public function test_profile_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_profile_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(401);
    }

    public function test_profile_returns_404_for_nonexistent_user(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/profile?user_id=999999');

        $response->assertStatus(404);
    }

    public function test_profile_marks_own_profile(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(200);
        $response->assertJsonPath('data.is_own_profile', true);
    }

    public function test_profile_other_user_not_own(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/gamification/profile?user_id={$other->id}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.is_own_profile', false);
    }

    // ------------------------------------------------------------------
    //  BADGES
    // ------------------------------------------------------------------

    public function test_badges_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/badges');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_badges_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/badges');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  BADGE DETAIL
    // ------------------------------------------------------------------

    public function test_show_badge_returns_404_for_nonexistent_key(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/badges/nonexistent_badge_key');

        $response->assertStatus(404);
    }

    public function test_show_badge_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/badges/some_key');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  LEADERBOARD
    // ------------------------------------------------------------------

    public function test_leaderboard_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/leaderboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_leaderboard_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/leaderboard');

        $response->assertStatus(401);
    }

    public function test_leaderboard_supports_period_filter(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/leaderboard?period=month');

        $response->assertStatus(200);
    }

    public function test_leaderboard_supports_type_filter(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/leaderboard?type=xp');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  DAILY REWARD
    // ------------------------------------------------------------------

    public function test_daily_reward_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/daily-reward');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_daily_reward_status_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/daily-reward');

        $response->assertStatus(401);
    }

    public function test_claim_daily_reward_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/gamification/daily-reward');

        $response->assertStatus(401);
    }

    public function test_claim_daily_reward_replay_returns_committed_reward_without_paying_twice(): void
    {
        $user = $this->authenticatedUser(['xp' => 0]);

        $first = $this->apiPost('/v2/gamification/daily-reward');
        $replay = $this->apiPost('/v2/gamification/daily-reward');

        $first->assertOk();
        $replay->assertOk()
            ->assertJsonPath('data.claimed', true)
            ->assertJsonPath('data.idempotent_replay', true)
            ->assertJsonPath('data.reward.xp_earned', $first->json('data.reward.xp_earned'));
        $this->assertSame((int) $first->json('data.reward.xp_earned'), (int) $user->fresh()->xp);
        $this->assertSame(1, DB::table('daily_rewards')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->count());
    }

    // ------------------------------------------------------------------
    //  CHALLENGES
    // ------------------------------------------------------------------

    public function test_challenges_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/challenges');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_challenges_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/challenges');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  COLLECTIONS
    // ------------------------------------------------------------------

    public function test_collections_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/collections');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_collections_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/collections');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  SHOP
    // ------------------------------------------------------------------

    public function test_shop_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/shop');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_shop_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/shop');

        $response->assertStatus(401);
    }

    public function test_purchase_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/gamification/shop/purchase', [
            'item_id' => 1,
        ]);

        $response->assertStatus(401);
    }

    public function test_purchase_requires_item_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/gamification/shop/purchase', []);

        $response->assertStatus(400);
    }

    public function test_purchase_requires_idempotency_key(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/gamification/shop/purchase', ['item_id' => 1]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.field', 'idempotency_key');
    }

    public function test_purchase_replay_returns_the_original_purchase_without_spending_xp_twice(): void
    {
        $user = $this->authenticatedUser(['xp' => 100]);
        $itemId = (int) DB::table('xp_shop_items')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'item_key' => 'mobile-replay-' . uniqid(),
            'name' => 'Replay-safe reward',
            'description' => 'Test reward',
            'item_type' => 'perk',
            'xp_cost' => 10,
            'stock_limit' => null,
            'per_user_limit' => null,
            'is_active' => 1,
            'display_order' => 0,
        ]);
        $payload = ['item_id' => $itemId, 'idempotency_key' => 'mobile-xp-replay-attempt-1'];

        $first = $this->apiPost('/v2/gamification/shop/purchase', $payload);
        $replay = $this->apiPost('/v2/gamification/shop/purchase', $payload);

        $first->assertOk();
        $replay->assertOk()->assertJsonPath('data.idempotent_replay', true);
        $this->assertSame(90, (int) $user->fresh()->xp);
        $this->assertSame(1, DB::table('user_xp_purchases')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->where('item_id', $itemId)
            ->count());
    }

    public function test_purchase_rejects_reusing_a_key_for_another_item(): void
    {
        $user = $this->authenticatedUser(['xp' => 100]);
        $itemIds = [];
        foreach (['first', 'second'] as $suffix) {
            $itemIds[] = (int) DB::table('xp_shop_items')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'item_key' => 'mobile-conflict-' . $suffix . '-' . uniqid(),
                'name' => ucfirst($suffix) . ' reward',
                'description' => 'Test reward',
                'item_type' => 'perk',
                'xp_cost' => 10,
                'stock_limit' => null,
                'per_user_limit' => null,
                'is_active' => 1,
                'display_order' => 0,
            ]);
        }
        $key = 'mobile-xp-conflict-attempt-1';

        $this->apiPost('/v2/gamification/shop/purchase', [
            'item_id' => $itemIds[0],
            'idempotency_key' => $key,
        ])->assertOk();
        $this->apiPost('/v2/gamification/shop/purchase', [
            'item_id' => $itemIds[1],
            'idempotency_key' => $key,
        ])->assertStatus(409);

        $this->assertSame(90, (int) $user->fresh()->xp);
        $this->assertSame(1, DB::table('user_xp_purchases')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $user->id)
            ->count());
    }

    // ------------------------------------------------------------------
    //  SHOWCASE
    // ------------------------------------------------------------------

    public function test_update_showcase_requires_authentication(): void
    {
        $response = $this->apiPut('/v2/gamification/showcase', [
            'badge_keys' => [],
        ]);

        $response->assertStatus(401);
    }

    public function test_update_showcase_validates_badge_keys_is_array(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/gamification/showcase', [
            'badge_keys' => 'not_an_array',
        ]);

        $response->assertStatus(400);
    }

    public function test_update_showcase_validates_max_5_badges(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/gamification/showcase', [
            'badge_keys' => ['a', 'b', 'c', 'd', 'e', 'f'],
        ]);

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  SEASONS
    // ------------------------------------------------------------------

    public function test_seasons_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/seasons');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_current_season_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/seasons/current');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_current_season_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/seasons/current');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  NEXUS SCORE
    // ------------------------------------------------------------------

    public function test_nexus_score_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/nexus-score');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_nexus_score_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/gamification/nexus-score');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  CLAIM CHALLENGE
    // ------------------------------------------------------------------

    public function test_claim_challenge_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/gamification/challenges/999999/claim');

        $response->assertStatus(404);
    }

    public function test_claim_challenge_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/gamification/challenges/1/claim');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_profile_cannot_see_other_tenant_user(): void
    {
        $this->authenticatedUser();
        $otherTenantUser = User::factory()->forTenant(999)->create();

        $response = $this->apiGet("/v2/gamification/profile?user_id={$otherTenantUser->id}");

        // Should return 404 since user doesn't belong to current tenant
        $response->assertStatus(404);
    }
}
