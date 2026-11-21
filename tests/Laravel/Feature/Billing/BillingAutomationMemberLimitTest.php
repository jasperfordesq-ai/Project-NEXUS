<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The member-limit clock of the daily check: approaching (80%), reached
 * (100%), over; optionally a pause after a number of days over.
 *
 * Active members are counted the way the packages are sized: active accounts
 * that signed in within the last 90 days, in the community and below it.
 */
final class BillingAutomationMemberLimitTest extends TestCase
{
    use DatabaseTransactions;
    use BillingAutomationFixtures;

    private CarbonImmutable $today;
    private int $plan100;
    private int $community;
    private string $admin;
    private string $platformMember;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAutomation();

        $this->today = CarbonImmutable::parse('2027-03-10');
        $this->plan100 = $this->makePlan(100, true);

        $this->community = $this->makeCommunity('Limit community', 1, '/1/');
        $this->assignPlan($this->community, $this->plan100);
        $this->admin = $this->person($this->community, ['role' => 'admin']);
        $this->platformMember = $this->person($this->testTenantId, [
            'role' => 'member', 'is_super_admin' => true, 'is_god' => true,
        ]);

        $this->switchOn();
    }

    protected function tearDown(): void
    {
        $this->tearDownAutomation();
    }

    private function makePlan(?int $maxUsers, bool $standard): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Limit plan ' . ($maxUsers ?? 'unlimited'),
            'slug' => 'limit-plan-' . bin2hex(random_bytes(5)),
            'tier_level' => 1,
            'max_users' => $maxUsers,
            'is_standard' => $standard ? 1 : 0,
            'is_active' => 1,
            'created_at' => now(),
        ]);
    }

    private function assignPlan(int $tenantId, int $planId): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->delete();
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
        ]);
    }

    /** Add $count active members who signed in recently. */
    private function addActiveMembers(int $tenantId, int $count): void
    {
        $rows = [];
        for ($i = 0; $i < $count; $i++) {
            $rows[] = [
                'tenant_id' => $tenantId,
                'first_name' => 'Active',
                'last_name' => 'Member',
                'name' => 'Active Member',
                'email' => 'limit.' . bin2hex(random_bytes(7)) . '@example.com',
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

    /** Make $count of the community's recent members no longer active. */
    private function retire(int $tenantId, int $count): void
    {
        $ids = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('email', 'like', 'limit.%')
            ->where('last_login_at', '>=', now()->subDays(90))
            ->limit($count)
            ->pluck('id')
            ->all();
        DB::table('users')->whereIn('id', $ids)->update(['last_login_at' => now()->subDays(200)]);
    }

    /** The admin account counts too: it signed in never, so it does not. */
    public function test_stages_at_79_80_100_and_101_percent_each_once(): void
    {
        $this->addActiveMembers($this->community, 79);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $this->addActiveMembers($this->community, 1);
        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:approaching'], $this->actionsFor($outcome, $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community), 'Once per stage.');

        $this->addActiveMembers($this->community, 20);
        $this->assertSame(['member_limit:reached'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $this->addActiveMembers($this->community, 1);
        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $row = $this->standingRow($this->community);
        $this->assertSame('over', $row->limit_notice_stage);
        $this->assertSame($this->today->toDateString(), substr((string) $row->over_limit_since, 0, 10));
        $this->assertFalse(BillingLock::isLocked($this->community), 'Never paused on the first day over.');

        $adminMail = array_map(static fn ($r) => (string) $r->subject, $this->mailTo($this->admin));
        $this->assertCount(3, $adminMail);
        $this->assertStringContainsString('close to its member limit', $adminMail[0]);
        $this->assertStringContainsString('has reached its member limit', $adminMail[1]);
        $this->assertStringContainsString('is over its member limit', $adminMail[2]);

        // Whoever it pays (the platform team): every stage. Was "reached and
        // over, not approaching" until hub plans Stage 4 (DESIGN 6.5: the 80%
        // notice also goes to whoever the community pays).
        $this->assertCount(3, $this->mailTo($this->platformMember));
    }

    public function test_dropping_just_under_keeps_the_stage_and_rising_again_tells_nobody(): void
    {
        // Was: "dropping back clears the stage and rising again tells people
        // again" — which mailed everyone each time a community hovered at its
        // limit. 99% is not clearly below the line. Fix round 4 (R1a): nor
        // does it end the episode, so the first day over is kept too (fix
        // round 3 had briefly cleared it and re-sent "over").
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);

        $this->retire($this->community, 2);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $row = $this->standingRow($this->community);
        $this->assertSame('over', $row->limit_notice_stage);
        $this->assertSame($this->today->toDateString(), substr((string) $row->over_limit_since, 0, 10), 'Not clearly under: the episode is kept.');

        $this->addActiveMembers($this->community, 2);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertCount(1, $this->mailTo($this->admin));
    }

    public function test_hovering_at_the_limit_sends_the_over_notice_once(): void
    {
        // Fix round 4 (R1a): hovering between 100% and 101% stays one episode,
        // so one "over" notice; "reached" is never re-told either.
        $this->addActiveMembers($this->community, 101);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        for ($day = 1; $day <= 6; $day++) {
            if ($day % 2 === 1) {
                $this->retire($this->community, 1);
            } else {
                $this->addActiveMembers($this->community, 1);
            }
            $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->day($day)), $this->community), "Preview day {$day}.");
            $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day($day)), $this->community), "Day {$day}.");
        }

        $this->assertCount(1, $this->mailTo($this->admin));
        $this->assertCount(1, $this->overMail($this->admin));
    }

    public function test_hovering_at_the_warning_percent_sends_the_approaching_notice_once(): void
    {
        $this->addActiveMembers($this->community, 80);
        $this->assertSame(['member_limit:approaching'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        for ($day = 1; $day <= 6; $day++) {
            if ($day % 2 === 1) {
                $this->retire($this->community, 1);
            } else {
                $this->addActiveMembers($this->community, 1);
            }
            $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day($day)), $this->community), "Day {$day}.");
        }

        $this->assertCount(1, $this->mailTo($this->admin));
    }

    public function test_a_genuine_recovery_then_going_over_a_month_later_tells_people_again(): void
    {
        $this->addActiveMembers($this->community, 101);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $this->retire($this->community, 11); // 90%
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
        $this->assertSame('approaching', $this->standingRow($this->community)->limit_notice_stage, 'Clearly below, and a month since the notice.');

        $this->addActiveMembers($this->community, 11); // 101%
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::preview($this->day(40)), $this->community));
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(40)), $this->community));
        $this->assertCount(2, $this->mailTo($this->admin));
    }

    public function test_a_person_restoring_an_over_limit_pause_gets_the_full_grace_again(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        BillingSettings::set('over_limit_grace_days', 30, null);
        $this->addActiveMembers($this->community, 101);
        // Fix round 3: the "over" notice is on record (it was sent 29 days
        // ago); a stage with no notice day no longer stands for a warning.
        $this->overSince($this->community, 29);

        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertTrue(BillingLock::isLocked($this->community));

        // The platform team lifts it on day 1.
        $actor = (int) DB::table('users')->where('email', $this->platformMember)->value('id');
        $this->travelTo($this->day(1)->setTime(10, 0));
        try {
            BillingStandingService::restore($this->community, $actor, 'Agreed to move package next month');
        } finally {
            $this->travelBack();
        }
        // Fix round 3 (R4): a hand restore starts a new episode. Was: the first
        // day over moved to the restore day and nobody was mailed again, so the
        // next pause came with no warning for it.
        $this->assertNull($this->standingRow($this->community)->over_limit_since);
        $this->assertFalse(BillingLock::isLocked($this->community));

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::preview($this->day(2)), $this->community));
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(2)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community), 'Not overruled the next morning.');
        $this->assertCount(1, $this->overMail($this->admin), 'A fresh "over" notice for the new episode.');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));

        // A full 30 days after the fresh notice, still over: paused again.
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(32)), $this->community));
        $this->assertTrue(BillingLock::isLocked($this->community));
    }

    public function test_the_check_reopening_a_community_back_under_does_not_restart_anything(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'over_limit');
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(40)->toDateString(), 'limit_notice_stage' => 'over']);

        $this->retire($this->community, 1);
        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertNull($this->standingRow($this->community)->over_limit_since, 'The system lifting it clears the days over, as before.');
    }

    public function test_warn_only_never_pauses(): void
    {
        // Was the default until hub plans Stage 4; now chosen explicitly.
        BillingSettings::set('over_limit_action', 'none', null);
        $this->addActiveMembers($this->community, 150);
        // Fix round 3: warned 200 days ago (a stage with no notice day is no
        // longer a warning, and would be re-sent).
        $this->overSince($this->community, 200);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_pause_only_after_the_grace_days_and_restore_when_back_under(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        BillingSettings::set('over_limit_grace_days', 30, null);
        $this->addActiveMembers($this->community, 101);
        // Fix round 3: the "over" notice went out 29 days ago.
        $this->overSince($this->community, 29);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community), 'Day 29 of 30: not yet.');
        $this->assertFalse(BillingLock::isLocked($this->community));

        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $standing = BillingStandingService::get($this->community);
        $this->assertTrue($standing['locked']);
        $this->assertSame('auto', $standing['suspension_source']);
        $this->assertSame('over_limit', $standing['suspension_reason']);
        $this->assertStringContainsString('has been paused', (string) $this->mailTo($this->admin)[0]->subject);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community), 'No second pause.');

        $this->retire($this->community, 1);
        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->day(2)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $mail = $this->mailTo($this->admin);
        $this->assertStringContainsString('open again', (string) end($mail)->subject);
    }

    public function test_a_bigger_plan_restores_a_pause_for_being_over(): void
    {
        $this->addActiveMembers($this->community, 150);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'over_limit');

        $this->assignPlan($this->community, $this->makePlan(1000, true));

        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_a_pause_for_being_over_is_lifted_when_no_limit_applies_any_more(): void
    {
        $this->addActiveMembers($this->community, 150);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'over_limit');
        DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->delete();

        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_an_exempt_community_is_never_paused_or_warned(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        $this->addActiveMembers($this->community, 150);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(90)->toDateString()]);
        BillingStandingService::setExempt($this->community, true, 1, 'Council contract');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(0, $this->mailTo($this->admin));
    }

    public function test_getting_back_under_the_limit_does_not_lift_a_pause_for_non_payment(): void
    {
        BillingStandingService::suspend($this->community, null, 'auto');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $standing = BillingStandingService::get($this->community);
        $this->assertTrue($standing['locked']);
        $this->assertSame('non_payment', $standing['suspension_reason']);
    }

    public function test_a_pause_for_being_over_stays_when_the_payment_is_also_long_overdue(): void
    {
        BillingStandingService::suspend($this->community, null, 'auto', null, 'over_limit');
        $this->standing($this->community, ['paid_until' => $this->today->subDays(30)->toDateString()]);

        BillingAutomationService::run($this->today);

        $standing = BillingStandingService::get($this->community);
        $this->assertTrue($standing['locked'], 'Back under the limit, but 30 days late: still paused.');
        $this->assertSame('non_payment', $standing['suspension_reason']);
    }

    public function test_no_plan_an_unlimited_plan_and_a_legacy_plan_are_skipped(): void
    {
        $noPlan = $this->makeCommunity('Limit no plan', 1, '/1/');
        $unlimited = $this->makeCommunity('Limit unlimited', 1, '/1/');
        $legacy = $this->makeCommunity('Limit legacy', 1, '/1/');
        $this->assignPlan($unlimited, $this->makePlan(null, true));
        $this->assignPlan($legacy, $this->makePlan(10, false));

        foreach ([$noPlan, $unlimited, $legacy] as $id) {
            $this->addActiveMembers($id, 50);
        }

        $outcome = BillingAutomationService::run($this->today);

        foreach ([$noPlan, $unlimited, $legacy] as $id) {
            $this->assertSame([], $this->actionsFor($outcome, $id));
            $this->assertNull($this->standingRow($id)?->limit_notice_stage);
        }
    }

    public function test_an_empty_path_counts_only_the_communitys_own_members(): void
    {
        $child = $this->makeCommunity('Limit child', $this->community, "/1/{$this->community}/");
        $this->addActiveMembers($this->community, 50);
        $this->addActiveMembers($child, 60);

        // With its path, the branch has 110: over.
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));

        DB::table('tenants')->where('id', $this->community)->update(['path' => '']);

        // Without one, only its own 50 are counted, never the platform's.
        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));
    }

    public function test_the_limit_is_the_hubs_member_number(): void
    {
        $local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $hub = $this->makeCommunity('Limit hub', 1, '/1/', true);
        $child = $this->makeCommunity('Limit hub child', $hub, "/1/{$hub}/");
        $platformPayer = $this->makeCommunity('Limit platform payer', 1, '/1/');
        $this->assignPlan($child, $local);
        $this->assignPlan($platformPayer, $local);
        $this->addActiveMembers($child, 60);
        $this->addActiveMembers($platformPayer, 60);

        // The hub lets its children have 50 on Local (the default is far more).
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $hub, 'pay_plan_id' => $local, 'max_users' => 50, 'name' => 'Hub local',
            'created_at' => now(), 'updated_at' => now(),
        ]);
        \App\Support\Billing\PlanTerms::flush();

        $preview = BillingAutomationService::preview($this->today);

        $this->assertSame(['member_limit:over'], $this->actionsFor($preview, $child));
        $entry = array_values(array_filter($preview, fn ($e) => $e['tenant_id'] === $child))[0];
        $this->assertSame(50, $entry['detail']['max_users']);
        $this->assertSame('Hub local', $entry['detail']['plan_name']);

        // The same plan, for a community that pays the platform: the default number.
        $this->assertSame([], $this->actionsFor($preview, $platformPayer));

        $state = BillingAutomationService::memberLimitState($child);
        $this->assertSame(50, $state['max']);
        $this->assertSame('over', $state['stage']);
    }

    public function test_switched_off_the_preview_lists_the_member_limit_actions_and_nothing_happens(): void
    {
        DB::table('platform_billing_settings')->where('setting_key', 'automation_enabled')->delete();
        BillingSettings::flush();
        $this->addActiveMembers($this->community, 101);

        $preview = BillingAutomationService::preview($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($preview, $this->community));
        $entry = array_values(array_filter($preview, fn ($e) => $e['tenant_id'] === $this->community))[0];
        $this->assertSame('Limit community', $entry['tenant_name']);
        $this->assertSame(101, $entry['detail']['active_members']);
        $this->assertSame(100, $entry['detail']['max_users']);
        $this->assertSame(101, $entry['detail']['percent']);

        $this->assertSame([], BillingAutomationService::run($this->today));
        $this->assertNull($this->standingRow($this->community)?->limit_notice_stage);
        $this->assertCount(0, $this->mailTo($this->admin));
    }

    // ── The rule for going over (hub plans Stage 4) ─────────────────────────

    /** No stored platform setting: the default. */
    private function forgetPlatformRule(): void
    {
        DB::table('platform_billing_settings')->whereIn('setting_key', ['over_limit_action', 'over_limit_grace_days'])->delete();
        BillingSettings::flush();
    }

    /** A hub, a child that pays it on the 100-member plan, the child's admin and the hub's manager. */
    private function hubAndChild(): array
    {
        $hub = $this->makeCommunity('Rule limit hub', 1, '/1/', true);
        $child = $this->makeCommunity('Rule limit child', $hub, "/1/{$hub}/");
        $this->assignPlan($child, $this->plan100);
        $admin = $this->person($child, ['role' => 'admin']);
        $manager = $this->person($hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);

        return [$hub, $child, $admin, $manager];
    }

    public function test_default_rule_pauses_after_the_days(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);

        // Day 1: told it is over, with the date it will be paused.
        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $this->assertSame($this->day(30)->toDateString(), $outcome[0]['detail']['pause_date']);
        $this->assertSame('pause', $outcome[0]['detail']['rule']);
        $this->assertSame(30, $outcome[0]['detail']['grace_days']);
        $this->assertFalse(BillingLock::isLocked($this->community));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(29)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));

        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
        $this->assertSame('over_limit', BillingStandingService::get($this->community)['suspension_reason']);
    }

    public function test_a_communitys_own_days_are_used(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::setOverLimitRule($this->community, null, 5, 1);

        BillingAutomationService::run($this->today);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(4)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(5)), $this->community));
    }

    /** @return array<string, array{0: string}> */
    public static function rulesThatNeverPause(): array
    {
        return [
            'warn only' => ['none'],
            'stop new members (carried out by a later stage)' => ['block_joining'],
            'move up (carried out by a later stage)' => ['upgrade'],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('rulesThatNeverPause')]
    public function test_only_the_pause_rule_pauses(string $rule): void
    {
        $this->addActiveMembers($this->community, 150);
        BillingStandingService::setOverLimitRule($this->community, $rule, null, 1);
        // Fix round 3: warned 200 days ago.
        $this->overSince($this->community, 200);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_changed_terms_restart_the_count(): void
    {
        [$hub, $child, $admin] = $this->hubAndChild();
        $this->addActiveMembers($child, 101);
        // Over for 40 days under the hub's warn-only default.
        BillingStandingService::setChildrenOverLimitRule($hub, 'none', null, 1);
        $this->standing($child, ['over_limit_since' => $this->today->subDays(40)->toDateString(), 'limit_notice_stage' => 'over', 'limit_notice_at' => $this->today->subDays(40)->toDateString() . ' 08:00:00', 'limit_terms_key' => $this->termsKey($child)]);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $child));

        // The hub lowers nothing, but switches its children to pause after 30 days.
        BillingStandingService::setChildrenOverLimitRule($hub, 'pause', 30, 1);

        $outcome = BillingAutomationService::run($this->day(1));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $child), 'A fresh "over" notice, not a pause.');
        $this->assertFalse(BillingLock::isLocked($child));
        $this->assertSame($this->day(31)->toDateString(), array_values(array_filter($outcome, fn ($e) => $e['tenant_id'] === $child))[0]['detail']['pause_date']);
        $this->assertCount(1, $this->mailTo($admin));
        $this->assertStringContainsString('is over its member limit', (string) $this->mailTo($admin)[0]->subject);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(30)), $child));
        $this->assertFalse(BillingLock::isLocked($child));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $child));
        $this->assertTrue(BillingLock::isLocked($child));
    }

    public function test_lowered_member_number_restarts_the_count(): void
    {
        [$hub, $child, $admin, $manager] = $this->hubAndChild();
        $this->addActiveMembers($child, 70);
        // The hub's version holds its children to 60: over for 40 days under pause after 30.
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $hub, 'pay_plan_id' => $this->plan100, 'max_users' => 60,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        \App\Support\Billing\PlanTerms::flush();
        $this->standing($child, ['over_limit_since' => $this->today->subDays(20)->toDateString(), 'limit_notice_stage' => 'over', 'limit_notice_at' => $this->today->subDays(20)->toDateString() . ' 08:00:00', 'limit_terms_key' => $this->termsKey($child)]);

        // The hub's manager lowers the number to 50.
        $user = \App\Models\User::withoutGlobalScopes()->where('email', $manager)->firstOrFail();
        $this->testTenantId = $hub;
        \Laravel\Sanctum\Sanctum::actingAs($user, ['*']);
        \App\Core\TenantContext::setById($hub);
        \App\Core\SuperPanelAccess::reset();
        try {
            $this->apiPut("/v2/admin/super/branch-plans/{$hub}/plans/{$this->plan100}", ['max_users' => 50])->assertStatus(200);
        } finally {
            \App\Core\SuperPanelAccess::reset();
        }

        $this->assertNull($this->standingRow($child)->over_limit_since, 'The count starts again.');

        // Day 11 of the old count would have been day 31: not paused, told afresh.
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(11)), $child));
        $this->assertFalse(BillingLock::isLocked($child));
        $this->assertSame(1, count($this->mailTo($admin)));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(41)), $child));
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('rulesThatNeverPause')]
    public function test_leaving_the_pause_rule_lifts_a_limit_pause(string $rule): void
    {
        $this->addActiveMembers($this->community, 150);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'over_limit');
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(40)->toDateString(), 'limit_notice_stage' => 'over']);

        BillingStandingService::setOverLimitRule($this->community, $rule, null, 1);
        $this->assertTrue(BillingLock::isLocked($this->community), 'Setting the rule lifts nothing by itself.');

        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));
        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertStringContainsString('open again', (string) $this->mailTo($this->admin)[0]->subject);
    }

    public function test_a_pause_for_non_payment_stays_whatever_the_rule(): void
    {
        $this->addActiveMembers($this->community, 150);
        BillingStandingService::suspend($this->community, null, 'manual');
        BillingStandingService::setOverLimitRule($this->community, 'none', null, 1);

        BillingAutomationService::run($this->today);

        $this->assertTrue(BillingLock::isLocked($this->community));
        $this->assertSame('non_payment', BillingStandingService::get($this->community)['suspension_reason']);
    }

    public function test_switch_off_means_nothing_happens(): void
    {
        $this->forgetPlatformRule();
        DB::table('platform_billing_settings')->where('setting_key', 'automation_enabled')->delete();
        BillingSettings::flush();
        $this->addActiveMembers($this->community, 150);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(60)->toDateString(), 'limit_notice_stage' => 'over']);

        $this->assertSame([], BillingAutomationService::run($this->today));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(0, $this->mailTo($this->admin));

        // The preview still says what would happen. Fix round 1: this row has
        // a count but no terms on record (a count kept under the old warn-only
        // default), so the count starts again with a fresh notice; it was
        // `suspend` before the terms key existed.
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertNull(BillingAutomationService::memberLimitState($this->community)['acts_on'], 'No date is promised while the checks are off.');
    }

    public function test_exempt_is_untouched(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 150);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(90)->toDateString()]);
        BillingStandingService::setExempt($this->community, true, 1, 'Council contract');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(0, $this->mailTo($this->admin));
    }

    public function test_the_admin_banner_says_the_rule_and_the_pause_day(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);
        // The banner counts from the real today (members are counted by it too).
        $now = CarbonImmutable::parse(now()->toDateString());

        $this->assertSame('pause', BillingAutomationService::memberLimitState($this->community)['rule']);
        $this->assertSame($now->addDays(30)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on'], 'Counted from today when no first day over is recorded.');

        // Fix round 3 (R3): counted from this episode's "over" notice. A first
        // day over with no notice on record still counts from today.
        $this->standing($this->community, ['over_limit_since' => $now->subDays(10)->toDateString(), 'limit_terms_key' => $this->termsKey($this->community)]);
        $this->assertSame($now->addDays(30)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on'], 'Not warned yet: today plus the days.');

        $this->standing($this->community, ['limit_notice_stage' => 'over', 'limit_notice_at' => $now->subDays(10)->toDateString() . ' 08:00:00']);
        $this->assertSame($now->addDays(20)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on']);

        $this->standing($this->community, ['over_limit_since' => $now->subDays(100)->toDateString(), 'limit_notice_at' => $now->subDays(100)->toDateString() . ' 08:00:00', 'limit_terms_key' => $this->termsKey($this->community)]);
        $this->assertSame($now->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on'], 'Never a day already gone.');

        BillingStandingService::setOverLimitRule($this->community, 'block_joining', null, 1);
        $state = BillingAutomationService::memberLimitState($this->community);
        $this->assertSame('block_joining', $state['rule']);
        $this->assertNull($state['acts_on']);
    }

    // ── Fix round 1: the count notices changed terms by itself ──────────────

    /** The terms a count running now is held to, as the daily check records them. */
    private function termsKey(int $tenantId): string
    {
        return \App\Support\Billing\OverLimitRule::termsKey($tenantId, BillingAutomationService::watchedLimit($tenantId));
    }

    /** Over for a while under the present terms, notice sent. */
    private function overSince(int $tenantId, int $daysAgo): void
    {
        $this->standing($tenantId, [
            'over_limit_since' => $this->today->subDays($daysAgo)->toDateString(),
            'limit_notice_stage' => 'over',
            'limit_notice_at' => $this->today->subDays($daysAgo)->toDateString() . ' 08:00:00',
            'limit_terms_key' => $this->termsKey($tenantId),
        ]);
    }

    public function test_a_payer_change_restarts_the_count(): void
    {
        $this->forgetPlatformRule();
        [$hub, $child, $admin] = $this->hubAndChild();
        $this->addActiveMembers($child, 101);
        BillingStandingService::setChildrenOverLimitRule($hub, 'none', null, 1);
        $this->overSince($child, 40);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $child), 'Warn only: nothing.');

        // Now it pays the platform: the hub's warn-only rule no longer reaches it.
        BillingStandingService::setPayer($child, 'platform_invoice', 1);

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $child));
        $this->assertFalse(BillingLock::isLocked($child), 'Not paused the next morning.');
        $this->assertCount(1, $this->mailTo($admin));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(30)), $child));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $child));
    }

    public function test_an_exemption_taken_off_starts_a_fresh_count(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 150);
        $this->overSince($this->community, 90);
        // Exempted without the service (as an old record could be): the
        // check itself must forget the count while it is exempt.
        $this->standing($this->community, ['exempt' => 1]);
        BillingLock::flush();

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $row = $this->standingRow($this->community);
        $this->assertNull($row->over_limit_since);
        $this->assertNull($row->limit_notice_stage);
        $this->assertNull($row->limit_notice_at);
        $this->assertNull($row->limit_terms_key);

        $this->standing($this->community, ['exempt' => 0]);
        BillingLock::flush();
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
    }

    public function test_taking_an_exemption_off_through_the_service_restarts_the_count_at_once(): void
    {
        $this->addActiveMembers($this->community, 150);
        $this->overSince($this->community, 90);
        BillingStandingService::setExempt($this->community, true, 1, 'Council contract');
        $this->overSince($this->community, 90);

        BillingStandingService::setExempt($this->community, false, 1);

        $this->assertNull($this->standingRow($this->community)->over_limit_since);
    }

    public function test_a_count_recorded_under_the_old_default_is_not_paused_at_once(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);
        // Kept under the old warn-only default: a count and a stage, no terms.
        $this->standing($this->community, [
            'over_limit_since' => $this->today->subDays(60)->toDateString(),
            'limit_notice_stage' => 'over',
            'limit_notice_at' => $this->today->subDays(60)->toDateString() . ' 08:00:00',
        ]);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community), 'A fresh notice under the new rule.');
        $this->assertSame($this->day(30)->toDateString(), $outcome[0]['detail']['pause_date']);
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame($this->termsKey($this->community), $this->standingRow($this->community)->limit_terms_key);
        $this->assertSame($this->today->toDateString(), substr((string) $this->standingRow($this->community)->over_limit_since, 0, 10));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(29)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
    }

    public function test_a_first_run_with_nothing_on_record_only_records_the_terms(): void
    {
        $this->addActiveMembers($this->community, 50);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertSame($this->termsKey($this->community), $this->standingRow($this->community)->limit_terms_key);
    }

    public function test_a_restart_with_the_terms_unchanged_sends_a_fresh_notice(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 25);

        BillingStandingService::restartLimitClock([$this->community]);

        $outcome = BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community));
        $this->assertSame($this->day(30)->toDateString(), $outcome[0]['detail']['pause_date']);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(5)), $this->community), 'The old count would have paused on day 5.');
    }

    public function test_a_platform_default_change_restarts_only_communities_it_changes(): void
    {
        BillingSettings::set('over_limit_action', 'none', null);
        $own = $this->makeCommunity('Limit own rule', 1, '/1/');
        $this->assignPlan($own, $this->plan100);
        $ownAdmin = $this->person($own, ['role' => 'admin']);
        BillingStandingService::setOverLimitRule($own, 'pause', 30, 1);
        $this->addActiveMembers($this->community, 101);
        $this->addActiveMembers($own, 101);

        BillingAutomationService::run($this->today);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));

        BillingSettings::set('over_limit_action', 'pause', null);
        $this->assertSame('over', $this->standingRow($this->community)->limit_notice_stage, 'Nothing is cleared when the setting is saved.');

        $outcome = BillingAutomationService::run($this->day(2));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community), 'Follows the default: told afresh.');
        $this->assertSame([], $this->actionsFor($outcome, $own), 'Has its own rule: nothing changed for it.');
        $this->assertCount(2, $this->mailTo($this->admin));
        $this->assertCount(1, $this->mailTo($ownAdmin));
    }

    public function test_a_hub_default_change_restarts_only_its_children_without_their_own_rule(): void
    {
        [$hub, $follows, $followsAdmin] = $this->hubAndChild();
        $ownRule = $this->makeCommunity('Rule limit own child', $hub, "/1/{$hub}/");
        $this->assignPlan($ownRule, $this->plan100);
        $ownAdmin = $this->person($ownRule, ['role' => 'admin']);
        BillingStandingService::setChildrenOverLimitRule($hub, 'none', null, 1);
        BillingStandingService::setOverLimitRule($ownRule, 'block_joining', null, 1);
        $this->addActiveMembers($follows, 101);
        $this->addActiveMembers($ownRule, 101);
        BillingAutomationService::run($this->today);

        BillingStandingService::setChildrenOverLimitRule($hub, 'pause', 30, 1);
        $this->assertSame('over', $this->standingRow($follows)->limit_notice_stage, 'Nothing is cleared when the default is saved.');

        $outcome = BillingAutomationService::run($this->day(1));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $follows));
        $this->assertSame([], $this->actionsFor($outcome, $ownRule));
        $this->assertCount(2, $this->mailTo($followsAdmin));
        $this->assertCount(1, $this->mailTo($ownAdmin));
    }

    public function test_a_community_paused_for_being_over_is_not_restarted_by_a_days_change(): void
    {
        $this->forgetPlatformRule();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 31);
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $mailBefore = count($this->mailTo($this->admin));

        BillingSettings::set('over_limit_grace_days', 45, null);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->day(1)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertTrue(BillingLock::isLocked($this->community), 'Stays paused: still over, still a pause rule.');
        $this->assertCount($mailBefore, $this->mailTo($this->admin));
        $this->assertSame($this->termsKey($this->community), $this->standingRow($this->community)->limit_terms_key);
    }

    /** @return array<string, array{0: string}> */
    public static function pauseReasons(): array
    {
        return ['paused for non-payment' => ['non_payment'], 'paused for being over' => ['over_limit']];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('pauseReasons')]
    public function test_a_paused_community_gets_no_limit_notice(string $reason): void
    {
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::suspend($this->community, null, 'auto', null, $reason);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->today), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertCount(0, $this->mailTo($this->admin));
        if ($reason === 'over_limit') {
            $this->assertSame('over', $this->standingRow($this->community)->limit_notice_stage, 'The stage is recorded silently.');
        } else {
            // Fix round 2: a silent "over" here let the community be paused
            // for being over the day it was restored, never having been told.
            $row = $this->standingRow($this->community);
            $this->assertNull($row->limit_notice_stage, 'No stage is recorded while paused for something else.');
            $this->assertNull($row->over_limit_since);
        }
    }

    // ── Fix round 2: a pause for something else carries no silent count ─────

    /** Pause after 30 days over, set explicitly so the tests do not lean on the default. */
    private function pauseAfterThirtyDays(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        BillingSettings::set('over_limit_grace_days', 30, null);
    }

    /** @return list<string> subjects of the "over its member limit" mails to $email */
    private function overMail(string $email): array
    {
        return array_values(array_filter(
            array_map(static fn ($r) => (string) $r->subject, $this->mailTo($email)),
            static fn (string $s) => str_contains($s, 'is over its member limit'),
        ));
    }

    public function test_a_community_paused_for_non_payment_keeps_no_silent_count(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'non_payment');

        foreach ([0, 40] as $offset) {
            $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->day($offset)), $this->community), "Preview day {$offset}.");
            $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day($offset)), $this->community), "Day {$offset}.");
            $row = $this->standingRow($this->community);
            $this->assertNull($row->over_limit_since, "Day {$offset}: no first day over recorded.");
            $this->assertNull($row->limit_notice_stage, "Day {$offset}: no stage recorded.");
        }

        $this->assertCount(0, $this->mailTo($this->admin));
        $this->assertSame('non_payment', BillingStandingService::get($this->community)['suspension_reason']);
    }

    public function test_a_community_restored_after_non_payment_is_warned_before_any_limit_pause(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::suspend($this->community, null, 'auto', null, 'non_payment');
        BillingAutomationService::run($this->today);
        BillingAutomationService::run($this->day(40));

        // It pays and the platform team restores it on day 40.
        $actor = (int) DB::table('users')->where('email', $this->platformMember)->value('id');
        $this->travelTo($this->day(40)->setTime(10, 0));
        try {
            BillingStandingService::restore($this->community, $actor, 'Paid');
        } finally {
            $this->travelBack();
        }
        $this->assertFalse(BillingLock::isLocked($this->community));

        $outcome = BillingAutomationService::run($this->day(41));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community), 'Told it is over, not paused.');
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(1, $this->overMail($this->admin));
        $this->assertSame($this->day(41)->toDateString(), substr((string) $this->standingRow($this->community)->over_limit_since, 0, 10));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(70)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community), 'Day 29 of 30 since the warning: not yet.');

        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(71)), $this->community));
        $this->assertTrue(BillingLock::isLocked($this->community));
        $this->assertSame('over_limit', BillingStandingService::get($this->community)['suspension_reason']);
        $this->assertCount(1, $this->overMail($this->admin), 'One "over" notice in all.');
    }

    public function test_a_count_already_on_record_is_cleared_when_paused_for_non_payment(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 20);
        $termsKey = $this->standingRow($this->community)->limit_terms_key;
        BillingStandingService::suspend($this->community, null, 'auto', null, 'non_payment');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $row = $this->standingRow($this->community);
        $this->assertNull($row->over_limit_since);
        $this->assertNull($row->limit_notice_stage);
        $this->assertNull($row->limit_notice_at);
        $this->assertSame($termsKey, $row->limit_terms_key, 'The terms on record are left alone.');
        $this->assertCount(0, $this->mailTo($this->admin));
    }

    public function test_preview_matches_run_after_a_terms_change(): void
    {
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 40);
        BillingSettings::set('over_limit_grace_days', 50, null);

        $preview = BillingAutomationService::preview($this->day(1));
        $run = BillingAutomationService::run($this->day(1));

        $this->assertSame(['member_limit:over'], $this->actionsFor($run, $this->community));
        $this->assertSame($this->actionsFor($preview, $this->community), $this->actionsFor($run, $this->community));
        $pick = fn (array $o) => array_values(array_filter($o, fn ($e) => $e['tenant_id'] === $this->community))[0]['detail'];
        $this->assertSame($pick($preview), $pick($run));
    }

    public function test_the_pause_day_counts_from_today_while_a_restart_is_pending(): void
    {
        $this->addActiveMembers($this->community, 101);
        $now = CarbonImmutable::parse(now()->toDateString());
        $this->standing($this->community, [
            'over_limit_since' => $now->subDays(25)->toDateString(), 'limit_notice_stage' => 'over',
            // Fix round 3: the notice day is what the days count from.
            'limit_notice_at' => $now->subDays(25)->toDateString() . ' 08:00:00',
            'limit_terms_key' => $this->termsKey($this->community),
        ]);
        $this->assertSame($now->addDays(5)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on']);

        BillingSettings::set('over_limit_grace_days', 40, null);

        $this->assertSame($now->addDays(40)->toDateString(), BillingAutomationService::memberLimitState($this->community)['acts_on']);
    }

    public function test_member_limit_rule_is_none_while_automatic_checks_are_off(): void
    {
        $this->addActiveMembers($this->community, 101);
        BillingStandingService::setOverLimitRule($this->community, 'block_joining', null, 1);
        $this->assertSame('block_joining', BillingAutomationService::memberLimitState($this->community)['rule']);

        BillingSettings::set('automation_enabled', false, null);

        $state = BillingAutomationService::memberLimitState($this->community);
        $this->assertSame('none', $state['rule'], 'Nothing will happen, so the banner must not say it will.');
        $this->assertNull($state['acts_on']);
    }

    // ── Fix round 3: the pause is counted from this episode's warning ───────

    public function test_going_over_again_after_a_lift_is_a_new_warning(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        BillingSettings::set('over_limit_grace_days', 10, null);
        $this->addActiveMembers($this->community, 101);

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));

        $this->retire($this->community, 2); // 99%: back under
        $this->assertSame(['member_limit:restore'], $this->actionsFor(BillingAutomationService::run($this->day(12)), $this->community));

        $this->addActiveMembers($this->community, 2); // over again
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(20)), $this->community), 'A new episode is warned again.');
        $this->assertCount(2, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(29)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
    }

    public function test_dipping_under_and_back_over_is_a_new_warning(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        // Fix round 4 (R1a/R1c): 94% is clearly under, so the episode ends;
        // the stage is still held at "over" by the hysteresis.
        $this->retire($this->community, 7);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(3)), $this->community));
        $this->assertSame('over', $this->standingRow($this->community)->limit_notice_stage);
        $this->assertNull($this->standingRow($this->community)->over_limit_since);

        $this->addActiveMembers($this->community, 7);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::preview($this->day(5)), $this->community));
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(5)), $this->community), 'Told again for the new episode.');
        $this->assertCount(2, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(34)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(35)), $this->community));
    }

    public function test_a_hand_restore_is_followed_by_a_fresh_warning_and_the_full_days(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));

        // A manager restores it by hand on day 31, still over.
        $actor = (int) DB::table('users')->where('email', $this->platformMember)->value('id');
        $this->travelTo($this->day(31)->setTime(10, 0));
        try {
            BillingStandingService::restore($this->community, $actor, 'Talking to them');
        } finally {
            $this->travelBack();
        }

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(32)), $this->community));
        $this->assertCount(2, $this->overMail($this->admin));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(61)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(62)), $this->community));
    }

    public function test_switching_the_checks_on_warns_before_it_pauses(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 25);

        BillingSettings::setMany(['automation_enabled' => false], null);
        BillingSettings::setMany(['automation_enabled' => true], null);

        $outcome = BillingAutomationService::run($this->day(30));
        $this->assertSame(['member_limit:over'], $this->actionsFor($outcome, $this->community), 'Warned first, not paused at once.');
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(1, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(59)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(60)), $this->community));
    }

    public function test_saving_the_switch_unchanged_keeps_the_count(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 25);

        BillingSettings::setMany(['automation_enabled' => true, 'over_limit_grace_days' => 30], null);

        $this->assertNotNull($this->standingRow($this->community)->over_limit_since);
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(5)), $this->community));
    }

    public function test_a_plan_with_no_member_number_clears_the_count(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        $this->overSince($this->community, 25);

        $this->assignPlan($this->community, $this->makePlan(null, true));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $row = $this->standingRow($this->community);
        $this->assertNull($row->over_limit_since);
        $this->assertNull($row->limit_notice_stage);
        $this->assertNull($row->limit_notice_at);
        $this->assertNull($row->limit_terms_key);

        $this->assignPlan($this->community, $this->plan100);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
    }

    public function test_a_notice_that_fails_to_send_is_not_counted_as_sent(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);

        // The mail service cannot even be built for one run: the notifier
        // throws, as it would with the mail system down.
        $this->app->bind(\App\Services\EmailDispatchService::class, static function (): never {
            throw new \RuntimeException('mail system down (test)');
        });
        try {
            BillingAutomationService::run($this->today);
        } finally {
            $this->app->offsetUnset(\App\Services\EmailDispatchService::class);
        }
        $row = $this->standingRow($this->community);
        $this->assertNull($row->limit_notice_stage, 'Not recorded as sent.');
        $this->assertNull($row->limit_notice_at);
        $this->assertCount(0, $this->overMail($this->admin));

        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community), 'Due again, and sent.');
        $this->assertCount(1, $this->overMail($this->admin));
        $this->assertSame('over', $this->standingRow($this->community)->limit_notice_stage);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
    }

    public function test_the_pause_date_is_the_notice_day_plus_the_days(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        // describe() and memberLimitState() count from the real today.
        $now = CarbonImmutable::parse(now()->toDateString());
        $pick = fn (array $o) => array_values(array_filter($o, fn ($e) => $e['tenant_id'] === $this->community && $e['clock'] === 'member_limit'))[0]['detail'];

        // Not yet warned: the earliest is today plus the days.
        $expected = $now->addDays(30)->toDateString();
        $this->assertSame($expected, $pick(BillingAutomationService::preview($now))['pause_date']);
        $this->assertSame($expected, \App\Support\Billing\OverLimitRule::describe($this->community)['acts_on']);
        $this->assertSame($expected, BillingAutomationService::memberLimitState($this->community)['acts_on']);

        $this->assertSame($expected, $pick(BillingAutomationService::run($now))['pause_date']);
        $this->assertSame($expected, \App\Support\Billing\OverLimitRule::describe($this->community)['acts_on']);
        $this->assertSame($expected, BillingAutomationService::memberLimitState($this->community)['acts_on']);

        // Over for 12 days, warned 10 days ago: 20 days to go, not 18.
        $this->standing($this->community, [
            'over_limit_since' => $now->subDays(12)->toDateString(),
            'limit_notice_stage' => 'over',
            'limit_notice_at' => $now->subDays(10)->toDateString() . ' 08:00:00',
        ]);
        $expected = $now->addDays(20)->toDateString();
        $this->assertSame($expected, \App\Support\Billing\OverLimitRule::describe($this->community)['acts_on']);
        $this->assertSame($expected, BillingAutomationService::memberLimitState($this->community)['acts_on']);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($now->addDays(19)), $this->community));
        $onTheDay = BillingAutomationService::preview($now->addDays(20));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor($onTheDay, $this->community));
        $this->assertSame($expected, $pick($onTheDay)['pause_date']);
    }

    public function test_preview_lists_no_member_limit_entry_on_a_payment_pause_day(): void
    {
        $this->pauseAfterThirtyDays();
        $this->addActiveMembers($this->community, 101);
        // Final warning sent long enough ago: today the payment clock pauses.
        $this->standing($this->community, [
            'paid_until' => $this->today->subDays(40)->toDateString(),
            'payer' => 'platform_invoice',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->today->subDays(20)->toDateString() . ' 08:00:00',
        ]);

        $preview = $this->actionsFor(BillingAutomationService::preview($this->today), $this->community);
        $run = $this->actionsFor(BillingAutomationService::run($this->today), $this->community);

        $this->assertSame(['payment:suspend'], $run);
        $this->assertSame($run, $preview, 'The preview matches the run.');
        $this->assertCount(0, $this->overMail($this->admin));
    }

    // ── Fix round 4: an episode ends only when clearly under (below 95%) ────

    private function pauseAfterTenDays(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        BillingSettings::set('over_limit_grace_days', 10, null);
    }

    public function test_a_small_dip_does_not_end_the_episode(): void
    {
        $this->pauseAfterTenDays();
        $this->addActiveMembers($this->community, 101);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));

        $this->retire($this->community, 2); // 99%: not clearly under
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(3)), $this->community));
        $this->assertSame($this->today->toDateString(), substr((string) $this->standingRow($this->community)->over_limit_since, 0, 10), 'The episode is kept.');

        $this->addActiveMembers($this->community, 2); // 101% again
        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->day(4)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(4)), $this->community), 'No new notice within the episode.');
        $this->assertCount(1, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(9)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        $this->assertCount(1, $this->overMail($this->admin));
    }

    public function test_being_under_on_the_pause_day_ends_the_episode(): void
    {
        // Fix round 5 (R1e): was "a small dip on the pause day only delays the
        // pause". A kept episode lasts only until its pause date.
        $this->pauseAfterTenDays();
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);

        $this->retire($this->community, 1); // 100%: at the line, not over
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community), 'Not over on the day: not paused.');
        $row = $this->standingRow($this->community);
        $this->assertNull($row->over_limit_since, 'Through its warning period under its number: the episode ends.');
        $this->assertNull($row->limit_notice_at);

        $this->addActiveMembers($this->community, 1);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(11)), $this->community), 'A fresh notice, not a pause.');
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(2, $this->overMail($this->admin));
        $this->assertCount(2, $this->mailTo($this->admin), 'Nothing else was sent: no "reached" in between.');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(20)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(21)), $this->community));
    }

    public function test_a_warning_does_not_outlive_its_pause_date(): void
    {
        $this->pauseAfterTenDays();
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);

        $this->retire($this->community, 4); // 97%: not over, not clearly under
        foreach ([2, 9, 10, 11, 30, 60] as $offset) {
            $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day($offset)), $this->community), "Day {$offset}.");
        }
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertNull($this->standingRow($this->community)->over_limit_since);
        $this->assertCount(1, $this->mailTo($this->admin), 'Sitting at 97% sends nothing ("approaching" is not re-told).');

        $this->addActiveMembers($this->community, 4);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(61)), $this->community), 'A fresh notice, not a pause on the old date.');
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertCount(2, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(70)), $this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(71)), $this->community));
    }

    public function test_an_episode_with_no_notice_sent_is_kept_until_clearly_under(): void
    {
        // No notice day on record (the send failed): no pause date, so R1e
        // does not apply; the episode ends only when clearly under.
        $this->pauseAfterTenDays();
        $this->addActiveMembers($this->community, 99);
        $this->standing($this->community, [
            'over_limit_since' => $this->today->subDays(40)->toDateString(),
            'limit_terms_key' => $this->termsKey($this->community),
        ]);

        BillingAutomationService::run($this->today);
        $this->assertSame($this->today->subDays(40)->toDateString(), substr((string) $this->standingRow($this->community)->over_limit_since, 0, 10));
    }

    public function test_a_clear_drop_ends_the_episode(): void
    {
        $this->pauseAfterTenDays();
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);

        $this->retire($this->community, 11); // 90%: clearly under
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(3)), $this->community));
        $this->assertNull($this->standingRow($this->community)->over_limit_since, 'The count is cleared.');

        $this->addActiveMembers($this->community, 11);
        $this->assertSame(['member_limit:over'], $this->actionsFor(BillingAutomationService::run($this->day(6)), $this->community));
        $this->assertCount(2, $this->overMail($this->admin));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(10)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(15)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(16)), $this->community));
    }

    private function day(int $offset): CarbonImmutable
    {
        return $this->today->addDays($offset);
    }
}
