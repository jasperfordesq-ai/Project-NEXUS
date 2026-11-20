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
use Illuminate\Support\Facades\Log;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Stripe\Util\CaseInsensitiveArray;
use Tests\Laravel\TestCase;

/**
 * Stage 5: a community that pays the platform by card keeps the same payment
 * record as everyone else. Stripe's webhooks move `paid_until` forward when a
 * payment arrives and leave it exactly where it was when one fails, so the
 * daily check's clock runs from the last paid date.
 *
 * No real Stripe call: the Stripe library's HTTP client is replaced by one
 * that answers the single "retrieve subscription" request from memory.
 */
final class CardPaymentStandingTest extends TestCase
{
    use DatabaseTransactions;

    private int $community;
    private string $subscriptionId;

    /** @var EmailDispatchService&object{calls: array<int, array<string, mixed>>} */
    private EmailDispatchService $mailer;

    protected function setUp(): void
    {
        parent::setUp();

        BillingLock::flush();
        config(['services.stripe.secret' => 'sk_test_not_a_real_key']);

        $this->community = $this->makeCommunity();
        $this->subscriptionId = $this->assignCardPlan($this->community);
        $this->makeAdmin($this->community);

        $this->mailer = new class extends EmailDispatchService {
            /** @var array<int, array<string, mixed>> */
            public array $calls = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->calls[] = compact('to', 'subject', 'options');

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $this->mailer);
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            ApiRequestor::setHttpClient(null);
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Card payer',
            'slug' => 'card-payer-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update([
            'path' => "/1/{$id}/",
            'stripe_customer_id' => 'cus_card_payer_' . $id,
        ]);

        return $id;
    }

    private function assignCardPlan(int $tenantId): string
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

        $subscriptionId = 'sub_card_payer_' . bin2hex(random_bytes(6));

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

    private function makeAdmin(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
            'email' => 'card-admin-' . uniqid('', true) . '@example.test',
            'preferred_language' => 'en',
        ]);
    }

    /**
     * Answer every Stripe request with this subscription, and record what
     * was asked so a test can prove no other call went out.
     *
     * @return object{requests: array<int, string>}
     */
    private function fakeStripeSubscription(string $id, int $periodEnd, bool $unreachable = false): object
    {
        $client = new class($id, $periodEnd, $unreachable) implements ClientInterface {
            /** @var array<int, string> */
            public array $requests = [];

            public function __construct(private string $id, private int $periodEnd, private bool $unreachable)
            {
            }

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $this->requests[] = strtoupper((string) $method) . ' ' . $absUrl;

                if ($this->unreachable) {
                    throw new \Stripe\Exception\ApiConnectionException('Stripe is unreachable in this test');
                }

                $body = json_encode([
                    'id' => $this->id,
                    'object' => 'subscription',
                    'status' => 'active',
                    'current_period_end' => $this->periodEnd,
                ]);

                return [$body, 200, new CaseInsensitiveArray([])];
            }
        };

        ApiRequestor::setHttpClient($client);

        return $client;
    }

    private function paidUntil(int $tenantId): ?string
    {
        return BillingStandingService::get($tenantId)['paid_until'];
    }

    // ── invoice.paid ──────────────────────────────────────────────────────────

    public function test_a_paid_invoice_sets_paid_until_to_the_period_end(): void
    {
        $periodEnd = now()->addDays(30)->getTimestamp();
        $stripe = $this->fakeStripeSubscription($this->subscriptionId, $periodEnd);

        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $this->subscriptionId]);

        $this->assertSame(date('Y-m-d', $periodEnd), $this->paidUntil($this->community));
        $this->assertCount(1, $stripe->requests, 'one subscription lookup, nothing else');

        $audit = DB::table('billing_audit_log')
            ->where('tenant_id', $this->community)
            ->where('action', 'standing_paid_until_set')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($audit);
        $this->assertNull($audit->acted_by_user_id, 'the system made the change');
        $this->assertSame('Stripe invoice paid', $audit->notes);

        // The handler's own work still happens.
        $assignment = DB::table('tenant_plan_assignments')->where('stripe_subscription_id', $this->subscriptionId)->first();
        $this->assertSame(date('Y-m-d H:i:s', $periodEnd), (string) $assignment->stripe_current_period_end);
        $this->assertCount(1, $this->mailer->calls);
    }

    public function test_a_paid_invoice_lifts_an_automatic_pause(): void
    {
        BillingStandingService::setPaidUntil($this->community, now()->subDays(20)->toDateString(), null);
        BillingStandingService::suspend($this->community, null, 'auto');
        $this->assertTrue(BillingStandingService::get($this->community)['locked']);

        $this->fakeStripeSubscription($this->subscriptionId, now()->addDays(30)->getTimestamp());
        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $this->subscriptionId]);

        $this->assertFalse(BillingStandingService::get($this->community)['locked']);
    }

    public function test_a_redelivered_paid_invoice_changes_nothing_more(): void
    {
        $periodEnd = now()->addDays(30)->getTimestamp();
        $this->fakeStripeSubscription($this->subscriptionId, $periodEnd);

        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $this->subscriptionId]);
        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $this->subscriptionId]);

        $this->assertSame(date('Y-m-d', $periodEnd), $this->paidUntil($this->community));
        $this->assertSame(1, DB::table('billing_audit_log')
            ->where('tenant_id', $this->community)
            ->where('action', 'standing_paid_until_set')
            ->count());
    }

    /**
     * A failure to write the payment record is logged as an error and does
     * NOT fail the webhook: the assignment and the email are the handler's
     * own work, and a retry from Stripe could never fix a refused record.
     * The platform's own community is never billed, so its record is refused.
     */
    public function test_a_refused_payment_record_is_logged_and_does_not_fail_the_webhook(): void
    {
        $subscriptionId = $this->assignCardPlan(1);
        $this->makeAdmin(1);
        $periodEnd = now()->addDays(30)->getTimestamp();
        $this->fakeStripeSubscription($subscriptionId, $periodEnd);

        Log::spy();

        StripeSubscriptionService::handleInvoicePaid((object) ['subscription' => $subscriptionId]);

        Log::shouldHaveReceived('error')->withArgs(
            fn (string $message, array $context = []): bool => str_contains($message, 'payment record')
                && ($context['tenant_id'] ?? null) === 1
        )->once();

        $assignment = DB::table('tenant_plan_assignments')->where('stripe_subscription_id', $subscriptionId)->first();
        $this->assertSame(date('Y-m-d H:i:s', $periodEnd), (string) $assignment->stripe_current_period_end);
        $this->assertCount(1, $this->mailer->calls, 'the renewal email still went');
    }

    // ── failed payments leave the date alone ─────────────────────────────────

    public function test_a_failed_payment_leaves_paid_until_where_it_was(): void
    {
        BillingStandingService::setPaidUntil($this->community, '2026-11-01', null);

        StripeSubscriptionService::handleInvoicePaymentFailed((object) [
            'id' => 'in_failed_' . uniqid(),
            'subscription' => $this->subscriptionId,
            'customer' => 'cus_card_payer_' . $this->community,
            'amount_due' => 1000,
        ]);

        $this->assertSame('2026-11-01', $this->paidUntil($this->community));
        $this->assertFalse(BillingStandingService::get($this->community)['locked'], 'a failed payment pauses nothing by itself');
    }

    /** @return array<string, array{string}> */
    public static function unpaidStatuses(): array
    {
        return [
            'past_due' => ['past_due'],
            'unpaid' => ['unpaid'],
            'incomplete' => ['incomplete'],
            'incomplete_expired' => ['incomplete_expired'],
            'paused' => ['paused'],
        ];
    }

    /** @dataProvider unpaidStatuses */
    public function test_a_subscription_falling_behind_leaves_paid_until_where_it_was(string $status): void
    {
        BillingStandingService::setPaidUntil($this->community, '2026-11-01', null);

        StripeSubscriptionService::handleSubscriptionUpdated((object) [
            'id' => $this->subscriptionId,
            'status' => $status,
            'current_period_end' => now()->addDays(30)->getTimestamp(),
        ]);

        $this->assertSame('2026-11-01', $this->paidUntil($this->community));
        $this->assertSame('expired', DB::table('tenant_plan_assignments')
            ->where('stripe_subscription_id', $this->subscriptionId)->value('status'));
    }

    public function test_a_cancelled_subscription_leaves_paid_until_at_the_paid_period_end(): void
    {
        BillingStandingService::setPaidUntil($this->community, '2026-12-15', null);

        StripeSubscriptionService::handleSubscriptionUpdated((object) [
            'id' => $this->subscriptionId,
            'status' => 'canceled',
            'current_period_end' => now()->addDays(60)->getTimestamp(),
        ]);
        $this->assertSame('2026-12-15', $this->paidUntil($this->community));

        StripeSubscriptionService::handleSubscriptionDeleted((object) ['id' => $this->subscriptionId]);
        $this->assertSame('2026-12-15', $this->paidUntil($this->community), 'not cleared, not extended');
    }

    // ── checkout.session.completed ───────────────────────────────────────────

    private function completeCheckout(): void
    {
        $planId = (int) DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->value('pay_plan_id');

        StripeSubscriptionService::handleCheckoutCompleted((object) [
            'id' => 'cs_card_' . uniqid(),
            'metadata' => (object) ['nexus_tenant_id' => (string) $this->community, 'nexus_plan_id' => (string) $planId],
            'customer' => 'cus_card_payer_' . $this->community,
            'payment_status' => 'paid',
            'subscription' => $this->subscriptionId,
        ]);
    }

    /**
     * Stripe does not promise to deliver the first invoice.paid after the
     * checkout event, and an invoice.paid that arrives first finds no
     * assignment and is dropped. So checkout sets the date too.
     */
    public function test_a_completed_checkout_sets_paid_until_to_the_period_end(): void
    {
        $periodEnd = now()->addDays(31)->getTimestamp();
        $stripe = $this->fakeStripeSubscription($this->subscriptionId, $periodEnd);

        $this->completeCheckout();

        $this->assertSame(date('Y-m-d', $periodEnd), $this->paidUntil($this->community));
        $this->assertCount(1, $stripe->requests);
        $this->assertSame('active', DB::table('tenant_plan_assignments')
            ->where('stripe_subscription_id', $this->subscriptionId)->value('status'));
        $this->assertCount(1, $this->mailer->calls);
    }

    public function test_a_checkout_still_activates_when_stripe_cannot_say_the_period_end(): void
    {
        BillingStandingService::setPaidUntil($this->community, '2026-11-01', null);
        DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->update(['status' => 'expired']);
        $this->fakeStripeSubscription($this->subscriptionId, now()->addDays(30)->getTimestamp(), unreachable: true);

        Log::spy();

        $this->completeCheckout();

        Log::shouldHaveReceived('error')->withArgs(
            fn (string $message, array $context = []): bool => str_contains($message, 'payment record')
                && ($context['tenant_id'] ?? null) === $this->community
        )->once();
        $this->assertSame('2026-11-01', $this->paidUntil($this->community));
        $this->assertSame('active', DB::table('tenant_plan_assignments')
            ->where('stripe_subscription_id', $this->subscriptionId)->value('status'));
        $this->assertCount(1, $this->mailer->calls, 'the activation email still went');
    }
}
