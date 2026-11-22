<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Pausing, restoring and exempting a community for payment reasons: what is
 * refused, what is recorded, and who it is recorded against.
 */
final class BillingStandingServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $top;
    private int $child;
    private int $actor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->top = $this->makeCommunity('Standing top', 1, '/1/');
        $this->child = $this->makeCommunity('Standing child', $this->top, "/1/{$this->top}/");
        $this->actor = (int) User::factory()->forTenant($this->testTenantId)->create()->id;

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back. It must run even if
        // the flush throws, or the open transaction keeps its row locks and
        // every later test waits on them.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'standing-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @return list<object> */
    private function audit(int $tenantId): array
    {
        return DB::table('billing_audit_log')->where('tenant_id', $tenantId)->orderBy('id')->get()->all();
    }

    public function test_suspend_and_restore_are_audited_with_the_actor(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual', 'Two invoices unpaid');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame($this->child, $standing['locked_by_tenant_id']);
        $this->assertSame('manual', $standing['suspension_source']);
        $this->assertSame('Two invoices unpaid', $standing['suspension_note']);
        $this->assertNotNull($standing['suspended_at']);

        BillingStandingService::restore($this->child, $this->actor, 'Paid by transfer');

        $standing = BillingStandingService::get($this->child);
        $this->assertFalse($standing['locked']);
        $this->assertNull($standing['suspended_at']);
        $this->assertNull($standing['locked_by_tenant_id']);

        $rows = $this->audit($this->child);
        $this->assertSame(['standing_suspended', 'standing_restored'], array_map(static fn ($r) => $r->action, $rows));
        $this->assertSame($this->actor, (int) $rows[0]->acted_by_user_id);
        $this->assertSame($this->actor, (int) $rows[1]->acted_by_user_id);
        $this->assertSame('Two invoices unpaid', $rows[0]->notes);
        $this->assertSame('Paid by transfer', $rows[1]->notes);
    }

    public function test_a_suspension_by_the_system_has_no_actor(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        $rows = $this->audit($this->child);
        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]->acted_by_user_id);
        $this->assertSame('auto', BillingStandingService::get($this->child)['suspension_source']);
    }

    public function test_suspending_twice_writes_one_audit_row(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');
        BillingStandingService::suspend($this->child, $this->actor, 'manual');

        $this->assertCount(1, $this->audit($this->child));
    }

    public function test_restoring_an_open_community_writes_nothing(): void
    {
        BillingStandingService::restore($this->child, $this->actor);

        $this->assertCount(0, $this->audit($this->child));
        $this->assertFalse(BillingStandingService::get($this->child)['locked']);
    }

    public function test_tenant_one_cannot_be_suspended(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('platform_tenant_not_billable');

        BillingStandingService::suspend(1, $this->actor, 'manual');
    }

    public function test_an_unknown_community_is_refused(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('tenant_not_found');

        BillingStandingService::suspend(999999991, $this->actor, 'manual');
    }

    public function test_an_exempt_community_cannot_be_suspended(): void
    {
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract, paid annually');

        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('community_is_exempt');

        BillingStandingService::suspend($this->child, $this->actor, 'manual');
    }

    public function test_exempting_needs_a_reason(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('exempt_reason_required');

        BillingStandingService::setExempt($this->child, true, $this->actor, '   ');
    }

    public function test_exempting_a_suspended_community_restores_it(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['exempt']);
        $this->assertSame('Council contract', $standing['exempt_reason']);
        $this->assertFalse($standing['locked']);
        $this->assertNull($standing['suspended_at']);

        $this->assertSame(
            ['standing_suspended', 'standing_restored', 'standing_exempted'],
            array_map(static fn ($r) => $r->action, $this->audit($this->child))
        );
    }

    public function test_removing_an_exemption_is_audited(): void
    {
        BillingStandingService::setExempt($this->child, true, $this->actor, 'Council contract');
        BillingStandingService::setExempt($this->child, false, $this->actor);

        $standing = BillingStandingService::get($this->child);
        $this->assertFalse($standing['exempt']);
        $this->assertNull($standing['exempt_reason']);

        $this->assertSame(
            ['standing_exempted', 'standing_exemption_removed'],
            array_map(static fn ($r) => $r->action, $this->audit($this->child))
        );
    }

    // ── Paid until ──────────────────────────────────────────────────────────

    public function test_the_date_a_community_is_paid_up_to_is_recorded_and_audited(): void
    {
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', $this->actor, 'Invoice 14 paid');

        $this->assertSame('2027-01-31', BillingStandingService::get($this->child)['paid_until']);

        $rows = $this->audit($this->child);
        $this->assertCount(1, $rows);
        $this->assertSame('standing_paid_until_set', $rows[0]->action);
        $this->assertSame($this->actor, (int) $rows[0]->acted_by_user_id);
        $this->assertSame('Invoice 14 paid', $rows[0]->notes);
        $this->assertSame(['paid_until' => null], json_decode((string) $rows[0]->old_value, true));
        $this->assertSame(['paid_until' => '2027-01-31'], json_decode((string) $rows[0]->new_value, true));
    }

    public function test_setting_the_same_date_again_writes_nothing(): void
    {
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', $this->actor);
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', $this->actor);

        $this->assertCount(1, $this->audit($this->child));
    }

    public function test_clearing_the_date_stops_tracking(): void
    {
        BillingStandingService::setPaidUntil($this->child, '2027-01-31', $this->actor);
        BillingStandingService::setPaidUntil($this->child, null, $this->actor);

        $this->assertNull(BillingStandingService::get($this->child)['paid_until']);
        $this->assertCount(2, $this->audit($this->child));
    }

    public function test_a_date_in_the_past_is_accepted(): void
    {
        // It is how "overdue" is recorded.
        BillingStandingService::setPaidUntil($this->child, '2026-09-30', $this->actor);

        $this->assertSame('2026-09-30', BillingStandingService::get($this->child)['paid_until']);
    }

    /** @return array<string, array{0: string}> */
    public static function datesThatAreNotDates(): array
    {
        return [
            'words' => ['not-a-date'],
            'day first' => ['31/01/2027'],
            'no such day' => ['2027-02-30'],
            'with a time' => ['2027-01-31 10:00:00'],
            'empty' => [''],
        ];
    }

    #[\PHPUnit\Framework\Attributes\DataProvider('datesThatAreNotDates')]
    public function test_something_that_is_not_a_date_is_refused_and_nothing_is_written(string $date): void
    {
        try {
            BillingStandingService::setPaidUntil($this->child, $date, $this->actor);
            $this->fail("'{$date}' was accepted as a date.");
        } catch (\DomainException $e) {
            $this->assertSame('paid_until_invalid', $e->getMessage());
        }

        $this->assertCount(0, $this->audit($this->child));
        $this->assertNull(BillingStandingService::get($this->child)['paid_until']);
    }

    public function test_the_platform_community_has_no_paid_until_date(): void
    {
        $this->expectException(\DomainException::class);
        $this->expectExceptionMessage('platform_tenant_not_billable');

        BillingStandingService::setPaidUntil(1, '2027-01-31', $this->actor);
    }

    public function test_paying_up_restores_a_community_the_system_paused(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        BillingStandingService::setPaidUntil($this->child, now()->addMonth()->toDateString(), $this->actor);

        $standing = BillingStandingService::get($this->child);
        $this->assertFalse($standing['locked']);
        $this->assertNull($standing['suspended_at']);
        $this->assertSame(
            ['standing_suspended', 'standing_restored', 'standing_paid_until_set'],
            array_map(static fn ($r) => $r->action, $this->audit($this->child))
        );
    }

    public function test_paying_up_does_not_restore_a_community_a_person_paused(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');

        BillingStandingService::setPaidUntil($this->child, now()->addMonth()->toDateString(), $this->actor);

        $this->assertTrue(BillingStandingService::get($this->child)['locked']);
    }

    public function test_a_date_still_in_the_past_does_not_restore_a_community_the_system_paused(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        BillingStandingService::setPaidUntil($this->child, now()->subDays(40)->toDateString(), $this->actor);

        $this->assertTrue(BillingStandingService::get($this->child)['locked']);
    }

    /**
     * Stage 3b replaced "a date of today or later restores" with "a date less
     * than suspend_days_late (default 14) days in the past restores": moving
     * the date to one the daily check would not pause for opens it again.
     */
    public function test_a_date_less_than_the_pause_days_in_the_past_restores_a_community_the_system_paused(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        BillingStandingService::setPaidUntil($this->child, now()->subDays(13)->toDateString(), $this->actor);

        $this->assertFalse(BillingStandingService::get($this->child)['locked']);
    }

    public function test_a_date_the_pause_days_in_the_past_does_not_restore(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto');

        BillingStandingService::setPaidUntil($this->child, now()->subDays(14)->toDateString(), $this->actor);

        $this->assertTrue(BillingStandingService::get($this->child)['locked']);
    }

    public function test_a_pause_records_why_and_a_restore_clears_it(): void
    {
        BillingStandingService::suspend($this->child, $this->actor, 'manual');
        $this->assertSame('non_payment', BillingStandingService::get($this->child)['suspension_reason']);

        BillingStandingService::restore($this->child, $this->actor);
        $this->assertNull(BillingStandingService::get($this->child)['suspension_reason']);
        $this->assertNull(DB::table('tenant_billing_standing')->where('tenant_id', $this->child)->value('suspension_reason'));

        BillingStandingService::suspend($this->child, null, 'auto', null, 'over_limit');
        $standing = BillingStandingService::get($this->child);
        $this->assertSame('over_limit', $standing['suspension_reason']);
        $this->assertArrayHasKey('over_limit_since', $standing);
    }

    public function test_an_unknown_pause_reason_is_refused(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        BillingStandingService::suspend($this->child, null, 'auto', null, 'because');
    }

    public function test_a_pause_for_being_over_the_limit_is_not_lifted_by_paying(): void
    {
        BillingStandingService::suspend($this->child, null, 'auto', null, 'over_limit');

        BillingStandingService::setPaidUntil($this->child, now()->addYear()->toDateString(), $this->actor);

        $this->assertTrue(BillingStandingService::get($this->child)['locked']);
    }

    public function test_default_payer_by_position(): void
    {
        $this->assertSame('not_billed', BillingStandingService::defaultPayer(1));
        $this->assertSame('platform_invoice', BillingStandingService::defaultPayer($this->top));
        $this->assertSame('parent', BillingStandingService::defaultPayer($this->child));

        $standing = BillingStandingService::get($this->child);
        $this->assertSame('parent', $standing['payer']);
        $this->assertTrue($standing['payer_is_default']);
        $this->assertNull($standing['paid_until']);
        $this->assertFalse($standing['exempt']);
        $this->assertFalse($standing['locked']);
    }

    public function test_default_payer_is_card_when_a_live_stripe_subscription_exists(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->top,
            'pay_plan_id' => $planId,
            'status' => 'active',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)),
        ]);

        $this->assertSame('platform_card', BillingStandingService::defaultPayer($this->top));
    }

    /**
     * What the record says, what Stripe last said, and who the community
     * then pays by default.
     *
     * @return array<string, array{string, ?string, string}>
     */
    public static function cardRecords(): array
    {
        return [
            // The fault of 21 Nov 2026: a failed renewal is stored as
            // `expired`, and the community stopped being a card payer at once.
            'card failed, Stripe still retrying' => ['expired', 'past_due', 'platform_card'],
            'first payment not through yet' => ['expired', 'incomplete', 'platform_card'],
            'Stripe gave up, subscription still there' => ['expired', 'unpaid', 'platform_card'],
            'Stripe paused the subscription' => ['expired', 'paused', 'platform_card'],
            'paying normally' => ['active', 'active', 'platform_card'],
            'on trial' => ['trial', 'trialing', 'platform_card'],
            // Over: nothing more will be charged, a new one may be started.
            'cancelled in Stripe' => ['cancelled', 'canceled', 'platform_invoice'],
            'first payment never came' => ['expired', 'incomplete_expired', 'platform_invoice'],
            // A record cancelled here never counts, whatever Stripe last said.
            'cancelled here' => ['cancelled', 'active', 'platform_invoice'],
            // Stripe has said nothing yet: judged by the record, as before.
            'older record, active' => ['active', null, 'platform_card'],
            'older record, expired' => ['expired', null, 'platform_invoice'],
        ];
    }

    /** @dataProvider cardRecords */
    public function test_a_community_stays_a_card_payer_until_stripe_ends_its_subscription(string $status, ?string $stripeStatus, string $expected): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->top,
            'pay_plan_id' => $planId,
            'status' => $status,
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)),
            'stripe_status' => $stripeStatus,
        ]);

        $this->assertSame($expected, BillingStandingService::defaultPayer($this->top));
        $this->assertSame($expected, BillingStandingService::get($this->top)['payer']);
        $this->assertSame(
            $expected === 'platform_card',
            \App\Services\TenantBillingService::hasLiveCardSubscription($this->top)
        );
    }

    public function test_a_record_with_no_stripe_subscription_is_never_a_card_payer(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->top, 'pay_plan_id' => $planId, 'status' => 'active',
            'stripe_subscription_id' => null, 'stripe_status' => 'past_due',
        ]);

        $this->assertSame('platform_invoice', BillingStandingService::defaultPayer($this->top));
    }

    /**
     * A card subscription is with the platform, wherever the community sits.
     * Until 22 November 2026 a community under a hub was "pays its parent"
     * before a card was even looked for, so one that already paid the
     * platform by card was handed to its hub: the hub could set its date and
     * pause it, its notices named the hub as payee, and the wait for Stripe's
     * retries did not apply to it.
     */
    public function test_a_hubs_community_that_pays_the_platform_by_card_is_a_card_payer(): void
    {
        $this->assertSame('parent', BillingStandingService::defaultPayer($this->child), 'with no card it pays its hub');

        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->child, 'pay_plan_id' => $planId, 'status' => 'active',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)), 'stripe_status' => 'active',
        ]);

        $this->assertSame('platform_card', BillingStandingService::defaultPayer($this->child));
        $standing = BillingStandingService::get($this->child);
        $this->assertSame('platform_card', $standing['payer']);
        $this->assertTrue($standing['payer_is_default']);
    }

    public function test_a_hubs_community_whose_card_has_failed_is_still_a_card_payer(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->child, 'pay_plan_id' => $planId, 'status' => 'expired',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)), 'stripe_status' => 'past_due',
        ]);

        $this->assertSame('platform_card', BillingStandingService::defaultPayer($this->child));
    }

    public function test_a_hubs_community_whose_card_subscription_stripe_has_ended_pays_its_hub_again(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->child, 'pay_plan_id' => $planId, 'status' => 'cancelled',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)), 'stripe_status' => 'canceled',
        ]);

        $this->assertSame('parent', BillingStandingService::defaultPayer($this->child));
    }

    public function test_a_stored_payer_still_wins_over_a_card(): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Standing test plan',
            'slug' => 'standing-plan-' . bin2hex(random_bytes(4)),
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->child, 'pay_plan_id' => $planId, 'status' => 'active',
            'stripe_subscription_id' => 'sub_test_' . bin2hex(random_bytes(6)), 'stripe_status' => 'active',
        ]);
        // The platform team has said it pays its hub (it is being moved over
        // and the card has not been cancelled yet).
        BillingStandingService::setPayer($this->child, 'parent', $this->actor);

        $standing = BillingStandingService::get($this->child);
        $this->assertSame('parent', $standing['payer']);
        $this->assertFalse($standing['payer_is_default']);
    }

    public function test_a_community_moved_directly_under_the_platform_stops_paying_a_parent_it_no_longer_has(): void
    {
        // It was set, by hand, to pay its parent; then it was moved to sit
        // directly under the platform. Its notices went to tenant 1's
        // managers as if they were its hub.
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->child, 'payer' => 'parent',
            'last_notice_stage' => 'final_warning', 'last_notice_at' => now()->subDays(20),
            'paid_until' => now()->subDays(40)->toDateString(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->child)->update(['parent_id' => 1, 'path' => "/1/{$this->child}/"]);
        BillingLock::flush();

        BillingStandingService::communityMoved($this->child, 1);

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $this->child)->first();
        $this->assertNull($row->payer, 'the stored payer is cleared');
        $this->assertSame('platform_invoice', BillingStandingService::get($this->child)['payer']);
        $this->assertNull($row->last_notice_stage, 'and its payment warnings start again');
        $this->assertNotNull($row->paid_until, 'the paid-until date was recorded by a person and is kept');
    }

    public function test_a_community_moved_under_another_hub_keeps_paying_its_parent(): void
    {
        DB::table('tenant_billing_standing')->insert([
            'tenant_id' => $this->child, 'payer' => 'parent',
            'last_notice_stage' => 'due', 'last_notice_at' => now()->subDays(3),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        BillingStandingService::communityMoved($this->child, $this->top);

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $this->child)->first();
        $this->assertSame('parent', $row->payer);
        $this->assertNull($row->last_notice_stage, 'a new payee means the warnings start again');
    }

    public function test_a_child_under_a_suspended_parent_reports_who_locked_it(): void
    {
        BillingStandingService::suspend($this->top, $this->actor, 'manual');

        $standing = BillingStandingService::get($this->child);
        $this->assertTrue($standing['locked']);
        $this->assertSame($this->top, $standing['locked_by_tenant_id']);
        $this->assertNull($standing['suspended_at'], 'The child itself is not suspended.');
    }
}
