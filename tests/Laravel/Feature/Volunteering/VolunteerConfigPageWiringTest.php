<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteeringConfigurationService;
use App\Services\VolunteerReminderService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Wiring of the admin page /admin/volunteering/config (audit 17 Oct 2026).
 * Each test pins a place where the page and the server disagreed. The page's
 * Custom Fields tab was removed in the same change (nothing ever used it).
 */
class VolunteerConfigPageWiringTest extends TestCase
{
    use DatabaseTransactions;

    // The webhook cases that lived here moved to
    // tests/Laravel/Feature/Integrations/AdminOutboundWebhooksControllerTest.php
    // with the endpoints (2026-10-18).

    private function forgetReminderSettings(): void
    {
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'LIKE', 'volunteering.reminder\_%')
            ->delete();
        Cache::forget("volunteering_config:{$this->testTenantId}");
    }

    public function test_manual_reminder_run_works_for_a_community_that_never_saved_settings(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->forgetReminderSettings();

        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        // A suppressed address means no real mail is sent, but the run still
        // records the volunteer as handled — proof the run reached them.
        DB::table('email_suppression')->insertOrIgnore([
            'email' => $user->email,
            'reason' => 'bounce',
            'suppressed_at' => now(),
            'created_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Wiring Opportunity',
            'description' => 'x',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $shiftId = (int) DB::table('vol_shifts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'start_time' => now()->addHours(3)->format('Y-m-d H:i:s'),
            'end_time' => now()->addHours(5)->format('Y-m-d H:i:s'),
            'capacity' => 5,
        ]);
        DB::table('vol_applications')->insert([
            'tenant_id' => $this->testTenantId,
            'opportunity_id' => $oppId,
            'shift_id' => $shiftId,
            'user_id' => $user->id,
            'status' => 'approved',
            'created_at' => now(),
        ]);

        VolunteerReminderService::sendReminders($this->testTenantId, $oppId);

        $this->assertTrue(
            DB::table('vol_reminders_sent')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('reminder_type', 'pre_shift')
                ->where('reference_id', $shiftId)
                ->exists(),
            'With no saved settings the defaults apply (on, 24 hours, email) — the same as the nightly job'
        );
    }

    public function test_manual_reminder_run_still_respects_a_switched_off_reminder(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->forgetReminderSettings();
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_REMINDER_PRE_SHIFT_ENABLED, false);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Wiring Opportunity Off',
            'description' => 'x',
            'is_active' => 1,
            'created_at' => now(),
        ]);

        $this->assertSame(0, VolunteerReminderService::sendReminders($this->testTenantId, $oppId));
    }
}
