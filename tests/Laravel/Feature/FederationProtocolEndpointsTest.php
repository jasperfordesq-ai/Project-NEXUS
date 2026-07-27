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
use Illuminate\Support\Str;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Feature tests for the new protocol-specific REST endpoints:
 *
 *   - Komunitin DELETE /currency and /accounts/{id}
 *   - Credit Commons POST /transactions/propose|validate|commit
 *   - Nexus Native V2 POST ingest for reviews, listings, groups,
 *     connections, volunteering, members/sync
 *
 * Auth: all routes require a valid federation_api_keys row with '*' permissions.
 */
class FederationProtocolEndpointsTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    private string $apiKey = '';
    private int $apiKeyId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
        Cache::flush();

        try {
            DB::statement(
                "DELETE FROM tenant_settings WHERE tenant_id = ? AND setting_key = 'general.maintenance_mode'",
                [$this->testTenantId]
            );
        } catch (\Throwable $e) {
            // ignore
        }

        $this->apiKey = 'test-proto-key-' . bin2hex(random_bytes(8));

        try {
            $this->apiKeyId = (int) DB::table('federation_api_keys')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'name' => 'Test Protocol Endpoints Key',
                'key_hash' => hash('sha256', $this->apiKey),
                'key_prefix' => substr($this->apiKey, 0, 8),
                'platform_id' => 'protocol-test-' . bin2hex(random_bytes(4)),
                'permissions' => '["*"]',
                'rate_limit' => 1000,
                'status' => 'active',
                'signing_enabled' => 0,
                'created_by' => 1,
                'created_at' => now(),
                'updated_at' => now(),
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
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $this->apiKey;
        $_SERVER['REQUEST_URI'] = $_SERVER['REQUEST_URI'] ?? '/test';
        $_SERVER['REQUEST_METHOD'] = $_SERVER['REQUEST_METHOD'] ?? 'POST';
        $_SERVER['REMOTE_ADDR'] = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

        return array_merge([
            'Authorization' => 'Bearer ' . $this->apiKey,
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ], $extra);
    }

    // ==========================================
    //  AUTH — every new endpoint rejects anonymous
    // ==========================================

    public function endpointProvider(): array
    {
        return [
            'Komunitin DELETE currency'          => ['DELETE', '/v2/federation/komunitin/HOURS/currency'],
            'Komunitin DELETE account'           => ['DELETE', '/v2/federation/komunitin/HOURS/accounts/1'],
            'CC POST propose'                    => ['POST',   '/v2/federation/cc/transactions/propose'],
            'CC POST validate'                   => ['POST',   '/v2/federation/cc/transactions/00000000-0000-0000-0000-000000000000/validate'],
            'CC POST commit'                     => ['POST',   '/v2/federation/cc/transactions/00000000-0000-0000-0000-000000000000/commit'],
            'Native POST reviews'                => ['POST',   '/v2/federation/ingest/reviews'],
            'Native POST listings'               => ['POST',   '/v2/federation/ingest/listings'],
            'Native POST events'                 => ['POST',   '/v2/federation/ingest/events'],
            'Native POST groups'                 => ['POST',   '/v2/federation/ingest/groups'],
            'Native POST connections'            => ['POST',   '/v2/federation/ingest/connections'],
            'Native POST volunteering'           => ['POST',   '/v2/federation/ingest/volunteering'],
            'Native POST members/sync'           => ['POST',   '/v2/federation/ingest/members/sync'],
        ];
    }

    /** @dataProvider endpointProvider */
    public function test_endpoint_requires_auth(string $method, string $path): void
    {
        $response = $this->json($method, '/api' . $path, [], [
            'Accept' => 'application/json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);

        // No Authorization header -> FederationApiMiddleware returns 401 (MISSING_API_KEY /
        // INVALID_AUTH_HEADER); 403 is reserved for inactive/permission-denied, not missing auth.
        $this->assertSame(
            401,
            $response->getStatusCode(),
            "Unauthenticated {$method} {$path} must be rejected with 401 — got {$response->getStatusCode()}"
        );
    }

    // ==========================================
    //  KOMUNITIN — DELETE currency
    // ==========================================

    public function test_komunitin_delete_currency_returns_204_and_marks_inactive(): void
    {
        $response = $this->json('DELETE', '/api/v2/federation/komunitin/HOURS/currency', [], $this->authHeaders());

        // Authenticated DELETE must succeed with 204 No Content — not crash with 500.
        $this->assertSame(204, $response->getStatusCode());

        $inactive = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'federation.komunitin.currency_inactive')
            ->value('setting_value');
        $this->assertNotEmpty($inactive, 'currency_inactive flag should be set after DELETE');

        // Subsequent GET should report status=inactive
        $get = $this->json('GET', '/api/v2/federation/komunitin/HOURS/currency', [], $this->authHeaders());
        $get->assertStatus(200);
        $this->assertSame('inactive', $get->json('data.attributes.status'));
    }

    // ==========================================
    //  KOMUNITIN — DELETE account
    // ==========================================

    public function test_komunitin_delete_account_returns_204_and_sets_inactive(): void
    {
        $userId = DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->value('id');

        if (!$userId) {
            $this->markTestSkipped('No active user in test tenant to deactivate');
        }

        $response = $this->json('DELETE',
            "/api/v2/federation/komunitin/HOURS/accounts/{$userId}",
            [], $this->authHeaders()
        );

        $this->assertSame(204, $response->getStatusCode());

        $status = DB::table('users')->where('id', $userId)->value('status');
        $this->assertSame('inactive', $status);
    }

    public function test_komunitin_delete_account_404_for_unknown_id(): void
    {
        $response = $this->json('DELETE',
            '/api/v2/federation/komunitin/HOURS/accounts/99999999',
            [], $this->authHeaders()
        );
        $response->assertStatus(404);
    }

    // ==========================================
    //  CREDIT COMMONS — propose / validate / commit
    // ==========================================

    private function requireCcEntriesTable(): void
    {
        try {
            DB::table('federation_cc_entries')->limit(1)->get();
        } catch (\Throwable $e) {
            $this->markTestSkipped('federation_cc_entries table not present in test DB: ' . $e->getMessage());
        }
    }

    public function test_cc_propose_creates_pending_entry(): void
    {
        $this->requireCcEntriesTable();
        $payload = [
            'payer' => 'remote-node/alice',
            'payee' => 'remote-node/bob',
            'quant' => 1.5,
            'description' => 'test proposal',
            'workflow' => '+|PPC-PE+CE-',
        ];

        $response = $this->json('POST',
            '/api/v2/federation/cc/transactions/propose',
            $payload, $this->authHeaders()
        );

        $response->assertStatus(201);
        $uuid = $response->json('data.uuid');
        $this->assertNotEmpty($uuid);
        $this->assertSame('P', $response->json('data.state'));

        $row = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->where('tenant_id', $this->testTenantId)
            ->first();

        $this->assertNotNull($row);
        $this->assertSame('P', $row->state);
        $this->assertEqualsWithDelta(1.5, (float) $row->quant, 0.001);
    }

    public function test_cc_propose_rejects_missing_fields(): void
    {
        $this->requireCcEntriesTable();
        $response = $this->json('POST',
            '/api/v2/federation/cc/transactions/propose',
            ['payer' => 'a/b'], $this->authHeaders()
        );
        $response->assertStatus(400);
    }

    public function test_cc_validate_transitions_P_to_V(): void
    {
        $this->requireCcEntriesTable();
        $uuid = (string) Str::uuid();
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'transaction_uuid' => $uuid,
            'payer' => 'node/alice',
            'payee' => 'node/bob',
            'quant' => 2.0,
            'state' => 'P',
            'workflow' => '+|PPC-PE+CE-',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->json('POST',
            "/api/v2/federation/cc/transactions/{$uuid}/validate",
            [], $this->authHeaders()
        );

        $response->assertStatus(200);
        $this->assertSame('V', $response->json('data.state'));

        $state = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->value('state');
        $this->assertSame('V', $state);
    }

    public function test_cc_commit_transitions_V_to_C(): void
    {
        $this->requireCcEntriesTable();
        $uuid = (string) Str::uuid();
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'transaction_uuid' => $uuid,
            'payer' => 'remote/alice',   // non-local — no balance mutation
            'payee' => 'remote/bob',
            'quant' => 0.5,
            'state' => 'V',
            'workflow' => '+|PPC-PE+CE-',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->json('POST',
            "/api/v2/federation/cc/transactions/{$uuid}/commit",
            [], $this->authHeaders()
        );

        // Committing a validated (V) entry must transition it to C — not 500.
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame('C', $response->json('data.state'));
        $state = DB::table('federation_cc_entries')
            ->where('transaction_uuid', $uuid)
            ->value('state');
        $this->assertSame('C', $state);
    }

    public function test_cc_validate_rejects_invalid_transition(): void
    {
        $this->requireCcEntriesTable();
        $uuid = (string) Str::uuid();
        DB::table('federation_cc_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'transaction_uuid' => $uuid,
            'payer' => 'n/a',
            'payee' => 'n/b',
            'quant' => 1.0,
            'state' => 'C', // already completed
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->json('POST',
            "/api/v2/federation/cc/transactions/{$uuid}/validate",
            [], $this->authHeaders()
        );
        $response->assertStatus(400);
    }

    // ==========================================
    //  NEXUS NATIVE — entity ingest
    // ==========================================

    public function nativeIngestPathProvider(): array
    {
        return [
            'reviews'       => ['/v2/federation/ingest/reviews'],
            'listings'      => ['/v2/federation/ingest/listings'],
            // Event ingest has a stricter HMAC-only, versioned receipt contract;
            // EventFederationApiIntegrationTest owns that security boundary.
            'groups'        => ['/v2/federation/ingest/groups'],
            'connections'   => ['/v2/federation/ingest/connections'],
            'volunteering'  => ['/v2/federation/ingest/volunteering'],
            'members_sync'  => ['/v2/federation/ingest/members/sync'],
        ];
    }

    /** @dataProvider nativeIngestPathProvider */
    public function test_native_ingest_accepts_payload_and_logs(string $path): void
    {
        $userId = DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'active')
            ->value('id');
        if (!$userId && str_contains($path, '/reviews')) {
            $this->markTestSkipped('No active user available for review ingest');
        }
        if (!$userId && str_contains($path, '/connections')) {
            $this->markTestSkipped('No active user available for connection ingest');
        }

        $externalId = 'ext-' . bin2hex(random_bytes(4));
        $payload = match (true) {
            str_contains($path, '/reviews') => [
                'external_id' => $externalId,
                'receiver_id' => (int) $userId,
                'reviewer_id' => 9001,
                'rating' => 5,
            ],
            str_contains($path, '/groups') => ['external_id' => $externalId, 'name' => 'smoke-test'],
            str_contains($path, '/connections') => [
                'external_user_id' => $externalId,
                'local_user_id' => (int) $userId,
            ],
            str_contains($path, '/members/sync') => ['external_id' => $externalId, 'display_name' => 'Smoke Test'],
            default => ['external_id' => $externalId, 'title' => 'smoke-test'],
        };

        $response = $this->json('POST', '/api' . $path, $payload, $this->authHeaders());

        $this->assertSame(200, $response->getStatusCode());
        $this->assertTrue((bool) $response->json('data.received'));
        $this->assertTrue((bool) $response->json('data.processed'));
    }

    public function test_cc_create_transaction_rejects_non_transaction_enabled_payer(): void
    {
        // A member who has not enabled federated transactions must not be
        // debitable via the CC protocol.
        $payer = DB::table('users')->where('tenant_id', $this->testTenantId)->where('status', 'active')->value('id');
        $payee = DB::table('users')->where('tenant_id', $this->testTenantId)->where('status', 'active')->when($payer, fn ($q) => $q->where('id', '!=', $payer))->value('id');
        if (!$payer || !$payee) {
            $this->markTestSkipped('Need two active users to exercise the payer-consent gate');
        }
        DB::table('users')->whereIn('id', [$payer, $payee])->update(['balance' => 10.00]);
        $this->enableFederatedTransactions((int) $payer, ['transactions_enabled_federated' => 0]);
        $this->enableFederatedTransactions((int) $payee);

        $response = $this->json('POST', '/api/v2/federation/cc/transaction', [
            'payer' => (string) $payer,
            'payee' => (string) $payee,
            'quant' => 1,
            'workflow' => '0|PC-CE=',
        ], $this->authHeaders());
        $response->assertStatus(400);
        $this->assertSame('UnresolvedAccountnameViolation', $response->json('class'));
        $this->assertSame(10.00, (float) DB::table('users')->where('id', $payer)->value('balance'));
        $this->assertSame(10.00, (float) DB::table('users')->where('id', $payee)->value('balance'));
    }

    public function test_native_ingest_rejects_empty_body(): void
    {
        $response = $this->json('POST', '/api/v2/federation/ingest/reviews', [], $this->authHeaders());
        $response->assertStatus(400);
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
