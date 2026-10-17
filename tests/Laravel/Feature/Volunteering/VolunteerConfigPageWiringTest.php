<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\VolunteerReminderService;
use App\Services\WebhookDispatchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Wiring of the admin page /admin/volunteering/config (audit 17 Oct 2026).
 * Each test pins a place where the page and the server disagreed. The page's
 * Custom Fields tab was removed in the same change (nothing ever used it).
 */
class VolunteerConfigPageWiringTest extends TestCase
{
    use DatabaseTransactions;

    private function actAsAdmin(): User
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    public function test_testing_an_unknown_webhook_is_not_found_not_a_server_error(): void
    {
        $this->actAsAdmin();

        $this->apiPost('/v2/admin/volunteering/webhooks/999999999/test', [])->assertStatus(404);
    }

    public function test_webhook_failure_count_rises_on_failure_and_resets_on_success(): void
    {
        $admin = $this->actAsAdmin();

        $id = (int) DB::table('outbound_webhooks')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'created_by' => $admin->id,
            'name' => 'Wiring hook',
            'url' => 'https://example.com/hook',
            'events' => json_encode(['shift.completed']),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, false);
        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, false);
        $this->assertSame(2, (int) DB::table('outbound_webhooks')->where('id', $id)->value('failure_count'));

        WebhookDispatchService::recordDeliveryOutcome($this->testTenantId, $id, true);
        $row = DB::table('outbound_webhooks')->where('id', $id)->first();
        $this->assertSame(0, (int) $row->failure_count);
        $this->assertNotNull($row->last_triggered_at);
    }

    public function test_manual_reminder_run_works_for_a_community_that_never_saved_settings(): void
    {
        TenantContext::setById($this->testTenantId);
        DB::table('vol_reminder_settings')->where('tenant_id', $this->testTenantId)->delete();

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
        DB::table('vol_reminder_settings')->where('tenant_id', $this->testTenantId)->delete();
        DB::table('vol_reminder_settings')->insert([
            'tenant_id' => $this->testTenantId,
            'reminder_type' => 'pre_shift',
            'enabled' => 0,
            'hours_before' => 24,
            'email_enabled' => 1,
            'created_at' => now(),
        ]);

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
