<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Enums\EventCapacityRegistrationState;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Event;
use App\Models\User;
use App\Services\EventPeopleService;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * F-397 (E-067) — after F-356 (0f4f31a5b) the two capacity gates still
 * disagreed. The registration gate counts outstanding waitlist OFFERS (and
 * legacy RSVPs) as occupied; the guest gate in EventRegistrationGuestService
 * did not. So while the last seat was held as an offer to a waitlisted member,
 * a guest could be captured into it — and the member who had been offered the
 * place was then refused it. Separately, the floor an organiser may lower
 * max_attendees to (EventPeopleService::capacityOccupiedCount) ignored guests.
 *
 * Reproduced sequentially (no race needed) before fixing; E-067 had recorded it
 * as suspected.
 */
final class F397GuestGateHonoursWaitlistOffersTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_a_guest_cannot_take_a_seat_already_offered_to_a_waitlisted_member(): void
    {
        [$eventId, $memberA, $registrationA, $memberB] = $this->eventWithOneConfirmedOfTwo();

        // The last seat is offered to member B from the waitlist.
        $this->outstandingOffer($eventId, (int) $memberB->id);

        try {
            $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');
            self::fail('A guest was captured into a seat already offered to a waitlisted member.');
        } catch (EventRegistrationFoundationException $e) {
            self::assertSame('event_registration_guest_capacity_full', $e->getMessage());
        }
        self::assertSame(0, (int) DB::table('event_registration_guests')->where('event_id', $eventId)->count());
    }

    public function test_control_without_an_outstanding_offer_the_guest_takes_the_free_seat(): void
    {
        [$eventId, $memberA, $registrationA] = $this->eventWithOneConfirmedOfTwo();

        $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');

        self::assertSame(1, (int) DB::table('event_registration_guests')->where('event_id', $eventId)->where('status', 'captured')->count());
    }

    public function test_the_capacity_floor_an_organiser_sees_includes_seated_guests(): void
    {
        [$eventId, $memberA, $registrationA] = $this->eventWithOneConfirmedOfTwo();
        $this->captureGuest($eventId, $registrationA, $memberA, 'Guest One');

        $event = Event::query()->findOrFail($eventId);
        self::assertSame(2, app(EventPeopleService::class)->capacityOccupiedCount($event),
            'one member and their guest occupy two places');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:int,1:User,2:int,3:User} [eventId, memberA, registrationA, memberB] */
    private function eventWithOneConfirmedOfTwo(): array
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();

        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start);

        $result = (new EventRegistrationService())->confirm(
            $eventId,
            (int) $memberA->getKey(),
            $memberA,
            'f397-confirm-' . $eventId . '-' . $memberA->getKey(),
        );
        self::assertSame(EventCapacityRegistrationState::Confirmed, $result->registration->registration_state);

        $registrationA = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)->where('user_id', (int) $memberA->id)->value('id');

        return [$eventId, $memberA, $registrationA, $memberB];
    }

    private function autoApprovalSettings(int $eventId, User $owner, CarbonImmutable $start): void
    {
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
                'guests_enabled' => true,
                'max_guests_per_registration' => 10,
                'guest_retention_days' => 30,
            ],
            null,
            'f397-settings-create-' . bin2hex(random_bytes(8)),
        );
        $service->publish($eventId, $owner, (int) $settings['settings']->revision, 'f397-settings-publish-' . bin2hex(random_bytes(8)));
    }

    private function outstandingOffer(int $eventId, int $userId): void
    {
        DB::table('event_waitlist_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'capacity_pool_key' => 'event',
            'queue_state' => 'offered',
            'queue_version' => 1,
            'queue_sequence' => 1,
            'state_changed_at' => now(),
            'offer_expires_at' => now()->addDay(),
            'offer_token_hash' => hash('sha256', 'f397-offer-' . bin2hex(random_bytes(8))),
        ]);
    }

    private function captureGuest(int $eventId, int $registrationId, User $member, string $name): void
    {
        $version = (int) DB::table('event_registrations')->where('id', $registrationId)->value('registration_version');

        (new EventRegistrationGuestService())->capture(
            $eventId,
            $registrationId,
            $member,
            $version,
            $name,
            null,
            null,
            true,
            'Guest consent text for the F-397 fixture.',
            'v1',
        );
    }
}
