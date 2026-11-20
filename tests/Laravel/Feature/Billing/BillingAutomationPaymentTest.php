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

    public function test_a_missed_day_catches_up_with_the_highest_stage_only(): void
    {
        $this->standing($this->child, ['paid_until' => $this->day(-10)->toDateString()]);

        $this->assertSame(['payment:final_warning'], $this->actionsFor(BillingAutomationService::run($this->today), $this->child));

        $this->assertCount(1, $this->mailTo($this->childAdmin));
        $this->assertSame('final_warning', $this->standingRow($this->child)->last_notice_stage);
    }

    public function test_a_community_long_overdue_is_paused_on_the_first_run(): void
    {
        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);

        $outcome = BillingAutomationService::run($this->today);

        $this->assertSame(['payment:suspend'], $this->actionsFor($outcome, $this->child));
        $this->assertSame('non_payment', BillingStandingService::get($this->child)['suspension_reason']);
    }

    public function test_switched_off_nothing_is_sent_or_paused_and_the_preview_says_what_would_happen(): void
    {
        DB::table('platform_billing_settings')->where('setting_key', 'automation_enabled')->delete();
        \App\Support\Billing\BillingSettings::flush();

        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);
        $this->standing($this->direct, ['paid_until' => $this->day(3)->toDateString()]);

        $preview = BillingAutomationService::preview($this->today);
        $this->assertSame(['payment:suspend'], $this->actionsFor($preview, $this->child));
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

        $this->assertSame(['payment:suspend'], $this->actionsFor(BillingAutomationService::preview($this->today), $this->child));

        $this->assertFalse(BillingLock::isLocked($this->child));
        $this->assertNull($this->standingRow($this->child)->last_notice_stage);
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
        $this->standing($this->child, ['paid_until' => $this->day(-30)->toDateString()]);
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
