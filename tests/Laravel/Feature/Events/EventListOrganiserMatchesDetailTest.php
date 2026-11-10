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
 * Event cards show the organiser's face (10 Nov 2026). The card draws it from
 * the `organizer` object the event list already sends, so this pins the
 * premise that makes that safe: for any viewer, the list says exactly what the
 * event's own page says about the organiser (id, display name, photo) and
 * nothing more. If the two ever diverge, the card would be showing something
 * the event's page does not — fix the list, not this test.
 *
 * Neither endpoint applies the member-directory rules to the organiser; an
 * organiser is named on their event's page whatever their directory settings.
 * That is existing behaviour, recorded here rather than changed.
 */
class EventListOrganiserMatchesDetailTest extends TestCase
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

    private function event(int $organiserId, int $tenantId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $organiserId,
            'title' => 'Seed swap ' . uniqid(),
            'description' => 'Bring seeds, take seeds.',
            'location' => 'Library',
            'start_time' => now()->addDays(5)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(5)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string, mixed> */
    private function organiserFields(array $event): array
    {
        return [
            'id' => $event['organizer']['id'] ?? null,
            'display_name' => $event['organizer']['display_name'] ?? null,
            'avatar_url' => $event['organizer']['avatar_url'] ?? null,
        ];
    }

    public function test_the_list_says_the_same_about_the_organiser_as_the_events_own_page(): void
    {
        $open = $this->member(['first_name' => 'Maeve', 'last_name' => 'Byrne', 'avatar_url' => '/uploads/maeve.jpg']);
        $unlisted = $this->member([
            'first_name' => 'Tom',
            'last_name' => 'Quiet',
            'avatar_url' => '/uploads/tom.jpg',
            'privacy_search' => 0,
            'privacy_profile' => 'connections',
        ]);
        $eventIds = [
            $this->event((int) $open->id, $this->testTenantId),
            $this->event((int) $unlisted->id, $this->testTenantId),
        ];
        $foreignEventId = $this->event((int) $open->id, 999);

        Sanctum::actingAs($this->member(['first_name' => 'Viewer']), ['*']);
        $list = $this->apiGet('/v2/events?per_page=50', ['X-Events-Contract' => '2']);
        $list->assertOk();
        $listed = collect($list->json('data'))->keyBy('id');

        // Another community's event, and so its organiser, is never listed.
        self::assertFalse($listed->has($foreignEventId));

        foreach ($eventIds as $eventId) {
            self::assertTrue($listed->has($eventId));
            $detail = $this->apiGet('/v2/events/' . $eventId, ['X-Events-Contract' => '2']);
            $detail->assertOk();

            self::assertSame(
                $this->organiserFields($detail->json('data')),
                $this->organiserFields($listed[$eventId]),
            );
        }

        self::assertSame((int) $open->id, $listed[$eventIds[0]]['organizer']['id']);
        self::assertSame('/uploads/maeve.jpg', $listed[$eventIds[0]]['organizer']['avatar_url']);
        self::assertNotSame('', (string) $listed[$eventIds[0]]['organizer']['display_name']);
    }
}
