<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\BillingAutomationService;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\BillingSettings;
use App\Support\Billing\JoiningGate;
use App\Support\Billing\PlanTerms;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Faults in the daily check found by the audit of 21 November 2026, each of
 * which would have paused, or reopened, a community wrongly once the
 * automatic checks were switched on:
 *
 *  - a payment warning the mail provider refused still counted as given, so a
 *    community could be paused a week later on a final warning nobody got;
 *  - a final warning recorded before an exemption (or before the checks were
 *    switched off) paused the community the first morning it applied again;
 *  - a card payer's plan stopped being watched the moment its card failed, so
 *    a community paused for being over its member number was reopened;
 *  - a pause for being over the number lifted itself: paused members stop
 *    signing in, so they aged out of the 90-day count.
 *
 * "Today" is passed in. Member counts read the real clock (Carbon's test
 * clock where a test moves it).
 */
final class BillingAutomationHardeningTest extends TestCase
{
    use DatabaseTransactions;
    use BillingAutomationFixtures;

    private CarbonImmutable $today;
    private int $community;
    private string $admin;
    private int $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAutomation();
        PlanTerms::flush();
        JoiningGate::flush();

        $this->today = CarbonImmutable::now()->startOfDay();
        $this->community = $this->makeCommunity('Hardening ' . bin2hex(random_bytes(3)), 1, '/1/');
        $this->admin = $this->person($this->community, ['role' => 'admin']);

        // A standard plan small enough to go over with a handful of members.
        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Tiny standard', 'slug' => 'tiny-standard-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'max_users' => 3, 'price_monthly' => 10, 'price_yearly' => 100,
            'is_active' => 1, 'is_standard' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        PlanTerms::flush();

        $this->switchOn();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        CarbonImmutable::setTestNow();
        PlanTerms::flush();
        JoiningGate::flush();
        $this->tearDownAutomation();
    }

    private function day(int $offset): CarbonImmutable
    {
        return $this->today->addDays($offset);
    }

    /** @return list<string> */
    private function check(CarbonImmutable $day): array
    {
        return $this->actionsFor(BillingAutomationService::run($day), $this->community);
    }

    private function addMembers(int $count, int $daysSinceLogin = 1): void
    {
        for ($i = 0; $i < $count; $i++) {
            $uid = bin2hex(random_bytes(6));
            DB::table('users')->insert([
                'tenant_id' => $this->community, 'name' => 'Member ' . $uid, 'first_name' => 'Member', 'last_name' => 'Test',
                'email' => $uid . '@example.test', 'status' => 'active', 'role' => 'member', 'balance' => 0, 'is_approved' => 1,
                'last_login_at' => now()->subDays($daysSinceLogin), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
    }

    /** @param array<string, mixed> $values */
    private function planRecord(array $values = []): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId($values + [
            'tenant_id' => $this->community, 'pay_plan_id' => $this->plan, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** Runs the check day by day until it pauses the community for being over; fails if it never does. */
    private function runUntilPausedForBeingOver(): CarbonImmutable
    {
        for ($offset = 0; $offset <= 45; $offset++) {
            BillingAutomationService::run($this->day($offset));
            BillingLock::flush();
            if (BillingLock::isLocked($this->community)) {
                $this->assertSame('over_limit', $this->standingRow($this->community)->suspension_reason);

                return $this->day($offset);
            }
        }

        $this->fail('The community was never paused for being over its member number.');
    }

    // ── a warning nobody received is not a warning ──────────────────────────

    public function test_a_final_warning_the_mail_provider_refused_is_sent_again_and_the_pause_counts_from_the_one_that_arrived(): void
    {
        $this->standing($this->community, ['paid_until' => $this->today->toDateString()]);

        $this->assertSame(['payment:due'], $this->check($this->day(1)));

        // The mail provider is down on the final-warning day.
        app()->instance(EmailDispatchService::class, new RefusingEmailDispatch());
        $this->assertSame([], $this->check($this->day(7)), 'nothing is reported as sent');
        $this->assertSame('due', $this->standingRow($this->community)->last_notice_stage, 'and nothing is recorded as sent');

        // It is back the next morning: the warning goes out then.
        app()->instance(EmailDispatchService::class, new ProviderAcceptsEmailDispatch());
        $this->assertSame(['payment:final_warning'], $this->check($this->day(8)));
        $this->assertSame('final_warning', $this->standingRow($this->community)->last_notice_stage);

        // The pause is seven days after the warning that arrived, not seven
        // days after the one that did not.
        $this->assertSame([], $this->check($this->day(14)));
        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->community), 'paused on a warning nobody received');

        $this->assertSame(['payment:suspend'], $this->check($this->day(15)));
        BillingLock::flush();
        $this->assertTrue(BillingLock::isLocked($this->community));
        $this->assertSame('suspend', $this->standingRow($this->community)->last_notice_stage);
    }

    /**
     * Finding B22. The pause stage used to be recorded BEFORE the pause was
     * made: if pausing then failed, the record said "paused", the next run
     * saw nothing left to do, and the community was never paused. The pause
     * now comes first, so a failure leaves no record and the next morning's
     * run tries again.
     *
     * The failure is made here by refusing the one write that pauses (the
     * `suspended_at` update of the standing row) while a flag is up.
     */
    public function test_a_pause_that_failed_is_tried_again_the_next_day(): void
    {
        $this->standing($this->community, ['paid_until' => $this->today->toDateString()]);
        $this->assertSame(['payment:due'], $this->check($this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->check($this->day(7)));

        $failing = true;
        DB::connection()->beforeExecuting(static function (string $sql) use (&$failing): void {
            if ($failing && str_contains($sql, 'tenant_billing_standing') && str_contains($sql, 'suspended_at') && str_starts_with(ltrim($sql), 'update')) {
                throw new \RuntimeException('The database refused the pause in this test');
            }
        });

        try {
            // The pause day. The pause fails; the run carries on for everyone else.
            $this->assertSame([], $this->check($this->day(14)), 'a pause that did not happen is not reported as one');
            BillingLock::flush();
            $this->assertFalse(BillingLock::isLocked($this->community));
            $row = $this->standingRow($this->community);
            $this->assertNull($row->suspended_at);
            $this->assertSame('final_warning', $row->last_notice_stage, 'the pause is NOT recorded as made');

            // The next morning the fault is gone, and the pause is made.
            $failing = false;
            $this->assertSame(['payment:suspend'], $this->check($this->day(15)));
            BillingLock::flush();
            $this->assertTrue(BillingLock::isLocked($this->community));
            $row = $this->standingRow($this->community);
            $this->assertSame('suspend', $row->last_notice_stage);
            $this->assertSame('non_payment', $row->suspension_reason);
        } finally {
            $failing = false;
        }
    }

    /**
     * A community that pays the platform by card has nobody to pay by hand:
     * its card is charged. Its payment emails used to say "payment is made to
     * the platform team", which sent it looking for an invoice.
     */
    public function test_a_card_payer_is_told_to_check_its_card_not_to_pay_the_platform_team(): void
    {
        $mailer = new class extends EmailDispatchService {
            /** @var array<int, array{to: string, body: string}> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = ['to' => $to, 'body' => $body];

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mailer);
        $bodyTo = fn (string $email): string => implode("\n", array_column(
            array_filter($mailer->calls, static fn (array $c): bool => $c['to'] === $email),
            'body'
        ));

        // By invoice: paid to the platform team.
        $this->standing($this->community, ['paid_until' => $this->today->toDateString()]);
        $this->assertSame(['payment:due'], $this->check($this->day(1)));
        $this->assertStringContainsString('Payment is made to the platform team', $bodyTo($this->admin));
        $this->assertStringNotContainsString('card on file', $bodyTo($this->admin));

        // By card, with Stripe no longer retrying (so the notice is due).
        $card = $this->makeCommunity('Hardening card ' . bin2hex(random_bytes(3)), 1, '/1/');
        $cardAdmin = $this->person($card, ['role' => 'admin']);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $card, 'pay_plan_id' => $this->plan, 'status' => 'expired',
            'stripe_subscription_id' => 'sub_hardening_' . bin2hex(random_bytes(5)), 'stripe_status' => 'unpaid',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->standing($card, ['paid_until' => $this->today->toDateString()]);
        $this->assertSame('platform_card', \App\Services\BillingStandingService::get($card)['payer']);

        $this->assertSame(['payment:due'], $this->actionsFor(BillingAutomationService::run($this->day(1)), $card));

        $this->assertStringContainsString('Payment is taken from the card on file', $bodyTo($cardAdmin));
        $this->assertStringContainsString('Manage Payment', $bodyTo($cardAdmin));
        $this->assertStringNotContainsString('Payment is made to the platform team', $bodyTo($cardAdmin));
    }

    /**
     * The check may run twice in a day: a person runs the command after the
     * scheduler has, or two scheduler containers fire in the same minute (the
     * scheduler's own lock, kept in the shared cache, normally stops the
     * second). Either way the second run must find nothing left to do: every
     * notice and every pause is on record before the next run looks.
     */
    public function test_running_the_check_twice_in_one_day_sends_nothing_twice_and_pauses_nothing_twice(): void
    {
        // One community going through the payment stages...
        $late = $this->makeCommunity('Hardening late ' . bin2hex(random_bytes(3)), 1, '/1/');
        $lateAdmin = $this->person($late, ['role' => 'admin']);
        $this->standing($late, ['paid_until' => $this->today->toDateString()]);
        // ...and one over its member number.
        $this->planRecord();
        $this->addMembers(4);

        $mail = fn (string $email): int => count($this->mailTo($email));
        // Runs the check three times on one day. The first run may act; the
        // second and third must do nothing and send nothing. Returns what
        // the first run did and how many emails it sent the admin.
        $twice = function (CarbonImmutable $day) use ($late, $lateAdmin, $mail): array {
            $before = $mail($lateAdmin);
            $first = $this->actionsFor(BillingAutomationService::run($day), $late);
            $afterFirst = $mail($lateAdmin);
            $second = $this->actionsFor(BillingAutomationService::run($day), $late);
            $third = $this->actionsFor(BillingAutomationService::run($day), $late);
            $this->assertSame([], $second, 'the second run of the day does nothing for it');
            $this->assertSame([], $third);
            $this->assertSame($afterFirst, $mail($lateAdmin), 'and sends nothing more');

            return [$first, $afterFirst - $before];
        };

        // Day 0, by the command, as the scheduler and a person would run it.
        $this->artisan('billing:apply-standing')->assertExitCode(0);
        $overMailAfterOne = $mail($this->admin);
        $lateMailAfterOne = $mail($lateAdmin);
        $this->assertGreaterThan(0, $overMailAfterOne, 'the over-limit notice went out');
        $this->artisan('billing:apply-standing')->assertExitCode(0);
        $this->artisan('billing:apply-standing')->assertExitCode(0);
        $this->assertSame($overMailAfterOne, $mail($this->admin), 'run again twice: not one more email');
        $this->assertSame($lateMailAfterOne, $mail($lateAdmin));

        // The payment stages, each run three times on its day.
        $this->assertSame([['payment:due'], 1], $twice($this->day(1)));
        $this->assertSame([['payment:final_warning'], 1], $twice($this->day(7)));
        $this->assertSame([['payment:suspend'], 1], $twice($this->day(14)), 'told once that it is paused');
        BillingLock::flush();
        $this->assertTrue(BillingLock::isLocked($late));
        $this->assertSame(1, DB::table('billing_audit_log')->where('tenant_id', $late)->where('action', 'standing_suspended')->count(), 'paused once');
    }

    public function test_a_first_notice_the_provider_refused_is_tried_again_the_next_day(): void
    {
        $this->standing($this->community, ['paid_until' => $this->today->toDateString()]);

        app()->instance(EmailDispatchService::class, new RefusingEmailDispatch());
        $this->assertSame([], $this->check($this->day(1)));
        $this->assertNull($this->standingRow($this->community)->last_notice_stage);

        app()->instance(EmailDispatchService::class, new ProviderAcceptsEmailDispatch());
        $this->assertSame(['payment:due'], $this->check($this->day(2)));
        $this->assertNotEmpty($this->mailTo($this->admin));
    }

    // ── an old warning never pauses without a fresh one ─────────────────────

    public function test_taking_an_exemption_off_starts_the_payment_warnings_again(): void
    {
        $actor = (int) DB::table('users')->where('email', $this->admin)->value('id');
        // It reached "final warning" three weeks ago, then was exempted.
        $this->standing($this->community, [
            'paid_until' => $this->day(-30)->toDateString(),
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(-21)->toDateTimeString(),
            'exempt' => 1, 'exempt_reason' => 'Grant pending', 'exempt_by_user_id' => $actor, 'exempt_at' => now(),
        ]);

        BillingStandingService::setExempt($this->community, false, $actor);

        $this->assertNull($this->standingRow($this->community)->last_notice_stage);
        $this->assertNull($this->standingRow($this->community)->last_notice_at);

        // The first run warns. It used to pause at once, on the old warning.
        $first = $this->check($this->today);
        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->community), 'paused the morning the exemption came off');
        $this->assertNotContains('payment:suspend', $first);
        $this->assertNotEmpty($first, 'a fresh warning goes out instead');
    }

    public function test_changing_who_a_community_pays_starts_the_payment_warnings_again(): void
    {
        $actor = (int) DB::table('users')->where('email', $this->admin)->value('id');
        $this->standing($this->community, [
            'paid_until' => $this->day(-30)->toDateString(),
            'payer' => 'not_billed',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(-21)->toDateTimeString(),
        ]);

        BillingStandingService::setPayer($this->community, 'platform_invoice', $actor);

        $this->assertNull($this->standingRow($this->community)->last_notice_stage);
        $first = $this->check($this->today);
        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertNotContains('payment:suspend', $first);
    }

    public function test_switching_the_automatic_checks_back_on_starts_every_payment_warning_again(): void
    {
        $this->standing($this->community, [
            'paid_until' => $this->day(-60)->toDateString(),
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(-50)->toDateTimeString(),
        ]);

        BillingSettings::set('automation_enabled', false, null);
        BillingSettings::set('automation_enabled', true, null);

        $this->assertNull($this->standingRow($this->community)->last_notice_stage);
        $first = $this->check($this->today);
        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->community), 'paused on the first run after switching on');
        $this->assertNotContains('payment:suspend', $first);
    }

    public function test_a_community_that_is_paused_keeps_its_payment_record_when_the_checks_are_switched_on(): void
    {
        $this->standing($this->community, [
            'paid_until' => $this->day(-60)->toDateString(),
            'last_notice_stage' => 'suspend',
            'last_notice_at' => $this->day(-40)->toDateTimeString(),
            'suspended_at' => now()->subDays(40), 'suspension_source' => 'auto', 'suspension_reason' => 'non_payment',
        ]);

        BillingSettings::set('automation_enabled', false, null);
        BillingSettings::set('automation_enabled', true, null);

        $this->assertSame('suspend', $this->standingRow($this->community)->last_notice_stage);
        BillingLock::flush();
        $this->assertTrue(BillingLock::isLocked($this->community));
    }

    // ── a failed card does not switch the member limit off ──────────────────

    public function test_a_card_payer_paused_for_being_over_stays_paused_when_its_card_fails(): void
    {
        $record = $this->planRecord(['stripe_subscription_id' => 'sub_hard_' . bin2hex(random_bytes(4)), 'stripe_status' => 'active']);
        $this->addMembers(5);
        $pausedOn = $this->runUntilPausedForBeingOver();

        // The card fails: recorded as `expired`, Stripe still retrying.
        DB::table('tenant_plan_assignments')->where('id', $record)->update(['status' => 'expired', 'stripe_status' => 'past_due']);
        PlanTerms::flush();
        JoiningGate::flush();

        $actions = $this->check($pausedOn->addDay());

        BillingLock::flush();
        $this->assertTrue(BillingLock::isLocked($this->community), 'reopened because its card failed');
        $this->assertNotContains('member_limit:restore', $actions);
        $this->assertNotNull(BillingAutomationService::watchedLimit($this->community), 'its member number is still watched');
    }

    public function test_the_member_number_stops_being_watched_once_stripe_ends_the_subscription(): void
    {
        $record = $this->planRecord(['stripe_subscription_id' => 'sub_hard_' . bin2hex(random_bytes(4)), 'stripe_status' => 'active']);
        $this->assertNotNull(BillingAutomationService::watchedLimit($this->community));

        DB::table('tenant_plan_assignments')->where('id', $record)->update(['status' => 'cancelled', 'stripe_status' => 'canceled']);

        $this->assertNull(BillingAutomationService::watchedLimit($this->community), 'a cancelled plan is no plan');
    }

    public function test_a_plan_on_trial_has_its_member_number_watched(): void
    {
        $this->planRecord(['status' => 'trial']);

        $limit = BillingAutomationService::watchedLimit($this->community);

        $this->assertNotNull($limit, 'a trial plan was never watched');
        $this->assertSame(3, $limit['max_users']);
    }

    // ── a pause for being over does not lift itself ─────────────────────────

    public function test_a_pause_for_being_over_does_not_lift_because_paused_members_stopped_signing_in(): void
    {
        $this->planRecord();
        $this->addMembers(5);
        $this->runUntilPausedForBeingOver();

        // A hundred days pass. Nobody could use the community, so nobody
        // signed in: counted to "now", all five have aged out of the 90 days.
        Carbon::setTestNow(now()->addDays(100));
        CarbonImmutable::setTestNow(CarbonImmutable::now());
        $later = CarbonImmutable::now()->startOfDay();

        $actions = $this->actionsFor(BillingAutomationService::run($later), $this->community);

        BillingLock::flush();
        $this->assertTrue(BillingLock::isLocked($this->community), 'the pause lifted itself with nothing changed');
        $this->assertNotContains('member_limit:restore', $actions);

        // Taking accounts off is a real change: back within the number, it opens.
        DB::table('users')->where('tenant_id', $this->community)->where('role', 'member')->limit(3)->update(['status' => 'inactive']);
        $actions = $this->actionsFor(BillingAutomationService::run($later->addDay()), $this->community);

        BillingLock::flush();
        $this->assertFalse(BillingLock::isLocked($this->community));
        $this->assertContains('member_limit:restore', $actions);
    }
}
