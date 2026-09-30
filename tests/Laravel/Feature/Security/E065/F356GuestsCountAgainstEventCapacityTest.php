<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventRegistrationException;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\User;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * E-065 F-356 — guests must be counted against the room by BOTH capacity
 * gates, and a guest must give their seat back when the registration that
 * brought them leaves.
 *
 * Before the fix, EventRegistrationGuestService::capture() counted guests
 * against events.max_attendees (added 2026-08-02 in 62cbc2364) but
 * EventRegistrationService::occupiedUserIdsLocked() — behind the
 * availableSlotsLocked() helper every member-facing registration and every
 * waitlist decision goes through — never read event_registration_guests. A
 * capacity-2 event therefore held 3 bodies, and generalised roughly double.
 *
 * Part (b): nothing withdrew a guest when their registration was cancelled, so
 * a cancelled member's guest held a seat indefinitely and a member who really
 * was coming was refused one.
 *
 * The platform's own comment calls max_attendees "often a fire limit", which is
 * why this is a safety control and not a convenience.
 */
final class F356GuestsCountAgainstEventCapacityTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        // Never against the development database: only a nexus_test* database.
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
    }

    /** Settings published with approval_mode=auto so a member self-confirm lands on `confirmed`. */
    private function autoApprovalSettings(
        int $eventId,
        User $owner,
        CarbonImmutable $start,
        bool $guestsEnabled,
        int $maxGuests,
    ): void {
        $service = new EventRegistrationSettingsService();
        $settings = $service->save(
            $eventId,
            $owner,
            [
                'approval_mode' => 'auto',
                'opens_at' => $start->subDays(60)->format('Y-m-d\TH:i:sP'),
                'closes_at' => $start->format('Y-m-d\TH:i:sP'),
                'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
                'per_member_limit' => 1,
                'guests_enabled' => $guestsEnabled,
                'max_guests_per_registration' => $maxGuests,
                'guest_retention_days' => 30,
            ],
            null,
            'f356-settings-create-' . bin2hex(random_bytes(8)),
        );
        $service->publish(
            $eventId,
            $owner,
            (int) $settings['settings']->revision,
            'f356-settings-publish-' . bin2hex(random_bytes(8)),
        );
    }

    private function confirmSelf(int $eventId, User $member): void
    {
        $result = (new EventRegistrationService())->confirm(
            $eventId,
            (int) $member->getKey(),
            $member,
            'f356-confirm-' . $eventId . '-' . $member->getKey(),
        );
        self::assertSame(
            EventCapacityRegistrationState::Confirmed,
            $result->registration->registration_state,
            'Fixture precondition: the self-confirm must land on confirmed.',
        );
    }

    private function captureGuest(int $eventId, int $registrationId, User $member, string $name): void
    {
        $version = (int) DB::table('event_registrations')
            ->where('id', $registrationId)
            ->value('registration_version');

        (new EventRegistrationGuestService())->capture(
            $eventId,
            $registrationId,
            $member,
            $version,
            $name,
            null,
            null,
            true,
            'Guest consent text for the F-356 fixture.',
            'v1',
        );
    }

    /** @return array{0:int,1:int} confirmed registrations, captured guests */
    private function bodies(int $eventId): array
    {
        $registrations = (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('registration_state', 'confirmed')
            ->count();
        $guests = (int) DB::table('event_registration_guests')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('status', 'captured')
            ->count();

        return [$registrations, $guests];
    }

    /**
     * (a) A seated guest occupies a place as far as the registration gate is
     * concerned, so the event cannot go over its stated capacity.
     */
    public function test_a_second_member_is_refused_because_a_seated_guest_occupies_the_last_place(): void
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start, true, 10);

        // Seat 1 of 2: member A.
        $this->confirmSelf($eventId, $memberA);
        $registrationA = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $memberA->id)
            ->value('id');

        // Seat 2 of 2: member A's guest.
        $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');

        [$registrationsBefore, $guestsBefore] = $this->bodies($eventId);
        self::assertSame(1, $registrationsBefore);
        self::assertSame(1, $guestsBefore);

        // The guest gate agrees the room is full …
        try {
            $this->captureGuest($eventId, $registrationA, $memberA, 'Guest Two');
            self::fail('Fixture precondition: the guest gate should report the room full.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_guest_capacity_full', $exception->getMessage());
        }

        // … and so must the registration gate.
        $overCapacity = false;
        try {
            $this->confirmSelf($eventId, $memberB);
            $overCapacity = true;
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_capacity_full', $exception->reasonCode);
        }

        [$registrationsAfter, $guestsAfter] = $this->bodies($eventId);

        self::assertFalse($overCapacity, sprintf(
            'BAD OUTCOME: event #%d has max_attendees=2 but now holds %d confirmed registrations + '
            . '%d captured guests = %d bodies. The guest gate refused a second guest at the same '
            . 'moment, so the two gates disagree about whether the room is full.',
            $eventId,
            $registrationsAfter,
            $guestsAfter,
            $registrationsAfter + $guestsAfter,
        ));
        self::assertSame(2, $registrationsAfter + $guestsAfter, 'The room holds exactly its stated capacity.');
    }

    /**
     * (b) Cancelling a registration gives its guests' seats back, so a member
     * who IS coming is not refused one by a guest of somebody who is not.
     */
    public function test_a_cancelled_registrations_guest_gives_its_seat_back(): void
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start, true, 10);

        $this->confirmSelf($eventId, $memberA);
        $registrationA = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $memberA->id)
            ->value('id');
        $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');

        // Member A cancels their own place. Both A and A's guest should be gone.
        (new EventRegistrationService())->withdraw(
            $eventId,
            (int) $memberA->getKey(),
            $memberA,
            'f356-withdraw-' . $eventId . '-' . $memberA->getKey(),
        );

        self::assertSame(
            'cancelled',
            (string) DB::table('event_registrations')->where('id', $registrationA)->value('registration_state'),
            'Fixture precondition: member A has cancelled.',
        );

        $orphanGuests = (int) DB::table('event_registration_guests')
            ->where('event_id', $eventId)
            ->where('registration_id', $registrationA)
            ->where('status', 'captured')
            ->count();
        self::assertSame(0, $orphanGuests, 'A cancelled registration must not leave a seated guest.');
        self::assertSame(
            'withdrawn',
            (string) DB::table('event_registration_guests')
                ->where('event_id', $eventId)
                ->where('registration_id', $registrationA)
                ->value('status'),
            "The cancelled member's guest is withdrawn, not deleted — the consent record stays.",
        );

        $this->confirmSelf($eventId, $memberB);
        $registrationB = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $memberB->id)
            ->value('id');

        $memberBRefused = null;
        try {
            $this->captureGuest($eventId, $registrationB, $memberB, 'Guest Two');
        } catch (EventRegistrationFoundationException $exception) {
            $memberBRefused = $exception->getMessage();
        }

        self::assertNull($memberBRefused, sprintf(
            'BAD OUTCOME: member A cancelled registration #%d, yet their guest still occupies one of '
            . "event #%d's two seats — member B, who IS coming, is refused a guest with %s while only "
            . 'one real attendee is registered.',
            $registrationA,
            $eventId,
            (string) $memberBRefused,
        ));
    }

    /**
     * CONTROL 1 — the registration capacity gate itself still works. With no
     * guests in play a third member is correctly refused, and the first two
     * are not.
     */
    public function test_control_third_member_is_refused_when_no_guests_are_involved(): void
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();
        $memberC = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start, false, 0);

        $this->confirmSelf($eventId, $memberA);
        $this->confirmSelf($eventId, $memberB);

        try {
            $this->confirmSelf($eventId, $memberC);
            self::fail('The registration capacity gate should have refused the third member.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_capacity_full', $exception->reasonCode);
        }

        [$registrations, $guests] = $this->bodies($eventId);
        self::assertSame(2, $registrations, 'Exactly the two seats may be taken.');
        self::assertSame(0, $guests);
    }

    /**
     * CONTROL 2 — the guest gate itself still works, and a member may still
     * bring a guest when there is genuinely room for one.
     */
    public function test_control_a_guest_still_fits_when_the_room_has_a_spare_seat(): void
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start, true, 10);

        // One member and one guest fills a capacity-2 room exactly.
        $this->confirmSelf($eventId, $memberA);
        $registrationA = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $memberA->id)
            ->value('id');
        $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');

        [$registrations, $guests] = $this->bodies($eventId);
        self::assertSame(1, $registrations, 'The legitimate registration was accepted.');
        self::assertSame(1, $guests, 'The legitimate guest was seated.');

        // And with two members already confirmed the guest gate refuses outright.
        [$fullEventId, $fullStart] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $fullEventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($fullEventId, $owner, $fullStart, true, 10);
        $this->confirmSelf($fullEventId, $memberA);
        $this->confirmSelf($fullEventId, $memberB);
        $fullRegistrationA = (int) DB::table('event_registrations')
            ->where('event_id', $fullEventId)
            ->where('user_id', (int) $memberA->id)
            ->value('id');

        try {
            $this->captureGuest($fullEventId, $fullRegistrationA, $memberA, 'Guest One');
            self::fail('The guest gate should have refused a guest on a full event.');
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame('event_registration_guest_capacity_full', $exception->getMessage());
        }

        [, $fullGuests] = $this->bodies($fullEventId);
        self::assertSame(0, $fullGuests, 'No guest may be seated on a full event.');
    }
}
