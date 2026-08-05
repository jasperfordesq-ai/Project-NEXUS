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
 * Feature tests for AdminEnterpriseController.
 *
 * Covers dashboard, roles, permissions, GDPR, monitoring, health, logs, config, secrets, legal docs.
 */
class AdminEnterpriseControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // DASHBOARD — GET /v2/admin/enterprise/dashboard
    // ================================================================

    public function test_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['user_count', 'role_count', 'pending_gdpr_requests', 'health_status'],
        ]);
    }

    public function test_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/enterprise/dashboard');

        $response->assertStatus(403);
    }

    public function test_dashboard_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/enterprise/dashboard');

        $response->assertStatus(401);
    }

    // ================================================================
    // ROLES — GET /v2/admin/enterprise/roles
    // ================================================================

    public function test_roles_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/roles');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_roles_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/enterprise/roles');

        $response->assertStatus(403);
    }

    // ================================================================
    // PERMISSIONS — GET /v2/admin/enterprise/permissions
    // ================================================================

    public function test_permissions_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/permissions');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // GDPR DASHBOARD — GET /v2/admin/enterprise/gdpr/dashboard
    // ================================================================

    public function test_gdpr_dashboard_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/gdpr/dashboard');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_gdpr_dashboard_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/enterprise/gdpr/dashboard');

        $response->assertStatus(403);
    }

    // ================================================================
    // GDPR REQUESTS — GET /v2/admin/enterprise/gdpr/requests
    // ================================================================

    public function test_gdpr_requests_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/gdpr/requests');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /**
     * Regression: marking a GDPR request "completed" wrote to a non-existent
     * `completed_at` column, so the UPDATE threw and the endpoint returned 500
     * ("Failed to update GDPR request"). The real column is `processed_at`, and
     * the admin who completes it is recorded in `processed_by`.
     */
    public function test_update_gdpr_request_mark_completed_sets_processed_at(): void
    {
        $admin   = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $requestId = DB::table('gdpr_requests')->insertGetId([
            'user_id'      => $subject->id,
            'tenant_id'    => $this->testTenantId,
            'request_type' => 'access',
            'status'       => 'pending',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $response = $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
            'status' => 'completed',
        ]);

        $response->assertStatus(200);

        $row = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('completed', $row->status);
        $this->assertNotNull($row->processed_at, 'processed_at must be set when a request is marked completed');
        $this->assertSame((int) $admin->id, (int) $row->processed_by);
    }

    /**
     * 🔴 Marking an ERASURE request 'completed' used to write the status string and
     * nothing else — stamping processed_at and processed_by while the member's data
     * remained entirely intact. That manufactures a false compliance record, and it
     * also silences the daily overdue-request alarm, because the request no longer
     * looks open.
     *
     * Note the wider design is deliberate: there is no automated erasure worker
     * on purpose (see OverdueGdprRequestCheck — "fulfilling a DSAR is a human/legal
     * decision"). The administrator's action is meant to be the trigger; it just
     * never did anything.
     */
    public function test_completing_an_erasure_request_actually_erases_the_member(): void
    {
        $admin   = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $subject = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'erase-me-' . uniqid() . '@example.com',
            'first_name' => 'Erase',
            'last_name' => 'Me',
        ]);
        $originalEmail = $subject->email;
        Sanctum::actingAs($admin);

        $requestId = DB::table('gdpr_requests')->insertGetId([
            'user_id'      => $subject->id,
            'tenant_id'    => $this->testTenantId,
            'request_type' => 'erasure',
            'status'       => 'pending',
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $response = $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", [
            'status' => 'completed',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.erasure_performed', true);

        $row = DB::table('users')->where('id', $subject->id)
            ->first(['email', 'first_name', 'status', 'deleted_at', 'anonymized_at']);

        $this->assertNotNull($row, 'Erasure anonymises the row rather than deleting it.');
        $this->assertNotSame($originalEmail, $row->email, 'The email must not survive an Article 17 erasure.');
        $this->assertStringContainsString('@anonymized.local', (string) $row->email);
        $this->assertSame('Deleted', $row->first_name);
        $this->assertNotNull($row->anonymized_at);

        $request = DB::table('gdpr_requests')->where('id', $requestId)->first();
        $this->assertSame('completed', $request->status);
        $this->assertNotNull($request->processed_at);
    }

    public function test_completing_an_erasure_request_twice_does_not_error(): void
    {
        // A request already completed must not attempt a second erasure.
        $admin   = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $subject = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $requestId = DB::table('gdpr_requests')->insertGetId([
            'user_id'      => $subject->id,
            'tenant_id'    => $this->testTenantId,
            'request_type' => 'erasure',
            'status'       => 'completed',
            'processed_at' => now(),
            'created_at'   => now(),
            'updated_at'   => now(),
        ]);

        $this->apiPut("/v2/admin/enterprise/gdpr/requests/{$requestId}", ['status' => 'completed'])
            ->assertStatus(200);

        // Untouched: the guard skips an already-completed request.
        $this->assertNotNull(DB::table('users')->where('id', $subject->id)->value('email'));
    }

    // ================================================================
    // MONITORING — GET /v2/admin/enterprise/monitoring
    // ================================================================

    public function test_monitoring_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/monitoring');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_monitoring_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/enterprise/monitoring');

        $response->assertStatus(403);
    }

    // ================================================================
    // HEALTH CHECK — GET /v2/admin/enterprise/monitoring/health
    // ================================================================

    public function test_health_check_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/monitoring/health');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['status', 'checks' => ['*' => ['code', 'status']]]]);
        $this->assertSame('database', $response->json('data.checks.0.code'));
        $this->assertArrayNotHasKey('name', $response->json('data.checks.0'));

        $extensionCheck = collect($response->json('data.checks'))->firstWhere('code', 'php_extension');
        $this->assertNotNull($extensionCheck);
        $this->assertArrayHasKey('extension', $extensionCheck['params']);
    }

    // ================================================================
    // LOGS — GET /v2/admin/enterprise/monitoring/logs
    // ================================================================

    public function test_logs_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/monitoring/logs');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    // ================================================================
    // CONFIG — GET /v2/admin/enterprise/config
    // ================================================================

    public function test_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/config');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_config_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/enterprise/config');

        $response->assertStatus(403);
    }

    public function test_disabling_registration_through_enterprise_config_updates_public_registration_status_after_cache_warm(): void
    {
        DB::table('tenant_registration_policies')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'registration_mode' => 'open',
                'verification_level' => 'none',
                'post_verification' => 'activate',
                'fallback_mode' => 'none',
                'require_email_verify' => 1,
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.registration_mode'],
            [
                'setting_value' => 'open',
                'setting_type' => 'string',
                'updated_at' => now(),
            ]
        );
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $this->apiGet('/v2/auth/registration-info')
            ->assertStatus(200)
            ->assertJsonPath('data.can_register', true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/enterprise/config', [
            'registration_enabled' => false,
        ])->assertStatus(200);

        $this->apiGet('/v2/auth/registration-info')
            ->assertStatus(200)
            ->assertJsonPath('data.can_register', false)
            ->assertJsonPath('data.is_closed', true)
            ->assertJsonPath('data.registration_mode', 'closed');
    }

    // ================================================================
    // LEGAL DOCS — GET /v2/admin/legal-documents
    // ================================================================

    public function test_legal_docs_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_legal_docs_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/legal-documents');

        $response->assertStatus(403);
    }

    public function test_legal_docs_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/legal-documents');

        $response->assertStatus(401);
    }
}
