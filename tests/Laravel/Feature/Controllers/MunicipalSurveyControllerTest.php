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

class MunicipalSurveyControllerTest extends TestCase
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

    private function requireSurveyTables(): void
    {
        foreach (['municipality_surveys', 'municipality_survey_questions', 'municipality_survey_responses'] as $table) {
            if (! Schema::hasTable($table)) {
                $this->markTestSkipped("{$table} is not present in the test database.");
            }
        }
    }

    public function test_admin_survey_export_keeps_anonymous_responses_private_and_sanitizes_csv(): void
    {
        $this->requireSurveyTables();
        $this->setCaringCommunityFeature(true);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();

        $surveyId = (int) DB::table('municipality_surveys')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $admin->id,
            'title' => 'Community care pulse',
            'description' => null,
            'status' => 'active',
            'is_anonymous' => 1,
            'target_audience' => null,
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addDay(),
            'response_count' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $openTextQuestionId = (int) DB::table('municipality_survey_questions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'survey_id' => $surveyId,
            'question_text' => '=How should we improve support?',
            'question_type' => 'open_text',
            'options' => null,
            'is_required' => 1,
            'sort_order' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $likertQuestionId = (int) DB::table('municipality_survey_questions')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'survey_id' => $surveyId,
            'question_text' => 'Overall satisfaction',
            'question_type' => 'likert',
            'options' => json_encode(['1', '2', '3', '4', '5']),
            'is_required' => 1,
            'sort_order' => 2,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('municipality_survey_responses')->insert([
            'tenant_id' => $this->testTenantId,
            'survey_id' => $surveyId,
            'user_id' => null,
            'session_token' => hash('sha256', $member->id . '|' . $surveyId . '|2026-05-07'),
            'answers' => json_encode([
                (string) $openTextQuestionId => '+SUM(1,1)',
                (string) $likertQuestionId => '4',
            ]),
            'submitted_at' => now(),
            'ip_hash' => hash('sha256', '127.0.0.1'),
        ]);

        $this->assertDatabaseHas('municipality_survey_responses', [
            'tenant_id' => $this->testTenantId,
            'survey_id' => $surveyId,
            'user_id' => null,
        ]);

        Sanctum::actingAs($admin);
        $export = $this->apiGet("/v2/admin/caring-community/surveys/{$surveyId}/export");

        $export->assertStatus(200);
        $this->assertStringContainsString("survey-{$surveyId}-responses.csv", (string) $export->headers->get('Content-Disposition'));

        $csv = $export->getContent();
        $this->assertIsString($csv);
        $this->assertStringContainsString('anonymous', $csv);
        $this->assertStringNotContainsString(',' . $member->id . ',', $csv);
        $this->assertStringContainsString("'=How should we improve support?", $csv);
        $this->assertStringContainsString("'+SUM(1,1)", $csv);
    }

    public function test_member_survey_endpoints_respect_caring_community_feature_gate(): void
    {
        $this->requireSurveyTables();
        $this->setCaringCommunityFeature(false);
        Sanctum::actingAs(User::factory()->forTenant($this->testTenantId)->create());

        $response = $this->apiGet('/v2/caring-community/surveys');

        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_member_survey_reads_require_authentication(): void
    {
        // With Caring Community off, its routes answer 403 FEATURE_DISABLED before
        // authentication (E-034 off switch). Switch it on so this test proves that
        // an ENABLED community still requires sign-in.
        $this->setCaringCommunityFeature(true);

        $this->apiGet('/v2/caring-community/surveys')->assertUnauthorized();
        $this->apiGet('/v2/caring-community/surveys/1')->assertUnauthorized();
    }
}
