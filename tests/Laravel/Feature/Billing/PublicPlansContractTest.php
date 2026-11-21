<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Support\Billing\BillingLock;
use App\Support\Billing\StandardPlans;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * GET /v2/billing/plans as the plan picker reads it
 * (react-frontend/src/admin/modules/billing/PlanSelector.tsx, type `Plan` in
 * react-frontend/src/admin/api/billingApi.ts).
 *
 * Nothing pinned this response before 21 November 2026, and the picker's own
 * test passed on invented data. Three faults lived in that gap: every price
 * was shown in euro even to a community Stripe charges in pounds; a plan did
 * not say how many members it allows; and the one-off setup fee was shown
 * nowhere a payer looks. Rename a key here and it must be renamed in
 * billingApi.ts in the same commit.
 */
final class PublicPlansContractTest extends TestCase
{
    use DatabaseTransactions;

    private const KEYS = [
        'id', 'name', 'slug', 'description', 'tier_level', 'features', 'max_users',
        'price_monthly', 'price_yearly', 'setup_fee',
        'price_monthly_gbp', 'price_yearly_gbp', 'setup_fee_gbp',
        'max_communities', 'storage_gb', 'emails_per_month', 'is_active', 'charge',
    ];

    protected function setUp(): void
    {
        parent::setUp();
        BillingLock::flush();

        // Only the seven standard packages are on offer, as first written:
        // another test's plan must not take a tier's place in the list.
        DB::table('pay_plans')->where('is_standard', 0)->update(['is_active' => 0]);
        foreach (StandardPlans::TIERS as $slug => $tier) {
            DB::table('pay_plans')->where('slug', $slug)->where('is_standard', 1)->update([
                'is_active' => 1,
                'name' => $tier['name'],
                'description' => $tier['description'],
                'features' => json_encode(StandardPlans::features($slug)),
                'tier_level' => $tier['tier_level'],
                'max_users' => $tier['max_users'],
                'price_monthly' => $tier['price_monthly'],
                'price_yearly' => $tier['price_yearly'],
                'setup_fee' => $tier['setup_fee'],
                'price_monthly_gbp' => $tier['price_monthly_gbp'],
                'price_yearly_gbp' => $tier['price_yearly_gbp'],
                'setup_fee_gbp' => $tier['setup_fee_gbp'],
                'max_communities' => $tier['max_communities'],
                'storage_gb' => $tier['storage_gb'],
                'emails_per_month' => $tier['emails_per_month'],
            ]);
        }
    }

    protected function tearDown(): void
    {
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $currency): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Plan picker community',
            'slug' => 'picker-' . bin2hex(random_bytes(5)),
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

    /** @return array<string, array<string, mixed>> the plans by slug */
    private function plansFor(int $tenantId): array
    {
        $this->withTenant($tenantId);
        $response = $this->apiGet('/v2/billing/plans');
        $response->assertOk();

        $plans = [];
        foreach ($response->json('data') as $plan) {
            $plans[$plan['slug']] = $plan;
        }

        return $plans;
    }

    public function test_every_plan_carries_exactly_the_keys_the_picker_reads(): void
    {
        $plans = $this->plansFor($this->makeCommunity('eur'));

        $this->assertSame(StandardPlans::slugs(), array_keys($plans), 'the seven packages, smallest first');
        foreach ($plans as $slug => $plan) {
            $this->assertSame(self::KEYS, array_keys($plan), "{$slug} keys");
            $this->assertSame(['monthly', 'yearly'], array_keys($plan['charge']), "{$slug} charge periods");
            foreach ($plan['charge'] as $period => $charge) {
                $this->assertSame(['currency', 'amount', 'setup_fee'], array_keys($charge), "{$slug} {$period} charge keys");
            }
        }
    }

    public function test_a_plan_says_how_many_members_it_allows_and_what_it_includes(): void
    {
        $local = $this->plansFor($this->makeCommunity('eur'))['local'];

        $this->assertSame(300, $local['max_users']);
        $this->assertSame(1, $local['max_communities']);
        $this->assertSame(10, $local['storage_gb']);
        $this->assertSame(20000, $local['emails_per_month']);
        $this->assertSame(StandardPlans::TIERS['local']['description'], $local['description']);
        $this->assertStringStartsWith('101 to 300 active members.', $local['description']);
        $this->assertSame(StandardPlans::features('local'), $local['features']);
        $this->assertNotSame([], $local['features']);
    }

    public function test_money_arrives_as_numbers_in_both_currencies_with_the_setup_fee(): void
    {
        $local = $this->plansFor($this->makeCommunity('eur'))['local'];

        // Numbers, never the database's "229.00" strings: the picker compares
        // and adds them.
        $this->assertSame(229.0, (float) $local['price_monthly']);
        $this->assertIsNotString($local['price_monthly']);
        $this->assertSame(2290.0, (float) $local['price_yearly']);
        $this->assertSame(750.0, (float) $local['setup_fee']);
        $this->assertIsNotString($local['setup_fee']);
        $this->assertSame(199.0, (float) $local['price_monthly_gbp']);
        $this->assertSame(1990.0, (float) $local['price_yearly_gbp']);
        $this->assertSame(645.0, (float) $local['setup_fee_gbp']);
    }

    public function test_a_euro_community_is_quoted_euro(): void
    {
        $local = $this->plansFor($this->makeCommunity('eur'))['local'];

        $this->assertSame('eur', $local['charge']['monthly']['currency']);
        $this->assertSame(229.0, (float) $local['charge']['monthly']['amount']);
        $this->assertSame(750.0, (float) $local['charge']['monthly']['setup_fee']);
        $this->assertSame('eur', $local['charge']['yearly']['currency']);
        $this->assertSame(2290.0, (float) $local['charge']['yearly']['amount']);
    }

    public function test_a_pound_community_is_quoted_what_stripe_will_charge_it_in_pounds(): void
    {
        $plans = $this->plansFor($this->makeCommunity('gbp'));

        // The fault: the picker said "€229.00" and the card was charged £199.
        $this->assertSame('gbp', $plans['local']['charge']['monthly']['currency']);
        $this->assertSame(199.0, (float) $plans['local']['charge']['monthly']['amount']);
        $this->assertSame(645.0, (float) $plans['local']['charge']['monthly']['setup_fee']);
        $this->assertSame('gbp', $plans['local']['charge']['yearly']['currency']);
        $this->assertSame(1990.0, (float) $plans['local']['charge']['yearly']['amount']);
        $this->assertSame(645.0, (float) $plans['local']['charge']['yearly']['setup_fee']);

        // Spark has no setup fee in either currency.
        $this->assertSame(150.0, (float) $plans['spark']['charge']['monthly']['amount']);
        $this->assertSame(0.0, (float) $plans['spark']['charge']['monthly']['setup_fee']);
    }

    public function test_a_plan_with_no_pound_price_is_quoted_in_euro_even_to_a_pound_community(): void
    {
        // Checkout charges such a plan in euro at its euro amount
        // (StripeSubscriptionService::chargeCurrency()); the quote must agree.
        DB::table('pay_plans')->where('slug', 'local')->update([
            'price_monthly_gbp' => null,
            'price_yearly_gbp' => null,
            'setup_fee_gbp' => null,
        ]);

        $local = $this->plansFor($this->makeCommunity('gbp'))['local'];

        $this->assertSame('eur', $local['charge']['monthly']['currency']);
        $this->assertSame(229.0, (float) $local['charge']['monthly']['amount']);
        $this->assertSame(750.0, (float) $local['charge']['monthly']['setup_fee']);
        $this->assertNull($local['price_monthly_gbp']);
        $this->assertNull($local['setup_fee_gbp']);
    }

    public function test_a_withdrawn_plan_is_not_listed(): void
    {
        DB::table('pay_plans')->where('slug', 'network')->update(['is_active' => 0]);

        $this->assertArrayNotHasKey('network', $this->plansFor($this->makeCommunity('eur')));
    }
}
