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
use App\Support\Billing\BillingLock;
use App\Support\Billing\PlanTerms;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A community that pays by card changes plan by changing the card
 * subscription it already has (POST /v2/admin/billing/change-plan), never by
 * starting another one.
 *
 * Decision 8 made for the owner (DECISIONS-FOR-THE-OWNER.md): the change
 * happens at once and Stripe puts the difference for the rest of the period on
 * the next invoice. No setup fee is added.
 *
 * No real Stripe call: FakesStripeHttp answers from memory.
 */
final class ChangeCardPlanTest extends TestCase
{
    use DatabaseTransactions;
    use FakesStripeHttp;

    private int $community;
    private int $spark;
    private int $local;
    private int $record;

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

        $this->community = (int) DB::table('tenants')->insertGetId([
            'name' => 'Change plan community', 'slug' => 'change-plan-' . bin2hex(random_bytes(5)),
            'is_active' => 1, 'parent_id' => 1, 'stripe_customer_id' => 'cus_change_' . bin2hex(random_bytes(5)),
            'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $this->community)->update(['path' => "/1/{$this->community}/"]);
        DB::table('tenant_settings')->insert([
            'tenant_id' => $this->community, 'setting_key' => 'general.default_currency', 'setting_value' => 'gbp',
        ]);

        $this->spark = (int) DB::table('pay_plans')->where('slug', 'spark')->value('id');
        $this->local = (int) DB::table('pay_plans')->where('slug', 'local')->value('id');
        DB::table('pay_plans')->where('id', $this->spark)->update(['is_active' => 1, 'max_users' => 100, 'price_monthly_gbp' => 150, 'price_yearly_gbp' => 1500]);
        DB::table('pay_plans')->where('id', $this->local)->update([
            'is_active' => 1, 'max_users' => 300, 'price_monthly_gbp' => 199, 'price_yearly_gbp' => 1990, 'setup_fee_gbp' => 645,
            'stripe_product_id' => 'prod_local', 'stripe_price_id_monthly_gbp' => 'price_local_month_gbp', 'stripe_price_id_yearly_gbp' => 'price_local_year_gbp',
        ]);

        $this->record = (int) DB::table('tenant_plan_assignments')->insertGetId([
            'tenant_id' => $this->community, 'pay_plan_id' => $this->spark, 'status' => 'active',
            'stripe_subscription_id' => 'sub_change_1', 'stripe_status' => 'active', 'billing_interval' => 'monthly',
            'starts_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->stripe->subscription = [
            'status' => 'active', 'currency' => 'gbp',
            'items' => ['object' => 'list', 'data' => [['id' => 'si_change_1', 'price' => ['id' => 'price_spark_month_gbp', 'currency' => 'gbp']]]],
        ];

        BillingLock::flush();
        PlanTerms::flush();

        $this->testTenantId = $this->community;
        Sanctum::actingAs(User::factory()->forTenant($this->community)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]), ['*']);
        TenantContext::setById($this->community);
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

    private function row(): object
    {
        return DB::table('tenant_plan_assignments')->where('id', $this->record)->first();
    }

    public function test_the_existing_subscription_is_changed_and_no_second_one_is_started(): void
    {
        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local]);

        $response->assertOk();
        $this->assertSame($this->local, $response->json('data.plan_id'));
        $this->assertSame('monthly', $response->json('data.billing_interval'), 'the period it already pays by is kept');

        $updates = $this->subscriptionUpdates();
        $this->assertCount(1, $updates);
        $this->assertSame('sub_change_1', $updates[0]['id'], 'the subscription it already has');
        $this->assertSame('si_change_1', $updates[0]['params']['items'][0]['id'], 'its one item is repriced, not a second added');
        $this->assertSame('price_local_month_gbp', $updates[0]['params']['items'][0]['price']);
        $this->assertSame('create_prorations', $updates[0]['params']['proration_behavior']);
        $this->assertSame([], $this->checkoutSessionsCreated(), 'no checkout: that would be a second subscription');

        // The record shows the new plan at once, on the same subscription.
        $this->assertSame($this->local, (int) $this->row()->pay_plan_id);
        $this->assertSame('sub_change_1', $this->row()->stripe_subscription_id);
        $this->assertSame('active', $this->row()->status);
        $this->assertSame(1, DB::table('tenant_plan_assignments')->where('tenant_id', $this->community)->count());
    }

    public function test_no_setup_fee_is_added_on_a_change_of_plan(): void
    {
        $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local])->assertOk();

        $params = $this->subscriptionUpdates()[0]['params'];
        $this->assertCount(1, $params['items']);
        $this->assertArrayNotHasKey('add_invoice_items', $params);
        $this->assertNull(DB::table('tenant_billing_standing')->where('tenant_id', $this->community)->value('setup_fee_paid_at'));
    }

    public function test_the_period_can_be_changed_on_the_same_plan(): void
    {
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update(['pay_plan_id' => $this->local]);

        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local, 'billing_interval' => 'yearly']);

        $response->assertOk();
        $this->assertSame('price_local_year_gbp', $this->subscriptionUpdates()[0]['params']['items'][0]['price']);
        $this->assertSame('yearly', $this->row()->billing_interval);
    }

    public function test_the_same_plan_and_period_is_refused_and_stripe_is_not_changed(): void
    {
        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->spark]);

        $response->assertStatus(422);
        $this->assertSame('SAME_PLAN', $response->json('errors.0.code'));
        $this->assertSame([], $this->subscriptionUpdates());
    }

    public function test_a_community_with_no_card_subscription_is_sent_to_checkout(): void
    {
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update(['stripe_subscription_id' => null, 'stripe_status' => null]);

        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local]);

        $response->assertStatus(422);
        $this->assertSame('NO_CARD_SUBSCRIPTION', $response->json('errors.0.code'));
        $this->assertStringNotContainsString('api.', (string) $response->json('errors.0.message'));
    }

    public function test_a_failed_card_must_be_put_right_before_the_plan_is_changed(): void
    {
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update(['status' => 'expired', 'stripe_status' => 'past_due']);

        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local]);

        $response->assertStatus(422);
        $this->assertSame('CARD_NEEDS_ATTENTION', $response->json('errors.0.code'));
        $this->assertSame([], $this->subscriptionUpdates());
        $this->assertSame($this->spark, (int) $this->row()->pay_plan_id);
    }

    public function test_the_checkout_refusals_apply_to_a_change_too(): void
    {
        // Not a standard plan.
        $bespoke = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Bespoke', 'slug' => 'bespoke-' . bin2hex(random_bytes(4)), 'tier_level' => 1,
            'price_monthly' => 5, 'price_yearly' => 50, 'is_active' => 1, 'is_standard' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $bespoke])->assertStatus(422);

        // A specially agreed price.
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update(['discount_percentage' => 20]);
        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local]);
        $response->assertStatus(422);
        $this->assertSame('SPECIAL_PRICE', $response->json('errors.0.code'));

        $this->assertSame([], $this->subscriptionUpdates());
    }

    public function test_a_plan_the_community_has_outgrown_cannot_be_changed_to(): void
    {
        DB::table('tenant_plan_assignments')->where('id', $this->record)->update(['pay_plan_id' => $this->local]);
        DB::table('pay_plans')->where('id', $this->spark)->update(['max_users' => 2]);
        for ($i = 0; $i < 3; $i++) {
            $uid = bin2hex(random_bytes(6));
            DB::table('users')->insert([
                'tenant_id' => $this->community, 'name' => 'Member ' . $uid, 'first_name' => 'Member', 'last_name' => 'Test',
                'email' => $uid . '@example.test', 'status' => 'active', 'role' => 'member', 'balance' => 0, 'is_approved' => 1,
                'last_login_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->spark]);

        $response->assertStatus(422);
        $this->assertSame('PLAN_TOO_SMALL', $response->json('errors.0.code'));
        $this->assertSame([], $this->subscriptionUpdates());
    }

    public function test_a_subscription_in_another_currency_is_not_repriced(): void
    {
        // Stripe keeps a subscription in the currency it started in.
        $this->stripe->subscription['currency'] = 'eur';

        $response = $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local]);

        $response->assertStatus(422);
        $this->assertSame('CHANGE_REFUSED', $response->json('errors.0.code'));
        $this->assertSame([], $this->subscriptionUpdates());
        $this->assertSame($this->spark, (int) $this->row()->pay_plan_id);
    }

    public function test_it_needs_an_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->community)->create(['status' => 'active', 'is_approved' => true, 'role' => 'member']), ['*']);

        $this->apiPost('/v2/admin/billing/change-plan', ['plan_id' => $this->local])->assertStatus(403);
        $this->assertSame([], $this->subscriptionUpdates());
    }
}
