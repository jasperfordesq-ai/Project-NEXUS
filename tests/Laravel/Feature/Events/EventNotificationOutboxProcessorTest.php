<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventNotificationDeliveryMode;
use App\Models\User;
use App\Services\EventDomainOutboxService;
use App\Services\EventNotificationErrorSanitizer;
use App\Services\EventNotificationOutboxConsumer;
use App\Services\EventNotificationOutboxDiagnostics;
use App\Services\EventNotificationOutboxProcessor;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

final class EventNotificationOutboxProcessorTest extends TestCase
{
    use DatabaseTransactions;

    private EventDomainOutboxService $outbox;

    protected function setUp(): void
    {
        parent::setUp();
        $this->outbox = new EventDomainOutboxService();
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('events.notification_delivery.max_attempts', 3);
    }

    public function test_authoritative_registration_delivery_is_localized_and_idempotent(): void
    {
        App::setLocale('en');
        $organizer = $this->member('en');
        $attendee = $this->member('de');
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Sprachwerkstatt');
        $row = $this->registrationFact($eventId, (int) $attendee->id, 'confirmed');

        $first = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);
        $second = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $first['processed']);
        $this->assertSame(0, $second['claimed']);
        $this->assertSame('processed', DB::table('event_domain_outbox')->where('id', $row['id'])->value('status'));
        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $attendee->id)
            ->where('message', 'Ihre Anmeldung für „Sprachwerkstatt“ ist bestätigt.')
            ->count());
        $this->assertSame('en', App::getLocale());
    }

    public function test_inactive_recipient_gets_terminal_channel_suppression_evidence(): void
    {
        Config::set('events.notification_delivery.channels', ['email', 'in_app', 'push']);
        $organizer = $this->member();
        $attendee = $this->member();
        DB::table('users')->where('id', $attendee->id)->update(['status' => 'inactive']);
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, (int) $attendee->id, 'confirmed');

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $summary['processed']);
        $this->assertSame(3, DB::table('event_notification_deliveries')
            ->where('outbox_id', $row['id'])
            ->where('recipient_user_id', $attendee->id)
            ->where('status', 'suppressed')
            ->where('suppression_reason', 'recipient_ineligible')
            ->count());
    }

    public function test_missing_recipient_reference_dead_letters_with_payload_free_reason(): void
    {
        Config::set('events.notification_delivery.max_attempts', 1);
        $organizer = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, 2_000_000_001, 'confirmed');

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);
        $stored = DB::table('event_domain_outbox')->where('id', $row['id'])->first();

        $this->assertSame(1, $summary['dead_lettered']);
        $this->assertSame('dead_letter', $stored->status);
        $this->assertSame('event_notification_recipient_missing', $stored->last_error);
        $this->assertStringNotContainsString('2000000001', (string) $stored->last_error);
    }

    public function test_participant_fact_fails_closed_when_canonical_table_is_unavailable(): void
    {
        Config::set('events.notification_delivery.max_attempts', 1);
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, (int) $attendee->id, 'confirmed');
        Schema::shouldReceive('hasTable')
            ->once()
            ->with('event_registrations')
            ->andReturnFalse();

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(0, $summary['processed']);
        $this->assertSame(1, $summary['dead_lettered']);
        $this->assertDatabaseHas('event_domain_outbox', [
            'id' => $row['id'],
            'status' => 'dead_letter',
            'last_error' => 'event_notification_participant_schema_unavailable',
        ]);
        $this->assertSame(0, DB::table('event_notification_deliveries')->where('outbox_id', $row['id'])->count());
        $this->assertSame(0, DB::table('notifications')->where('user_id', $attendee->id)->count());
    }

    public function test_participant_fact_fails_closed_when_canonical_row_is_missing(): void
    {
        Config::set('events.notification_delivery.max_attempts', 1);
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->outbox->record(
            $this->testTenantId,
            $eventId,
            1,
            'event.registration.confirmed',
            "event:{$eventId}:registration:missing-canonical:v1",
            [
                'schema_version' => 1,
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'registration_id' => 9_999_999,
                'user_id' => (int) $attendee->id,
                'registration_version' => 1,
                'to_state' => 'confirmed',
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(0, $summary['processed']);
        $this->assertSame(1, $summary['dead_lettered']);
        $this->assertDatabaseHas('event_domain_outbox', [
            'id' => $row['id'],
            'status' => 'dead_letter',
            'last_error' => 'event_notification_participant_canonical_state_unavailable',
        ]);
        $this->assertSame(0, DB::table('event_notification_deliveries')->where('outbox_id', $row['id'])->count());
        $this->assertSame(0, DB::table('notifications')->where('user_id', $attendee->id)->count());
    }

    public function test_attendance_domain_fact_is_not_claimed_by_notification_consumer(): void
    {
        $organizer = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $attendance = $this->outbox->record(
            $this->testTenantId,
            $eventId,
            1,
            'event.attendance.checked_in',
            "event:{$eventId}:attendance:v1",
            ['schema_version' => 1, 'tenant_id' => $this->testTenantId, 'event_id' => $eventId, 'attendee_user_id' => (int) $organizer->id],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
        // Simulate a pre-stream-expansion domain fact. The notification
        // consumer must ignore it both as a candidate and as an ordering barrier.
        DB::table('event_domain_outbox')->where('id', $attendance['id'])->update([
            'aggregate_stream' => 'event',
        ]);
        $lifecycle = $this->lifecycleFact($eventId, (int) $organizer->id, 'published');

        $claimed = (new EventNotificationOutboxConsumer())->claimBatch(10, $this->testTenantId);

        $this->assertCount(1, $claimed);
        $this->assertSame((int) $lifecycle['id'], (int) $claimed[0]['id']);
        $this->assertSame('pending', DB::table('event_domain_outbox')->where('id', $attendance['id'])->value('status'));
    }

    public function test_non_notification_fact_is_excluded_from_stale_release_replay_and_diagnostics(): void
    {
        $organizer = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->outbox->record(
            $this->testTenantId,
            $eventId,
            1,
            'event.attendance.checked_in',
            "event:{$eventId}:attendance:scope-test",
            ['schema_version' => 1, 'tenant_id' => $this->testTenantId, 'event_id' => $eventId, 'attendee_user_id' => (int) $organizer->id],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
        DB::table('event_domain_outbox')->where('id', $row['id'])->update([
            'status' => 'processing',
            'claim_token' => 'domain-consumer-claim',
            'claimed_at' => now()->subHour(),
        ]);
        $consumer = new EventNotificationOutboxConsumer();

        $this->assertSame(0, $consumer->releaseStaleClaims());
        $this->assertSame('processing', DB::table('event_domain_outbox')->where('id', $row['id'])->value('status'));
        DB::table('event_domain_outbox')->where('id', $row['id'])->update([
            'status' => 'dead_letter',
            'attempts' => 5,
            'claim_token' => null,
            'claimed_at' => null,
            'dead_lettered_at' => now(),
        ]);

        $this->assertFalse($consumer->replayDeadLetter(
            (int) $row['id'],
            'operator@example.test',
            'Must remain owned by attendance consumer',
            $this->testTenantId,
        ));
        $this->assertSame(0, DB::table('event_notification_outbox_replays')->where('outbox_id', $row['id'])->count());
        $snapshot = (new EventNotificationOutboxDiagnostics())->snapshot($this->testTenantId);
        $this->assertSame(0, $snapshot['dead_lettered']);
        $this->assertSame(1, $snapshot['excluded_domain_facts']);
    }

    public function test_failed_terminal_channel_intentionally_dead_letters_parent_fact(): void
    {
        Config::set('events.notification_delivery.max_attempts', 1);
        $organizer = $this->member();
        $attendee = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, (int) $attendee->id, 'confirmed');
        $key = EventDomainOutboxService::deliveryKey(
            $this->testTenantId,
            $eventId,
            'event.registration.confirmed',
            (int) $attendee->id,
            'in_app',
            1,
        );
        $delivery = $this->outbox->ensureDelivery((int) $row['id'], (int) $attendee->id, 'in_app', $key);
        DB::table('event_notification_deliveries')->where('id', $delivery['id'])->update([
            'status' => 'failed_terminal',
            'dead_lettered_at' => now(),
        ]);

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);
        $diagnostics = (new EventNotificationOutboxDiagnostics())->snapshot($this->testTenantId);

        $this->assertSame(1, $summary['dead_lettered']);
        $this->assertSame('dead_letter', DB::table('event_domain_outbox')->where('id', $row['id'])->value('status'));
        $this->assertSame(1, $diagnostics['terminal_delivery_failures']);
    }

    public function test_explicit_replay_resets_only_failed_terminal_children_and_can_recover(): void
    {
        $organizer = $this->member();
        $attendee = $this->member();
        $unrelatedRecipient = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, (int) $attendee->id, 'confirmed');
        $unrelated = $this->registrationFact($eventId, (int) $unrelatedRecipient->id, 'confirmed');

        $delivery = function (array $fact, int $userId, string $channel) use ($eventId): array {
            return $this->outbox->ensureDelivery(
                (int) $fact['id'],
                $userId,
                $channel,
                EventDomainOutboxService::deliveryKey(
                    $this->testTenantId,
                    $eventId,
                    'event.registration.confirmed',
                    $userId,
                    $channel,
                    1,
                ),
            );
        };
        $failed = $delivery($row, (int) $attendee->id, 'in_app');
        $delivered = $delivery($row, (int) $attendee->id, 'email');
        $suppressed = $delivery($row, (int) $attendee->id, 'push');
        $unrelatedFailed = $delivery($unrelated, (int) $unrelatedRecipient->id, 'in_app');
        $deliveredAt = now()->subMinutes(2);
        $suppressedAt = now()->subMinute();

        DB::table('event_domain_outbox')->whereIn('id', [$row['id'], $unrelated['id']])->update([
            'status' => 'dead_letter',
            'attempts' => 3,
            'dead_lettered_at' => now(),
            'last_error' => 'event_notification_channel_retry_required',
        ]);
        DB::table('event_notification_deliveries')->where('id', $failed['id'])->update([
            'status' => 'failed_terminal',
            'attempts' => 3,
            'next_attempt_at' => now()->addHour(),
            'dead_lettered_at' => now(),
            'last_error' => 'provider_failure',
        ]);
        DB::table('event_notification_deliveries')->where('id', $delivered['id'])->update([
            'status' => 'delivered',
            'attempts' => 1,
            'delivered_at' => $deliveredAt,
            'provider' => 'email',
        ]);
        DB::table('event_notification_deliveries')->where('id', $suppressed['id'])->update([
            'status' => 'suppressed',
            'suppressed_at' => $suppressedAt,
            'suppression_reason' => 'push_disabled',
        ]);
        DB::table('event_notification_deliveries')->where('id', $unrelatedFailed['id'])->update([
            'status' => 'failed_terminal',
            'attempts' => 4,
            'dead_lettered_at' => now(),
            'last_error' => 'unrelated_provider_failure',
        ]);

        $replayed = (new EventNotificationOutboxConsumer())->replayDeadLetter(
            (int) $row['id'],
            'operations@example.test',
            'Provider configuration repaired',
            $this->testTenantId,
        );

        $this->assertTrue($replayed);
        $this->assertDatabaseHas('event_notification_deliveries', [
            'id' => $failed['id'],
            'status' => 'pending',
            'attempts' => 0,
            'claim_token' => null,
            'claimed_at' => null,
            'next_attempt_at' => null,
            'dead_lettered_at' => null,
            'last_error' => null,
        ]);
        $this->assertDatabaseHas('event_notification_deliveries', [
            'id' => $delivered['id'],
            'status' => 'delivered',
            'attempts' => 1,
            'provider' => 'email',
        ]);
        $this->assertSame(
            $deliveredAt->format('Y-m-d H:i:s'),
            (string) DB::table('event_notification_deliveries')->where('id', $delivered['id'])->value('delivered_at'),
        );
        $this->assertDatabaseHas('event_notification_deliveries', [
            'id' => $suppressed['id'],
            'status' => 'suppressed',
            'suppression_reason' => 'push_disabled',
        ]);
        $this->assertSame(
            $suppressedAt->format('Y-m-d H:i:s'),
            (string) DB::table('event_notification_deliveries')->where('id', $suppressed['id'])->value('suppressed_at'),
        );
        $this->assertDatabaseHas('event_notification_deliveries', [
            'id' => $unrelatedFailed['id'],
            'status' => 'failed_terminal',
            'attempts' => 4,
            'last_error' => 'unrelated_provider_failure',
        ]);
        $this->assertSame(1, DB::table('event_notification_outbox_replays')->where('outbox_id', $row['id'])->count());

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $summary['processed']);
        $this->assertDatabaseHas('event_domain_outbox', ['id' => $row['id'], 'status' => 'processed']);
        $this->assertDatabaseHas('event_notification_deliveries', ['id' => $failed['id'], 'status' => 'delivered']);
        $this->assertDatabaseHas('event_notification_deliveries', ['id' => $unrelatedFailed['id'], 'status' => 'failed_terminal']);
    }

    public function test_publication_cutover_reuses_direct_admin_delivery_evidence(): void
    {
        $organizer = $this->member();
        $admin = $this->member(role: 'admin');
        $flaggedAdmin = $this->member();
        DB::table('users')->where('id', $flaggedAdmin->id)->update(['is_tenant_super_admin' => 1]);
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $direct = $this->outbox->record(
            $this->testTenantId,
            $eventId,
            1,
            'event.admin_publication.created',
            "direct-publication:{$eventId}:{$admin->id}",
            ['schema_version' => 1, 'tenant_id' => $this->testTenantId, 'event_id' => $eventId],
            EventNotificationDeliveryMode::Direct,
        );
        $key = EventDomainOutboxService::deliveryKey(
            $this->testTenantId,
            $eventId,
            'event.admin_publication.created',
            (int) $admin->id,
            'in_app',
            1,
        );
        $delivery = $this->outbox->ensureDelivery((int) $direct['id'], (int) $admin->id, 'in_app', $key);
        DB::table('event_notification_deliveries')->where('id', $delivery['id'])->update([
            'status' => 'delivered',
            'delivered_at' => now(),
        ]);
        $authoritative = $this->lifecycleFact($eventId, (int) $organizer->id, 'published');

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $summary['processed']);
        $this->assertSame('processed', DB::table('event_domain_outbox')->where('id', $authoritative['id'])->value('status'));
        $this->assertSame(0, DB::table('notifications')->where('user_id', $admin->id)->where('type', 'event_lifecycle')->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', $flaggedAdmin->id)->where('type', 'event_lifecycle')->count());
        $this->assertSame(1, DB::table('event_notification_deliveries')->where('tenant_id', $this->testTenantId)->where('delivery_key', $key)->count());
    }

    public function test_pending_review_fact_notifies_admins_in_locale_with_moderation_deep_link(): void
    {
        $organizer = $this->member('en');
        $admin = $this->member('de', 'admin');
        $broker = $this->member('en', 'broker');
        $coordinator = $this->member('en', 'coordinator');
        DB::table('users')
            ->whereIn('id', [$broker->id, $coordinator->id])
            ->update([
                'is_admin' => 1,
                'is_super_admin' => 1,
                'is_tenant_super_admin' => 1,
            ]);
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Sprachwerkstatt');
        DB::table('events')->where('id', $eventId)->update([
            'status' => 'draft',
            'publication_status' => 'pending_review',
        ]);
        $row = $this->lifecycleFact($eventId, (int) $organizer->id, 'pending_review');
        App::setLocale('de');
        $expected = __('event_notifications.lifecycle.pending_review', ['title' => 'Sprachwerkstatt']);
        App::setLocale('en');

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $summary['processed']);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'type' => 'event_moderation',
            'message' => $expected,
            'link' => '/admin/events?publication_state=pending_review',
        ]);
        $this->assertSame(1, DB::table('event_notification_deliveries')
            ->where('outbox_id', $row['id'])
            ->where('recipient_user_id', $admin->id)
            ->where('status', 'delivered')
            ->count());
        $this->assertSame(0, DB::table('event_notification_deliveries')
            ->where('outbox_id', $row['id'])
            ->whereIn('recipient_user_id', [$broker->id, $coordinator->id])
            ->count());
        $this->assertSame('en', App::getLocale());
    }

    public function test_private_draft_restore_never_notifies_prior_participants(): void
    {
        $organizer = $this->member();
        $participant = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Private restored draft');
        DB::table('events')->where('id', $eventId)->update([
            'status' => 'draft',
            'publication_status' => 'draft',
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $participant->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $row = $this->lifecycleFact($eventId, (int) $organizer->id, 'restored_private');

        app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, DB::table('event_notification_deliveries')
            ->where('outbox_id', $row['id'])
            ->where('recipient_user_id', $organizer->id)
            ->where('status', 'delivered')
            ->count());
        $this->assertSame(0, DB::table('event_notification_deliveries')
            ->where('outbox_id', $row['id'])
            ->where('recipient_user_id', $participant->id)
            ->count());
    }

    public function test_dead_letter_replay_is_explicit_audited_and_resets_attempts(): void
    {
        $organizer = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $row = $this->registrationFact($eventId, 2_000_000_002, 'confirmed');
        DB::table('event_domain_outbox')->where('id', $row['id'])->update([
            'status' => 'dead_letter',
            'attempts' => 5,
            'dead_lettered_at' => now(),
            'last_error' => 'event_notification_recipient_missing',
        ]);

        $secret = str_repeat('ab', 32);
        $ok = (new EventNotificationOutboxConsumer())->replayDeadLetter(
            (int) $row['id'],
            'operations@example.test',
            "Recipient restored after review ?token={$secret}",
            $this->testTenantId,
        );

        $this->assertTrue($ok);
        $this->assertDatabaseHas('event_domain_outbox', ['id' => $row['id'], 'status' => 'pending', 'attempts' => 0]);
        $this->assertDatabaseHas('event_notification_outbox_replays', [
            'tenant_id' => $this->testTenantId,
            'outbox_id' => $row['id'],
            'requested_by' => 'operations@example.test',
            'previous_attempts' => 5,
        ]);
        $auditReason = (string) DB::table('event_notification_outbox_replays')
            ->where('outbox_id', $row['id'])
            ->value('reason');
        $this->assertStringNotContainsString($secret, $auditReason);
    }

    public function test_error_sanitizer_removes_offer_tokens_before_persistence(): void
    {
        $token = str_repeat('a1', 32);
        $safe = EventNotificationErrorSanitizer::sanitize(
            "provider rejected https://example.test/events/1?waitlist_offer_token={$token}&x=1 Bearer {$token}",
        );

        $this->assertStringNotContainsString($token, $safe);
        $this->assertStringContainsString('[REDACTED]', $safe);
    }

    public function test_diagnostics_command_is_payload_free_and_processor_is_scheduled(): void
    {
        $organizer = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Do not expose this payload title');
        $this->registrationFact($eventId, 2_000_000_003, 'confirmed');

        $this->artisan('events:process-notification-outbox', [
            '--tenant' => $this->testTenantId,
            '--status' => true,
            '--json' => true,
        ])
            ->expectsOutputToContain('"schema_available":true')
            ->doesntExpectOutputToContain('Do not expose this payload title')
            ->assertSuccessful();

        $this->artisan('schedule:list')
            ->expectsOutputToContain('events:process-notification-outbox --limit=50')
            ->assertSuccessful();
    }

    public function test_empty_and_unknown_channel_configuration_fail_closed(): void
    {
        Config::set('events.notification_delivery.max_attempts', 1);
        $organizer = $this->member();
        $firstAttendee = $this->member();
        $secondAttendee = $this->member();
        $eventId = $this->eventOwnedBy((int) $organizer->id);
        $emptyRow = $this->registrationFact($eventId, (int) $firstAttendee->id, 'confirmed');
        Config::set('events.notification_delivery.channels', []);
        $emptyHealth = (new EventNotificationOutboxDiagnostics())->snapshot($this->testTenantId);

        $emptySummary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertFalse($emptyHealth['channel_configuration']['valid']);
        $this->assertSame('empty', $emptyHealth['channel_configuration']['reason']);
        $this->assertSame(0, $emptySummary['processed']);
        $this->assertSame(1, $emptySummary['dead_lettered']);
        $this->assertDatabaseHas('event_domain_outbox', [
            'id' => $emptyRow['id'],
            'status' => 'dead_letter',
            'last_error' => 'event_notification_channel_configuration_invalid',
        ]);

        $unknownRow = $this->registrationFact($eventId, (int) $secondAttendee->id, 'confirmed');
        Config::set('events.notification_delivery.channels', ['email', 'carrier_pigeon']);
        $unknownHealth = (new EventNotificationOutboxDiagnostics())->snapshot($this->testTenantId);

        $unknownSummary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertFalse($unknownHealth['channel_configuration']['valid']);
        $this->assertSame('invalid_entries', $unknownHealth['channel_configuration']['reason']);
        $this->assertSame(1, $unknownHealth['channel_configuration']['invalid_entry_count']);
        $this->assertSame(0, $unknownSummary['processed']);
        $this->assertSame(1, $unknownSummary['dead_lettered']);
        $this->assertDatabaseHas('event_domain_outbox', [
            'id' => $unknownRow['id'],
            'status' => 'dead_letter',
            'last_error' => 'event_notification_channel_configuration_invalid',
        ]);
        $this->assertSame(0, DB::table('event_notification_deliveries')
            ->whereIn('outbox_id', [$emptyRow['id'], $unknownRow['id']])
            ->count());
    }

    public function test_cancelled_waitlist_offer_is_suppressed_before_secret_or_email_handoff(): void
    {
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('event_waitlist.envelope.active_key_version', 'processor-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.previous_keys', []);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('events.notification_delivery.channels', ['email', 'in_app']);

        $organizer = $this->member();
        $holder = $this->member();
        $waiter = $this->member();
        foreach ([$organizer, $waiter] as $recipient) {
            DB::table('users')->where('id', $recipient->id)->update([
                'notification_preferences' => json_encode(['email_events' => true, 'push_enabled' => false], JSON_THROW_ON_ERROR),
            ]);
            DB::table('notification_settings')->updateOrInsert(
                ['user_id' => $recipient->id, 'context_type' => 'global', 'context_id' => 0],
                ['frequency' => 'instant', 'created_at' => now(), 'updated_at' => now()],
            );
        }
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Cancelled offer event');
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 1]);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'superseded-holder');
        $waitlist->join($eventId, (int) $waiter->id, $waiter, 'superseded-waiter');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $this->enableTenantTimedWaitlistOffers();
        $offer = $waitlist->offerNext($eventId, $organizer, 'superseded-offer');
        $this->assertNotNull($offer);
        $offeredOutboxId = (int) $offer->outboxId;
        $cancelled = $waitlist->withdraw(
            $eventId,
            (int) $waiter->id,
            $waiter,
            'superseded-cancel',
        );
        $this->assertNotNull($cancelled->outboxId);
        $cancelledOutboxId = (int) $cancelled->outboxId;
        DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->whereNotIn('id', [$offeredOutboxId, $cancelledOutboxId])
            ->update(['status' => 'processed', 'processed_at' => now()]);

        $mailer = new class {
            /** @var list<array{to:string,subject:string,body:string}> */
            public array $messages = [];

            /** @param array<string,mixed> $options */
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->messages[] = compact('to', 'subject', 'body');
                return true;
            }
        };
        app()->instance(\App\Services\EmailDispatchService::class, $mailer);

        $offeredSummary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $offeredSummary['processed']);
        $this->assertSame(4, $offeredSummary['suppressed']);
        $this->assertSame([], $mailer->messages);
        $this->assertDatabaseHas('event_domain_outbox', ['id' => $offeredOutboxId, 'status' => 'processed']);
        $this->assertDatabaseHas('event_domain_outbox', ['id' => $cancelledOutboxId, 'status' => 'pending']);
        $this->assertSame(4, DB::table('event_notification_deliveries')
            ->where('outbox_id', $offeredOutboxId)
            ->where('status', 'suppressed')
            ->where('suppression_reason', 'superseded')
            ->count());
        $this->assertSame(0, DB::table('event_waitlist_offer_envelope_access')
            ->where('outbox_id', $offeredOutboxId)
            ->whereIn('operation', ['claimed', 'claim_resumed', 'handed_off'])
            ->count());
        $this->assertDatabaseHas('event_waitlist_offer_envelopes', [
            'outbox_id' => $offeredOutboxId,
            'status' => 'erased',
            'token_ciphertext' => null,
        ]);

        $cancelledSummary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $cancelledSummary['processed']);
        $this->assertCount(2, $mailer->messages);
        $this->assertDatabaseHas('event_domain_outbox', ['id' => $cancelledOutboxId, 'status' => 'processed']);
        $this->assertSame(4, DB::table('event_notification_deliveries')
            ->where('outbox_id', $cancelledOutboxId)
            ->where('status', 'delivered')
            ->count());
    }

    public function test_waitlist_offer_secret_is_handed_to_email_but_never_persisted_by_processor(): void
    {
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('event_waitlist.envelope.active_key_version', 'processor-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.previous_keys', []);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('events.notification_delivery.channels', ['email', 'in_app']);

        $organizer = $this->member();
        $holder = $this->member();
        $waiter = $this->member();
        foreach ([$organizer, $waiter] as $recipient) {
            DB::table('users')->where('id', $recipient->id)->update([
                'notification_preferences' => json_encode(['email_events' => true, 'push_enabled' => false], JSON_THROW_ON_ERROR),
            ]);
            DB::table('notification_settings')->updateOrInsert(
                ['user_id' => $recipient->id, 'context_type' => 'global', 'context_id' => 0],
                ['frequency' => 'instant', 'created_at' => now(), 'updated_at' => now()],
            );
        }
        $eventId = $this->eventOwnedBy((int) $organizer->id, 'Secure offer event');
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 1]);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'processor-holder');
        $waitlist->join($eventId, (int) $waiter->id, $waiter, 'processor-waiter');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        DB::table('events')->where('tenant_id', $this->testTenantId)->where('id', $eventId)->increment('max_attendees');
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $this->enableTenantTimedWaitlistOffers();
        $offer = $waitlist->offerNext($eventId, $organizer, 'processor-offer');
        $this->assertNotNull($offer);
        $token = (string) $offer->offerToken;
        $offeredOutbox = DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.waitlist.offered')
            ->latest('id')
            ->first();
        $this->assertNotNull($offeredOutbox);
        DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('id', '<>', $offeredOutbox->id)
            ->update(['status' => 'processed', 'processed_at' => now()]);

        $mailer = new class {
            /** @var list<array{to:string,subject:string,body:string}> */
            public array $messages = [];

            /** @param array<string,mixed> $options */
            public function send(string $to, string $subject, string $body, array $options = []): bool
            {
                $this->messages[] = compact('to', 'subject', 'body');
                return true;
            }
        };
        app()->instance(\App\Services\EmailDispatchService::class, $mailer);

        $summary = app(EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);

        $this->assertSame(1, $summary['processed']);
        $this->assertTrue(collect($mailer->messages)->contains(
            static fn (array $message): bool => str_contains($message['body'], rawurlencode($token)),
        ));
        $envelope = DB::table('event_waitlist_offer_envelopes')->where('outbox_id', $offeredOutbox->id)->first();
        $this->assertSame('handed_off', $envelope->status);
        $this->assertNull($envelope->token_ciphertext);

        foreach (['event_domain_outbox', 'event_notification_deliveries', 'notifications', 'notification_queue', 'event_waitlist_offer_envelope_access'] as $table) {
            $persisted = DB::table($table)->where('tenant_id', $this->testTenantId)->get();
            $this->assertStringNotContainsString($token, json_encode($persisted, JSON_THROW_ON_ERROR), $table);
        }
    }

    private function member(string $locale = 'en', string $role = 'member'): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => $role,
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => $locale,
            'notification_preferences' => ['email_events' => false, 'push_enabled' => false],
        ]);
    }

    private function eventOwnedBy(int $organizerId, string $title = 'Enterprise event'): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => $title,
            'description' => 'Notification processor fixture.',
            'start_time' => now()->addDay(),
            'end_time' => now()->addDay()->addHour(),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function registrationFact(int $eventId, int $userId, string $state): array
    {
        $registrationId = (int) DB::table('event_registrations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'allocation_key' => null,
            'registration_state' => $state,
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->outbox->record(
            $this->testTenantId,
            $eventId,
            1,
            "event.registration.{$state}",
            "event:{$eventId}:registration:{$userId}:{$state}:v1",
            [
                'schema_version' => 1,
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'registration_id' => $registrationId,
                'user_id' => $userId,
                'actor_user_id' => $userId,
                'registration_version' => 1,
                'from_state' => null,
                'to_state' => $state,
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
    }

    /** @return array<string,mixed> */
    private function lifecycleFact(int $eventId, int $organizerId, string $state): array
    {
        return $this->outbox->record(
            $this->testTenantId,
            $eventId,
            2,
            'event.lifecycle.transitioned',
            "event:{$eventId}:lifecycle:{$state}:v2",
            [
                'schema_version' => 1,
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'organizer_user_id' => $organizerId,
                'affected_recipient_user_ids' => [],
                'lifecycle_version' => 2,
                'publication' => [
                    'from' => match ($state) {
                        'rejected' => 'pending_review',
                        'restored_private' => 'archived',
                        default => 'draft',
                    },
                    'to' => match ($state) {
                        'published' => 'published',
                        'pending_review' => 'pending_review',
                        'rejected', 'restored_private' => 'draft',
                        default => 'draft',
                    },
                ],
                'operational' => ['from' => 'scheduled', 'to' => 'scheduled'],
                'publication_became_published' => $state === 'published',
            ],
            EventNotificationDeliveryMode::OutboxAuthoritative,
        );
    }

    private function enableTenantTimedWaitlistOffers(): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $events = is_array($configuration['events'] ?? null) ? $configuration['events'] : [];
        $events['timed_waitlist_offers_enabled'] = true;
        $configuration['events'] = $events;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration, JSON_THROW_ON_ERROR),
        ]);
    }
}
