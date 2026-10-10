<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventRegistrationException;
use App\Models\User;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * F-586 — a guest captured while the member's place is still `pending` or
 * `invited` was not counted when that place later became `confirmed`.
 *
 * The guest gate lets a member add a guest to an invited/pending place. The
 * registration gate (availableSlotsLocked) only counts guests of CONFIRMED
 * places, and moving a place into `confirmed` only asked for one free seat —
 * for the member — so the guest arrived in the room uncounted.
 *
 * Reproduced live: capacity 2, manual approval, max 1 guest. A requests and
 * adds a guest, B requests, the organiser approves B and then A: 3 people in a
 * room of 2.
 */
final class F586GuestsOfUnconfirmedPlaceCountOnApprovalTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        Config::set('events.registration.default_capacity_pool_key', 'event');
        Config::set('events.registration.timed_waitlist_offers_enabled', false);
    }

    public function test_organiser_cannot_approve_a_pending_place_whose_guest_would_overfill_the_room(): void
    {
        [$eventId, $owner, $memberA, $memberB] = $this->manualApprovalEvent(2);

        $registrationA = $this->requestPlace($eventId, $memberA);
        $this->captureGuest($eventId, $registrationA, $memberA, 'Ann Guest');
        $this->requestPlace($eventId, $memberB);

        $this->approve($eventId, $memberB, $owner, 'f586-approve-b');

        $overfilled = false;
        try {
            $this->approve($eventId, $memberA, $owner, 'f586-approve-a');
            $overfilled = true;
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_capacity_full', $exception->reasonCode);
        }

        self::assertFalse($overfilled, sprintf(
            'BAD OUTCOME: event #%d holds %d people in a room of 2 — member A was approved '
            . 'although their guest had no seat.',
            $eventId,
            $this->bodies($eventId),
        ));
        self::assertSame('pending', $this->state($eventId, $memberA), 'A stays pending for the organiser.');
        self::assertSame(1, $this->bodies($eventId), 'Only member B holds a seat.');
    }

    public function test_control_the_same_approval_succeeds_when_the_room_has_a_seat_for_the_guest(): void
    {
        [$eventId, $owner, $memberA, $memberB] = $this->manualApprovalEvent(3);

        $registrationA = $this->requestPlace($eventId, $memberA);
        $this->captureGuest($eventId, $registrationA, $memberA, 'Ann Guest');
        $this->requestPlace($eventId, $memberB);
        $this->approve($eventId, $memberB, $owner, 'f586-control-approve-b');
        $this->approve($eventId, $memberA, $owner, 'f586-control-approve-a');

        self::assertSame('confirmed', $this->state($eventId, $memberA));
        self::assertSame(3, $this->bodies($eventId), 'Two members and one guest fill a room of 3 exactly.');
    }

    public function test_invited_member_cannot_confirm_when_their_guest_would_overfill_the_room(): void
    {
        [$eventId, $owner, $memberA, $memberB] = $this->manualApprovalEvent(2, 'auto');

        $invited = (new EventRegistrationService())->transition(
            $eventId,
            (int) $memberA->getKey(),
            EventCapacityRegistrationState::Invited,
            $owner,
            'f586-invite-a',
        );
        $registrationA = (int) $invited->registration->getKey();
        $this->captureGuest($eventId, $registrationA, $memberA, 'Ann Guest');

        $this->requestPlace($eventId, $memberB);
        self::assertSame('confirmed', $this->state($eventId, $memberB), 'Fixture: B took one seat.');

        try {
            (new EventRegistrationService())->confirm(
                $eventId,
                (int) $memberA->getKey(),
                $memberA,
                'f586-invited-confirm-a',
            );
            self::fail('An invited member confirmed with a guest into a room with one seat left.');
        } catch (EventRegistrationException $exception) {
            self::assertSame('event_registration_capacity_full', $exception->reasonCode);
        }
        self::assertSame('invited', $this->state($eventId, $memberA));
        self::assertSame(1, $this->bodies($eventId));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:int,1:User,2:User,3:User} */
    private function manualApprovalEvent(int $capacity, string $approvalMode = 'manual'): array
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();
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
                'guests_enabled' => true,
                'max_guests_per_registration' => 1,
                'guest_retention_days' => 30,
            ],
            null,
            'f586-settings-create-' . bin2hex(random_bytes(8)),
        );
        $service->publish(
            $eventId,
            $owner,
            (int) $settings['settings']->revision,
            'f586-settings-publish-' . bin2hex(random_bytes(8)),
        );

        return [$eventId, $owner, $memberA, $memberB];
    }

    private function requestPlace(int $eventId, User $member): int
    {
        $result = (new EventRegistrationService())->confirm(
            $eventId,
            (int) $member->getKey(),
            $member,
            'f586-request-' . $eventId . '-' . $member->getKey(),
        );

        return (int) $result->registration->getKey();
    }

    private function approve(int $eventId, User $member, User $owner, string $key): void
    {
        (new EventRegistrationService())->transition(
            $eventId,
            (int) $member->getKey(),
            EventCapacityRegistrationState::Confirmed,
            $owner,
            $key,
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
            'Guest consent text for the F-586 fixture.',
            'v1',
        );
    }

    private function state(int $eventId, User $member): ?string
    {
        $state = DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $member->getKey())
            ->value('registration_state');

        return $state === null ? null : (string) $state;
    }

    /** Confirmed members plus the captured guests of confirmed places. */
    private function bodies(int $eventId): int
    {
        $members = (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('registration_state', 'confirmed')
            ->count();
        $guests = (int) DB::table('event_registration_guests as guest')
            ->join('event_registrations as registration', 'registration.id', '=', 'guest.registration_id')
            ->where('guest.tenant_id', $this->testTenantId)
            ->where('guest.event_id', $eventId)
            ->where('guest.status', 'captured')
            ->where('registration.registration_state', 'confirmed')
            ->count();

        return $members + $guests;
    }
}
