<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Exceptions\EventRegistrationFoundationException;
use App\Models\User;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationSettingsService;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * A withdrawn guest no longer holds any of the member's guest allowance.
 *
 * When a member cancelled, their guests were withdrawn; when they registered
 * again (the same registration row is reused) they could never add a guest
 * back. Three rules all counted the withdrawn row: the service's limit count
 * and duplicate-name check, and the database insert guard, which also tied
 * the guest's number to the per-registration limit — so with a limit of one,
 * guest number 2 was refused for ever.
 */
final class EventGuestReAddAfterWithdrawalTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_a_guest_withdrawn_when_the_member_left_can_be_added_again_on_return(): void
    {
        [$service, $eventId, $registrationId, $member] = $this->eventWithOneGuestAllowed();

        $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');

        // The member cancels: their guests are withdrawn with the registration.
        DB::transaction(fn () => $service->withdrawForRegistrationExitWithinTransaction(
            $eventId,
            $registrationId,
            (int) $member->id,
            'registration_cancelled',
        ));

        // They come back and bring the same guest.
        $again = $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');
        self::assertSame('captured', (string) $again['guest']->status);
        self::assertSame(2, (int) $again['guest']->guest_number);

        // The limit still holds for the guests actually coming.
        $this->assertReason(
            'event_registration_guest_limit_reached',
            fn () => $this->captureGuest($service, $eventId, $registrationId, $member, 'Bob Guest'),
        );
    }

    public function test_over_http_cancel_re_register_and_add_the_same_guest_returns_201(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => null]);
        // Automatic approval and one guest allowed — the owner's reproduction.
        $settings = new EventRegistrationSettingsService();
        $draft = $settings->save(
            $eventId,
            $owner,
            [
                'approval_mode' => 'auto',
                'opens_at' => $start->subDays(60)->format('Y-m-d\TH:i:sP'),
                'closes_at' => $start->format('Y-m-d\TH:i:sP'),
                'cancellation_cutoff_at' => $start->format('Y-m-d\TH:i:sP'),
                'per_member_limit' => 1,
                'guests_enabled' => true,
                'max_guests_per_registration' => 1,
                'guest_retention_days' => 30,
            ],
            null,
            'readd-settings-' . bin2hex(random_bytes(8)),
        );
        $settings->publish(
            $eventId,
            $owner,
            (int) $draft['settings']->revision,
            'readd-publish-' . bin2hex(random_bytes(8)),
        );
        Sanctum::actingAs($member, ['*']);

        $this->apiPost("/v2/events/{$eventId}/registration/confirm", [], ['Idempotency-Key' => 'readd-confirm-1'])
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'confirmed');
        $this->addGuestOverHttp($eventId, (int) $member->id)->assertStatus(201);

        $this->apiPost(
            "/v2/events/{$eventId}/registration/withdraw",
            ['reason' => 'Plans changed'],
            ['Idempotency-Key' => 'readd-withdraw-1'],
        )->assertOk();
        self::assertSame(
            'withdrawn',
            (string) DB::table('event_registration_guests')->where('event_id', $eventId)->value('status'),
        );

        $this->apiPost("/v2/events/{$eventId}/registration/confirm", [], ['Idempotency-Key' => 'readd-confirm-2'])
            ->assertOk();
        $this->addGuestOverHttp($eventId, (int) $member->id)->assertStatus(201);
    }

    public function test_a_guest_the_member_removed_can_be_added_again(): void
    {
        [$service, $eventId, $registrationId, $member] = $this->eventWithOneGuestAllowed();

        $first = $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');
        $service->cancel(
            $eventId,
            (int) $first['guest']->id,
            $member,
            (int) $first['guest']->revision,
            'not coming',
        );

        $again = $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');
        self::assertSame('captured', (string) $again['guest']->status);

        // The re-added guest uses the one place again.
        $this->assertReason(
            'event_registration_guest_limit_reached',
            fn () => $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest'),
        );
    }

    public function test_the_same_captured_guest_twice_is_still_a_duplicate(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => null]);
        $this->registrationSettings($eventId, $owner, $start, true, 3);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();

        $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');
        $this->assertReason(
            'event_registration_guest_duplicate',
            fn () => $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest'),
        );
    }

    public function test_the_database_still_refuses_a_captured_guest_beyond_the_limit(): void
    {
        [$service, $eventId, $registrationId, $member] = $this->eventWithOneGuestAllowed();
        $first = $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');

        $row = (array) DB::table('event_registration_guests')->where('id', $first['guest']->id)->first();
        unset($row['id']);
        $row['guest_number'] = 2;
        $row['identity_fingerprint'] = hash('sha256', 'another guest');

        try {
            DB::table('event_registration_guests')->insert($row);
            self::fail('The database insert guard did not refuse a second captured guest.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_registration_guest_limit_reached', $exception->getMessage());
        }
    }

    public function test_the_database_refuses_a_guest_number_of_zero(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => null]);
        $this->registrationSettings($eventId, $owner, $start, true, 3);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);
        $service = new EventRegistrationGuestService();
        $first = $this->captureGuest($service, $eventId, $registrationId, $member, 'Ann Guest');

        $row = (array) DB::table('event_registration_guests')->where('id', $first['guest']->id)->first();
        unset($row['id']);
        $row['guest_number'] = 0;
        $row['identity_fingerprint'] = hash('sha256', 'another guest');

        try {
            DB::table('event_registration_guests')->insert($row);
            self::fail('The database accepted guest number 0.');
        } catch (QueryException $exception) {
            self::assertStringContainsString('event_registration_guest_number_invalid', $exception->getMessage());
        }
    }

    /** @return array{0:EventRegistrationGuestService,1:int,2:int,3:User} */
    private function eventWithOneGuestAllowed(): array
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => null]);
        $this->registrationSettings($eventId, $owner, $start, true, 1);
        $registrationId = $this->canonicalRegistration($eventId, (int) $member->id);

        return [new EventRegistrationGuestService(), $eventId, $registrationId, $member];
    }

    /** @return array{guest:\App\Models\EventRegistrationGuest,party_size:int} */
    private function captureGuest(
        EventRegistrationGuestService $service,
        int $eventId,
        int $registrationId,
        User $member,
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
            'Guest consent text for re-add fixture.',
            'v1',
        );
    }

    private function addGuestOverHttp(int $eventId, int $userId): \Illuminate\Testing\TestResponse
    {
        $registration = DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->first(['id', 'registration_version']);
        self::assertNotNull($registration);

        return $this->apiPost(
            "/v2/events/{$eventId}/registration-product/registrations/{$registration->id}/guests",
            [
                'expected_registration_version' => (int) $registration->registration_version,
                'display_name' => 'Ann Guest',
                'consent_accepted' => true,
                'consent_text' => 'Guest consent text for re-add fixture.',
                'consent_text_version' => 'v1',
            ],
        );
    }

    /** @param callable():mixed $operation */
    private function assertReason(string $reason, callable $operation): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventRegistrationFoundationException $exception) {
            self::assertSame($reason, $exception->getMessage());
        }
    }
}
