<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature tests for PushController — push notifications (VAPID, subscribe, register device).
 */
class PushControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  GET /push/vapid-key (PUBLIC)
    // ------------------------------------------------------------------

    public function test_vapid_key_is_public(): void
    {
        $response = $this->apiGet('/push/vapid-key');

        $this->assertNotEquals(401, $response->getStatusCode());
    }

    // ------------------------------------------------------------------
    //  GET /push/vapid-public-key (PUBLIC)
    // ------------------------------------------------------------------

    public function test_vapid_public_key_is_public(): void
    {
        $response = $this->apiGet('/push/vapid-public-key');

        $this->assertNotEquals(401, $response->getStatusCode());
    }

    // ------------------------------------------------------------------
    //  POST /push/subscribe (auth required)
    // ------------------------------------------------------------------

    public function test_subscribe_requires_auth(): void
    {
        $response = $this->apiPost('/push/subscribe', [
            'endpoint' => 'https://fcm.googleapis.com/example',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /push/unsubscribe (auth required)
    // ------------------------------------------------------------------

    public function test_unsubscribe_requires_auth(): void
    {
        $response = $this->apiPost('/push/unsubscribe', [
            'endpoint' => 'https://fcm.googleapis.com/example',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /push/status (auth required)
    // ------------------------------------------------------------------

    public function test_status_requires_auth(): void
    {
        $response = $this->apiGet('/push/status');

        $response->assertStatus(401);
    }

    public function test_status_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/push/status');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /push/register-device (auth required)
    // ------------------------------------------------------------------

    public function test_register_device_requires_auth(): void
    {
        $response = $this->apiPost('/push/register-device', [
            'token' => 'fcm-token-abc123',
            'platform' => 'android',
        ]);

        $response->assertStatus(401);
    }

    public function test_register_device_rejects_invalid_platform_and_malformed_expo_tokens(): void
    {
        $this->authenticatedUser();

        $this->apiPost('/push/register-device', [
            'token' => 'ExponentPushToken[valid-token]',
            'token_type' => 'expo',
            'platform' => 'windows',
        ])->assertStatus(422);

        $this->apiPost('/push/register-device', [
            'token' => 'not-an-expo-token',
            'token_type' => 'expo',
            'platform' => 'android',
        ])->assertStatus(422);
    }

    public function test_unregister_device_rejects_oversized_token(): void
    {
        $this->authenticatedUser();

        $this->apiPost('/push/unregister-device', [
            'token' => str_repeat('x', 256),
        ])->assertStatus(422);
    }

    // ------------------------------------------------------------------
    //  POST /push/unregister-device (auth required)
    // ------------------------------------------------------------------

    public function test_unregister_device_requires_auth(): void
    {
        $response = $this->apiPost('/push/unregister-device', [
            'token' => 'fcm-token-abc123',
        ]);

        $response->assertStatus(401);
    }
}
