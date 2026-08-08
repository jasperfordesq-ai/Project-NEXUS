<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Services\CaringCommunity\LeadNurtureService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class LeadNurtureServiceTest extends TestCase
{
    use DatabaseTransactions;

    public function test_csv_export_sanitizes_spreadsheet_formula_values(): void
    {
        $service = new LeadNurtureService();

        $capture = $service->capture($this->testTenantId, [
            'name' => '=HYPERLINK("https://example.test","Open")',
            'email' => 'formula-lead@example.test',
            'phone' => '+1 555 123 4567',
            'organisation' => '@SUM(1,2)',
            'segment' => 'partner',
            'source' => '+campaign',
            'locale' => 'en',
            'interests' => ['-regional care'],
            'consent' => true,
        ]);

        $this->assertArrayHasKey('contact', $capture);

        $service->update($this->testTenantId, (string) $capture['contact']['id'], [
            'notes' => '=IMPORTXML("https://example.test")',
        ]);

        $csv = $service->exportCsv($this->testTenantId);

        $this->assertStringContainsString('"\'=HYPERLINK(""https://example.test"",""Open"")"', $csv);
        $this->assertStringContainsString("'@SUM(1,2)", $csv);
        $this->assertStringContainsString("'+campaign", $csv);
        $this->assertStringContainsString("'-regional care", $csv);
        $this->assertStringContainsString('"\'=IMPORTXML(""https://example.test"")"', $csv);
    }
}
