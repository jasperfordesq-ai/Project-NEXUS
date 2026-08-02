<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use App\Exceptions\EventLifecycleTransitionException;
use App\Models\Event;
use App\Models\EventStatusHistory;
use App\Models\User;
use App\Services\EventLifecycleService;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use App\Support\Events\EventLifecycleCompatibility;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Laravel\TestCase;

final class EventLifecycleServiceTest extends TestCase
{
    use DatabaseTransactions;

    private EventLifecycleService $service;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.mode', 'direct');
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->service = new EventLifecycleService();
    }

    /** @return iterable<string, array{string, string}> */
    public static function legalPublicationTransitions(): iterable
    {
        yield 'draft to review' => ['draft', 'pending_review'];
        yield 'draft to published' => ['draft', 'published'];
        yield 'draft to archived' => ['draft', 'archived'];
        yield 'review to draft' => ['pending_review', 'draft'];
        yield 'review to published' => ['pending_review', 'published'];
        yield 'review to archived' => ['pending_review', 'archived'];
        yield 'published to archived' => ['published', 'archived'];
        yield 'archived to draft' => ['archived', 'draft'];
    }

    #[DataProvider('legalPublicationTransitions')]
    public function test_every_legal_publication_transition_is_persisted_once(
        string $from,
        string $to,
    ): void {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::from($from),
            EventOperationalState::Scheduled,
        );

        $result = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::from($to),
            null,
            $from === 'published' && $to === 'archived'
                ? 'Published event archived'
                : null,
        );

        self::assertTrue($result->changed);
        $stored = $this->storedEvent((int) $event->id);
        self::assertSame($to, $stored->publication_status);
        self::assertSame('scheduled', $stored->operational_status);
        self::assertSame(1, (int) $stored->lifecycle_version);
        self::assertSame(1, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));
    }

    /** @return iterable<string, array{string, string}> */
    public static function legalOperationalTransitions(): iterable
    {
        yield 'scheduled to postponed' => ['scheduled', 'postponed'];
        yield 'scheduled to cancelled' => ['scheduled', 'cancelled'];
        yield 'scheduled to completed' => ['scheduled', 'completed'];
        yield 'postponed to scheduled' => ['postponed', 'scheduled'];
        yield 'postponed to cancelled' => ['postponed', 'cancelled'];
        yield 'cancelled to scheduled' => ['cancelled', 'scheduled'];
    }

    #[DataProvider('legalOperationalTransitions')]
    public function test_every_legal_operational_transition_is_persisted_once(
        string $from,
        string $to,
    ): void {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::from($from),
        );

        $result = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::from($to),
            $to === 'cancelled' ? 'Event cancelled' : null,
        );

        self::assertTrue($result->changed);
        $stored = $this->storedEvent((int) $event->id);
        self::assertSame('published', $stored->publication_status);
        self::assertSame($to, $stored->operational_status);
        self::assertSame(1, (int) $stored->lifecycle_version);
        self::assertSame(1, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));
    }

    public function test_combined_transition_writes_one_history_and_one_outbox_record(): void
    {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );

        $result = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Archived,
            EventOperationalState::Cancelled,
            'operations.policy',
        );

        self::assertTrue($result->changed);
        self::assertNotNull($result->historyId);
        self::assertNotNull($result->outboxId);
        $stored = $this->storedEvent((int) $event->id);
        self::assertSame('archived', $stored->publication_status);
        self::assertSame('cancelled', $stored->operational_status);
        self::assertSame('cancelled', $stored->status);
        self::assertSame(1, (int) $stored->lifecycle_version);
        self::assertSame((int) $owner->id, (int) $stored->publication_status_changed_by);
        self::assertSame((int) $owner->id, (int) $stored->operational_status_changed_by);
        self::assertSame('operations.policy', $stored->cancellation_reason);

        $history = DB::table('event_status_history')->where('id', $result->historyId)->first();
        self::assertNotNull($history);
        self::assertSame('published', $history->from_publication_status);
        self::assertSame('archived', $history->to_publication_status);
        self::assertSame('scheduled', $history->from_operational_status);
        self::assertSame('cancelled', $history->to_operational_status);
        self::assertSame('active', $history->from_legacy_status);
        self::assertSame('cancelled', $history->to_legacy_status);
        self::assertSame(
            [
                'schema_version' => 1,
                'source' => 'event_lifecycle_service',
                'axes_changed' => ['publication', 'operational'],
                'cascade' => [
                    'reminders_cancelled' => 0,
                    'waitlist_cancelled' => 0,
                    'registrations_cancelled' => 0,
                    'broadcasts_cancelled' => 0,
                    'broadcast_deliveries_cancelled' => 0,
                    'broadcasts_skipped_in_flight' => 0,
                ],
            ],
            json_decode((string) $history->metadata, true, 512, JSON_THROW_ON_ERROR),
        );

        $outbox = DB::table('event_domain_outbox')->where('id', $result->outboxId)->first();
        self::assertNotNull($outbox);
        self::assertSame('event.lifecycle.transitioned', $outbox->action);
        self::assertSame(1, (int) $outbox->aggregate_version);
        $payload = json_decode((string) $outbox->payload, true, 512, JSON_THROW_ON_ERROR);
        self::assertSame((int) $owner->id, $payload['organizer_user_id']);
        self::assertSame([], $payload['affected_recipient_user_ids']);
        self::assertSame('direct', $outbox->status);
        self::assertSame(['from' => 'published', 'to' => 'archived'], $payload['publication']);
        self::assertSame(['from' => 'scheduled', 'to' => 'cancelled'], $payload['operational']);
        self::assertFalse($payload['publication_became_published']);
        self::assertSame('operations.policy', $payload['reason']);
    }

    public function test_replaying_current_target_is_idempotent(): void
    {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        $first = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Postponed,
            'weather',
        );
        $replay = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Postponed,
            'must-not-overwrite',
        );

        self::assertTrue($first->changed);
        self::assertFalse($replay->changed);
        self::assertNull($replay->historyId);
        self::assertNull($replay->outboxId);
        self::assertSame(1, (int) $this->storedEvent((int) $event->id)->lifecycle_version);
        self::assertSame('weather', $this->storedEvent((int) $event->id)->lifecycle_reason);
        self::assertSame(1, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));
    }

    public function test_publication_side_effect_is_marked_only_on_the_first_published_transition(): void
    {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Draft,
            EventOperationalState::Scheduled,
        );

        $first = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Published,
        );
        self::assertTrue($first->publicationBecamePublished);
        self::assertSame('outbox_authoritative', $first->deliveryMode);

        $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Archived,
            null,
            'Published event archived',
        );
        $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Draft,
        );
        $republished = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Published,
        );

        self::assertTrue($republished->changed);
        self::assertFalse($republished->publicationBecamePublished);
        $payload = json_decode(
            (string) DB::table('event_domain_outbox')
                ->where('event_id', $event->id)
                ->where('action', 'event.lifecycle.transitioned')
                ->where('aggregate_version', 4)
                ->value('payload'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertFalse($payload['publication_became_published']);
    }

    public function test_moderation_and_cancellation_metadata_follow_actual_axis_changes(): void
    {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Draft,
            EventOperationalState::Scheduled,
        );

        $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::PendingReview,
        );
        $submitted = $this->storedEvent((int) $event->id);
        self::assertNotNull($submitted->moderation_submitted_at);
        self::assertSame((int) $owner->id, (int) $submitted->moderation_submitted_by);

        $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Published,
            null,
            'moderation.approved',
        );
        $moderated = $this->storedEvent((int) $event->id);
        self::assertNotNull($moderated->moderated_at);
        self::assertSame((int) $owner->id, (int) $moderated->moderated_by);
        self::assertSame('moderation.approved', $moderated->moderation_reason);

        $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'operations.cancelled',
        );
        self::assertNotNull($this->storedEvent((int) $event->id)->cancelled_at);
        $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Scheduled,
            'operations.restored',
        );
        $restored = $this->storedEvent((int) $event->id);
        self::assertNull($restored->cancelled_at);
        self::assertNull($restored->cancelled_by);
        self::assertNull($restored->cancellation_reason);
        self::assertSame(4, (int) $restored->lifecycle_version);
        self::assertSame(4, $this->historyCount((int) $event->id));
        self::assertSame(4, $this->outboxCount((int) $event->id));
    }

    public function test_illegal_and_incompatible_transitions_fail_without_side_effects(): void
    {
        $owner = $this->member();
        $published = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        $this->assertTransitionRejected(
            'event_lifecycle_publication_transition_invalid',
            fn () => $this->service->transition(
                (int) $published->id,
                $owner,
                EventPublicationState::Draft,
            ),
        );

        $completed = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Completed,
        );
        $this->assertTransitionRejected(
            'event_lifecycle_operational_transition_invalid',
            fn () => $this->service->transition(
                (int) $completed->id,
                $owner,
                null,
                EventOperationalState::Scheduled,
            ),
        );

        $draft = $this->event(
            $owner,
            EventPublicationState::Draft,
            EventOperationalState::Scheduled,
        );
        $this->assertTransitionRejected(
            'event_lifecycle_incompatible_axes',
            fn () => $this->service->transition(
                (int) $draft->id,
                $owner,
                null,
                EventOperationalState::Postponed,
            ),
        );

        foreach ([$published, $completed, $draft] as $event) {
            self::assertSame(0, (int) $this->storedEvent((int) $event->id)->lifecycle_version);
            self::assertSame(0, $this->historyCount((int) $event->id));
            self::assertSame(0, $this->outboxCount((int) $event->id));
        }
    }

    public function test_unauthorized_cross_tenant_and_feature_disabled_writes_fail_closed(): void
    {
        $owner = $this->member();
        $outsider = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        $this->assertTransitionRejected(
            'event_lifecycle_authorization_denied',
            fn () => $this->service->transition(
                (int) $event->id,
                $outsider,
                null,
                EventOperationalState::Cancelled,
            ),
        );

        $foreignOwner = $this->member(999);
        $foreignEvent = $this->event(
            $foreignOwner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
            999,
        );
        $this->assertTransitionRejected(
            'event_lifecycle_event_not_found',
            fn () => $this->service->transition(
                (int) $foreignEvent->id,
                $owner,
                null,
                EventOperationalState::Cancelled,
            ),
        );

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => false], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::setById($this->testTenantId);
        $this->assertTransitionRejected(
            'event_lifecycle_authorization_denied',
            fn () => $this->service->transition(
                (int) $event->id,
                $owner,
                null,
                EventOperationalState::Cancelled,
            ),
        );

        self::assertSame(0, (int) $this->storedEvent((int) $event->id)->lifecycle_version);
        self::assertSame(0, $this->historyCount((int) $event->id));
        self::assertSame(0, $this->outboxCount((int) $event->id));
        self::assertSame(0, DB::table('event_status_history')->where('event_id', $foreignEvent->id)->count());
    }

    public function test_outbox_conflict_rolls_back_event_and_history_atomically(): void
    {
        $owner = $this->member();
        $attendee = $this->member();
        $waitlisted = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $attendee->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $attendee->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $key = "event:{$this->testTenantId}:{$event->id}:lifecycle:v1";
        DB::table('event_domain_outbox')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => (int) $event->id,
            'aggregate_version' => 1,
            'action' => 'event.lifecycle.conflict',
            'idempotency_key' => $key,
            'production_mode' => 'direct',
            'status' => 'direct',
            'payload' => json_encode(['fixture' => true], JSON_THROW_ON_ERROR),
            'processed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $this->service->transition(
                (int) $event->id,
                $owner,
                null,
                EventOperationalState::Cancelled,
                'Outbox rollback fixture',
            );
            self::fail('Conflicting outbox identity did not abort the lifecycle transaction.');
        } catch (LogicException $exception) {
            self::assertSame(
                'Event outbox idempotency key was reused for a different mutation.',
                $exception->getMessage(),
            );
        }

        $stored = $this->storedEvent((int) $event->id);
        self::assertSame('scheduled', $stored->operational_status);
        self::assertSame('active', $stored->status);
        self::assertSame(0, (int) $stored->lifecycle_version);
        self::assertSame('going', DB::table('event_rsvps')->where('event_id', $event->id)->value('status'));
        self::assertSame('confirmed', DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->where('user_id', $attendee->id)
            ->value('registration_state'));
        self::assertSame(0, DB::table('event_registration_history')
            ->where('event_id', $event->id)
            ->count());
        self::assertSame('waiting', DB::table('event_waitlist')->where('event_id', $event->id)->value('status'));
        self::assertSame('pending', DB::table('event_reminders')->where('event_id', $event->id)->value('status'));
        self::assertSame(0, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));
    }

    public function test_cancellation_cascade_is_atomic_idempotent_and_preserves_evidence(): void
    {
        $owner = $this->member();
        $going = $this->member();
        $interested = $this->member();
        $attended = $this->member();
        $waitlisted = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        foreach ([
            [$going->id, 'going'],
            [$interested->id, 'interested'],
            [$attended->id, 'attended'],
        ] as [$userId, $status]) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $event->id,
                'user_id' => $userId,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $going->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminder_sent')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $attended->id,
            'reminder_type' => '24h',
            'sent_at' => now()->subDay(),
        ]);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $attended->id,
            'checked_in_at' => now()->subHours(2),
            'hours_credited' => 1.5,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        TenantContext::setById($this->testTenantId);

        $result = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'operations.cancelled',
        );

        self::assertSame([
            'reminders_cancelled' => 1,
            'waitlist_cancelled' => 1,
            'registrations_cancelled' => 2,
            'broadcasts_cancelled' => 0,
            'broadcast_deliveries_cancelled' => 0,
            'broadcasts_skipped_in_flight' => 0,
        ], $result->cascade);
        $recipients = $result->affectedRecipientUserIds;
        sort($recipients);
        $expectedRecipients = [(int) $going->id, (int) $interested->id, (int) $waitlisted->id];
        sort($expectedRecipients);
        self::assertSame($expectedRecipients, $recipients);
        $payload = json_decode(
            (string) DB::table('event_domain_outbox')->where('id', $result->outboxId)->value('payload'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        $payloadRecipients = $payload['affected_recipient_user_ids'];
        sort($payloadRecipients);
        self::assertSame($expectedRecipients, $payloadRecipients);
        self::assertSame((int) $owner->id, $payload['organizer_user_id']);
        self::assertSame('cancelled', DB::table('event_rsvps')->where('event_id', $event->id)->where('user_id', $going->id)->value('status'));
        self::assertSame('cancelled', DB::table('event_rsvps')->where('event_id', $event->id)->where('user_id', $interested->id)->value('status'));
        self::assertSame('attended', DB::table('event_rsvps')->where('event_id', $event->id)->where('user_id', $attended->id)->value('status'));
        self::assertSame('cancelled', DB::table('event_waitlist')->where('event_id', $event->id)->value('status'));
        self::assertSame('cancelled', DB::table('event_reminders')->where('event_id', $event->id)->value('status'));
        self::assertSame(1, DB::table('event_reminder_sent')->where('event_id', $event->id)->count());
        self::assertSame('1.50', (string) DB::table('event_attendance')->where('event_id', $event->id)->value('hours_credited'));
        self::assertSame(1, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));

        $replay = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'must-not-overwrite',
        );
        self::assertFalse($replay->changed);
        self::assertSame([], $replay->affectedRecipientUserIds);
        self::assertSame(1, $this->historyCount((int) $event->id));
        self::assertSame(1, $this->outboxCount((int) $event->id));
    }

    public function test_terminal_lifecycle_cancels_canonical_facts_and_erases_offer_secrets(): void
    {
        Config::set('app.key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('event_waitlist.envelope.active_key_version', 'lifecycle-test-v1');
        Config::set('event_waitlist.envelope.active_key', null);
        Config::set('event_waitlist.envelope.fallback_to_app_key', true);

        $owner = $this->member();
        $confirmed = $this->member();
        $capacityHolder = $this->member();
        $invited = $this->member();
        $pending = $this->member();
        $waiter = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        DB::table('events')->where('id', $event->id)->update(['max_attendees' => 2]);
        $registrations = new EventRegistrationService();
        $waitlist = new EventWaitlistService($registrations);
        $registrations->confirm(
            (int) $event->id,
            (int) $confirmed->id,
            $confirmed,
            'lifecycle-confirmed',
        );
        $registrations->confirm(
            (int) $event->id,
            (int) $capacityHolder->id,
            $capacityHolder,
            'lifecycle-capacity-holder',
        );
        $registrations->transition(
            (int) $event->id,
            (int) $invited->id,
            EventCapacityRegistrationState::Invited,
            $owner,
            'lifecycle-invited',
        );
        $registrations->transition(
            (int) $event->id,
            (int) $pending->id,
            EventCapacityRegistrationState::Pending,
            $owner,
            'lifecycle-pending',
        );
        $waitlist->join(
            (int) $event->id,
            (int) $waiter->id,
            $waiter,
            'lifecycle-waiter',
        );
        $registrations->withdraw(
            (int) $event->id,
            (int) $capacityHolder->id,
            $capacityHolder,
            'lifecycle-release-capacity',
        );
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $waitlist->offerNext(
            (int) $event->id,
            $owner,
            'lifecycle-offer',
        );
        self::assertNotNull($offer?->offerToken);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $event->id,
            'user_id' => $confirmed->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Cancelled,
            'Canonical participant cancellation',
        );

        self::assertSame([
            'reminders_cancelled' => 1,
            'waitlist_cancelled' => 1,
            'registrations_cancelled' => 3,
            'broadcasts_cancelled' => 0,
            'broadcast_deliveries_cancelled' => 0,
            'broadcasts_skipped_in_flight' => 0,
        ], $result->cascade);
        self::assertSame(3, DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->whereIn('user_id', [$confirmed->id, $invited->id, $pending->id])
            ->where('registration_state', 'cancelled')
            ->count());
        self::assertSame('cancelled', DB::table('event_waitlist_entries')
            ->where('id', $offer->entry->id)
            ->value('queue_state'));
        self::assertNull(DB::table('event_waitlist_entries')
            ->where('id', $offer->entry->id)
            ->value('offer_token_hash'));
        self::assertNotNull(DB::table('event_waitlist_entries')
            ->where('id', $offer->entry->id)
            ->value('offer_token_used_at'));
        self::assertSame('erased', DB::table('event_waitlist_offer_envelopes')
            ->where('waitlist_entry_id', $offer->entry->id)
            ->value('status'));
        self::assertNull(DB::table('event_waitlist_offer_envelopes')
            ->where('waitlist_entry_id', $offer->entry->id)
            ->value('token_ciphertext'));
        self::assertSame(3, DB::table('event_registration_history')
            ->where('event_id', $event->id)
            ->whereIn('user_id', [$confirmed->id, $invited->id, $pending->id])
            ->where('action', 'cancelled')
            ->count());
        self::assertSame(1, DB::table('event_waitlist_entry_history')
            ->where('waitlist_entry_id', $offer->entry->id)
            ->where('action', 'cancelled')
            ->count());
        self::assertSame('cancelled', DB::table('event_reminders')
            ->where('event_id', $event->id)
            ->where('user_id', $confirmed->id)
            ->value('status'));

        $replay = $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Cancelled,
        );
        self::assertFalse($replay->changed);
        $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Scheduled,
            'Event restored without enrolment restoration',
        );
        self::assertSame(3, DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->whereIn('user_id', [$confirmed->id, $invited->id, $pending->id])
            ->where('registration_state', 'cancelled')
            ->count());
        self::assertSame('cancelled', DB::table('event_waitlist_entries')
            ->where('id', $offer->entry->id)
            ->value('queue_state'));
    }

    public function test_archiving_published_event_requires_reason_and_cancels_canonical_state(): void
    {
        $owner = $this->member();
        $member = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        (new EventRegistrationService())->confirm(
            (int) $event->id,
            (int) $member->id,
            $member,
            'archive-canonical-registration',
        );

        $this->assertTransitionRejected(
            'event_lifecycle_reason_required',
            fn () => $this->service->transition(
                (int) $event->id,
                $owner,
                EventPublicationState::Archived,
            ),
        );
        $archived = $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Archived,
            null,
            'Published event retired',
        );
        self::assertSame(1, $archived->cascade['registrations_cancelled']);
        self::assertSame('cancelled', DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->where('user_id', $member->id)
            ->value('registration_state'));
        $this->service->transition(
            (int) $event->id,
            $owner,
            EventPublicationState::Draft,
        );
        self::assertSame('cancelled', DB::table('event_registrations')
            ->where('event_id', $event->id)
            ->where('user_id', $member->id)
            ->value('registration_state'));
    }

    public function test_history_model_scope_never_crosses_tenants(): void
    {
        $owner = $this->member();
        $event = $this->event(
            $owner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
        );
        $this->service->transition(
            (int) $event->id,
            $owner,
            null,
            EventOperationalState::Postponed,
        );

        $foreignOwner = $this->member(999);
        $foreignEvent = $this->event(
            $foreignOwner,
            EventPublicationState::Published,
            EventOperationalState::Scheduled,
            999,
        );
        $this->insertForeignHistory((int) $foreignEvent->id, (int) $foreignOwner->id);

        TenantContext::setById($this->testTenantId);
        self::assertSame(1, EventStatusHistory::query()->count());
        self::assertSame(2, EventStatusHistory::withoutGlobalScopes()->count());
    }

    private function member(int $tenantId = 2): User
    {
        $member = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return $member;
    }

    private function event(
        User $owner,
        EventPublicationState $publication,
        EventOperationalState $operational,
        int $tenantId = 2,
    ): Event {
        $status = EventLifecycleCompatibility::legacyMirror($publication, $operational);
        $start = now()->addWeek();
        $id = (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => (int) $owner->id,
            'title' => 'Lifecycle service fixture',
            'description' => 'Lifecycle service fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'status' => $status,
            'publication_status' => $publication->value,
            'operational_status' => $operational->value,
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        /** @var Event $event */
        $event = Event::withoutGlobalScopes()->findOrFail($id);
        TenantContext::setById($this->testTenantId);

        return $event;
    }

    private function storedEvent(int $eventId): object
    {
        $event = DB::table('events')->where('id', $eventId)->first();
        self::assertNotNull($event);

        return $event;
    }

    private function historyCount(int $eventId): int
    {
        return DB::table('event_status_history')->where('event_id', $eventId)->count();
    }

    private function outboxCount(int $eventId): int
    {
        return DB::table('event_domain_outbox')->where('event_id', $eventId)->count();
    }

    /** @param callable(): mixed $transition */
    private function assertTransitionRejected(string $reasonCode, callable $transition): void
    {
        try {
            $transition();
            self::fail("Lifecycle transition {$reasonCode} was not rejected.");
        } catch (EventLifecycleTransitionException $exception) {
            self::assertSame($reasonCode, $exception->reasonCode);
        }
    }

    private function insertForeignHistory(int $eventId, int $actorId): void
    {
        DB::table('event_status_history')->insert([
            'tenant_id' => 999,
            'event_id' => $eventId,
            'actor_user_id' => $actorId,
            'lifecycle_version' => 1,
            'from_publication_status' => 'published',
            'to_publication_status' => 'published',
            'from_operational_status' => 'scheduled',
            'to_operational_status' => 'postponed',
            'from_legacy_status' => 'active',
            'to_legacy_status' => 'cancelled',
            'metadata' => json_encode(['schema_version' => 1], JSON_THROW_ON_ERROR),
            'created_at' => now(),
        ]);
    }
}
