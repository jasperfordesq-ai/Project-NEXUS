<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Core\TenantContext;
use App\Http\Middleware\Authenticate;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Mockery;

class AuthenticateTest extends TestCase
{
    use DatabaseTransactions;

    private Authenticate $middleware;

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new Authenticate();
    }

    private function makeNext(): \Closure
    {
        return function ($request) {
            return response()->json(['ok' => true], 200);
        };
    }

    public function test_handle_unauthenticated_request_returns_401(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(401, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertFalse($data['success']);
        $this->assertEquals('auth_required', $data['errors'][0]['code']);
        $this->assertEquals('2.0', $response->headers->get('API-Version'));
    }

    public function test_handle_sanctum_authenticated_user_passes_through(): void
    {
        $user = User::factory()->create([
            'tenant_id' => $this->testTenantId,
            'status' => 'active',
        ]);

        // Creating the user fires observers that reset TenantContext to tenant 1;
        // re-pin tenant 2 so the middleware's tenant check sees the request tenant
        // the user actually belongs to.
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $this->actingAs($user, 'sanctum');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertTrue($data['ok']);
    }

    public function test_handle_sanctum_user_wrong_tenant_returns_403(): void
    {
        // Create a second tenant
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 99,
            'name' => 'Other Tenant',
            'slug' => 'other-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->create([
            'tenant_id' => 99,
            'status' => 'active',
            'is_super_admin' => false,
            'is_tenant_super_admin' => false,
        ]);

        // Re-pin tenant 2 after the create (observers reset TenantContext to 1).
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $this->actingAs($user, 'sanctum');

        // TenantContext is set to tenant 2 by setUp(), user belongs to tenant 99
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('tenant_mismatch', $data['errors'][0]['code']);
    }

    public function test_handle_super_admin_bypasses_tenant_check(): void
    {
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 99,
            'name' => 'Other Tenant',
            'slug' => 'other-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->create([
            'tenant_id' => 99,
            'status' => 'active',
            'is_super_admin' => true,
        ]);

        // Re-pin tenant 2 after the create (observers reset TenantContext to 1).
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $this->actingAs($user, 'sanctum');

        $response = $this->middleware->handle($request, $this->makeNext());

        // Since the MFA baseline (E-004) a platform administrator MUST hold a
        // verified second factor, and a stateful session carries no MFA claims:
        // the tenant check is bypassed, but the request is refused for MFA. The
        // cross-tenant bypass itself is proven with a bearer that carries the
        // claims in test_handle_legacy_jwt_platform_super_admin_crosses_tenant.
        $this->assertEquals(401, $response->getStatusCode());
        $this->assertSame('AUTH_MFA_REQUIRED', $response->getData(true)['code'] ?? null);
    }

    /**
     * A TENANT super-admin is scoped to its own tenant and must NOT cross into
     * another tenant. This was hardened in commit f1a6b4ab0 ("resolve platform
     * audit findings"): only platform super_admin / god / is_super_admin / is_god
     * bypass the cross-tenant check. The legacy bypass for is_tenant_super_admin
     * was deliberately removed.
     */
    public function test_handle_tenant_super_admin_does_not_bypass_tenant_check(): void
    {
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 99,
            'name' => 'Other Tenant',
            'slug' => 'other-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->create([
            'tenant_id' => 99,
            'status' => 'active',
            'is_super_admin' => false,
            'is_god' => false,
            'is_tenant_super_admin' => true,
        ]);

        // Re-pin tenant 2 after the create (observers reset TenantContext to 1).
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $this->actingAs($user, 'sanctum');

        $response = $this->middleware->handle($request, $this->makeNext());

        // Tenant super-admin in tenant 99 cannot access tenant 2 → 403.
        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('tenant_mismatch', $data['errors'][0]['code']);
    }

    public function test_handle_invalid_bearer_token_returns_401(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');
        $request->headers->set('Authorization', 'Bearer invalid-token-here');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
    }

    public function test_handle_rejects_retired_sanctum_bearer_login_token(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        TenantContext::setById($this->testTenantId);
        $plainTextToken = $user->createToken('retired-login-token')->plainTextToken;

        $request = Request::create('/api/v2/feed', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $plainTextToken);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $this->assertSame('auth_required', $response->getData(true)['errors'][0]['code']);
    }

    public function test_legacy_jwt_authentication_does_not_create_a_parallel_raw_php_session(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
        ]);
        TenantContext::setById($this->testTenantId);
        unset($_SESSION['user_id']);
        $token = app(TokenService::class)->generateToken(
            (int) $user->id,
            $this->testTenantId
        );
        $request = Request::create('/api/v2/feed', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
        $this->assertArrayNotHasKey('user_id', $_SESSION ?? []);
    }

    public function test_handle_no_authorization_header_returns_401(): void
    {
        $request = Request::create('/api/v2/feed', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('auth_required', $data['errors'][0]['code']);
    }

    /**
     * A JWT bearer token minted for one tenant must NOT authenticate against a
     * different tenant. This is the PRODUCTION auth path — real clients send an
     * HS256 JWT via Authorization: Bearer, handled by validateLegacyToken — and
     * its cross-tenant comparison (Authenticate::validateLegacyToken, the
     * `$eloquentUser->tenant_id !== $tenantId` guard) is the SOLE line enforcing
     * tenant isolation for it; TokenService::validateToken does no tenant check.
     * The two pre-existing wrong-tenant tests exercise only the Sanctum guard
     * path (actingAs, no bearer token), so without this a regression that dropped
     * the JWT tenant guard would reach main with a green suite.
     */
    public function test_handle_legacy_jwt_from_other_tenant_returns_401(): void
    {
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 99,
            'name' => 'Other Tenant',
            'slug' => 'other-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->forTenant(99)->create([
            'status' => 'active',
            'is_super_admin' => false,
            'is_god' => false,
        ]);

        // Mint a real JWT for the tenant-99 user, then resolve the request to the
        // test tenant (2) — the mismatch the middleware must reject.
        $token = app(TokenService::class)->generateToken((int) $user->id, 99);
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $this->assertSame('auth_required', $response->getData(true)['errors'][0]['code']);
    }

    /**
     * Platform super-admins are the one exemption: a super_admin JWT is allowed
     * to cross tenants (validateLegacyToken lets is_super_admin / is_god / the
     * super_admin|god roles through). Locks the exemption so tightening the
     * cross-tenant guard cannot accidentally lock platform admins out.
     */
    public function test_handle_legacy_jwt_platform_super_admin_crosses_tenant(): void
    {
        \Illuminate\Support\Facades\DB::table('tenants')->insertOrIgnore([
            'id' => 99,
            'name' => 'Other Tenant',
            'slug' => 'other-tenant',
            'is_active' => true,
            'depth' => 0,
            'allows_subtenants' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $user = User::factory()->forTenant(99)->create([
            'status' => 'active',
            'is_super_admin' => true,
        ]);

        // A real platform administrator's bearer carries verified MFA claims
        // (mandatory since the MFA baseline) plus the admin flags login mints.
        $token = app(TokenService::class)->generateToken((int) $user->id, 99, [
            ...\App\Services\TwoFactorPolicy::claims('totp'),
            'role' => $user->role,
            'is_super_admin' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        $request = Request::create('/api/v2/feed', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $token);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode(), (string) $response->getContent());
    }
}
