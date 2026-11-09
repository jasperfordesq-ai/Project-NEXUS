<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * An event's Attendees tab shows members who else is going.
 *
 * Owner decision, 9 Nov 2026: members may see who else is going to an event.
 * Until then GET /v2/events/{id}/attendees answered an empty list to anyone but
 * the organisers (EventPolicy::viewRoster), so a member saw "Attendees (12)"
 * and, on opening it, "No attendees yet" — while the help guide promised the
 * tab "shows who else is coming".
 *
 * A member now gets the narrow list: people GOING only (never interested,
 * invited or the full roster, whatever `status` they ask for), members of
 * this community only, only people the member directory would show them,
 * first names only, and no check-in or RSVP-time detail. Organisers keep the
 * full operational roster.
 */
class EventAttendeesVisibleToMembersTest extends TestCase
{
    use DatabaseTransactions;

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'onboarding_completed' => 1,
            'privacy_search' => 1,
            'privacy_profile' => 'public',
        ], $overrides));
    }

    private function event(int $organiserId): int
    {
        return DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organiserId,
            'title' => 'Repair cafe',
            'description' => 'Bring something broken.',
            'location' => 'Hall',
            'start_time' => now()->addDays(4)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(4)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function rsvp(int $eventId, int $userId, string $status = 'going', array $extra = []): void
    {
        DB::table('event_rsvps')->insert(array_merge([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ], $extra));
    }

    /** @return array<int, array<string, mixed>> */
    private function attendees(int $eventId, string $query = ''): array
    {
        $response = $this->apiGet("/v2/events/{$eventId}/attendees{$query}", ['X-Events-Contract' => '2']);
        $response->assertOk();

        return $response->json('data');
    }

    /** @return array{0: int, 1: array<string, User>} */
    private function seedEvent(): array
    {
        $organiser = $this->member(['first_name' => 'Orla']);
        $eventId = $this->event((int) $organiser->id);
        $people = [
            'shown' => $this->member(['first_name' => 'Maeve', 'last_name' => 'Byrne']),
            'optedOut' => $this->member(['first_name' => 'Hidden', 'privacy_search' => 0]),
            'connectionsOnly' => $this->member(['first_name' => 'Private', 'privacy_profile' => 'connections']),
            'interested' => $this->member(['first_name' => 'Maybe']),
        ];
        $this->rsvp($eventId, (int) $people['shown']->id, 'going', ['checked_in_at' => now()->format('Y-m-d H:i:s')]);
        $this->rsvp($eventId, (int) $people['optedOut']->id);
        $this->rsvp($eventId, (int) $people['connectionsOnly']->id);
        $this->rsvp($eventId, (int) $people['interested']->id, 'interested');
        $people['organiser'] = $organiser;

        return [$eventId, $people];
    }

    public function test_a_member_sees_who_else_is_going_by_first_name_only(): void
    {
        [$eventId, $people] = $this->seedEvent();
        Sanctum::actingAs($this->member(), ['*']);

        $items = $this->attendees($eventId);

        $this->assertSame([(int) $people['shown']->id], array_map(fn ($i) => (int) $i['member']['id'], $items));
        $this->assertSame('Maeve', $items[0]['member']['display_name']);
        $this->assertStringNotContainsString('Byrne', json_encode($items));
        // No check-in or RSVP-time detail for members.
        $this->assertNull($items[0]['attendance']['checked_in_at']);
    }

    public function test_a_member_cannot_widen_it_to_interested_or_the_full_roster(): void
    {
        [$eventId, $people] = $this->seedEvent();
        Sanctum::actingAs($this->member(), ['*']);

        foreach (['?status=interested', '?status=invited', '?status=all'] as $query) {
            $ids = array_map(fn ($i) => (int) $i['member']['id'], $this->attendees($eventId, $query));
            $this->assertNotContains((int) $people['interested']->id, $ids, $query);
            $this->assertNotContains((int) $people['optedOut']->id, $ids, $query);
        }
    }

    public function test_the_organiser_still_sees_the_full_roster(): void
    {
        [$eventId, $people] = $this->seedEvent();
        Sanctum::actingAs($people['organiser'], ['*']);

        $ids = array_map(fn ($i) => (int) $i['member']['id'], $this->attendees($eventId, '?status=all'));

        $this->assertContains((int) $people['interested']->id, $ids);
        $this->assertContains((int) $people['optedOut']->id, $ids);
    }
}
