<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The one-off setup fee is taken with a community's first card payment, once,
 * and a community with a specially agreed price does not pay by card.
 *
 * Until 21 November 2026 the setup fee was stored on every plan and charged
 * nowhere: a card sign-up to "Local" simply skipped it. And a custom price,
 * a discount or the non-profit reduction never reached Stripe, so such a
 * community was charged the full list price by card.
 *
 * Decisions made for the owner (DECISIONS-FOR-THE-OWNER.md 6 and 7): the fee
 * is due only from a community that has never paid before in any way, and is
 * never added on a change of plan; a specially priced community pays by
 * invoice.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class CardCheckoutSetupFeeTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

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

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('pay_plans')->where('id', $this->spark)->update([
            'is_active' => 1, 'max_users' => 100, 'setup_fee' => 0, 'setup_fee_gbp' => 0,
            'price_monthly' => 175, 'price_monthly_gbp' => 150,
        ]);
        DB::table('pay_plans')->where('id', $this->local)->update([
            'is_active' => 1, 'max_users' => 300, 'setup_fee' => 750, 'setup_fee_gbp' => 645,
            'price_monthly' => 229, 'price_monthly_gbp' => 199, 'price_yearly' => 2290, 'price_yearly_gbp' => 1990,
        ]);

        BillingLock::flush();
        PlanTerms::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
            PlanTerms::flush();
            TenantContext::setById(2);
        } finally {
            parent::tearDown();
        }
    }

    private function community(string $currency): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Setup fee community', 'slug' => 'setup-fee-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1,
            'stripe_customer_id' => 'cus_fee_' . bin2hex(random_bytes(5)),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $id, 'setting_key' => 'general.default_currency', 'setting_value' => $currency,
        ]);

        return $id;
    }

    private function asAdminOf(int $tenantId): void
    {
        $this->testTenantId = $tenantId;
        Sanctum::actingAs(User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]), ['*']);
        TenantContext::setById($tenantId);
    }

    /** @return array<string, mixed> the one checkout session asked of Stripe */
    private function checkout(int $tenantId, int $planId, string $interval = 'monthly'): array
    {
        $this->asAdminOf($tenantId);
        $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $planId, 'billing_interval' => $interval])->assertOk();
        $sessions = $this->checkoutSessionsCreated();

        return $sessions[count($sessions) - 1];
    }

    public function test_a_first_card_checkout_adds_the_setup_fee_once_in_the_community_currency(): void
    {
        $session = $this->checkout($this->community('gbp'), $this->local);

        $this->assertCount(2, $session['line_items'], 'the plan, and the one-off setup fee');
        $fee = $session['line_items'][1];
        $this->assertSame('gbp', $fee['price_data']['currency']);
        $this->assertSame(64500, (int) $fee['price_data']['unit_amount'], '£645, in pence');
        $this->assertStringContainsString('Local', (string) $fee['price_data']['product_data']['name']);
        $this->assertArrayNotHasKey('recurring', $fee['price_data'], 'a one-off line, charged on the first invoice only');
        $this->assertSame(645.0, (float) $session['metadata']['nexus_setup_fee']);
    }

    public function test_a_euro_community_is_charged_the_euro_setup_fee(): void
    {
        $session = $this->checkout($this->community('eur'), $this->local, 'yearly');

        $this->assertSame('eur', $session['line_items'][1]['price_data']['currency']);
        $this->assertSame(75000, (int) $session['line_items'][1]['price_data']['unit_amount']);
    }

    public function test_a_plan_with_no_setup_fee_adds_nothing(): void
    {
        $session = $this->checkout($this->community('gbp'), $this->spark);

        $this->assertCount(1, $session['line_items']);
        $this->assertSame(0.0, (float) $session['metadata']['nexus_setup_fee']);
    }

    public function test_a_community_that_has_already_paid_by_hand_is_not_charged_a_setup_fee(): void
    {
        $community = $this->community('gbp');
        DB::table('billing_payments')->insert([
            'tenant_id' => $community, 'received_on' => now()->subMonth()->toDateString(), 'method' => 'bank_transfer',
            'amount' => 844, 'currency' => 'GBP', 'paid_until_after' => now()->toDateString(), 'created_at' => now(),
        ]);

        $session = $this->checkout($community, $this->local);

        $this->assertCount(1, $session['line_items'], 'it was set up, and paid for it, before it moved to card');
        // And the picker quotes it none.
        $plans = array_column($this->apiGet('/v2/billing/plans')->assertOk()->json('data'), null, 'slug');
        $this->assertSame(0.0, (float) $plans['local']['charge']['monthly']['setup_fee']);
        $this->assertSame(645.0, (float) $plans['local']['setup_fee_gbp'], 'the plan itself still shows its fee');
    }

    public function test_a_community_that_has_never_paid_is_quoted_the_fee_on_the_picker(): void
    {
        $this->asAdminOf($this->community('gbp'));

        $plans = array_column($this->apiGet('/v2/billing/plans')->assertOk()->json('data'), null, 'slug');

        $this->assertSame(645.0, (float) $plans['local']['charge']['monthly']['setup_fee']);
        $this->assertSame(0.0, (float) $plans['spark']['charge']['monthly']['setup_fee']);
    }

    public function test_the_fee_is_recorded_as_taken_when_the_checkout_completes_and_is_never_added_again(): void
    {
        $community = $this->community('gbp');
        $customer = (string) DB::table('tenants')->where('id', $community)->value('stripe_customer_id');
        User::factory()->forTenant($community)->create(['role' => 'admin', 'status' => 'active', 'is_approved' => true]);
        $this->assertTrue(StripeSubscriptionService::setupFeeApplies($community));

        StripeSubscriptionService::handleCheckoutCompleted((object) [
            'id' => 'cs_fee_1', 'payment_status' => 'paid', 'customer' => $customer, 'subscription' => 'sub_fee_1',
            'metadata' => (object) [
                'nexus_tenant_id' => (string) $community, 'nexus_plan_id' => (string) $this->local,
                'nexus_billing_interval' => 'monthly', 'nexus_setup_fee' => '645',
            ],
        ]);

        $this->assertNotNull(DB::table('tenant_billing_standing')->where('tenant_id', $community)->value('setup_fee_paid_at'));
        $this->assertFalse(StripeSubscriptionService::setupFeeApplies($community));

        // The subscription ends; a later checkout is a re-subscription, not a new set-up.
        DB::table('tenant_plan_assignments')->where('tenant_id', $community)->update(['status' => 'cancelled', 'stripe_status' => 'canceled']);
        $session = $this->checkout($community, $this->local);
        $this->assertCount(1, $session['line_items']);
    }

    public function test_a_community_that_subscribed_by_card_before_the_fee_existed_is_not_charged_it_later(): void
    {
        $community = $this->community('gbp');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $community, 'pay_plan_id' => $this->spark, 'status' => 'cancelled',
            'stripe_subscription_id' => 'sub_fee_old', 'stripe_status' => 'canceled',
            'starts_at' => now()->subYear(), 'created_at' => now()->subYear(), 'updated_at' => now(),
        ]);

        $session = $this->checkout($community, $this->local);

        $this->assertCount(1, $session['line_items']);
    }

    /**
     * @return array<string, array{array<string, mixed>}>
     */
    public static function specialPrices(): array
    {
        return [
            'a custom monthly price' => [['custom_price_monthly' => 120]],
            'a custom yearly price' => [['custom_price_yearly' => 1200]],
            'a discount' => [['discount_percentage' => 15, 'discount_reason' => 'Early adopter']],
            'the non-profit reduction' => [['nonprofit_verified' => 1]],
        ];
    }

    /**
     * @dataProvider specialPrices
     * @param array<string, mixed> $terms
     */
    public function test_a_community_with_a_specially_agreed_price_does_not_pay_by_card(array $terms): void
    {
        $community = $this->community('gbp');
        DB::table('tenant_plan_assignments')->insert($terms + [
            'tenant_id' => $community, 'pay_plan_id' => $this->local, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->asAdminOf($community);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $this->local, 'billing_interval' => 'monthly']);

        $response->assertStatus(422);
        $this->assertSame('SPECIAL_PRICE', $response->json('errors.0.code'));
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'));
        $this->assertSame([], $this->checkoutSessionsCreated(), 'Stripe would have charged the full list price');
    }

    public function test_a_plan_given_by_hand_at_the_list_price_can_be_paid_by_card(): void
    {
        $community = $this->community('gbp');
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $community, 'pay_plan_id' => $this->local, 'status' => 'active',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        $session = $this->checkout($community, $this->local);

        $this->assertCount(2, $session['line_items'], 'never paid before: the setup fee is due');
    }
}
