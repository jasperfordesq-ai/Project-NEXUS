<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\EmailDispatchService;
use App\Services\StripeSubscriptionService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;
use Mockery;

/**
 * @covers \App\Services\StripeSubscriptionService
 */
class StripeSubscriptionServiceTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
    }

    // =========================================================================
    // syncPlanToStripe
    // =========================================================================

    public function test_syncPlanToStripe_returnsEarlyWhenPlanNotFound(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with("SELECT * FROM pay_plans WHERE id = ?", [999])
            ->andReturnNull();

        Log::shouldReceive('warning')->once()->with(
            'StripeSubscriptionService::syncPlanToStripe — plan not found',
            Mockery::on(fn ($ctx) => $ctx['plan_id'] === 999)
        );

        StripeSubscriptionService::syncPlanToStripe(999);
    }

    // =========================================================================
    // handleCheckoutCompleted
    // =========================================================================

    public function test_handleCheckoutCompleted_skipsWhenMissingNexusMetadata(): void
    {
        Log::shouldReceive('warning')->once()->with(
            'Stripe checkout.session.completed missing nexus metadata',
            Mockery::type('array')
        );

        $session = (object) [
            'id' => 'cs_test_123',
            'metadata' => (object) [
                'nexus_tenant_id' => 0,
                'nexus_plan_id' => 0,
            ],
            'subscription' => 'sub_test_123',
        ];

        StripeSubscriptionService::handleCheckoutCompleted($session);
    }

    /**
     * After activating the assignment, the service now also fetches the plan
     * name and sends a required admin confirmation email
     * (sendRequiredTenantAdminEmail → sendTenantAdminEmail). The test must mock
     * that follow-up path: the `pay_plans` name lookup, the admin user lookup,
     * and the static EmailDispatchService::sendRaw (alias mock → separate
     * process). If the email send returns false the service throws, so we make
     * it return true.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_handleCheckoutCompleted_insertsNewAssignmentWhenNoneExists(): void
    {
        $session = (object) [
            'id' => 'cs_test_456',
            'metadata' => (object) [
                'nexus_tenant_id' => '2',
                'nexus_plan_id' => '5',
            ],
            'subscription' => 'sub_test_456',
            'payment_status' => 'paid',
        ];

        DB::shouldReceive('transaction')->once()->andReturnUsing(function ($callback) {
            return $callback();
        });

        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                "SELECT id, status, stripe_subscription_id FROM tenant_plan_assignments WHERE tenant_id = ?",
                [2]
            )
            ->andReturnNull();

        DB::shouldReceive('insert')->once()->andReturn(true);

        $this->mockActivationEmailPath(5, 'Pro');

        Log::shouldReceive('warning')->zeroOrMoreTimes();
        Log::shouldReceive('info')->once()->with(
            'Stripe checkout completed — subscription activated',
            Mockery::type('array')
        );

        StripeSubscriptionService::handleCheckoutCompleted($session);
    }

    /**
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_handleCheckoutCompleted_updatesExistingAssignment(): void
    {
        $session = (object) [
            'id' => 'cs_test_789',
            'metadata' => (object) [
                'nexus_tenant_id' => '2',
                'nexus_plan_id' => '3',
            ],
            'subscription' => 'sub_test_789',
            'payment_status' => 'paid',
        ];

        DB::shouldReceive('transaction')->once()->andReturnUsing(function ($callback) {
            return $callback();
        });

        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                "SELECT id, status, stripe_subscription_id FROM tenant_plan_assignments WHERE tenant_id = ?",
                [2]
            )
            ->andReturn((object) ['id' => 10, 'status' => 'active', 'stripe_subscription_id' => 'sub_old']);

        DB::shouldReceive('update')->once()->andReturn(1);

        $this->mockActivationEmailPath(3, 'Team');

        Log::shouldReceive('warning')->zeroOrMoreTimes();
        Log::shouldReceive('info')->once();

        StripeSubscriptionService::handleCheckoutCompleted($session);
    }

    /**
     * Mock the post-activation confirmation-email path so handleCheckoutCompleted
     * completes without hitting a real DB/mailer:
     *   - SELECT name FROM pay_plans WHERE id = ?  → plan row
     *   - DB::table('users')…->first()             → an admin recipient
     *   - EmailDispatchService::sendRaw(...)        → true (success, no throw)
     */
    private function mockActivationEmailPath(int $planId, string $planName): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with("SELECT name FROM pay_plans WHERE id = ?", [$planId])
            ->andReturn((object) ['name' => $planName]);

        $this->mockAdminEmailDbPath();
    }

    /**
     * Mock the admin-email DB + mailer path shared by every Stripe webhook
     * handler that sends a required confirmation email (no pay_plans lookup):
     *   - DB::table('tenants')…->first()  → tenant 2 (for TenantContext::setById)
     *   - DB::table('users')…->first()    → an admin recipient
     *   - EmailDispatchService::sendRaw() → true (success, no throw)
     */
    private function mockAdminEmailDbPath(): void
    {
        $admin = (object) [
            'email' => 'admin@example.test',
            'first_name' => 'Admin',
            'name' => 'Admin User',
            'preferred_language' => 'en',
        ];

        // TenantContext::setById(2) → fetchTenant() → DB::table('tenants')->where('id',2)->first()
        $tenantRow = (object) [
            'id' => 2,
            'name' => 'Test Tenant',
            'slug' => 'hour-timebank',
            'is_active' => 1,
        ];

        $usersBuilder = Mockery::mock();
        $usersBuilder->shouldReceive('where')->andReturnSelf();
        $usersBuilder->shouldReceive('whereNotNull')->andReturnSelf();
        $usersBuilder->shouldReceive('select')->andReturnSelf();
        $usersBuilder->shouldReceive('first')->andReturn($admin);

        $tenantsBuilder = Mockery::mock();
        $tenantsBuilder->shouldReceive('where')->andReturnSelf();
        $tenantsBuilder->shouldReceive('first')->andReturn($tenantRow);

        DB::shouldReceive('table')->with('users')->andReturn($usersBuilder);
        DB::shouldReceive('table')->with('tenants')->andReturn($tenantsBuilder);

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->andReturn(true);
    }

    // =========================================================================
    // handleSubscriptionUpdated
    // =========================================================================

    public function test_handleSubscriptionUpdated_skipsWhenNoSubscriptionId(): void
    {
        $subscription = (object) ['id' => null];

        // Should return early without any DB calls — no exception = success
        StripeSubscriptionService::handleSubscriptionUpdated($subscription);

        $this->addToAssertionCount(1); // Confirm early return without error
    }

    public function test_handleSubscriptionUpdated_skipsWhenNoMatchingAssignment(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                "SELECT id, tenant_id, pay_plan_id, status FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
                ['sub_unknown']
            )
            ->andReturnNull();

        Log::shouldReceive('info')->once();

        $subscription = (object) [
            'id' => 'sub_unknown',
            'status' => 'active',
            'current_period_end' => time() + 86400,
        ];

        StripeSubscriptionService::handleSubscriptionUpdated($subscription);
    }

    public function test_handleSubscriptionUpdated_mapsStripeCancelledToNexusCancelled(): void
    {
        $assignment = (object) ['id' => 7, 'tenant_id' => 2, 'pay_plan_id' => 3, 'status' => 'active'];

        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                "SELECT id, tenant_id, pay_plan_id, status FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
                ['sub_cancelled']
            )
            ->andReturn($assignment);

        DB::shouldReceive('update')->once()->with(
            Mockery::on(fn ($sql) => str_contains($sql, 'SET status = ?')),
            Mockery::on(function ($params) {
                // Stripe 'canceled' maps to nexus 'cancelled'
                return $params[0] === 'cancelled';
            })
        )->andReturn(1);

        Log::shouldReceive('info')->once();

        $subscription = (object) [
            'id' => 'sub_cancelled',
            'status' => 'canceled',
            'current_period_end' => time(),
        ];

        StripeSubscriptionService::handleSubscriptionUpdated($subscription);
    }

    // =========================================================================
    // handleSubscriptionDeleted
    // =========================================================================

    public function test_handleSubscriptionDeleted_skipsWhenNoId(): void
    {
        $subscription = (object) ['id' => null];

        // Should return early — no DB interaction
        StripeSubscriptionService::handleSubscriptionDeleted($subscription);

        $this->addToAssertionCount(1); // Confirm early return without error
    }

    /**
     * After marking the assignment cancelled, the service now also sends a
     * required admin "subscription cancelled" email (no pay_plans lookup). The
     * test mocks that follow-up path. Alias mock → separate process.
     *
     * @runInSeparateProcess
     * @preserveGlobalState disabled
     */
    public function test_handleSubscriptionDeleted_marksCancelled(): void
    {
        $assignment = (object) ['id' => 8, 'tenant_id' => 2];

        DB::shouldReceive('selectOne')
            ->once()
            ->with(
                "SELECT id, tenant_id FROM tenant_plan_assignments WHERE stripe_subscription_id = ?",
                ['sub_del_test']
            )
            ->andReturn($assignment);

        DB::shouldReceive('update')->once()->with(
            Mockery::on(fn ($sql) => str_contains($sql, "status = 'cancelled'")),
            [8]
        )->andReturn(1);

        $this->mockAdminEmailDbPath();

        Log::shouldReceive('info')->once();
        Log::shouldReceive('warning')->zeroOrMoreTimes();

        $subscription = (object) ['id' => 'sub_del_test'];

        StripeSubscriptionService::handleSubscriptionDeleted($subscription);
    }

    // =========================================================================
    // getSubscriptionDetails
    // =========================================================================

    public function test_getSubscriptionDetails_returnsNullWhenNoAssignment(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturnNull();

        $result = StripeSubscriptionService::getSubscriptionDetails(999);

        $this->assertNull($result);
    }

    public function test_getSubscriptionDetails_returnsArrayOnSuccess(): void
    {
        $row = (object) [
            'id' => 1,
            'tenant_id' => 2,
            'pay_plan_id' => 3,
            'status' => 'active',
            'starts_at' => '2026-01-01',
            'expires_at' => null,
            'trial_ends_at' => null,
            'stripe_subscription_id' => 'sub_123',
            'stripe_current_period_end' => '2026-02-01',
            'created_at' => '2026-01-01',
            'updated_at' => '2026-01-01',
            'plan_name' => 'Pro',
            'plan_slug' => 'pro',
            'plan_tier_level' => 2,
            'plan_description' => 'Pro plan',
            'price_monthly' => 29.99,
            'price_yearly' => 299.99,
        ];

        DB::shouldReceive('selectOne')->once()->andReturn($row);

        $result = StripeSubscriptionService::getSubscriptionDetails(2);

        $this->assertIsArray($result);
        $this->assertEquals('active', $result['status']);
        $this->assertEquals('Pro', $result['plan_name']);
        $this->assertEquals('sub_123', $result['stripe_subscription_id']);
    }

    // =========================================================================
    // createPortalSession — validation
    // =========================================================================

    public function test_createPortalSession_throwsWhenTenantNotFound(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with("SELECT id, stripe_customer_id FROM tenants WHERE id = ?", [999])
            ->andReturnNull();

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Tenant 999 not found');

        StripeSubscriptionService::createPortalSession(999);
    }

    public function test_createPortalSession_throwsWhenNoStripeCustomer(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->with("SELECT id, stripe_customer_id FROM tenants WHERE id = ?", [2])
            ->andReturn((object) ['id' => 2, 'stripe_customer_id' => null]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('has no Stripe customer');

        StripeSubscriptionService::createPortalSession(2);
    }

    // =========================================================================
    // handleInvoicePaymentFailed
    // =========================================================================

    public function test_handleInvoicePaymentFailed_logsWarningWithoutSubscription(): void
    {
        Log::shouldReceive('warning')->once()->with(
            'Stripe invoice payment failed',
            Mockery::on(function ($ctx) {
                return $ctx['invoice_id'] === 'in_test_fail'
                    && $ctx['subscription_id'] === null;
            })
        );

        $invoice = (object) [
            'id' => 'in_test_fail',
            'subscription' => null,
            'customer' => 'cus_test',
            'amount_due' => 2999,
        ];

        StripeSubscriptionService::handleInvoicePaymentFailed($invoice);
    }
}
