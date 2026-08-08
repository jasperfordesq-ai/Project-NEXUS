<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\PilotLaunchReadinessService;
use App\Services\CaringCommunity\PilotScoreboardService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AG95 — Pilot Launch Readiness Dashboard.
 *
 * Exercises the readiness consolidator service and admin endpoints. Each test
 * runs in a transaction so seeded tenant_settings / caring_kpi_baselines rows
 * are rolled back on tear-down.
 */
class PilotLaunchReadinessTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setCaringCommunityFeature($this->testTenantId, true);

        $this->ensureScoreboardColumnsExist();
    }

    /**
     * PilotScoreboardService::captureCurrentMetrics() reads several columns
     * that are not present in the legacy test DB schema dump. They exist in
     * production. To keep the test deterministic we shadow them as nullable
     * columns. ALTER is DDL (auto-committed) and idempotent across the suite.
     *
     * - `messages.from_user_id` / `to_user_id` (engagement set, line 488)
     * - `merchant_coupons.user_id` (business participation, line 575)
     */
    private function ensureScoreboardColumnsExist(): void
    {
        if (Schema::hasTable('messages')) {
            if (!Schema::hasColumn('messages', 'from_user_id')) {
                DB::statement('ALTER TABLE messages ADD COLUMN from_user_id INT NULL');
            }
            if (!Schema::hasColumn('messages', 'to_user_id')) {
                DB::statement('ALTER TABLE messages ADD COLUMN to_user_id INT NULL');
            }
        }

        if (Schema::hasTable('merchant_coupons') && !Schema::hasColumn('merchant_coupons', 'user_id')) {
            DB::statement('ALTER TABLE merchant_coupons ADD COLUMN user_id INT NULL');
        }
    }

    private function setCaringCommunityFeature(int $tenantId, bool $enabled): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        $features = [];
        if ($tenant && !empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = $enabled;
        DB::table('tenants')
            ->where('id', $tenantId)
            ->update(['features' => json_encode($features)]);
        TenantContext::setById($tenantId);
    }

    private function makeAdmin(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->admin()->create();
    }

    private function makeMember(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create();
    }

    public function test_admin_can_fetch_readiness_report(): void
    {
        $admin = $this->makeAdmin($this->testTenantId);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/launch-readiness');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                'generated_at',
                'overall' => [
                    'status',
                    'ready_section_count',
                    'total_section_count',
                    'summary_code',
                    'summary_params',
                ],
                'sections',
                'isolated_node_required',
            ],
        ]);

        $data = $response->json('data');
        $this->assertIsArray($data['sections']);
        $this->assertCount(7, $data['sections'], 'Report should expose 7 sections (AG80..AG87)');

        $expectedKeys = [
            'disclosure_pack',
            'operating_policy',
            'commercial_boundary',
            'pilot_scoreboard',
            'data_quality',
            'isolated_node',
            'external_integrations',
        ];
        $actualKeys = array_column($data['sections'], 'key');
        $this->assertSame($expectedKeys, $actualKeys, 'Sections must be in the canonical order');
    }

    public function test_non_admin_member_gets_403(): void
    {
        $member = $this->makeMember($this->testTenantId);
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/caring-community/launch-readiness');

        $response->assertStatus(403);
    }

    public function test_returns_403_when_caring_community_feature_disabled(): void
    {
        $this->setCaringCommunityFeature($this->testTenantId, false);

        $admin = $this->makeAdmin($this->testTenantId);
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/caring-community/launch-readiness');

        $response->assertStatus(403);
    }

    public function test_all_sections_start_as_not_started_or_review_on_fresh_tenant(): void
    {
        // Fresh tenant: no policy edits, no disclosure pack overrides, no
        // baselines, no boundary acknowledgement, no isolated-node items, no
        // external-integration backlog.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'like', 'caring.%')
            ->delete();
        if (Schema::hasTable('caring_kpi_baselines')) {
            DB::table('caring_kpi_baselines')->where('tenant_id', $this->testTenantId)->delete();
        }
        if (Schema::hasTable('caring_isolated_node_items')) {
            DB::table('caring_isolated_node_items')->where('tenant_id', $this->testTenantId)->delete();
        }
        if (Schema::hasTable('caring_external_integrations')) {
            DB::table('caring_external_integrations')->where('tenant_id', $this->testTenantId)->delete();
        }

        $service = app(PilotLaunchReadinessService::class);
        $report = $service->report($this->testTenantId);

        $byKey = [];
        foreach ($report['sections'] as $section) {
            $byKey[$section['key']] = $section['status'];
        }

        // The four sections that have a clear "fresh" signal must report
        // not_started; the remaining ones default to needs_review or
        // not_started but never ready.
        $this->assertSame('not_started', $byKey['disclosure_pack']);
        $this->assertSame('not_started', $byKey['operating_policy']);
        $this->assertSame('not_started', $byKey['pilot_scoreboard']);
        $this->assertSame('not_started', $byKey['external_integrations']);

        // Commercial boundary defaults to needs_review until acknowledged.
        $this->assertSame('needs_review', $byKey['commercial_boundary']);

        // Isolated node not required for hosted deployments → not_started.
        $this->assertSame('not_started', $byKey['isolated_node']);
        $this->assertFalse($report['isolated_node_required']);

        // Overall must reflect "not yet ready" — never ready on a fresh tenant.
        $this->assertNotSame('ready', $report['overall']['status']);
    }

    public function test_pilot_scoreboard_section_advances_after_pre_pilot_baseline_captured(): void
    {
        $admin = $this->makeAdmin($this->testTenantId);

        $service = app(PilotLaunchReadinessService::class);

        $before = $service->report($this->testTenantId);
        $beforeSection = collect($before['sections'])->firstWhere('key', 'pilot_scoreboard');
        $this->assertSame('not_started', $beforeSection['status']);

        // Capture the canonical pre-pilot baseline.
        $scoreboard = app(PilotScoreboardService::class);
        $captured = $scoreboard->capturePrePilotBaseline($this->testTenantId, $admin->id, 'unit-test baseline');
        $this->assertArrayNotHasKey('error', $captured, 'Baseline capture should succeed');

        $after = $service->report($this->testTenantId);
        $afterSection = collect($after['sections'])->firstWhere('key', 'pilot_scoreboard');

        // Once the baseline exists the section is no longer "not_started" — it
        // moves to ready (cadence on track) or needs_review (cadence overdue).
        $this->assertContains(
            $afterSection['status'],
            ['ready', 'needs_review'],
            'Scoreboard status should advance after pre-pilot baseline is captured'
        );
        $this->assertNotSame($beforeSection['status'], $afterSection['status']);
    }

    public function test_acknowledge_boundary_endpoint_marks_section_ready(): void
    {
        $admin = $this->makeAdmin($this->testTenantId);
        Sanctum::actingAs($admin);

        // Pre-state: needs_review.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'caring.launch_readiness.boundary_acknowledged')
            ->delete();

        $beforeReport = app(PilotLaunchReadinessService::class)->report($this->testTenantId);
        $beforeBoundary = collect($beforeReport['sections'])->firstWhere('key', 'commercial_boundary');
        $this->assertSame('needs_review', $beforeBoundary['status']);

        $response = $this->apiPost('/v2/admin/caring-community/launch-readiness/acknowledge-boundary');

        $response->assertStatus(200);
        $response->assertJsonPath('data.acknowledged', true);
        $response->assertJsonStructure(['data' => ['acknowledged', 'report' => ['overall', 'sections']]]);

        // Verify persistence + section flip.
        $row = DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'caring.launch_readiness.boundary_acknowledged')
            ->first();
        $this->assertNotNull($row, 'Acknowledgement flag must be persisted');
        $this->assertSame('1', (string) $row->setting_value);

        $afterReport = app(PilotLaunchReadinessService::class)->report($this->testTenantId);
        $afterBoundary = collect($afterReport['sections'])->firstWhere('key', 'commercial_boundary');
        $this->assertSame('ready', $afterBoundary['status']);
    }

    public function test_isolated_node_required_flips_when_deployment_mode_is_canton(): void
    {
        // Defensive: ensure no stale deployment_mode envelope persists from a
        // prior test (DatabaseTransactions rolls back our writes, but DDL
        // ALTERs in setUp() commit, and seeded envelopes from other suites
        // can persist on shared test DBs).
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'caring.isolated_node.deployment_mode')
            ->delete();

        $service = app(PilotLaunchReadinessService::class);

        $defaultReport = $service->report($this->testTenantId);
        $this->assertFalse($defaultReport['isolated_node_required']);

        // Seed the deployment-mode envelope using the JSON shape the service
        // expects: `{"value": "canton_isolated_node"}`.
        DB::table('tenant_settings')->updateOrInsert(
            [
                'tenant_id'   => $this->testTenantId,
                'setting_key' => 'caring.isolated_node.deployment_mode',
            ],
            [
                'setting_value' => json_encode(['value' => 'canton_isolated_node']),
                'setting_type'  => 'json',
                'category'      => 'caring_community',
                'description'   => 'AG85 deployment mode (test)',
                'updated_at'    => now(),
            ],
        );

        $cantonReport = $service->report($this->testTenantId);
        $this->assertTrue($cantonReport['isolated_node_required']);

        $section = collect($cantonReport['sections'])->firstWhere('key', 'isolated_node');
        $this->assertNotNull($section);
        // When required and no decisions have been made the section should be
        // either needs_review (decisions in progress) or blocked (explicit
        // blockers) — never ready, never not_started.
        $this->assertContains(
            $section['status'],
            ['needs_review', 'blocked'],
            'Isolated-node section must surface as needs_review/blocked when canton deployment selected'
        );
        $this->assertTrue($section['extra']['required'] ?? false);
    }
}
