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
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression test for the 2026-06-12 reminder retry-storm fix.
 *
 * A recipient on the email_suppression list can never receive mail —
 * EmailDispatchService refuses the send and returns false. Previously the
 * reminder loop treated that as a transient failure, released its delivery
 * claim and retried the same dead address on EVERY cron run (observed in
 * production: 36 suppressed recipients × every 30 minutes, indefinitely).
 * Now a suppressed recipient is marked handled in vol_reminders_sent so it
 * is never retried.
 */
class ReminderSuppressedRecipientTest extends TestCase
{
    use DatabaseTransactions;

    public function test_suppressed_recipient_is_marked_handled_and_not_retried(): void
    {
        TenantContext::setById($this->testTenantId);

        $user = User::factory()->forTenant($this->testTenantId)->create();
        TenantContext::setById($this->testTenantId);

        DB::table('email_suppression')->insertOrIgnore([
            'email' => $user->email,
            'reason' => 'bounce',
            'suppressed_at' => now(),
            'created_at' => now(),
        ]);

        $oppId = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Suppression Test Opportunity',
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
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_REMINDER_PRE_SHIFT_ENABLED, true);
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_REMINDER_PRE_SHIFT_HOURS_BEFORE, 24);

        VolunteerReminderService::sendReminders($this->testTenantId, $oppId);

        // Marked handled → dedup row exists, so the next cron run skips this user.
        $this->assertTrue(
            DB::table('vol_reminders_sent')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('reminder_type', 'pre_shift')
                ->where('reference_id', $shiftId)
                ->exists(),
            'Suppressed recipient must be recorded in vol_reminders_sent (terminal), not released for retry'
        );

        // No email actually left the building.
        $this->assertFalse(
            DB::table('email_log')
                ->where('recipient_email', $user->email)
                ->where('status', 'sent')
                ->exists(),
            'No email may be sent to a suppressed recipient'
        );

        // Second run is a no-op for this user (no new claim rows piling up).
        VolunteerReminderService::sendReminders($this->testTenantId, $oppId);
        $this->assertSame(
            1,
            DB::table('vol_reminders_sent')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->where('reminder_type', 'pre_shift')
                ->count()
        );
    }
}
