<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Routes;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression tests for the 2026-07-09 audit P2 #4 finding: ~40 admin/member
 * routes (FADP, residency verification, ad/push campaigns, KI agents,
 * AI module docs, AI traces, regional analytics, pilot inquiries, api-partners)
 * carried no route-level auth middleware and relied solely on controller
 * self-checks. Those blocks are now wrapped in auth:sanctum (+ admin), so the
 * middleware layer — which also enforces token↔tenant binding and account
 * status — blocks requests before any controller runs.
 *
 * Deliberately-public endpoints (ad serving/beacons and pilot-inquiry
 * submission) must stay reachable without a token.
 */
class AdminRouteMiddlewareTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode($tenant->features ?? '{}', true, 512, JSON_THROW_ON_ERROR);
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features, JSON_THROW_ON_ERROR)]);
        TenantContext::setById($this->testTenantId);
    }

    /** Representative admin route from each hardened block. */
    public static function adminRoutes(): array
    {
        return [
            'fadp retention-config'     => ['GET', '/v2/admin/fadp/retention-config'],
            'residency verifications'   => ['GET', '/v2/admin/residency-verifications'],
            'ad campaigns'              => ['GET', '/v2/admin/ad-campaigns'],
            'push campaigns'            => ['GET', '/v2/admin/push-campaigns'],
            'ki-agents config'          => ['GET', '/v2/admin/ki-agents/config'],
            'ai module docs'            => ['GET', '/v2/admin/ai-module-docs'],
            'ai trace metrics'          => ['GET', '/v2/admin/ai-traces/metrics'],
            'regional analytics'        => ['GET', '/v2/admin/regional-analytics/overview'],
            'pilot inquiries'           => ['GET', '/v2/admin/pilot-inquiries'],
            'api partners'              => ['GET', '/v2/admin/api-partners'],
        ];
    }

    /** Representative member (auth-only) route from each hardened block. */
    public static function memberRoutes(): array
    {
        return [
            'fadp consent history' => ['GET', '/v2/me/fadp/consent-history'],
            'residency status'     => ['GET', '/v2/me/residency-verification'],
            'my ad campaigns'      => ['GET', '/v2/me/ad-campaigns'],
            'my push campaigns'    => ['GET', '/v2/me/push-campaigns'],
            'municipal surveys'    => ['GET', '/v2/caring-community/surveys'],
            'municipal survey'     => ['GET', '/v2/caring-community/surveys/1'],
        ];
    }

    private function makeUser(string $role): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
            'role'        => $role,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function call2(string $method, string $uri): \Illuminate\Testing\TestResponse
    {
        return $method === 'GET' ? $this->apiGet($uri) : $this->apiPost($uri);
    }

    /** @dataProvider adminRoutes */
    public function test_admin_routes_reject_unauthenticated_requests(string $method, string $uri): void
    {
        $this->call2($method, $uri)->assertStatus(401);
    }

    /** @dataProvider adminRoutes */
    public function test_admin_routes_reject_regular_members(string $method, string $uri): void
    {
        $this->makeUser('member');

        $this->call2($method, $uri)->assertStatus(403);
    }

    /** @dataProvider memberRoutes */
    public function test_member_routes_reject_unauthenticated_requests(string $method, string $uri): void
    {
        $this->call2($method, $uri)->assertStatus(401);
    }

    /** @dataProvider memberRoutes */
    public function test_member_routes_admit_authenticated_members(string $method, string $uri): void
    {
        $this->makeUser('member');

        $response = $this->call2($method, $uri);

        // Controllers may still 403 for tenant feature gates (FEATURE_DISABLED);
        // the middleware layer must simply not bounce an authenticated member.
        $this->assertNotSame(
            401,
            $response->getStatusCode(),
            "Member route {$uri} should not be blocked by auth middleware"
        );
    }

    public function test_deliberately_public_endpoints_stay_public(): void
    {
        // Ad serving serves logged-out visitors; the pilot-inquiry POST is a
        // public (throttled) lead-capture form.
        $this->assertNotSame(401, $this->apiGet('/v2/ads/active')->getStatusCode());
        $this->assertNotSame(401, $this->apiPost('/v2/pilot-inquiry', [])->getStatusCode());
    }
}
