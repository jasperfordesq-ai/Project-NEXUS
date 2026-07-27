<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;
use Tests\Laravel\Concerns\EnablesExternalFederation;

/**
 * Smoke tests for FederationCreditCommonsController.
 *
 * Routes live under federation.api middleware (API key, HMAC, JWT, or OAuth2
 * authentication — NOT Sanctum). Without credentials, the endpoint should
 * reject the request with 401/403 rather than crash with 500.
 */
class FederationCreditCommonsControllerTest extends TestCase
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
        $this->assertTrue(class_exists(\App\Http\Controllers\Api\FederationCreditCommonsController::class));
    }

    public function test_about_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/cc/about');
        $this->assertContains($response->status(), [401, 403, 400]);
    }

    public function test_accounts_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/cc/accounts');
        $this->assertContains($response->status(), [401, 403, 400]);
    }

    public function test_transactions_rejects_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/federation/cc/transactions');
        $this->assertContains($response->status(), [401, 403, 400]);
    }

    public function test_create_transaction_rejects_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/federation/cc/transaction', []);
        $this->assertContains($response->status(), [401, 403, 400, 422]);
    }

    public function test_propose_transaction_rejects_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/federation/cc/transactions/propose', []);
        $this->assertContains($response->status(), [401, 403, 400, 422]);
    }
}
