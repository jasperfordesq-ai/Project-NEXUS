<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Smoke tests for AdminBillingController (Stripe subscription management).
 */
class AdminBillingControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_get_subscription_requires_auth(): void
    {
        $this->apiGet('/v2/admin/billing/subscription')->assertStatus(401);
    }

    public function test_get_subscription_rejects_non_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiGet('/v2/admin/billing/subscription')->assertStatus(403);
    }

    public function test_get_subscription_allows_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
        $response = $this->apiGet('/v2/admin/billing/subscription');
        $this->assertLessThan(500, $response->status());
    }

    public function test_get_invoices_requires_auth(): void
    {
        $this->apiGet('/v2/admin/billing/invoices')->assertStatus(401);
    }

    public function test_get_invoices_rejects_non_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiGet('/v2/admin/billing/invoices')->assertStatus(403);
    }

    public function test_create_checkout_requires_auth(): void
    {
        $this->apiPost('/v2/admin/billing/checkout', [])->assertStatus(401);
    }

    public function test_create_portal_requires_auth(): void
    {
        $this->apiPost('/v2/admin/billing/portal', [])->assertStatus(401);
    }

    public function test_get_plans_public_is_public(): void
    {
        // Public endpoint — no auth required
        $response = $this->apiGet('/v2/billing/plans');
        $this->assertLessThan(500, $response->status());
    }

    public function test_upgrade_request_requires_auth(): void
    {
        $this->apiPost('/v2/admin/billing/upgrade-request', [])->assertStatus(401);
    }

    public function test_upgrade_request_rejects_non_admin(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());
        $this->apiPost('/v2/admin/billing/upgrade-request', [])->assertStatus(403);
    }

    /**
     * Regression: this endpoint fataled on EVERY request because requestUpgrade()
     * called $this->getAuthUser() and $this->getInput(), neither of which exists
     * on BaseApiController (found 2026-08-28; same class of bug as getJsonInput()).
     *
     * The audit-log row is written AFTER the formerly-fatal lines, so asserting it
     * proves the handler executed past them — deliberately independent of whether
     * the notification email sends in this environment (an email failure is its
     * own, distinct 500 with code EMAIL_SEND_FAILED).
     */
    public function test_upgrade_request_executes_past_the_formerly_fatal_helper_calls(): void
    {
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());

        $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'More seats please']);

        $this->assertDatabaseHas('billing_audit_log', [
            'tenant_id' => $this->testTenantId,
            'action'    => 'upgrade_requested',
        ]);
    }
}
