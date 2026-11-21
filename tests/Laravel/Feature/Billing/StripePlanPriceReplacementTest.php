<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Services\StripeSubscriptionService;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * An edited plan price reaches Stripe for new card sign-ups.
 *
 * Stripe prices cannot be edited, and the sync deliberately never replaces a
 * stored price id. So until 21 November 2026 a plan that already had a Stripe
 * price kept charging the old amount at checkout whatever the screen showed.
 * Now, when an update changes an amount whose Stripe price is stored, a new
 * price is created and stored, and the old id is kept in
 * `pay_plan_stripe_prices` so a subscription still on it is recognised.
 */
final class StripePlanPriceReplacementTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $planId;

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();
        PlanTerms::flush();
        $this->installFakeStripe();

        // Every currency and interval already has its Stripe price, so a sync
        // on its own creates nothing.
        $this->planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Replacement plan',
            'slug' => 'replacement-plan-' . bin2hex(random_bytes(4)),
            'tier_level' => 9,
            'price_monthly' => 40,
            'price_yearly' => 400,
            'price_monthly_gbp' => 35,
            'price_yearly_gbp' => 350,
            'max_users' => 100,
            'is_active' => 1,
            'stripe_product_id' => 'prod_existing',
            'stripe_price_id_monthly' => 'price_old_eur_monthly',
            'stripe_price_id_yearly' => 'price_old_eur_yearly',
            'stripe_price_id_monthly_gbp' => 'price_old',
            'stripe_price_id_yearly_gbp' => 'price_old_gbp_yearly',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        // What Stripe holds for those prices: the same amounts as the plan.
        $this->stripe->priceAmounts = [
            'price_old_eur_monthly' => 4000,
            'price_old_eur_yearly' => 40000,
            'price_old' => 3500,
            'price_old_gbp_yearly' => 35000,
        ];
    }

    private function sync(): \Illuminate\Testing\TestResponse
    {
        $this->actAsPlatformTeam();

        return $this->apiPost("/v2/admin/plans/{$this->planId}/sync-stripe");
    }

    /** @return array<string, string> "currency/interval" => outcome */
    private function outcomes(\Illuminate\Testing\TestResponse $response): array
    {
        $out = [];
        foreach ((array) $response->json('data.price_changes') as $change) {
            $out[$change['currency'] . '/' . $change['interval']] = $change['outcome'];
        }
        ksort($out);

        return $out;
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function update(array $payload): \Illuminate\Testing\TestResponse
    {
        $this->actAsPlatformTeam();

        return $this->apiPut("/v2/admin/plans/{$this->planId}", $payload);
    }

    private function column(string $name): mixed
    {
        return DB::table('pay_plans')->where('id', $this->planId)->value($name);
    }

    public function test_changed_amount_creates_a_new_stripe_price(): void
    {
        $this->update(['price_monthly_gbp' => 42.50])->assertStatus(200);

        $prices = $this->pricesCreated();
        $this->assertCount(1, $prices);
        $this->assertSame('gbp', $prices[0]['currency']);
        $this->assertSame(4250, $prices[0]['unit_amount']);
        $this->assertSame('month', $prices[0]['recurring']['interval']);
        $this->assertSame('prod_existing', $prices[0]['product']);

        $newId = $this->column('stripe_price_id_monthly_gbp');
        $this->assertNotSame('price_old', $newId);
        $this->assertStringStartsWith('price_fake_', (string) $newId);
        // Nothing else moved.
        $this->assertSame('price_old_eur_monthly', $this->column('stripe_price_id_monthly'));
        $this->assertSame('price_old_gbp_yearly', $this->column('stripe_price_id_yearly_gbp'));
    }

    public function test_unchanged_amount_creates_nothing(): void
    {
        $this->update(['price_monthly_gbp' => 35, 'description' => 'New words'])->assertStatus(200);

        $this->assertSame([], $this->pricesCreated());
        $this->assertSame('price_old', $this->column('stripe_price_id_monthly_gbp'));
        $this->assertSame(0, DB::table('pay_plan_stripe_prices')->where('pay_plan_id', $this->planId)->count());
    }

    public function test_old_price_id_is_kept_as_retired(): void
    {
        $this->update(['price_monthly_gbp' => 42.50])->assertStatus(200);

        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old')->first();
        $this->assertNotNull($retired);
        $this->assertSame($this->planId, (int) $retired->pay_plan_id);
        $this->assertSame('gbp', $retired->currency);
        $this->assertSame('monthly', $retired->billing_interval);
        $this->assertEqualsWithDelta(35.0, (float) $retired->amount, 0.001);
        $this->assertNotNull($retired->retired_at);
        $this->assertSame(1, DB::table('pay_plan_stripe_prices')->where('pay_plan_id', $this->planId)->count());
    }

    public function test_retired_price_id_still_resolves_its_plan(): void
    {
        $this->update(['price_monthly_gbp' => 42.50])->assertStatus(200);

        $this->assertSame($this->planId, StripeSubscriptionService::planIdForStripePrice('price_old'));
        $this->assertSame($this->planId, StripeSubscriptionService::planIdForStripePrice((string) $this->column('stripe_price_id_monthly_gbp')));
        $this->assertNull(StripeSubscriptionService::planIdForStripePrice('price_nobody_has'));
    }

    public function test_stripe_failure_does_not_lose_the_old_price_id(): void
    {
        $this->stripe->failPrices = true;

        $response = $this->update(['price_monthly_gbp' => 42.50]);

        // Saved, the old id kept rather than lost, and the failure reported.
        $response->assertStatus(200);
        $this->assertEqualsWithDelta(42.50, (float) $response->json('data.price_monthly_gbp'), 0.001);
        $this->assertSame('price_old', $this->column('stripe_price_id_monthly_gbp'));
        $this->assertSame(0, DB::table('pay_plan_stripe_prices')->where('pay_plan_id', $this->planId)->count());
        $this->assertSame([['currency' => 'gbp', 'interval' => 'monthly']], $response->json('data.stripe_price_warnings'));

        // And the state is not stuck: the Sync button recovers it.
        $this->stripe->failPrices = false;
        $this->sync()->assertStatus(200);
        $this->assertNotSame('price_old', $this->column('stripe_price_id_monthly_gbp'));
        $this->assertSame(1, DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old')->count());
    }

    public function test_a_failed_replacement_is_reported_in_the_response(): void
    {
        $this->stripe->failPrices = true;

        $response = $this->update(['price_monthly_gbp' => 42.50, 'price_yearly' => 400]);

        $response->assertStatus(200);
        $this->assertSame([['currency' => 'gbp', 'interval' => 'monthly']], $response->json('data.stripe_price_warnings'));
        $this->assertEqualsWithDelta(42.50, (float) DB::table('pay_plans')->where('id', $this->planId)->value('price_monthly_gbp'), 0.001);
        $this->assertSame('price_old', $this->column('stripe_price_id_monthly_gbp'));
    }

    public function test_a_successful_save_reports_no_warnings(): void
    {
        $response = $this->update(['price_monthly_gbp' => 42.50]);

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data.stripe_price_warnings'));
    }

    public function test_sync_retries_a_replacement_that_failed(): void
    {
        $this->stripe->failPrices = true;
        $this->update(['price_monthly_gbp' => 42.50])->assertStatus(200);
        $this->stripe->failPrices = false;
        // Only what the sync sends counts; the failed attempt was recorded too.
        $this->stripe->requests = [];

        $response = $this->sync();

        $response->assertStatus(200);
        $this->assertTrue($response->json('data.synced'));
        $this->assertSame([
            'eur/monthly' => 'unchanged',
            'eur/yearly' => 'unchanged',
            'gbp/monthly' => 'replaced',
            'gbp/yearly' => 'unchanged',
        ], $this->outcomes($response));

        $newId = (string) $this->column('stripe_price_id_monthly_gbp');
        $this->assertNotSame('price_old', $newId);
        $this->assertSame($newId, $response->json('data.stripe_price_id_monthly_gbp'));
        $created = $this->pricesCreated();
        $this->assertCount(1, array_filter($created, static fn (array $p): bool => ($p['unit_amount'] ?? null) === 4250));
        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old')->first();
        $this->assertNotNull($retired);
        $this->assertEqualsWithDelta(35.0, (float) $retired->amount, 0.001);
    }

    public function test_sync_changes_nothing_when_stripe_already_matches(): void
    {
        $response = $this->sync();

        $response->assertStatus(200);
        $this->assertSame([
            'eur/monthly' => 'unchanged',
            'eur/yearly' => 'unchanged',
            'gbp/monthly' => 'unchanged',
            'gbp/yearly' => 'unchanged',
        ], $this->outcomes($response));
        $this->assertSame([], $this->pricesCreated());
        $this->assertSame(0, DB::table('pay_plan_stripe_prices')->where('pay_plan_id', $this->planId)->count());
    }

    public function test_a_price_taken_to_zero_retires_its_stripe_price(): void
    {
        $response = $this->update(['price_monthly' => 0]);

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data.stripe_price_warnings'));
        $this->assertNull($this->column('stripe_price_id_monthly'), 'checkout can no longer charge it');
        $this->assertSame([], $this->pricesCreated());
        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old_eur_monthly')->first();
        $this->assertNotNull($retired);
        $this->assertSame('eur', $retired->currency);
        $this->assertSame('monthly', $retired->billing_interval);
        $this->assertEqualsWithDelta(40.0, (float) $retired->amount, 0.001);
        // The yearly price is still sold.
        $this->assertSame('price_old_eur_yearly', $this->column('stripe_price_id_yearly'));
        // A retired price still names its plan.
        $this->assertSame($this->planId, StripeSubscriptionService::planIdForStripePrice('price_old_eur_monthly'));
    }

    public function test_sync_reports_failed_when_the_old_price_cannot_be_read(): void
    {
        // The plan's amount moved (as after a failed save), but Stripe cannot
        // say what the stored price charges: nothing may be guessed.
        DB::table('pay_plans')->where('id', $this->planId)->update(['price_monthly_gbp' => 42.50]);
        $this->stripe->failRetrieve = true;

        $response = $this->sync();

        $response->assertStatus(200);
        $this->assertSame('failed', $this->outcomes($response)['gbp/monthly']);
        $this->assertSame('price_old', $this->column('stripe_price_id_monthly_gbp'));
        $this->assertSame([], $this->pricesCreated());
        $this->assertSame(0, DB::table('pay_plan_stripe_prices')->where('pay_plan_id', $this->planId)->count());
    }

    public function test_a_price_taken_to_zero_is_retired_even_when_stripe_cannot_be_read(): void
    {
        $this->stripe->failRetrieve = true;

        $response = $this->update(['price_monthly_gbp' => 0]);

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data.stripe_price_warnings'));
        $this->assertNull($this->column('stripe_price_id_monthly_gbp'));
        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old')->first();
        $this->assertNotNull($retired);
        $this->assertEqualsWithDelta(0.0, (float) $retired->amount, 0.001);
    }

    public function test_a_price_taken_to_zero_is_retired_even_without_a_stripe_key(): void
    {
        // Retiring needs no Stripe call, so a missing key must not stop it.
        DB::table('pay_plans')->where('id', $this->planId)->update(['price_yearly' => 0]);
        config(['services.stripe.secret' => null]);

        StripeSubscriptionService::replacePlanPrice($this->planId, 'eur', 'yearly');

        $this->assertNull($this->column('stripe_price_id_yearly'));
        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old_eur_yearly')->first();
        $this->assertNotNull($retired);
        $this->assertEqualsWithDelta(0.0, (float) $retired->amount, 0.001);
        $this->assertSame([], $this->stripe->requests, 'no Stripe call was attempted');
    }

    public function test_retired_amount_is_read_from_stripe_not_from_the_caller(): void
    {
        // Stripe charges 33.00 on this price although the plan row said 35:
        // the retired record must say what the price actually charged.
        $this->stripe->priceAmounts['price_old'] = 3300;

        $this->update(['price_monthly_gbp' => 42.50])->assertStatus(200);

        $retired = DB::table('pay_plan_stripe_prices')->where('stripe_price_id', 'price_old')->first();
        $this->assertNotNull($retired);
        $this->assertEqualsWithDelta(33.0, (float) $retired->amount, 0.001);
    }
}
