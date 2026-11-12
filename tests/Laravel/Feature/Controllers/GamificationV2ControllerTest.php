<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for GamificationV2Controller — badges, leaderboard, challenges, shop, seasons.
 */
class GamificationV2ControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/profile
    // ------------------------------------------------------------------

    public function test_profile_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(401);
    }

    public function test_profile_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(200);
    }

    /**
     * 🔴 Regression: the payload must carry `level_name`.
     *
     * This controller hand-builds its response rather than returning
     * GamificationService::getProfile(), and the two had drifted: the service
     * returned `level_name` and this endpoint did not. The Blade accessible
     * frontend calls the service in-process so it rendered "Level 3
     * (Contributor)", while every HTTP consumer — web-uk, React, mobile — could
     * only ever render "Level 3", because the name was never sent. Found by
     * walking both accessible frontends side by side on 2026-08-13.
     *
     * Asserting the literal name, not merely the key's presence: a null or empty
     * value would satisfy a has-key assertion and still leave the level title
     * blank on screen.
     */
    public function test_profile_includes_level_name_for_http_consumers(): void
    {
        $user = $this->authenticatedUser();

        // 300 XP is the level-3 threshold; level 3 is named "Contributor".
        // The controller trusts users.level rather than recalculating it, so set both.
        $user->forceFill(['xp' => 305, 'level' => 3])->save();

        $response = $this->apiGet('/v2/gamification/profile');

        $response->assertStatus(200);
        $response->assertJsonPath('data.level', 3);
        $response->assertJsonPath('data.level_name', 'Contributor');
    }

    /**
     * The dashboard's "Your progress" card shows the member's own streak
     * (warmth phase 5). It rides on the profile the dashboard already fetches,
     * for the member's OWN profile only: another member's streak is theirs.
     */
    public function test_own_profile_carries_the_members_current_streak(): void
    {
        $user = $this->authenticatedUser();

        $this->apiGet('/v2/gamification/profile')
            ->assertStatus(200)
            ->assertJsonPath('data.current_streak', 0);

        \App\Models\UserStreak::query()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'streak_type' => 'login',
            'current_streak' => 6,
            'longest_streak' => 9,
            'last_activity_date' => now()->toDateString(),
        ]);

        $this->apiGet('/v2/gamification/profile')
            ->assertStatus(200)
            ->assertJsonPath('data.current_streak', 6);
    }

    public function test_another_members_profile_does_not_carry_their_streak(): void
    {
        $this->authenticatedUser();
        $other = \App\Models\User::factory()->forTenant($this->testTenantId)->create();
        \App\Models\UserStreak::query()->create([
            'tenant_id' => $this->testTenantId,
            'user_id' => $other->id,
            'streak_type' => 'login',
            'current_streak' => 12,
            'longest_streak' => 12,
            'last_activity_date' => now()->toDateString(),
        ]);

        $response = $this->apiGet('/v2/gamification/profile?user_id=' . $other->id);
        $response->assertStatus(200);
        $this->assertArrayNotHasKey('current_streak', $response->json('data'));
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/badges
    // ------------------------------------------------------------------

    public function test_badges_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/badges');

        $response->assertStatus(401);
    }

    public function test_badges_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/badges');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/leaderboard
    // ------------------------------------------------------------------

    public function test_leaderboard_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/leaderboard');

        $response->assertStatus(401);
    }

    public function test_leaderboard_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/leaderboard');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/challenges
    // ------------------------------------------------------------------

    public function test_challenges_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/challenges');

        $response->assertStatus(401);
    }

    public function test_challenges_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/challenges');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/collections
    // ------------------------------------------------------------------

    public function test_collections_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/collections');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/daily-reward
    // ------------------------------------------------------------------

    public function test_daily_reward_status_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/daily-reward');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/gamification/daily-reward
    // ------------------------------------------------------------------

    public function test_claim_daily_reward_requires_auth(): void
    {
        $response = $this->apiPost('/v2/gamification/daily-reward');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/shop
    // ------------------------------------------------------------------

    public function test_shop_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/shop');

        $response->assertStatus(401);
    }

    public function test_shop_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/shop');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/seasons
    // ------------------------------------------------------------------

    public function test_seasons_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/seasons');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/seasons/current
    // ------------------------------------------------------------------

    public function test_current_season_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/seasons/current');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /v2/gamification/nexus-score
    // ------------------------------------------------------------------

    public function test_nexus_score_requires_auth(): void
    {
        $response = $this->apiGet('/v2/gamification/nexus-score');

        $response->assertStatus(401);
    }

    public function test_nexus_score_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/gamification/nexus-score');

        $response->assertStatus(200);
    }
}
