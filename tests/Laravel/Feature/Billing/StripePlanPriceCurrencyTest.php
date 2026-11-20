<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Stripe\ApiRequestor;
use Stripe\HttpClient\ClientInterface;
use Stripe\Util\CaseInsensitiveArray;
use Tests\Laravel\TestCase;

/**
 * A plan's Stripe price is created in the currency the community pays in,
 * with that currency's amount, and remembered per currency.
 *
 * The fault this pins: the price was created with the euro amount and the
 * currency of whichever community checked out first, then reused for
 * everybody. A pound community buying "Community" first made Stripe charge
 * £399 (the euro number), and every euro community after it was charged in
 * pounds too.
 *
 * No real Stripe call: the Stripe library's HTTP client is replaced by one
 * that records every request and answers from memory.
 */
final class StripePlanPriceCurrencyTest extends TestCase
{
    use DatabaseTransactions;

    /** @var ClientInterface&object{requests: array<int, array{method: string, path: string, params: array<string, mixed>}>} */
    private ClientInterface $stripe;

    private int $communityPlan;

    protected function setUp(): void
    {
        parent::setUp();

        BillingLock::flush();
        config(['services.stripe.secret' => 'sk_test_not_a_real_key']);
        $this->stripe = $this->fakeStripe();

        // The real standard package, with no Stripe ids yet. Rolled back.
        $this->communityPlan = (int) DB::table('pay_plans')->where('slug', 'community')->value('id');
        $this->assertGreaterThan(0, $this->communityPlan, 'the standard "community" package exists');
        DB::table('pay_plans')->where('id', $this->communityPlan)->update([
            'is_active' => 1,
            'stripe_product_id' => null,
            'stripe_price_id_monthly' => null,
            'stripe_price_id_yearly' => null,
            'stripe_price_id_monthly_gbp' => null,
            'stripe_price_id_yearly_gbp' => null,
        ]);
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

    private function fakeStripe(): ClientInterface
    {
        $client = new class implements ClientInterface {
            /** @var array<int, array{method: string, path: string, params: array<string, mixed>}> */
            public array $requests = [];
            private int $n = 0;

            public function request($method, $absUrl, $headers, $params, $hasFile, $apiMode = 'v1')
            {
                $method = strtoupper((string) $method);
                $path = (string) parse_url((string) $absUrl, PHP_URL_PATH);
                $params = is_array($params) ? $params : [];
                $this->requests[] = ['method' => $method, 'path' => $path, 'params' => $params];
                $n = ++$this->n;

                $body = match (true) {
                    $method === 'POST' && $path === '/v1/customers' => ['id' => "cus_fake_{$n}", 'object' => 'customer'],
                    $method === 'POST' && $path === '/v1/products' => ['id' => "prod_fake_{$n}", 'object' => 'product'],
                    $method === 'POST' && str_starts_with($path, '/v1/products/') => ['id' => substr($path, strlen('/v1/products/')), 'object' => 'product'],
                    $method === 'POST' && $path === '/v1/prices' => [
                        'id' => "price_fake_{$n}",
                        'object' => 'price',
                        'currency' => $params['currency'] ?? null,
                        'unit_amount' => $params['unit_amount'] ?? null,
                    ],
                    $method === 'POST' && $path === '/v1/checkout/sessions' => [
                        'id' => "cs_fake_{$n}",
                        'object' => 'checkout.session',
                        'url' => "https://checkout.example.test/{$n}",
                    ],
                    default => throw new \RuntimeException("Unexpected Stripe request in this test: {$method} {$path}"),
                };

                return [json_encode($body), 200, new CaseInsensitiveArray([])];
            }
        };

        ApiRequestor::setHttpClient($client);

        return $client;
    }

    /**
     * The prices created, in order. Checkout syncs both intervals of the one
     * currency it needs, so a test about one interval passes it.
     *
     * @return list<array<string, mixed>>
     */
    private function pricesCreated(?string $interval = null): array
    {
        return array_values(array_filter(
            array_map(
                static fn (array $r): array => $r['params'],
                array_filter($this->stripe->requests, static fn (array $r): bool => $r['method'] === 'POST' && $r['path'] === '/v1/prices')
            ),
            static fn (array $p): bool => $interval === null || ($p['recurring']['interval'] ?? null) === $interval
        ));
    }

    /** The price the last checkout session was opened with. */
    private function lastCheckoutPrice(): ?string
    {
        $sessions = array_values(array_filter(
            $this->stripe->requests,
            static fn (array $r): bool => $r['method'] === 'POST' && $r['path'] === '/v1/checkout/sessions'
        ));
        $last = end($sessions);

        return $last === false ? null : ($last['params']['line_items'][0]['price'] ?? null);
    }

    private function makeCommunity(string $currency): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Currency community',
            'slug' => 'currency-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        DB::table('tenant_settings')->insert([
            'tenant_id' => $id,
            'setting_key' => 'general.default_currency',
            'setting_value' => $currency,
        ]);

        return $id;
    }

    private function checkout(int $tenantId, int $planId, string $interval = 'monthly'): void
    {
        TenantContext::setById($tenantId);
        $result = StripeSubscriptionService::createCheckoutSession($tenantId, $planId, $interval);
        $this->assertArrayHasKey('checkout_url', $result);
    }

    /** @return object */
    private function plan(int $id): object
    {
        return DB::table('pay_plans')->where('id', $id)->first();
    }

    // ── which currency a community pays in ──────────────────────────────────

    public function test_a_community_pays_in_pounds_only_when_its_own_currency_is_gbp(): void
    {
        $this->assertSame('gbp', StripeSubscriptionService::billingCurrencyFor($this->makeCommunity('gbp')));
        $this->assertSame('gbp', StripeSubscriptionService::billingCurrencyFor($this->makeCommunity('GBP')));
        $this->assertSame('eur', StripeSubscriptionService::billingCurrencyFor($this->makeCommunity('eur')));
        $this->assertSame('eur', StripeSubscriptionService::billingCurrencyFor($this->makeCommunity('usd')));
        $this->assertSame('eur', StripeSubscriptionService::billingCurrencyFor($this->makeCommunity('chf')));
    }

    // ── checkout ─────────────────────────────────────────────────────────────

    public function test_a_pound_community_gets_a_pound_price_with_the_pound_amount(): void
    {
        $this->checkout($this->makeCommunity('gbp'), $this->communityPlan);

        $this->assertSame(['gbp'], array_values(array_unique(array_column($this->pricesCreated(), 'currency'))), 'only pound prices');
        $prices = $this->pricesCreated('month');
        $this->assertCount(1, $prices);
        $this->assertSame('gbp', $prices[0]['currency']);
        $this->assertSame(34900, $prices[0]['unit_amount']);
        $this->assertSame('month', $prices[0]['recurring']['interval']);

        $plan = $this->plan($this->communityPlan);
        $this->assertNotNull($plan->stripe_price_id_monthly_gbp);
        $this->assertNull($plan->stripe_price_id_monthly, 'the euro price id is untouched');
        $this->assertSame($plan->stripe_price_id_monthly_gbp, $this->lastCheckoutPrice());
    }

    public function test_a_euro_community_after_a_pound_one_gets_the_euro_price_not_the_pound_one(): void
    {
        $this->checkout($this->makeCommunity('gbp'), $this->communityPlan);
        $poundPrice = $this->plan($this->communityPlan)->stripe_price_id_monthly_gbp;

        $this->checkout($this->makeCommunity('eur'), $this->communityPlan);

        $prices = $this->pricesCreated('month');
        $this->assertCount(2, $prices);
        $this->assertSame('eur', $prices[1]['currency']);
        $this->assertSame(39900, $prices[1]['unit_amount']);

        $plan = $this->plan($this->communityPlan);
        $this->assertNotNull($plan->stripe_price_id_monthly);
        $this->assertNotSame($poundPrice, $plan->stripe_price_id_monthly);
        $this->assertSame($poundPrice, $plan->stripe_price_id_monthly_gbp, 'the pound price id is kept');
        $this->assertSame($plan->stripe_price_id_monthly, $this->lastCheckoutPrice());
        $this->assertNotSame($poundPrice, $this->lastCheckoutPrice());
    }

    public function test_a_second_pound_community_reuses_the_stored_pound_price(): void
    {
        $this->checkout($this->makeCommunity('gbp'), $this->communityPlan);
        $poundPrice = $this->plan($this->communityPlan)->stripe_price_id_monthly_gbp;

        $this->checkout($this->makeCommunity('gbp'), $this->communityPlan);

        $this->assertCount(1, $this->pricesCreated('month'), 'no second price was created');
        $this->assertCount(2, $this->pricesCreated(), 'only the first checkout created prices');
        $this->assertSame($poundPrice, $this->lastCheckoutPrice());
    }

    public function test_a_pound_community_on_a_plan_with_no_pound_price_is_charged_in_euro(): void
    {
        $custom = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Custom euro-only plan',
            'slug' => 'custom-euro-' . bin2hex(random_bytes(4)),
            'tier_level' => 9,
            'price_monthly' => 50,
            'price_yearly' => 500,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->checkout($this->makeCommunity('gbp'), $custom);

        $this->assertSame(['eur'], array_values(array_unique(array_column($this->pricesCreated(), 'currency'))), 'no pound price exists to create');
        $prices = $this->pricesCreated('month');
        $this->assertCount(1, $prices);
        $this->assertSame('eur', $prices[0]['currency'], 'never the euro number sent as pounds');
        $this->assertSame(5000, $prices[0]['unit_amount']);

        $plan = $this->plan($custom);
        $this->assertSame($plan->stripe_price_id_monthly, $this->lastCheckoutPrice());
        $this->assertNull($plan->stripe_price_id_monthly_gbp);
    }

    public function test_yearly_prices_follow_the_same_rule(): void
    {
        $this->checkout($this->makeCommunity('gbp'), $this->communityPlan, 'yearly');
        $this->checkout($this->makeCommunity('eur'), $this->communityPlan, 'yearly');

        $prices = $this->pricesCreated('year');
        $this->assertCount(2, $prices);
        $this->assertSame(['gbp', 349000, 'year'], [$prices[0]['currency'], $prices[0]['unit_amount'], $prices[0]['recurring']['interval']]);
        $this->assertSame(['eur', 399000, 'year'], [$prices[1]['currency'], $prices[1]['unit_amount'], $prices[1]['recurring']['interval']]);

        $plan = $this->plan($this->communityPlan);
        $this->assertNotNull($plan->stripe_price_id_yearly_gbp);
        $this->assertNotNull($plan->stripe_price_id_yearly);
        $this->assertNotSame($plan->stripe_price_id_yearly_gbp, $plan->stripe_price_id_yearly);
        $this->assertSame($plan->stripe_price_id_yearly, $this->lastCheckoutPrice());
    }

    // ── the platform team's sync button ─────────────────────────────────────

    public function test_sync_creates_both_currencies_for_a_plan_with_pound_prices(): void
    {
        StripeSubscriptionService::syncPlanToStripe($this->communityPlan);

        $byCurrencyAndInterval = [];
        foreach ($this->pricesCreated() as $price) {
            $byCurrencyAndInterval[$price['currency'] . '/' . $price['recurring']['interval']] = $price['unit_amount'];
        }
        ksort($byCurrencyAndInterval);
        $this->assertSame([
            'eur/month' => 39900,
            'eur/year' => 399000,
            'gbp/month' => 34900,
            'gbp/year' => 349000,
        ], $byCurrencyAndInterval);

        $plan = $this->plan($this->communityPlan);
        foreach (['stripe_price_id_monthly', 'stripe_price_id_yearly', 'stripe_price_id_monthly_gbp', 'stripe_price_id_yearly_gbp'] as $column) {
            $this->assertNotNull($plan->{$column}, $column);
        }
    }

    public function test_sync_keeps_a_stored_price_id_and_treats_it_as_the_euro_one(): void
    {
        DB::table('pay_plans')->where('id', $this->communityPlan)->update([
            'stripe_product_id' => 'prod_existing',
            'stripe_price_id_monthly' => 'price_existing_monthly',
        ]);

        StripeSubscriptionService::syncPlanToStripe($this->communityPlan);

        $plan = $this->plan($this->communityPlan);
        $this->assertSame('price_existing_monthly', $plan->stripe_price_id_monthly, 'never overwritten');
        $currencies = array_map(static fn (array $p): string => $p['currency'] . '/' . $p['recurring']['interval'], $this->pricesCreated());
        sort($currencies);
        $this->assertSame(['eur/year', 'gbp/month', 'gbp/year'], $currencies, 'no new euro monthly price');

        // And a euro community is sold the kept price.
        $this->checkout($this->makeCommunity('eur'), $this->communityPlan);
        $this->assertSame('price_existing_monthly', $this->lastCheckoutPrice());
    }

    // ── a plan change made in Stripe's own portal ───────────────────────────

    public function test_a_subscription_moved_to_a_pound_price_is_recognised_as_that_plan(): void
    {
        $tenantId = $this->makeCommunity('gbp');
        $otherPlan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Starting plan',
            'slug' => 'starting-' . bin2hex(random_bytes(4)),
            'tier_level' => 9,
            'price_monthly' => 10,
            'price_yearly' => 100,
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('pay_plans')->where('id', $this->communityPlan)->update(['stripe_price_id_monthly_gbp' => 'price_community_gbp']);
        $subscriptionId = 'sub_currency_' . bin2hex(random_bytes(5));
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $tenantId,
            'pay_plan_id' => $otherPlan,
            'status' => 'active',
            'starts_at' => now(),
            'stripe_subscription_id' => $subscriptionId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            StripeSubscriptionService::handleSubscriptionUpdated((object) [
                'id' => $subscriptionId,
                'status' => 'active',
                'items' => (object) ['data' => [(object) ['price' => (object) ['id' => 'price_community_gbp']]]],
            ]);
        } catch (\RuntimeException $e) {
            // The plan-change email needs an admin; there is none here and
            // that is not what this test is about.
            $this->assertStringContainsString('admin email failed', $e->getMessage());
        }

        $this->assertSame($this->communityPlan, (int) DB::table('tenant_plan_assignments')
            ->where('stripe_subscription_id', $subscriptionId)->value('pay_plan_id'));
    }
}
