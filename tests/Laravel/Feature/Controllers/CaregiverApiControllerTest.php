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
        $links->assertJsonPath('data.0.id', $link->json('data.id'));
        $links->assertJsonPath('data.0.status', 'pending');
        $links->assertJsonPath('data.0.cared_for_name', 'Mira Receiver');

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

    public function test_staff_can_review_and_activate_a_pending_link_only_after_recording_consent(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        $careReceiver = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Pat',
            'last_name' => 'Receiver',
        ]);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        Sanctum::actingAs($caregiver);
        $created = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $careReceiver->id,
            'relationship_type' => 'friend',
            'start_date' => now()->toDateString(),
        ]);
        $created->assertStatus(202);
        $linkId = (int) $created->json('data.id');

        Sanctum::actingAs($admin);
        $queue = $this->apiGet('/v2/admin/caring-community/caregiver-links?status=pending');
        $queue->assertStatus(200);
        $queue->assertJsonPath('data.0.id', $linkId);
        $queue->assertJsonPath('data.0.caregiver_id', $caregiver->id);
        $queue->assertJsonPath('data.0.cared_for_id', $careReceiver->id);

        $withoutConsent = $this->apiPost("/v2/admin/caring-community/caregiver-links/{$linkId}/approve", [
            'consent_verified' => false,
        ]);
        $withoutConsent->assertStatus(422);
        $withoutConsent->assertJsonPath('errors.0.code', 'CONSENT_REQUIRED');

        $withoutRecipientConfirmation = $this->apiPost("/v2/admin/caring-community/caregiver-links/{$linkId}/approve", [
            'consent_verified' => true,
            'consent_evidence' => 'Staff note before recipient action.',
        ]);
        $withoutRecipientConfirmation->assertStatus(422);
        $withoutRecipientConfirmation->assertJsonPath('errors.0.code', 'CONSENT_REQUIRED');

        Sanctum::actingAs($careReceiver);
        $this->apiPost("/v2/caring-community/caregiver/incoming-links/{$linkId}/confirm")
            ->assertStatus(200);

        Sanctum::actingAs($admin);
        $approved = $this->apiPost("/v2/admin/caring-community/caregiver-links/{$linkId}/approve", [
            'consent_verified' => true,
            'consent_evidence' => 'Care recipient confirmed by telephone.',
        ]);
        $approved->assertStatus(200);
        $approved->assertJsonPath('data.status', 'active');
        $approved->assertJsonPath('data.approved_by', $admin->id);

        $this->assertDatabaseHas('caring_caregiver_links', [
            'id' => $linkId,
            'tenant_id' => $this->testTenantId,
            'status' => 'active',
            'approved_by' => $admin->id,
            'consent_verified_by' => $admin->id,
        ]);

        Sanctum::actingAs($caregiver);
        $links = $this->apiGet('/v2/caring-community/caregiver/links');
        $links->assertJsonPath('data.0.status', 'active');

        $request = $this->apiPost('/v2/caring-community/caregiver/request-on-behalf', [
            'cared_for_id' => $careReceiver->id,
            'title' => 'Prescription collection',
            'description' => 'Please collect this afternoon.',
        ]);
        $request->assertStatus(201);
        $request->assertJsonPath('data.is_on_behalf', 1);

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $caregiver->id,
            'type' => 'caring_caregiver_link_approved',
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $careReceiver->id,
            'type' => 'caring_caregiver_link_approved',
        ]);
    }

    public function test_care_recipient_can_confirm_or_reject_only_their_own_pending_request(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $caregiver = User::factory()->forTenant($this->testTenantId)->create();
        $careReceiver = User::factory()->forTenant($this->testTenantId)->create();
        $otherMember = User::factory()->forTenant($this->testTenantId)->create();

        Sanctum::actingAs($caregiver);
        $first = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $careReceiver->id,
            'relationship_type' => 'neighbour',
            'start_date' => now()->toDateString(),
        ]);
        $first->assertStatus(202);
        $firstId = (int) $first->json('data.id');

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $careReceiver->id,
            'type' => 'caring_caregiver_link_requested',
        ]);

        Sanctum::actingAs($otherMember);
        $this->apiPost("/v2/caring-community/caregiver/incoming-links/{$firstId}/confirm")
            ->assertStatus(404);

        Sanctum::actingAs($careReceiver);
        $incoming = $this->apiGet('/v2/caring-community/caregiver/incoming-links');
        $incoming->assertStatus(200);
        $incoming->assertJsonPath('data.0.id', $firstId);
        $incoming->assertJsonPath('data.0.recipient_confirmed_at', null);

        $confirmed = $this->apiPost("/v2/caring-community/caregiver/incoming-links/{$firstId}/confirm");
        $confirmed->assertStatus(200);
        $confirmed->assertJsonPath('data.status', 'pending');
        $this->assertNotNull($confirmed->json('data.recipient_confirmed_at'));

        Sanctum::actingAs($caregiver);
        $second = $this->apiPost('/v2/caring-community/caregiver/links', [
            'cared_for_id' => $otherMember->id,
            'relationship_type' => 'friend',
            'start_date' => now()->toDateString(),
        ]);
        $secondId = (int) $second->json('data.id');

        Sanctum::actingAs($otherMember);
        $rejected = $this->apiPost("/v2/caring-community/caregiver/incoming-links/{$secondId}/reject", [
            'reason' => 'I did not request this relationship.',
        ]);
        $rejected->assertStatus(200);
        $rejected->assertJsonPath('data.status', 'rejected');

        Sanctum::actingAs($caregiver);
        $links = $this->apiGet('/v2/caring-community/caregiver/links');
        $links->assertStatus(200);
        $this->assertContains('rejected', array_column($links->json('data'), 'status'));
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $caregiver->id,
            'type' => 'caring_caregiver_link_rejected',
        ]);
    }

    public function test_member_cannot_use_staff_queue_and_staff_queue_is_tenant_scoped(): void
    {
        $this->requireCaregiverTables();
        $this->setCaringCommunityFeature(true);

        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);
        $this->apiGet('/v2/admin/caring-community/caregiver-links')->assertStatus(403);

        $otherTenantCaregiver = User::factory()->forTenant(999)->create();
        $otherTenantReceiver = User::factory()->forTenant(999)->create();
        DB::table('caring_caregiver_links')->insert([
            'tenant_id' => 999,
            'caregiver_id' => $otherTenantCaregiver->id,
            'cared_for_id' => $otherTenantReceiver->id,
            'relationship_type' => 'family',
            'start_date' => now()->toDateString(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);
        $queue = $this->apiGet('/v2/admin/caring-community/caregiver-links?status=pending');
        $queue->assertStatus(200);
        $this->assertNotContains($otherTenantCaregiver->id, array_column($queue->json('data'), 'caregiver_id'));
    }
}
