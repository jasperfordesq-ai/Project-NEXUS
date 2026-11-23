<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Card checkout is for a community that pays the platform.
 *
 * A community that pays its parent pays its hub, not the platform by card.
 * Before Stage 3 its admin could still call the checkout endpoint (the screen
 * was hidden, the endpoint was not) and put the community on any default
 * plan, including one its hub has hidden.
 *
 * Also: a plan that is not sold for the chosen period is refused with a
 * clear message, where it used to end in a generic "checkout failed".
 */
final class CheckoutRefusedForParentPayerTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;
    use MakesBillingCommunities;

    private int $hub;
    private int $child;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();

        $this->hub = $this->makeCommunity('Checkout hub', 1, '/1/', true);
        $this->child = $this->makeCommunity('Checkout child', $this->hub, "/1/{$this->hub}/");

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
        } finally {
            parent::tearDown();
        }
    }

    private function asAdminOf(int $tenantId): void
    {
        $this->testTenantId = $tenantId;
        $user = User::factory()->forTenant($tenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($tenantId);
    }

    public function test_a_community_that_pays_its_parent_cannot_check_out_by_card(): void
    {
        $local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        $this->asAdminOf($this->child);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $local, 'billing_interval' => 'monthly']);

        $response->assertStatus(422);
        $this->assertSame('PAYS_PARENT', $response->json('errors.0.code'));
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'));
        $this->assertSame(0, DB::table('tenant_plan_assignments')->where('tenant_id', $this->child)->count());
        $this->assertSame([], $this->stripe->requests, 'Stripe is never called.');
    }

    public function test_the_refusal_comes_before_anything_else_is_checked(): void
    {
        $this->asAdminOf($this->child);

        $response = $this->apiPost('/v2/admin/billing/checkout', []);

        $response->assertStatus(422);
        $this->assertSame('PAYS_PARENT', $response->json('errors.0.code'));
    }

    /** @return array<string, array{0: string, 1: array<string, float>}> */
    public static function unsoldPeriods(): array
    {
        return [
            'monthly, sold only yearly' => ['monthly', ['price_monthly' => 0, 'price_yearly' => 900]],
            'yearly, sold only monthly' => ['yearly', ['price_monthly' => 90, 'price_yearly' => 0]],
        ];
    }

    /** @param array<string, float> $prices */
    #[\PHPUnit\Framework\Attributes\DataProvider('unsoldPeriods')]
    public function test_a_period_the_plan_is_not_sold_for_is_refused_clearly(string $interval, array $prices): void
    {
        $planId = (int) DB::table('pay_plans')->insertGetId(array_merge([
            'name' => 'One period plan',
            'slug' => 'one-period-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            // Card checkout sells the standard plans only.
            'is_standard' => 1,
            'tier_level' => 3,
            'created_at' => now(),
        ], $prices));
        $this->asAdminOf($this->hub);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $planId, 'billing_interval' => $interval]);

        $response->assertStatus(422);
        $this->assertSame('VALIDATION_ERROR', $response->json('errors.0.code'));
        $this->assertSame('billing_interval', $response->json('errors.0.field'));
        $this->assertStringContainsString($interval === 'monthly' ? 'monthly' : 'yearly', (string) $response->json('errors.0.message'));
        $this->assertSame([], $this->stripe->requests, 'Refused before Stripe is called.');
    }

    public function test_a_pound_community_is_checked_against_the_price_it_would_be_charged(): void
    {
        $pounds = $this->makeCommunity('Checkout pound community', 1, '/1/');
        DB::table('tenant_settings')->insert([
            'tenant_id' => $pounds, 'setting_key' => 'general.default_currency', 'setting_value' => 'GBP',
        ]);
        // No pound or euro yearly price at all: nothing to charge yearly.
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Pound monthly plan',
            'slug' => 'pound-monthly-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            // Card checkout sells the standard plans only.
            'is_standard' => 1,
            'tier_level' => 3,
            'price_monthly' => 100,
            'price_yearly' => 0,
            'price_monthly_gbp' => 90,
            'price_yearly_gbp' => null,
            'created_at' => now(),
        ]);
        $this->asAdminOf($pounds);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $planId, 'billing_interval' => 'yearly']);

        $response->assertStatus(422);
        $this->assertSame('billing_interval', $response->json('errors.0.field'));
        $this->assertSame([], $this->stripe->requests);
    }

    public function test_a_plan_priced_only_in_pounds_is_not_activated_as_free(): void
    {
        // Euro prices 0, pound prices set: something is charged, so checkout
        // goes to Stripe instead of activating the plan directly.
        $pounds = $this->makeCommunity('Checkout pound-only community', 1, '/1/');
        DB::table('tenants')->where('id', $pounds)->update(['stripe_customer_id' => 'cus_fake_pounds']);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $pounds, 'setting_key' => 'general.default_currency', 'setting_value' => 'GBP',
        ]);
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Pound only plan',
            'slug' => 'pound-only-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            // Card checkout sells the standard plans only.
            'is_standard' => 1,
            'tier_level' => 3,
            'price_monthly' => 0,
            'price_yearly' => 0,
            'price_monthly_gbp' => 90,
            'price_yearly_gbp' => 900,
            'created_at' => now(),
        ]);
        $this->asAdminOf($pounds);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $planId, 'billing_interval' => 'monthly']);

        $this->assertNotTrue($response->json('data.activated'), $response->getContent());
        $this->assertSame(0, DB::table('tenant_plan_assignments')->where('tenant_id', $pounds)->where('pay_plan_id', $planId)->where('status', 'active')->count(), 'Not activated without Stripe.');
    }

    public function test_a_plan_with_nothing_charged_in_either_currency_is_still_activated_directly(): void
    {
        $community = $this->makeCommunity('Checkout free community', 1, '/1/');
        // A Stripe customer already on record, so the fake Stripe is asked nothing it does not know.
        DB::table('tenants')->where('id', $community)->update(['stripe_customer_id' => 'cus_fake_free']);
        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Free plan',
            'slug' => 'free-both-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            // Card checkout sells the standard plans only.
            'is_standard' => 1,
            'tier_level' => 0,
            'price_monthly' => 0,
            'price_yearly' => 0,
            'price_monthly_gbp' => null,
            'price_yearly_gbp' => 0,
            'created_at' => now(),
        ]);
        $this->asAdminOf($community);

        $response = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $planId, 'billing_interval' => 'monthly']);

        $response->assertStatus(200);
        $this->assertTrue($response->json('data.activated'));
        $this->assertSame(1, DB::table('tenant_plan_assignments')->where('tenant_id', $community)->where('pay_plan_id', $planId)->where('status', 'active')->count());
    }
}
