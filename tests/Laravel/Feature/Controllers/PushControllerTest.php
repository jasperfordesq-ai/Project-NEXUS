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
use Illuminate\Support\Facades\DB;

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

    public function test_same_member_resubscription_updates_keys_without_adding_a_row(): void
    {
        $member = $this->authenticatedUser();
        $endpoint = 'https://fcm.googleapis.com/f108-refresh-' . bin2hex(random_bytes(8));
        $this->apiPost('/push/subscribe', [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'first-public-key', 'auth' => 'first-auth-key'],
        ])->assertCreated();
        $this->apiPost('/push/subscribe', [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'new-public-key', 'auth' => 'new-auth-key'],
        ])->assertCreated();

        $rows = DB::table('push_subscriptions')->where('endpoint', $endpoint)->get();
        $this->assertCount(1, $rows);
        $this->assertSame((int) $member->id, (int) $rows->first()->user_id);
        $this->assertSame('new-public-key', $rows->first()->p256dh_key);
        $this->assertSame('new-auth-key', $rows->first()->auth_key);
    }

    public function test_one_browser_endpoint_cannot_remain_bound_to_two_members(): void
    {
        $first = $this->authenticatedUser();
        $endpoint = 'https://fcm.googleapis.com/f108-shared-browser-' . bin2hex(random_bytes(8));
        $body = [
            'endpoint' => $endpoint,
            'keys' => ['p256dh' => 'synthetic-public-key', 'auth' => 'synthetic-auth-key'],
        ];
        $this->apiPost('/push/subscribe', $body)->assertCreated();

        $second = $this->authenticatedUser();
        $this->apiPost('/push/subscribe', $body)->assertCreated();

        $rows = DB::table('push_subscriptions')->where('endpoint', $endpoint)
            ->get(['user_id', 'tenant_id']);
        $this->assertCount(1, $rows, 'The old member must not keep receiving push on a shared browser.');
        $this->assertSame((int) $second->id, (int) $rows->first()->user_id);
        $this->assertSame($this->testTenantId, (int) $rows->first()->tenant_id);
        $this->assertNotSame((int) $first->id, (int) $rows->first()->user_id);

        // A delayed cleanup from the old account must not remove B's binding.
        Sanctum::actingAs($first, ['*']);
        $this->apiPost('/push/unsubscribe', ['endpoint' => $endpoint])->assertOk();
        $this->assertSame((int) $second->id, (int) DB::table('push_subscriptions')
            ->where('endpoint', $endpoint)->value('user_id'));
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
