<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventWaitlistException;
use App\Models\User;
use App\Services\EventRegistrationService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

final class EventWaitlistServiceTest extends TestCase
{
    use DatabaseTransactions;

    private EventRegistrationService $registrations;
    private EventWaitlistService $waitlist;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.allow_allocation_keys', false);
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        Config::set('events.registration.offer_ttl_minutes', 15);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        $this->registrations = new EventRegistrationService();
        $this->waitlist = new EventWaitlistService($this->registrations);
    }

    public function test_waiting_queue_is_monotonic_idempotent_and_requires_full_finite_capacity(): void
    {
        $organizer = $this->member();
        $holder = $this->member();
        $first = $this->member();
        $second = $this->member();
        $availableEvent = $this->event($organizer, 1);

        $this->assertRejected(
            'event_waitlist_capacity_available',
            fn () => $this->waitlist->join(
                $availableEvent,
                (int) $first->id,
                $first,
                'available-capacity',
            ),
        );
        $unlimitedEvent = $this->event($organizer, null);
        $this->assertRejected(
            'event_waitlist_finite_capacity_required',
            fn () => $this->waitlist->join(
                $unlimitedEvent,
                (int) $first->id,
                $first,
                'unlimited-capacity',
            ),
        );

        $this->registrations->confirm(
            $availableEvent,
            (int) $holder->id,
            $holder,
            'fill-capacity',
        );
        $joined = $this->waitlist->join(
            $availableEvent,
            (int) $first->id,
            $first,
            'join-first',
        );
        $replay = $this->waitlist->join(
            $availableEvent,
            (int) $first->id,
            $first,
            'join-first',
        );
        $secondJoined = $this->waitlist->join(
            $availableEvent,
            (int) $second->id,
            $second,
            'join-second',
        );

        self::assertSame(1, (int) $joined->entry->queue_sequence);
        self::assertSame(2, (int) $secondJoined->entry->queue_sequence);
        self::assertTrue($replay->replayed);
        self::assertSame(2, DB::table('event_waitlist_entries')
            ->where('event_id', $availableEvent)
            ->count());
        self::assertSame(2, DB::table('event_waitlist_entry_history')
            ->where('event_id', $availableEvent)
            ->count());
        self::assertSame('waiting', DB::table('event_waitlist')
            ->where('event_id', $availableEvent)
            ->where('user_id', $first->id)
            ->value('status'));
    }

    public function test_timed_offer_is_disabled_by_default_and_when_enabled_is_oldest_first_and_hash_only(): void
    {
        [$eventId, $holder, $first, $second, $organizer] = $this->fullEventWithTwoWaiters();
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        $this->freeSeat($eventId);

        $this->assertRejected(
            'event_waitlist_timed_offers_disabled',
            fn () => $this->waitlist->offerNext($eventId, $organizer, 'offer-disabled'),
        );
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offered = $this->waitlist->offerNext($eventId, $organizer, 'offer-enabled');

        self::assertNotNull($offered);
        self::assertSame((int) $first->id, (int) $offered->entry->user_id);
        self::assertSame(EventWaitlistQueueState::Offered, $offered->entry->queue_state);
        self::assertNotNull($offered->offerToken);
        self::assertSame(64, strlen((string) $offered->offerToken));
        $storedHash = DB::table('event_waitlist_entries')
            ->where('id', $offered->entry->id)
            ->value('offer_token_hash');
        self::assertSame(hash('sha256', (string) $offered->offerToken), $storedHash);
        self::assertNotSame($offered->offerToken, $storedHash);
        self::assertSame('waiting', DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->value('status'));
        self::assertSame('waiting', DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', $second->id)
            ->value('queue_state'));
    }

    public function test_legacy_waiter_is_canonicalized_without_losing_queue_position(): void
    {
        $organizer = $this->member();
        $holder = $this->member();
        $legacyWaiter = $this->member();
        $newWaiter = $this->member();
        $eventId = $this->event($organizer, 1);
        $this->registrations->confirm($eventId, (int) $holder->id, $holder, 'fill-capacity');
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $legacyWaiter->id,
            'position' => 7,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $canonicalized = $this->waitlist->join(
            $eventId,
            (int) $legacyWaiter->id,
            $legacyWaiter,
            'canonicalize-legacy',
        );
        $joined = $this->waitlist->join(
            $eventId,
            (int) $newWaiter->id,
            $newWaiter,
            'join-after-legacy',
        );

        self::assertSame(7, (int) $canonicalized->entry->queue_sequence);
        self::assertSame(8, (int) $joined->entry->queue_sequence);
        self::assertSame('canonicalized', DB::table('event_waitlist_entry_history')
            ->where('id', $canonicalized->historyId)
            ->value('action'));
        self::assertSame('waiting', DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $legacyWaiter->id)
            ->value('status'));
    }

    public function test_timed_offers_fail_closed_until_delivery_and_crypto_are_ready(): void
    {
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        Config::set('event_waitlist.envelope.active_key_version', 'readiness-test-v1');
        Config::set('event_waitlist.envelope.active_key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        Config::set('event_waitlist.envelope.fallback_to_app_key', false);

        Config::set('events.notification_delivery.mode', 'direct');
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.mode', 'shadow_outbox');
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', false);
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.notification_delivery.channels', []);
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.channels', ['email']);
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.channels', ['email', 'invalid']);
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.channels', 'in_app');
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('events.notification_delivery.channels', ['in_app']);
        Config::set('event_waitlist.envelope.active_key', 'invalid-key-material');
        self::assertFalse($this->waitlist->timedOffersEnabled());

        Config::set('event_waitlist.envelope.active_key', 'base64:HfQEDtbtr90JIXhsaAhSFWnzIo1f31VZ2e5qLqKKnls=');
        self::assertTrue($this->waitlist->timedOffersEnabled());

        Config::set('events.registration.timed_waitlist_offers_enabled', false);
        self::assertFalse($this->waitlist->timedOffersEnabled());
    }

    public function test_single_use_offer_acceptance_atomically_confirms_registration_and_replays_once(): void
    {
        [$eventId, $holder, $first, , $organizer] = $this->fullEventWithTwoWaiters();
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        $this->freeSeat($eventId);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $this->waitlist->offerNext($eventId, $organizer, 'offer-first');
        self::assertNotNull($offer?->offerToken);
        $offerReplay = $this->waitlist->offerNext($eventId, $organizer, 'offer-first');
        self::assertTrue($offerReplay?->replayed);
        self::assertNull($offerReplay?->offerToken);

        $accepted = $this->waitlist->acceptOffer(
            $eventId,
            (int) $first->id,
            (string) $offer->offerToken,
            $first,
            'accept-first',
        );
        $replay = $this->waitlist->acceptOffer(
            $eventId,
            (int) $first->id,
            (string) $offer->offerToken,
            $first,
            'accept-first',
        );

        self::assertTrue($accepted->changed);
        self::assertNotNull($accepted->registration);
        self::assertSame('confirmed', $accepted->registration->registration_state->value);
        self::assertNotNull($accepted->entry->offer_token_used_at);
        self::assertSame((int) $accepted->registration->id, (int) $accepted->entry->accepted_registration_id);
        self::assertTrue($replay->replayed);
        self::assertFalse($replay->changed);
        $this->assertRejected(
            'event_waitlist_idempotency_conflict',
            fn () => $this->waitlist->offerNext($eventId, $organizer, 'offer-first'),
        );
        self::assertSame('promoted', DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->value('status'));
        self::assertSame('going', DB::table('event_rsvps')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->value('status'));
        self::assertSame(1, DB::table('event_waitlist_entry_history')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->where('action', 'accepted')
            ->count());
        self::assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.waitlist.accepted')
            ->count());
    }

    public function test_withdrawing_an_offer_releases_exactly_one_place_to_the_next_waiter(): void
    {
        [$eventId, $holder, $first, $second, $organizer] = $this->fullEventWithTwoWaiters();
        $third = $this->member();
        $this->waitlist->join($eventId, (int) $third->id, $third, 'join-third');
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        $this->freeSeat($eventId);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $this->waitlist->offerNext($eventId, $organizer, 'offer-first');
        self::assertSame((int) $first->id, (int) $offer?->entry->user_id);

        $withdrawn = $this->waitlist->withdraw(
            $eventId,
            (int) $first->id,
            $first,
            'withdraw-offer',
        );

        self::assertSame((int) $second->id, (int) $withdrawn->nextOfferedEntry?->user_id);
        self::assertNotNull($withdrawn->nextOfferToken);
        self::assertSame(1, DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('queue_state', 'offered')
            ->count());
        self::assertSame('waiting', DB::table('event_waitlist_entries')
            ->where('event_id', $eventId)
            ->where('user_id', $third->id)
            ->value('queue_state'));
    }

    public function test_expiry_is_single_shot_and_advances_one_place(): void
    {
        [$eventId, $holder, $first, $second, $organizer] = $this->fullEventWithTwoWaiters();
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        $this->freeSeat($eventId);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $offer = $this->waitlist->offerNext($eventId, $organizer, 'offer-first');
        DB::table('event_waitlist_entries')->where('id', $offer?->entry->id)->update([
            'offer_expires_at' => now()->subSecond(),
        ]);

        $this->assertRejected(
            'event_waitlist_offer_expired',
            fn () => $this->waitlist->acceptActiveOffer(
                $eventId,
                (int) $first->id,
                $first,
                'expired-tokenless-acceptance',
            ),
        );

        $expired = $this->waitlist->expireDueForEvent($eventId, null, 10, now());
        $repeat = $this->waitlist->expireDueForEvent($eventId, null, 10, now());

        self::assertCount(1, $expired);
        self::assertSame((int) $first->id, (int) $expired[0]->entry->user_id);
        self::assertSame((int) $second->id, (int) $expired[0]->nextOfferedEntry?->user_id);
        self::assertNotNull($expired[0]->nextOfferToken);
        self::assertSame([], $repeat);
        self::assertSame(1, DB::table('event_waitlist_entry_history')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->where('action', 'expired')
            ->count());
        self::assertSame('expired', DB::table('event_waitlist')
            ->where('event_id', $eventId)
            ->where('user_id', $first->id)
            ->value('status'));
    }

    public function test_draft_template_past_and_cancelled_events_cannot_mutate_the_queue(): void
    {
        $organizer = $this->member();
        $waiter = $this->member();
        $cases = [
            [
                ['publication_status' => 'draft', 'status' => 'draft'],
                'event_waitlist_event_unavailable',
            ],
            [
                ['is_recurring_template' => 1, 'occurrence_key' => null],
                'event_waitlist_concrete_occurrence_required',
            ],
            [
                ['start_time' => now()->subHours(2), 'end_time' => now()->subHour()],
                'event_waitlist_event_started',
            ],
            [
                ['operational_status' => 'cancelled', 'status' => 'cancelled'],
                'event_waitlist_event_unavailable',
            ],
        ];
        $eventIds = [];

        foreach ($cases as $index => [$updates, $reason]) {
            $eventId = $this->event($organizer, 1);
            $eventIds[] = $eventId;
            DB::table('events')->where('id', $eventId)->update($updates);
            $this->assertRejected(
                $reason,
                fn () => $this->waitlist->join(
                    $eventId,
                    (int) $waiter->id,
                    $waiter,
                    "ineligible-waitlist-{$index}",
                ),
            );
        }

        self::assertSame(0, DB::table('event_waitlist_entries')->whereIn('event_id', $eventIds)->count());
        self::assertSame(0, DB::table('event_waitlist_entry_history')->whereIn('event_id', $eventIds)->count());
    }

    public function test_service_authorization_blocks_cross_member_queue_mutations_and_offer_control(): void
    {
        $organizer = $this->member();
        $holder = $this->member();
        $subject = $this->member();
        $outsider = $this->member();
        $eventId = $this->event($organizer, 1);
        $this->registrations->confirm(
            $eventId,
            (int) $holder->id,
            $holder,
            'authorization-fill-capacity',
        );

        $this->assertRejected(
            'event_registration_authorization_denied',
            fn () => $this->waitlist->join(
                $eventId,
                (int) $subject->id,
                $outsider,
                'outsider-cannot-join-subject',
            ),
        );
        $this->waitlist->join(
            $eventId,
            (int) $subject->id,
            $subject,
            'subject-joins-self',
        );
        $this->assertRejected(
            'event_registration_authorization_denied',
            fn () => $this->waitlist->withdraw(
                $eventId,
                (int) $subject->id,
                $outsider,
                'outsider-cannot-remove-subject',
            ),
        );
        $this->assertRejected(
            'event_registration_reason_required',
            fn () => $this->waitlist->withdraw(
                $eventId,
                (int) $subject->id,
                $organizer,
                'manager-remove-missing-reason',
            ),
        );
        $this->waitlist->withdraw(
            $eventId,
            (int) $subject->id,
            $organizer,
            'manager-removes-with-reason',
            null,
            'Queue eligibility changed',
        );
        $this->waitlist->join(
            $eventId,
            (int) $subject->id,
            $subject,
            'subject-rejoins-self',
        );
        // E-102: free the seat without a release; a release with timed offers off now moves the head of the queue up itself.
        $this->freeSeat($eventId);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        $this->assertRejected(
            'event_registration_authorization_denied',
            fn () => $this->waitlist->offerNext(
                $eventId,
                $outsider,
                'outsider-cannot-create-offer',
            ),
        );
        $offer = $this->waitlist->offerNext(
            $eventId,
            $organizer,
            'manager-creates-offer',
        );
        self::assertNotNull($offer?->offerToken);
        $this->assertRejected(
            'event_waitlist_offer_self_acceptance_required',
            fn () => $this->waitlist->acceptOffer(
                $eventId,
                (int) $subject->id,
                (string) $offer->offerToken,
                $organizer,
                'manager-cannot-accept-member-offer',
            ),
        );
        self::assertTrue($this->waitlist->acceptActiveOffer(
            $eventId,
            (int) $subject->id,
            $subject,
            'subject-accepts-active-offer',
        )->changed);
    }

    /** @return array{int,User,User,User,User} */
    private function fullEventWithTwoWaiters(): array
    {
        $organizer = $this->member();
        $holder = $this->member();
        $first = $this->member();
        $second = $this->member();
        $eventId = $this->event($organizer, 1);
        $this->registrations->confirm($eventId, (int) $holder->id, $holder, 'fill-capacity');
        $this->waitlist->join($eventId, (int) $first->id, $first, 'join-first');
        $this->waitlist->join($eventId, (int) $second->id, $second, 'join-second');

        return [$eventId, $holder, $first, $second, $organizer];
    }

    private function freeSeat(int $eventId): void
    {
        DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('id', $eventId)
            ->increment('max_attendees');
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(User $organizer, ?int $capacity): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Canonical waitlist fixture',
            'description' => 'Canonical waitlist fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'waitlist:' . bin2hex(random_bytes(10)),
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

    private function assertRejected(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected waitlist rejection {$reason}.");
        } catch (EventWaitlistException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }
}
