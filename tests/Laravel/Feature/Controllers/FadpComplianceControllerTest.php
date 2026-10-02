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
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

class FadpComplianceControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_disclosure_pack_connects_residency_retention_consent_and_profiling(): void
    {
        $this->resetFadpState();
        $this->enableFadpCompliance();

        $member = User::factory()->forTenant($this->testTenantId)->create([
            'email' => 'fadp-member@example.test',
            'status' => 'active',
        ]);

        Sanctum::actingAs($member);

        $consentResponse = $this->apiPost('/v2/me/fadp/consent', [
            'consent_type' => 'ai_matching',
            'action' => 'granted',
            'consent_version' => '2026-04',
        ]);

        $consentResponse->assertStatus(200);
        $consentResponse->assertJsonPath('data.recorded', true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'email' => 'fadp-admin@example.test',
        ]);
        Sanctum::actingAs($admin);

        $retentionResponse = $this->apiPut('/v2/admin/fadp/retention-config', [
            'config' => [
                'member_data_years' => 7,
                'transaction_data_years' => 10,
                'activity_logs_years' => 3,
                'messages_years' => 2,
                'ai_embeddings_years' => 1,
            ],
            'data_residency' => 'Switzerland',
            'dpa_contact_email' => 'dpa@example.test',
        ]);

        $retentionResponse->assertStatus(200);
        $retentionResponse->assertJsonPath('data.data_residency', 'Switzerland');

        $activityResponse = $this->apiPost('/v2/admin/fadp/processing-activities', [
            'activity_name' => 'AI-supported KISS tandem suggestions',
            'purpose' => 'Suggest recurring care relationships for coordinator review.',
            'data_categories' => ['interests', 'activity_history'],
            'recipients' => ['tenant_coordinators'],
            'retention_period' => '1 year or until consent withdrawn',
            'legal_basis' => 'consent',
            'is_automated_profiling' => true,
            'sort_order' => 1,
        ]);

        $activityResponse->assertStatus(200);
        $activityResponse->assertJsonPath('data.is_automated_profiling', true);

        $packResponse = $this->apiGet('/v2/admin/fadp/disclosure-pack');

        $packResponse->assertStatus(200);
        $packResponse->assertJsonPath('data.data_residency_declaration.declared_residency', 'Switzerland');
        $packResponse->assertJsonPath('data.data_residency_declaration.isolated_node_supported', true);
        $packResponse->assertJsonPath('data.consent_ledger_summary.total', 1);

        $pack = $packResponse->json('data');
        $this->assertGreaterThanOrEqual(1, $pack['processing_register']['automated_profiling_count']);
        $this->assertContains(
            'AI-supported KISS tandem suggestions',
            array_column($pack['processing_register']['activities'], 'activity_name')
        );
    }

    public function test_processing_register_csv_exports_dpa_columns(): void
    {
        $this->resetFadpState();
        $this->enableFadpCompliance();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'email' => 'fadp-csv-admin@example.test',
        ]);
        Sanctum::actingAs($admin);

        DB::table('fadp_data_retention_config')->updateOrInsert(
            ['tenant_id' => $this->testTenantId],
            [
                'config' => json_encode([
                    'member_data_years' => 7,
                    'transaction_data_years' => 10,
                    'activity_logs_years' => 3,
                    'messages_years' => 2,
                    'ai_embeddings_years' => 1,
                ]),
                'data_residency' => 'Switzerland',
                'dpa_contact_email' => 'dpa@example.test',
                'updated_at' => now(),
            ]
        );

        DB::table('fadp_processing_activities')->insert([
            'tenant_id' => $this->testTenantId,
            'activity_name' => 'Consent ledger',
            'purpose' => 'Audit grants and withdrawals of member consent.',
            'data_categories' => json_encode(['consent_type', 'ip_address']),
            'recipients' => json_encode(['tenant_admins']),
            'retention_period' => '7 years',
            'legal_basis' => 'legal_obligation',
            'is_automated_profiling' => false,
            'is_active' => true,
            'sort_order' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->get('/api/v2/admin/fadp/processing-register.csv', $this->withTenantHeader());

        $response->assertStatus(200);
        $response->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertStringContainsString('"tenant_name","data_residency","dpa_contact_email"', $response->getContent());
        $this->assertStringContainsString('"Consent ledger"', $response->getContent());
        $this->assertStringContainsString('"Switzerland"', $response->getContent());
    }

    /** The admin routes follow the fadp_compliance switch (F-530); these cases are about the enabled module. */
    private function enableFadpCompliance(): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $current = json_decode((string) ($row->features ?? '{}'), true) ?: [];
        $current['fadp_compliance'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($current)]);
        TenantContext::setById($this->testTenantId);
    }

    private function resetFadpState(): void
    {
        DB::table('fadp_processing_activities')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('fadp_consent_records')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('fadp_data_retention_config')->where('tenant_id', $this->testTenantId)->delete();
    }
}
