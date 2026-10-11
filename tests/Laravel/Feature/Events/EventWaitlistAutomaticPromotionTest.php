<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Models\User;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use App\Services\EventWaitlistService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-102 — nobody was moved up from a waitlist unless timed waitlist offers
 * were available (off by default, and they also need outbox delivery and
 * offer encryption).
 *
 * When a confirmed place was released and timed offers were unavailable,
 * nothing happened: the seat sat free, the next person to press Register took
 * it, and the people waiting were never told.
 *
 * Behaviour after the fix: when timed offers are unavailable, a released seat
 * moves the person at the head of the queue into the place in the same
 * transaction, through the normal confirm rules — capacity including their
 * guests, manual approval (the place becomes `pending`), the registration
 * window and participation eligibility. A head who fails a check is skipped,
 * not allowed to block the queue. With timed offers available, the old
 * behaviour (a timed offer to the head) is unchanged.
 */
final class EventWaitlistAutomaticPromotionTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.allow_allocation_keys', false);
        Config::set('events.registration.legacy_dual_read', true);
        Config::set('events.registration.legacy_dual_write', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
    }

    public function test_a_released_seat_moves_the_head_of_the_queue_into_the_place(): void
    {
        [$eventId, , $holder, $first, $second] = $this->fullEventWithQueue('auto');
        self::assertFalse((new EventWaitlistService())->timedOffersEnabled(), 'Fixture: timed offers are off.');

        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'promote-holder-leaves');

        self::assertSame(
            'confirmed',
            $this->state($eventId, $first),
            'BAD OUTCOME: a seat was released but the first person on the waitlist was not moved into it.',
        );
        $entry = $this->entry($eventId, $first);
        self::assertSame('accepted', (string) $entry->queue_state);
        self::assertSame($this->registrationId($eventId, $first), (int) $entry->accepted_registration_id);
        self::assertNotNull($entry->accepted_at);
        self::assertSame('waiting', (string) $this->entry($eventId, $second)->queue_state, 'Only one seat was freed.');
        self::assertNull($this->state($eventId, $second));

        // The member is told through the existing registration fact.
        self::assertTrue($this->outboxFact($eventId, 'event.registration.confirmed', $first));
        self::assertTrue($this->outboxFact($eventId, 'event.waitlist.promoted', $first));
    }

    public function test_under_manual_approval_the_head_of_the_queue_becomes_a_pending_request(): void
    {
        [$eventId, , $holder, $first, $second] = $this->fullEventWithQueue('manual');

        (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'promote-manual-leaves');

        self::assertSame(
            'pending',
            $this->state($eventId, $first),
            'Under manual approval a promoted member must wait for the organiser, not be confirmed.',
        );
        self::assertSame('accepted', (string) $this->entry($eventId, $first)->queue_state);
        self::assertSame('waiting', (string) $this->entry($eventId, $second)->queue_state, 'One release moves one person.');
        self::assertSame(0, $this->confirmed($eventId), 'Nobody holds a confirmed place until the organiser approves.');
        self::assertTrue($this->outboxFact($eventId, 'event.registration.pending', $first));
    }

    public function test_a_head_whose_guest_would_overfill_the_room_is_skipped_for_the_next_person(): void
    {
        $owner = $this->eventUser();
        $holderOne = $this->eventUser();
        $holderTwo = $this->eventUser();
        $first = $this->eventUser();
        $second = $this->eventUser();
        $eventId = $this->publishedEvent($owner, 2, 'auto', true);
        $registrations = new EventRegistrationService();

        // The head of the queue holds an invitation with one captured guest,
        // so moving them up needs two seats.
        $invited = $registrations->transition(
            $eventId,
            (int) $first->id,
            EventCapacityRegistrationState::Invited,
            $owner,
            'guests-invite-first',
        );
        $this->captureGuest($eventId, (int) $invited->registration->getKey(), $first);
        $registrations->confirm($eventId, (int) $holderOne->id, $holderOne, 'guests-holder-one');
        $registrations->confirm($eventId, (int) $holderTwo->id, $holderTwo, 'guests-holder-two');
        $waitlist = new EventWaitlistService();
        $waitlist->join($eventId, (int) $first->id, $first, 'guests-join-first');
        $waitlist->join($eventId, (int) $second->id, $second, 'guests-join-second');

        $registrations->withdraw($eventId, (int) $holderOne->id, $holderOne, 'guests-holder-one-leaves');

        self::assertSame('invited', $this->state($eventId, $first), 'The head could not fit with their guest.');
        self::assertSame('waiting', (string) $this->entry($eventId, $first)->queue_state, 'The skipped head keeps their place in the queue.');
        self::assertSame(
            'confirmed',
            $this->state($eventId, $second),
            'BAD OUTCOME: a head of queue who could not fit blocked the next person from the free seat.',
        );
        self::assertSame('accepted', (string) $this->entry($eventId, $second)->queue_state);
        self::assertSame(2, $this->confirmed($eventId));
    }

    public function test_an_organiser_release_after_the_registration_window_closed_moves_nobody(): void
    {
        [$eventId, $owner, $holder, $first] = $this->fullEventWithQueue('auto');
        DB::table('event_registration_settings')->where('event_id', $eventId)->update([
            'opens_at_utc' => now()->subDays(5),
            'closes_at_utc' => now()->subMinute(),
        ]);

        $released = (new EventRegistrationService())->transition(
            $eventId,
            (int) $holder->id,
            EventCapacityRegistrationState::Cancelled,
            $owner,
            'promote-window-organiser-cancels',
            null,
            null,
            'Organiser cancelled the place.',
        );

        self::assertTrue($released->releasedCapacity, 'The release itself still succeeds.');
        self::assertNull($this->state($eventId, $first));
        self::assertSame('waiting', (string) $this->entry($eventId, $first)->queue_state);
    }

    public function test_control_with_timed_offers_available_the_head_is_offered_not_moved(): void
    {
        Config::set('events.notification_delivery.mode', 'outbox_authoritative');
        Config::set('events.notification_delivery.consumer_enabled', true);
        Config::set('events.registration.timed_waitlist_offers_enabled', true);
        Config::set('events.registration.offer_ttl_minutes', 15);
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
        self::assertTrue((new EventWaitlistService())->timedOffersEnabled(), 'Fixture: timed offers are on.');
        [$eventId, , $holder, $first, $second] = $this->fullEventWithQueue('auto');

        $released = (new EventRegistrationService())->withdraw($eventId, (int) $holder->id, $holder, 'timed-holder-leaves');

        self::assertSame((int) $first->id, (int) $released->offeredEntry?->user_id);
        self::assertNotNull($released->offerToken);
        self::assertSame('offered', (string) $this->entry($eventId, $first)->queue_state);
        self::assertNull($this->state($eventId, $first), 'An offer must be accepted; nobody is moved automatically.');
        self::assertSame('waiting', (string) $this->entry($eventId, $second)->queue_state);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * Capacity 1: the holder is confirmed and two members wait in order.
     *
     * @return array{0:int,1:User,2:User,3:User,4:User}
     */
    private function fullEventWithQueue(string $approvalMode): array
    {
        $owner = $this->eventUser();
        $holder = $this->eventUser();
        $first = $this->eventUser();
        $second = $this->eventUser();
        $eventId = $this->publishedEvent($owner, 1, $approvalMode, false);
        $registrations = new EventRegistrationService();
        $registrations->confirm($eventId, (int) $holder->id, $holder, 'queue-holder-request');
        if ($approvalMode === 'manual') {
            $registrations->transition(
                $eventId,
                (int) $holder->id,
                EventCapacityRegistrationState::Confirmed,
                $owner,
                'queue-holder-approve',
            );
        }
        self::assertSame('confirmed', $this->state($eventId, $holder));

        $waitlist = new EventWaitlistService();
        $waitlist->join($eventId, (int) $first->id, $first, 'queue-join-first');
        $waitlist->join($eventId, (int) $second->id, $second, 'queue-join-second');

        return [$eventId, $owner, $holder, $first, $second];
    }

    private function publishedEvent(User $owner, int $capacity, string $approvalMode, bool $guests): int
    {
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => $capacity]);
        $service = new EventRegistrationSettingsService();
        $settings = $service->save(
            $eventId,
            $owner,
            [
                'approval_mode' => $approvalMode,
                'opens_at' => $start->subDays(60)->format('Y-m-d\TH:i:sP'),
                'closes_at' => $start->format('Y-m-d\TH:i:sP'),
                'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
                'per_member_limit' => 1,
                'guests_enabled' => $guests,
                'max_guests_per_registration' => $guests ? 1 : 0,
                'guest_retention_days' => 30,
            ],
            null,
            'promote-settings-create-' . bin2hex(random_bytes(8)),
        );
        $service->publish(
            $eventId,
            $owner,
            (int) $settings['settings']->revision,
            'promote-settings-publish-' . bin2hex(random_bytes(8)),
        );

        return $eventId;
    }

    private function captureGuest(int $eventId, int $registrationId, User $member): void
    {
        $version = (int) DB::table('event_registrations')
            ->where('id', $registrationId)
            ->value('registration_version');

        (new EventRegistrationGuestService())->capture(
            $eventId,
            $registrationId,
            $member,
            $version,
            'Ann Guest',
            null,
            null,
            true,
            'Guest consent text for the promotion fixture.',
            'v1',
        );
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }

    private function registrationId(int $eventId, User $member): int
    {
        return (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->value('id');
    }

    private function entry(int $eventId, User $member): object
    {
        $entry = DB::table('event_waitlist_entries')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->id)
            ->first();
        self::assertNotNull($entry);

        return $entry;
    }

    private function confirmed(int $eventId): int
    {
        return (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('registration_state', 'confirmed')
            ->count();
    }

    private function outboxFact(int $eventId, string $action, User $member): bool
    {
        return DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', $action)
            ->get(['payload'])
            ->contains(fn (object $row): bool => (int) (json_decode((string) $row->payload, true)['user_id'] ?? 0)
                === (int) $member->id);
    }
}
