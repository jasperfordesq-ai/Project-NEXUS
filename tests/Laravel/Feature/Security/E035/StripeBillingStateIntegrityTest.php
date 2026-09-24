<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\MemberPremiumService;
use App\Services\StripeSubscriptionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-178 (E-035): the local billing record could drift from what Stripe says.
 *  - a plan/tier change made in the Stripe billing portal never reached pay_plan_id / tier_id;
 *  - `incomplete` and `past_due` were recorded as `active`;
 *  - a checkout that had not been paid activated the plan;
 *  - a late event resurrected a cancelled subscription;
 *  - an inactive (withdrawn) plan could be checked out.
 * Each case below is a crafted webhook payload (signature checking is upstream
 * and unchanged) or a checkout request.
 */
class StripeBillingStateIntegrityTest extends TestCase
{
    use DatabaseTransactions;

    private int $billingTenantId;
    private int $planA;
    private int $planB;

    protected function setUp(): void
    {
        parent::setUp();

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        $slug = 'f178-billing-' . uniqid();
        $this->billingTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F-178 Billing Tenant', 'slug' => $slug, 'domain' => $slug . '.example.test',
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        User::factory()->forTenant($this->billingTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
            'email' => 'f178-admin-' . uniqid('', true) . '@example.test', 'preferred_language' => 'en',
        ]);

        $this->planA = $this->plan('A', 'price_f178_a_' . uniqid());
        $this->planB = $this->plan('B', 'price_f178_b_' . uniqid());
    }

    protected function tearDown(): void
    {
        TenantContext::setById($this->testTenantId);
        parent::tearDown();
    }

    private function plan(string $name, string $monthlyPriceId, bool $active = true): int
    {
        return (int) DB::table('pay_plans')->insertGetId([
            'name' => 'F-178 plan ' . $name, 'slug' => 'f178-' . strtolower($name) . '-' . uniqid(),
            'tier_level' => 1, 'price_monthly' => 10, 'price_yearly' => 100, 'is_active' => $active ? 1 : 0,
            'stripe_price_id_monthly' => $monthlyPriceId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function priceOf(int $planId): string
    {
        return (string) DB::table('pay_plans')->where('id', $planId)->value('stripe_price_id_monthly');
    }

    private function assignment(string $status, int $planId, string $subId): void
    {
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->billingTenantId, 'pay_plan_id' => $planId, 'status' => $status,
            'starts_at' => now(), 'stripe_subscription_id' => $subId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function row(): ?object
    {
        return DB::table('tenant_plan_assignments')->where('tenant_id', $this->billingTenantId)->first();
    }

    private function subscriptionEvent(string $subId, string $status, string $priceId): object
    {
        return (object) [
            'id' => $subId,
            'status' => $status,
            'current_period_end' => time() + 86400 * 30,
            'items' => (object) ['data' => [(object) ['price' => (object) ['id' => $priceId]]]],
        ];
    }

    private function checkoutSession(string $subId, string $paymentStatus): object
    {
        return (object) [
            'id' => 'cs_f178_' . uniqid(),
            'payment_status' => $paymentStatus,
            'subscription' => $subId,
            'metadata' => (object) [
                'nexus_tenant_id' => (string) $this->billingTenantId,
                'nexus_plan_id' => (string) $this->planA,
            ],
        ];
    }

    // ── Tenant billing ──────────────────────────────────────────────────────

    public function test_portal_plan_change_is_reflected_from_the_price_id(): void
    {
        $subId = 'sub_f178_' . uniqid();
        $this->assignment('active', $this->planA, $subId);

        StripeSubscriptionService::handleSubscriptionUpdated($this->subscriptionEvent($subId, 'active', $this->priceOf($this->planB)));

        $this->assertSame($this->planB, (int) $this->row()->pay_plan_id);
        $this->assertSame('active', $this->row()->status);
    }

    public function test_incomplete_and_past_due_are_not_recorded_as_active(): void
    {
        foreach (['incomplete', 'past_due'] as $stripeStatus) {
            DB::table('tenant_plan_assignments')->where('tenant_id', $this->billingTenantId)->delete();
            $subId = 'sub_f178_' . uniqid();
            $this->assignment('active', $this->planA, $subId);

            StripeSubscriptionService::handleSubscriptionUpdated($this->subscriptionEvent($subId, $stripeStatus, $this->priceOf($this->planA)));

            $this->assertNotSame('active', $this->row()->status, "Stripe '$stripeStatus' was recorded as active");
        }
    }

    public function test_late_update_does_not_resurrect_a_cancelled_subscription(): void
    {
        $subId = 'sub_f178_' . uniqid();
        $this->assignment('cancelled', $this->planA, $subId);

        StripeSubscriptionService::handleSubscriptionUpdated($this->subscriptionEvent($subId, 'active', $this->priceOf($this->planA)));

        $this->assertSame('cancelled', $this->row()->status);
    }

    public function test_unpaid_checkout_does_not_activate_a_plan(): void
    {
        StripeSubscriptionService::handleCheckoutCompleted($this->checkoutSession('sub_f178_' . uniqid(), 'unpaid'));

        $row = $this->row();
        $this->assertTrue($row === null || $row->status !== 'active', 'unpaid checkout activated the plan');
    }

    public function test_late_checkout_does_not_resurrect_a_cancelled_subscription(): void
    {
        $subId = 'sub_f178_' . uniqid();
        $this->assignment('cancelled', $this->planA, $subId);

        StripeSubscriptionService::handleCheckoutCompleted($this->checkoutSession($subId, 'paid'));

        $this->assertSame('cancelled', $this->row()->status);
    }

    public function test_control_paid_checkout_activates(): void
    {
        $subId = 'sub_f178_' . uniqid();
        StripeSubscriptionService::handleCheckoutCompleted($this->checkoutSession($subId, 'paid'));

        $this->assertSame('active', $this->row()->status);
        $this->assertSame($subId, $this->row()->stripe_subscription_id);
    }

    public function test_inactive_plan_cannot_be_checked_out(): void
    {
        $inactiveFree = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'F-178 withdrawn free', 'slug' => 'f178-withdrawn-' . uniqid(), 'tier_level' => 9,
            'max_users' => null, 'price_monthly' => 0, 'price_yearly' => 0, 'is_active' => 0,
            'created_at' => now(), 'updated_at' => now(),
        ]);

        TenantContext::setById($this->testTenantId);
        $before = DB::table('tenant_plan_assignments')->where('tenant_id', $this->testTenantId)->first();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $r = $this->apiPost('/v2/admin/billing/checkout', ['plan_id' => $inactiveFree, 'billing_interval' => 'monthly']);
        $this->assertSame(422, $r->getStatusCode(), (string) $r->getContent());
        $after = DB::table('tenant_plan_assignments')->where('tenant_id', $this->testTenantId)->first();
        $this->assertEquals($before, $after, 'inactive plan changed the assignment');

        // The service refuses it too, before any Stripe call.
        try {
            StripeSubscriptionService::createCheckoutSession($this->testTenantId, $inactiveFree, 'monthly');
            $this->fail('inactive plan was accepted by the service');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('not available', $e->getMessage());
        }
        $this->assertEquals($before, DB::table('tenant_plan_assignments')->where('tenant_id', $this->testTenantId)->first());
    }

    // ── Member premium ──────────────────────────────────────────────────────

    private function tier(string $slug, string $monthlyPriceId): int
    {
        return (int) DB::table('member_premium_tiers')->insertGetId([
            'tenant_id' => $this->testTenantId, 'slug' => 'f178-' . $slug . '-' . uniqid(), 'name' => 'F-178 ' . $slug,
            'monthly_price_cents' => 500, 'yearly_price_cents' => 5000,
            'stripe_price_id_monthly' => $monthlyPriceId, 'is_active' => 1,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function memberMeta(int $userId, int $tierId): object
    {
        return (object) [
            'nexus_kind' => 'member_premium', 'nexus_user_id' => (string) $userId,
            'nexus_tenant_id' => (string) $this->testTenantId, 'nexus_tier_id' => (string) $tierId,
            'nexus_interval' => 'monthly',
        ];
    }

    private function memberEvent(string $type, object $object): object
    {
        return (object) ['id' => 'evt_f178_' . uniqid(), 'type' => $type, 'data' => (object) ['object' => $object]];
    }

    private function memberSub(string $subId, int $userId, int $tierId, string $status): void
    {
        DB::table('member_subscriptions')->insert([
            'user_id' => $userId, 'tenant_id' => $this->testTenantId, 'tier_id' => $tierId,
            'stripe_subscription_id' => $subId, 'status' => $status, 'billing_interval' => 'monthly',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public function test_member_tier_follows_the_subscription_price_not_metadata(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $basic = $this->tier('basic', 'price_f178_basic_' . uniqid());
        $plusPrice = 'price_f178_plus_' . uniqid();
        $plus = $this->tier('plus', $plusPrice);
        $subId = 'sub_f178_m_' . uniqid();
        $this->memberSub($subId, (int) $member->id, $basic, 'active');

        MemberPremiumService::applyWebhookEvent($this->memberEvent('customer.subscription.updated', (object) [
            'id' => $subId, 'status' => 'active', 'customer' => 'cus_f178',
            'metadata' => $this->memberMeta((int) $member->id, $basic),
            'items' => (object) ['data' => [(object) ['price' => (object) ['id' => $plusPrice]]]],
        ]));

        $this->assertSame($plus, (int) DB::table('member_subscriptions')->where('stripe_subscription_id', $subId)->value('tier_id'));
    }

    public function test_member_unpaid_checkout_is_not_active(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $tier = $this->tier('basic', 'price_f178_basic_' . uniqid());
        $subId = 'sub_f178_m_' . uniqid();

        MemberPremiumService::applyWebhookEvent($this->memberEvent('checkout.session.completed', (object) [
            'id' => 'cs_f178_' . uniqid(), 'payment_status' => 'unpaid', 'subscription' => $subId,
            'customer' => 'cus_f178', 'metadata' => $this->memberMeta((int) $member->id, $tier),
        ]));

        $status = DB::table('member_subscriptions')->where('stripe_subscription_id', $subId)->value('status');
        $this->assertNotSame('active', $status);
    }

    public function test_member_late_events_do_not_resurrect_a_cancelled_subscription(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $tier = $this->tier('basic', 'price_f178_basic_' . uniqid());
        $subId = 'sub_f178_m_' . uniqid();
        $this->memberSub($subId, (int) $member->id, $tier, 'canceled');

        MemberPremiumService::applyWebhookEvent($this->memberEvent('checkout.session.completed', (object) [
            'id' => 'cs_f178_' . uniqid(), 'payment_status' => 'paid', 'subscription' => $subId,
            'customer' => 'cus_f178', 'metadata' => $this->memberMeta((int) $member->id, $tier),
        ]));
        MemberPremiumService::applyWebhookEvent($this->memberEvent('customer.subscription.updated', (object) [
            'id' => $subId, 'status' => 'active', 'customer' => 'cus_f178',
            'metadata' => $this->memberMeta((int) $member->id, $tier),
        ]));

        $this->assertSame('canceled', DB::table('member_subscriptions')->where('stripe_subscription_id', $subId)->value('status'));
    }
}
