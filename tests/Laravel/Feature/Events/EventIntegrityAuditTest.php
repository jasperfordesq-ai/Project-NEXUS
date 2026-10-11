<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use App\Services\EventIntegrityAuditService;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventIntegrityAuditTest extends TestCase
{
    use DatabaseTransactions;

    public function test_audit_is_read_only_and_reports_cross_tenant_organizer_link(): void
    {
        $foreignOrganizer = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $foreignOrganizer->id,
            'title' => 'Cross-tenant integrity fixture',
            'description' => 'Must be reported without repair.',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $before = [
            'events' => DB::table('events')->count(),
            'rsvps' => DB::table('event_rsvps')->count(),
            'attendance' => DB::table('event_attendance')->count(),
            'transactions' => DB::table('transactions')->count(),
        ];

        $result = (new EventIntegrityAuditService())->run($this->testTenantId, 20);

        $issue = collect($result['issues'])->firstWhere('code', 'event_organizer_tenant_mismatch');
        $this->assertNotNull($issue);
        $this->assertContains($eventId, $issue['sample_ids']);
        $this->assertTrue($result['read_only']);
        $this->assertTrue($result['blocking']);
        $this->assertSame($before, [
            'events' => DB::table('events')->count(),
            'rsvps' => DB::table('event_rsvps')->count(),
            'attendance' => DB::table('event_attendance')->count(),
            'transactions' => DB::table('transactions')->count(),
        ]);
    }

    public function test_command_returns_nonzero_for_blocking_integrity_issue(): void
    {
        $foreignOrganizer = User::factory()->forTenant(999)->create();
        DB::table('events')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $foreignOrganizer->id,
            'title' => 'Blocking audit fixture',
            'description' => 'Command exit-code fixture.',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->artisan('events:integrity-audit', [
            '--tenant' => $this->testTenantId,
            '--json' => true,
            '--dry-run' => true,
        ])->assertExitCode(1);
    }

    public function test_audit_reconciles_attendance_activity_claims_and_credited_facts(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $attendee = User::factory()->forTenant($this->testTenantId)->create();
        $foreignActor = User::factory()->forTenant(999)->create();
        $eventId = (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Attendance audit fixture',
            'description' => 'Attendance audit fixture.',
            'start_time' => now()->subHour(),
            'end_time' => now(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'audit:event:' . uniqid(),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'attended',
            'created_at' => now(),
        ]);
        $attendanceId = (int) DB::table('event_attendance')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'attendance_status' => 'checked_in',
            'attendance_version' => 1,
            'checked_in_at' => now(),
            'checked_in_by' => $organizer->id,
            'hours_credited' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_attendance_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'attendance_id' => $attendanceId,
            'user_id' => $attendee->id,
            'actor_user_id' => $foreignActor->id,
            'attendance_version' => 1,
            'action' => 'check_in',
            'to_status' => 'checked_in',
            'idempotency_key' => 'audit-activity:' . uniqid(),
            'metadata' => json_encode(['fixture' => true], JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
        DB::table('event_attendance_credit_claims')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'attendance_id' => $attendanceId,
            'user_id' => $attendee->id,
            'claim_type' => 'attendance_reward',
            'idempotency_key' => 'audit-claim:' . uniqid(),
            'funding_source_type' => 'tenant',
            'payee_user_id' => $attendee->id,
            'amount' => 1,
            'unit' => 'time_credit',
            'status' => 'completed',
            'transaction_id' => null,
            'metadata' => json_encode(['fixture' => true], JSON_THROW_ON_ERROR),
            'completed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $issues = collect((new EventIntegrityAuditService())->run($this->testTenantId, 20)['issues'])
            ->pluck('code');

        self::assertTrue($issues->contains('event_attendance_activity_actor_tenant_mismatch'));
        self::assertTrue($issues->contains('event_attendance_completed_claim_transaction_mismatch'));
        self::assertFalse($issues->contains('event_attendance_credited_without_completed_claim'));

        DB::table('event_attendance_credit_claims')
            ->where('event_id', $eventId)
            ->update(['status' => 'failed', 'completed_at' => null, 'failed_at' => now()]);
        $issuesAfterFailedClaim = collect((new EventIntegrityAuditService())->run($this->testTenantId, 20)['issues'])
            ->pluck('code');
        self::assertTrue($issuesAfterFailedClaim->contains('event_attendance_credited_without_completed_claim'));
    }

    public function test_calendar_token_audit_is_aggregate_only_and_detects_owner_crypto_and_limit_failures(): void
    {
        config()->set('events.calendar.max_active_feed_tokens', 1);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'preferred_language' => 'en',
        ]);
        DB::table('event_calendar_feed_tokens')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'token_hash' => 'malformed',
                'token_prefix' => 'bad',
                'locale' => 'xx',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => $member->id,
                'token_hash' => hash('sha256', 'first-valid-token'),
                'token_prefix' => 'nxc_12345678',
                'locale' => 'en',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'user_id' => 999999999,
                'token_hash' => hash('sha256', 'orphan-token'),
                'token_prefix' => 'nxc_abcdef12',
                'locale' => 'en',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $result = (new EventIntegrityAuditService())->run($this->testTenantId, 20);
        $codes = collect($result['issues'])->pluck('code');
        self::assertTrue($codes->contains('event_calendar_feed_token_owner_mismatch'));
        self::assertTrue($codes->contains('event_calendar_feed_token_evidence_invalid'));
        self::assertTrue($codes->contains('event_calendar_feed_token_active_limit_exceeded'));

        $encoded = json_encode($result, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString('malformed', $encoded);
        self::assertStringNotContainsString('nxc_12345678', $encoded);
        self::assertStringNotContainsString(hash('sha256', 'first-valid-token'), $encoded);
    }

    public function test_attendance_reconciliation_uses_canonical_precedence(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalConfirmed = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalCancelled = User::factory()->forTenant($this->testTenantId)->create();
        $canonicalWithoutAttendance = User::factory()->forTenant($this->testTenantId)->create();
        $legacyOnly = User::factory()->forTenant($this->testTenantId)->create();
        $confirmedEvent = $this->auditEvent((int) $organizer->id);
        $cancelledEvent = $this->auditEvent((int) $organizer->id);
        $canonicalLegacyEvent = $this->auditEvent((int) $organizer->id);
        $legacyEvent = $this->auditEvent((int) $organizer->id);
        $this->canonicalRegistration($confirmedEvent, (int) $canonicalConfirmed->id, 'confirmed');
        $this->canonicalRegistration($cancelledEvent, (int) $canonicalCancelled->id, 'cancelled');
        $this->canonicalRegistration(
            $canonicalLegacyEvent,
            (int) $canonicalWithoutAttendance->id,
            'confirmed',
        );
        $confirmedAttendance = $this->attendance($confirmedEvent, (int) $canonicalConfirmed->id);
        $cancelledAttendance = $this->attendance($cancelledEvent, (int) $canonicalCancelled->id);
        DB::table('event_rsvps')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $cancelledEvent,
                'user_id' => $canonicalCancelled->id,
                'status' => 'attended',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $legacyEvent,
                'user_id' => $legacyOnly->id,
                'status' => 'attended',
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $canonicalLegacyEvent,
                'user_id' => $canonicalWithoutAttendance->id,
                'status' => 'attended',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $result = (new EventIntegrityAuditService())->run($this->testTenantId, 1000);
        $attendanceIssue = collect($result['issues'])
            ->firstWhere('code', 'attendance_without_attended_rsvp');
        self::assertNotNull($attendanceIssue);
        self::assertNotContains($confirmedAttendance, $attendanceIssue['sample_ids']);
        self::assertContains($cancelledAttendance, $attendanceIssue['sample_ids']);
        $legacyIssue = collect($result['issues'])
            ->firstWhere('code', 'attended_rsvp_without_attendance');
        self::assertNotNull($legacyIssue);
        $legacyRsvpId = (int) DB::table('event_rsvps')
            ->where('event_id', $legacyEvent)
            ->where('user_id', $legacyOnly->id)
            ->value('id');
        $canonicalRsvpId = (int) DB::table('event_rsvps')
            ->where('event_id', $canonicalLegacyEvent)
            ->where('user_id', $canonicalWithoutAttendance->id)
            ->value('id');
        self::assertContains($legacyRsvpId, $legacyIssue['sample_ids']);
        self::assertNotContains($canonicalRsvpId, $legacyIssue['sample_ids']);
    }

    public function test_terminal_event_drift_reports_active_facts_reminders_and_live_envelopes(): void
    {
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('event_waitlist.envelope.active_key_version', 'integrity-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();

        $organizer = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $active = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $holder = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $waiter = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $eventId = $this->auditEvent((int) $organizer->id, 2, true);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm($eventId, (int) $active->id, $active, 'integrity-active');
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'integrity-holder');
        $waitlist->join($eventId, (int) $waiter->id, $waiter, 'integrity-waiter');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $waitlist->offerNext($eventId, $organizer, 'integrity-offer');
        self::assertNotNull($offer);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $active->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('events')->where('id', $eventId)->update([
            'operational_status' => 'cancelled',
            'status' => 'cancelled',
        ]);

        $result = (new EventIntegrityAuditService())->run($this->testTenantId, 1000);
        $codes = collect($result['issues'])->pluck('code');
        self::assertTrue($codes->contains('terminal_event_active_canonical_registration'));
        self::assertTrue($codes->contains('terminal_event_active_canonical_waitlist'));
        self::assertTrue($codes->contains('terminal_event_live_offer_envelope'));
        self::assertTrue($codes->contains('terminal_event_pending_reminder'));
        $encoded = json_encode($result, JSON_THROW_ON_ERROR);
        self::assertStringNotContainsString((string) $offer->offerToken, $encoded);
        self::assertStringNotContainsString(
            (string) DB::table('event_waitlist_entries')
                ->where('id', $offer->entry->id)
                ->value('offer_token_hash'),
            $encoded,
        );
    }

    private function auditEvent(int $organizerId, ?int $capacity = null, bool $future = false): int
    {
        $start = $future ? now()->addDay() : now()->subHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Integrity canonical fixture',
            'description' => 'Integrity canonical fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'integrity:' . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => $capacity,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function canonicalRegistration(int $eventId, int $userId, string $state): void
    {
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'registration_state' => $state,
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $userId,
            'confirmed_at' => $state === 'confirmed' ? now() : null,
            'cancelled_at' => $state === 'cancelled' ? now() : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function attendance(int $eventId, int $userId): int
    {
        return (int) DB::table('event_attendance')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'attendance_status' => 'checked_in',
            'attendance_version' => 1,
            'status_changed_at' => now(),
            'status_changed_by' => $userId,
            'checked_in_at' => now(),
            'checked_in_by' => $userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
