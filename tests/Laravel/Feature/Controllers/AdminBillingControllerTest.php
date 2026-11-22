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

    /**
     * "Message the platform team" had no limit: a script, or a stuck button,
     * could mail every member of the platform team as often as it liked.
     * Three an hour for a community, whoever in it is sending.
     */
    public function test_a_community_can_message_the_platform_team_only_a_few_times_an_hour(): void
    {
        \Illuminate\Support\Facades\RateLimiter::clear('billing-message:' . $this->testTenantId);
        app()->instance(\App\Services\EmailDispatchService::class, new class extends \App\Services\EmailDispatchService {
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                return true;
            }
        });
        // Somebody on the platform team to receive it.
        User::factory()->forTenant(1)->create(['is_god' => true, 'is_super_admin' => true, 'status' => 'active', 'email' => 'limit.team.' . uniqid() . '@example.com']);
        $sent = fn (): int => \Illuminate\Support\Facades\DB::table('billing_audit_log')
            ->where('tenant_id', $this->testTenantId)->where('action', 'upgrade_requested')->count();
        $before = $sent();

        try {
            // Two different admins of the same community share the limit.
            Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
            $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'One'])->assertStatus(200);
            $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'Two'])->assertStatus(200);
            Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->admin()->create());
            $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'Three'])->assertStatus(200);

            $refused = $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'Four']);
            $refused->assertStatus(429);
            $this->assertSame('TOO_MANY_MESSAGES', $refused->json('errors.0.code'));
            $this->assertStringNotContainsString('api.', (string) $refused->json('errors.0.message'));
            $this->assertSame($before + 3, $sent(), 'A refused message is not recorded or sent.');

            // An hour on, it may write again.
            \Carbon\Carbon::setTestNow(now()->addMinutes(61));
            $this->apiPost('/v2/admin/billing/upgrade-request', ['message' => 'Later'])->assertStatus(200);
            $this->assertSame($before + 4, $sent());
        } finally {
            \Carbon\Carbon::setTestNow();
            \Illuminate\Support\Facades\RateLimiter::clear('billing-message:' . $this->testTenantId);
        }
    }
}
