<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * What Stripe tells the platform about a card subscription is applied
 * correctly whatever order it arrives in, whichever Stripe API version sends
 * it, and whoever the community's admins are.
 *
 * Four faults, found 21 November 2026:
 *
 *  1. Stripe redelivers an event whose handler failed, sometimes hours later.
 *     A redelivered "payment failed" was written over the "paid" that had
 *     arrived in between.
 *  2. From API version 2025-03-31 Stripe moved an invoice's subscription and a
 *     subscription's period end. The handlers read only the old positions, so
 *     on a newer webhook endpoint every renewal would have been ignored.
 *  3. A subscription update with no period end overwrote the stored one with
 *     nothing, switching the renewal reminders off.
 *  4. The billing email went to the first `role = 'admin'` account of any
 *     status. A community run by admins who hold the flag and not the role had
 *     nobody, so every billing event for it failed and was redelivered.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class StripeEventHandlingTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $community;
    private string $customer;
    private int $local;
    private int $record;
    private string $subscriptionId;

    /** @var object{sent: list<string>, accept: bool} */
    private object $mail;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();

        $this->mail = new class extends EmailDispatchService {
            /** @var list<string> */
            public array $sent = [];
            public bool $accept = true;

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                if ($this->accept) {
                    $this->sent[] = $to;
                }

                return $this->accept;
            }
        };
        app()->instance(EmailDispatchService::class, $this->mail);

        $this->customer = 'cus_events_' . bin2hex(random_bytes(5));
        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Stripe events community',
            'slug' => 'stripe-events-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'stripe_customer_id' => $this->customer,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->subscriptionId = 'sub_events_' . bin2hex(random_bytes(5));
        $this->record = (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $this->community,
            'pay_plan_id' => $this->local,
            'status' => 'active',
            'starts_at' => now(),
            'stripe_subscription_id' => $this->subscriptionId,
            'stripe_status' => 'active',
            'stripe_current_period_end' => '2026-12-01 09:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
            TenantContext::setById($this->testTenantId);
        } finally {
            parent::tearDown();
        }
    }

    /** @param array<string, mixed> $attributes */
    private function person(array $attributes): string
    {
        $email = 'events-' . bin2hex(random_bytes(6)) . '@example.test';
        User::factory()->forTenant($this->community)->create($attributes + [
            'status' => 'active', 'is_approved' => true, 'role' => 'member',
            'email' => $email, 'preferred_language' => 'en',
        ]);

        return $email;
    }

    private function row(): object
    {
        return DB::table('tenant_plan_assignments')->where('id', $this->record)->first();
    }

    /** @param array<string, mixed> $over */
    private function update(string $status, array $over = []): object
    {
        return (object) ($over + [
            'id' => $this->subscriptionId,
            'status' => $status,
            'current_period_end' => strtotime('2027-01-01 09:00:00'),
            'items' => (object) ['data' => []],
        ]);
    }

    // ── 1. a late redelivery ────────────────────────────────────────────────

    public function test_a_redelivered_older_event_is_not_written_over_a_newer_one(): void
    {
        $this->person(['role' => 'admin']);
        $failedAt = strtotime('2026-12-01 10:00:00');
        $paidAt = strtotime('2026-12-03 10:00:00');

        StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), $failedAt);
        $this->assertSame('expired', $this->row()->status);
        $this->assertSame('past_due', $this->row()->stripe_status);

        // The card is collected two days later.
        StripeSubscriptionService::handleSubscriptionUpdated($this->update('active'), $paidAt);
        $this->assertSame('active', $this->row()->status);
        $mailAfterPaid = count($this->mail->sent);

        // Stripe redelivers the first event.
        StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), $failedAt);

        $this->assertSame('active', $this->row()->status, 'a paid subscription is not marked failed again');
        $this->assertSame('active', $this->row()->stripe_status);
        $this->assertCount($mailAfterPaid, $this->mail->sent, 'and nobody is told again that payment failed');
    }

    public function test_an_event_as_new_as_the_last_one_or_with_no_time_is_still_applied(): void
    {
        $this->person(['role' => 'admin']);
        $at = strtotime('2026-12-01 10:00:00');

        StripeSubscriptionService::handleSubscriptionUpdated($this->update('active'), $at);
        // Same second: Stripe promises no order within it, so the later
        // arrival is applied.
        StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), $at);
        $this->assertSame('past_due', $this->row()->stripe_status);

        // A caller that does not know the time applies as before.
        StripeSubscriptionService::handleSubscriptionUpdated($this->update('active'));
        $this->assertSame('active', $this->row()->stripe_status);
    }

    public function test_a_new_subscription_is_not_judged_by_the_old_ones_event_time(): void
    {
        $this->person(['role' => 'admin']);
        // The record's subscription ended; a late event time is on it.
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update([
            'status' => 'cancelled', 'stripe_status' => 'canceled', 'stripe_event_at' => '2027-06-01 00:00:00',
        ]);

        // A new checkout is paid: a different subscription, a new lifecycle.
        StripeSubscriptionService::handleCheckoutCompleted((object) [
            'id' => 'cs_events_new', 'payment_status' => 'paid', 'customer' => $this->customer,
            'subscription' => 'sub_events_new',
            'metadata' => (object) [
                'nexus_tenant_id' => (string) $this->community,
                'nexus_plan_id' => (string) $this->local,
                'nexus_billing_interval' => 'yearly',
            ],
        ]);

        $row = $this->row();
        $this->assertSame('sub_events_new', $row->stripe_subscription_id);
        $this->assertNull($row->stripe_event_at, 'the old subscription\'s event time is dropped');
        $this->assertSame('yearly', $row->billing_interval, 'and the period bought is kept');

        // So an update for the new subscription dated before that old time applies.
        StripeSubscriptionService::handleSubscriptionUpdated(
            (object) ['id' => 'sub_events_new', 'status' => 'past_due', 'items' => (object) ['data' => []]],
            strtotime('2027-01-15 00:00:00')
        );
        $this->assertSame('past_due', $this->row()->stripe_status);
    }

    // ── 2. and 3. where Stripe puts things ───────────────────────────────────

    public function test_the_period_end_and_the_billing_period_are_read_from_the_subscription_item(): void
    {
        $this->person(['role' => 'admin']);
        // API 2025-03-31 and later: no period end on the subscription itself.
        $subscription = (object) [
            'id' => $this->subscriptionId,
            'status' => 'active',
            'items' => (object) ['data' => [(object) [
                'current_period_end' => strtotime('2027-11-01 09:00:00'),
                'price' => (object) ['id' => 'price_unknown_to_us', 'recurring' => (object) ['interval' => 'year']],
            ]]],
        ];

        StripeSubscriptionService::handleSubscriptionUpdated($subscription, strtotime('2026-12-01 10:00:00'));

        $this->assertSame('2027-11-01', substr((string) $this->row()->stripe_current_period_end, 0, 10));
        $this->assertSame('yearly', $this->row()->billing_interval);
    }

    public function test_an_update_that_carries_no_period_end_keeps_the_one_already_stored(): void
    {
        $this->person(['role' => 'admin']);

        StripeSubscriptionService::handleSubscriptionUpdated(
            (object) ['id' => $this->subscriptionId, 'status' => 'active', 'items' => (object) ['data' => []]],
            strtotime('2026-12-01 10:00:00')
        );

        $this->assertSame('2026-12-01', substr((string) $this->row()->stripe_current_period_end, 0, 10), 'not overwritten with nothing');
    }

    /**
     * Where an invoice names its subscription, by Stripe API version.
     *
     * @return array<string, array{string}>
     */
    public static function invoiceShapes(): array
    {
        return [
            'before 2025-03-31: invoice.subscription' => ['old'],
            'from 2025-03-31: invoice.parent.subscription_details.subscription' => ['new'],
        ];
    }

    /** @dataProvider invoiceShapes */
    public function test_a_paid_renewal_moves_the_paid_until_date_whichever_api_version_sent_it(string $shape): void
    {
        $this->person(['role' => 'admin']);
        $this->stripe->subscriptionPeriodEnd = strtotime('2027-01-01 09:00:00');

        $invoice = $shape === 'old'
            ? (object) ['id' => 'in_events_1', 'subscription' => $this->subscriptionId]
            : (object) ['id' => 'in_events_1', 'parent' => (object) [
                'subscription_details' => (object) ['subscription' => $this->subscriptionId],
            ]];

        StripeSubscriptionService::handleInvoicePaid($invoice);

        $this->assertSame('2027-01-01', BillingStandingService::get($this->community)['paid_until']);
        $this->assertSame('2027-01-01', substr((string) $this->row()->stripe_current_period_end, 0, 10));
    }

    /** @dataProvider invoiceShapes */
    public function test_a_failed_payment_is_recognised_whichever_api_version_sent_it(string $shape): void
    {
        $admin = $this->person(['role' => 'admin']);

        $invoice = $shape === 'old'
            ? (object) ['id' => 'in_events_2', 'subscription' => $this->subscriptionId]
            : (object) ['id' => 'in_events_2', 'parent' => (object) [
                'subscription_details' => (object) ['subscription' => $this->subscriptionId],
            ]];

        StripeSubscriptionService::handleInvoicePaymentFailed($invoice);

        $this->assertContains($admin, $this->mail->sent, 'the community\'s admin is told the payment failed');
    }

    // ── 4. who is told ──────────────────────────────────────────────────────

    public function test_every_active_admin_is_told_including_one_who_holds_the_flag_and_not_the_role(): void
    {
        $byRole = $this->person(['role' => 'admin']);
        $byFlag = $this->person(['role' => 'member', 'is_admin' => 1]);
        $member = $this->person(['role' => 'member']);
        $suspended = $this->person(['role' => 'admin', 'status' => 'suspended']);

        StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), strtotime('2026-12-01 10:00:00'));

        $this->assertContains($byRole, $this->mail->sent);
        $this->assertContains($byFlag, $this->mail->sent);
        $this->assertNotContains($member, $this->mail->sent);
        $this->assertNotContains($suspended, $this->mail->sent, 'an account that cannot sign in is not the one to tell');
    }

    public function test_a_community_with_nobody_to_tell_does_not_make_stripes_event_fail(): void
    {
        // No admin at all. The event used to throw, the webhook answered
        // 500, and Stripe redelivered it for days.
        StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), strtotime('2026-12-01 10:00:00'));

        $this->assertSame('past_due', $this->row()->stripe_status, 'the payment state is still recorded');
        $this->assertSame([], $this->mail->sent);
    }

    public function test_an_email_the_provider_refuses_still_makes_the_event_retryable(): void
    {
        // Unchanged, deliberately (40e36e2567): with someone to tell and the
        // provider down, Stripe is asked to deliver the event again.
        $this->person(['role' => 'admin']);
        $this->mail->accept = false;

        try {
            StripeSubscriptionService::handleSubscriptionUpdated($this->update('past_due'), strtotime('2026-12-01 10:00:00'));
            $this->fail('A refused email was treated as sent.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('admin email failed', $e->getMessage());
        }

        // The state was recorded before the email, and is kept.
        $this->assertSame('past_due', $this->row()->stripe_status);
    }
}
