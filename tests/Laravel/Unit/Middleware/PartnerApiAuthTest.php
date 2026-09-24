<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Core\TenantContext;
use App\Http\Middleware\PartnerApiAuth;
use App\Services\PartnerApi\PartnerApiAuthService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;

class PartnerApiAuthTest extends TestCase
{
    use DatabaseTransactions;

    private PartnerApiAuth $middleware;

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new PartnerApiAuth();
    }

    private function makeNext(): \Closure
    {
        return function ($request) {
            return response()->json(['ok' => true], 200);
        };
    }

    /**
     * Seed an active partner and return [partner_row_array, raw_access_token].
     * The token is already inserted into api_oauth_tokens via issueAccessToken().
     */
    private function seedPartnerWithToken(array $scopes = ['users.read'], array $partnerOverrides = []): array
    {
        $partnerId = DB::table('api_partners')->insertGetId(array_merge([
            'tenant_id'           => $this->testTenantId,
            'name'                => 'Test Partner ' . uniqid(),
            'slug'                => 'test-partner-' . uniqid(),
            'status'              => 'active',
            'is_sandbox'          => false,
            'allowed_scopes'      => json_encode($scopes),
            'allowed_ip_cidrs'    => null,
            'rate_limit_per_minute' => 60,
            'created_at'          => now(),
            'updated_at'          => now(),
        ], $partnerOverrides));

        $partner = (array) DB::table('api_partners')->where('id', $partnerId)->first();

        // F-175: the Partner API is now gated by the per-tenant `partner_api`
        // feature, so the partner's tenant must have it enabled for a token to work.
        $features = json_decode((string) (DB::table('tenants')->where('id', $this->testTenantId)->value('features') ?: '{}'), true) ?: [];
        $features['partner_api'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);

        TenantContext::setById($this->testTenantId);
        $tokenData = PartnerApiAuthService::issueAccessToken($partner, $scopes);

        return [$partner, $tokenData['access_token']];
    }

    // ─── Missing / malformed auth ─────────────────────────────────────────────

    public function test_missing_authorization_header_returns_401(): void
    {
        $request = Request::create('/v2/partner/users', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertFalse($data['success']);
        $this->assertEquals('invalid_token', $data['errors'][0]['code']);
        $this->assertStringContainsString('bearer', strtolower($data['errors'][0]['message']));
        $this->assertEquals('2.0', $response->headers->get('API-Version'));
    }

    public function test_malformed_authorization_header_returns_401(): void
    {
        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Basic dXNlcjpwYXNz');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('invalid_token', $data['errors'][0]['code']);
    }

    // ─── Invalid / expired token ───────────────────────────────────────────────

    public function test_unknown_bearer_token_returns_401(): void
    {
        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer at_totally_invalid_token_here');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('invalid_token', $data['errors'][0]['code']);
    }

    public function test_revoked_token_returns_401(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        // Revoke it
        PartnerApiAuthService::revokeAccessToken($rawToken);

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('invalid_token', $data['errors'][0]['code']);
    }

    public function test_expired_token_returns_401(): void
    {
        [$partner] = $this->seedPartnerWithToken(['users.read']);

        // Insert an already-expired token manually
        $rawToken = 'at_expired_' . bin2hex(random_bytes(20));
        DB::table('api_oauth_tokens')->insert([
            'partner_id'         => (int) $partner['id'],
            'tenant_id'          => $this->testTenantId,
            'access_token_hash'  => hash('sha256', $rawToken),
            'scopes'             => json_encode(['users.read']),
            'expires_at'         => now()->subHour(),
            'created_at'         => now(),
        ]);

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('invalid_token', $data['errors'][0]['code']);
    }

    // ─── Happy path ────────────────────────────────────────────────────────────

    public function test_valid_token_with_matching_scope_passes_through(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'users.read');

        $this->assertEquals(200, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertTrue($data['ok']);
    }

    public function test_valid_token_sets_rate_limit_headers(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'users.read');

        $this->assertEquals(200, $response->getStatusCode());
        $this->assertNotNull($response->headers->get('X-RateLimit-Limit'));
        $this->assertNotNull($response->headers->get('X-RateLimit-Remaining'));
    }

    public function test_valid_token_stashes_partner_on_request(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        $capturedRequest = null;
        $next = function ($request) use (&$capturedRequest) {
            $capturedRequest = $request;
            return response()->json(['ok' => true], 200);
        };

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $this->middleware->handle($request, $next, 'users.read');

        $this->assertNotNull($capturedRequest);
        $this->assertNotNull($capturedRequest->attributes->get('partner'));
        $this->assertEquals((int) $partner['id'], (int) $capturedRequest->attributes->get('partner')['id']);
    }

    // ─── Scope enforcement ─────────────────────────────────────────────────────

    public function test_token_missing_required_scope_returns_403(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        $request = Request::create('/v2/partner/wallet/transfer', 'POST');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'wallet.write');

        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('insufficient_scope', $data['errors'][0]['code']);
        $this->assertEquals('2.0', $response->headers->get('API-Version'));
    }

    /** No required scope parameter → any valid token passes (no scope check) */
    public function test_no_required_scope_param_any_valid_token_passes(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(['users.read']);

        $request = Request::create('/v2/partner/status', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        // no scope arg
        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    // ─── Sandbox write block ───────────────────────────────────────────────────

    public function test_sandbox_partner_cannot_perform_write_operations(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(
            ['wallet.write'],
            ['is_sandbox' => true]
        );

        $request = Request::create('/v2/partner/wallet/transfer', 'POST');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'wallet.write');

        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('sandbox_write_disabled', $data['errors'][0]['code']);
    }

    public function test_sandbox_partner_can_perform_read_operations(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(
            ['users.read'],
            ['is_sandbox' => true]
        );

        $request = Request::create('/v2/partner/users', 'GET');
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'users.read');

        $this->assertEquals(200, $response->getStatusCode());
    }

    // ─── IP allowlist ─────────────────────────────────────────────────────────

    public function test_request_from_non_allowlisted_ip_is_rejected(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(
            ['users.read'],
            ['allowed_ip_cidrs' => json_encode(['10.0.0.1/32'])]
        );

        // Simulate request from a different IP
        $request = Request::create('/v2/partner/users', 'GET', [], [], [], ['REMOTE_ADDR' => '192.168.1.99']);
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'users.read');

        $this->assertEquals(403, $response->getStatusCode());
        $data = $response->getData(true);
        $this->assertEquals('ip_not_allowed', $data['errors'][0]['code']);
    }

    public function test_request_from_allowlisted_cidr_passes(): void
    {
        [$partner, $rawToken] = $this->seedPartnerWithToken(
            ['users.read'],
            ['allowed_ip_cidrs' => json_encode(['127.0.0.0/8'])]
        );

        $request = Request::create('/v2/partner/users', 'GET', [], [], [], ['REMOTE_ADDR' => '127.0.0.1']);
        $request->headers->set('Authorization', 'Bearer ' . $rawToken);

        $response = $this->middleware->handle($request, $this->makeNext(), 'users.read');

        $this->assertEquals(200, $response->getStatusCode());
    }
}
