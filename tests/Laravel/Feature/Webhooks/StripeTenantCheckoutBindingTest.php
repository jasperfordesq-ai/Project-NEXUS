<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Webhooks;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-289 — a paid tenant-plan checkout must activate the plan for the community
 * that OWNS the Stripe customer that paid, resolved from our own row (as
 * MarketplacePaymentService does for payment intents), not for whichever
 * community the event's metadata names.
 */
final class StripeTenantCheckoutBindingTest extends TestCase
{
    use DatabaseTransactions;

    private int $payerTenantId;
    private int $otherTenantId;
    private string $payerCustomerId;
    private int $planId;

    protected function setUp(): void
    {
        parent::setUp();

        app()->instance(EmailDispatchService::class, new class extends EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });

        $this->payerCustomerId = 'cus_f289_' . uniqid();
        $this->payerTenantId = $this->tenant($this->payerCustomerId);
        $this->otherTenantId = $this->tenant('cus_f289_other_' . uniqid());
        $this->planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'F-289 plan', 'slug' => 'f289-plan-' . uniqid(), 'tier_level' => 1,
            'price_monthly' => 10, 'price_yearly' => 100, 'is_active' => 1,
            'stripe_price_id_monthly' => 'price_f289_' . uniqid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        TenantContext::setById($this->testTenantId);
        parent::tearDown();
    }

    private function tenant(string $customerId): int
    {
        $slug = 'f289-' . uniqid();
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'F-289 ' . $slug, 'slug' => $slug, 'domain' => $slug . '.example.test',
            'is_active' => 1, 'stripe_customer_id' => $customerId,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        User::factory()->forTenant($id)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
            'email' => 'f289-admin-' . uniqid('', true) . '@example.test', 'preferred_language' => 'en',
        ]);

        return $id;
    }

    private function checkoutSession(string $customerId, int $metadataTenantId, int $planId): object
    {
        return (object) [
            'id' => 'cs_f289_' . uniqid(),
            'payment_status' => 'paid',
            'customer' => $customerId,
            'subscription' => 'sub_f289_' . uniqid(),
            'metadata' => (object) [
                'nexus_tenant_id' => (string) $metadataTenantId,
                'nexus_plan_id' => (string) $planId,
            ],
        ];
    }

    private function assignment(int $tenantId): ?object
    {
        return DB::table('tenant_plan_assignments')->where('tenant_id', $tenantId)->first();
    }

    public function test_metadata_naming_another_community_does_not_activate_its_plan(): void
    {
        StripeSubscriptionService::handleCheckoutCompleted(
            $this->checkoutSession($this->payerCustomerId, $this->otherTenantId, $this->planId),
        );

        $this->assertNull($this->assignment($this->otherTenantId), 'a community that did not pay must not get the plan');
        $this->assertNull($this->assignment($this->payerTenantId), 'a mismatched event is refused outright');
    }

    public function test_a_customer_no_community_owns_activates_nothing(): void
    {
        StripeSubscriptionService::handleCheckoutCompleted(
            $this->checkoutSession('cus_f289_foreign_' . uniqid(), $this->otherTenantId, $this->planId),
        );

        $this->assertNull($this->assignment($this->otherTenantId));
    }

    public function test_a_plan_that_does_not_exist_is_not_assigned(): void
    {
        $missingPlan = (int) DB::table('pay_plans')->max('id') + 1000;

        StripeSubscriptionService::handleCheckoutCompleted(
            $this->checkoutSession($this->payerCustomerId, $this->payerTenantId, $missingPlan),
        );

        $this->assertNull($this->assignment($this->payerTenantId));
    }

    public function test_the_paying_community_gets_its_plan(): void
    {
        $session = $this->checkoutSession($this->payerCustomerId, $this->payerTenantId, $this->planId);

        StripeSubscriptionService::handleCheckoutCompleted($session);

        $row = $this->assignment($this->payerTenantId);
        $this->assertNotNull($row);
        $this->assertSame('active', $row->status);
        $this->assertSame($this->planId, (int) $row->pay_plan_id);
        $this->assertSame($session->subscription, $row->stripe_subscription_id);
    }
}
