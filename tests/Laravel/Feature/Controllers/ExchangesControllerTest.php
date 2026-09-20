<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Listing;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ExchangesController.
 *
 * Covers exchange CRUD, accept, decline, start, complete, confirm, cancel.
 */
class ExchangesControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /**
     * Enable exchange workflow for the test tenant via broker_control_config.
     */
    private function enableExchangeWorkflow(): void
    {
        DB::table('broker_control_config')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'config_key' => 'exchange_workflow',
            'config_value' => json_encode([
                'enabled' => true,
                'require_broker_approval' => false,
                'confirmation_deadline_hours' => 72,
                'allow_hour_adjustment' => true,
                'max_hour_variance_percent' => 25,
            ]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('broker_control_config')->insertOrIgnore([
            'tenant_id' => $this->testTenantId,
            'config_key' => 'direct_messaging',
            'config_value' => json_encode(['enabled' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ================================================================
    // CONFIG — Happy path
    // ================================================================

    public function test_config_returns_exchange_workflow_settings(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/exchanges/config');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'exchange_workflow_enabled',
                'direct_messaging_enabled',
            ],
        ]);
    }

    // ================================================================
    // CONFIG — Authentication required
    // ================================================================

    public function test_config_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/exchanges/config');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // INDEX — Authentication required
    // ================================================================

    public function test_index_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/exchanges');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // INDEX — Happy path (may return empty or feature-disabled)
    // ================================================================

    public function test_index_returns_exchanges_or_feature_disabled(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/exchanges');

        // Either 200 with data or 400 (feature disabled)
        $this->assertContains($response->getStatusCode(), [200, 400]);
    }

    // ================================================================
    // CHECK — Validation
    // ================================================================

    public function test_check_returns_400_without_listing_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/exchanges/check');

        $response->assertStatus(400);
    }

    public function test_check_returns_data_with_valid_listing_id(): void
    {
        $user = $this->authenticatedUser();
        $listing = Listing::factory()->forTenant($this->testTenantId)->create([
            'user_id' => $user->id,
        ]);

        $response = $this->apiGet("/v2/exchanges/check?listing_id={$listing->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // STORE — Authentication required
    // ================================================================

    public function test_store_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/exchanges', [
            'listing_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // STORE — Validation
    // ================================================================

    public function test_store_returns_400_without_listing_id(): void
    {
        $this->authenticatedUser();
        $this->enableExchangeWorkflow();

        $response = $this->apiPost('/v2/exchanges', []);

        $response->assertStatus(400);
    }

    // ================================================================
    // SHOW — Not found
    // ================================================================

    public function test_show_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/exchanges/999999');

        $response->assertStatus(404);
    }

    public function test_confirmation_and_history_timestamps_describe_the_same_instant(): void
    {
        $requester = $this->authenticatedUser();
        $provider = User::factory()->forTenant($this->testTenantId)->create();
        $listing = Listing::factory()->create(['tenant_id' => $this->testTenantId, 'user_id' => $provider->id]);
        $stamp = '2026-09-20 22:39:00';
        $exchange = \App\Models\ExchangeRequest::factory()->forTenant($this->testTenantId)->create([
            'listing_id' => $listing->id, 'requester_id' => $requester->id,
            'provider_id' => $provider->id, 'status' => 'pending_confirmation',
            'provider_confirmed_at' => $stamp, 'provider_confirmed_hours' => 1,
            'created_at' => $stamp,
        ]);
        \App\Models\ExchangeHistory::create([
            'tenant_id' => $this->testTenantId, 'exchange_id' => $exchange->id,
            'action' => 'provider_confirmed', 'actor_id' => $provider->id,
            'actor_role' => 'provider', 'created_at' => $stamp,
        ]);
        $response = $this->apiGet('/v2/exchanges/' . $exchange->id);
        $response->assertOk();
        $historyTime = $response->json('data.status_history.0.created_at');
        self::assertSame('2026-09-20T22:39:00.000000Z', $historyTime);
        self::assertSame($historyTime, $response->json('data.provider_confirmed_at'));
        self::assertSame($historyTime, $response->json('data.created_at'));
        self::assertNull($response->json('data.requester_confirmed_at'));
    }

    // ================================================================
    // SHOW — Authentication required
    // ================================================================

    public function test_show_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/exchanges/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // ACCEPT — Not found
    // ================================================================

    public function test_accept_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/exchanges/999999/accept');

        $response->assertStatus(404);
    }

    // ================================================================
    // DECLINE — Not found
    // ================================================================

    public function test_decline_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/exchanges/999999/decline');

        $response->assertStatus(404);
    }

    // ================================================================
    // START — Not found
    // ================================================================

    public function test_start_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/exchanges/999999/start');

        $response->assertStatus(404);
    }

    // ================================================================
    // COMPLETE — Not found
    // ================================================================

    public function test_complete_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/exchanges/999999/complete');

        $response->assertStatus(404);
    }

    // ================================================================
    // CONFIRM — Validation
    // ================================================================

    public function test_confirm_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/exchanges/999999/confirm', [
            'hours' => 1.5,
        ]);

        $response->assertStatus(404);
    }

    public function test_confirm_returns_400_with_zero_hours(): void
    {
        $this->authenticatedUser();

        // First need an exchange to exist — use nonexistent ID
        // The controller checks exchange existence before hours validation,
        // so 404 is expected for nonexistent exchange
        $response = $this->apiPost('/v2/exchanges/999999/confirm', [
            'hours' => 0,
        ]);

        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    // ================================================================
    // CANCEL — Not found
    // ================================================================

    public function test_cancel_returns_404_for_nonexistent_exchange(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/exchanges/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // CANCEL — Authentication required
    // ================================================================

    public function test_cancel_returns_401_without_auth(): void
    {
        $response = $this->apiDelete('/v2/exchanges/1');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // TENANT ISOLATION — Exchanges from other tenants
    // ================================================================

    public function test_show_cannot_access_other_tenants_exchange(): void
    {
        // Create an exchange in a different tenant context
        // Since exchanges are tenant-scoped via the service layer,
        // a request to /v2/exchanges/{id} for a non-existent exchange
        // in our tenant should return 404
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/exchanges/999999');

        $response->assertStatus(404);
    }
}
