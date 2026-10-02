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
 * Feature tests for AdminSafeguardingController.
 *
 * Covers dashboard, flaggedMessages, assignments, reviewMessage,
 * createAssignment, deleteAssignment.
 * Tables may not exist, so the controller gracefully handles missing tables.
 */
class AdminSafeguardingControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/safeguarding/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/safeguarding/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'active_assignments',
                'unreviewed_flags',
                'consented_wards',
                'total_flags_this_month',
                'critical_flags',
            ],
        ]);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/safeguarding/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_admits_coordinator_without_individual_permission(): void
    {
        // F-542: the broker panel's Safeguarding page is these endpoints, and
        // brokers and coordinators have the whole broker panel.
        $coordinator = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'coordinator',
            'status' => 'active',
        ]);
        Sanctum::actingAs($coordinator);

        $response = $this->apiGet('/v2/admin/safeguarding/dashboard');

        $response->assertStatus(200);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/safeguarding/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // FLAGGED MESSAGES — GET /v2/admin/safeguarding/flagged-messages
    // ================================================================

    public function test_flagged_messages_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/safeguarding/flagged-messages');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_flagged_messages_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/safeguarding/flagged-messages');

        $response->assertStatus(403);
    }

    // ================================================================
    // ASSIGNMENTS — GET /v2/admin/safeguarding/assignments
    // ================================================================

    public function test_assignments_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/safeguarding/assignments');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_assignments_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/safeguarding/assignments');

        $response->assertStatus(403);
    }

    // ================================================================
    // CREATE ASSIGNMENT — POST /v2/admin/safeguarding/assignments
    // ================================================================

    public function test_create_assignment_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/safeguarding/assignments', [
            'user_id' => 1,
            'assignee_id' => 2,
            'type' => 'dbs_check',
        ]);

        $response->assertStatus(403);
    }

    public function test_create_assignment_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/safeguarding/assignments', [
            'user_id' => 1,
            'assignee_id' => 2,
            'type' => 'dbs_check',
        ]);

        $response->assertStatus(401);
    }

    // ================================================================
    // DELETE ASSIGNMENT — DELETE /v2/admin/safeguarding/assignments/{id}
    // ================================================================

    public function test_delete_assignment_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/safeguarding/assignments/1');

        $response->assertStatus(403);
    }

    // ================================================================
    // REVIEW MESSAGE — POST /v2/admin/safeguarding/flagged-messages/{id}/review
    // ================================================================

    public function test_review_message_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/safeguarding/flagged-messages/1/review', [
            'action' => 'resolved',
            'notes' => 'Reviewed and resolved',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // DASHBOARD — structured data assertions
    // ================================================================

    public function test_dashboard_returns_structured_data(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/safeguarding/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'active_assignments',
                'unreviewed_flags',
                'consented_wards',
                'total_flags_this_month',
                'critical_flags',
            ],
        ]);

        // Verify all keys are numeric (even if zero)
        $data = $response->json('data');
        $this->assertIsInt($data['active_assignments']);
        $this->assertIsInt($data['unreviewed_flags']);
        $this->assertIsInt($data['consented_wards']);
        $this->assertIsInt($data['total_flags_this_month']);
        $this->assertIsInt($data['critical_flags']);
        $this->assertGreaterThanOrEqual(0, $data['active_assignments']);
        $this->assertGreaterThanOrEqual(0, $data['unreviewed_flags']);
        $this->assertGreaterThanOrEqual(0, $data['consented_wards']);
        $this->assertGreaterThanOrEqual(0, $data['total_flags_this_month']);
        $this->assertGreaterThanOrEqual(0, $data['critical_flags']);
    }

    // ================================================================
    // MEMBER PREFERENCES — consent data and structure
    // ================================================================

    public function test_member_preferences_returns_consent_data(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Create a user with safeguarding preferences
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'consent_test_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'Test Consent Option',
            'is_active' => 1,
            'sort_order' => 0,
            'triggers' => json_encode([]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $consentTime = now()->format('Y-m-d H:i:s');
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => $consentTime,
            'consent_ip' => '127.0.0.1',
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/safeguarding/member-preferences');

        $response->assertStatus(200);

        $data = $response->json('data');
        $this->assertIsArray($data);
        $this->assertNotEmpty($data, 'Should return at least one member with preferences');

        // Find the member we created
        $memberData = collect($data)->firstWhere('user_id', $member->id);
        $this->assertNotNull($memberData, 'Our test member should appear in the results');
        $this->assertNotNull($memberData['consent_given_at'], 'consent_given_at should be included');
        $this->assertArrayHasKey('options', $memberData);
        $this->assertNotEmpty($memberData['options'], 'Options list should not be empty');

        // Verify option labels are present
        $optionLabels = array_column($memberData['options'], 'label');
        $this->assertContains('Test Consent Option', $optionLabels, 'Option label should be present in response');
    }

    public function test_member_preferences_omits_false_checkbox_responses(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        Sanctum::actingAs($admin);

        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'false_admin_preference_' . uniqid(),
            'option_type' => 'checkbox',
            'label' => 'False admin preference',
            'is_active' => 1,
            'sort_order' => 0,
            'triggers' => json_encode(['requires_vetted_interaction' => true]),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'option_id' => $optionId,
            'selected_value' => '0',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/safeguarding/member-preferences');

        $response->assertOk();
        $this->assertNull(collect($response->json('data'))->firstWhere('user_id', $member->id));
    }

    // ================================================================
    // MEMBER PREFERENCES — audit log on access
    // ================================================================

    public function test_member_preferences_access_creates_audit_log(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Clear any pre-existing audit logs for this action
        DB::table('activity_log')
            ->where('action', 'safeguarding_preferences_list_viewed')
            ->where('user_id', $admin->id)
            ->delete();

        $response = $this->apiGet('/v2/admin/safeguarding/member-preferences');

        $response->assertStatus(200);

        // Verify audit log was created
        $log = DB::table('activity_log')
            ->where('action', 'safeguarding_preferences_list_viewed')
            ->where('user_id', $admin->id)
            ->first();

        $this->assertNotNull($log, 'Accessing member-preferences should create an audit log entry');
        $this->assertEquals('safeguarding', $log->action_type);
        $this->assertEquals('tenant', $log->entity_type);
        $this->assertNotNull($log->created_at);
    }
}
