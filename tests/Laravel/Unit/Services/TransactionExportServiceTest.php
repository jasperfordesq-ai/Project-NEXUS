<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\TransactionExportService;
use Illuminate\Support\Facades\DB;

class TransactionExportServiceTest extends TestCase
{
    private TransactionExportService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new TransactionExportService();
    }

    public function test_exportPersonalStatementCSV_returns_success_with_empty_data(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->exportPersonalStatementCSV(1);

        $this->assertTrue($result['success']);
        $this->assertArrayHasKey('csv', $result);
        $this->assertArrayHasKey('filename', $result);
    }

    public function test_exportPersonalStatementCSV_csv_has_header_row(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->exportPersonalStatementCSV(1);
        $lines = explode("\r\n", $result['csv']);

        // First line is BOM + header
        $this->assertStringContainsString('Date,Type,Description', $lines[0]);
    }

    public function test_exportPersonalStatementCSV_includes_date_range_in_filename(): void
    {
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->exportPersonalStatementCSV(1, [
            'startDate' => '2025-01-01',
            'endDate' => '2025-12-31',
        ]);

        $this->assertStringContainsString('2025-01-01', $result['filename']);
        $this->assertStringContainsString('2025-12-31', $result['filename']);
    }

    public function test_exportPersonalStatementCSV_returns_failure_on_exception(): void
    {
        DB::shouldReceive('select')->andThrow(new \Exception('DB error'));

        $result = $this->service->exportPersonalStatementCSV(1);

        $this->assertFalse($result['success']);
        $this->assertArrayHasKey('message', $result);
    }

    public function test_exportPersonalStatementCSV_formats_transaction_rows(): void
    {
        $row = (object) [
            'id' => 1,
            'amount' => 2.5,
            'description' => 'Gardening help',
            'status' => 'completed',
            'transaction_type' => 'transfer',
            'created_at' => '2025-06-01 14:30:00',
            'sender_id' => 1,
            'receiver_id' => 2,
            'sender_first' => 'Alice',
            'sender_last' => 'Smith',
            'receiver_first' => 'Bob',
            'receiver_last' => 'Jones',
        ];

        DB::shouldReceive('select')->andReturn([$row]);

        $result = $this->service->exportPersonalStatementCSV(1);

        $this->assertTrue($result['success']);
        // E-122: the other party's surname is for staff of the community;
        // a member's own statement names them by first name.
        $this->assertStringContainsString(',Bob,', $result['csv']);
        $this->assertStringNotContainsString('Jones', $result['csv']);
        $this->assertStringContainsString('2.50', $result['csv']);
    }
}
