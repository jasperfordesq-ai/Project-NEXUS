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
        $this->assertFalse(BillingLock::isLocked($this->community), 'Warn only by default.');

        $adminMail = array_map(static fn ($r) => (string) $r->subject, $this->mailTo($this->admin));
        $this->assertCount(3, $adminMail);
        $this->assertStringContainsString('close to its member limit', $adminMail[0]);
        $this->assertStringContainsString('has reached its member limit', $adminMail[1]);
        $this->assertStringContainsString('is over its member limit', $adminMail[2]);

        // Whoever it pays (the platform team): reached and over, not approaching.
        $this->assertCount(2, $this->mailTo($this->platformMember));
    }

    public function test_dropping_just_under_keeps_the_stage_and_rising_again_tells_nobody(): void
    {
        // Was: "dropping back clears the stage and rising again tells people
        // again" — which mailed everyone each time a community hovered at its
        // limit. 99% is not clearly below the line.
        $this->addActiveMembers($this->community, 101);
        BillingAutomationService::run($this->today);

        $this->retire($this->community, 2);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $row = $this->standingRow($this->community);
        $this->assertSame('over', $row->limit_notice_stage);
        $this->assertNull($row->over_limit_since, 'Not over any more: the days over start again.');

        $this->addActiveMembers($this->community, 2);
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->community));
        $this->assertCount(1, $this->mailTo($this->admin));
    }

    public function test_hovering_at_the_limit_sends_the_over_notice_once(): void
    {
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
        $this->addActiveMembers($this->community, 101);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(29)->toDateString(), 'limit_notice_stage' => 'over']);

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
        $this->assertSame($this->day(1)->toDateString(), substr((string) $this->standingRow($this->community)->over_limit_since, 0, 10));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $mailBefore = DB::table('email_log')->count();

        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->day(2)), $this->community));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(2)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community), 'Not overruled the next morning.');
        $this->assertSame($mailBefore, DB::table('email_log')->count(), 'Nobody is mailed again.');

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(30)), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertSame($mailBefore, DB::table('email_log')->count());

        // A full 30 days after the lift, still over: paused again.
        $this->assertSame(['member_limit:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(31)), $this->community));
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
        $this->addActiveMembers($this->community, 150);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(200)->toDateString(), 'limit_notice_stage' => 'over']);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->community));
        $this->assertFalse(BillingLock::isLocked($this->community));
    }

    public function test_pause_only_after_the_grace_days_and_restore_when_back_under(): void
    {
        BillingSettings::set('over_limit_action', 'pause', null);
        $this->addActiveMembers($this->community, 101);
        $this->standing($this->community, ['over_limit_since' => $this->today->subDays(29)->toDateString(), 'limit_notice_stage' => 'over']);

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

    private function day(int $offset): CarbonImmutable
    {
        return $this->today->addDays($offset);
    }
}
