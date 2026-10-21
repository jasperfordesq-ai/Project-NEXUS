<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Jobs\SendVolunteerLowMoodEmails;
use App\Models\User;
use App\Services\EmailDispatchService;
use App\Services\VolunteeringConfigurationService;
use App\Services\VolunteerWellbeingService as Wellbeing;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The wellbeing audit of 21 Oct 2026 (.local-docs-archive/wellbeing-audit-2026-10-21),
 * turned from "reproduces the fault" into "proves the fix". One test per finding,
 * numbered as in the report. Each runs in a community of its own so that who is
 * told is exactly what is counted.
 */
class WellbeingAuditRegressionTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => 'Wellbeing audit', 'slug' => 'wb-audit-' . uniqid(), 'domain' => null,
            'is_active' => true, 'parent_id' => null, 'path' => '/', 'depth' => 0,
            'allows_subtenants' => false, 'features' => json_encode(['volunteering' => true]),
            'contact_email' => 'support@example.test', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/{$id}/"]);
        $this->withTenant($id);
        Queue::fake();
    }

    private function volunteer(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'role' => 'member', 'status' => 'active', 'is_approved' => true,
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }

    private function sharedLowCheckin(int $userId, int $daysAgo = 0): int
    {
        return (int) DB::table('vol_mood_checkins')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $userId, 'mood' => 1,
            'share_with_team' => 1, 'created_at' => now()->subDays($daysAgo),
        ]);
    }

    private function alertFor(int $userId): object
    {
        return DB::table('vol_wellbeing_alerts')->where('tenant_id', $this->testTenantId)->where('user_id', $userId)->orderByDesc('id')->first();
    }

    // ── 4. Acknowledging must not create a duplicate ──────────────────────────

    public function test_an_acknowledged_alert_is_refreshed_not_duplicated_by_the_next_assessment(): void
    {
        $user = $this->volunteer();
        $this->sharedLowCheckin($user->id);
        Wellbeing::detectBurnoutRisk($user->id, true);
        $alert = $this->alertFor($user->id);
        $this->assertTrue(Wellbeing::updateAlert((int) $alert->id, 'acknowledged'));

        Wellbeing::runTenantAssessment();

        $this->assertSame(1, DB::table('vol_wellbeing_alerts')->where('user_id', $user->id)->count());
        $this->assertSame('acknowledged', $this->alertFor($user->id)->status);
    }

    public function test_a_resolved_alert_is_reopened_only_by_a_newer_checkin(): void
    {
        $user = $this->volunteer();
        $this->sharedLowCheckin($user->id, 2);
        Wellbeing::detectBurnoutRisk($user->id, true);
        $first = $this->alertFor($user->id);
        $this->assertTrue(Wellbeing::updateAlert((int) $first->id, 'resolved'));
        // Concluded a few minutes ago, so a check-in made now is clearly newer.
        DB::table('vol_wellbeing_alerts')->where('id', $first->id)->update(['resolved_at' => now()->subMinutes(5), 'updated_at' => now()->subMinutes(5)]);

        // Same check-in, assessed again: nothing new happened, so no new alert.
        Wellbeing::runTenantAssessment();
        $this->assertSame(1, DB::table('vol_wellbeing_alerts')->where('user_id', $user->id)->count());

        // A fresh shared Struggling check-in after the resolution is a new signal.
        $this->sharedLowCheckin($user->id, 0);
        Wellbeing::runTenantAssessment();
        $this->assertSame(2, DB::table('vol_wellbeing_alerts')->where('user_id', $user->id)->count());
        $this->assertSame('active', $this->alertFor($user->id)->status);
    }

    // ── 5. A mood-only alert must close once its signal has aged out ──────────

    public function test_an_expired_mood_only_alert_is_resolved_by_the_assessment(): void
    {
        $user = $this->volunteer();
        $checkin = $this->sharedLowCheckin($user->id);
        Wellbeing::detectBurnoutRisk($user->id, true);
        $this->assertSame('active', $this->alertFor($user->id)->status);

        DB::table('vol_mood_checkins')->where('id', $checkin)->update(['created_at' => now()->subDays(15)]);
        $summary = Wellbeing::runTenantAssessment();

        $this->assertSame(1, $summary['total_assessed'], 'a volunteer with an open alert is still visited');
        $this->assertSame('resolved', $this->alertFor($user->id)->status);
    }

    // ── 1. "Told" must not survive a delivery that failed ─────────────────────

    public function test_a_failed_email_only_delivery_does_not_block_the_next_checkin(): void
    {
        $user = $this->volunteer();
        $first = Wellbeing::recordCheckin($user->id, 1, null, true);
        $this->assertSame('told', $first['outcome']);
        $this->assertSame(1, $first['told_count']);

        // The queued email to the community address later fails.
        DB::table('vol_wellbeing_alert_notifications')->where('checkin_id', $first['id'])->update(['status' => 'failed']);

        $again = Wellbeing::recordCheckin($user->id, 1, null, true);
        $this->assertSame('told', $again['outcome'], 'a day on which nobody was reached does not block the retry');
        $this->assertSame(1, $again['told_count']);
        $this->assertNull(DB::table('vol_mood_checkins')->where('id', $first['id'])->value('team_notified_at'), 'the stale stamp is cleared');
    }

    // ── 2. Transient email failures are retried ──────────────────────────────

    public function test_a_transient_email_failure_leaves_the_row_queued_and_makes_the_job_retry(): void
    {
        $user = $this->volunteer();
        $checkin = $this->sharedLowCheckin($user->id);
        $row = $this->queuedEmailRow($checkin, $user->id);
        $this->mock(EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->once()->andReturn(false));

        $job = new SendVolunteerLowMoodEmails($this->testTenantId, $user->id, 'Synthetic Volunteer', 1, [$row]);
        $thrown = null;
        try {
            $job->handle();
        } catch (\Throwable $e) {
            $thrown = $e;
        }

        $this->assertNotNull($thrown, 'the job must fail so the queue retries it');
        $saved = DB::table('vol_wellbeing_alert_notifications')->where('id', $row)->first();
        $this->assertSame('queued', $saved->status);
        $this->assertSame('send_false', $saved->error_code);
    }

    public function test_the_last_attempt_records_the_failure_and_clears_the_told_stamp(): void
    {
        $user = $this->volunteer();
        $checkin = $this->sharedLowCheckin($user->id);
        DB::table('vol_mood_checkins')->where('id', $checkin)->update(['team_notified_at' => now()]);
        $row = $this->queuedEmailRow($checkin, $user->id);
        $this->mock(EmailDispatchService::class, fn ($mock) => $mock->shouldReceive('send')->once()->andReturn(false));

        $job = new SendVolunteerLowMoodEmails($this->testTenantId, $user->id, 'Synthetic Volunteer', 1, [$row]);
        $job->tries = 1;
        $job->handle();

        $this->assertSame('failed', DB::table('vol_wellbeing_alert_notifications')->where('id', $row)->value('status'));
        $this->assertNull(DB::table('vol_mood_checkins')->where('id', $checkin)->value('team_notified_at'), 'nobody was reached, so the check-in no longer counts as told');
    }

    private function queuedEmailRow(int $checkin, int $userId): int
    {
        return (int) DB::table('vol_wellbeing_alert_notifications')->insertGetId([
            'tenant_id' => $this->testTenantId, 'checkin_id' => $checkin, 'volunteer_user_id' => $userId,
            'recipient_email' => 'support@example.test', 'tier' => 'community_contact_email',
            'channel' => 'email', 'status' => 'queued', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    // ── 7. Future bookings are not past activity ─────────────────────────────

    public function test_future_shifts_do_not_count_as_recent_activity(): void
    {
        $user = $this->volunteer();
        $opp = (int) DB::table('vol_opportunities')->insertGetId([
            'tenant_id' => $this->testTenantId, 'title' => 'Audit opp', 'description' => 'x', 'is_active' => 1, 'created_at' => now(),
        ]);
        // Two shifts worked 45 days ago, none in the last 30 days, two booked for next month.
        foreach ([-45, -44, 20, 25] as $offset) {
            $shift = (int) DB::table('vol_shifts')->insertGetId([
                'tenant_id' => $this->testTenantId, 'opportunity_id' => $opp,
                'start_time' => now()->addDays($offset)->format('Y-m-d H:i:s'),
                'end_time' => now()->addDays($offset)->addHours(2)->format('Y-m-d H:i:s'), 'capacity' => 2,
            ]);
            DB::table('vol_applications')->insert([
                'tenant_id' => $this->testTenantId, 'opportunity_id' => $opp, 'shift_id' => $shift,
                'user_id' => $user->id, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        $shifts = Wellbeing::detectBurnoutRisk($user->id)['indicators']['shift_frequency'];

        $this->assertSame(0, $shifts['recent_count']);
        $this->assertSame(2, $shifts['previous_count']);
        $this->assertSame('declining', $shifts['trend']);
    }

    // ── 10. Cancellations are not measured, and must say so ──────────────────

    public function test_the_cancellation_rate_is_reported_as_not_measured(): void
    {
        $user = $this->volunteer();
        $cancel = Wellbeing::detectBurnoutRisk($user->id)['indicators']['cancellation_rate'];

        $this->assertFalse($cancel['measured']);
        $this->assertNull($cancel['rate_percent']);
        $this->assertNull($cancel['cancelled']);
    }

    // ── 8. The count is of OTHER people; a lone staff volunteer is told so ────

    public function test_a_lone_staff_volunteer_learns_nobody_else_was_told(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => null]);
        $admin = $this->volunteer(['role' => 'admin', 'is_admin' => true]);

        $result = Wellbeing::recordCheckin($admin->id, 1, null, true);

        $this->assertSame('told_self_only', $result['outcome']);
        $this->assertSame(0, $result['told_count'], 'the volunteer is not counted as someone else');
        $this->assertTrue($result['team_notified']);
    }

    public function test_the_told_count_excludes_the_volunteer_themself(): void
    {
        DB::table('tenants')->where('id', $this->testTenantId)->update(['contact_email' => null]);
        $admin = $this->volunteer(['role' => 'admin', 'is_admin' => true]);
        $this->volunteer(['role' => 'admin', 'is_admin' => true]);

        $result = Wellbeing::recordCheckin($admin->id, 1, null, true);

        $this->assertSame('told', $result['outcome']);
        $this->assertSame(1, $result['told_count']);
    }

    // ── 12. The mood word is in the recipient's language ─────────────────────

    public function test_the_bell_says_the_mood_in_the_recipients_language(): void
    {
        $volunteer = $this->volunteer(['preferred_language' => 'en']);
        $staff = $this->volunteer(['role' => 'admin', 'is_admin' => true, 'preferred_language' => 'de']);
        app()->setLocale('en');

        Wellbeing::recordCheckin($volunteer->id, 1, null, true);

        $bell = DB::table('notifications')->where('user_id', $staff->id)->orderByDesc('id')->first();
        $this->assertNotNull($bell);
        $this->assertStringContainsString(__('emails_misc.volunteer_wellbeing.mood_1', [], 'de'), (string) $bell->message);
        $this->assertStringNotContainsString(__('emails_misc.volunteer_wellbeing.mood_1', [], 'en'), (string) $bell->message);
    }

    // ── Setup observation: hiding the tab switches wellbeing off ─────────────

    public function test_the_assessment_skips_a_community_whose_wellbeing_tab_is_off(): void
    {
        $user = $this->volunteer();
        $this->sharedLowCheckin($user->id);
        VolunteeringConfigurationService::set(VolunteeringConfigurationService::CONFIG_TAB_WELLBEING, false);

        $summary = Wellbeing::runTenantAssessment();

        $this->assertSame(0, $summary['total_assessed']);
        $this->assertTrue($summary['skipped'] ?? false);
        $this->assertDatabaseMissing('vol_wellbeing_alerts', ['user_id' => $user->id]);
    }

    public function test_the_assessment_skips_a_community_without_the_volunteering_feature(): void
    {
        $user = $this->volunteer();
        $this->sharedLowCheckin($user->id);
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode(['volunteering' => false])]);
        TenantContext::setById($this->testTenantId);

        $summary = Wellbeing::runTenantAssessment();

        $this->assertSame(0, $summary['total_assessed']);
        $this->assertDatabaseMissing('vol_wellbeing_alerts', ['user_id' => $user->id]);
    }

    // ── Setup observation: an unscored volunteer is not "excellent" ──────────

    public function test_the_dashboard_says_when_there_is_nothing_to_score(): void
    {
        $user = $this->volunteer();
        Sanctum::actingAs($user);

        $empty = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');
        $this->assertSame('no_data', $empty['score_basis']);

        $this->sharedLowCheckin($user->id);
        $scored = $this->apiGet('/v2/volunteering/wellbeing')->assertOk()->json('data');
        $this->assertSame('activity', $scored['score_basis']);
        $this->assertLessThan(100, $scored['score']);
    }

    // ── Setup observation: notes outlive a deleted alert ─────────────────────

    public function test_a_staff_note_can_be_deleted_only_once_its_alert_is_gone(): void
    {
        if (DB::getDriverName() !== 'mysql') {
            $this->markTestSkipped('trigger behaviour is MySQL/MariaDB only');
        }
        $user = $this->volunteer();
        $this->sharedLowCheckin($user->id);
        Wellbeing::detectBurnoutRisk($user->id, true);
        $alert = $this->alertFor($user->id);
        $note = (int) DB::table('vol_wellbeing_alert_notes')->insertGetId([
            'tenant_id' => $this->testTenantId, 'alert_id' => $alert->id, 'author_user_id' => $user->id,
            'body' => 'Spoke to them', 'created_at' => now(),
        ]);

        $refused = false;
        try {
            DB::table('vol_wellbeing_alert_notes')->where('id', $note)->delete();
        } catch (\Throwable $e) {
            $refused = true;
        }
        $this->assertTrue($refused, 'a note on a live alert stays');

        DB::table('vol_wellbeing_alerts')->where('id', $alert->id)->delete();
        Wellbeing::deleteOrphanedNotes($this->testTenantId);
        $this->assertDatabaseMissing('vol_wellbeing_alert_notes', ['id' => $note]);
    }
}
