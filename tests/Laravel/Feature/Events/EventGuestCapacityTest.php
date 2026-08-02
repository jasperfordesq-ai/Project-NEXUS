<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Services\EventRegistrationGuestService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * Guests occupy venue capacity.
 *
 * max_guests_per_registration caps how many guests ONE member may bring; it
 * says nothing about how many bodies the room holds, and party_size is never
 * written above 1 — so before this gate a 2-capacity event happily accepted
 * 22 people via guests and the capacity check never fired once. For a
 * community venue that number is frequently a fire limit, which is why this
 * is pinned rather than left to the per-registration cap.
 */
final class EventGuestCapacityTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    private function captureGuest(
        EventRegistrationGuestService $service,
        int $eventId,
        int $registrationId,
        $member,
        string $name,
    ): array {
        $version = (int) DB::table('event_registrations')
            ->where('id', $registrationId)
            ->value('registration_version');

        return $service->capture(
            $eventId,
            $registrationId,
            $member,
            $version,
            $name,
            null,
            null,
            true,
            'Guest consent text for capacity fixture.',
            'v1',
        );
    }

    public function test_guests_consume_venue_capacity_and_are_refused_when_the_room_is_full(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        // Two seats: the member takes one, so exactly one guest fits.
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->registrationSettings($eventId, $owner, $start, true, 10);

        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();

        // Seat 2 of 2 — allowed.
        $first = $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest One');
        self::assertNotEmpty($first);

        // The member's per-registration allowance is 10, but the ROOM is full.
        try {
            $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest Two');
            self::fail('Expected the venue capacity gate to refuse the second guest.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_guest_capacity_full', $exception->getMessage());
        }

        self::assertSame(
            1,
            (int) DB::table('event_registration_guests')
                ->where('event_id', $eventId)
                ->where('status', 'captured')
                ->count(),
            'Only the guest that fits may be stored.',
        );
    }

    public function test_an_uncapped_event_still_allows_guests_up_to_the_per_registration_limit(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        // max_attendees NULL — unlimited venue; the per-registration cap alone
        // governs, exactly as before this change.
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => null]);
        $this->registrationSettings($eventId, $owner, $start, true, 2);

        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();

        $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest One');
        $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest Two');

        try {
            $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest Three');
            self::fail('Expected the per-registration guest limit to refuse the third guest.');
        } catch (EventRegistrationFoundationException $exception) {
            // The per-registration cap, NOT the capacity gate — proving the new
            // check did not swallow the existing one.
            self::assertSame('event_registration_guest_limit_reached', $exception->getMessage());
        }
    }

    public function test_a_withdrawn_guest_gives_their_seat_back(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->registrationSettings($eventId, $owner, $start, true, 10);

        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();

        $first = $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest One');

        // Withdraw that guest directly (the status the schema CHECK allows).
        DB::table('event_registration_guests')
            ->where('event_id', $eventId)
            ->where('status', 'captured')
            ->update(['status' => 'withdrawn', 'withdrawn_at' => now()]);

        // The freed seat is reusable — a withdrawn guest must not hold capacity.
        $second = $this->captureGuest($service, $eventId, $registrationId, $member, 'Guest Two');
        self::assertNotEmpty($second);
        self::assertNotEmpty($first);
    }
}
