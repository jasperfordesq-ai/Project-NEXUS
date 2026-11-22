<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Models\User;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * A card payment Stripe reports as paid appears in the payments list.
 *
 * Until 22 November 2026 only a payment recorded by hand was in
 * `billing_payments`: a community that paid by card had an empty history, and
 * a refund or dispute had no payment to be marked against.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class CardPaymentRecordTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $community;
    private string $subscriptionId;
    private int $periodEnd;

    protected function setUp(): void
    {
        parent::setUp();

        BillingLock::flush();
        $this->installFakeStripe();

        $this->community = $this->makeCommunity();
        $this->subscriptionId = $this->assignCardPlan($this->community);
        User::factory()->forTenant($this->community)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
            'email' => 'card-record-admin-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);

        $this->periodEnd = now()->addDays(30)->getTimestamp();
        $this->stripe->subscriptionPeriodEnd = $this->periodEnd;

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Card record community',
            'slug' => 'card-record-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update([
            'path' => "/1/{$id}/",
            'stripe_customer_id' => 'cus_card_record_' . $id,
        ]);

        return $id;
    }

    private function assignCardPlan(int $tenantId): string
    {
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Card record plan',
            'slug' => 'card-record-plan-' . bin2hex(random_bytes(4)),
            'tier_level' => 1,
            'price_monthly' => 40,
            'price_yearly' => 480,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $subscriptionId = 'sub_card_record_' . bin2hex(random_bytes(6));

        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $planId,
            'status' => 'active',
            'starts_at' => now(),
            'stripe_subscription_id' => $subscriptionId,
            'stripe_current_period_end' => now()->addDays(3),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $subscriptionId;
    }

    /** @param array<string, mixed> $over */
    private function invoice(array $over = []): object
    {
        $base = [
            'id' => 'in_card_record_' . bin2hex(random_bytes(5)),
            'subscription' => $this->subscriptionId,
            'amount_paid' => 48000,
            'currency' => 'gbp',
            'payment_intent' => 'pi_card_record_1',
            'charge' => 'ch_card_record_1',
            'status_transitions' => ['paid_at' => now()->subDay()->getTimestamp()],
        ];

        // Nested objects, as the Stripe library hands an event over.
        return json_decode((string) json_encode(array_merge($base, $over)));
    }

    /** @return list<object> */
    private function rows(): array
    {
        return DB::table('billing_payments')->where('tenant_id', $this->community)->orderBy('id')->get()->all();
    }

    public function test_a_paid_invoice_is_written_to_the_payments_list(): void
    {
        BillingStandingService::setPaidUntil($this->community, now()->addDays(2)->toDateString(), null);
        $invoice = $this->invoice();

        StripeSubscriptionService::handleInvoicePaid($invoice);

        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $row = $rows[0];
        $this->assertSame('card', $row->method);
        $this->assertSame('480.00', (string) $row->amount);
        $this->assertSame('GBP', $row->currency);
        $this->assertSame($invoice->id, $row->reference, 'the Stripe invoice id is the reference');
        $this->assertSame($invoice->id, $row->stripe_invoice_id);
        $this->assertSame('pi_card_record_1', $row->stripe_payment_intent_id);
        $this->assertSame('ch_card_record_1', $row->stripe_charge_id);
        $this->assertSame(now()->subDay()->toDateString(), substr((string) $row->received_on, 0, 10), 'the day Stripe says it was paid');
        $this->assertSame(now()->addDays(2)->toDateString(), substr((string) $row->paid_until_before, 0, 10));
        $this->assertSame(date('Y-m-d', $this->periodEnd), substr((string) $row->paid_until_after, 0, 10));
        $this->assertNull($row->recorded_by_user_id, 'no person recorded it');
        $this->assertNull($row->payee_tenant_id, 'paid to the platform');
    }

    public function test_the_same_invoice_sent_again_writes_no_second_row(): void
    {
        $invoice = $this->invoice();

        StripeSubscriptionService::handleInvoicePaid($invoice);
        StripeSubscriptionService::handleInvoicePaid($invoice);
        StripeSubscriptionService::handleInvoicePaid($invoice);

        $this->assertCount(1, $this->rows());
        $this->assertSame(1, DB::table('billing_audit_log')
            ->where('tenant_id', $this->community)
            ->where('action', 'payment_recorded')
            ->count());
    }

    public function test_two_invoices_are_two_payments(): void
    {
        StripeSubscriptionService::handleInvoicePaid($this->invoice());
        StripeSubscriptionService::handleInvoicePaid($this->invoice(['payment_intent' => 'pi_card_record_2', 'charge' => 'ch_card_record_2']));

        $this->assertCount(2, $this->rows());
    }

    public function test_an_invoice_on_which_nothing_was_paid_is_not_a_payment(): void
    {
        StripeSubscriptionService::handleInvoicePaid($this->invoice(['amount_paid' => 0]));

        $this->assertCount(0, $this->rows());
    }

    public function test_an_event_with_no_invoice_id_writes_no_row_and_does_not_fail(): void
    {
        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $this->subscriptionId, 'amount_paid' => 48000, 'currency' => 'gbp']);

        $this->assertCount(0, $this->rows());
        $this->assertSame(date('Y-m-d', $this->periodEnd), BillingStandingService::get($this->community)['paid_until'], 'the date still moved');
    }

    /**
     * Stripe API versions from 2025-03-31 no longer put the payment intent on
     * the invoice itself: it is under `payments`.
     */
    public function test_the_payment_intent_is_read_from_the_newer_invoice_shape(): void
    {
        $invoice = $this->invoice([
            'payment_intent' => null,
            'charge' => null,
            'subscription' => null,
            'parent' => ['subscription_details' => ['subscription' => $this->subscriptionId]],
            'payments' => ['data' => [['payment' => ['type' => 'payment_intent', 'payment_intent' => 'pi_newer_shape']]]],
        ]);

        StripeSubscriptionService::handleInvoicePaid($invoice);

        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $this->assertSame('pi_newer_shape', $rows[0]->stripe_payment_intent_id);
        $this->assertSame([], $this->invoiceLookups(), 'the event already said; Stripe was not asked');
    }

    /**
     * An event that names neither is asked of Stripe once, so a later refund
     * can still be matched to this payment.
     */
    public function test_an_invoice_that_names_no_payment_is_looked_up_once(): void
    {
        $this->stripe->invoice = ['payment_intent' => 'pi_looked_up', 'charge' => 'ch_looked_up'];
        $invoice = $this->invoice(['payment_intent' => null, 'charge' => null]);

        StripeSubscriptionService::handleInvoicePaid($invoice);

        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $this->assertSame('pi_looked_up', $rows[0]->stripe_payment_intent_id);
        $this->assertSame('ch_looked_up', $rows[0]->stripe_charge_id);
        $this->assertCount(1, $this->invoiceLookups());
    }

    public function test_a_lookup_stripe_cannot_answer_still_leaves_the_payment_recorded(): void
    {
        // $this->stripe->invoice stays null: Stripe answers 404.
        $invoice = $this->invoice(['payment_intent' => null, 'charge' => null]);

        StripeSubscriptionService::handleInvoicePaid($invoice);

        $rows = $this->rows();
        $this->assertCount(1, $rows);
        $this->assertNull($rows[0]->stripe_payment_intent_id);
        $this->assertSame('480.00', (string) $rows[0]->amount);
    }

    public function test_the_history_lists_a_card_payment_as_one_and_names_nobody(): void
    {
        StripeSubscriptionService::handleInvoicePaid($this->invoice());
        BillingStandingService::recordPayment($this->community, [
            'paid_until' => now()->addDays(400)->toDateString(),
            'received_on' => now()->toDateString(),
            'method' => 'card',
            'reference' => 'taken by phone',
        ], (int) User::factory()->forTenant($this->testTenantId)->create()->id);

        $history = BillingStandingService::payments($this->community);

        $this->assertCount(2, $history);
        $bySource = array_column($history, null, 'source');
        $this->assertArrayHasKey('card', $bySource);
        $this->assertArrayHasKey('manual', $bySource, 'a card payment a person typed in is still a hand record');
        $this->assertNull($bySource['card']['recorded_by_name']);
        $this->assertSame('card', $bySource['manual']['method']);
    }

    public function test_the_platforms_own_community_gets_no_payment_row(): void
    {
        $this->assertNull(BillingStandingService::recordCardPayment(1, [
            'stripe_invoice_id' => 'in_platform_own',
            'amount_paid' => 1000,
            'currency' => 'eur',
        ]));
        $this->assertSame(0, DB::table('billing_payments')->where('stripe_invoice_id', 'in_platform_own')->count());
    }

    /** @return list<string> */
    private function invoiceLookups(): array
    {
        return array_values(array_map(
            static fn (array $r): string => $r['path'],
            array_filter($this->stripe->requests, static fn (array $r): bool => $r['method'] === 'GET' && str_starts_with($r['path'], '/v1/invoices/'))
        ));
    }
}
