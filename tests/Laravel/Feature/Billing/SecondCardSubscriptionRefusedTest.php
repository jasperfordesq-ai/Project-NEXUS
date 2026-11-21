<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A community that already pays by card cannot start a second card
 * subscription.
 *
 * The fault this pins (found 21 November 2026): "Change plan" sent a card
 * payer through a brand-new checkout. Stripe then held two subscriptions and
 * charged both; the platform kept only the newer id, so the older one carried
 * on charging with no record of it here and nothing to cancel it.
 *
 * Checkout is refused while Stripe still has a subscription open for the
 * community (TenantBillingService::hasLiveCardSubscription()), including one
 * whose card has failed. Changing the plan of a card payer is the platform
 * team's, until a proper change of an existing subscription is built.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class SecondCardSubscriptionRefusedTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $community;
    private int $spark;
    private int $local;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Second subscription community',
            'slug' => 'second-sub-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'stripe_customer_id' => 'cus_second_' . bin2hex(random_bytes(5)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('pay_plans')->whereIn('id', [$this->spark, $this->local])->update(['is_active' => 1]);

        BillingLock::flush();
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

    private function asAdmin(): void
    {
        $this->testTenantId = $this->community;
        $user = User::factory()->forTenant($this->community)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($this->community);
    }

    private function record(string $status, ?string $subscriptionId, ?string $stripeStatus): int
    {
        return (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $this->community,
            'pay_plan_id' => $this->spark,
            'status' => $status,
            'starts_at' => now(),
            'stripe_subscription_id' => $subscriptionId,
            'stripe_status' => $stripeStatus,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * What the record says and what Stripe last said, for a subscription
     * Stripe still has open.
     *
     * @return array<string, array{string, string}>
     */
    public static function openSubscriptions(): array
    {
        return [
            'paying normally' => ['active', 'active'],
            'on trial' => ['trial', 'trialing'],
            'card failed, Stripe still retrying' => ['expired', 'past_due'],
            'Stripe gave up, subscription still there' => ['expired', 'unpaid'],
            'first payment not through yet' => ['expired', 'incomplete'],
            'Stripe paused it' => ['expired', 'paused'],
        ];
    }

    /** @dataProvider openSubscriptions */
    public function test_a_second_card_checkout_is_refused_while_stripe_has_a_subscription_open(string $status, string $stripeStatus): void
    {
        $record = $this->record($status, 'sub_open_' . bin2hex(random_bytes(4)), $stripeStatus);
        $before = (array) DB::table('tenant_plan_assignments')->where('id', $record)->first();
        $this->asAdmin();

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $this->local, 'billing_interval' => 'monthly']);

        $response->assertStatus(422);
        $this->assertSame('ALREADY_SUBSCRIBED', $response->json('errors.0.code'));
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'), 'a sentence, not a key');
        $this->assertSame([], $this->stripe->requests, 'Stripe is never called: no customer, no price, no checkout.');
        $this->assertEquals($before, (array) DB::table('tenant_plan_assignments')->where('id', $record)->first(), 'the record is untouched');
        $this->assertSame(1, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
    }

    public function test_the_refusal_also_covers_a_plan_that_costs_nothing(): void
    {
        // A no-charge plan is switched on without Stripe: it used to drop
        // the stored subscription id and leave that subscription charging.
        $free = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'No-charge plan', 'slug' => 'no-charge-' . bin2hex(random_bytes(4)), 'tier_level' => 0,
            'price_monthly' => 0, 'price_yearly' => 0, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $record = $this->record('expired', 'sub_open_past_due', 'past_due');
        $this->asAdmin();

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $free, 'billing_interval' => 'monthly']);

        $response->assertStatus(422);
        $this->assertSame('ALREADY_SUBSCRIBED', $response->json('errors.0.code'));
        $this->assertSame('sub_open_past_due', DB::table('tenant_plan_assignments')->where('id', $record)->value('stripe_subscription_id'));
        $this->assertSame($this->spark, (int) DB::table('tenant_plan_assignments')->where('id', $record)->value('pay_plan_id'));
    }

    public function test_the_service_refuses_too_whoever_calls_it(): void
    {
        $this->record('active', 'sub_open_service', 'active');
        TenantContext::setById($this->community);

        try {
            StripeSubscriptionService::createCheckoutSession($this->community, $this->local, 'monthly');
            $this->fail('A second checkout was started.');
        } catch (\DomainException $e) {
            $this->assertSame('billing_already_subscribed', $e->getMessage());
        }

        $this->assertSame([], $this->stripe->requests);
    }

    /**
     * Subscriptions that are over, and a plan with no card behind it: a
     * checkout is the right way in.
     *
     * @return array<string, array{string, ?string, ?string}>
     */
    public static function nothingOpen(): array
    {
        return [
            'cancelled in Stripe' => ['cancelled', 'sub_over_1', 'canceled'],
            'first payment never came' => ['expired', 'sub_over_2', 'incomplete_expired'],
            'a plan given by hand, no card' => ['active', null, null],
        ];
    }

    /** @dataProvider nothingOpen */
    public function test_a_checkout_starts_when_no_subscription_is_open(string $status, ?string $subscriptionId, ?string $stripeStatus): void
    {
        $this->record($status, $subscriptionId, $stripeStatus);
        $this->asAdmin();

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $this->local, 'billing_interval' => 'monthly']);

        $response->assertOk();
        $this->assertStringStartsWith('https://checkout.stripe.test/', (string) $response->json('data.checkout_url'));
        $this->assertCount(1, $this->checkoutSessionsCreated());
    }

    public function test_a_community_with_no_plan_record_at_all_can_check_out(): void
    {
        $this->asAdmin();

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $this->local, 'billing_interval' => 'monthly']);

        $response->assertOk();
        $this->assertCount(1, $this->checkoutSessionsCreated());
    }

    public function test_the_subscription_answer_says_whether_a_card_subscription_is_open(): void
    {
        // What the plan picker reads to stop offering "Subscribe".
        $record = $this->record('expired', 'sub_open_flag', 'past_due');
        $this->asAdmin();

        $response = $this->apiGet('/v2/admin/billing/subscription');
        $response->assertOk();
        $this->assertTrue($response->json('data.has_card_subscription'));
        $this->assertSame($this->spark, (int) $response->json('data.pay_plan_id'));

        DB::table('tenant_plan_assignments')->where('id', $record)->update(['status' => 'cancelled', 'stripe_status' => 'canceled']);

        $this->assertFalse($this->apiGet('/v2/admin/billing/subscription')->json('data.has_card_subscription'));
    }
}
