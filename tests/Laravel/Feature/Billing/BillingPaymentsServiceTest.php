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
 * A payment recorded by hand (bank transfer, cheque, cash...) and the
 * platform team choosing how a community pays (Stage 6, Task B).
 *
 * A payment is a record of its own, and it moves the paid-until date through
 * setPaidUntil(), so everything that already does (notice stages reset, an
 * automatic non-payment pause lifted, the audit entry) happens exactly once.
 */
final class BillingPaymentsServiceTest extends TestCase
{
    use DatabaseTransactions;

    private int $top;
    private int $child;
    private int $actor;

    protected function setUp(): void
    {
        parent::setUp();

        $this->top = $this->makeCommunity('Payments top', 1, '/1/');
        $this->child = $this->makeCommunity('Payments child', $this->top, "/1/{$this->top}/");
        $this->actor = (int) User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Pat',
            'last_name' => 'Recorder',
            'name' => 'Pat Recorder',
        ])->id;

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
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
            'slug' => 'payments-' . bin2hex(random_bytes(5)),
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

    /**
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function payment(array $overrides = []): array
    {
        return array_merge([
            'paid_until' => now()->addYear()->toDateString(),
            'received_on' => now()->toDateString(),
            'method' => 'bank_transfer',
            'reference' => 'INV-2027-004',
            'amount' => '480.00',
            'currency' => 'GBP',
        ], $overrides);
    }

    private function assertRefused(string $code, callable $act): void
    {
        try {
            $act();
            $this->fail("Expected the refusal {$code}");
        } catch (\DomainException $e) {
            $this->assertSame($code, $e->getMessage());
        }
    }

    // ── Recording a payment ─────────────────────────────────────────────────

    public function test_a_payment_is_recorded_and_moves_the_paid_until_date(): void
    {
        BillingStandingService::setPaidUntil($this->top, '2026-12-31', null);
        $paidUntil = now()->addYear()->toDateString();

        $id = BillingStandingService::recordPayment($this->top, $this->payment(['paid_until' => $paidUntil]), $this->actor);

        $row = DB::table('billing_payments')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame($this->top, (int) $row->tenant_id);
        $this->assertSame(now()->toDateString(), substr((string) $row->received_on, 0, 10));
        $this->assertSame('bank_transfer', $row->method);
        $this->assertSame('INV-2027-004', $row->reference);
        $this->assertSame('480.00', (string) $row->amount);
        $this->assertSame('GBP', $row->currency);
        $this->assertSame('2026-12-31', substr((string) $row->paid_until_before, 0, 10));
        $this->assertSame($paidUntil, substr((string) $row->paid_until_after, 0, 10));
        $this->assertSame($this->actor, (int) $row->recorded_by_user_id);
        $this->assertNotNull($row->created_at);

        $this->assertSame($paidUntil, BillingStandingService::get($this->top)['paid_until']);

        $audit = $this->audit($this->top);
        $this->assertCount(2, $audit, 'The first date, then the payment: one entry for the payment.');
        $this->assertSame('standing_paid_until_set', $audit[1]->action);
        $this->assertSame($this->actor, (int) $audit[1]->acted_by_user_id);
        $this->assertStringContainsString('bank_transfer', (string) $audit[1]->notes);
        $this->assertStringContainsString('INV-2027-004', (string) $audit[1]->notes);
    }

    public function test_a_payment_resets_the_notices(): void
    {
        BillingStandingService::setPaidUntil($this->top, now()->subDays(3)->toDateString(), null);
        BillingStandingService::recordCheckState($this->top, ['last_notice_stage' => 'due', 'last_notice_at' => now()]);

        BillingStandingService::recordPayment($this->top, $this->payment(), $this->actor);

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $this->top)->first();
        $this->assertNull($row->last_notice_stage);
        // No stage, but the day the new date was set: the daily check uses
        // it to leave out reminders whose day had already gone by then.
        $this->assertSame(now()->toDateString(), substr((string) $row->last_notice_at, 0, 10));
    }

    public function test_a_payment_lifts_an_automatic_non_payment_pause(): void
    {
        BillingStandingService::setPaidUntil($this->top, now()->subDays(20)->toDateString(), null);
        BillingStandingService::suspend($this->top, null, 'auto');
        $this->assertTrue(BillingLock::isLocked($this->top));

        BillingStandingService::recordPayment($this->top, $this->payment(), $this->actor);

        $this->assertNull(BillingStandingService::get($this->top)['suspended_at']);
        $this->assertFalse(BillingLock::isLocked($this->top));
        $actions = array_map(static fn ($r) => $r->action, $this->audit($this->top));
        $this->assertSame(1, count(array_keys($actions, 'standing_restored', true)), 'Restored exactly once.');
    }

    public function test_a_payment_does_not_lift_a_pause_a_person_made(): void
    {
        BillingStandingService::suspend($this->top, $this->actor, 'manual');

        BillingStandingService::recordPayment($this->top, $this->payment(), $this->actor);

        $this->assertNotNull(BillingStandingService::get($this->top)['suspended_at']);
        $this->assertTrue(BillingLock::isLocked($this->top));
    }

    public function test_a_payment_does_not_lift_a_pause_for_being_over_the_member_limit(): void
    {
        BillingStandingService::suspend($this->top, null, 'auto', null, 'over_limit');

        BillingStandingService::recordPayment($this->top, $this->payment(), $this->actor);

        $standing = BillingStandingService::get($this->top);
        $this->assertNotNull($standing['suspended_at']);
        $this->assertSame('over_limit', $standing['suspension_reason']);
    }

    public function test_a_payment_may_be_recorded_for_an_exempt_community_and_a_card_payer(): void
    {
        BillingStandingService::setExempt($this->top, true, $this->actor, 'Council contract');
        BillingStandingService::setPayer($this->child, 'platform_card', $this->actor);

        $this->assertGreaterThan(0, BillingStandingService::recordPayment($this->top, $this->payment(), $this->actor));
        $this->assertGreaterThan(0, BillingStandingService::recordPayment($this->child, $this->payment(['method' => 'card']), $this->actor));
    }

    public function test_the_optional_fields_may_be_left_out(): void
    {
        $id = BillingStandingService::recordPayment($this->top, [
            'paid_until' => '2027-06-30',
            'received_on' => now()->toDateString(),
            'method' => 'cash',
            'reference' => '   ',
        ], $this->actor);

        $row = DB::table('billing_payments')->where('id', $id)->first();
        $this->assertNull($row->reference, 'A blank reference is stored as nothing.');
        $this->assertNull($row->amount);
        $this->assertNull($row->currency);
        $this->assertNull($row->paid_until_before);
    }

    public function test_the_reference_is_trimmed_and_cut_to_190_characters(): void
    {
        $id = BillingStandingService::recordPayment($this->top, $this->payment(['reference' => '  ' . str_repeat('r', 250) . '  ']), $this->actor);

        $this->assertSame(str_repeat('r', 190), DB::table('billing_payments')->where('id', $id)->value('reference'));
    }

    public function test_a_whole_number_amount_is_stored_with_two_decimals(): void
    {
        $id = BillingStandingService::recordPayment($this->top, $this->payment(['amount' => 120, 'currency' => 'EUR']), $this->actor);

        $this->assertSame('120.00', (string) DB::table('billing_payments')->where('id', $id)->value('amount'));
    }

    /** @return array<string, array{0: string, 1: array<string, mixed>}> */
    public static function badPayments(): array
    {
        return [
            'no paid-until date' => ['payment_paid_until_required', ['paid_until' => null]],
            'an empty paid-until date' => ['payment_paid_until_required', ['paid_until' => '']],
            'a paid-until that is not a date' => ['paid_until_invalid', ['paid_until' => '31/01/2027']],
            'a paid-until that does not exist' => ['paid_until_invalid', ['paid_until' => '2027-02-30']],
            'no received date' => ['payment_received_on_invalid', ['received_on' => null]],
            'a received date that is not a date' => ['payment_received_on_invalid', ['received_on' => 'yesterday']],
            'a received date in the future' => ['payment_received_on_invalid', ['received_on' => '2999-01-01']],
            'no method' => ['payment_method_invalid', ['method' => null]],
            'an unknown method' => ['payment_method_invalid', ['method' => 'bitcoin']],
            'a negative amount' => ['payment_amount_invalid', ['amount' => '-1']],
            'three decimals' => ['payment_amount_invalid', ['amount' => '10.005']],
            'an amount that is not a number' => ['payment_amount_invalid', ['amount' => 'lots']],
            'an amount too large' => ['payment_amount_invalid', ['amount' => '10000000000.00']],
            'an amount with no currency' => ['payment_currency_invalid', ['currency' => null]],
            'a lower-case currency' => ['payment_currency_invalid', ['currency' => 'gbp']],
            'a currency of the wrong length' => ['payment_currency_invalid', ['currency' => 'POUND']],
        ];
    }

    /**
     * @param array<string, mixed> $overrides
     */
    #[\PHPUnit\Framework\Attributes\DataProvider('badPayments')]
    public function test_a_bad_payment_is_refused_and_nothing_is_written(string $code, array $overrides): void
    {
        $this->assertRefused($code, fn () => BillingStandingService::recordPayment($this->top, $this->payment($overrides), $this->actor));

        $this->assertSame(0, DB::table('billing_payments')->where('tenant_id', $this->top)->count());
        $this->assertNull(BillingStandingService::get($this->top)['paid_until']);
        $this->assertSame([], $this->audit($this->top));
    }

    /**
     * The screen fills in the browser's own "today". For a person east of the
     * server's clock that is already the server's tomorrow just after their
     * midnight, so one day ahead is accepted and two are not.
     */
    public function test_a_received_date_one_day_ahead_of_the_servers_clock_is_accepted_and_two_are_not(): void
    {
        $tomorrow = now()->addDay()->toDateString();
        BillingStandingService::recordPayment($this->top, $this->payment(['received_on' => $tomorrow]), $this->actor);
        $this->assertSame($tomorrow, substr((string) DB::table('billing_payments')->where('tenant_id', $this->top)->value('received_on'), 0, 10));

        $this->assertRefused('payment_received_on_invalid', fn () => BillingStandingService::recordPayment(
            $this->top,
            $this->payment(['received_on' => now()->addDays(2)->toDateString()]),
            $this->actor
        ));
        $this->assertSame(1, DB::table('billing_payments')->where('tenant_id', $this->top)->count());
    }

    /**
     * A payment that leaves the date where it is changes nothing: no reminder
     * restart, no reopening, yet the screen would say "recorded". So the date
     * must move later; correcting a date is what "Set paid-until date" is for.
     */
    public function test_a_payment_must_move_the_paid_until_date_later(): void
    {
        BillingStandingService::recordPayment($this->top, $this->payment(['paid_until' => '2027-06-30']), $this->actor);

        $this->assertRefused('payment_paid_until_not_later', fn () => BillingStandingService::recordPayment(
            $this->top,
            $this->payment(['paid_until' => '2027-06-30']),
            $this->actor
        ));
        $this->assertRefused('payment_paid_until_not_later', fn () => BillingStandingService::recordPayment(
            $this->top,
            $this->payment(['paid_until' => '2027-05-31']),
            $this->actor
        ));

        $this->assertSame(1, DB::table('billing_payments')->where('tenant_id', $this->top)->count());
        $this->assertSame('2027-06-30', BillingStandingService::get($this->top)['paid_until']);
    }

    public function test_the_platform_community_and_an_unknown_one_are_refused(): void
    {
        $this->assertRefused('platform_tenant_not_billable', fn () => BillingStandingService::recordPayment(1, $this->payment(), $this->actor));
        $this->assertRefused('tenant_not_found', fn () => BillingStandingService::recordPayment(999999991, $this->payment(), $this->actor));

        $this->assertSame(0, DB::table('billing_payments')->whereIn('tenant_id', [1, 999999991])->count());
    }

    // ── The history ─────────────────────────────────────────────────────────

    public function test_the_history_is_newest_first_with_the_recorders_name(): void
    {
        $first = BillingStandingService::recordPayment($this->top, $this->payment(['received_on' => now()->subDays(40)->toDateString(), 'paid_until' => '2027-01-31']), $this->actor);
        $second = BillingStandingService::recordPayment($this->top, $this->payment(['received_on' => now()->subDays(5)->toDateString(), 'paid_until' => '2027-02-28', 'amount' => null, 'currency' => null]), $this->actor);
        // Same day as the second: the later record comes first.
        $third = BillingStandingService::recordPayment($this->top, $this->payment(['received_on' => now()->subDays(5)->toDateString(), 'paid_until' => '2027-03-31', 'method' => 'cheque']), $this->actor);
        // Another community's payment is not in this list.
        BillingStandingService::recordPayment($this->child, $this->payment(), $this->actor);

        $list = BillingStandingService::payments($this->top);

        $this->assertSame([$third, $second, $first], array_column($list, 'id'));
        $this->assertSame(
            ['id', 'received_on', 'method', 'reference', 'amount', 'currency', 'paid_until_before', 'paid_until_after', 'recorded_by_user_id', 'recorded_by_name', 'created_at'],
            array_keys($list[0])
        );
        $this->assertSame('cheque', $list[0]['method']);
        $this->assertSame(now()->subDays(5)->toDateString(), $list[0]['received_on']);
        $this->assertSame('480.00', $list[0]['amount']);
        $this->assertNull($list[1]['amount']);
        $this->assertNull($list[1]['currency']);
        $this->assertSame('2027-02-28', $list[0]['paid_until_before']);
        $this->assertSame('2027-03-31', $list[0]['paid_until_after']);
        $this->assertNull($list[2]['paid_until_before']);
        $this->assertSame($this->actor, $list[0]['recorded_by_user_id']);
        $this->assertSame('Pat Recorder', $list[0]['recorded_by_name']);
        $this->assertIsString($list[0]['created_at']);
    }

    public function test_the_history_is_limited(): void
    {
        foreach (range(1, 3) as $i) {
            BillingStandingService::recordPayment($this->top, $this->payment(['paid_until' => "2027-0{$i}-15"]), $this->actor);
        }

        $this->assertCount(2, BillingStandingService::payments($this->top, 2));
        $this->assertSame([], BillingStandingService::payments($this->child));
    }

    // ── How a community pays ────────────────────────────────────────────────

    public function test_each_payer_can_be_set_and_null_restores_the_default(): void
    {
        $this->assertSame('parent', BillingStandingService::get($this->child)['payer']);

        foreach (BillingStandingService::PAYERS as $payer) {
            BillingStandingService::setPayer($this->child, $payer, $this->actor);
            $standing = BillingStandingService::get($this->child);
            $this->assertSame($payer, $standing['payer']);
            $this->assertFalse($standing['payer_is_default']);
        }

        BillingStandingService::setPayer($this->child, null, $this->actor);
        $standing = BillingStandingService::get($this->child);
        $this->assertSame('parent', $standing['payer']);
        $this->assertTrue($standing['payer_is_default']);
    }

    public function test_setting_the_payer_is_audited_with_the_old_and_new_value(): void
    {
        BillingStandingService::setPayer($this->top, 'platform_card', $this->actor);
        BillingStandingService::setPayer($this->top, null, $this->actor);

        $audit = $this->audit($this->top);
        $this->assertSame(['standing_payer_set', 'standing_payer_set'], array_map(static fn ($r) => $r->action, $audit));
        $this->assertSame(['payer' => null], json_decode((string) $audit[0]->old_value, true));
        $this->assertSame(['payer' => 'platform_card'], json_decode((string) $audit[0]->new_value, true));
        $this->assertSame(['payer' => 'platform_card'], json_decode((string) $audit[1]->old_value, true));
        $this->assertSame(['payer' => null], json_decode((string) $audit[1]->new_value, true));
        $this->assertSame($this->actor, (int) $audit[0]->acted_by_user_id);
    }

    public function test_setting_the_same_payer_again_writes_nothing(): void
    {
        BillingStandingService::setPayer($this->top, 'platform_card', $this->actor);
        BillingStandingService::setPayer($this->top, 'platform_card', $this->actor);

        $this->assertCount(1, $this->audit($this->top));
    }

    public function test_setting_the_payer_does_not_touch_notices_or_pauses(): void
    {
        BillingStandingService::suspend($this->top, null, 'auto');
        BillingStandingService::recordCheckState($this->top, ['last_notice_stage' => 'final', 'last_notice_at' => now()]);

        BillingStandingService::setPayer($this->top, 'not_billed', $this->actor);

        $row = DB::table('tenant_billing_standing')->where('tenant_id', $this->top)->first();
        $this->assertNotNull($row->suspended_at);
        $this->assertSame('final', $row->last_notice_stage);
    }

    public function test_a_top_level_community_cannot_pay_a_parent(): void
    {
        $this->assertRefused('payer_needs_parent', fn () => BillingStandingService::setPayer($this->top, 'parent', $this->actor));
        $this->assertSame([], $this->audit($this->top));
    }

    public function test_an_unknown_payer_and_the_platform_community_are_refused(): void
    {
        $this->assertRefused('payer_invalid', fn () => BillingStandingService::setPayer($this->top, 'the_moon', $this->actor));
        $this->assertRefused('platform_tenant_not_billable', fn () => BillingStandingService::setPayer(1, 'platform_card', $this->actor));
        $this->assertRefused('tenant_not_found', fn () => BillingStandingService::setPayer(999999991, 'platform_card', $this->actor));
    }
}
