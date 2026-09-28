<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Core\FederationApiMiddleware;
use App\Http\Controllers\Api\FederationDebitApprovalController;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Smoke tests for FederationKomunitinController.
 *
 * Routes are gated by federation.api middleware (not Sanctum).
 * Unauthenticated requests should be rejected with 401/403.
 */
class FederationKomunitinControllerTest extends TestCase
{
    use DatabaseTransactions;

    use EnablesExternalFederation;

    protected function setUp(): void
    {
        parent::setUp();
        $this->enableExternalFederation();
        FederationApiMiddleware::reset();
    }

    protected function tearDown(): void
    {
        FederationApiMiddleware::reset();
        unset($_SERVER['HTTP_AUTHORIZATION'], $_SERVER['REQUEST_METHOD'],
            $_SERVER['REQUEST_URI'], $_SERVER['REMOTE_ADDR']);
        parent::tearDown();
    }

    public function test_controller_exists(): void
    {
        $this->assertTrue(class_exists(\App\Http\Controllers\Api\FederationKomunitinController::class));
    }

    public function test_currencies_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/komunitin/currencies');
        $this->assertContains($response->status(), [401, 403, 400]);
    }

    public function test_currency_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/komunitin/XYZ/currency');
        $this->assertContains($response->status(), [401, 403, 400, 404]);
    }

    public function test_accounts_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/komunitin/XYZ/accounts');
        $this->assertContains($response->status(), [401, 403, 400, 404]);
    }

    public function test_transfers_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/komunitin/XYZ/transfers');
        $this->assertContains($response->status(), [401, 403, 400, 404]);
    }

    public function test_create_transfer_rejects_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/federation/komunitin/XYZ/transfers', []);
        $this->assertContains($response->status(), [401, 403, 400, 404, 422]);
    }

    public function test_update_transfer_to_completed_settles_balances_once(): void
    {
        TenantContext::setById($this->testTenantId);

        $payer = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 10,
            'federation_optin' => 1,
        ]);
        $payee = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 0,
        ]);

        foreach ([$payer->id, $payee->id] as $userId) {
            DB::table('federation_user_settings')->updateOrInsert(
                ['user_id' => $userId],
                [
                    'federation_optin' => 1,
                    'transactions_enabled_federated' => 1,
                    'updated_at' => now(),
                ]
            );
        }

        $apiKey = 'test-fed-key-' . bin2hex(random_bytes(8));
        DB::table('federation_api_keys')->insert([
            'tenant_id' => $this->testTenantId,
            'name' => 'Komunitin settlement test',
            'key_hash' => hash('sha256', $apiKey),
            'key_prefix' => substr($apiKey, 0, 8),
            'platform_id' => 'komunitin-settlement-' . bin2hex(random_bytes(4)),
            'permissions' => '["*"]',
            'rate_limit' => 1000,
            'status' => 'active',
            'signing_enabled' => 0,
            'created_by' => 1,
            'created_at' => now(),
            'updated_at' => now(),
            'hourly_request_count' => 0,
        ]);
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $apiKey;
        $_SERVER['REQUEST_METHOD'] = 'POST';
        $_SERVER['REQUEST_URI'] = '/api/v2/federation/komunitin/HOURS/transfers';
        $_SERVER['REMOTE_ADDR'] = '127.0.0.1';
        $headers = [
            'Authorization' => 'Bearer ' . $apiKey,
            'Accept' => 'application/vnd.api+json',
            'Content-Type' => 'application/vnd.api+json',
            'X-Tenant-ID' => (string) $this->testTenantId,
        ];

        $created = $this->postJson('/api/v2/federation/komunitin/HOURS/transfers', [
            'data' => [
                'type' => 'transfers',
                'id' => 'settlement-once-' . bin2hex(random_bytes(4)),
                'attributes' => [
                    'amount' => 300,
                    'meta' => 'Deferred federation transfer',
                    'state' => 'committed',
                ],
                'relationships' => [
                    'payer' => ['data' => ['type' => 'accounts', 'id' => (string) $payer->id]],
                    'payee' => ['data' => ['type' => 'accounts', 'id' => (string) $payee->id]],
                ],
            ],
        ], $headers);
        $created->assertStatus(201);
        $txId = (int) $created->json('data.id');
        $this->assertSame('pending', DB::table('transactions')->where('id', $txId)->value('status'));

        $_SERVER['REQUEST_METHOD'] = 'PATCH';
        $_SERVER['REQUEST_URI'] = "/api/v2/federation/komunitin/HOURS/transfers/{$txId}";
        $denied = $this->patchJson(
            "/api/v2/federation/komunitin/HOURS/transfers/{$txId}",
            ['data' => ['attributes' => ['state' => 'committed']]],
            $headers
        );
        $denied->assertStatus(403);
        $this->assertSame(10, (int) DB::table('users')->where('id', $payer->id)->value('balance'));

        $approvalId = (int) DB::table('federation_debit_approvals')
            ->where('tenant_id', $this->testTenantId)
            ->where('protocol', 'komunitin')
            ->where('reference_id', (string) $txId)
            ->value('id');
        $decision = Request::create('/', 'POST', [], [], [],
            ['CONTENT_TYPE' => 'application/json'], '{"decision":"approve"}');
        $decision->setUserResolver(fn () => User::find($payer->id));
        $this->assertSame(200,
            app(FederationDebitApprovalController::class)->decide($decision, $approvalId)->getStatusCode());

        $response = $this->patchJson(
            "/api/v2/federation/komunitin/HOURS/transfers/{$txId}",
            ['data' => ['attributes' => ['state' => 'committed']]],
            $headers
        );

        $response->assertStatus(200);
        $this->assertSame('completed', DB::table('transactions')->where('id', $txId)->value('status'));
        $this->assertSame(7, (int) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertSame(3, (int) DB::table('users')->where('id', $payee->id)->value('balance'));

        $again = $this->patchJson(
            "/api/v2/federation/komunitin/HOURS/transfers/{$txId}",
            ['data' => ['attributes' => ['state' => 'committed']]],
            $headers
        );

        $again->assertStatus(422);
        $this->assertSame(7, (int) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertSame(3, (int) DB::table('users')->where('id', $payee->id)->value('balance'));
    }
}
