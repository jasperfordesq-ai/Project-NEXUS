<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * How the website learns a community is paused (a flag on the tenant
 * bootstrap) and how that community's admins learn why (their own endpoint).
 */
final class BillingPausedFlagTest extends TestCase
{
    use DatabaseTransactions;

    private int $parent;
    private int $child;
    private string $parentName;

    protected function setUp(): void
    {
        parent::setUp();

        $this->parentName = 'Flag parent ' . bin2hex(random_bytes(3));
        $this->parent = $this->makeCommunity($this->parentName, 1, '/1/');
        $this->child = $this->makeCommunity('Flag child', $this->parent, "/1/{$this->parent}/");

        BillingLock::flush();
    }

    protected function tearDown(): void
    {
        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name, int $parentId, string $parentPath): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'flag-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => $parentId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "{$parentPath}{$id}/"]);

        return $id;
    }

    /** @param array<string, mixed> $attributes */
    private function signInTo(int $tenantId, array $attributes = []): User
    {
        $this->testTenantId = $tenantId;

        $user = User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $attributes));
        Sanctum::actingAs($user, ['*']);
        TenantContext::setById($tenantId);

        return $user;
    }

    private function bootstrapFor(int $tenantId): \Illuminate\Testing\TestResponse
    {
        $this->testTenantId = $tenantId;
        TenantContext::setById($tenantId);

        return $this->apiGet('/v2/tenant/bootstrap');
    }

    public function test_bootstrap_says_not_paused_by_default(): void
    {
        $response = $this->bootstrapFor($this->child);

        $response->assertStatus(200);
        $this->assertFalse($response->json('data.billing_paused'));
    }

    public function test_bootstrap_says_paused_after_a_suspension_even_when_cached(): void
    {
        // First call builds and caches the payload.
        $this->assertFalse($this->bootstrapFor($this->child)->json('data.billing_paused'));

        BillingStandingService::suspend($this->child, null, 'manual');
        $this->assertTrue($this->bootstrapFor($this->child)->json('data.billing_paused'));

        BillingStandingService::restore($this->child, null);
        $this->assertFalse($this->bootstrapFor($this->child)->json('data.billing_paused'));
    }

    public function test_bootstrap_says_paused_for_a_child_of_a_paused_parent(): void
    {
        BillingStandingService::suspend($this->parent, null, 'auto');

        $this->assertTrue($this->bootstrapFor($this->child)->json('data.billing_paused'));
    }

    /**
     * Every page of every community's website starts with the bootstrap. If
     * the payment-standing check cannot run, the bootstrap must still answer
     * (as "not paused", with the failure logged) — an outage of this check
     * must not take every community's website down.
     * (Found by the Stage 1 review, 20 Nov 2026.)
     */
    public function test_bootstrap_still_answers_when_the_standing_check_cannot_run(): void
    {
        // Make the check itself throw, without touching the schema (a DDL
        // statement would commit this test's transaction): the cached list of
        // suspended communities is replaced by one that fails when it is read.
        $unreadable = new class implements \ArrayAccess {
            public function offsetExists(mixed $offset): bool
            {
                throw new \RuntimeException('standing list unreadable');
            }

            public function offsetGet(mixed $offset): mixed
            {
                throw new \RuntimeException('standing list unreadable');
            }

            public function offsetSet(mixed $offset, mixed $value): void
            {
            }

            public function offsetUnset(mixed $offset): void
            {
            }
        };
        Cache::put(BillingLock::CACHE_KEY, ['suspended' => $unreadable, 'exempt' => []], 60);

        // The precondition this test rests on: asked directly, the check throws.
        try {
            BillingLock::isLocked($this->child);
            $this->fail('The check was expected to throw for this test to mean anything.');
        } catch (\RuntimeException $e) {
            $this->assertSame('standing list unreadable', $e->getMessage());
        }

        $response = $this->bootstrapFor($this->child);

        $response->assertStatus(200);
        $this->assertFalse($response->json('data.billing_paused'));
    }

    public function test_admin_standing_is_quiet_for_an_open_community(): void
    {
        $this->signInTo($this->child, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/billing/standing');

        $response->assertStatus(200);
        $this->assertSame(
            [
                'paused' => false, 'own' => null, 'since' => null, 'payee' => null, 'payee_name' => null, 'payer' => 'parent',
                // Stage 3c: the warnings an open community's admins see before
                // anything is paused. Nothing to say here: no date, no package.
                'overdue_days' => null, 'member_limit' => null,
            ],
            $response->json('data')
        );
    }

    /**
     * `payer` tells the admin panel whether to offer the community's own
     * billing page: only a community that pays the platform by card has
     * anything to do there (Stage 5).
     */
    public function test_admin_standing_says_who_an_open_community_pays(): void
    {
        $this->signInTo($this->parent, ['role' => 'admin']);
        $this->assertSame('platform_invoice', $this->apiGet('/v2/admin/billing/standing')->json('data.payer'));

        $planId = (int) DB::table('pay_plans')->insertGetId([
            'name' => 'Flag card plan',
            'slug' => 'flag-card-' . bin2hex(random_bytes(4)),
            'price_monthly' => 10,
            'price_yearly' => 100,
            'created_at' => now(),
        ]);
        DB::table('tenant_plan_assignments')->insert([
            'tenant_id' => $this->parent,
            'pay_plan_id' => $planId,
            'status' => 'active',
            'stripe_subscription_id' => 'sub_flag_' . bin2hex(random_bytes(6)),
        ]);

        $this->assertSame('platform_card', $this->apiGet('/v2/admin/billing/standing')->json('data.payer'));
    }

    public function test_admin_standing_says_who_a_paused_community_pays(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child, ['role' => 'admin']);

        $this->assertSame('parent', $this->apiGet('/v2/admin/billing/standing')->json('data.payer'));
    }

    public function test_admin_standing_names_the_parent_for_a_child(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual', 'private note about the debt');
        $this->signInTo($this->child, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/billing/standing');

        $response->assertStatus(200);
        $this->assertTrue($response->json('data.paused'));
        $this->assertTrue($response->json('data.own'));
        $this->assertSame('parent', $response->json('data.payee'));
        $this->assertSame($this->parentName, $response->json('data.payee_name'));
        $this->assertNotEmpty($response->json('data.since'));
    }

    public function test_admin_standing_says_platform_for_a_community_directly_under_it(): void
    {
        BillingStandingService::suspend($this->parent, null, 'manual');
        $this->signInTo($this->parent, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/billing/standing');

        $this->assertTrue($response->json('data.own'));
        $this->assertSame('platform', $response->json('data.payee'));
        $this->assertNull($response->json('data.payee_name'));
    }

    public function test_admin_standing_for_a_lock_from_above_names_nobody(): void
    {
        BillingStandingService::suspend($this->parent, null, 'manual');
        $this->signInTo($this->child, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/billing/standing');

        $this->assertTrue($response->json('data.paused'));
        $this->assertFalse($response->json('data.own'));
        $this->assertNull($response->json('data.payee'));
        $this->assertNull($response->json('data.payee_name'));
    }

    public function test_admin_standing_hides_the_note(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual', 'private note about the debt');
        $this->signInTo($this->child, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/billing/standing');

        $this->assertSame(['paused', 'own', 'since', 'payee', 'payee_name', 'payer', 'overdue_days', 'member_limit'], array_keys($response->json('data')));
        $this->assertStringNotContainsString('private note', $response->getContent());
    }

    public function test_admin_standing_refuses_a_member(): void
    {
        $this->signInTo($this->child);

        $this->apiGet('/v2/admin/billing/standing')->assertStatus(403);
    }
}
