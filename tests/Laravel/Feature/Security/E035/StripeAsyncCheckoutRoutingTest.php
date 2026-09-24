<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Core\TenantContext;
use App\Http\Controllers\Api\StripeWebhookController;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-035 F-178 follow-up. Tenant billing activates only on a PAID checkout, so a
 * delayed payment method (completed unpaid, confirmed later) must still activate
 * the plan when its "async payment succeeded" session reaches the handler.
 * The handler is exercised directly; signature checking is covered elsewhere.
 */
class StripeAsyncCheckoutRoutingTest extends TestCase
{
    use DatabaseTransactions;

    private int $billingTenantId;
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

        $slug = 'e035-async-' . uniqid();
        $this->billingTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'E-035 Async Billing', 'slug' => $slug, 'domain' => $slug . '.example.test',
            'is_active' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]);
        User::factory()->forTenant($this->billingTenantId)->create([
            'role' => 'admin', 'status' => 'active', 'is_approved' => true,
            'email' => 'e035-async-admin-' . uniqid('', true) . '@example.test', 'preferred_language' => 'en',
        ]);
        $this->planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'E-035 async plan', 'slug' => 'e035-async-' . uniqid(),
            'tier_level' => 1, 'price_monthly' => 10, 'price_yearly' => 100, 'is_active' => 1,
            'stripe_price_id_monthly' => 'price_e035_async_' . uniqid(),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    protected function tearDown(): void
    {
        TenantContext::setById($this->testTenantId);
        parent::tearDown();
    }

    private function checkoutSession(string $subId, array $meta): object
    {
        return (object) [
            'id' => 'cs_e035_' . uniqid(),
            'payment_status' => 'paid',
            'subscription' => $subId,
            'metadata' => (object) $meta,
        ];
    }

    private function callHandler(object $session): void
    {
        $method = new \ReflectionMethod(StripeWebhookController::class, 'handleCheckoutAsyncPaymentSucceeded');
        $method->setAccessible(true);
        $method->invoke(app(StripeWebhookController::class), $session);
    }

    public function test_async_payment_succeeded_activates_tenant_billing(): void
    {
        $subId = 'sub_e035_async_' . uniqid();
        $this->callHandler($this->checkoutSession($subId, [
            'nexus_tenant_id' => (string) $this->billingTenantId,
            'nexus_plan_id' => (string) $this->planId,
        ]));

        $row = DB::table('tenant_plan_assignments')->where('tenant_id', $this->billingTenantId)->first();
        $this->assertNotNull($row, 'A delayed-payment checkout must still create the plan assignment.');
        $this->assertSame('active', $row->status);
        $this->assertSame($subId, $row->stripe_subscription_id);
    }

    public function test_marketplace_async_session_is_left_to_the_marketplace_flow(): void
    {
        $this->callHandler($this->checkoutSession('sub_e035_mkt_' . uniqid(), [
            'nexus_type' => 'marketplace',
            'nexus_tenant_id' => (string) $this->billingTenantId,
            'nexus_plan_id' => (string) $this->planId,
        ]));

        $this->assertSame(0, DB::table('tenant_plan_assignments')->where('tenant_id', $this->billingTenantId)->count());
    }

    public function test_dispatcher_routes_the_async_event(): void
    {
        $source = (string) file_get_contents(app_path('Http/Controllers/Api/StripeWebhookController.php'));
        $this->assertStringContainsString(
            "'checkout.session.async_payment_succeeded' => \$this->handleCheckoutAsyncPaymentSucceeded(",
            $source
        );
    }
}
