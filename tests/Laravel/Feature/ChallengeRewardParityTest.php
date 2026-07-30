<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature;

use App\Models\User;
use App\Services\ChallengeService;
use App\Services\GamificationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Both challenge-claim paths must award the SAME things for the same challenge.
 *
 * The two paths are:
 *   1. ChallengeService::claim()                         — accessible frontend,
 *      called by AlphaController::claimChallengeReward().
 *   2. GamificationV2Controller::claimChallenge()        — React,
 *      POST /api/v2/gamification/challenges/{id}/claim.
 *
 * They diverged: (1) awarded XP + the `challenges.badge_reward` badge + a
 * notification bell, (2) awarded XP only and ignored badge_reward entirely — so
 * the same challenge paid out a badge and a bell on one frontend and neither on
 * the other. Both now delegate to the single
 * ChallengeService::awardChallengeReward().
 *
 * These tests compare a normalised snapshot of everything a claim writes, so a
 * future reward added to one path and not the other fails here rather than
 * shipping a frontend-dependent payout.
 */
class ChallengeRewardParityTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * A badge key that genuinely resolves to a definition in THIS environment.
     *
     * 🔴 Positive control. GamificationService::awardBadgeByKey() silently
     * no-ops on a key that matches no definition, so a hardcoded key that
     * happens not to exist here would make every badge assertion below pass
     * vacuously — both paths awarding no badge is "parity" too. Taking the key
     * from the live definition list, and asserting it resolves, means the badge
     * assertions can only pass because a badge was really granted.
     *
     * getBadgeDefinitions() prefers DB-backed definitions and falls back to the
     * static list, so this follows whatever the environment actually serves.
     */
    private function resolvableBadgeKey(): string
    {
        $definitions = GamificationService::getBadgeDefinitions();
        $this->assertNotEmpty($definitions, 'No badge definitions available — cannot prove a badge was awarded.');

        $key = (string) ($definitions[array_key_first($definitions)]['key'] ?? '');
        $this->assertNotSame('', $key, 'First badge definition has no key.');
        $this->assertNotNull(
            GamificationService::getBadgeByKey($key),
            "Badge key '{$key}' does not resolve; awardBadgeByKey() would no-op and every badge assertion here would pass vacuously."
        );

        return $key;
    }

    /**
     * Insert a challenge directly rather than via ChallengeService::create(),
     * so this fixture is not coupled to that method's payload contract.
     *
     * @return int challenge id
     */
    private function createChallenge(int $xpReward, ?string $badgeReward): int
    {
        return (int) DB::table('challenges')->insertGetId([
            'tenant_id'      => $this->testTenantId,
            'title'          => 'Parity Challenge',
            'description'    => 'Fixture for reward parity between claim paths.',
            'challenge_type' => 'weekly',
            'action_type'    => 'parity_probe',
            'target_count'   => 1,
            'xp_reward'      => $xpReward,
            'badge_reward'   => $badgeReward,
            'start_date'     => now()->subDay()->toDateString(),
            'end_date'       => now()->addDay()->toDateString(),
            'is_active'      => 1,
        ]);
    }

    /** A member with a completed, unclaimed progress row for $challengeId. */
    private function memberWithCompletedChallenge(int $challengeId): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
            'xp'          => 0,
        ]);

        DB::table('user_challenge_progress')->insert([
            'tenant_id'      => $this->testTenantId,
            'user_id'        => $user->id,
            'challenge_id'   => $challengeId,
            'current_count'  => 1,
            'completed_at'   => now(),
            'reward_claimed' => 0,
        ]);

        return $user;
    }

    /**
     * Everything a claim awards, normalised so two members are comparable:
     * XP ledger rows (action + amount + description), badge keys, and bell
     * counts by type. Deliberately excludes ids, timestamps and the member.
     *
     * @return array<string, mixed>
     */
    private function awardSnapshot(int $userId): array
    {
        $xpRows = DB::table('user_xp_log')
            ->where('user_id', $userId)
            ->orderBy('action')
            ->get(['action', 'xp_amount', 'description'])
            ->map(fn ($row) => [
                'action'      => $row->action,
                'xp_amount'   => (int) $row->xp_amount,
                'description' => $row->description,
            ])
            ->all();

        $badges = DB::table('user_badges')
            ->where('user_id', $userId)
            ->orderBy('badge_key')
            ->pluck('badge_key')
            ->all();

        $bells = DB::table('notifications')
            ->where('user_id', $userId)
            ->groupBy('type')
            ->orderBy('type')
            ->pluck(DB::raw('COUNT(*)'), 'type')
            ->map(fn ($count) => (int) $count)
            ->all();

        return [
            'xp_log'            => $xpRows,
            'badges'            => $badges,
            'notifications'     => $bells,
            'total_xp'          => (int) DB::table('users')->where('id', $userId)->value('xp'),
            'progress_claimed'  => (int) DB::table('user_challenge_progress')
                ->where('user_id', $userId)
                ->value('reward_claimed'),
            'progress_stamped'  => DB::table('user_challenge_progress')
                ->where('user_id', $userId)
                ->value('claimed_at') !== null,
        ];
    }

    /** Claim as $user over HTTP — the React path. */
    private function claimViaReact(User $user, int $challengeId): void
    {
        Sanctum::actingAs($user, ['*']);

        $response = $this->apiPost("/v2/gamification/challenges/{$challengeId}/claim");

        // Assert 200 FIRST: a 4xx/5xx here would otherwise be read as "this
        // path awards nothing", which the parity comparison could mistake for
        // agreement if the other path were also broken.
        $response->assertStatus(200);
        $response->assertJsonPath('data.claimed', true);
    }

    /** Claim as $user through the service — the accessible-frontend path. */
    private function claimViaAccessible(User $user, int $challengeId): void
    {
        $claimed = ChallengeService::claim($challengeId, (int) $user->id, $this->testTenantId);

        $this->assertTrue($claimed, 'Accessible-frontend claim failed; parity below would compare against nothing.');
    }

    // ------------------------------------------------------------------
    //  PARITY
    // ------------------------------------------------------------------

    public function test_both_claim_paths_award_identical_rewards_including_the_badge(): void
    {
        $badgeKey = $this->resolvableBadgeKey();
        $challengeId = $this->createChallenge(40, $badgeKey);

        $reactUser = $this->memberWithCompletedChallenge($challengeId);
        $accessibleUser = $this->memberWithCompletedChallenge($challengeId);

        $this->claimViaReact($reactUser, $challengeId);
        $this->claimViaAccessible($accessibleUser, $challengeId);

        $react = $this->awardSnapshot((int) $reactUser->id);
        $accessible = $this->awardSnapshot((int) $accessibleUser->id);

        // Positive controls — each path really awarded all three reward kinds,
        // so the comparison below cannot be satisfied by two empty snapshots.
        //
        // Assert the challenge's OWN ledger row rather than users.xp: granting a
        // badge also awards a separate `earn_badge` XP bonus, so the total is
        // challenge XP + that bonus. Pinning the row keeps this honest about
        // which award is being checked; the snapshot equality covers the total.
        $expectedXpRow = ['action' => 'challenge_complete', 'xp_amount' => 40, 'description' => 'Challenge: Parity Challenge'];
        $this->assertContains($expectedXpRow, $react['xp_log'], 'React path awarded no challenge XP.');
        $this->assertContains($badgeKey, $react['badges'], 'React path did not award challenges.badge_reward — the original bug.');
        $this->assertNotEmpty($react['notifications'], 'React path sent no notification.');
        $this->assertContains($expectedXpRow, $accessible['xp_log'], 'Accessible path awarded no challenge XP.');
        $this->assertContains($badgeKey, $accessible['badges'], 'Accessible path did not award challenges.badge_reward.');
        $this->assertNotEmpty($accessible['notifications'], 'Accessible path sent no notification.');

        $this->assertEquals(
            $accessible,
            $react,
            'The two challenge-claim paths no longer award the same things. Add rewards to ChallengeService::awardChallengeReward(), never at a call site.'
        );
    }

    public function test_both_claim_paths_agree_when_the_challenge_has_no_badge_reward(): void
    {
        $challengeId = $this->createChallenge(25, null);

        $reactUser = $this->memberWithCompletedChallenge($challengeId);
        $accessibleUser = $this->memberWithCompletedChallenge($challengeId);

        $this->claimViaReact($reactUser, $challengeId);
        $this->claimViaAccessible($accessibleUser, $challengeId);

        $react = $this->awardSnapshot((int) $reactUser->id);
        $accessible = $this->awardSnapshot((int) $accessibleUser->id);

        $this->assertSame(25, $react['total_xp'], 'React path awarded no XP.');
        $this->assertSame([], $react['badges'], 'No badge_reward is set, so no badge may be awarded.');
        $this->assertSame([], $accessible['badges'], 'No badge_reward is set, so no badge may be awarded.');

        $this->assertEquals($accessible, $react, 'Claim paths diverge for a challenge with no badge_reward.');
    }

    public function test_react_claim_reports_the_badge_it_awarded(): void
    {
        $badgeKey = $this->resolvableBadgeKey();
        $challengeId = $this->createChallenge(15, $badgeKey);
        $user = $this->memberWithCompletedChallenge($challengeId);

        Sanctum::actingAs($user, ['*']);
        $response = $this->apiPost("/v2/gamification/challenges/{$challengeId}/claim");

        $response->assertStatus(200);
        $response->assertJsonPath('data.reward.xp', 15);
        $response->assertJsonPath('data.reward.badge', $badgeKey);
    }

    public function test_neither_path_pays_out_twice(): void
    {
        $badgeKey = $this->resolvableBadgeKey();
        $challengeId = $this->createChallenge(30, $badgeKey);

        $reactUser = $this->memberWithCompletedChallenge($challengeId);
        $accessibleUser = $this->memberWithCompletedChallenge($challengeId);

        $this->claimViaReact($reactUser, $challengeId);
        $this->claimViaAccessible($accessibleUser, $challengeId);

        // Snapshot after the first, legitimate claim. Comparing against these
        // rather than a literal keeps the test independent of the extra
        // `earn_badge` XP bonus a badge grant carries.
        $reactAfterFirst = $this->awardSnapshot((int) $reactUser->id);
        $accessibleAfterFirst = $this->awardSnapshot((int) $accessibleUser->id);

        // Second claim on each path must be refused.
        Sanctum::actingAs($reactUser, ['*']);
        $this->apiPost("/v2/gamification/challenges/{$challengeId}/claim")->assertStatus(400);

        $this->assertFalse(
            ChallengeService::claim($challengeId, (int) $accessibleUser->id, $this->testTenantId),
            'Accessible path allowed a second claim.'
        );

        // ...and must not have awarded anything further.
        $this->assertEquals($reactAfterFirst, $this->awardSnapshot((int) $reactUser->id), 'React path paid out twice.');
        $this->assertEquals($accessibleAfterFirst, $this->awardSnapshot((int) $accessibleUser->id), 'Accessible path paid out twice.');
    }
}
