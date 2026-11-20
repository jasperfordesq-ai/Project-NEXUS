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
 * The payment clock of the daily check: reminder, due, final warning, pause.
 *
 * "Today" is always passed in, never read from the wall clock. Default
 * settings: reminder 7 days before, final warning 7 days late, pause 14 days
 * late.
 */
final class BillingAutomationPaymentTest extends TestCase
{
    use DatabaseTransactions;
    use BillingAutomationFixtures;

    private CarbonImmutable $today;
    private int $hub;
    private int $child;
    private int $direct;
    private string $childAdmin;
    private string $hubManager;
    private string $childMember;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAutomation();

        $this->today = CarbonImmutable::parse('2027-03-10');

        $this->hub = $this->makeCommunity('Pay hub ' . bin2hex(random_bytes(3)), 1, '/1/', true);
        $this->child = $this->makeCommunity('Pay child', $this->hub, "/1/{$this->hub}/");
        $this->direct = $this->makeCommunity('Pay direct', 1, '/1/');

        $this->childAdmin = $this->person($this->child, ['role' => 'admin']);
        $this->childMember = $this->person($this->child, ['role' => 'member']);
        $this->hubManager = $this->person($this->hub, ['role' => 'admin', 'is_tenant_super_admin' => true]);

        $this->switchOn();
    }

    protected function tearDown(): void
    {
        $this->tearDownAutomation();
    }

    private function day(int $offset): CarbonImmutable
    {
        return $this->today->addDays($offset);
    }

    /** The single 7-day reminder the tests below were written for. */
    private function oneReminderAWeekBefore(): void
    {
        BillingSettings::set('reminder_days', '7', null);
    }

    public function test_each_stage_fires_on_its_day_and_only_once(): void
    {
        $this->oneReminderAWeekBefore();
        // Paid up to 7 days from "today".
        $this->standing($this->child, ['paid_until' => $this->day(7)->toDateString()]);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(-1)), $this->child), 'Nothing 8 days before.');

        $this->assertSame(['payment:reminder'], $this->actionsFor(BillingAutomationService::run($this->today), $this->child));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->child), 'A second run the same day sends nothing.');
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(7)), $this->child), 'Nothing on the last paid day.');

        $this->assertSame(['payment:due'], $this->actionsFor(BillingAutomationService::run($this->day(8)), $this->child));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(8)), $this->child));

        $this->assertSame(['payment:final_warning'], $this->actionsFor(BillingAutomationService::run($this->day(14)), $this->child));
        $this->assertFalse(BillingLock::isLocked($this->child));

        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(20)), $this->child), 'Nothing between the final warning and the pause.');

        $this->assertSame(['payment:suspend'], $this->actionsFor(BillingAutomationService::run($this->day(21)), $this->child));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(21)), $this->child), 'No second pause.');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame('auto', $standing['suspension_source']);
        $this->assertSame('non_payment', $standing['suspension_reason']);

        // Community admin: reminder, due, final warning, paused.
        $adminMail = array_map(static fn ($r) => (string) $r->subject, $this->mailTo($this->childAdmin));
        $this->assertCount(4, $adminMail);
        $this->assertStringContainsString('is due on ' . $this->day(7)->toDateString(), $adminMail[0]);
        $this->assertStringContainsString('is now due', $adminMail[1]);
        $this->assertStringContainsString('Final reminder', $adminMail[2]);
        $this->assertStringContainsString('has been paused', $adminMail[3]);

        // Whoever it pays (its parent's managers): due, final warning, paused.
        $this->assertCount(3, $this->mailTo($this->hubManager));
        $this->assertSame('billing', $this->mailTo($this->hubManager)[0]->category);

        $this->assertCount(0, $this->mailTo($this->childMember), 'Members are never told.');
    }

    /**
     * Run the check for one day and prove the preview said the same thing
     * beforehand. Returns the actions for the community.
     *
     * @return list<string>
     */
    private function previewThenRun(int $tenantId, CarbonImmutable $day): array
    {
        $previewed = $this->actionsFor(BillingAutomationService::preview($day), $tenantId);
        $done = $this->actionsFor(BillingAutomationService::run($day), $tenantId);
        $this->assertSame($previewed, $done, 'The preview for ' . $day->toDateString() . ' did not match the run.');

        return $done;
    }

    public function test_a_missed_day_sends_only_the_next_stage(): void
    {
        // Was: "catches up with the highest stage only" (a final warning with
        // no "now due" before it). A run now moves one stage at a time.
        $this->standing($this->child, ['paid_until' => $this->day(-10)->toDateString()]);

        $this->assertSame(['payment:due'], $this->actionsFor(BillingAutomationService::run($this->today), $this->child));

        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertSame('due', $this->standingRow($this->child)->last_notice_stage);
    }

    public function test_a_community_long_overdue_is_never_paused_without_a_final_warning_first(): void
    {
        // Was: "is paused on the first run". 200 days late, nothing recorded:
        // the first run after the check is switched on.
        $this->standing($this->child, ['paid_until' => $this->day(-200)->toDateString()]);

        $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->today), 'The reminder is skipped once the date has passed.');
        $this->assertFalse(BillingLock::isLocked($this->child));
        $adminMail = $this->mailTo($this->childAdmin);
        $this->assertCount(1, $adminMail);
        $this->assertStringContainsString('is now due', (string) $adminMail[0]->subject);

        $this->assertSame([], $this->previewThenRun($this->child, $this->day(1)), 'Nothing new the next day.');
        $this->assertSame([], $this->previewThenRun($this->child, $this->day(5)));

        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->child, $this->day(7)));
        $this->assertFalse(BillingLock::isLocked($this->child));
        // The final warning names the day the pause can really come, not a
        // date long gone.
        $final = $this->mailTo($this->childAdmin)[1];
        $this->assertStringContainsString($this->day(14)->toDateString(), (string) $final->subject);

        $this->assertSame([], $this->previewThenRun($this->child, $this->day(8)), 'Not paused the day after the final warning.');
        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertSame([], $this->previewThenRun($this->child, $this->day(13)));
        $this->assertFalse(BillingLock::isLocked($this->child));

        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->child, $this->day(14)));
        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame('non_payment', $standing['suspension_reason']);
        $this->assertCount(3, $this->mailTo($this->childAdmin), 'Due, final warning, paused: nothing more.');
    }

    public function test_followed_day_by_day_the_stages_fall_on_the_design_days_and_the_preview_agrees(): void
    {
        $this->oneReminderAWeekBefore();
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $expected = [-7 => 'payment:reminder', 1 => 'payment:due', 7 => 'payment:final_warning', 14 => 'payment:suspend'];
        for ($offset = -9; $offset <= 16; $offset++) {
            $want = isset($expected[$offset]) ? [$expected[$offset]] : [];
            $this->assertSame($want, $this->previewThenRun($this->child, $this->day($offset)), "Day {$offset}.");
        }
        $this->assertTrue(BillingLock::isLocked($this->child));
    }

    public function test_a_scheduler_down_for_30_days_does_not_pause_on_the_first_run_back(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-7)));
        $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->day(1)));

        // No runs from day 2 to day 30. Back on day 31: 31 days late, but the
        // final warning has not been sent yet.
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->child, $this->day(31)));
        $this->assertFalse(BillingLock::isLocked($this->child));

        $this->assertSame([], $this->previewThenRun($this->child, $this->day(37)));
        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->child, $this->day(38)));
        $this->assertTrue(BillingLock::isLocked($this->child));
    }

    public function test_a_scheduler_down_after_the_final_warning_pauses_on_the_first_run_back(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $this->previewThenRun($this->child, $this->day(-7));
        $this->previewThenRun($this->child, $this->day(1));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->child, $this->day(7)));

        // Down from day 8 to day 30: the final warning has stood long enough.
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->child, $this->day(31)));
        $this->assertTrue(BillingLock::isLocked($this->child));
    }

    public function test_a_card_payer_gets_no_reminder_before_an_automatic_renewal(): void
    {
        $this->standing($this->direct, ['paid_until' => $this->day(3)->toDateString(), 'payer' => 'platform_card']);
        $admin = $this->person($this->direct, ['role' => 'admin']);

        $this->assertSame([], $this->actionsFor(BillingAutomationService::preview($this->today), $this->direct));
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->today), $this->direct));
        $this->assertNull($this->standingRow($this->direct)->last_notice_stage);
        $this->assertCount(0, $this->mailTo($admin));
    }

    public function test_a_card_payer_whose_payment_failed_still_goes_through_due_final_warning_and_pause(): void
    {
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);

        $this->assertSame([], $this->previewThenRun($this->direct, $this->day(-7)), 'No reminder for a card.');
        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->direct, $this->day(7)));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->direct, $this->day(14)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
    }

    // ── A card payer Stripe is still retrying (owner, 20 Nov 2026) ────────────

    /** A card subscription for a community, with what Stripe last said about it. */
    private function cardSubscription(int $tenantId, ?string $stripeStatus): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Card plan',
            'slug' => 'card-plan-' . bin2hex(random_bytes(4)),
            'tier_level' => 1,
            'price_monthly' => 10,
            'price_yearly' => 100,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => $stripeStatus === 'active' ? 'active' : 'expired',
            'starts_at' => now(),
            'stripe_subscription_id' => 'sub_auto_' . bin2hex(random_bytes(6)),
            'stripe_status' => $stripeStatus,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function stripeNowSays(int $tenantId, string $stripeStatus): void
    {
        DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->update(['stripe_status' => $stripeStatus]);
    }

    /** @return array<string, array{string}> */
    public static function stripeStillRetrying(): array
    {
        return ['past_due' => ['past_due'], 'incomplete' => ['incomplete']];
    }

    /** @dataProvider stripeStillRetrying */
    public function test_a_card_payer_is_warned_but_not_paused_while_stripe_is_still_retrying_the_card(string $stripeStatus): void
    {
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);
        $this->cardSubscription($this->direct, $stripeStatus);
        $admin = $this->person($this->direct, ['role' => 'admin']);

        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->direct, $this->day(7)));
        $mailAfterWarnings = count($this->mailTo($admin));
        $this->assertSame(2, $mailAfterWarnings, 'now due and the final warning were both sent');

        // The pause day, and past it (within the longest wait of 30 days):
        // Stripe is still trying the card. Was [14, 15, 40]; day 40 is past
        // the longest wait now (see the tests of card_retry_max_days_late).
        foreach ([14, 15, 25] as $offset) {
            $this->assertSame(['payment:waiting_for_stripe'], $this->previewThenRun($this->direct, $this->day($offset)));
            $this->assertFalse(BillingLock::isLocked($this->direct), "Paused on day {$offset} while Stripe was still retrying.");
        }
        $this->assertSame('final_warning', $this->standingRow($this->direct)->last_notice_stage, 'Waiting records no stage.');
        $this->assertNull($this->standingRow($this->direct)->suspended_at);
        $this->assertCount($mailAfterWarnings, $this->mailTo($admin), 'Waiting sends nothing.');

        // Stripe gives up: the normal rule applies on the next run.
        $this->stripeNowSays($this->direct, 'unpaid');
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->direct, $this->day(26)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
        $this->assertSame('non_payment', $this->standingRow($this->direct)->suspension_reason);
    }

    public function test_the_wait_for_stripe_ends_at_the_longest_wait_by_default_30_days_late(): void
    {
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);
        $this->cardSubscription($this->direct, 'past_due');

        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->direct, $this->day(7)));
        for ($offset = 8; $offset <= 13; $offset++) {
            $this->assertSame([], $this->previewThenRun($this->direct, $this->day($offset)), "Day {$offset}.");
        }
        for ($offset = 14; $offset <= 29; $offset++) {
            $this->assertSame(['payment:waiting_for_stripe'], $this->previewThenRun($this->direct, $this->day($offset)), "Day {$offset}.");
            $this->assertFalse(BillingLock::isLocked($this->direct), "Paused on day {$offset}.");
        }

        // Stripe still says past due, but the longest wait is over.
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->direct, $this->day(30)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
        $this->assertSame('non_payment', $this->standingRow($this->direct)->suspension_reason);
    }

    public function test_a_longest_wait_shorter_than_the_pause_day_never_waits(): void
    {
        BillingSettings::set('card_retry_max_days_late', 10, null);
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);
        $this->cardSubscription($this->direct, 'past_due');

        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->direct, $this->day(7)));
        for ($offset = 8; $offset <= 13; $offset++) {
            $this->assertSame([], $this->previewThenRun($this->direct, $this->day($offset)), "Day {$offset}.");
        }
        // Nothing is paused without its final warning standing its time,
        // even past the longest wait: the pause still falls on day 14.
        $this->assertFalse(BillingLock::isLocked($this->direct));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->direct, $this->day(14)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
    }

    public function test_the_waiting_entry_names_the_latest_day_the_pause_comes(): void
    {
        BillingSettings::set('card_retry_max_days_late', 45, null);
        $this->standing($this->direct, [
            'paid_until' => $this->today->toDateString(),
            'payer' => 'platform_card',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(7)->toDateTimeString(),
        ]);
        $this->cardSubscription($this->direct, 'past_due');

        $entries = array_values(array_filter(
            BillingAutomationService::preview($this->day(20)),
            fn (array $entry): bool => $entry['tenant_id'] === $this->direct
        ));

        $this->assertCount(1, $entries);
        $this->assertSame($this->day(45)->toDateString(), $entries[0]['detail']['pause_date']);
    }

    public function test_the_waiting_entry_says_how_late_the_payment_is_and_names_the_latest_pause_date(): void
    {
        $this->standing($this->direct, [
            'paid_until' => $this->today->toDateString(),
            'payer' => 'platform_card',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(7)->toDateTimeString(),
        ]);
        $this->cardSubscription($this->direct, 'past_due');

        $entries = array_values(array_filter(
            BillingAutomationService::preview($this->day(20)),
            fn (array $entry): bool => $entry['tenant_id'] === $this->direct
        ));

        $this->assertCount(1, $entries);
        $this->assertSame('waiting_for_stripe', $entries[0]['action']);
        $this->assertSame($this->today->toDateString(), $entries[0]['detail']['paid_until']);
        $this->assertSame(20, $entries[0]['detail']['days_late']);
        // Was: assertArrayNotHasKey('pause_date'). Now the latest day the
        // pause comes, whatever Stripe says: paid-until + 30 days.
        $this->assertSame($this->day(30)->toDateString(), $entries[0]['detail']['pause_date']);
    }

    /** @return array<string, array{?string}> */
    public static function stripeNotRetrying(): array
    {
        return [
            'unpaid' => ['unpaid'],
            'canceled' => ['canceled'],
            'incomplete_expired' => ['incomplete_expired'],
            'paused' => ['paused'],
            'never told' => [null],
        ];
    }

    /** @dataProvider stripeNotRetrying */
    public function test_a_card_payer_stripe_has_given_up_on_is_paused_on_the_normal_day(?string $stripeStatus): void
    {
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);
        $this->cardSubscription($this->direct, $stripeStatus);

        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->direct, $this->day(7)));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->direct, $this->day(14)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
    }

    public function test_only_a_card_payer_waits_for_stripe(): void
    {
        // Pays its parent, with an old card subscription Stripe still calls past due.
        $this->standing($this->child, ['paid_until' => $this->today->toDateString(), 'payer' => 'parent']);
        $this->cardSubscription($this->child, 'past_due');

        $this->previewThenRun($this->child, $this->day(1));
        $this->previewThenRun($this->child, $this->day(7));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->child, $this->day(14)));
        $this->assertTrue(BillingLock::isLocked($this->child));
    }

    public function test_the_platform_team_can_still_pause_by_hand_while_stripe_is_retrying(): void
    {
        $this->standing($this->direct, [
            'paid_until' => $this->today->toDateString(),
            'payer' => 'platform_card',
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(7)->toDateTimeString(),
        ]);
        $this->cardSubscription($this->direct, 'past_due');
        $this->assertSame(['payment:waiting_for_stripe'], $this->previewThenRun($this->direct, $this->day(14)));

        BillingStandingService::suspend($this->direct, null, 'manual');
        $this->assertTrue(BillingLock::isLocked($this->direct));

        // The check leaves a hand-made pause alone and says nothing more.
        $this->assertSame([], $this->previewThenRun($this->direct, $this->day(15)));
        $this->assertTrue(BillingLock::isLocked($this->direct));
    }

    public function test_switched_off_nothing_is_sent_or_paused_and_the_preview_says_what_would_happen(): void
    {
        DB::table('platform_billing_settings')->where('setting_key', 'automation_enabled')->delete();
        \App\Support\Billing\BillingSettings::flush();

        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);
        $this->standing($this->direct, ['paid_until' => $this->day(3)->toDateString()]);

        $preview = BillingAutomationService::preview($this->today);
        // 30 days late with nothing sent yet: "now due" first, never a pause.
        $this->assertSame(['payment:due'], $this->actionsFor($preview, $this->child));
        $this->assertSame(['payment:reminder'], $this->actionsFor($preview, $this->direct));

        $this->assertSame([], BillingAutomationService::run($this->today));

        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertNull($this->standingRow($this->child)->last_notice_stage);
        $this->assertCount(0, $this->mailTo($this->childAdmin));
        $this->assertCount(0, $this->mailTo($this->hubManager));
    }

    public function test_the_preview_never_acts_even_when_switched_on(): void
    {
        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);

        // A final warning that has stood long enough: the preview lists the pause.
        $this->standing($this->child, ['last_notice_stage' => 'final_warning', 'last_notice_at' => $this->day(-10)->toDateTimeString()]);

        $this->assertSame(['payment:suspend'], $this->actionsFor(BillingAutomationService::preview($this->today), $this->child));

        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertSame('final_warning', $this->standingRow($this->child)->last_notice_stage, 'The preview records nothing.');
        $this->assertCount(0, $this->mailTo($this->childAdmin));
    }

    public function test_exempt_not_billed_undated_and_the_platform_community_are_never_touched(): void
    {
        $exempt = $this->makeCommunity('Pay exempt', 1, '/1/');
        $notBilled = $this->makeCommunity('Pay not billed', 1, '/1/');
        $undated = $this->makeCommunity('Pay undated', 1, '/1/');

        $late = $this->day(-30)->toDateString();
        $this->standing($exempt, ['paid_until' => $late, 'exempt' => 1, 'exempt_reason' => 'Council contract']);
        $this->standing($notBilled, ['paid_until' => $late, 'payer' => 'not_billed']);
        $this->standing($undated, ['paid_until' => null]);
        $this->standing(1, ['paid_until' => $late]);

        $outcome = BillingAutomationService::run($this->today);

        foreach ([$exempt, $notBilled, $undated, 1] as $id) {
            $this->assertSame([], $this->actionsFor($outcome, $id), "Community {$id} was acted on.");
            $this->assertFalse(BillingLock::isLocked($id));
        }
    }

    public function test_a_community_already_paused_is_not_paused_again_and_nobody_is_told_twice(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual', 'Paused by hand');
        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);

        $outcome = BillingAutomationService::run($this->today);

        $this->assertNotContains('payment:suspend', $this->actionsFor($outcome, $this->child));
        $standing = BillingStandingService::get($this->child);
        $this->assertSame('manual', $standing['suspension_source']);
        $this->assertSame('Paused by hand', $standing['suspension_note']);
        $this->assertCount(0, $this->mailTo($this->childAdmin));

        // And it is not re-paused the morning after a person restores it.
        BillingStandingService::restore($this->child, null, 'Agreed a payment plan');
        $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day(1)), $this->child));
        $this->assertFalse(BillingLock::isLocked($this->child));
    }

    public function test_marking_paid_resets_the_stages_and_restores_an_automatic_pause(): void
    {
        // A final warning sent ten days ago: today's run pauses.
        $this->standing($this->child, [
            'paid_until' => $this->day(-30)->toDateString(),
            'last_notice_stage' => 'final_warning',
            'last_notice_at' => $this->day(-10)->toDateTimeString(),
        ]);
        BillingAutomationService::run($this->today);
        $this->assertTrue(BillingLock::isLocked($this->child));

        BillingStandingService::setPaidUntil($this->child, now()->addMonth()->toDateString(), null, 'Paid');

        $row = $this->standingRow($this->child);
        $this->assertNull($row->suspended_at);
        $this->assertNull($row->suspension_reason);
        $this->assertNull($row->last_notice_stage, 'A new paid-until date starts its stages again.');
        $this->assertFalse(BillingLock::isLocked($this->child));
    }

    public function test_marking_paid_does_not_lift_a_pause_for_being_over_the_member_limit(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto', null, 'over_limit');

        BillingStandingService::setPaidUntil($this->child, now()->addMonth()->toDateString(), null, 'Paid');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame('over_limit', $standing['suspension_reason']);
    }

    public function test_a_community_that_pays_the_platform_tells_the_platform_team_in_their_own_language(): void
    {
        // Irish and German: two of the locales the test bootstrap loads
        // (app.test_translation_locales).
        $admin = $this->person($this->direct, ['role' => 'admin', 'preferred_language' => 'ga']);
        $platformMember = $this->person($this->hub, ['role' => 'member', 'is_super_admin' => true, 'is_god' => true, 'preferred_language' => 'de']);
        $superOnly = $this->person($this->hub, ['role' => 'member', 'is_super_admin' => true, 'is_god' => false]);

        $this->standing($this->direct, ['paid_until' => $this->day(-1)->toDateString()]);

        $this->assertSame(['payment:due'], $this->actionsFor(BillingAutomationService::run($this->today), $this->direct));

        $this->assertStringContainsString('dlite anois', (string) $this->mailTo($admin)[0]->subject);
        $platformMail = $this->mailTo($platformMember);
        $this->assertCount(1, $platformMail);
        $this->assertStringContainsString('ist jetzt fällig', (string) $platformMail[0]->subject);
        $this->assertStringContainsString('Pay direct', (string) $platformMail[0]->subject);
        $this->assertCount(0, $this->mailTo($superOnly), 'A super admin who is not on the platform team is not told.');
        $this->assertCount(0, $this->mailTo($this->hubManager), 'The hub is not who this community pays.');
    }

    // ── Reminders from a month before (owner, 20 Nov 2026) ─────────────────────

    /** The one entry for a community on a day, from the run. */
    private function entryFor(array $outcome, int $tenantId): array
    {
        $entries = array_values(array_filter($outcome, static fn (array $e): bool => $e['tenant_id'] === $tenantId));
        $this->assertCount(1, $entries);

        return $entries[0];
    }

    public function test_by_default_each_reminder_fires_on_its_day_and_once_then_due_final_warning_and_pause_on_days_1_7_14(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $expected = [
            -30 => 'payment:reminder', -14 => 'payment:reminder', -7 => 'payment:reminder', -1 => 'payment:reminder',
            1 => 'payment:due', 7 => 'payment:final_warning', 14 => 'payment:suspend',
        ];
        for ($offset = -35; $offset <= 16; $offset++) {
            $want = isset($expected[$offset]) ? [$expected[$offset]] : [];
            $this->assertSame($want, $this->previewThenRun($this->child, $this->day($offset)), "Day {$offset}.");
            // A second run the same day sends nothing.
            $this->assertSame([], $this->actionsFor(BillingAutomationService::run($this->day($offset)), $this->child), "Second run, day {$offset}.");
        }
        $this->assertTrue(BillingLock::isLocked($this->child));

        $adminMail = array_map(static fn ($r) => (string) $r->subject, $this->mailTo($this->childAdmin));
        $this->assertCount(7, $adminMail, 'Four reminders, due, final warning, paused.');
        for ($i = 0; $i < 4; $i++) {
            $this->assertStringContainsString('is due on ' . $this->today->toDateString(), $adminMail[$i]);
        }
        $this->assertStringContainsString('is now due', $adminMail[4]);
    }

    public function test_a_reminder_says_which_reminder_day_it_is_and_how_many_days_are_left(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $entry = $this->entryFor(BillingAutomationService::run($this->day(-14)), $this->child);
        $this->assertSame('reminder', $entry['action']);
        $this->assertSame(14, $entry['detail']['days_before']);
        $this->assertSame(14, $entry['detail']['days_left']);
        $this->assertSame($this->today->toDateString(), $entry['detail']['paid_until']);
        $this->assertSame(0, $entry['detail']['days_late']);
        $this->assertSame('reminder', $this->standingRow($this->child)->last_notice_stage);
        $this->assertSame($this->day(-14)->toDateString(), substr((string) $this->standingRow($this->child)->last_notice_at, 0, 10));
    }

    public function test_a_missed_fortnight_sends_one_reminder_not_a_burst(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-30)));
        // No runs from day -29 to day -6: the 14-day and 7-day reminders were missed.
        $entry = $this->entryFor(BillingAutomationService::preview($this->day(-5)), $this->child);
        $this->assertSame(7, $entry['detail']['days_before']);
        $this->assertSame(5, $entry['detail']['days_left']);
        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-5)));
        $this->assertSame([], $this->previewThenRun($this->child, $this->day(-4)));
        $this->assertSame([], $this->previewThenRun($this->child, $this->day(-2)));
        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-1)));

        $this->assertCount(3, $this->mailTo($this->childAdmin));
    }

    public function test_a_first_run_inside_the_window_sends_one_reminder(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $entry = $this->entryFor(BillingAutomationService::preview($this->day(-5)), $this->child);
        $this->assertSame(7, $entry['detail']['days_before']);
        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-5)));
        $this->assertSame([], $this->previewThenRun($this->child, $this->day(-4)));
        $this->assertCount(1, $this->mailTo($this->childAdmin));
    }

    public function test_a_reminder_missed_on_its_day_is_sent_on_the_last_paid_day(): void
    {
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(-7)));
        // No run on day -1.
        $entry = $this->entryFor(BillingAutomationService::preview($this->today), $this->child);
        $this->assertSame(1, $entry['detail']['days_before']);
        $this->assertSame(0, $entry['detail']['days_left']);
        $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->today));
        $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->day(1)));
    }

    public function test_an_empty_reminder_list_sends_no_reminders(): void
    {
        BillingSettings::set('reminder_days', '', null);
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        for ($offset = -35; $offset <= 0; $offset++) {
            $this->assertSame([], $this->previewThenRun($this->child, $this->day($offset)), "Day {$offset}.");
        }
        $this->assertNull($this->standingRow($this->child)->last_notice_stage);
        $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->day(1)));
        $this->assertSame(['payment:final_warning'], $this->previewThenRun($this->child, $this->day(7)));
        $this->assertSame(['payment:suspend'], $this->previewThenRun($this->child, $this->day(14)));
    }

    public function test_a_custom_reminder_list_is_followed(): void
    {
        BillingSettings::set('reminder_days', '45,20', null);
        $this->standing($this->child, ['paid_until' => $this->today->toDateString()]);

        $expected = [-45 => 'payment:reminder', -20 => 'payment:reminder', 1 => 'payment:due'];
        for ($offset = -50; $offset <= 1; $offset++) {
            $want = isset($expected[$offset]) ? [$expected[$offset]] : [];
            $this->assertSame($want, $this->previewThenRun($this->child, $this->day($offset)), "Day {$offset}.");
        }
        $this->assertCount(3, $this->mailTo($this->childAdmin));
    }

    public function test_a_card_payer_gets_none_of_the_reminders(): void
    {
        $this->standing($this->direct, ['paid_until' => $this->today->toDateString(), 'payer' => 'platform_card']);
        $admin = $this->person($this->direct, ['role' => 'admin']);

        for ($offset = -35; $offset <= 0; $offset++) {
            $this->assertSame([], $this->previewThenRun($this->direct, $this->day($offset)), "Day {$offset}.");
        }
        $this->assertNull($this->standingRow($this->direct)->last_notice_stage);
        $this->assertCount(0, $this->mailTo($admin));
        $this->assertSame(['payment:due'], $this->previewThenRun($this->direct, $this->day(1)));
    }

    // ── The earliest automatic pause date, for Billing control ────────────────

    public function test_the_earliest_pause_date_is_the_paid_until_date_plus_the_pause_days(): void
    {
        $this->assertSame('2027-03-24', BillingAutomationService::earliestPauseDate('2027-03-10', 'platform_invoice', false, false));
        $this->assertSame('2027-03-24', BillingAutomationService::earliestPauseDate('2027-03-10 00:00:00', 'parent', false, false));
        $this->assertSame('2027-03-24', BillingAutomationService::earliestPauseDate('2027-03-10', 'platform_card', false, false));

        \App\Support\Billing\BillingSettings::set('suspend_days_late', 21, null);
        $this->assertSame('2027-03-31', BillingAutomationService::earliestPauseDate('2027-03-10', 'platform_invoice', false, false));
    }

    /** @return array<string, array{?string, string, bool, bool}> */
    public static function noPauseDate(): array
    {
        return [
            'no paid-until date' => [null, 'platform_invoice', false, false],
            'an empty date' => ['', 'platform_invoice', false, false],
            'not billed' => ['2027-03-10', 'not_billed', false, false],
            'exempt' => ['2027-03-10', 'platform_invoice', true, false],
            'already paused' => ['2027-03-10', 'platform_invoice', false, true],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('noPauseDate')]
    public function test_there_is_no_earliest_pause_date_when_no_pause_can_come(?string $paidUntil, string $payer, bool $exempt, bool $suspended): void
    {
        $this->assertNull(BillingAutomationService::earliestPauseDate($paidUntil, $payer, $exempt, $suspended));
    }

    public function test_there_is_no_earliest_pause_date_while_the_checks_are_switched_off(): void
    {
        \App\Support\Billing\BillingSettings::set('automation_enabled', false, null);

        $this->assertNull(BillingAutomationService::earliestPauseDate('2027-03-10', 'platform_invoice', false, false));
    }

    public function test_the_earliest_pause_date_is_never_a_day_already_gone(): void
    {
        // Long overdue and not yet paused: the pause cannot come before today.
        $this->assertSame('2027-06-01', BillingAutomationService::earliestPauseDate(
            '2027-03-10',
            'platform_invoice',
            false,
            false,
            CarbonImmutable::parse('2027-06-01')
        ));
    }

    // ── A date that has just been set (review of Stage 6) ─────────────────────

    public function test_a_date_just_set_does_not_bring_reminders_whose_day_has_already_gone(): void
    {
        \Illuminate\Support\Carbon::setTestNow($this->today->setTime(11, 0));
        try {
            // Paid today for the month ahead: 28 days are left, so the day of
            // the 30-day reminder is already behind us.
            BillingStandingService::setPaidUntil($this->child, $this->day(28)->toDateString(), null, 'Paid');

            $this->assertSame([], $this->previewThenRun($this->child, $this->day(1)), 'A reminder the morning after paying.');
            $this->assertSame([], $this->previewThenRun($this->child, $this->day(13)));
            $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(14)), '14 days before');
            $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(21)), '7 days before');
            $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(27)), '1 day before');
            $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->day(29)));
            $this->assertCount(4, $this->mailTo($this->childAdmin));
        } finally {
            \Illuminate\Support\Carbon::setTestNow();
        }
    }

    public function test_a_date_set_well_ahead_still_gets_every_reminder(): void
    {
        \Illuminate\Support\Carbon::setTestNow($this->today->setTime(11, 0));
        try {
            BillingStandingService::setPaidUntil($this->child, $this->day(60)->toDateString(), null, 'Paid');

            $this->assertSame([], $this->previewThenRun($this->child, $this->day(29)));
            $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(30)), '30 days before');
            $this->assertSame(['payment:reminder'], $this->previewThenRun($this->child, $this->day(46)), '14 days before');
        } finally {
            \Illuminate\Support\Carbon::setTestNow();
        }
    }

    public function test_a_date_set_in_the_past_is_due_on_the_next_run(): void
    {
        \Illuminate\Support\Carbon::setTestNow($this->today->setTime(11, 0));
        try {
            BillingStandingService::setPaidUntil($this->child, $this->day(-3)->toDateString(), null, 'Corrected');

            $this->assertSame(['payment:due'], $this->previewThenRun($this->child, $this->today));
        } finally {
            \Illuminate\Support\Carbon::setTestNow();
        }
    }

    public function test_the_reminder_goes_to_the_communitys_admins_only(): void
    {
        $this->standing($this->child, ['paid_until' => $this->day(3)->toDateString()]);

        BillingAutomationService::run($this->today);

        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertCount(0, $this->mailTo($this->hubManager));
    }
}
