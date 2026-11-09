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
 * Event cards show a few of the members who are going (owner decision, 9 Nov
 * 2026: "Yes, show faces" — members may see who else is going to an event).
 *
 * The full attendee roster stays an organiser tool (EventPolicy::viewRoster).
 * The preview on the event list is deliberately narrow:
 *   - signed-in viewers only — never guests or crawlers;
 *   - members of the same community only — no federated RSVPs;
 *   - only people the member directory would show this viewer: the member's
 *     own "who may see my profile" setting, their "list me in member search"
 *     switch, and the community's listing requirements;
 *   - never the viewer themselves; first names only (surnames stay admin-only);
 *   - at most three per event.
 */
class EventListGoingPreviewTest extends TestCase
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
            'title' => 'Seed swap',
            'description' => 'Bring seeds, take seeds.',
            'location' => 'Library',
            'start_time' => now()->addDays(5)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(5)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function rsvp(int $eventId, int $userId, string $status = 'going'): void
    {
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $userId,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed>|null */
    private function listedEvent(int $eventId): ?array
    {
        $response = $this->apiGet('/v2/events?per_page=50', ['X-Events-Contract' => '2']);
        $response->assertOk();

        return collect($response->json('data'))->first(fn ($e) => (int) ($e['id'] ?? 0) === $eventId);
    }

    public function test_a_member_sees_the_first_names_of_members_going_whom_the_directory_would_show_them(): void
    {
        $organiser = $this->member();
        $eventId = $this->event((int) $organiser->id);

        $shown = $this->member(['first_name' => 'Maeve', 'last_name' => 'Byrne', 'avatar_url' => '/uploads/maeve.jpg']);
        $optedOutOfSearch = $this->member(['first_name' => 'Hidden', 'privacy_search' => 0]);
        $connectionsOnly = $this->member(['first_name' => 'Private', 'privacy_profile' => 'connections']);
        $pending = $this->member(['first_name' => 'Pending', 'is_approved' => false]);
        $interested = $this->member(['first_name' => 'Maybe']);
        $viewer = $this->member(['first_name' => 'Viewer']);

        foreach ([$shown, $optedOutOfSearch, $connectionsOnly, $pending, $viewer] as $person) {
            $this->rsvp($eventId, (int) $person->id);
        }
        $this->rsvp($eventId, (int) $interested->id, 'interested');

        Sanctum::actingAs($viewer, ['*']);
        $event = $this->listedEvent($eventId);

        $this->assertNotNull($event, 'the event should be listed');
        $this->assertSame([(int) $shown->id], array_column($event['going_preview'], 'id'));
        $face = $event['going_preview'][0];
        $this->assertSame('Maeve', $face['name']);
        $this->assertArrayNotHasKey('last_name', $face);
        $this->assertStringNotContainsString('Byrne', json_encode($event['going_preview']));
        $this->assertSame('/uploads/maeve.jpg', $face['avatar_url']);
    }

    public function test_nobody_from_another_community_is_shown(): void
    {
        $organiser = $this->member();
        $eventId = $this->event((int) $organiser->id);
        $otherTenantId = (int) DB::table('tenants')->where('id', '<>', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $otherTenantId, 'the test database needs a second community');
        $outsider = User::factory()->forTenant($otherTenantId)->create([
            'first_name' => 'Outsider', 'status' => 'active', 'is_approved' => true,
            'onboarding_completed' => 1, 'privacy_search' => 1, 'privacy_profile' => 'public',
        ]);
        // A federated RSVP, recorded against this community's event.
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $outsider->id,
            'status' => 'going',
            'is_federated' => 1,
            'source_tenant_id' => $otherTenantId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($this->member(), ['*']);
        $event = $this->listedEvent($eventId);

        $this->assertSame([], $event['going_preview']);
    }

    public function test_it_shows_at_most_three_people(): void
    {
        $organiser = $this->member();
        $eventId = $this->event((int) $organiser->id);
        for ($i = 0; $i < 5; $i++) {
            $this->rsvp($eventId, (int) $this->member(['first_name' => "Goer{$i}"])->id);
        }

        Sanctum::actingAs($this->member(), ['*']);
        $event = $this->listedEvent($eventId);

        $this->assertCount(3, $event['going_preview']);
    }

    public function test_a_visitor_who_is_not_signed_in_sees_nobody(): void
    {
        $organiser = $this->member();
        $eventId = $this->event((int) $organiser->id);
        $this->rsvp($eventId, (int) $this->member(['first_name' => 'Maeve'])->id);

        $response = $this->apiGet('/v2/events?per_page=50', ['X-Events-Contract' => '2']);

        // The event list is for signed-in people today. Should it ever open to
        // visitors, the preview must still name nobody.
        if ($response->status() === 200) {
            $event = collect($response->json('data'))->first(fn ($e) => (int) ($e['id'] ?? 0) === $eventId);
            $this->assertSame([], $event['going_preview'] ?? []);
        } else {
            $response->assertStatus(401);
        }
        $this->assertStringNotContainsString('Maeve', $response->getContent());
    }
}
