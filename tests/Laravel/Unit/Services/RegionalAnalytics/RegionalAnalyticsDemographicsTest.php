<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\RegionalAnalytics;

use App\Services\RegionalAnalytics\RegionalAnalyticsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * computeDemographicReport() — the partner dashboard's demographics module.
 *
 * It used to SELECT a `gender` column from `users`. No table in this schema has
 * ever had one, so the query threw and, because nothing catches it, the whole
 * partner dashboard returned a 500 for any subscription with the demographics
 * module enabled. These tests run the report against the real database so a
 * column that does not exist cannot pass unnoticed again.
 */
class RegionalAnalyticsDemographicsTest extends TestCase
{
    use DatabaseTransactions;

    private RegionalAnalyticsService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new RegionalAnalyticsService();
    }

    public function test_the_platform_stores_no_gender_column(): void
    {
        // The report must not be "fixed" by adding gender back to the query
        // unless the column is actually introduced first.
        $this->assertFalse(
            Schema::hasColumn('users', 'gender'),
            'users.gender now exists — revisit computeDemographicReport(), which reports every member as Unspecified.'
        );
    }

    public function test_computeDemographicReport_runs_against_the_real_users_table(): void
    {
        $report = $this->service->computeDemographicReport($this->testTenantId, 'last_30d');

        $this->assertIsArray($report);
        $this->assertArrayHasKey('age_buckets', $report);
        $this->assertArrayHasKey('gender_buckets', $report);
    }

    public function test_computeDemographicReport_keeps_the_published_payload_shape(): void
    {
        $report = $this->service->computeDemographicReport($this->testTenantId, 'last_30d');

        // Subscribers read these keys; the shape must survive the gender removal.
        $this->assertSame(
            ['period', 'period_start', 'period_end', 'age_buckets', 'gender_buckets'],
            array_keys($report)
        );
        $this->assertSame(
            ['<25', '25-44', '45-64', '65+'],
            array_keys($report['age_buckets'])
        );
        $this->assertSame(
            ['M', 'F', 'Other', 'Unspecified'],
            array_keys($report['gender_buckets'])
        );
    }
}
