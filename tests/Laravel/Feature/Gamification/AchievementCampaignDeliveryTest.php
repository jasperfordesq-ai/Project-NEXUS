<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gamification;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AchievementCampaignService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Campaigns must actually reach members.
 *
 * 🔴 What this pins, and why reading the row back matters. Until 2026-08-28 this
 * whole feature awarded nothing, for any campaign type: rows were stored,
 * `last_run_at` was bumped, and the delivery step was a stub that logged
 * "(award logic stubbed)". Separately, `activateCampaign()` wrote
 * `status = 'active'` — a value outside the column's enum — while the scheduler
 * selected `status = 'running'`, so an activated campaign was never even
 * eligible. Either fault alone is enough to make an admin's campaign silently
 * do nothing, so every test below asserts the MEMBER's balance or badges, not
 * that a method was called.
 */
class AchievementCampaignDeliveryTest extends TestCase
{
    use DatabaseTransactions;

    private AchievementCampaignService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(AchievementCampaignService::class);
        TenantContext::setById($this->testTenantId);
    }

    public function test_an_activated_xp_campaign_pays_the_audience(): void
    {
        $member = $this->member();
        $before = $this->xpOf($member);

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 25]);
        $this->service->activateCampaign($id);

        $awarded = $this->runAndCount($id);

        self::assertGreaterThanOrEqual(1, $awarded, 'the campaign must pay at least our member');
        self::assertSame($before + 25, $this->xpOf($member), 'the member must actually receive the XP');

        self::assertDatabaseHas('user_xp_log', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'action' => AchievementCampaignService::XP_ACTION,
            'xp_amount' => 25,
        ]);
    }

    public function test_a_second_run_in_the_same_period_pays_nothing_extra(): void
    {
        $member = $this->member();
        $before = $this->xpOf($member);

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 40]);
        $this->service->activateCampaign($id);

        $this->runAndCount($id);
        self::assertSame($before + 40, $this->xpOf($member));

        // Force it due again inside the SAME period — a cron overlap, a retry,
        // or an operator re-running the job by hand. The period key is
        // unchanged, so the unique key on user_xp_log must refuse the payment.
        DB::table('achievement_campaigns')->where('id', $id)->update(['last_run_at' => null]);
        $this->runAndCount($id);

        self::assertSame(
            $before + 40,
            $this->xpOf($member),
            'one award per member per period — a repeat run must not double-pay',
        );
        self::assertSame(
            1,
            DB::table('user_xp_log')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $member->id)
                ->where('action', AchievementCampaignService::XP_ACTION)
                ->count(),
            'exactly one ledger row may exist for the period',
        );
    }

    public function test_a_missed_run_is_skipped_rather_than_caught_up(): void
    {
        $member = $this->member();
        $before = $this->xpOf($member);

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 10]);
        $this->service->activateCampaign($id);

        // Pretend the scheduler was down for six weeks on a weekly campaign.
        DB::table('achievement_campaigns')->where('id', $id)->update([
            'recurrence_pattern' => 'weekly',
            'last_run_at' => now()->subWeeks(6),
        ]);

        $this->runAndCount($id);

        // Six weeks missed must pay ONE bonus, not six. Catching up would hand
        // out a lump of XP for something the member never did, and reorder the
        // leaderboard in a way that cannot be taken back.
        self::assertSame($before + 10, $this->xpOf($member));
    }

    public function test_a_badge_campaign_grants_the_badge_and_completes(): void
    {
        $member = $this->member();

        $id = $this->campaign(['type' => 'one_time', 'badge_key' => 'vol_1h']);
        $this->service->activateCampaign($id);

        $this->runAndCount($id);

        self::assertDatabaseHas('user_badges', [
            'user_id' => $member->id,
            'badge_key' => 'vol_1h',
        ]);

        // A one-off must not stay 'running', or every member who joins later
        // silently qualifies for ever.
        self::assertSame(
            'completed',
            DB::table('achievement_campaigns')->where('id', $id)->value('status'),
        );
    }

    public function test_a_draft_campaign_is_never_delivered(): void
    {
        $member = $this->member();
        $before = $this->xpOf($member);

        $this->campaign(['type' => 'recurring', 'xp_amount' => 99]);
        // Deliberately NOT activated.

        $this->service->processRecurringCampaigns();

        self::assertSame($before, $this->xpOf($member), 'an unactivated campaign must pay nobody');
    }

    public function test_a_campaign_with_no_reward_configured_pays_nobody(): void
    {
        $member = $this->member();
        $before = $this->xpOf($member);

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 0]);
        $this->service->activateCampaign($id);

        self::assertSame(0, $this->runAndCount($id));
        self::assertSame($before, $this->xpOf($member));
    }

    public function test_suspended_members_are_not_paid(): void
    {
        // member() confines the pool, so create the good member first and then
        // add the suspended one alongside it. The good member is the control:
        // without it, "suspended was not paid" would also be satisfied by a
        // campaign that paid nobody at all.
        $good = $this->member();
        $suspended = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'suspended',
            'is_approved' => 1,
        ]);

        $goodBefore = $this->xpOf($good);
        $suspendedBefore = $this->xpOf($suspended);

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 15]);
        $this->service->activateCampaign($id);
        $this->runAndCount($id);

        self::assertSame(
            $goodBefore + 15,
            $this->xpOf($good),
            'control: an eligible member must be paid, or this test proves nothing',
        );
        self::assertSame(
            $suspendedBefore,
            $this->xpOf($suspended),
            'a suspended account must not accrue credit',
        );
    }

    public function test_total_awards_records_what_was_delivered(): void
    {
        $this->member();

        $id = $this->campaign(['type' => 'recurring', 'xp_amount' => 5]);
        $this->service->activateCampaign($id);
        $awarded = $this->runAndCount($id);

        self::assertSame(
            $awarded,
            (int) DB::table('achievement_campaigns')->where('id', $id)->value('total_awards'),
            'total_awards must reconcile with the number of members actually paid',
        );
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /**
     * A member who is the ONLY eligible audience in this tenant.
     *
     * 🔴 Confining the pool is not tidiness, it is what makes these tests
     * usable. The shared fixture has ~149 eligible members, and an `all_users`
     * campaign awards every one of them — each award writing a ledger row,
     * creating a notification, fanning out a push and checking for a level-up.
     * The first version of this file took 10m54s for 8 tests, which would have
     * dominated a CI shard. Confining the pool keeps the `all_users` branch
     * genuinely exercised (it still resolves the audience for real) while the
     * work stays proportional to the test.
     *
     * Rolled back with the surrounding transaction.
     */
    private function member(): User
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => 1,
        ]);

        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', '!=', $member->id)
            ->update(['status' => 'inactive']);

        return $member;
    }

    private function xpOf(User $user): int
    {
        return (int) DB::table('users')->where('id', $user->id)->value('xp');
    }

    private function campaign(array $overrides = []): int
    {
        TenantContext::setById($this->testTenantId);

        $id = $this->service->createCampaign(array_merge([
            'name' => 'Delivery test ' . uniqid('', true),
            'description' => 'Delivery test',
            'type' => 'recurring',
            'badge_key' => '',
            'xp_amount' => 0,
            'target_audience' => 'all_users',
            'audience_config' => [],
            'schedule' => 'daily',
        ], $overrides));

        self::assertNotNull($id, 'campaign fixture must be created');

        return (int) $id;
    }

    /** Run the scheduler and return how many members THIS campaign paid. */
    private function runAndCount(int $campaignId): int
    {
        TenantContext::setById($this->testTenantId);

        foreach ($this->service->processRecurringCampaigns() as $result) {
            if ((int) $result['campaign_id'] === $campaignId) {
                return (int) $result['awarded'];
            }
        }

        return 0;
    }
}
