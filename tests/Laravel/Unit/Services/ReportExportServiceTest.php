<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\ReportExportService;
use Illuminate\Support\Facades\DB;

class ReportExportServiceTest extends TestCase
{
    private ReportExportService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ReportExportService();
    }

    public function test_getSupportedTypes_returns_expected_types(): void
    {
        $types = $this->service->getSupportedTypes();
        $this->assertArrayHasKey('transactions', $types);
        $this->assertArrayHasKey('members', $types);
        $this->assertArrayHasKey('hours_summary', $types);
        $this->assertArrayHasKey('social_value', $types);
        $this->assertArrayHasKey('municipal_impact', $types);
        // Added 2026-08-05 so the Hours report's "By Member" and "By Period"
        // tabs export what is actually on screen. Before these existed, every
        // tab of that report exported category data under a filename naming
        // the tab you were looking at.
        $this->assertArrayHasKey('hours_member', $types);
        $this->assertArrayHasKey('hours_period', $types);
        $this->assertCount(11, $types);
    }

    public function test_export_returns_failure_for_empty_data(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->export('transactions', $this->testTenantId);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('No data found', $result['message']);
    }

    public function test_export_returns_failure_for_unknown_type(): void
    {
        $result = $this->service->export('nonexistent', $this->testTenantId);
        $this->assertFalse($result['success']);
    }

    public function test_exportPdf_returns_failure_for_empty_data(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->exportPdf('transactions', $this->testTenantId);
        $this->assertFalse($result['success']);
    }

    public function test_export_csv_contains_headers_for_members(): void
    {
        $row = (object) [
            'id' => 1, 'name' => 'John', 'email' => 'j@e.com', 'phone' => '', 'location' => '',
            'role' => 'member', 'status' => 'active', 'is_approved' => 1, 'created_at' => '2026-01-01',
            'last_login_at' => null, 'balance' => 5, 'xp' => 100, 'level' => 2,
        ];
        DB::shouldReceive('select')->andReturn([$row]);

        $result = $this->service->export('members', $this->testTenantId);
        $this->assertTrue($result['success']);
        $this->assertNotEmpty($result['csv']);
        $this->assertEquals(1, $result['rows']);
        $this->assertStringContainsString('.csv', $result['filename']);
    }
}
