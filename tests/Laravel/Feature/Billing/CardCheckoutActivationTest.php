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
 * A card payment that Stripe has taken switches the plan on, whatever plan
 * records the community already has.
 *
 * The fault this pins (found 21 November 2026): the handler of Stripe's
 * "checkout completed" wrote the new subscription id to EVERY plan record of
 * the community (`WHERE tenant_id = ?`). A community has more than one record
 * by design, because a new one is added whenever none is active. The
 * subscription id is unique in the table, so with two records the write
 * failed, the whole handler rolled back, and it failed again on each of
 * Stripe's retries: the money was taken, the plan was never switched on, and
 * the paid-until date was never set.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class CardCheckoutActivationTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $community;
    private string $customer;
    private int $spark;
    private int $local;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        $this->customer = 'cus_activation_' . bin2hex(random_bytes(5));
        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Activation community',
            'slug' => 'activation-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'stripe_customer_id' => $this->customer,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);
        User::factory()->forTenant($this->community)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
            'email' => 'activation-admin-' . bin2hex(random_bytes(5)) . '@example.test', 'preferred_language' => 'en',
        ]);

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->assertGreaterThan(0, $this->spark);
        $this->assertGreaterThan(0, $this->local);

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

    /** @param array<string, mixed> $values */
    private function record(array $values): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId($values + [
            'tenant_id' => $this->community,
            'pay_plan_id' => $this->spark,
            'status' => 'active',
            'starts_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function row(int $id): object
    {
        return DB::table('tenant_plan_assignments')->where('id', $id)->first();
    }

    private function paidCheckout(int $planId, ?string $subscriptionId = null): object
    {
        return (object) [
            'id' => 'cs_activation_' . bin2hex(random_bytes(5)),
            'payment_status' => 'paid',
            'customer' => $this->customer,
            'subscription' => $subscriptionId ?? 'sub_new_' . bin2hex(random_bytes(5)),
            'metadata' => (object) [
                'nexus_tenant_id' => (string) $this->community,
                'nexus_plan_id' => (string) $planId,
            ],
        ];
    }

    public function test_a_paid_checkout_switches_the_plan_on_when_an_old_ended_record_is_kept_beside_the_current_one(): void
    {
        // An earlier card subscription, cancelled; then a plan given by hand.
        $old = $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_old_ended', 'stripe_status' => 'canceled']);
        $current = $this->record(['status' => 'active']);
        $this->stripe->subscriptionPeriodEnd = strtotime('+1 month');

        $session = $this->paidCheckout($this->local);
        StripeSubscriptionService::handleCheckoutCompleted($session);

        $now = $this->row($current);
        $this->assertSame($this->local, (int) $now->pay_plan_id, 'the plan paid for is the plan in force');
        $this->assertSame('active', $now->status);
        $this->assertSame($session->subscription, $now->stripe_subscription_id);
        $this->assertSame('active', $now->stripe_status);

        // The old record is history: not a letter of it changes.
        $before = $this->row($old);
        $this->assertSame('cancelled', $before->status);
        $this->assertSame('sub_old_ended', $before->stripe_subscription_id);
        $this->assertSame('canceled', $before->stripe_status);
        $this->assertSame($this->spark, (int) $before->pay_plan_id);

        $this->assertSame(2, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
        // And the payment is on the community's payment record.
        $this->assertSame(date('Y-m-d', $this->stripe->subscriptionPeriodEnd), BillingStandingService::get($this->community)['paid_until']);
    }

    public function test_with_only_ended_records_the_newest_one_becomes_the_plan_in_force(): void
    {
        $older = $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_ended_1', 'stripe_status' => 'canceled']);
        $newer = $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_ended_2', 'stripe_status' => 'canceled']);

        $session = $this->paidCheckout($this->local);
        StripeSubscriptionService::handleCheckoutCompleted($session);

        $this->assertSame('active', $this->row($newer)->status);
        $this->assertSame($session->subscription, $this->row($newer)->stripe_subscription_id);
        $this->assertSame($this->local, (int) $this->row($newer)->pay_plan_id);
        $this->assertSame('cancelled', $this->row($older)->status);
        $this->assertSame('sub_ended_1', $this->row($older)->stripe_subscription_id);
    }

    public function test_the_same_event_delivered_twice_changes_nothing_the_second_time(): void
    {
        $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_old_ended', 'stripe_status' => 'canceled']);
        $current = $this->record(['status' => 'active']);

        $session = $this->paidCheckout($this->local);
        StripeSubscriptionService::handleCheckoutCompleted($session);
        StripeSubscriptionService::handleCheckoutCompleted($session);

        $this->assertSame($session->subscription, $this->row($current)->stripe_subscription_id);
        $this->assertSame(
            1,
            DB::table('tenant_plan_assignments')->where('stripe_subscription_id', $session->subscription)->count(),
            'one record carries the subscription'
        );
        $this->assertSame(2, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
    }

    public function test_a_late_event_for_a_cancelled_subscription_revives_nothing_whichever_record_holds_it(): void
    {
        // F-178, with two records: the cancelled subscription is on the OLDER
        // record, and a plan given by hand is in force.
        $cancelled = $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_gone', 'stripe_status' => 'canceled', 'pay_plan_id' => $this->local]);
        $current = $this->record(['status' => 'active']);

        StripeSubscriptionService::handleCheckoutCompleted($this->paidCheckout($this->local, 'sub_gone'));

        $this->assertSame('cancelled', $this->row($cancelled)->status);
        $this->assertNull($this->row($current)->stripe_subscription_id, 'the plan in force is not handed a dead subscription');
        $this->assertSame($this->spark, (int) $this->row($current)->pay_plan_id);
    }

    public function test_a_first_checkout_with_no_record_at_all_still_creates_one(): void
    {
        $session = $this->paidCheckout($this->local);
        StripeSubscriptionService::handleCheckoutCompleted($session);

        $rows = DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->get();
        $this->assertCount(1, $rows);
        $this->assertSame('active', $rows[0]->status);
        $this->assertSame($this->local, (int) $rows[0]->pay_plan_id);
        $this->assertSame($session->subscription, $rows[0]->stripe_subscription_id);
    }

    public function test_choosing_a_free_plan_changes_the_plan_in_force_and_leaves_history_alone(): void
    {
        // The same `WHERE tenant_id = ?` on the no-charge path rewrote every
        // historic record to the new plan and to `active`.
        $free = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'No-charge plan', 'slug' => 'no-charge-' . bin2hex(random_bytes(4)), 'tier_level' => 0,
            'price_monthly' => 0, 'price_yearly' => 0, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $old = $this->record(['status' => 'cancelled', 'stripe_subscription_id' => 'sub_old_ended', 'stripe_status' => 'canceled']);
        $current = $this->record(['status' => 'active']);

        TenantContext::setById($this->community);
        $result = StripeSubscriptionService::createCheckoutSession($this->community, $free, 'monthly');

        $this->assertTrue($result['activated'] ?? false);
        $this->assertSame($free, (int) $this->row($current)->pay_plan_id);
        $this->assertSame('active', $this->row($current)->status);
        $this->assertSame('cancelled', $this->row($old)->status, 'a cancelled record is not brought back to life');
        $this->assertSame($this->spark, (int) $this->row($old)->pay_plan_id);
        $this->assertSame('sub_old_ended', $this->row($old)->stripe_subscription_id);
        $this->assertSame(
            1,
            DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->where('status', 'active')->count(),
            'one plan is in force'
        );
    }
}
