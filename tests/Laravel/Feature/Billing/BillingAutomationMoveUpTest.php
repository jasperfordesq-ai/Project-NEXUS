<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\EmailDispatchService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\PlanTerms;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The automatic move up to the next plan (DESIGN 6.4, task 5A).
 *
 * The rule `upgrade` moves a community that is over its member number to the
 * smallest offered plan that fits, on the same day a pause would come: this
 * episode's "over" notice day plus the days. When it cannot be moved (no
 * plan fits, a specially agreed price, a card subscription) a person is told
 * once per episode and nothing moves.
 *
 * The seeded standard plans are switched off inside the test's transaction
 * and three small ones stand in, so member numbers stay small.
 */
final class BillingAutomationMoveUpTest extends TestCase
{
    use DatabaseTransactions;
    use BillingAutomationFixtures;

    private CarbonImmutable $today;
    private MoveUpCapturingEmailDispatch $mailer;
    private int $small;
    private int $medium;
    private int $large;
    private int $community;
    private string $admin;
    private string $team;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAutomation();
        PlanTerms::flush();

        $this->mailer = new MoveUpCapturingEmailDispatch();
        app()->instance(EmailDispatchService::class, $this->mailer);

        $this->today = CarbonImmutable::parse('2027-03-10');

        DB::table('pay_plans')->where('is_standard', 1)->update(['is_active' => 0]);
        $this->small = $this->makePlan('Small', 10, 20.00);
        $this->medium = $this->makePlan('Medium', 20, 30.00);
        $this->large = $this->makePlan('Large', 30, 40.00);
        PlanTerms::flush();

        $this->community = $this->makeCommunity('Move up community', 1, '/1/');
        $this->assignPlan($this->community, $this->small);
        $this->admin = $this->person($this->community, ['role' => 'admin']);
        $this->team = $this->person($this->testTenantId, ['role' => 'member', 'is_super_admin' => true, 'is_god' => true]);

        BillingSettings::set('over_limit_action', 'upgrade', null);
        BillingSettings::set('over_limit_grace_days', 10, null);
        $this->switchOn();
    }

    protected function tearDown(): void
    {
        try {
            PlanTerms::flush();
        } finally {
            $this->tearDownAutomation();
        }
    }

    private function makePlan(string $name, int $maxUsers, float $monthly): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => $name,
            'slug' => 'moveup-' . strtolower($name) . '-' . bin2hex(random_bytes(4)),
            'tier_level' => $maxUsers,
            'max_users' => $maxUsers,
            'price_monthly' => $monthly,
            'price_yearly' => $monthly * 10,
            'price_monthly_gbp' => $monthly - 2,
            'price_yearly_gbp' => ($monthly - 2) * 10,
            'is_standard' => 1,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $extra */
    private function assignPlan(int $tenantId, int $planId, array $extra = []): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->delete();
        DB::table('tenant_plan_assignments')->insert($extra + [
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    private function planOf(int $tenantId): int
    {
        return (int) DB::table('tenant_plan_assignments')
            ->where('tenant_id', $tenantId)->where('status', 'active')
            ->orderByDesc('id')->value('pay_plan_id');
    }

    private function addActiveMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Active',
                'last_name' => 'Member',
                'name' => 'Active Member',
                'email' => 'moveup.m.' . bin2hex(random_bytes(7)) . '@example.com',
                'password_hash' => 'x',
                'role' => 'member',
                'status' => 'active',
                'is_approved' => 1,
                'last_login_at' => now()->subDays(5),
                'created_at' => now(),
            ];
        }
        DB::table('users')->insert($rows);
    }

    private function day(int $offset): CarbonImmutable
    {
        return $this->today->addDays($offset);
    }

    /** @return array<string, mixed> the detail of the community's one member-limit entry */
    private function detail(array $outcome, int $tenantId): array
    {
        $entries = array_values(array_filter($outcome, static fn ($e) => $e['tenant_id'] === $tenantId && $e['clock'] === 'member_limit'));
        $this->assertCount(1, $entries);

        return $entries[0]['detail'];
    }

    /** @return list<array{to:string, subject:string, body:string}> */
    private function subjectsContaining(string $email, string $needle): array
    {
        return array_values(array_filter($this->mailer->to($email), static fn (array $m) => str_contains($m['subject'], $needle)));
    }

    // ── Moving ──────────────────────────────────────────────────────────────

    public function test_warned_first_then_moved_after_the_days(): void
    {
        $this->addActiveMembers($this->community, 11);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $detail = $this->detail($outcome, $this->community);
        $this->assertSame('Medium', $detail['move_plan']);
        $this->assertSame($this->day(10)->toDateString(), $detail['move_date']);
        $over = $this->subjectsContaining($this->admin, 'is over its member limit');
        $this->assertCount(1, $over);
        $this->assertStringContainsString('<strong>Medium</strong> plan (', $over[0]['body'], 'The plan it will move to, with its price.');
        $this->assertStringContainsString('30.00', $over[0]['body']);
        $this->assertStringContainsString('a month', $over[0]['body']);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(9)), $this->community));
        $this->assertSame($this->small, $this->planOf($this->community));

        $outcome = BillingAutomationService::run($this->day(10));
        $this->assertSame(['member_limit:move_up'], $this->actionsFor($outcome, $this->community));
        $this->assertSame($this->medium, $this->planOf($this->community));
        $this->assertSame($this->medium, $this->detail($outcome, $this->community)['move_plan_id']);
        $this->assertFalse(BillingLock::isLocked($this->community), 'A move never pauses.');

        $moved = $this->subjectsContaining($this->admin, 'has moved to the Medium plan');
        $this->assertCount(1, $moved);
        $this->assertStringContainsString('Small', $moved[0]['body']);
        $this->assertStringContainsString('<strong>20</strong>', $moved[0]['body']);
        $this->assertStringContainsString('30.00', $moved[0]['body']);
        $this->assertCount(1, $this->subjectsContaining($this->team, 'has moved to the Medium plan'), 'Whoever it pays is told too.');

        // The next morning it fits: no second "over" notice, nothing else.
        $before = count($this->mailer->sent);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(12)), $this->community));
        $this->assertCount($before, $this->mailer->sent, 'Nobody is mailed again after a move.');

        // Outgrowing the new plan is a new episode: a fresh warning, the full days.
        $this->addActiveMembers($this->community, 10);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(13)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(22)), $this->community));
        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(23)), $this->community));
        $this->assertSame($this->large, $this->planOf($this->community));
    }

    public function test_the_lists_and_the_banner_give_the_day_of_a_pending_move(): void
    {
        // describe() and memberLimitState() count from the real today, as the
        // pause date does: the day of this episode's "over" notice plus the days.
        $now = CarbonImmutable::parse(now()->toDateString());
        $this->addActiveMembers($this->community, 11);

        $this->assertSame('upgrade', \App\Support\Billing\OverLimitRule::describe($this->community)['effective_action']);
        $this->assertSame($now->addDays(10)->toDateString(), \App\Support\Billing\OverLimitRule::describe($this->community)['acts_on'], 'Not warned yet: today plus the days.');
        $this->assertSame($now->addDays(10)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on']);

        BillingAutomationService::run($now->subDays(3));
        $this->assertSame($now->addDays(7)->toDateString(), \App\Support\Billing\OverLimitRule::describe($this->community)['acts_on'], 'Counted from the notice.');
        $this->assertSame($now->addDays(7)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on']);
    }

    public function test_a_community_still_over_after_its_move_starts_a_fresh_episode(): void
    {
        $this->addActiveMembers($this->community, 11);
        BillingAutomationService::run($this->today);
        // Grows past the target before the move: it fitted on the day the
        // target was chosen, and is over again the morning after.
        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        $this->addActiveMembers($this->community, 10);

        $outcome = BillingAutomationService::run($this->day(11));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $this->assertSame($this->day(21)->toDateString(), $this->detail($outcome, $this->community)['move_date']);
        $this->assertSame($this->medium, $this->planOf($this->community));
    }

    public function test_skips_a_plan_after_a_big_jump(): void
    {
        $this->addActiveMembers($this->community, 25);
        BillingAutomationService::run($this->today);

        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        $this->assertSame($this->large, $this->planOf($this->community));
    }

    public function test_a_hubs_hidden_plan_is_never_chosen_and_the_hubs_price_is_named(): void
    {
        $hub = $this->makeCommunity('Move up hub', 1, '/1/', true);
        $child = $this->makeCommunity('Move up child', $hub, "/1/{$hub}/");
        $this->assignPlan($child, $this->small);
        $childAdmin = $this->person($child, ['role' => 'admin']);
        $manager = $this->person($hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);
        DB::table('hub_plan_terms')->insert([
            ['hub_tenant_id' => $hub, 'pay_plan_id' => $this->medium, 'is_offered' => 0, 'price_monthly' => null, 'created_at' => now(), 'updated_at' => now()],
            ['hub_tenant_id' => $hub, 'pay_plan_id' => $this->large, 'is_offered' => 1, 'price_monthly' => 55.00, 'created_at' => now(), 'updated_at' => now()],
        ]);
        PlanTerms::flush();
        $this->addActiveMembers($child, 15);

        BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $child));
        $this->assertSame($this->large, $this->planOf($child), 'Medium is hidden by the hub: never chosen.');

        $moved = $this->subjectsContaining($manager, 'has moved to the Large plan');
        $this->assertCount(1, $moved, 'Whoever it pays (its hub) is told.');
        $this->assertStringContainsString('55.00', $moved[0]['body'], "The hub's price.");
        $this->assertCount(1, $this->subjectsContaining($childAdmin, 'has moved to the Large plan'));
    }

    public function test_a_discount_and_the_non_profit_flag_survive_the_move(): void
    {
        $this->assignPlan($this->community, $this->small, ['discount_percentage' => 10, 'nonprofit_verified' => 1]);
        $this->addActiveMembers($this->community, 11);
        BillingAutomationService::run($this->today);
        BillingAutomationService::run($this->day(10));

        $row = DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->where('status', 'active')->first();
        $this->assertSame($this->medium, (int) $row->pay_plan_id);
        $this->assertSame(10, (int) $row->discount_percentage);
        $this->assertSame(1, (int) $row->nonprofit_verified);

        // 30.00 less 20% (non-profit) less 10%.
        $moved = $this->subjectsContaining($this->admin, 'has moved to the Medium plan');
        $this->assertStringContainsString('21.60', $moved[0]['body']);
    }

    // ── Not moving ──────────────────────────────────────────────────────────

    /**
     * The lists showed "Move up on <date>" for a community that would NOT be
     * moved on that date: no plan fits it, or its price was specially agreed,
     * so a person has to decide. A date is named only for a move that will
     * really happen.
     */
    public function test_no_move_date_is_named_when_no_move_will_happen(): void
    {
        $this->addActiveMembers($this->community, 35); // more than any plan offered to it allows
        BillingAutomationService::run($this->today);

        $this->assertNull(\App\Support\Billing\OverLimitRule::describe($this->community)['acts_on'], 'no plan fits: nothing will move it');
        $this->assertNull(BillingAutomationService::memberLimitState($this->community)['acts_on']);
    }

    public function test_no_move_date_is_named_for_a_specially_agreed_price(): void
    {
        $this->assignPlan($this->community, $this->small, ['custom_price_monthly' => 99.00]);
        $this->addActiveMembers($this->community, 12);
        BillingAutomationService::run($this->today);

        $this->assertNull(\App\Support\Billing\OverLimitRule::describe($this->community)['acts_on'], 'a person must decide its plan and price');
    }

    public function test_no_plan_fits_moves_nothing_and_asks_once(): void
    {
        $this->addActiveMembers($this->community, 35);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertArrayNotHasKey('move_plan', $this->detail($outcome, $this->community));
        $this->assertStringContainsString('cannot be moved to a bigger plan automatically', $this->subjectsContaining($this->admin, 'is over its member limit')[0]['body']);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(9)), $this->community));
        $outcome = BillingAutomationService::run($this->day(10));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor($outcome, $this->community));
        $this->assertSame('no_plan_fits', $this->detail($outcome, $this->community)['decision_reason']);
        $this->assertSame($this->small, $this->planOf($this->community));
        $this->assertSame('needs_decision', $this->standingRow($this->community)->limit_notice_stage);

        $decision = $this->subjectsContaining($this->team, 'needs a decision about its plan');
        $this->assertCount(1, $decision, 'The platform team (whoever it pays) is told once.');
        $this->assertStringContainsString('No plan', $decision[0]['body']);
        $this->assertCount(0, $this->subjectsContaining($this->admin, 'needs a decision'));

        $before = count($this->mailer->sent);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community), 'Not repeated next day.');
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(40)), $this->community));
        $this->assertCount($before, $this->mailer->sent);
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_a_decision_mail_the_mailer_refused_is_tried_again(): void
    {
        $this->addActiveMembers($this->community, 35);
        BillingAutomationService::run($this->today);

        app()->instance(EmailDispatchService::class, new RefusingEmailDispatch());
        try {
            $this->assertSame(['member_limit:needs_decision'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        } finally {
            app()->instance(EmailDispatchService::class, $this->mailer);
        }
        $this->assertSame('over', $this->standingRow($this->community)->limit_notice_stage, 'Not recorded as told.');

        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community));
        $this->assertCount(1, $this->subjectsContaining($this->team, 'needs a decision'));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(12)), $this->community));
    }

    public function test_a_hub_and_the_platform_team_are_both_asked_and_nobody_twice(): void
    {
        $hub = $this->makeCommunity('Ask hub', 1, '/1/', true);
        $child = $this->makeCommunity('Ask child', $hub, "/1/{$hub}/");
        $this->assignPlan($child, $this->small);
        $manager = $this->person($hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);
        // A platform team member who also manages the hub.
        $both = $this->person($hub, ['role' => 'admin', 'is_tenant_super_admin' => true, 'is_super_admin' => true, 'is_god' => true]);
        $this->addActiveMembers($child, 35);

        BillingAutomationService::run($this->today);
        BillingAutomationService::run($this->day(10));

        $this->assertCount(1, $this->subjectsContaining($manager, 'needs a decision'));
        $this->assertCount(1, $this->subjectsContaining($this->team, 'needs a decision'));
        $this->assertCount(1, $this->subjectsContaining($both, 'needs a decision'));
    }

    public function test_a_specially_agreed_price_is_never_moved(): void
    {
        $this->assignPlan($this->community, $this->small, ['custom_price_monthly' => 99.00]);
        $this->addActiveMembers($this->community, 11);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertArrayNotHasKey('move_plan', $this->detail($outcome, $this->community), 'The warning does not promise a move.');

        $outcome = BillingAutomationService::run($this->day(10));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor($outcome, $this->community));
        $this->assertSame('custom_price', $this->detail($outcome, $this->community)['decision_reason']);
        $this->assertSame($this->small, $this->planOf($this->community));
        $this->assertStringContainsString('specially agreed price', $this->subjectsContaining($this->team, 'needs a decision')[0]['body']);
    }

    public function test_a_card_payer_is_never_moved_and_the_platform_team_is_told_once(): void
    {
        $this->assignPlan($this->community, $this->small, ['stripe_subscription_id' => 'sub_moveup_' . bin2hex(random_bytes(4))]);
        $this->addActiveMembers($this->community, 11);

        BillingAutomationService::run($this->today);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(9)), $this->community));

        $outcome = BillingAutomationService::run($this->day(10));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor($outcome, $this->community));
        $this->assertSame('card_subscription', $this->detail($outcome, $this->community)['decision_reason']);
        $this->assertSame($this->small, $this->planOf($this->community));
        $decision = $this->subjectsContaining($this->team, 'needs a decision');
        $this->assertCount(1, $decision);
        $this->assertStringContainsString('by card', $decision[0]['body']);
        $this->assertCount(0, $this->subjectsContaining($this->admin, 'needs a decision'));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community));
        $this->assertCount(1, $this->subjectsContaining($this->team, 'needs a decision'));
    }

    public function test_one_stage_per_run(): void
    {
        // Over for 40 days on record, but never warned: warned today, never
        // moved in the same run.
        $this->addActiveMembers($this->community, 11);
        BillingAutomationService::run($this->today->subDays(40));
        $this->standing($this->community, ['limit_notice_stage' => null, 'limit_notice_at' => null]);

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertSame($this->small, $this->planOf($this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(9)), $this->community));
        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
    }

    public function test_switched_off_nothing_moves(): void
    {
        $this->addActiveMembers($this->community, 11);
        BillingAutomationService::run($this->today);
        BillingSettings::set('automation_enabled', false, null);

        $this->assertSame([], BillingAutomationService::run($this->day(10)));
        $this->assertSame([], BillingAutomationService::run($this->day(60)));
        $this->assertSame($this->small, $this->planOf($this->community));
        $this->assertCount(0, $this->subjectsContaining($this->admin, 'has moved'));
    }

    public function test_the_preview_shows_the_move_and_changes_nothing(): void
    {
        $this->addActiveMembers($this->community, 11);
        BillingAutomationService::run($this->today);
        $rowBefore = (array) $this->standingRow($this->community);
        $mailBefore = count($this->mailer->sent);

        $outcome = BillingAutomationService::preview($this->day(10));
        $this->assertSame(['member_limit:move_up'], $this->actionsFor($outcome, $this->community));
        $detail = $this->detail($outcome, $this->community);
        $this->assertSame('Medium', $detail['move_plan']);
        $this->assertSame($this->medium, $detail['move_plan_id']);

        $this->assertSame($this->small, $this->planOf($this->community));
        $this->assertSame($rowBefore, (array) $this->standingRow($this->community));
        $this->assertCount($mailBefore, $this->mailer->sent);

        // Grown past every plan since the warning: the promise changed, so
        // the preview shows a fresh warning (no plan named), not a decision.
        // Fix round 1; until then it showed "needs_decision" at once.
        $this->addActiveMembers($this->community, 30);
        $outcome = BillingAutomationService::preview($this->day(10));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $this->assertArrayNotHasKey('move_plan', $this->detail($outcome, $this->community));
        $this->assertCount($mailBefore, $this->mailer->sent);

        // A community warned that it cannot be moved shows why on its move day.
        BillingAutomationService::run($this->day(10));
        $outcome = BillingAutomationService::preview($this->day(20));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor($outcome, $this->community));
        $this->assertSame('no_plan_fits', $this->detail($outcome, $this->community)['decision_reason']);
        $mailBefore = count($this->mailer->sent);
        BillingAutomationService::preview($this->day(20));
        $this->assertCount($mailBefore, $this->mailer->sent);
    }

    public function test_the_terms_restart_clears_a_decision_already_sent(): void
    {
        $this->addActiveMembers($this->community, 35);
        BillingAutomationService::run($this->today);
        BillingAutomationService::run($this->day(10));
        $this->assertSame('needs_decision', $this->standingRow($this->community)->limit_notice_stage);

        BillingSettings::set('over_limit_grace_days', 12, null);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community), 'New terms, new episode: a fresh warning.');
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(22)), $this->community));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor(BillingAutomationService::run($this->day(23)), $this->community));
    }

    // ── Fix round 1: the promised outcome is part of the terms ───────────

    private function decisionMails(): int
    {
        return count(array_filter($this->mailer->sent, static fn (array $m) => str_contains($m['subject'], 'needs a decision')));
    }

    /** @return array{0:int, 1:int, 2:string, 3:string} hub, child, child admin, hub manager */
    private function hubAndChild(): array
    {
        $hub = $this->makeCommunity('Promise hub', 1, '/1/', true);
        $child = $this->makeCommunity('Promise child', $hub, "/1/{$hub}/");
        $this->assignPlan($child, $this->small);
        $admin = $this->person($child, ['role' => 'admin']);
        $manager = $this->person($hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);

        return [$hub, $child, $admin, $manager];
    }

    /** @param array<string, mixed> $values */
    private function hubTerms(int $hub, int $planId, array $values): void
    {
        DB::table('hub_plan_terms')->updateOrInsert(
            ['hub_tenant_id' => $hub, 'pay_plan_id' => $planId],
            $values + ['created_at' => now(), 'updated_at' => now()]
        );
        PlanTerms::flush();
    }

    /** The warning on day 5 names the new outcome; nothing on day 10; the move on day 15. */
    private function assertRestartedOnDayFiveAndMovedOnDayFifteen(int $tenantId, int $expectedPlan, string $expectedName): void
    {
        $outcome = BillingAutomationService::run($this->day(5));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $tenantId), 'A fresh warning naming the new outcome.');
        $detail = $this->detail($outcome, $tenantId);
        $this->assertSame($expectedName, $detail['move_plan']);
        $this->assertSame($this->day(15)->toDateString(), $detail['move_date']);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(10)), $tenantId), 'Nothing on the old move day.');
        $this->assertSame($this->small, $this->planOf($tenantId));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(14)), $tenantId));
        $this->assertSame(['member_limit:move_up'], $this->actionsFor(BillingAutomationService::run($this->day(15)), $tenantId));
        $this->assertSame($expectedPlan, $this->planOf($tenantId));
        $this->assertSame(0, $this->decisionMails(), 'No "needs a decision" mail followed a notice that promised a move.');
    }

    public function test_a_hub_offering_a_bigger_plan_after_a_no_plan_notice_restarts_the_warning(): void
    {
        [$hub, $child, $admin] = $this->hubAndChild();
        $this->hubTerms($hub, $this->medium, ['is_offered' => 0]);
        $this->hubTerms($hub, $this->large, ['is_offered' => 0]);
        $this->addActiveMembers($child, 25);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertArrayNotHasKey('move_plan', $this->detail($outcome, $child));
        $this->assertStringContainsString('cannot be moved to a bigger plan automatically', $this->mailer->to($admin)[0]['body']);

        $this->hubTerms($hub, $this->large, ['is_offered' => 1]);
        $this->assertRestartedOnDayFiveAndMovedOnDayFifteen($child, $this->large, 'Large');
    }

    public function test_a_hidden_target_plan_is_not_replaced_by_a_dearer_one_without_a_fresh_warning(): void
    {
        [$hub, $child] = $this->hubAndChild();
        $this->addActiveMembers($child, 15);
        $this->assertSame('Medium', $this->detail(BillingAutomationService::run($this->today), $child)['move_plan']);

        $this->hubTerms($hub, $this->medium, ['is_offered' => 0]);
        $this->assertRestartedOnDayFiveAndMovedOnDayFifteen($child, $this->large, 'Large');
    }

    public function test_a_changed_price_on_the_named_plan_restarts_the_warning(): void
    {
        [$hub, $child, $admin] = $this->hubAndChild();
        $this->addActiveMembers($child, 15);
        BillingAutomationService::run($this->today);

        $this->hubTerms($hub, $this->medium, ['is_offered' => 1, 'price_monthly' => 45.00]);
        $this->assertRestartedOnDayFiveAndMovedOnDayFifteen($child, $this->medium, 'Medium');

        $over = array_values(array_filter($this->mailer->to($admin), static fn ($m) => str_contains($m['subject'], 'is over its member limit')));
        $this->assertCount(2, $over);
        $this->assertStringContainsString('45.00', $over[1]['body']);
        $moved = array_values(array_filter($this->mailer->to($admin), static fn ($m) => str_contains($m['subject'], 'has moved to')));
        $this->assertStringContainsString('45.00', $moved[0]['body']);
    }

    public function test_members_rising_into_another_plans_range_restarts_the_warning(): void
    {
        $community = $this->makeCommunity('Promise rising', 1, '/1/');
        $this->assignPlan($community, $this->small);
        $this->person($community, ['role' => 'admin']);
        $this->addActiveMembers($community, 15);
        $this->assertSame('Medium', $this->detail(BillingAutomationService::run($this->today), $community)['move_plan']);

        $this->addActiveMembers($community, 10);
        $this->assertRestartedOnDayFiveAndMovedOnDayFifteen($community, $this->large, 'Large');
    }

    public function test_a_removed_custom_price_restarts_the_warning(): void
    {
        $community = $this->makeCommunity('Promise custom', 1, '/1/');
        $this->assignPlan($community, $this->small, ['custom_price_monthly' => 99.00]);
        $this->person($community, ['role' => 'admin']);
        $this->addActiveMembers($community, 15);
        $this->assertArrayNotHasKey('move_plan', $this->detail(BillingAutomationService::run($this->today), $community));

        DB::table('tenant_plan_assignments')->where('tenant_id', $community)->update(['custom_price_monthly' => null]);
        $this->assertRestartedOnDayFiveAndMovedOnDayFifteen($community, $this->medium, 'Medium');
    }

    public function test_a_card_payers_rule_change_to_move_up_restarts_its_episode(): void
    {
        BillingSettings::set('over_limit_action', 'none', null);
        $community = $this->makeCommunity('Promise card', 1, '/1/');
        $this->assignPlan($community, $this->small, ['stripe_subscription_id' => 'sub_promise_' . bin2hex(random_bytes(4))]);
        $this->person($community, ['role' => 'admin']);
        $this->addActiveMembers($community, 15);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $community));

        BillingSettings::set('over_limit_action', 'upgrade', null);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(5)), $community), 'A fresh warning saying a person must move it.');
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(10)), $community));
        $this->assertSame(0, $this->decisionMails());
        $outcome = BillingAutomationService::run($this->day(15));
        $this->assertSame(['member_limit:needs_decision'], $this->actionsFor($outcome, $community));
        $this->assertSame('card_subscription', $this->detail($outcome, $community)['decision_reason']);
        $this->assertSame($this->small, $this->planOf($community));
    }

    public function test_the_move_goes_to_exactly_the_plan_and_price_the_notice_named(): void
    {
        $community = $this->makeCommunity('Promise exact', 1, '/1/');
        $this->assignPlan($community, $this->small, ['discount_percentage' => 10]);
        $admin = $this->person($community, ['role' => 'admin']);
        $this->addActiveMembers($community, 15);
        BillingAutomationService::run($this->today);

        $over = $this->mailer->to($admin)[0]['body'];
        $this->assertSame(1, preg_match('#<strong>([^<]+)</strong> plan \(([^)]+) a month\)#', $over, $named));
        [, $namedPlan, $namedPrice] = $named;

        BillingAutomationService::run($this->day(10));
        $plan = DB::table('pay_plans')->where('id', $this->planOf($community))->value('name');
        $this->assertSame($namedPlan, $plan, 'Moved to the plan the notice named.');
        $moved = array_values(array_filter($this->mailer->to($admin), static fn ($m) => str_contains($m['subject'], 'has moved to')));
        $this->assertCount(1, $moved);
        $this->assertStringContainsString($namedPlan, $moved[0]['subject']);
        $this->assertStringContainsString('<strong>' . $namedPrice . '</strong> a month', $moved[0]['body'], 'At the price the notice named.');
        $this->assertStringContainsString('27.00', $namedPrice);
    }

    public function test_a_hub_paused_in_the_same_run_stops_its_childs_move(): void
    {
        // The child is created first, so it has the lower id, then moved
        // under the hub: run in id order it would be visited first.
        $child = $this->makeCommunity('Order child', 1, '/1/');
        $hub = $this->makeCommunity('Order hub', 1, '/1/', true);
        DB::table('tenants')->where('id', $child)->update(['parent_id' => $hub, 'path' => "/1/{$hub}/{$child}/", 'depth' => 2]);
        $this->assignPlan($child, $this->small);
        $this->person($child, ['role' => 'admin']);
        $this->addActiveMembers($child, 15);

        BillingAutomationService::run($this->day(-10));
        $this->assertSame('over', $this->standingRow($child)->limit_notice_stage);

        // Today the hub's payment clock pauses it.
        $this->standing($hub, [
            'paid_until' => $this->today->subDays(40)->toDateString(),
            'payer' => 'platform_invoice',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->today->subDays(20)->toDateString() . ' 08:00:00',
        ]);
        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['payment:suspend'], $this->actionsFor($outcome, $hub));
        $this->assertSame([], $this->actionsFor($outcome, $child), 'Locked by its hub in this run: not moved.');
        $this->assertSame($this->small, $this->planOf($child));
        $row = $this->standingRow($child);
        $this->assertNull($row->over_limit_since);
        $this->assertNull($row->limit_notice_stage);
    }
}

final class MoveUpCapturingEmailDispatch extends EmailDispatchService
{
    /** @var list<array{to: string, subject: string, body: string}> */
    public array $sent = [];

    public function send(string $to, string $subject, string $body, array $options = []): bool
    {
        $this->sent[] = ['to' => $to, 'subject' => $subject, 'body' => $body];

        return true;
    }

    /** @return list<array{to: string, subject: string, body: string}> */
    public function to(string $email): array
    {
        return array_values(array_filter($this->sent, static fn (array $m): bool => $m['to'] === $email));
    }
}
