<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Services\VolunteerReminderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * VOL-BE-015: when a reminder sweep is invoked for a single tenant (the runAll /
 * forEachTenant cron path), its collection scans must be scoped to that tenant
 * rather than reading every tenant's settings/shifts and discarding the rest.
 */
class ReminderScopingTest extends TestCase
{
    use DatabaseTransactions;

    public function test_pre_shift_tenant_discovery_scan_is_scoped_to_the_target_tenant(): void
    {
        TenantContext::setById($this->testTenantId);

        DB::enableQueryLog();
        VolunteerReminderService::sendPreShiftReminders($this->testTenantId);
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        // Since 2026-10-18 the settings are tenant configuration, so the sweep
        // no longer reads the retired vol_reminder_settings table at all; it
        // discovers tenants from their upcoming shifts.
        $this->assertNull(
            collect($log)->first(fn ($q) => stripos($q['query'], 'vol_reminder_settings') !== false),
            'the sweep must not read the retired vol_reminder_settings table'
        );

        $shiftScan = collect($log)->first(
            fn ($q) => stripos($q['query'], 'vol_shifts') !== false
                && stripos($q['query'], 'start_time') !== false
        );

        $this->assertNotNull($shiftScan, 'the upcoming-shift discovery scan should run');
        $bindings = array_map(fn ($b) => is_numeric($b) ? (int) $b : $b, $shiftScan['bindings']);
        $this->assertContains(
            $this->testTenantId,
            $bindings,
            'the discovery scan must be scoped to the target tenant, not read every tenant'
        );
    }
}
