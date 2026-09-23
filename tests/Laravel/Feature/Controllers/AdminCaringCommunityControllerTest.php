<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Jobs\SendPasswordResetEmail;
use App\Models\User;
use App\Services\CaringCommunity\VereinMemberImportService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class AdminCaringCommunityControllerTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Seed the verein_admin role + RBAC permissions that migration
     * 2026_04_28_150000_add_verein_admin_scope normally inserts. The CI schema
     * dump captures the schema but not these seeded rows, so any test that
     * exercises assignVereinAdmin() must seed them itself.
     */
    private function seedVereinAdminRbac(): void
    {
        DB::statement("
            INSERT IGNORE INTO roles (name, display_name, description, level, is_system, tenant_id)
            VALUES (
                'verein_admin',
                'Verein Admin',
                'Scoped association administrator for importing and managing members of one Verein.',
                4,
                1,
                NULL
            )
        ");

        $permissions = [
            ['verein.members.import', 'Import Verein Members', 'vereine'],
            ['verein.members.manage', 'Manage Verein Members', 'vereine'],
            ['verein.view', 'View Verein', 'vereine'],
        ];

        foreach ($permissions as [$name, $displayName, $category]) {
            DB::statement(
                'INSERT IGNORE INTO permissions (name, display_name, category) VALUES (?, ?, ?)',
                [$name, $displayName, $category]
            );
        }

        $roleId = DB::table('roles')->where('name', 'verein_admin')->value('id');
        if (!$roleId) {
            return;
        }

        foreach ($permissions as [$name]) {
            $permissionId = DB::table('permissions')->where('name', $name)->value('id');
            if ($permissionId) {
                DB::statement(
                    'INSERT IGNORE INTO role_permissions (role_id, permission_id, tenant_id) VALUES (?, ?, NULL)',
                    [$roleId, $permissionId]
                );
            }
        }
    }

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

    /**
     * @return array<string, array{0: string, 1: string, 2?: array<string, mixed>}>
     */
    public static function disabledAdminRoutes(): array
    {
        return [
            'workflow summary' => ['GET', '/v2/admin/caring-community/workflow'],
            'workflow policy update' => ['PUT', '/v2/admin/caring-community/workflow/policy', [
                'review_sla_days' => 5,
            ]],
            'review assignment' => ['PUT', '/v2/admin/caring-community/workflow/reviews/999/assign', [
                'assigned_to' => null,
            ]],
            'review escalation' => ['PUT', '/v2/admin/caring-community/workflow/reviews/999/escalate', [
                'note' => 'Needs coordinator review.',
            ]],
            'review decision' => ['PUT', '/v2/admin/caring-community/workflow/reviews/999/decision', [
                'action' => 'approve',
            ]],
            'role presets' => ['GET', '/v2/admin/caring-community/role-presets'],
            'role preset install' => ['POST', '/v2/admin/caring-community/role-presets/install', [
                'preset' => 'municipality_admin',
            ]],
            'member statement' => ['GET', '/v2/admin/caring-community/member-statements/999'],
            'support relationships' => ['GET', '/v2/admin/caring-community/support-relationships'],
            'support relationship create' => ['POST', '/v2/admin/caring-community/support-relationships', [
                'supporter_id' => 999,
                'recipient_id' => 998,
            ]],
            'support relationship update' => ['PUT', '/v2/admin/caring-community/support-relationships/999', [
                'status' => 'paused',
            ]],
            'support relationship hours' => ['POST', '/v2/admin/caring-community/support-relationships/999/hours', [
                'date' => '2026-04-20',
                'hours' => 1.5,
            ]],
            'verein import preview' => ['POST', '/v2/admin/caring-community/vereine/999/members/import/preview', [
                'csv' => "email,first_name,last_name\nmember@example.test,Ada,Lovelace",
            ]],
            'verein import' => ['POST', '/v2/admin/caring-community/vereine/999/members/import', [
                'csv' => "email,first_name,last_name\nmember@example.test,Ada,Lovelace",
            ]],
            'verein admin assign' => ['POST', '/v2/admin/caring-community/vereine/999/admins', [
                'user_id' => 999,
            ]],
            'nudge analytics' => ['GET', '/v2/admin/caring-community/nudges/analytics'],
            'nudge config' => ['PUT', '/v2/admin/caring-community/nudges/config', [
                'enabled' => true,
            ]],
            'nudge dispatch' => ['POST', '/v2/admin/caring-community/nudges/dispatch', [
                'dry_run' => true,
            ]],
            'paper onboarding list' => ['GET', '/v2/admin/caring-community/paper-onboarding'],
            'paper onboarding confirm' => ['POST', '/v2/admin/caring-community/paper-onboarding/999/confirm', [
                'name' => 'Ada Lovelace',
                'email' => 'ada.paper@example.test',
            ]],
        ];
    }

    /**
     * @dataProvider disabledAdminRoutes
     *
     * @param array<string, mixed> $payload
     */
    public function test_admin_caring_community_routes_return_403_when_feature_disabled(
        string $method,
        string $uri,
        array $payload = [],
    ): void {
        $this->setCaringCommunityFeature(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = match ($method) {
            'GET' => $this->apiGet($uri),
            'POST' => $this->apiPost($uri, $payload),
            'PUT' => $this->apiPut($uri, $payload),
            default => throw new \InvalidArgumentException("Unsupported method {$method}"),
        };

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_workflow_route_returns_401_for_unauthenticated_user(): void
    {
        $this->setCaringCommunityFeature(true);

        $response = $this->apiGet('/v2/admin/caring-community/workflow');

        $response->assertStatus(401);
    }

    public function test_broker_without_safeguarding_manage_permission_cannot_manage_reports(): void
    {
        $this->setCaringCommunityFeature(true);
        $broker = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker',
        ]);
        Sanctum::actingAs($broker);

        $response = $this->apiPost('/v2/admin/caring-community/safeguarding/reports/999/status', [
            'status' => 'closed',
            'notes' => 'Reviewed.',
        ]);

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
    }

    public function test_member_statement_returns_kiss_support_and_wallet_context(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create(['balance' => 7]);
        $owner = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        Sanctum::actingAs($admin);

        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id' => $this->testTenantId,
                'setting_key' => 'caring_community.workflow.default_hour_value_chf',
            ],
            [
                'setting_value' => '35',
                'setting_type' => 'integer',
                'category' => 'caring_community',
                'updated_at' => now(),
            ]
        );

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'KISS Zurich',
            'slug' => 'kiss-zurich-' . uniqid(),
            'status' => 'active',
            'balance' => 100,
            'created_at' => now(),
        ]);

        DB::table('vol_logs')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'organization_id' => $orgId,
                'date_logged' => '2026-04-10',
                'hours' => 4.00,
                'description' => 'Weekly neighbour visit.',
                'status' => 'approved',
                'created_at' => '2026-04-10 09:00:00',
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'organization_id' => $orgId,
                'date_logged' => '2026-04-12',
                'hours' => 1.50,
                'description' => 'Shopping accompaniment.',
                'status' => 'pending',
                'created_at' => '2026-04-12 09:00:00',
            ],
        ]);

        DB::table('transactions')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'sender_id' => $owner->id,
                'receiver_id' => $member->id,
                'amount' => 4,
                'description' => 'Volunteer auto-payment.',
                'transaction_type' => 'volunteer',
                'status' => 'completed',
                'created_at' => '2026-04-10 10:00:00',
                'updated_at' => '2026-04-10 10:00:00',
            ],
            [
                'tenant_id' => $this->testTenantId,
                'sender_id' => $member->id,
                'receiver_id' => $owner->id,
                'amount' => 1,
                'description' => 'Timebank exchange.',
                'transaction_type' => 'exchange',
                'status' => 'completed',
                'created_at' => '2026-04-15 10:00:00',
                'updated_at' => '2026-04-15 10:00:00',
            ],
        ]);

        $response = $this->apiGet("/v2/admin/caring-community/member-statements/{$member->id}?start_date=2026-04-01&end_date=2026-04-30");

        $response->assertStatus(200);
        $response->assertJsonPath('data.user.id', $member->id);
        $response->assertJsonPath('data.summary.approved_support_hours', 4);
        $response->assertJsonPath('data.summary.pending_support_hours', 1.5);
        $response->assertJsonPath('data.summary.wallet_hours_earned', 4);
        $response->assertJsonPath('data.summary.wallet_hours_spent', 1);
        $response->assertJsonPath('data.summary.estimated_social_value_chf', 140);
        $response->assertJsonPath('data.support_hours_by_organisation.0.organisation_name', 'KISS Zurich');
    }

    public function test_paper_onboarding_upload_and_confirm_creates_reviewed_member(): void
    {
        $this->setCaringCommunityFeature(true);
        Storage::fake('local');
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $uploadResponse = $this->post('/api/v2/admin/caring-community/paper-onboarding', [
            'file' => UploadedFile::fake()->create('kiss-consent.pdf', 100, 'application/pdf'),
            'name' => 'Marie Curie',
            'date_of_birth' => '1940-01-01',
            'address' => 'Dorfstrasse 7, Cham',
            'phone' => '+41 79 123 45 67',
            'email' => 'marie.paper@example.test',
        ], $this->withTenantHeader());

        $uploadResponse->assertStatus(201);
        $uploadResponse->assertJsonPath('data.status', 'pending_review');
        $uploadResponse->assertJsonPath('data.extracted_fields.name', 'Marie Curie');

        $intakeId = (int) $uploadResponse->json('data.id');

        $confirmResponse = $this->apiPost("/v2/admin/caring-community/paper-onboarding/{$intakeId}/confirm", [
            'name' => 'Marie Curie',
            'date_of_birth' => '1940-01-01',
            'address' => 'Dorfstrasse 7, Cham',
            'phone' => '+41 79 123 45 67',
            'email' => 'marie.paper@example.test',
            'note' => 'Reviewed from signed paper form.',
        ]);

        $confirmResponse->assertStatus(201);
        $confirmResponse->assertJsonPath('data.success', true);
        $confirmResponse->assertJsonPath('data.intake.status', 'confirmed');
        $confirmResponse->assertJsonPath('data.user.email', 'marie.paper@example.test');

        $this->assertDatabaseHas('users', [
            'tenant_id' => $this->testTenantId,
            'email' => 'marie.paper@example.test',
            'location' => 'Dorfstrasse 7, Cham',
        ]);

        $this->assertDatabaseHas('caring_paper_onboarding_intakes', [
            'tenant_id' => $this->testTenantId,
            'id' => $intakeId,
            'status' => 'confirmed',
        ]);
    }

    public function test_kpi_baseline_comparison_tracks_agoris_gemeinde_claim_targets(): void
    {
        if (! Schema::hasTable('caring_kpi_baselines') || ! Schema::hasTable('vol_logs')) {
            $this->markTestSkipped('KPI baseline or volunteer hour tables are not present in the test database.');
        }

        $this->setCaringCommunityFeature(true);
        DB::table('users')->where('tenant_id', $this->testTenantId)->update(['status' => 'inactive']);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        $supporters = [];
        for ($i = 0; $i < 4; $i++) {
            $supporters[] = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        }
        Sanctum::actingAs($admin);

        DB::table('vol_logs')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $supporters[0]->id,
                'organization_id' => null,
                'date_logged' => now()->subDays(3)->toDateString(),
                'hours' => 2.00,
                'description' => 'Neighbour visit.',
                'status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $supporters[1]->id,
                'organization_id' => null,
                'date_logged' => now()->subDays(2)->toDateString(),
                'hours' => 1.50,
                'description' => 'Shopping accompaniment.',
                'status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        if (Schema::hasTable('municipality_surveys')
            && Schema::hasTable('municipality_survey_questions')
            && Schema::hasTable('municipality_survey_responses')) {
            $surveyId = DB::table('municipality_surveys')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'created_by' => $admin->id,
                'title' => 'Gemeinde satisfaction pulse',
                'description' => null,
                'status' => 'closed',
                'is_anonymous' => 1,
                'target_audience' => null,
                'starts_at' => now()->subMonth(),
                'ends_at' => now(),
                'response_count' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $questionId = DB::table('municipality_survey_questions')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'survey_id' => $surveyId,
                'question_text' => 'How satisfied are you with community support?',
                'question_type' => 'likert',
                'options' => json_encode(['1', '2', '3', '4', '5']),
                'is_required' => 1,
                'sort_order' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            DB::table('municipality_survey_responses')->insert([
                'tenant_id' => $this->testTenantId,
                'survey_id' => $surveyId,
                'user_id' => null,
                'session_token' => hash('sha256', uniqid('survey', true)),
                'answers' => json_encode([(string) $questionId => '4']),
                'submitted_at' => now(),
                'ip_hash' => hash('sha256', '127.0.0.1'),
            ]);
        }

        $capture = $this->apiPost('/v2/admin/caring-community/kpi-baselines', [
            'label' => 'Before Gemeinde rollout',
            'period' => ['start' => '2026-01-01', 'end' => '2026-03-31'],
            'metrics' => [
                'engagement_rate_pct' => 30,
                'satisfaction_score' => 3.5,
                'information_distribution_effort_hours' => 10,
            ],
        ]);

        $capture->assertStatus(201);
        $capture->assertJsonPath('data.metrics.engagement_rate_pct', 30);
        $baselineId = (int) $capture->json('data.id');

        $compare = $this->apiGet("/v2/admin/caring-community/kpi-baselines/{$baselineId}/compare");

        $compare->assertStatus(200);
        $compare->assertJsonPath('data.comparison.volunteer_hours.current', 3.5);
        $compare->assertJsonPath('data.agoris_claim_targets.1.key', 'volunteer_engagement');
        $compare->assertJsonPath('data.agoris_claim_targets.1.achieved', true);
        $compare->assertJsonPath('data.agoris_claim_targets.2.key', 'satisfaction');
        $compare->assertJsonPath('data.agoris_claim_targets.2.achieved', true);
    }

    public function test_support_relationships_can_be_created_listed_and_paused(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $create = $this->apiPost('/v2/admin/caring-community/support-relationships', [
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'title' => 'Weekly companionship',
            'description' => 'Standing check-in and short local walk.',
            'frequency' => 'weekly',
            'expected_hours' => 2.5,
            'start_date' => '2026-04-20',
        ]);

        $create->assertStatus(201);
        $create->assertJsonPath('data.title', 'Weekly companionship');
        $create->assertJsonPath('data.frequency', 'weekly');
        $create->assertJsonPath('data.expected_hours', 2.5);
        $relationshipId = (int) $create->json('data.id');

        $list = $this->apiGet('/v2/admin/caring-community/support-relationships');
        $list->assertStatus(200);
        $list->assertJsonPath('data.stats.active_count', 1);
        $list->assertJsonPath('data.items.0.id', $relationshipId);

        $update = $this->apiPut("/v2/admin/caring-community/support-relationships/{$relationshipId}", [
            'status' => 'paused',
        ]);
        $update->assertStatus(200);
        $update->assertJsonPath('data.status', 'paused');

        $this->assertSame('paused', DB::table('caring_support_relationships')->where('id', $relationshipId)->value('status'));
    }

    public function test_support_relationship_hours_can_be_logged_without_partner_organisation(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['balance' => 0]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $relationshipId = DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter->id,
            'recipient_id' => $recipient->id,
            'coordinator_id' => $admin->id,
            'title' => 'Weekly neighbour check-in',
            'frequency' => 'weekly',
            'expected_hours' => 1.5,
            'start_date' => '2026-04-01',
            'status' => 'active',
            'next_check_in_at' => '2026-04-08 09:00:00',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost("/v2/admin/caring-community/support-relationships/{$relationshipId}/hours", [
            'date' => '2026-04-20',
            'hours' => 1.5,
            'description' => 'Visit and medication reminder.',
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.log.status', 'approved');
        $response->assertJsonPath('data.relationship.last_logged_at', fn ($value) => is_string($value) && $value !== '');

        $this->assertDatabaseHas('vol_logs', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $supporter->id,
            'organization_id' => null,
            'caring_support_relationship_id' => $relationshipId,
            'support_recipient_id' => $recipient->id,
            'date_logged' => '2026-04-20',
            'status' => 'approved',
        ]);

        $this->assertSame(
            '2026-04-27 09:00:00',
            DB::table('caring_support_relationships')->where('id', $relationshipId)->value('next_check_in_at'),
        );
    }

    public function test_kiss_review_decision_approves_and_pays_organisation_backed_hours(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create(['balance' => 2]);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);
        $existingPendingCount = (int) DB::table('vol_logs')
            ->where('tenant_id', $this->testTenantId)
            ->where('status', 'pending')
            ->count();

        $orgId = DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'name' => 'KISS Basel',
            'slug' => 'kiss-basel-' . uniqid(),
            'status' => 'active',
            'balance' => 10,
            'auto_pay_enabled' => 1,
            'created_at' => now(),
        ]);

        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $supporter->id,
            'organization_id' => $orgId,
            'date_logged' => '2026-04-20',
            'hours' => 2.75,
            'description' => 'Recurring support visit.',
            'status' => 'pending',
            'created_at' => '2026-04-20 09:00:00',
            'updated_at' => null,
        ]);

        $response = $this->apiPut("/v2/admin/caring-community/workflow/reviews/{$logId}/decision", [
            'action' => 'approve',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.review.status', 'approved');
        $response->assertJsonPath('data.review.payment_result', 'paid');
        $response->assertJsonPath('data.review.summary.stats.pending_count', $existingPendingCount);

        $this->assertSame('approved', DB::table('vol_logs')->where('id', $logId)->value('status'));
        $this->assertEqualsWithDelta(8.0, (float) DB::table('vol_organizations')->where('id', $orgId)->value('balance'), 0.001);
        $this->assertSame(4, (int) DB::table('users')->where('id', $supporter->id)->value('balance'));
        $this->assertDatabaseHas('vol_org_transactions', [
            'tenant_id' => $this->testTenantId,
            'vol_organization_id' => $orgId,
            'user_id' => $supporter->id,
            'vol_log_id' => $logId,
            'type' => 'volunteer_payment',
        ]);
    }

    public function test_kiss_review_decision_declines_relationship_hours_without_organisation(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $logId = DB::table('vol_logs')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $supporter->id,
            'organization_id' => null,
            'support_recipient_id' => $recipient->id,
            'date_logged' => '2026-04-20',
            'hours' => 1.25,
            'description' => 'Unverified support visit.',
            'status' => 'pending',
            'created_at' => '2026-04-20 09:00:00',
            'updated_at' => null,
        ]);

        $response = $this->apiPut("/v2/admin/caring-community/workflow/reviews/{$logId}/decision", [
            'action' => 'decline',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.review.status', 'declined');
        $response->assertJsonPath('data.review.payment_result', null);
        $this->assertSame('declined', DB::table('vol_logs')->where('id', $logId)->value('status'));
    }

    /**
     * Kill-switch smoke test: verify the tenant bootstrap endpoint reflects the
     * caring_community feature toggle so the React frontend can gate its UI
     * without a dedicated round-trip.
     *
     * When disabled → bootstrap features.caring_community === false
     * When enabled  → bootstrap features.caring_community === true
     *
     * The bootstrap endpoint caches responses in Redis (key: t{id}:tenant_bootstrap).
     * We flush that key between assertions so each call fetches fresh data from DB.
     */
    public function test_caring_community_feature_disabled_reflects_in_tenant_config(): void
    {
        $cacheKey = 't' . $this->testTenantId . ':tenant_bootstrap';

        // Disable the feature, flush stale cache, confirm bootstrap returns false.
        $this->setCaringCommunityFeature(false);
        try {
            \Illuminate\Support\Facades\Cache::store('redis')->forget($cacheKey);
        } catch (\Throwable) {
            // Redis may be unavailable in some test environments — cache miss is fine.
        }

        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertStatus(200);
        $response->assertJsonPath('data.features.caring_community', false);

        // Re-enable, flush cache again, confirm bootstrap now returns true.
        $this->setCaringCommunityFeature(true);
        try {
            \Illuminate\Support\Facades\Cache::store('redis')->forget($cacheKey);
        } catch (\Throwable) {
            // Redis may be unavailable in some test environments — cache miss is fine.
        }

        $response = $this->apiGet('/v2/tenant/bootstrap');

        $response->assertStatus(200);
        $response->assertJsonPath('data.features.caring_community', true);
    }

    private function updateNudgeProfile(User $user, array $overrides = []): void
    {
        $defaults = [
            'name' => 'Nudge Member ' . $user->id,
            'preferred_language' => 'de',
            'skills' => json_encode(['shopping', 'companionship']),
            'interests' => json_encode(['shopping', 'companionship']),
            'availability' => 'weekday flexible',
            'latitude' => 47.3769,
            'longitude' => 8.5417,
            'date_of_birth' => '1960-01-01',
            'status' => 'active',
            'is_approved' => 1,
        ];

        $updates = [];
        foreach (($overrides + $defaults) as $column => $value) {
            if (Schema::hasColumn('users', $column)) {
                $updates[$column] = $value;
            }
        }

        if ($updates !== []) {
            DB::table('users')
                ->where('tenant_id', $this->testTenantId)
                ->where('id', $user->id)
                ->update($updates);
        }
    }

    private function isolateNudgeCandidates(array $allowedUserIds): void
    {
        $updates = [];
        if (Schema::hasColumn('users', 'status')) {
            $updates['status'] = 'inactive';
        }
        if (Schema::hasColumn('users', 'is_approved')) {
            $updates['is_approved'] = 0;
        }

        if ($updates === []) {
            return;
        }

        DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->whereNotIn('id', array_map('intval', $allowedUserIds))
            ->update($updates);
    }

    public function test_smart_nudge_dispatch_is_opt_in_idempotent_and_notifies_candidate(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $supporter = User::factory()->forTenant($this->testTenantId)->create();
        $recipient = User::factory()->forTenant($this->testTenantId)->create();
        $this->isolateNudgeCandidates([$supporter->id, $recipient->id]);
        $this->updateNudgeProfile($supporter, [
            'name' => 'Supporter Candidate',
            'date_of_birth' => '1988-01-01',
        ]);
        $this->updateNudgeProfile($recipient, [
            'name' => 'Recipient Match',
            'latitude' => 47.3771,
            'longitude' => 8.5420,
            'date_of_birth' => '1938-01-01',
        ]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/caring-community/nudges/config', [
            'enabled' => true,
            'min_score' => 0.55,
            'daily_limit' => 10,
            'cooldown_days' => 30,
        ])->assertStatus(200)
            ->assertJsonPath('data.config.enabled', true);

        $dispatch = $this->apiPost('/v2/admin/caring-community/nudges/dispatch', [
            'limit' => 10,
        ]);

        $dispatch->assertStatus(201)
            ->assertJsonPath('data.enabled', true)
            ->assertJsonPath('data.sent', 1);

        $this->assertDatabaseHas('caring_smart_nudges', [
            'tenant_id' => $this->testTenantId,
            'status' => 'sent',
        ]);
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('type', 'caring_smart_nudge')
            ->count());

        $again = $this->apiPost('/v2/admin/caring-community/nudges/dispatch', [
            'limit' => 10,
        ]);

        $again->assertStatus(201)
            ->assertJsonPath('data.sent', 0);

        $nudge = DB::table('caring_smart_nudges')
            ->where('tenant_id', $this->testTenantId)
            ->first(['target_user_id', 'related_user_id']);
        $this->assertNotNull($nudge);
        DB::table('caring_support_relationships')->insert([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => (int) $nudge->target_user_id,
            'recipient_id' => (int) $nudge->related_user_id,
            'coordinator_id' => $admin->id,
            'title' => 'Nudge conversion',
            'frequency' => 'weekly',
            'expected_hours' => 1,
            'start_date' => '2026-04-28',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiGet('/v2/admin/caring-community/nudges/analytics')
            ->assertStatus(200)
            ->assertJsonPath('data.stats.converted_total', 1)
            ->assertJsonPath('data.stats.conversion_rate_30d', 1);
    }

    public function test_smart_nudges_respect_member_opt_out_and_report_analytics(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $optedOut = User::factory()->forTenant($this->testTenantId)->create([
            'notification_preferences' => json_encode(['caring_smart_nudges' => 0]),
        ]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create([
            'notification_preferences' => json_encode(['caring_smart_nudges' => 0]),
        ]);
        $this->isolateNudgeCandidates([$optedOut->id, $recipient->id]);
        $this->updateNudgeProfile($optedOut, ['name' => 'Opted Out Candidate']);
        $this->updateNudgeProfile($recipient, [
            'name' => 'Recipient Match',
            'latitude' => 47.3771,
            'longitude' => 8.5420,
        ]);
        Sanctum::actingAs($admin);

        $this->apiPut('/v2/admin/caring-community/nudges/config', [
            'enabled' => true,
            'min_score' => 0.55,
        ])->assertStatus(200);

        $dispatch = $this->apiPost('/v2/admin/caring-community/nudges/dispatch', [
            'limit' => 10,
        ]);
        $dispatch->assertStatus(201)
            ->assertJsonPath('data.sent', 0);

        $analytics = $this->apiGet('/v2/admin/caring-community/nudges/analytics');

        $analytics->assertStatus(200)
            ->assertJsonPath('data.stats.sent_total', 0)
            ->assertJsonPath('data.stats.opted_out_members', 2);
    }

    private function createVerein(int $ownerId): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Turnverein Test',
            'slug' => 'turnverein-test-' . uniqid(),
            'description' => 'A local association used by tests.',
            'contact_email' => 'verein-' . uniqid() . '@example.test',
            'status' => 'approved',
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_verein_import_preview_detects_create_link_and_duplicates(): void
    {
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $existing = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'existing-' . uniqid() . '@example.test',
        ]);
        $vereinId = $this->createVerein($admin->id);
        Sanctum::actingAs($admin);

        $newEmail = 'new-' . uniqid() . '@example.test';
        $csv = "email,first_name,last_name,role\n"
            . "{$newEmail},Ada,Lovelace,member\n"
            . "{$existing->email},Existing,Member,admin\n"
            . "{$existing->email},Duplicate,Member,member\n";

        $response = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import/preview", [
            'csv' => $csv,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.summary.total_rows', 3);
        $response->assertJsonPath('data.summary.ready_to_create', 1);
        // F-126: existing accounts are flagged for an invitation, never linked,
        // and the preview does not disclose their user id.
        $response->assertJsonPath('data.summary.ready_to_link', 0);
        $response->assertJsonPath('data.summary.existing_accounts', 1);
        $response->assertJsonPath('data.summary.duplicates', 1);
        $response->assertJsonPath('data.items.0.action', 'create');
        $response->assertJsonPath('data.items.1.action', 'existing_account');
        $response->assertJsonPath('data.items.1.role', 'member');
        $response->assertJsonPath('data.items.2.action', 'invalid');
        $this->assertArrayNotHasKey('existing_user_id', (array) $response->json('data.items.1'));
    }

    public function test_verein_import_creates_users_and_links_existing_members(): void
    {
        // F-126: new accounts are created as plain members and receive a queued
        // password-setup email; existing accounts are not auto-enrolled.
        Queue::fake();
        $this->setCaringCommunityFeature(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $existing = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'link-' . uniqid() . '@example.test',
        ]);
        $vereinId = $this->createVerein($admin->id);
        Sanctum::actingAs($admin);

        $newEmail = 'created-' . uniqid() . '@example.test';
        $csv = "email,first_name,last_name,role\n"
            . "{$newEmail},Mina,Muster,member\n"
            . "{$existing->email},Existing,Member,admin\n";

        $response = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import", [
            'csv' => $csv,
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.created', 1);
        $response->assertJsonPath('data.linked', 0);
        $response->assertJsonPath('data.existing_accounts', 1);
        $this->assertStringNotContainsString('temporary_password', (string) $response->getContent());
        Queue::assertPushed(SendPasswordResetEmail::class, fn (SendPasswordResetEmail $job): bool => $job->email === $newEmail);

        $createdId = (int) DB::table('users')
            ->where('tenant_id', $this->testTenantId)
            ->where('email', $newEmail)
            ->value('id');

        $this->assertGreaterThan(0, $createdId);
        $this->assertDatabaseHas('org_members', [
            'tenant_id' => $this->testTenantId,
            'organization_id' => $vereinId,
            'user_id' => $createdId,
            'role' => 'member',
            'status' => 'active',
        ]);
        $this->assertDatabaseMissing('org_members', [
            'tenant_id' => $this->testTenantId,
            'organization_id' => $vereinId,
            'user_id' => $existing->id,
        ]);
    }

    public function test_scoped_verein_admin_can_import_only_their_verein(): void
    {
        $this->setCaringCommunityFeature(true);
        $this->seedVereinAdminRbac();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $vereinAdmin = User::factory()->forTenant($this->testTenantId)->create();
        $vereinId = $this->createVerein($admin->id);
        $otherVereinId = $this->createVerein($admin->id);
        Sanctum::actingAs($admin);

        $assign = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/admins", [
            'user_id' => $vereinAdmin->id,
        ]);
        $assign->assertStatus(201);
        $assign->assertJsonPath('data.scope_organization_id', $vereinId);
        $this->assertTrue(app(VereinMemberImportService::class)->userHasPermissionInOrg(
            $this->testTenantId,
            $vereinAdmin->id,
            $vereinId,
            'verein.members.import'
        ));

        Sanctum::actingAs($vereinAdmin);
        $csv = "email,first_name,last_name\nscoped-" . uniqid() . "@example.test,Scoped,Member\n";

        $allowed = $this->apiPost("/v2/caring-community/vereine/{$vereinId}/members/import/preview", [
            'csv' => $csv,
        ]);
        $allowed->assertStatus(200);

        $blocked = $this->apiPost("/v2/caring-community/vereine/{$otherVereinId}/members/import/preview", [
            'csv' => $csv,
        ]);
        $blocked->assertStatus(403);
    }
}
