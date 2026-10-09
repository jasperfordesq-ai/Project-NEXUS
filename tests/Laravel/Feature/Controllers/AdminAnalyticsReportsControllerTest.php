<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminAnalyticsReportsController.
 *
 * Covers social value, member reports, hours reports, export types,
 * inactive members, moderation queue, and moderation stats.
 */
class AdminAnalyticsReportsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaringCommunityFeature(bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }

        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    // ================================================================
    // SOCIAL VALUE — GET /v2/admin/reports/social-value
    // ================================================================

    public function test_social_value_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/social-value');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_social_value_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/social-value');

        $response->assertStatus(403);
    }

    public function test_social_value_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/reports/social-value');

        $response->assertStatus(401);
    }

    // ================================================================
    // UPDATE SOCIAL VALUE CONFIG — PUT /v2/admin/reports/social-value/config
    // ================================================================

    public function test_update_social_value_config_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/reports/social-value/config', [
            'hour_value_currency' => 'EUR',
            'hour_value_amount' => 20.00,
            'social_multiplier' => 4.0,
            'reporting_period' => 'quarterly',
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_update_social_value_config_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPut('/v2/admin/reports/social-value/config', [
            'hour_value_amount' => 20.00,
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // MEMBER REPORTS — GET /v2/admin/reports/members
    // ================================================================

    public function test_member_reports_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/members?type=active');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_member_reports_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/members');

        $response->assertStatus(403);
    }

    // ================================================================
    // HOURS REPORTS — GET /v2/admin/reports/hours
    // ================================================================

    public function test_hours_reports_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/hours?group_by=category');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_hours_reports_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/hours');

        $response->assertStatus(403);
    }

    // ================================================================
    // EXPORT TYPES — GET /v2/admin/reports/export-types
    // ================================================================

    public function test_export_types_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/export-types');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_export_types_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/reports/export-types');

        $response->assertStatus(401);
    }

    public function test_export_types_hide_municipal_impact_when_caring_community_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/export-types');

        $response->assertStatus(200);
        $response->assertJsonMissing(['type' => 'municipal_impact']);
    }

    public function test_municipal_impact_export_returns_403_when_caring_community_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal_impact/export?format=pdf');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    // ================================================================
    // MUNICIPAL IMPACT REPORT — GET /v2/admin/reports/municipal-impact
    // ================================================================

    public function test_municipal_impact_returns_200_for_admin(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_municipal_impact_includes_sroi_methodology(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'sroi_methodology' => [
                    'formula' => ['verified_hours', 'direct_value', 'social_value', 'total_value'],
                    'inputs',
                    'assumptions',
                    'caveat',
                ],
            ],
        ]);
    }

    public function test_municipal_impact_returns_403_for_member(): void
    {
        $this->setCaringCommunityFeature(true);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact');

        $response->assertStatus(403);
    }

    public function test_municipal_impact_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/reports/municipal-impact');

        $response->assertStatus(401);
    }

    public function test_municipal_impact_returns_403_when_caring_community_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_municipal_verification_dns_token_workflow(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $start = $this->apiPost('/v2/admin/reports/municipal-impact/verification/dns', [
            'domain' => 'Gemeinde-Cham.ch',
        ]);

        $start->assertStatus(201);
        $start->assertJsonPath('data.verification.domain', 'gemeinde-cham.ch');
        $start->assertJsonPath('data.verification.method', 'dns_txt');
        $start->assertJsonPath('data.verification.status', 'pending');
        $this->assertStringStartsWith(
            '_nexus-municipal.gemeinde-cham.ch',
            $start->json('data.verification.dns_record_name')
        );
        $this->assertStringStartsWith(
            'nexus-municipal-verify=',
            $start->json('data.verification.dns_record_value')
        );

        $status = $this->apiGet('/v2/admin/reports/municipal-impact/verification');
        $status->assertStatus(200);
        $status->assertJsonPath('data.verified', false);
        $status->assertJsonPath('data.items.0.domain', 'gemeinde-cham.ch');
    }

    public function test_municipal_verification_attestation_and_revoke(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $attest = $this->apiPost('/v2/admin/reports/municipal-impact/verification/attest', [
            'domain' => 'cham.ch',
            'attestation_note' => 'Verified by municipal administrator.',
        ]);

        $attest->assertStatus(200);
        $attest->assertJsonPath('data.verification.domain', 'cham.ch');
        $attest->assertJsonPath('data.verification.method', 'admin_attestation');
        $attest->assertJsonPath('data.verification.status', 'verified');

        $id = (int) $attest->json('data.verification.id');
        $status = $this->apiGet('/v2/admin/reports/municipal-impact/verification');
        $status->assertStatus(200);
        $status->assertJsonPath('data.verified', true);
        $status->assertJsonPath('data.active.domain', 'cham.ch');

        $revoke = $this->apiPost('/v2/admin/reports/municipal-impact/verification/' . $id . '/revoke');
        $revoke->assertStatus(200);

        $after = $this->apiGet('/v2/admin/reports/municipal-impact/verification');
        $after->assertStatus(200);
        $after->assertJsonPath('data.verified', false);
        $after->assertJsonPath('data.items.0.status', 'revoked');
    }

    public function test_municipal_verification_is_hidden_when_caring_community_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact/verification');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    // ================================================================
    // MUNICIPAL IMPACT TEMPLATES — /v2/admin/reports/municipal-impact/templates
    // ================================================================

    public function test_municipal_impact_templates_returns_200_for_admin(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact/templates');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['templates']]);
    }

    public function test_municipal_impact_templates_returns_403_for_member(): void
    {
        $this->setCaringCommunityFeature(true);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact/templates');

        $response->assertStatus(403);
    }

    public function test_municipal_impact_templates_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/reports/municipal-impact/templates');

        $response->assertStatus(401);
    }

    public function test_municipal_impact_templates_returns_403_when_caring_community_disabled(): void
    {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/municipal-impact/templates');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_create_municipal_impact_template_returns_201_for_admin(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/reports/municipal-impact/templates', [
            'name' => 'Test Template ' . uniqid(),
            'description' => 'A test description',
            'audience' => 'council',
            'date_preset' => 'last_year',
            'include_social_value' => true,
            'sections' => ['overview', 'breakdown'],
        ]);

        $response->assertStatus(201);
        $response->assertJsonStructure(['data' => ['template', 'message']]);
    }

    public function test_create_municipal_impact_template_returns_400_when_name_missing(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/reports/municipal-impact/templates', [
            'name' => '',
        ]);

        $response->assertStatus(400);
    }

    public function test_create_municipal_impact_template_returns_403_for_member(): void
    {
        $this->setCaringCommunityFeature(true);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/reports/municipal-impact/templates', [
            'name' => 'Test Template',
        ]);

        $response->assertStatus(403);
    }

    public function test_create_municipal_impact_template_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/reports/municipal-impact/templates', [
            'name' => 'Test Template',
        ]);

        $response->assertStatus(401);
    }

    // ================================================================
    // INACTIVE MEMBERS — /v2/admin/members/inactive
    // ================================================================

    public function test_inactive_members_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/members/inactive');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['members', 'stats']]);
    }

    public function test_inactive_members_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/members/inactive');

        $response->assertStatus(403);
    }

    public function test_inactive_members_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/members/inactive');

        $response->assertStatus(401);
    }

    // ================================================================
    // DETECT INACTIVE — POST /v2/admin/members/inactive/detect
    // ================================================================

    public function test_detect_inactive_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/members/inactive/detect', [
            'threshold_days' => 90,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_detect_inactive_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/members/inactive/detect', []);

        $response->assertStatus(403);
    }

    public function test_detect_inactive_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/members/inactive/detect', []);

        $response->assertStatus(401);
    }

    // ================================================================
    // MARK INACTIVE NOTIFIED — POST /v2/admin/members/inactive/notify
    // ================================================================

    public function test_mark_inactive_notified_returns_400_when_user_ids_missing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/members/inactive/notify', []);

        $response->assertStatus(400);
    }

    public function test_mark_inactive_notified_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/members/inactive/notify', [
            'user_ids' => [1, 2],
        ]);

        $response->assertStatus(403);
    }

    public function test_mark_inactive_notified_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/members/inactive/notify', [
            'user_ids' => [1],
        ]);

        $response->assertStatus(401);
    }

    // ================================================================
    // EXPORT REPORT — GET /v2/admin/reports/{type}/export
    // ================================================================

    public function test_export_report_returns_400_for_unknown_type(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/reports/nonexistent_type/export');

        $response->assertStatus(400);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_export_report_returns_400_for_invalid_format(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // xlsx is now a supported format (IT-Data-01 native XLSX export);
        // use a genuinely unsupported format to exercise the 400 path.
        $response = $this->apiGet('/v2/admin/reports/transactions/export?format=docx');

        $response->assertStatus(400);
    }

    public function test_member_directory_export_needs_a_fresh_second_factor(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'is_approved' => 1]);
        $token = fn (array $claims) => ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken($admin->id, $admin->tenant_id, $claims)];

        // Signed in an hour ago: asked for a second factor, nothing sent.
        $this->apiGet('/v2/admin/reports/members/export?format=csv', $token(['mfa_method' => 'totp', 'mfa_verified_at' => time() - 3600]))
            ->assertStatus(403)->assertJsonPath('errors.0.code', 'AUTH_STEP_UP_REQUIRED');

        // Fresh second factor: the file is sent.
        $this->apiGet('/v2/admin/reports/members/export?format=csv', $token(TwoFactorPolicy::claims('totp')))->assertOk();

        // The other report types are unchanged: no second factor asked for.
        $this->apiGet('/v2/admin/reports/transactions/export?format=csv', $token(['mfa_method' => 'totp', 'mfa_verified_at' => time() - 3600]))->assertOk();
    }

    public function test_export_report_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/reports/members/export');

        $response->assertStatus(403);
    }

    public function test_export_report_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/reports/members/export');

        $response->assertStatus(401);
    }

    // ================================================================
    // MODERATION QUEUE — GET /v2/admin/moderation/queue
    // ================================================================

    public function test_moderation_queue_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/moderation/queue');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_moderation_queue_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/moderation/queue');

        $response->assertStatus(403);
    }

    public function test_moderation_queue_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/moderation/queue');

        $response->assertStatus(401);
    }

    // ================================================================
    // MODERATION REVIEW — POST /v2/admin/moderation/{id}/review
    // ================================================================

    public function test_moderation_review_returns_400_when_decision_missing(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/moderation/999/review', []);

        $response->assertStatus(400);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_moderation_review_returns_422_for_invalid_decision(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/moderation/999/review', [
            'decision' => 'escalate',
        ]);

        $response->assertStatus(422);
        $response->assertJsonPath('errors.0.code', 'VALIDATION_ERROR');
    }

    public function test_moderation_review_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/moderation/1/review', [
            'decision' => 'approved',
        ]);

        $response->assertStatus(403);
    }

    public function test_moderation_review_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPost('/v2/admin/moderation/1/review', [
            'decision' => 'approved',
        ]);

        $response->assertStatus(401);
    }

    // ================================================================
    // MODERATION STATS — GET /v2/admin/moderation/stats
    // ================================================================

    public function test_moderation_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/moderation/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['pending', 'approved', 'rejected', 'flagged', 'total']]);
    }

    public function test_moderation_stats_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/moderation/stats');

        $response->assertStatus(403);
    }

    public function test_moderation_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/moderation/stats');

        $response->assertStatus(401);
    }

    // ================================================================
    // MODERATION SETTINGS — GET /v2/admin/moderation/settings
    // ================================================================

    public function test_moderation_settings_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/moderation/settings');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_moderation_settings_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/moderation/settings');

        $response->assertStatus(403);
    }

    public function test_moderation_settings_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/moderation/settings');

        $response->assertStatus(401);
    }

    // ================================================================
    // UPDATE MODERATION SETTINGS — PUT /v2/admin/moderation/settings
    // ================================================================

    public function test_update_moderation_settings_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPut('/v2/admin/moderation/settings', [
            'enabled' => true,
            'require_post' => false,
            'auto_filter' => true,
        ]);

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => ['message', 'settings']]);
    }

    public function test_update_moderation_settings_strips_unknown_keys(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Unknown keys like 'evil_key' should be silently stripped — no error, no persistence.
        $response = $this->apiPut('/v2/admin/moderation/settings', [
            'enabled' => true,
            'evil_key' => 'should_be_stripped',
        ]);

        $response->assertStatus(200);
    }

    public function test_update_moderation_settings_returns_403_for_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPut('/v2/admin/moderation/settings', [
            'enabled' => true,
        ]);

        $response->assertStatus(403);
    }

    public function test_update_moderation_settings_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiPut('/v2/admin/moderation/settings', [
            'enabled' => true,
        ]);

        $response->assertStatus(401);
    }
}
