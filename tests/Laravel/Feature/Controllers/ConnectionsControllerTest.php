<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Connection;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ConnectionsController — request, accept, decline, list.
 */
class ConnectionsControllerTest extends TestCase
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

    // ------------------------------------------------------------------
    //  INDEX
    // ------------------------------------------------------------------

    public function test_index_returns_connections(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'accepted',
        ]);

        $response = $this->apiGet('/v2/connections');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_index_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/connections');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  PENDING COUNTS
    // ------------------------------------------------------------------

    public function test_pending_counts_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/connections/pending');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_pending_counts_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/connections/pending');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  STATUS
    // ------------------------------------------------------------------

    public function test_status_returns_connection_status(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiGet("/v2/connections/status/{$other->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_status_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/connections/status/1');

        $response->assertStatus(401);
    }

    public function test_status_with_self_returns_error(): void
    {
        // The route /v2/connections/status/me has a guard closure returning 422
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/connections/status/me');

        $response->assertStatus(422);
    }

    // ------------------------------------------------------------------
    //  REQUEST (send connection)
    // ------------------------------------------------------------------

    public function test_can_send_connection_request(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/connections/request', [
            'user_id' => $other->id,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_send_request_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/connections/request', [
            'user_id' => 1,
        ]);

        $response->assertStatus(401);
    }

    public function test_cannot_send_request_to_self(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/v2/connections/request', [
            'user_id' => $user->id,
        ]);

        $response->assertStatus(400);
    }

    public function test_cannot_send_duplicate_request(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'pending',
        ]);

        $response = $this->apiPost('/v2/connections/request', [
            'user_id' => $other->id,
        ]);

        $response->assertStatus(409);
    }

    public function test_send_request_fails_without_user_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/connections/request', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ------------------------------------------------------------------
    //  ACCEPT
    // ------------------------------------------------------------------

    public function test_receiver_can_accept_request(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = $this->authenticatedUser();

        $connection = Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $requester->id,
            'receiver_id' => $receiver->id,
            'status' => 'pending',
        ]);

        $response = $this->apiPost("/v2/connections/{$connection->id}/accept");

        $response->assertStatus(200);
        $response->assertJsonPath('data.status', 'connected');
        $this->apiGet("/v2/connections/status/{$requester->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'connected')
            ->assertJsonPath('data.connection_id', $connection->id);
        $accepted = $this->apiGet('/v2/connections?status=accepted')->assertOk();
        self::assertContains($requester->id, array_column(array_column($accepted->json('data'), 'user'), 'id'));
        $this->apiDelete("/v2/connections/{$connection->id}")->assertSuccessful();
        $this->apiGet("/v2/connections/status/{$requester->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'none');
        $remaining = $this->apiGet('/v2/connections?status=accepted')->assertOk();
        self::assertNotContains($requester->id, array_column(array_column($remaining->json('data'), 'user'), 'id'));
    }

    public function test_accept_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/connections/1/accept');

        $response->assertStatus(401);
    }

    public function test_accept_nonexistent_connection_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/connections/999999/accept');

        $response->assertStatus(404);
    }

    public function test_non_receiver_cannot_accept_request(): void
    {
        $requester = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();
        $stranger = $this->authenticatedUser();

        $connection = Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $requester->id,
            'receiver_id' => $receiver->id,
            'status' => 'pending',
        ]);

        $response = $this->apiPost("/v2/connections/{$connection->id}/accept");

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    // ------------------------------------------------------------------
    //  DESTROY
    // ------------------------------------------------------------------

    public function test_user_can_delete_own_connection(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $connection = Connection::factory()->forTenant($this->testTenantId)->create([
            'requester_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'accepted',
        ]);

        $response = $this->apiDelete("/v2/connections/{$connection->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_delete_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/connections/1');

        $response->assertStatus(401);
    }

    public function test_delete_nonexistent_connection_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/connections/999999');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_delete_other_tenant_connection(): void
    {
        $this->authenticatedUser();
        $otherConnection = Connection::factory()->forTenant(999)->create([
            'status' => 'accepted',
        ]);

        $response = $this->apiDelete("/v2/connections/{$otherConnection->id}");

        $response->assertStatus(404);
    }
}
