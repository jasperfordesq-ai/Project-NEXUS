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
use Tests\Laravel\Concerns\ActsAsAccessTiers;
use Tests\Laravel\TestCase;

/**
 * Smaller faults from the billing audit of 21 November 2026:
 *
 *  - a plan sync that failed part-way left a second product and a second set
 *    of prices in Stripe on the next try;
 *  - deleting a plan with an ended plan record behind it answered with a
 *    server error, and a successful delete left its hub terms behind;
 *  - a hub's pound price of 0 was read as "not sold in pounds";
 *  - a request for an upgrade went to one person's own email address.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class BillingLooseEndsTest extends TestCase
{
    use ActsAsAccessTiers;
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->installFakeStripe();
        BillingLock::flush();
        PlanTerms::flush();

        $this->plan = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Loose ends plan', 'slug' => 'loose-ends-' . bin2hex(random_bytes(4)), 'tier_level' => 9,
            'price_monthly' => 40, 'price_yearly' => 400, 'price_monthly_gbp' => 35, 'price_yearly_gbp' => 350,
            'max_users' => 100, 'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        try {
            $this->uninstallFakeStripe();
            BillingLock::flush();
            PlanTerms::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function community(): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Loose ends community', 'slug' => 'loose-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        return $id;
    }

    /** @return list<array{method:string, path:string}> */
    private function sent(string $method, string $path): array
    {
        return array_values(array_filter(
            $this->stripe->requests,
            static fn (array $r): bool => $r['method'] === $method && $r['path'] === $path
        ));
    }

    // ── a sync that fails part-way ──────────────────────────────────────────

    public function test_a_sync_that_fails_after_creating_the_product_does_not_make_a_second_product_next_time(): void
    {
        $this->stripe->failPrices = true;
        try {
            StripeSubscriptionService::syncPlanToStripe($this->plan);
            $this->fail('The sync was expected to fail while prices cannot be created.');
        } catch (\Throwable) {
            // Expected: Stripe refused the first price.
        }

        $product = DB::table('pay_plans')->where('id', $this->plan)->value('stripe_product_id');
        $this->assertNotNull($product, 'the product Stripe did create is remembered');

        $this->stripe->failPrices = false;
        StripeSubscriptionService::syncPlanToStripe($this->plan);

        $this->assertCount(1, $this->sent('POST', '/v1/products'), 'one product in Stripe, not two');
        $this->assertSame($product, DB::table('pay_plans')->where('id', $this->plan)->value('stripe_product_id'));
        $row = DB::table('pay_plans')->where('id', $this->plan)->first();
        $this->assertNotNull($row->stripe_price_id_monthly);
        $this->assertNotNull($row->stripe_price_id_yearly_gbp);
        // Four prices in all (two currencies, two periods), each created once.
        $created = array_filter($this->sent('POST', '/v1/prices'), static fn (): bool => true);
        $this->assertCount(4 + 1, $created, 'the one refused try, then one per currency and period');
    }

    // ── deleting a plan ─────────────────────────────────────────────────────

    public function test_a_plan_a_community_was_once_on_cannot_be_deleted_and_says_why(): void
    {
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->community(), 'pay_plan_id' => $this->plan, 'status' => 'cancelled',
            'starts_at' => now()->subYear(), 'created_at' => now()->subYear(), 'updated_at' => now(),
        ]);
        $this->actAsPlatformTeam();

        $response = $this->apiDelete("/v2/admin/plans/{$this->plan}");

        $response->assertStatus(422);
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'));
        $this->assertTrue(DB::table('pay_plans')->where('id', $this->plan)->exists());
    }

    public function test_deleting_an_unused_plan_takes_its_hub_terms_with_it(): void
    {
        $hub = $this->community();
        DB::table('hub_plan_terms')->insert([
            'hub_tenant_id' => $hub, 'pay_plan_id' => $this->plan, 'name' => 'Hub name', 'is_offered' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->actAsPlatformTeam();

        $this->apiDelete("/v2/admin/plans/{$this->plan}")->assertStatus(200);

        $this->assertFalse(DB::table('pay_plans')->where('id', $this->plan)->exists());
        $this->assertSame(0, DB::table('hub_plan_terms')->where('pay_plan_id', $this->plan)->count());
    }

    // ── a hub's pound price of nothing ──────────────────────────────────────

    public function test_a_hubs_pound_price_of_zero_is_quoted_in_pounds_and_no_pound_price_falls_back_to_euro(): void
    {
        $inCurrency = new \ReflectionMethod(PlanTerms::class, 'inCurrency');
        $inCurrency->setAccessible(true);
        $values = [
            'name' => 'Hub plan', 'description' => null, 'max_users' => 100,
            'price_monthly' => 40.0, 'price_yearly' => 400.0, 'setup_fee' => 0.0,
            'price_monthly_gbp' => 0.0, 'price_yearly_gbp' => 0.0, 'setup_fee_gbp' => 0.0,
        ];

        $free = $inCurrency->invoke(null, 1, 'hub-plan', true, $values, 5, 'gbp');
        $this->assertSame('gbp', $free['currency'], 'a hub that charges nothing in pounds is not quoted in euro');
        $this->assertSame(0.0, (float) $free['price_monthly']);

        $noPounds = ['price_monthly_gbp' => null, 'price_yearly_gbp' => null, 'setup_fee_gbp' => null] + $values;
        $fallback = $inCurrency->invoke(null, 1, 'hub-plan', true, $noPounds, 5, 'gbp');
        $this->assertSame('eur', $fallback['currency']);
        $this->assertSame(40.0, (float) $fallback['price_monthly']);

        // The platform's own plans keep the card rule: no pound amount to
        // charge means the card is charged in euro, so that is what is quoted.
        $platform = $inCurrency->invoke(null, 1, 'hub-plan', true, $values, null, 'gbp');
        $this->assertSame('eur', $platform['currency']);
    }

    // ── who an upgrade request goes to ──────────────────────────────────────

    public function test_an_upgrade_request_goes_to_the_platform_team_not_to_one_address_in_the_code(): void
    {
        $mail = new class extends EmailDispatchService {
            /** @var list<string> */
            public array $to = [];

            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->to[] = $to;

                return true;
            }
        };
        app()->instance(EmailDispatchService::class, $mail);

        $teamEmail = 'team-' . bin2hex(random_bytes(5)) . '@example.test';
        User::factory()->forTenant(1)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
            'is_god' => 1, 'is_super_admin' => 1, 'email' => $teamEmail,
        ]);

        $community = $this->community();
        $this->testTenantId = $community;
        Sanctum::actingAs(User::factory()->forTenant($community)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]), ['*']);
        TenantContext::setById($community);

        $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => str_repeat('More members, please. ', 400)])->assertOk();

        $this->assertContains($teamEmail, $mail->to);
        $this->assertNotContains('jasper@hour-timebank.ie', array_diff($mail->to, DB::table('users')->where('is_god', 1)->pluck('email')->all()));
        $stored = (string) DB::table('billing_audit_log')->where('tenant_id', $community)->where('action', 'upgrade_requested')->value('new_value');
        $this->assertLessThanOrEqual(2000, mb_strlen((string) (json_decode($stored, true)['message'] ?? '')), 'a note of a size a person would write');
    }
}
