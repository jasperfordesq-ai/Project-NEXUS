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

    public function test_each_stage_fires_on_its_day_and_only_once(): void
    {
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

    public function test_the_reminder_goes_to_the_communitys_admins_only(): void
    {
        $this->standing($this->child, ['paid_until' => $this->day(3)->toDateString()]);

        BillingAutomationService::run($this->today);

        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertCount(0, $this->mailTo($this->hubManager));
    }
}
