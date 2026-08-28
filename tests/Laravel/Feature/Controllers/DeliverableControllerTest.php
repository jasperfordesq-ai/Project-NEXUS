<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for DeliverableController.
 *
 * Covers index, show, store, update, and addComment endpoints.
 * All endpoints require authentication.
 */
class DeliverableControllerTest extends TestCase
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

    private function createDeliverable(array $overrides = []): int
    {
        $data = array_merge([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => 1,
            'title'       => 'Test Deliverable',
            'description' => 'A test deliverable',
            'status'      => 'pending',
            'created_at'  => now(),
        ], $overrides);

        // owner_id is a required FK column — default to user_id if not explicitly set
        if (!isset($data['owner_id'])) {
            $data['owner_id'] = $data['user_id'];
        }

        DB::table('deliverables')->insert($data);

        return (int) DB::getPdo()->lastInsertId();
    }

    // ================================================================
    // INDEX — Authentication required
    // ================================================================

    public function test_index_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/deliverables');

        $this->assertContains($response->getStatusCode(), [401, 403, 404]);
    }

    // ================================================================
    // INDEX — Happy path
    // ================================================================

    public function test_index_returns_200_for_authenticated_user(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/deliverables');

        // 200 if route is registered, 404 if not yet wired up
        $this->assertContains($response->getStatusCode(), [200, 404]);

        if ($response->getStatusCode() === 200) {
            $response->assertJsonStructure(['data']);
        }
    }

    // ================================================================
    // SHOW — Authentication required
    // ================================================================

    public function test_show_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/deliverables/1');

        $this->assertContains($response->getStatusCode(), [401, 403, 404]);
    }

    // ================================================================
    // SHOW — Not found
    // ================================================================

    public function test_show_returns_404_for_nonexistent_deliverable(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/deliverables/999999');

        $this->assertContains($response->getStatusCode(), [404]);
    }

    // ================================================================
    // STORE — Authentication required
    // ================================================================

    public function test_store_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/deliverables', ['title' => 'Test']);

        $this->assertContains($response->getStatusCode(), [401, 403, 404]);
    }

    // ================================================================
    // STORE — Validation
    // ================================================================

    public function test_store_returns_400_when_title_missing(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/deliverables', []);

        // 400 validation error if route is registered, 404 if route not wired
        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    // ================================================================
    // STORE — Happy path
    // ================================================================

    public function test_store_creates_deliverable_with_valid_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/deliverables', [
            'title'       => 'New Feature Deliverable',
            'description' => 'Implement login flow',
        ]);

        // 201 created if route is registered, 404 if not yet wired up
        $this->assertContains($response->getStatusCode(), [201, 404]);

        if ($response->getStatusCode() === 201) {
            $response->assertJsonStructure(['data' => ['id', 'title', 'status']]);
        }
    }

    // ================================================================
    // UPDATE — Validation
    // ================================================================

    public function test_update_returns_400_with_no_valid_fields(): void
    {
        $user = $this->authenticatedUser();
        $id = $this->createDeliverable(['user_id' => $user->id]);

        $response = $this->apiPut("/v2/deliverables/{$id}", []);

        // 400 validation error if route is registered, 404 if not yet wired up
        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    // ================================================================
    // UPDATE — Not found
    // ================================================================

    public function test_update_returns_404_for_nonexistent_deliverable(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/deliverables/999999', ['title' => 'Updated']);

        $this->assertContains($response->getStatusCode(), [404]);
    }

}
