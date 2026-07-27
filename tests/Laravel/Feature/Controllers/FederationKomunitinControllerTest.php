<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Http\Middleware\FederationApiAuth;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
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
        $this->withoutMiddleware(FederationApiAuth::class);

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

        $txId = DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $payer->id,
            'receiver_id' => $payee->id,
            'amount' => 3,
            'description' => 'Deferred federation transfer',
            'status' => 'pending',
            'is_federated' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->patchJson(
            "/api/v2/federation/komunitin/HOURS/transfers/{$txId}",
            ['data' => ['attributes' => ['state' => 'committed']]],
            $this->withTenantHeader()
        );

        $response->assertStatus(200);
        $this->assertSame('completed', DB::table('transactions')->where('id', $txId)->value('status'));
        $this->assertSame(7, (int) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertSame(3, (int) DB::table('users')->where('id', $payee->id)->value('balance'));

        $again = $this->patchJson(
            "/api/v2/federation/komunitin/HOURS/transfers/{$txId}",
            ['data' => ['attributes' => ['state' => 'committed']]],
            $this->withTenantHeader()
        );

        $again->assertStatus(422);
        $this->assertSame(7, (int) DB::table('users')->where('id', $payer->id)->value('balance'));
        $this->assertSame(3, (int) DB::table('users')->where('id', $payee->id)->value('balance'));
    }
}
