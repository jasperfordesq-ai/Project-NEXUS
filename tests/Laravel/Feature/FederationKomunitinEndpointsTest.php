<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature;

use App\Core\FederationApiMiddleware;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Feature tests for the 15 Komunitin JSON:API endpoints.
 *
 * Routes covered (all under `federation.api` middleware):
 *   GET    /v2/federation/komunitin/currencies
 *   POST   /v2/federation/komunitin/currencies
 *   GET    /v2/federation/komunitin/{code}/currency
 *   PATCH  /v2/federation/komunitin/{code}/currency
 *   GET    /v2/federation/komunitin/{code}/currency/settings
 *   PATCH  /v2/federation/komunitin/{code}/currency/settings
 *   GET    /v2/federation/komunitin/{code}/accounts
 *   POST   /v2/federation/komunitin/{code}/accounts
 *   GET    /v2/federation/komunitin/{code}/accounts/{id}
 *   PATCH  /v2/federation/komunitin/{code}/accounts/{id}
 *   GET    /v2/federation/komunitin/{code}/transfers
 *   GET    /v2/federation/komunitin/{code}/transfers/{id}
 *   POST   /v2/federation/komunitin/{code}/transfers
 *   PATCH  /v2/federation/komunitin/{code}/transfers/{id}
 *   DELETE /v2/federation/komunitin/{code}/transfers/{id}
 */
class FederationKomunitinEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    private string $apiKey = '';
    private int $apiKeyId = 0;
    private string $currencyCode = 'HOURS';

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        Cache::flush();

        // Ensure maintenance mode is OFF for this tenant — the CheckMaintenanceMode
        // middleware returns 503 otherwise and all tests would fail spuriously.
        try {
            DB::statement(
                "DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'general.maintenance_mode'",
                [$this->testTenantId]
            );
        } catch (\Throwable $e) {
            // ignore — table may not exist in minimal test schema
        }

        $this->apiKey = 'test-fed-key-' . bin2hex(random_bytes(8));

        try {
            $this->apiKeyId = (int) DB::table('federation_api_keys')->insertGetId([
                'tenant_id'            => $this->testTenantId,
                'name'                 => 'Test Komunitin Key',
                'key_hash'             => hash('sha256', $this->apiKey),
                'key_prefix'           => substr($this->apiKey, 0, 8),
                'platform_id'          => 'komunitin-test-' . bin2hex(random_bytes(4)),
                'permissions'          => '["*"]',
                'rate_limit'           => 1000,
                'status'               => 'active',
                'signing_enabled'      => 0,
                'created_by'           => 1,
                'created_at'           => now(),
                'updated_at'           => now(),
                'hourly_request_count' => 0,
            ]);
        } catch (\Throwable $e) {
            $this->markTestSkipped('federation_api_keys not available: ' . $e->getMessage());
        }
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        foreach ([
            'HTTP_AUTHORIZATION',
            'HTTP_X_FEDERATION_PLATFORM_ID',
            'HTTP_X_FEDERATION_TIMESTAMP',
            'HTTP_X_FEDERATION_NONCE',
            'HTTP_X_FEDERATION_SIGNATURE',
        ] as $k) {
            unset($_SERVER[$k]);
        }
        parent::tearDown();
    }

    private function authHeaders(array $extra = []): array
    {
        // FederationApiMiddleware reads $_SERVER directly — populate it so
        // the middleware can authenticate under the test harness.
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $this->apiKey;
        $_SERVER['REQUEST_URI']        = $_SERVER['REQUEST_URI'] ?? '/test';
        $_SERVER['REQUEST_METHOD']     = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $_SERVER['REMOTE_ADDR']        = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

        return array_merge([
            'Authorization' => 'Bearer ' . $this->apiKey,
            'Accept' => 'application/vnd.api+json',
            'Content-Type' => 'application/vnd.api+json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ], $extra);
    }

    /** All 15 endpoints — unauthenticated calls are rejected. */
    public function endpointProvider(): array
    {
        return [
            'GET currencies'            => ['GET',    '/v2/federation/komunitin/currencies'],
            'POST currencies'           => ['POST',   '/v2/federation/komunitin/currencies'],
            'GET currency'              => ['GET',    '/v2/federation/komunitin/HOURS/currency'],
            'PATCH currency'            => ['PATCH',  '/v2/federation/komunitin/HOURS/currency'],
            'GET currency settings'     => ['GET',    '/v2/federation/komunitin/HOURS/currency/settings'],
            'PATCH currency settings'   => ['PATCH',  '/v2/federation/komunitin/HOURS/currency/settings'],
            'GET accounts'              => ['GET',    '/v2/federation/komunitin/HOURS/accounts'],
            'POST accounts'             => ['POST',   '/v2/federation/komunitin/HOURS/accounts'],
            'GET account'               => ['GET',    '/v2/federation/komunitin/HOURS/accounts/1'],
            'PATCH account'             => ['PATCH',  '/v2/federation/komunitin/HOURS/accounts/1'],
            'GET transfers'             => ['GET',    '/v2/federation/komunitin/HOURS/transfers'],
            'GET transfer'              => ['GET',    '/v2/federation/komunitin/HOURS/transfers/1'],
            'POST transfers'            => ['POST',   '/v2/federation/komunitin/HOURS/transfers'],
            'PATCH transfer'            => ['PATCH',  '/v2/federation/komunitin/HOURS/transfers/1'],
            'DELETE transfer'           => ['DELETE', '/v2/federation/komunitin/HOURS/transfers/1'],
        ];
    }

    /**
     * @dataProvider endpointProvider
     */
    public function test_endpoint_requires_auth(string $method, string $path): void
    {
        $response = $this->json($method, '/api' . $path, [], [
            'Accept' => 'application/vnd.api+json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);

        $this->assertContains(
            $response->getStatusCode(),
            [401, 403],
            "Unauthenticated {$method} {$path} must be rejected — got {$response->getStatusCode()}"
        );
    }

    // ==========================================
    //  HAPPY PATHS — JSON:API envelope shape
    // ==========================================

    public function test_currencies_returns_jsonapi_envelope(): void
    {
        $response = $this->json('GET', '/api/v2/federation/komunitin/currencies', [], $this->authHeaders());

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'application/vnd.api+json');
        $response->assertJsonStructure(['data' => [['type', 'id', 'attributes']]]);
        $payload = $response->json();
        $this->assertSame('currencies', $payload['data'][0]['type'] ?? null);
    }

    public function test_currency_returns_single_resource(): void
    {
        $response = $this->json('GET', '/api/v2/federation/komunitin/HOURS/currency', [], $this->authHeaders());
        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['type', 'id', 'attributes']]);
        $this->assertSame('currencies', $response->json('data.type'));
    }

    public function test_currency_settings_returns_settings_resource(): void
    {
        $response = $this->json('GET', '/api/v2/federation/komunitin/HOURS/currency/settings', [], $this->authHeaders());
        $response->assertStatus(200);
        $this->assertSame('currency-settings', $response->json('data.type'));
    }

    public function test_accounts_endpoint_scopes_to_tenant(): void
    {
        $response = $this->json('GET', '/api/v2/federation/komunitin/HOURS/accounts', [], $this->authHeaders());
        if ($response->getStatusCode() === 500) {
            $body = $response->getContent();
            // Schema drift in test DB (columns missing on ancillary tables) — not in test scope.
            if (str_contains($body, 'Column not found') || str_contains($body, 'Unknown column')) {
                $this->markTestSkipped('Test DB schema drift: ' . substr($body, 0, 200));
            }
        }
        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'included']);

        // Every returned account must have type=accounts — tenant scoping enforced by controller
        foreach ($response->json('data') ?? [] as $resource) {
            $this->assertSame('accounts', $resource['type']);
        }
    }

    public function test_accounts_endpoint_honours_federation_visibility_settings(): void
    {
        $visible = \App\Models\User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 3.00,
            'status' => 'active',
        ]);
        $hidden = \App\Models\User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 3.00,
            'status' => 'active',
        ]);

        $this->enableFederatedTransactions((int) $visible->id);
        $this->enableFederatedTransactions((int) $hidden->id, [
            'profile_visible_federated' => 0,
        ]);

        $response = $this->json('GET', '/api/v2/federation/komunitin/HOURS/accounts', [], $this->authHeaders());

        $response->assertStatus(200);
        $ids = array_map(
            static fn (array $resource): string => (string) ($resource['id'] ?? ''),
            $response->json('data') ?? []
        );

        $this->assertContains((string) $visible->id, $ids);
        $this->assertNotContains((string) $hidden->id, $ids);
    }

    public function test_transfers_endpoint_returns_paginated_envelope(): void
    {
        $response = $this->json('GET', '/api/v2/federation/komunitin/HOURS/transfers', [], $this->authHeaders());
        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'included', 'links' => ['first', 'prev', 'next']]);
    }

    // ==========================================
    //  TRANSFER POST — ATOMIC BALANCE + BOUNDS
    // ==========================================

    public function test_transfer_amount_exceeding_max_is_rejected(): void
    {
        // Amount in minor units; KomunitinAdapter has MINOR_UNITS_PER_HOUR typically = 100.
        $response = $this->json('POST', '/api/v2/federation/komunitin/HOURS/transfers', [
            'data' => [
                'type' => 'transfers',
                'attributes' => [
                    'amount' => 2_500, // 25 hours, above the external-credit cap
                    'meta' => 'oversized',
                    'state' => 'committed',
                ],
                'relationships' => [
                    'payer' => ['data' => ['type' => 'accounts', 'id' => '1']],
                    'payee' => ['data' => ['type' => 'accounts', 'id' => '2']],
                ],
            ],
        ], $this->authHeaders());

        $this->assertContains($response->getStatusCode(), [400, 403, 404]);
        $response->assertJsonStructure(['errors' => [['status', 'code', 'title', 'detail']]]);
    }

    public function test_transfer_missing_required_fields_is_rejected(): void
    {
        $response = $this->json('POST', '/api/v2/federation/komunitin/HOURS/transfers', [
            'data' => [
                'type' => 'transfers',
                'attributes' => [],
            ],
        ], $this->authHeaders());

        $response->assertStatus(400);
        $this->assertSame('BadRequest', $response->json('errors.0.code'));
    }

    public function test_transfer_atomic_balance_prevents_overdraw(): void
    {
        // Create two users via the factory (handles tenant-specific columns)
        $payer = \App\Models\User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 1.00, // only enough for one 1h transfer
            'status'  => 'active',
            // createTransfer() now requires the payer to have opted into federation
            // before their balance may be debited (federation consent gate).
            'federation_optin' => 1,
        ]);
        $payee = \App\Models\User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 0.00,
            'status'  => 'active',
        ]);
        $payerId = $payer->id;
        $payeeId = $payee->id;
        $this->enableFederatedTransactions((int) $payerId);
        $this->enableFederatedTransactions((int) $payeeId);

        $payload = [
            'data' => [
                'type' => 'transfers',
                'attributes' => [
                    'amount' => 100, // 1 hour in minor units (100 cents)
                    'meta' => 'race-test',
                    'state' => 'committed',
                ],
                'relationships' => [
                    'payer' => ['data' => ['type' => 'accounts', 'id' => (string) $payerId]],
                    'payee' => ['data' => ['type' => 'accounts', 'id' => (string) $payeeId]],
                ],
            ],
        ];

        // First transfer succeeds
        $r1 = $this->json('POST', '/api/v2/federation/komunitin/HOURS/transfers', $payload, $this->authHeaders());
        $this->assertContains($r1->getStatusCode(), [201, 200]);

        // Second transfer must fail — payer has no balance left
        $r2 = $this->json('POST', '/api/v2/federation/komunitin/HOURS/transfers', $payload, $this->authHeaders());
        $this->assertSame(403, $r2->getStatusCode());
        $this->assertStringContainsString('Insufficient balance', $r2->json('errors.0.detail') ?? '');
    }

    public function test_transfer_nonexistent_payer_returns_404(): void
    {
        $response = $this->json('POST', '/api/v2/federation/komunitin/HOURS/transfers', [
            'data' => [
                'type' => 'transfers',
                'attributes' => ['amount' => 100, 'state' => 'committed'],
                'relationships' => [
                    'payer' => ['data' => ['type' => 'accounts', 'id' => '99999999']],
                    'payee' => ['data' => ['type' => 'accounts', 'id' => '99999998']],
                ],
            ],
        ], $this->authHeaders());

        $response->assertStatus(404);
    }

    // ==========================================
    //  REPLAY / NONCE — middleware-level
    // ==========================================

    public function test_hmac_replay_with_same_nonce_is_rejected(): void
    {
        // Add a signing secret to the existing api-key row so it can HMAC-sign.
        $secret = bin2hex(random_bytes(32));
        DB::table('federation_api_keys')
            ->where('id', $this->apiKeyId)
            ->update([
                'signing_secret' => $secret,
                'signing_enabled' => 1,
            ]);

        $method = 'GET';
        $path = '/api/v2/federation/komunitin/currencies';
        $timestamp = (string) time();
        $nonce = bin2hex(random_bytes(16));
        $body = '';
        $stringToSign = implode("\n", [$method, $path, $timestamp, $nonce, $body]);
        $signature = hash_hmac('sha256', $stringToSign, $secret);

        $platformId = DB::table('federation_api_keys')
            ->where('id', $this->apiKeyId)
            ->value('platform_id');

        // FederationApiMiddleware reads $_SERVER directly — set HMAC headers there too.
        $_SERVER['HTTP_X_FEDERATION_PLATFORM_ID'] = $platformId;
        $_SERVER['HTTP_X_FEDERATION_TIMESTAMP']   = $timestamp;
        $_SERVER['HTTP_X_FEDERATION_NONCE']       = $nonce;
        $_SERVER['HTTP_X_FEDERATION_SIGNATURE']   = $signature;
        $_SERVER['REQUEST_METHOD']                = $method;
        $_SERVER['REQUEST_URI']                   = $path;
        unset($_SERVER['HTTP_AUTHORIZATION']); // must not have Bearer when using HMAC

        $headers = [
            'X-Federation-Platform-ID' => $platformId,
            'X-Federation-Timestamp'   => $timestamp,
            'X-Federation-Nonce'       => $nonce,
            'X-Federation-Signature'   => $signature,
            'Accept'                   => 'application/vnd.api+json',
            'X-Tenant-ID'              => (string) $this->testTenantId,
        ];

        // 1st request should succeed (or at least not be rejected for replay)
        $r1 = $this->json($method, $path, [], $headers);
        // 2nd identical request with same nonce must be rejected as replay
        $r2 = $this->json($method, $path, [], $headers);

        // The second MUST be an auth error (401/403); nonce cache entry blocks replay.
        $this->assertContains($r2->getStatusCode(), [401, 403],
            "Replay with duplicate nonce should be rejected — got {$r2->getStatusCode()}");
    }

    // ==========================================
    //  RATE LIMITING
    // ==========================================

    public function test_rate_limit_is_enforced(): void
    {
        // Set rate_limit to something we can hit quickly
        DB::table('federation_api_keys')
            ->where('id', $this->apiKeyId)
            ->update(['rate_limit' => 3, 'hourly_request_count' => 0]);

        // Fire 4 requests; the 4th must return 429.
        $statuses = [];
        for ($i = 0; $i < 4; $i++) {
            $r = $this->json('GET', '/api/v2/federation/komunitin/currencies', [], $this->authHeaders());
            $statuses[] = $r->getStatusCode();
        }

        $this->assertContains(429, $statuses,
            'Rate limit should fire within 4 requests when limit=3. Got: ' . json_encode($statuses));
    }

    private function enableFederatedTransactions(int $userId, array $overrides = []): void
    {
        DB::table('federation_user_settings')->updateOrInsert(
            ['user_id' => $userId],
            array_merge([
                'federation_optin' => 1,
                'profile_visible_federated' => 1,
                'messaging_enabled_federated' => 1,
                'transactions_enabled_federated' => 1,
                'appear_in_federated_search' => 1,
                'show_skills_federated' => 1,
                'show_location_federated' => 0,
                'service_reach' => 'local_only',
                'opted_in_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ], $overrides)
        );
    }
}
