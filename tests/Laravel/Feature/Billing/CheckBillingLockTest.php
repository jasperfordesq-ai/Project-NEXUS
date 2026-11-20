<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Http\Middleware\CheckBillingLock;
use App\Models\User;
use App\Services\BillingStandingService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * A community paused for non-payment: its member side is closed to everyone,
 * its admin side and the sign-in pages stay open.
 *
 * These go through the real HTTP stack, because the thing being proved is
 * where the middleware sits and which addresses it lets past.
 */
final class CheckBillingLockTest extends TestCase
{
    use DatabaseTransactions;

    private int $parent;
    private int $child;

    protected function setUp(): void
    {
        parent::setUp();

        $this->parent = $this->makeCommunity('Paused parent', 1, '/1/');
        $this->child = $this->makeCommunity('Paused child', $this->parent, "/1/{$this->parent}/");

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
            'slug' => 'paused-' . bin2hex(random_bytes(5)),
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

    public function test_member_api_is_closed_for_a_paused_community(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child);

        $response = $this->apiGet('/v2/listings');

        $response->assertStatus(403);
        $response->assertJsonPath('code', CheckBillingLock::CODE);
        $response->assertJsonPath('success', false);
        $this->assertSame('COMMUNITY_PAUSED', CheckBillingLock::CODE);
    }

    public function test_admin_api_stays_open_for_a_paused_community(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child, ['role' => 'admin']);

        $response = $this->apiGet('/v2/admin/users');

        $this->assertNotSame(CheckBillingLock::CODE, $response->json('code'));
        $response->assertStatus(200);
    }

    public function test_a_flag_only_admin_reaches_the_admin_api(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child, ['role' => 'member', 'is_tenant_super_admin' => true]);

        $response = $this->apiGet('/v2/admin/users');

        $this->assertNotSame(CheckBillingLock::CODE, $response->json('code'));
        $response->assertStatus(200);
    }

    public function test_sign_in_bootstrap_and_who_am_i_stay_open(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child);

        $bootstrap = $this->apiGet('/v2/tenant/bootstrap');
        $this->assertNotSame(CheckBillingLock::CODE, $bootstrap->json('code'));
        $bootstrap->assertStatus(200);

        $me = $this->apiGet('/v2/users/me');
        $this->assertNotSame(CheckBillingLock::CODE, $me->json('code'));
        $me->assertStatus(200);

        $login = $this->apiPost('/auth/login', ['email' => 'nobody@example.org', 'password' => 'wrong-password']);
        $this->assertNotSame(CheckBillingLock::CODE, $login->json('code'));
        $this->assertNotSame(403, $login->getStatusCode());
    }

    /**
     * Found by opening the sign-in page of a paused community in a browser
     * (20 Nov 2026): the page asks for a CSRF token and for the community's
     * sign-in options before anyone has typed anything, and all three were
     * refused. An admin who cannot sign in cannot find out why the community
     * is paused, which is the one thing the lock promises them.
     */
    public function test_everything_the_sign_in_page_calls_stays_open(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->testTenantId = $this->child;
        TenantContext::setById($this->child);

        $calls = [
            ['GET', '/csrf-token'],
            ['GET', '/v2/csrf-token'],
            ['GET', '/auth/csrf-token'],
            ['GET', '/v2/auth/sso/providers?tenant_id=' . $this->child],
            ['GET', '/v2/auth/oauth/enabled-providers'],
            ['POST', '/v2/auth/2fa/verify'],
            ['POST', '/totp/verify'],
            ['POST', '/webauthn/auth-challenge'],
            ['POST', '/auth/forgot-password'],
        ];

        foreach ($calls as [$method, $uri]) {
            $response = $method === 'GET' ? $this->apiGet($uri) : $this->apiPost($uri, []);

            $this->assertNotSame(
                CheckBillingLock::CODE,
                $response->json('code'),
                "{$method} {$uri} is part of signing in and must stay open for a paused community"
            );
        }
    }

    public function test_signing_up_to_a_paused_community_is_closed(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->testTenantId = $this->child;
        TenantContext::setById($this->child);

        $response = $this->apiPost('/v2/auth/register', [
            'email' => 'newcomer@example.org',
            'password' => 'not-a-real-password-1A!',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('code', CheckBillingLock::CODE);
    }

    /**
     * The Platform team panel and the super admin panel are how a paused
     * community gets restored. Their own API (not only /v2/admin/) must stay
     * reachable from a paused community's address: every route under these
     * two prefixes carries its own platform-team or super-admin gate.
     * (Found by the Stage 1 review, 20 Nov 2026.)
     */
    public function test_the_platform_team_and_super_admin_apis_stay_open(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child, ['is_god' => true, 'is_super_admin' => true, 'role' => 'super_admin']);

        foreach (['/v2/super-admin/provisioning-requests', '/v2/platform-team/does-not-exist'] as $uri) {
            $response = $this->apiGet($uri);

            $this->assertNotSame(
                CheckBillingLock::CODE,
                $response->json('code'),
                "GET {$uri} must not be answered by the payment lock"
            );
        }
    }

    public function test_who_am_i_write_is_closed(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child);

        $response = $this->apiPut('/v2/users/me', ['bio' => 'still here']);

        $response->assertStatus(403);
        $response->assertJsonPath('code', CheckBillingLock::CODE);
    }

    public function test_an_address_that_only_starts_like_who_am_i_is_closed(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->child);

        $response = $this->apiGet('/v2/users/me/listings');

        $response->assertStatus(403);
        $response->assertJsonPath('code', CheckBillingLock::CODE);
    }

    public function test_a_child_of_a_paused_parent_is_closed(): void
    {
        BillingStandingService::suspend($this->parent, null, 'auto');
        $this->signInTo($this->child);

        $response = $this->apiGet('/v2/listings');

        $response->assertStatus(403);
        $response->assertJsonPath('code', CheckBillingLock::CODE);
    }

    public function test_an_open_community_is_untouched(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        $this->signInTo($this->parent);

        $response = $this->apiGet('/v2/listings');

        $this->assertNotSame(CheckBillingLock::CODE, $response->json('code'));
        $this->assertNotSame(403, $response->getStatusCode());
    }

    public function test_a_restored_community_opens_again(): void
    {
        BillingStandingService::suspend($this->child, null, 'manual');
        BillingStandingService::restore($this->child, null);
        $this->signInTo($this->child);

        $response = $this->apiGet('/v2/listings');

        $this->assertNotSame(CheckBillingLock::CODE, $response->json('code'));
    }

    public function test_a_failing_check_lets_the_request_through_and_logs(): void
    {
        TenantContext::setById($this->child);
        Log::shouldReceive('error')->once();

        $middleware = new class extends CheckBillingLock {
            protected function isLocked(int $tenantId): bool
            {
                throw new \RuntimeException('standing table unreadable');
            }
        };

        $response = $middleware->handle(
            Request::create('/api/v2/listings', 'GET'),
            static fn () => response()->json(['ok' => true], 200)
        );

        $this->assertSame(200, $response->getStatusCode());
    }
}
