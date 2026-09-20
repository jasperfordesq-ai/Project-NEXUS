<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Services\EventRegistrationGuestService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationGuestAttendanceConflictTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_stale_version_rejection_is_distinct_from_uncertain_replay_conflicts(): void
    {
        $owner = $this->eventUser();
        $member = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id, CarbonImmutable::now('UTC')->subMinutes(5));
        $this->registrationSettings($eventId, $owner, $start, true, 1, 30);
        $registration = $this->canonicalRegistration($eventId, (int) $member->id);
        $guest = (new EventRegistrationGuestService())->capture($eventId, $registration, $member, 1,
            'Synthetic guest', null, null, true, 'Synthetic privacy notice', 'test-v1');
        $guestId = (int) $guest['guest']->id;
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/guests/{$guestId}/attendance";
        $this->apiPost($url . '/check_in', ['expected_version' => 0, 'idempotency_key' => 'guest-original'])
            ->assertOk()->assertJsonPath('data.attendance.attendance_version', 1);
        $this->apiPost($url . '/check_in', ['expected_version' => 0, 'idempotency_key' => 'guest-original'])
            ->assertOk()->assertJsonPath('data.replayed', true);
        $this->apiPost($url . '/check_out', ['expected_version' => 0, 'idempotency_key' => 'guest-stale'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT')
            ->assertJsonPath('errors.0.field', 'expected_version');
        $collision = $this->apiPost($url . '/check_out', ['expected_version' => 1, 'idempotency_key' => 'guest-original']);
        $collision->assertStatus(409);
        self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        $this->apiPost($url . '/check_out', ['expected_version' => 1, 'idempotency_key' => 'guest-checkout'])
            ->assertOk()->assertJsonPath('data.attendance.attendance_version', 2);
        $this->apiGet("/v2/events/{$eventId}/registration-product/manage")->assertOk()
            ->assertJsonPath('data.guests.0.attendance.can_undo', true);
        $advanced = $this->apiPost($url . '/check_in', ['expected_version' => 0, 'idempotency_key' => 'guest-original']);
        $advanced->assertStatus(409);
        self::assertArrayNotHasKey('field', $advanced->json('errors.0'));
        self::assertSame(2, DB::table('event_registration_guest_attendance_history')->where('guest_id', $guestId)->count());
        $this->apiPost($url . '/undo', ['expected_version' => 2, 'reason' => 'Incorrect checkout', 'idempotency_key' => 'guest-undo'])
            ->assertOk()->assertJsonPath('data.attendance.attendance_version', 3);
        $this->apiGet("/v2/events/{$eventId}/registration-product/manage")->assertOk()
            ->assertJsonPath('data.guests.0.attendance.can_undo', false);
        $this->apiPost($url . '/undo', ['expected_version' => 3, 'reason' => 'Undo twice', 'idempotency_key' => 'guest-undo-again'])
            ->assertStatus(422)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_VALIDATION_FAILED')
            ->assertJsonPath('errors.0.field', 'attendance_action');
        $this->apiPost($url . '/check_in', ['expected_version' => 3, 'idempotency_key' => 'guest-invalid-checkin'])
            ->assertStatus(422)->assertJsonPath('errors.0.field', 'attendance_action');
        $this->apiPost($url . '/undo', ['expected_version' => 2, 'reason' => 'Incorrect checkout', 'idempotency_key' => 'guest-undo'])
            ->assertOk()->assertJsonPath('data.replayed', true);
        self::assertSame(3, DB::table('event_registration_guest_attendance_history')->where('guest_id', $guestId)->count());

    }
}
