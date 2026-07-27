<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Middleware;

use App\Core\FederationApiMiddleware;
use App\Core\TenantContext;
use App\Http\Middleware\FederationApiAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Tests for FederationApiAuth Laravel middleware wrapper.
 *
 * FederationApiMiddleware reads from $_SERVER superglobals (not the Laravel
 * Request object). Tests must set these directly and clean them up in
 * tearDown. The underlying authenticate() uses DB and Cache, so this test
 * uses DatabaseTransactions and seeds real rows.
 */
class FederationApiAuthTest extends TestCase
{
    use DatabaseTransactions;
    use EnablesExternalFederation;

    private FederationApiAuth $middleware;

    /** Tracks $_SERVER keys we set so tearDown can clean up */
    private array $serverKeysSet = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        $this->middleware = new FederationApiAuth();

        // Reset static state from any prior test
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        // Restore $_SERVER to avoid leaking state into subsequent tests
        foreach ($this->serverKeysSet as $key) {
            unset($_SERVER[$key]);
        }
        $this->serverKeysSet = [];

        FederationApiMiddleware::reset();

        parent::tearDown();
    }

    private function setServer(string $key, string $value): void
    {
        $this->serverKeysSet[] = $key;
        $_SERVER[$key] = $value;
    }

    private function makeNext(): \Closure
    {
        return function ($request) {
            return response()->json(['ok' => true], 200);
        };
    }

    /** Seed a valid api-key federation partner in the DB and return [key_raw, partner_row] */
    private function seedPartner(array $overrides = []): array
    {
        $rawKey = 'fed_test_' . bin2hex(random_bytes(8));
        $keyHash = hash('sha256', $rawKey);

        $data = array_merge([
            'tenant_id'       => $this->testTenantId,
            'name'            => 'Test Federation Partner',
            'key_hash'        => $keyHash,
            'key_prefix'      => substr($rawKey, 0, 8),
            'permissions'     => json_encode(['members:read', 'transactions:read', 'transactions:write']),
            'rate_limit'      => 1000,
            'request_count'   => 0,
            'status'          => 'active',
            'signing_enabled' => 0,
            'expires_at'      => null,
            'created_by'      => 1,
            'created_at'      => now(),
        ], $overrides);

        $id = DB::table('federation_api_keys')->insertGetId($data);
        $data['id'] = $id;

        return [$rawKey, $data];
    }

    /** No credentials at all → 401 */
    public function test_missing_credentials_returns_401(): void
    {
        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');

        // No Authorization, no HMAC headers
        unset($_SERVER['HTTP_AUTHORIZATION']);

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertTrue($data['error']);
        $this->assertEquals('MISSING_API_KEY', $data['code']);
    }

    /** Invalid bearer token → 401 */
    public function test_invalid_api_key_returns_401(): void
    {
        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer totally-fake-key');

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertTrue($data['error']);
        $this->assertEquals('INVALID_API_KEY', $data['code']);
    }

    /**
     * Suspended partner → 401 INVALID_API_KEY.
     *
     * NOTE: FederationApiMiddleware::validateApiKey() queries with
     * WHERE status = 'active', so a suspended partner's key_hash is not
     * found in the SELECT. The method returns null, and the caller emits
     * 401 INVALID_API_KEY rather than 403 PARTNER_INACTIVE. The
     * PARTNER_INACTIVE 403 path is only reachable via HMAC (platform lookup
     * returns the row regardless of status and checks it explicitly).
     * This test asserts the ACTUAL runtime behavior for API-key auth.
     */
    public function test_suspended_partner_via_api_key_returns_401(): void
    {
        [$rawKey] = $this->seedPartner(['status' => 'suspended']);

        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        // validateApiKey() filters WHERE status='active', so suspended key is
        // treated as unknown → 401 INVALID_API_KEY, not 403 PARTNER_INACTIVE
        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertEquals('INVALID_API_KEY', $data['code']);
    }

    /** Valid key with members:read permission on a GET members route → 200 */
    public function test_valid_api_key_with_members_read_passes_on_komunitin_accounts_get(): void
    {
        [$rawKey, $partner] = $this->seedPartner([
            'permissions' => json_encode(['members:read']),
        ]);

        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);
        $this->setServer('HTTP_USER_AGENT', 'TestAgent/1.0');
        $this->setServer('REMOTE_ADDR', '127.0.0.1');

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertTrue($data['ok']);
    }

    /** Valid key with only members:read trying a transactions:write POST → 403 PERMISSION_DENIED */
    public function test_partner_without_required_permission_is_denied(): void
    {
        [$rawKey] = $this->seedPartner([
            'permissions' => json_encode(['members:read']),
        ]);

        $this->setServer('REQUEST_METHOD', 'POST');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/transfers');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);
        $this->setServer('HTTP_USER_AGENT', 'TestAgent/1.0');
        $this->setServer('REMOTE_ADDR', '127.0.0.1');

        $request = Request::create('/v2/federation/komunitin/transfers', 'POST');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(403, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertEquals('PERMISSION_DENIED', $data['code']);
    }

    /** Valid key with transactions:write permission on a POST transfers route → 200 */
    public function test_valid_key_with_write_permission_passes_on_transfers_post(): void
    {
        [$rawKey] = $this->seedPartner([
            'permissions' => json_encode(['transactions:write']),
        ]);

        $this->setServer('REQUEST_METHOD', 'POST');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/transfers');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);
        $this->setServer('HTTP_USER_AGENT', 'TestAgent/1.0');
        $this->setServer('REMOTE_ADDR', '127.0.0.1');

        $request = Request::create('/v2/federation/komunitin/transfers', 'POST');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    /** Wildcard permission grants everything */
    public function test_wildcard_permission_passes_any_route(): void
    {
        [$rawKey] = $this->seedPartner([
            'permissions' => json_encode(['*']),
        ]);

        $this->setServer('REQUEST_METHOD', 'POST');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/transfers');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);
        $this->setServer('HTTP_USER_AGENT', 'TestAgent/1.0');
        $this->setServer('REMOTE_ADDR', '127.0.0.1');

        $request = Request::create('/v2/federation/komunitin/transfers', 'POST');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    /** Partner with signing_enabled=1 presenting a plain api-key → 401 HMAC_REQUIRED */
    public function test_signing_required_partner_rejects_plain_api_key(): void
    {
        [$rawKey] = $this->seedPartner([
            'signing_enabled' => 1,
            'signing_secret'  => bin2hex(random_bytes(32)),
            'permissions'     => json_encode(['members:read']),
        ]);

        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_AUTHORIZATION', 'Bearer ' . $rawKey);

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertEquals('HMAC_REQUIRED', $data['code']);
    }

    /**
     * HMAC-signed request with correct signature passes.
     * The signature covers: METHOD\nPATH\nTIMESTAMP\nNONCE\nBODY
     */
    public function test_valid_hmac_signed_request_passes(): void
    {
        $signingSecret = bin2hex(random_bytes(32));

        // Platform-lookup path: partner must have a platform_id
        $platformId = 'test-platform-' . uniqid();

        // NOTE: For HMAC auth, the key hash is not looked up — only platform_id.
        // We still set a valid key_hash to satisfy NOT NULL.
        $fakeKey = 'fed_hmac_' . bin2hex(random_bytes(8));

        DB::table('federation_api_keys')->insert([
            'tenant_id'       => $this->testTenantId,
            'name'            => 'HMAC Test Partner',
            'key_hash'        => hash('sha256', $fakeKey),
            'key_prefix'      => 'fed_hmac',
            'platform_id'     => $platformId,
            'permissions'     => json_encode(['members:read', 'transactions:read', 'transactions:write']),
            'rate_limit'      => 1000,
            'request_count'   => 0,
            'status'          => 'active',
            'signing_enabled' => 1,
            'signing_secret'  => $signingSecret,
            'expires_at'      => null,
            'created_by'      => 1,
            'created_at'      => now(),
        ]);

        $method    = 'GET';
        $path      = '/v2/federation/komunitin/accounts';
        $timestamp = (string) time();
        $nonce     = bin2hex(random_bytes(8));
        $body      = '';

        $signature = FederationApiMiddleware::generateSignature(
            $signingSecret, $method, $path, $timestamp, $body, $nonce
        );

        $this->setServer('REQUEST_METHOD', $method);
        $this->setServer('REQUEST_URI', $path);
        $this->setServer('HTTP_X_FEDERATION_PLATFORM_ID', $platformId);
        $this->setServer('HTTP_X_FEDERATION_TIMESTAMP', $timestamp);
        $this->setServer('HTTP_X_FEDERATION_SIGNATURE', $signature);
        $this->setServer('HTTP_X_FEDERATION_NONCE', $nonce);
        $this->setServer('HTTP_USER_AGENT', 'TestAgent/1.0');
        $this->setServer('REMOTE_ADDR', '127.0.0.1');

        $request = Request::create($path, $method);

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(200, $response->getStatusCode());
    }

    /** HMAC with wrong signature → 401 SIGNATURE_INVALID */
    public function test_tampered_hmac_signature_returns_401(): void
    {
        $signingSecret = bin2hex(random_bytes(32));
        $platformId    = 'test-platform-tamper-' . uniqid();
        $fakeKey       = 'fed_hmac_' . bin2hex(random_bytes(8));

        DB::table('federation_api_keys')->insert([
            'tenant_id'       => $this->testTenantId,
            'name'            => 'HMAC Tamper Partner',
            'key_hash'        => hash('sha256', $fakeKey),
            'key_prefix'      => 'fed_hmac',
            'platform_id'     => $platformId,
            'permissions'     => json_encode(['*']),
            'rate_limit'      => 1000,
            'request_count'   => 0,
            'status'          => 'active',
            'signing_enabled' => 1,
            'signing_secret'  => $signingSecret,
            'expires_at'      => null,
            'created_by'      => 1,
            'created_at'      => now(),
        ]);

        $timestamp = (string) time();
        $nonce     = bin2hex(random_bytes(8));

        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_X_FEDERATION_PLATFORM_ID', $platformId);
        $this->setServer('HTTP_X_FEDERATION_TIMESTAMP', $timestamp);
        $this->setServer('HTTP_X_FEDERATION_SIGNATURE', 'deadbeef_invalid_signature');
        $this->setServer('HTTP_X_FEDERATION_NONCE', $nonce);

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertEquals('SIGNATURE_INVALID', $data['code']);
    }

    /** HMAC with expired timestamp → 401 TIMESTAMP_INVALID */
    public function test_expired_hmac_timestamp_returns_401(): void
    {
        $signingSecret = bin2hex(random_bytes(32));
        $platformId    = 'test-platform-expired-' . uniqid();
        $fakeKey       = 'fed_hmac_' . bin2hex(random_bytes(8));

        DB::table('federation_api_keys')->insert([
            'tenant_id'       => $this->testTenantId,
            'name'            => 'HMAC Expired Partner',
            'key_hash'        => hash('sha256', $fakeKey),
            'key_prefix'      => 'fed_hmac',
            'platform_id'     => $platformId,
            'permissions'     => json_encode(['*']),
            'rate_limit'      => 1000,
            'request_count'   => 0,
            'status'          => 'active',
            'signing_enabled' => 1,
            'signing_secret'  => $signingSecret,
            'expires_at'      => null,
            'created_by'      => 1,
            'created_at'      => now(),
        ]);

        // Timestamp 10 minutes in the past (tolerance is 5 min)
        $expiredTimestamp = (string) (time() - 600);
        $nonce = bin2hex(random_bytes(8));

        $this->setServer('REQUEST_METHOD', 'GET');
        $this->setServer('REQUEST_URI', '/v2/federation/komunitin/accounts');
        $this->setServer('HTTP_X_FEDERATION_PLATFORM_ID', $platformId);
        $this->setServer('HTTP_X_FEDERATION_TIMESTAMP', $expiredTimestamp);
        $this->setServer('HTTP_X_FEDERATION_SIGNATURE', 'any-sig');
        $this->setServer('HTTP_X_FEDERATION_NONCE', $nonce);

        $request = Request::create('/v2/federation/komunitin/accounts', 'GET');

        $response = $this->middleware->handle($request, $this->makeNext());

        $this->assertEquals(401, $response->getStatusCode());
        $data = json_decode($response->getContent(), true);
        $this->assertEquals('TIMESTAMP_INVALID', $data['code']);
    }
}
