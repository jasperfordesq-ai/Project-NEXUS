<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class CaregiverApiControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }

        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function requireCaregiverTables(): void
    {
        if (
            ! Schema::hasTable('caring_caregiver_links')
            || ! Schema::hasTable('caring_help_requests')
        ) {
            $this->markTestSkipped('Caregiver support tables are not present in the test database.');
        }
    }

    public function test_caregiver_can_link_receiver_and_create_on_behalf_help_request(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        // Name PARTS, not `name`: UserObserver::saving() recomputes the stored
        // column from first_name/last_name.
        $careReceiver = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Mira',
            'last_name' => 'Receiver',
        ]);
        Sanctum::actingAs($caregiver);

        $link = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $careReceiver->id,
            'relationship_type' => 'family',
            'start_date' => now()->toDateString(),
            'notes' => 'Primary family support contact.',
            'is_primary' => true,
        ]);

        $link->assertStatus(202);
        $link->assertJsonPath('data.caregiver_id', $caregiver->id);
        $link->assertJsonPath('data.cared_for_id', $careReceiver->id);
        $link->assertJsonPath('data.status', 'pending');

        $links = $this->apiGet('/v2/caring-community/caregiver/links');
        $links->assertStatus(200);
        $links->assertJsonPath('data', []);

        $pendingRequest = $this->apiPost('/v2/caring-community/caregiver/request-on-behalf', [
            'cared_for_id' => $careReceiver->id,
            'title' => 'Medication pickup',
            'description' => 'Please collect the prescription before Friday afternoon.',
            'when_needed' => 'Friday afternoon',
            'contact_preference' => 'message',
        ]);
        $pendingRequest->assertStatus(403);

        DB::table('caring_caregiver_links')
            ->where('id', (int) $link->json('data.id'))
            ->where('tenant_id', $this->testTenantId)
            ->update([
                'status' => 'active',
                'approved_by' => $caregiver->id,
                'updated_at' => now(),
            ]);

        $links = $this->apiGet('/v2/caring-community/caregiver/links');
        $links->assertStatus(200);
        $links->assertJsonPath('data.0.cared_for_name', 'Mira Receiver');

        $request = $this->apiPost('/v2/caring-community/caregiver/request-on-behalf', [
            'cared_for_id' => $careReceiver->id,
            'title' => 'Medication pickup',
            'description' => 'Please collect the prescription before Friday afternoon.',
            'when_needed' => 'Friday afternoon',
            'contact_preference' => 'message',
        ]);

        $request->assertStatus(201);
        $request->assertJsonPath('data.user_id', $careReceiver->id);
        $request->assertJsonPath('data.requested_by_id', $caregiver->id);
        $request->assertJsonPath('data.is_on_behalf', 1);
        $request->assertJsonPath('data.status', 'pending');

        $this->assertDatabaseHas('caring_help_requests', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $careReceiver->id,
            'requested_by_id' => $caregiver->id,
            'is_on_behalf' => 1,
            'what' => "Medication pickup\n\nPlease collect the prescription before Friday afternoon.",
            'when_needed' => 'Friday afternoon',
            'contact_preference' => 'message',
            'status' => 'pending',
        ]);
    }

    public function test_caregiver_cannot_link_receiver_from_another_tenant(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        $otherTenantReceiver = User::factory()->forTenant(999)->create();
        Sanctum::actingAs($caregiver);

        $response = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $otherTenantReceiver->id,
            'relationship_type' => 'family',
            'start_date' => now()->toDateString(),
        ]);

        $response->assertStatus(409);
        $response->assertJsonPath('errors.0.code', 'CONFLICT');

        $this->assertDatabaseMissing('caring_caregiver_links', [
            'tenant_id' => $this->testTenantId,
            'caregiver_id' => $caregiver->id,
            'cared_for_id' => $otherTenantReceiver->id,
        ]);
    }

    public function test_caregiver_can_relink_receiver_after_previous_link_was_removed(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        $careReceiver = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($caregiver);

        $first = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $careReceiver->id,
            'relationship_type' => 'family',
            'start_date' => now()->toDateString(),
        ]);
        $first->assertStatus(202);

        DB::table('caring_caregiver_links')
            ->where('id', (int) $first->json('data.id'))
            ->where('tenant_id', $this->testTenantId)
            ->update(['status' => 'active', 'approved_by' => $caregiver->id]);

        $deleteFirst = $this->apiDelete('/v2/caring-community/caregiver/links/' . $first->json('data.id'));
        $deleteFirst->assertStatus(204);

        $second = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $careReceiver->id,
            'relationship_type' => 'family',
            'start_date' => now()->toDateString(),
        ]);
        $second->assertStatus(202);

        DB::table('caring_caregiver_links')
            ->where('id', (int) $second->json('data.id'))
            ->where('tenant_id', $this->testTenantId)
            ->update(['status' => 'active', 'approved_by' => $caregiver->id]);

        $deleteSecond = $this->apiDelete('/v2/caring-community/caregiver/links/' . $second->json('data.id'));
        $deleteSecond->assertStatus(204);

        $this->assertDatabaseHas('caring_caregiver_links', [
            'tenant_id' => $this->testTenantId,
            'caregiver_id' => $caregiver->id,
            'cared_for_id' => $careReceiver->id,
            'status' => 'inactive',
        ]);
    }

    public function test_caregiver_routes_respect_caring_community_feature_gate(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(false);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($caregiver);

        $response = $this->apiGet('/v2/caring-community/caregiver/links');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }
}
