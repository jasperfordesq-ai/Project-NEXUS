<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\VolunteerWellbeingService;
use Illuminate\Support\Facades\DB;

class VolunteerWellbeingServiceTest extends TestCase
{
    public function test_detectBurnoutRisk_returns_expected_structure(): void
    {
        // Mock all DB calls in detectBurnoutRisk
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('on')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNotNull')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(0);
        DB::shouldReceive('sum')->andReturn(0.0);
        DB::shouldReceive('max')->andReturn(null);
        DB::shouldReceive('exists')->andReturn(false);
        DB::shouldReceive('insert')->andReturn(true);
        DB::shouldReceive('first')->andReturn(null);
        DB::shouldReceive('update')->andReturn(1);

        $result = VolunteerWellbeingService::detectBurnoutRisk(1);

        $this->assertArrayHasKey('risk_score', $result);
        $this->assertArrayHasKey('risk_level', $result);
        $this->assertArrayHasKey('indicators', $result);
        $this->assertArrayHasKey('recommendations', $result);
    }

    public function test_detectBurnoutRisk_low_risk_for_inactive_user(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('on')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNotNull')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(0);
        DB::shouldReceive('sum')->andReturn(0.0);
        DB::shouldReceive('max')->andReturn(null);
        DB::shouldReceive('exists')->andReturn(false);

        $result = VolunteerWellbeingService::detectBurnoutRisk(1);

        $this->assertEquals('low', $result['risk_level']);
        $this->assertLessThan(30, $result['risk_score']);
    }

    public function test_updateAlert_returns_false_for_invalid_action(): void
    {
        $result = VolunteerWellbeingService::updateAlert(1, 'invalid_action');

        $this->assertFalse($result);
        $this->assertNotEmpty(VolunteerWellbeingService::getErrors());
    }

    public function test_updateAlert_returns_false_when_alert_not_found(): void
    {
        DB::shouldReceive('table')->with('vol_wellbeing_alerts')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $result = VolunteerWellbeingService::updateAlert(999, 'acknowledged');

        $this->assertFalse($result);
    }

    // A query error is thrown, never shown to staff as an empty list (deep audit S15, 21 Oct 2026).
    public function test_getActiveAlerts_rethrows_a_query_error(): void
    {
        DB::shouldReceive('table')->andThrow(new \Exception('DB error'));

        $this->expectExceptionMessage('DB error');
        VolunteerWellbeingService::getActiveAlerts();
    }

    public function test_getErrors_returns_array(): void
    {
        $this->assertIsArray(VolunteerWellbeingService::getErrors());
    }
}
