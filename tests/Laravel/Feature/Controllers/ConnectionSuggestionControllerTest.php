<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ConnectionSuggestionController.
 *
 * Covers:
 *  - GET /v2/connections/suggestions — "People You May Know" list (auth required)
 *  - Suggestions are tenant-scoped (cross-tenant users never appear)
 *  - Limit query parameter is honoured
 */
class ConnectionSuggestionControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_suggestions_requires_auth(): void
    {
        $response = $this->apiGet('/v2/connections/suggestions');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_suggestions_returns_envelope_for_authenticated_user(): void
    {
        $me = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($me);

        $response = $this->apiGet('/v2/connections/suggestions');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['suggestions']]);
    }

    public function test_suggestions_are_tenant_scoped(): void
    {
        // Seed cross-tenant users that should NOT appear in suggestions
        User::factory()->forTenant(999)->count(3)->create();

        $me = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($me);

        $response = $this->apiGet('/v2/connections/suggestions');

        $response->assertStatus(200);

        $suggestions = $response->json('data.suggestions') ?? [];
        $this->assertIsArray($suggestions);

        $returnedIds = array_column($suggestions, 'id');
        // All returned users must belong to the current tenant
        if (!empty($returnedIds)) {
            $tenantUsers = User::whereIn('id', $returnedIds)->pluck('tenant_id')->all();
            foreach ($tenantUsers as $tid) {
                $this->assertEquals($this->testTenantId, $tid);
            }
        }
    }

    public function test_suggestions_respects_limit_param(): void
    {
        $me = User::factory()->forTenant($this->testTenantId)->create();
        User::factory()->forTenant($this->testTenantId)->count(5)->create();
        Sanctum::actingAs($me);

        $response = $this->apiGet('/v2/connections/suggestions?limit=2');

        $response->assertStatus(200);
        $suggestions = $response->json('data.suggestions') ?? [];
        $this->assertLessThanOrEqual(2, count($suggestions));
    }

    public function test_suggestions_exclude_pending_and_unapproved_members(): void
    {
        $me = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        $pending = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'pending', 'is_approved' => false,
            'is_active' => true, 'privacy_search' => true,
        ]);
        $unapproved = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => false,
            'is_active' => true, 'privacy_search' => true,
        ]);
        Sanctum::actingAs($me);

        $response = $this->apiGet('/v2/connections/suggestions');
        $response->assertStatus(200);
        $ids = array_column($response->json('data.suggestions') ?? [], 'id');
        $this->assertNotContains($pending->id, $ids);
        $this->assertNotContains($unapproved->id, $ids);
    }

    public function test_suggestions_limit_above_max_is_clamped(): void
    {
        $me = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($me);

        $response = $this->apiGet('/v2/connections/suggestions?limit=9999');

        // queryInt clamps to max 20 — should not error
        $response->assertStatus(200);
    }
}
