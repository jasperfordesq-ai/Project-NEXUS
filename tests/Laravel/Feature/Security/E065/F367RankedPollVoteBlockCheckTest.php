<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\Models\User;
use App\Services\BlockUserService;
use App\Services\PollRankingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-367 (E-065) — ranked-poll voting was a leftover of F-158.
 *
 * F-158's fix (`ae434ffeb`) put `assertNoBlockBetween` on the standard poll
 * vote (`PollService::vote`) and on the ranked-ballot CONTROLLER
 * (`PollsController::rank`). It did not put one inside
 * `PollRankingService::submitRankingWithResult`, which applies only the
 * safeguarding contact policy. The controller is the sole caller today, so the
 * HTTP route is covered — but the service is the reusable unit, and leaving the
 * decision outside it is exactly the F-336 shape that produced this family.
 *
 * This test therefore drives the SERVICE directly, which is where the gap is.
 */
class F367RankedPollVoteBlockCheckTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::setById($this->testTenantId);
    }

    /** @param array<string,mixed> $overrides */
    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => true,
            'role' => 'member',
        ], $overrides));
    }

    /** @return array{0:int,1:list<int>} */
    private function rankedPoll(int $ownerId): array
    {
        $pollId = (int) DB::table('polls')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'question' => 'F367 ranked poll',
            'poll_type' => 'ranked',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $optionIds = [];
        foreach (['F367 first', 'F367 second'] as $label) {
            $optionIds[] = (int) DB::table('poll_options')->insertGetId([
                'poll_id' => $pollId,
                'tenant_id' => $this->testTenantId,
                'label' => $label,
                'votes' => 0,
            ]);
        }

        return [$pollId, $optionIds];
    }

    public function test_a_blocked_member_cannot_submit_a_ranked_ballot_on_the_blockers_poll(): void
    {
        $owner = $this->member();
        $attacker = $this->member();
        [$pollId, $optionIds] = $this->rankedPoll((int) $owner->id);

        BlockUserService::block((int) $owner->id, (int) $attacker->id, 'F367 harassment');
        $this->assertTrue(
            BlockUserService::isBlockedEither((int) $attacker->id, (int) $owner->id),
            'precondition: the block is live'
        );

        $threw = false;
        try {
            app(PollRankingService::class)->submitRankingWithResult($pollId, (int) $attacker->id, [
                ['option_id' => $optionIds[0], 'rank' => 1],
                ['option_id' => $optionIds[1], 'rank' => 2],
            ]);
        } catch (SafeguardingPolicyException $e) {
            $threw = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }

        $this->assertTrue($threw, 'the ranked ballot must be refused inside the service, not only at the controller');

        $this->assertFalse(
            DB::table('poll_rankings')
                ->where('tenant_id', $this->testTenantId)
                ->where('poll_id', $pollId)
                ->where('user_id', $attacker->id)
                ->exists(),
            'no ranking rows may be written for a blocked member'
        );

        $this->assertFalse(
            DB::table('user_xp_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $attacker->id)
                ->where('source_reference', 'poll:' . $pollId)
                ->exists(),
            'a blocked member must not earn XP from the blocker\'s poll'
        );
    }

    public function test_the_block_is_real_and_an_unblocked_ranked_ballot_still_works(): void
    {
        // Control 1 — the same fixture block DOES stop the canonical check.
        $owner = $this->member();
        $attacker = $this->member();
        BlockUserService::block((int) $owner->id, (int) $attacker->id, 'F367 harassment');

        $refused = false;
        try {
            BlockUserService::assertNoBlockBetween((int) $attacker->id, (int) $owner->id);
        } catch (SafeguardingPolicyException $e) {
            $refused = true;
            $this->assertSame('BLOCKED', $e->reasonCode);
        }
        $this->assertTrue($refused, 'CONTROL: the canonical block check refuses this pair');

        // Control 2 — no block, same service call.
        $pollOwner = $this->member();
        $voter = $this->member();
        [$pollId, $optionIds] = $this->rankedPoll((int) $pollOwner->id);

        $result = app(PollRankingService::class)->submitRankingWithResult($pollId, (int) $voter->id, [
            ['option_id' => $optionIds[0], 'rank' => 1],
            ['option_id' => $optionIds[1], 'rank' => 2],
        ]);

        $this->assertTrue($result['accepted'], 'CONTROL: an unblocked ranked ballot is still accepted');
        $this->assertSame(
            2,
            DB::table('poll_rankings')
                ->where('tenant_id', $this->testTenantId)
                ->where('poll_id', $pollId)
                ->where('user_id', $voter->id)
                ->count(),
            'CONTROL: the rightful ranking rows are written'
        );
    }
}
