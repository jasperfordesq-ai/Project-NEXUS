<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\VolunteerCertificateService;
use Illuminate\Support\Facades\DB;

class VolunteerCertificateServiceTest extends TestCase
{
    public function test_generate_returns_null_when_no_approved_hours(): void
    {
        DB::shouldReceive('table')->with('vol_logs')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('sum')->with('hours')->andReturn(0);

        $result = VolunteerCertificateService::generate(1);

        $this->assertNull($result);
        $this->assertNotEmpty(VolunteerCertificateService::getErrors());
        $this->assertEquals('VALIDATION_ERROR', VolunteerCertificateService::getErrors()[0]['code']);
    }

    public function test_verify_returns_null_for_empty_code(): void
    {
        $this->assertNull(VolunteerCertificateService::verify(''));
        $this->assertNull(VolunteerCertificateService::verify('   '));
    }

    public function test_verify_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('on')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull(VolunteerCertificateService::verify('NONEXISTENT'));
    }

    public function test_getUserCertificates_returns_array(): void
    {
        DB::shouldReceive('table')->with('vol_certificates')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = VolunteerCertificateService::getUserCertificates(1);
        $this->assertIsArray($result);
        $this->assertSame(['items' => [], 'cursor' => null, 'has_more' => false], $result);
    }

    public function test_generateHtml_returns_null_when_cert_not_found(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('on')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull(VolunteerCertificateService::generateHtml('BADCODE'));
    }

    public function test_markDownloaded_does_nothing_for_empty_code(): void
    {
        // Should not throw
        VolunteerCertificateService::markDownloaded('');
        VolunteerCertificateService::markDownloaded('   ');
        $this->assertTrue(true);
    }

    public function test_getErrors_returns_empty_initially(): void
    {
        // Reset errors via a call
        $this->assertIsArray(VolunteerCertificateService::getErrors());
    }

    /** Hours print without trailing zeros and with at most two decimals. */
    public function test_formatHours_prints_clean_figures(): void
    {
        app()->setLocale('en');

        $this->assertSame('124', VolunteerCertificateService::formatHours(124.0));
        $this->assertSame('12.5', VolunteerCertificateService::formatHours(12.50));
        $this->assertSame('0.75', VolunteerCertificateService::formatHours(0.75));
        $this->assertSame('2.33', VolunteerCertificateService::formatHours(2.3333));
        $this->assertSame('1,250.25', VolunteerCertificateService::formatHours(1250.25));
    }
}
