<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Services\VolunteeringConfigurationService;
use Tests\Laravel\TestCase;
use App\Services\VolunteerReminderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

class VolunteerReminderServiceTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Reminder settings are tenant configuration (`volunteering.reminder_*`)
     * since 2026-10-18. No saved value means the defaults apply (see
     * VolunteerConfigPageWiringTest); only an explicit "off" stops the run.
     */
    public function test_sendReminders_returns_zero_when_switched_off(): void
    {
        TenantContext::setById($this->testTenantId);
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_REMINDER_PRE_SHIFT_ENABLED, false);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Reminder off',
            'description' => 'x',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        DB::table('vol_shifts')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addHours(3)->format('Y-m-d H:i:s'),
            'end_time' => now()->addHours(5)->format('Y-m-d H:i:s'),
            'capacity' => 5,
        ]);

        $this->assertSame(0, VolunteerReminderService::sendReminders($this->testTenantId, $oppId));
    }

    public function test_sendReminders_returns_zero_when_no_shifts(): void
    {
        TenantContext::setById($this->testTenantId);
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_REMINDER_PRE_SHIFT_ENABLED, true);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'No shifts',
            'description' => 'x',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $this->assertSame(0, VolunteerReminderService::sendReminders($this->testTenantId, $oppId));
    }

    public function test_updateSetting_returns_false_for_invalid_type(): void
    {
        $this->assertFalse(VolunteerReminderService::updateSetting('invalid_type', ['enabled' => true]));
    }

    public function test_updateSetting_accepts_valid_types(): void
    {
        $validTypes = ['pre_shift', 'post_shift_feedback', 'lapsed_volunteer', 'credential_expiry', 'training_expiry'];

        foreach ($validTypes as $type) {
            // Mock DB for each call
            DB::shouldReceive('table')->with('vol_reminder_settings')->andReturnSelf();
            DB::shouldReceive('where')->andReturnSelf();
            DB::shouldReceive('first')->andReturn(null);
            DB::shouldReceive('insert')->andReturn(true);

            $this->assertTrue(VolunteerReminderService::updateSetting($type, ['enabled' => true]));
        }
    }

    public function test_getSettings_returns_defaults_when_no_rows(): void
    {
        DB::shouldReceive('table')->with('vol_reminder_settings')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = VolunteerReminderService::getSettings();

        $this->assertCount(5, $result);
        $this->assertEquals('pre_shift', $result[0]['reminder_type']);
        $this->assertNull($result[0]['id']);
    }

    public function test_email_channel_claims_are_released_when_recipient_email_is_not_valid(): void
    {
        $source = file_get_contents(app_path('Services/VolunteerReminderService.php'));

        $this->assertGreaterThanOrEqual(3, substr_count($source, 'filter_var($user->email, FILTER_VALIDATE_EMAIL)'));
        $this->assertStringContainsString('sendReminders email channel claimed without valid recipient email', $source);
        $this->assertStringContainsString('sendPreShiftReminders email channel claimed without valid recipient email', $source);
        $this->assertStringContainsString('sendPostShiftFeedback email channel claimed without valid recipient email', $source);
    }

    // ── restrictToTenant() — the runAll N× redundant-sweep fix ──────────────────

    private function invokeRestrictToTenant(array $tenantIds, ?int $onlyTenantId): array
    {
        $method = new \ReflectionMethod(VolunteerReminderService::class, 'restrictToTenant');
        $method->setAccessible(true);

        /** @var array<int,int> $result */
        $result = $method->invoke(null, $tenantIds, $onlyTenantId);

        return $result;
    }

    public function test_restrictToTenant_returns_all_tenants_when_none_specified(): void
    {
        // Standalone (single, all-tenant) callers pass null → unchanged behaviour,
        // normalised to ints.
        $this->assertSame([2, 3, 5], $this->invokeRestrictToTenant([2, 3, '5'], null));
    }

    public function test_restrictToTenant_narrows_to_single_eligible_tenant(): void
    {
        // The runAll scheduler passes the current tenant → only that tenant is
        // processed, killing the N× re-sweep.
        $this->assertSame([3], $this->invokeRestrictToTenant([2, 3, 5], 3));
    }

    public function test_restrictToTenant_returns_empty_when_tenant_has_no_work(): void
    {
        // A tenant not in the eligible set has nothing to send — the all-tenant
        // sweep would have skipped it too, so semantics are preserved.
        $this->assertSame([], $this->invokeRestrictToTenant([2, 3, 5], 99));
    }
}
