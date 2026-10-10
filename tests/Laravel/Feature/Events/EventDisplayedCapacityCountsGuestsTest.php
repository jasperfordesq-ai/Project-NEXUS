<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use App\Services\EventPeopleService;
use App\Services\EventRegistrationGuestService;
use App\Services\EventRegistrationService;
use App\Services\EventRegistrationSettingsService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

/**
 * The capacity a member SEES must be the capacity the registration gate
 * ENFORCES. The gate (EventRegistrationService::availableSlotsLocked) counts
 * seated guests (F-356); the event detail and the registration relationship
 * counted confirmed members and live offers only, so a full event showed a
 * free place and a Register button that then failed with
 * EVENT_CAPACITY_FULL.
 */
final class EventDisplayedCapacityCountsGuestsTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        self::assertStringStartsWith('nexus_test', DB::connection()->getDatabaseName());
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
    }

    public function test_a_seated_guest_fills_the_displayed_capacity_like_it_fills_the_gate(): void
    {
        $owner = $this->eventUser();
        $memberA = $this->eventUser();
        $memberB = $this->eventUser();
        [$eventId, $start] = $this->registrationEvent((int) $owner->id);
        DB::table('events')->where('id', $eventId)->update(['max_attendees' => 2]);
        $this->autoApprovalSettings($eventId, $owner, $start);

        (new EventRegistrationService())->confirm(
            $eventId,
            (int) $memberA->getKey(),
            $memberA,
            'displayed-capacity-confirm-a-' . $eventId,
        );
        $registrationId = (int) DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $memberA->id)
            ->value('id');
        (new EventRegistrationGuestService())->capture(
            $eventId,
            $registrationId,
            $memberA,
            (int) DB::table('event_registrations')->where('id', $registrationId)->value('registration_version'),
            'Guest One',
            null,
            null,
            true,
            'Guest consent text for the displayed-capacity fixture.',
            'v1',
        );

        TenantContext::setById($this->testTenantId);
        $capacity = app(EventPeopleService::class)->capacity(Event::query()->findOrFail($eventId));
        self::assertSame(0, $capacity['remaining'], 'One member plus one guest fills a capacity of 2.');
        self::assertTrue($capacity['is_full']);
        self::assertSame(1, $capacity['confirmed'], 'Confirmed still counts members, not guests.');

        Sanctum::actingAs($memberB, ['*']);
        $detail = $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])->assertOk();
        $detail->assertJsonPath('data.spots_left', 0)
            ->assertJsonPath('data.is_full', true)
            ->assertJsonPath('data.relationship.capacity.remaining', 0)
            ->assertJsonPath('data.relationship.capacity.is_full', true)
            ->assertJsonPath('data.relationship.registration.can_register', false)
            ->assertJsonPath('data.relationship.registration.can_join_waitlist', true);
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
                'max_guests_per_registration' => 5,
                'guest_retention_days' => 30,
            ],
            null,
            'displayed-capacity-settings-' . bin2hex(random_bytes(8)),
        );
        $service->publish(
            $eventId,
            $owner,
            (int) $settings['settings']->revision,
            'displayed-capacity-publish-' . bin2hex(random_bytes(8)),
        );
    }
}
