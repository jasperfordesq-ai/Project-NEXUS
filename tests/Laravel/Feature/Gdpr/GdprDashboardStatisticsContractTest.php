<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Gdpr;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GET /v2/admin/enterprise/gdpr/statistics must return every field the React
 * GDPR dashboard reads.
 *
 * 🔴 Until 2026-10-01 it returned none of them. The page defaults each missing
 * field to zero, so every community saw a compliance score of 0 and consent
 * coverage of 0%, and the dashboard's own test passed because it mocked a
 * response the server never sent. The field list below mirrors
 * `GdprStatistics` in react-frontend/src/admin/api/types.ts — rename a field in
 * one place and you must rename it in the other.
 */
class GdprDashboardStatisticsContractTest extends TestCase
{
    use DatabaseTransactions;

    public function test_statistics_endpoint_returns_every_field_the_dashboard_reads(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/enterprise/gdpr/statistics');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data' => [
            'requests_by_status',
            'requests_by_type',
            'total_requests',
            'pending_count',
            'overdue_count',
            'avg_processing_days',
            'active_breaches',
            'consent_coverage_percent',
            'compliance_score',
        ]]);

        $score = $response->json('data.compliance_score');
        $this->assertIsInt($score);
        $this->assertGreaterThanOrEqual(0, $score);
        $this->assertLessThanOrEqual(100, $score);

        $coverage = $response->json('data.consent_coverage_percent');
        $this->assertIsNumeric($coverage);
        $this->assertGreaterThanOrEqual(0, $coverage);
        $this->assertLessThanOrEqual(100, $coverage);
    }

    public function test_statistics_endpoint_is_refused_to_a_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiGet('/v2/admin/enterprise/gdpr/statistics')->assertStatus(403);
    }
}
