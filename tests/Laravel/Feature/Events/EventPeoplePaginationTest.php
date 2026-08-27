<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventPeoplePaginationTest extends TestCase
{
    use DatabaseTransactions;

    public function test_people_paginates_stably_across_registration_waitlist_and_attendance_axes(): void
    {
        $organizer = $this->member('Roster Organizer', 0);
        $eventId = $this->event((int) $organizer->id);
        $members = [];
        for ($index = 1; $index <= 30; $index++) {
            $members[$index] = $this->member(
                sprintf('Roster Person %02d', $index),
                $index,
            );
        }
        $now = now();

        foreach (range(1, 8) as $index) {
            DB::table('event_registrations')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $members[$index]->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'pending',
                'registration_version' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $organizer->id,
                'pending_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        foreach (range(9, 16) as $index) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $members[$index]->id,
                'status' => 'interested',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        foreach (range(17, 25) as $position => $index) {
            DB::table('event_waitlist_entries')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $members[$index]->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'waiting',
                'queue_version' => 1,
                'queue_sequence' => $position + 1,
                'state_changed_at' => $now,
                'state_changed_by' => $organizer->id,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        foreach (range(26, 30) as $index) {
            DB::table('event_attendance')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $members[$index]->id,
                'attendance_status' => 'checked_in',
                'attendance_version' => 1,
                'status_changed_at' => $now,
                'status_changed_by' => $organizer->id,
                'checked_in_at' => $now,
                'checked_in_by' => $organizer->id,
                'notes' => 'PRIVATE ATTENDANCE NOTE',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
        $registrationId = (int) DB::table('event_registrations')
            ->where('event_id', $eventId)
            ->where('user_id', $members[1]->id)
            ->value('id');
        DB::table('event_registration_history')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'registration_id' => $registrationId,
            'user_id' => $members[1]->id,
            'actor_user_id' => $organizer->id,
            'capacity_pool_key' => 'event',
            'registration_version' => 1,
            'action' => 'pending',
            'to_state' => 'pending',
            'idempotency_key' => hash('sha256', 'people-secret-answer'),
            'reason' => 'PRIVATE REVIEW REASON',
            'metadata' => json_encode([
                'schema_version' => 1,
                'registration_answers' => ['safeguarding' => 'PRIVATE ANSWER'],
            ], JSON_THROW_ON_ERROR),
            'created_at' => $now,
        ]);

        Sanctum::actingAs($organizer, ['*']);
        $pageOne = $this->apiGet("/v2/events/{$eventId}/people?per_page=7&page=1");
        $pageTwo = $this->apiGet("/v2/events/{$eventId}/people?per_page=7&page=2");
        $pageOne->assertOk()
            ->assertJsonCount(7, 'data')
            ->assertJsonPath('meta.current_page', 1)
            ->assertJsonPath('meta.per_page', 7)
            ->assertJsonPath('meta.total', 30)
            ->assertJsonPath('meta.total_pages', 5)
            ->assertJsonPath('meta.has_more', true)
            ->assertJsonPath('meta.metrics.confirmed', 0)
            ->assertJsonPath('meta.metrics.waitlisted', 9)
            ->assertJsonPath('meta.metrics.checked_in', 5)
            ->assertJsonPath('data.0.member.display_name', 'Roster Person 01')
            ->assertJsonPath('data.0.registration.state', 'pending')
            ->assertJsonPath('data.0.privacy.sensitive_fields_redacted', true);
        $pageTwo->assertOk()
            ->assertJsonCount(7, 'data')
            ->assertJsonPath('data.0.member.display_name', 'Roster Person 08');

        $firstIds = collect($pageOne->json('data'))->pluck('member.id')->all();
        $secondIds = collect($pageTwo->json('data'))->pluck('member.id')->all();
        self::assertSame([], array_values(array_intersect($firstIds, $secondIds)));
        self::assertSame(
            array_map(static fn (int $index): int => (int) $members[$index]->id, range(1, 7)),
            $firstIds,
        );

        $payload = $pageOne->getContent() . $pageTwo->getContent();
        foreach ([
            '@pagination.example.test',
            '+1 555 777',
            'PRIVATE ATTENDANCE NOTE',
            'PRIVATE REVIEW REASON',
            'PRIVATE ANSWER',
            'registration_answers',
            'offer_token_hash',
            'claim_token_hash',
        ] as $sensitive) {
            self::assertStringNotContainsString($sensitive, $payload);
        }

        $this->apiGet("/v2/events/{$eventId}/people?search=Roster%20Person%2018")
            ->assertOk()
            ->assertJsonPath('meta.total', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.member.id', (int) $members[18]->id)
            ->assertJsonPath('data.0.waitlist.state', 'waiting');
        $this->apiGet("/v2/events/{$eventId}/people?per_page=7&page=6")
            ->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.total', 30)
            ->assertJsonPath('meta.has_more', false);
        $this->apiGet("/v2/events/{$eventId}/people?per_page=101")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'EVENT_PEOPLE_QUERY_INVALID');
    }

    public function test_active_metrics_are_canonical_first_over_stale_legacy_rows(): void
    {
        $organizer = $this->member('Canonical Metrics Organizer', 100);
        $staleRegistration = $this->member('Stale Registration', 101);
        $staleWaitlist = $this->member('Stale Waitlist', 102);
        $legacyConfirmed = $this->member('Legacy Confirmed', 103);
        $legacyWaiting = $this->member('Legacy Waiting', 104);
        $eventId = $this->event((int) $organizer->id);
        $now = now();
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $staleRegistration->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'cancelled',
            'registration_version' => 2,
            'state_changed_at' => $now,
            'state_changed_by' => $staleRegistration->id,
            'cancelled_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('event_waitlist_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $staleWaitlist->id,
            'capacity_pool_key' => 'event',
            'queue_state' => 'cancelled',
            'queue_version' => 2,
            'queue_sequence' => 1,
            'state_changed_at' => $now,
            'state_changed_by' => $staleWaitlist->id,
            'cancelled_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('event_rsvps')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $staleRegistration->id,
                'status' => 'going',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $legacyConfirmed->id,
                'status' => 'going',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        DB::table('event_waitlist')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $staleWaitlist->id,
                'position' => 1,
                'status' => 'waiting',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $legacyWaiting->id,
                'position' => 2,
                'status' => 'waiting',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        Sanctum::actingAs($organizer, ['*']);
        $this->apiGet("/v2/events/{$eventId}/people")
            ->assertOk()
            ->assertJsonPath('meta.metrics.confirmed', 1)
            ->assertJsonPath('meta.metrics.waitlisted', 1);
    }

    private function member(string $name, int $index): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            // last_name must be pinned too: UserObserver::saving() recomputes the
            // stored `name` from first_name + last_name, so leaving the faker's
            // surname beside a set first_name appends it to the display name.
            'first_name' => $name,
            'last_name' => '',
            'email' => sprintf('private-%02d@pagination.example.test', $index),
            'phone' => sprintf('+1 555 777 %04d', $index),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function event(int $organizerId): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'People pagination fixture',
            'description' => 'Server-side pagination and redaction fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'people:' . bin2hex(random_bytes(8)),
            'is_recurring_template' => 0,
            'max_attendees' => 100,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
