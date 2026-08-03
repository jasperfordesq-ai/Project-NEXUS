<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Events\CommunityEventCreated;
use App\Events\CommunityEventUpdated;
use App\Models\Group;
use App\Models\User;
use App\Services\EventNotificationService;
use App\Services\EventService;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event as EventFacade;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

final class EventWriterContractTest extends TestCase
{
    use DatabaseTransactions;

    private function activeUser(int $tenantId = 2, array $overrides = []): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'xp' => 0,
        ], $overrides));
    }

    /** @return array<string,mixed> */
    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Enterprise event writer fixture',
            'description' => 'A complete event writer contract fixture.',
            'start_time' => '2027-07-15 09:00:00',
            'end_time' => '2027-07-15 10:30:00',
            'timezone' => 'Europe/Dublin',
            'all_day' => false,
            'location' => 'Community Hall',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
            'max_attendees' => 50,
            'is_online' => true,
            'online_link' => 'https://meet.example.test/room',
            'allow_remote_attendance' => true,
            'video_url' => 'https://video.example.test/watch/1',
            'image_url' => 'https://cdn.example.test/event.jpg',
            'cover_image' => 'https://cdn.example.test/cover.jpg',
            'federated_visibility' => 'listed',
            'venue_accessibility' => [
                'step_free_access' => true,
                'accessible_toilet' => false,
                'hearing_loop' => null,
                'quiet_space' => true,
                'seating_available' => true,
                'accessible_parking' => null,
                'parking_details' => 'Two marked bays beside the east entrance.',
                'transit_details' => 'Bus stop 120 metres away on a level route.',
                'assistance_contact' => 'Ask the event team through Messages.',
                'notes' => 'The side entrance has the level approach.',
            ],
        ], $overrides);
    }

    public function test_public_venue_accessibility_round_trips_without_accepting_private_accommodation_data(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $this->withHeader('X-Events-Contract', '2');

        $created = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Structured venue access profile',
        ]))->assertCreated();
        $eventId = (int) $created->json('data.id');

        $created->assertJsonPath('data.location.accessibility.schema_version', 1)
            ->assertJsonPath('data.location.accessibility.provided', true)
            ->assertJsonPath('data.location.accessibility.step_free_access', true)
            ->assertJsonPath('data.location.accessibility.accessible_toilet', false)
            ->assertJsonPath('data.location.accessibility.hearing_loop', null)
            ->assertJsonPath(
                'data.location.accessibility.parking_details',
                'Two marked bays beside the east entrance.',
            )
            ->assertJsonMissingPath('data.location.accessibility.accommodation_answers');

        $row = DB::table('events')->where('id', $eventId)->firstOrFail();
        $this->assertSame(1, (int) $row->accessibility_step_free);
        $this->assertSame(0, (int) $row->accessibility_toilet);
        $this->assertNull($row->accessibility_hearing_loop);
        $this->assertSame('The side entrance has the level approach.', $row->accessibility_notes);
        DB::table('events')->where('id', $eventId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);

        $updated = $this->apiPut("/v2/events/{$eventId}", [
            'venue_accessibility' => [
                'step_free_access' => false,
                'accessible_toilet' => true,
                'notes' => 'Portable ramp required; contact the event team in advance.',
            ],
        ])->assertOk();
        $updated->assertJsonPath('data.location.accessibility.step_free_access', false)
            ->assertJsonPath('data.location.accessibility.accessible_toilet', true)
            ->assertJsonPath('data.location.accessibility.quiet_space', null)
            ->assertJsonPath('data.location.accessibility.parking_details', null);

        $this->assertSame(
            ['venue_accessibility' => true],
            EventService::getLastMeaningfulUpdateChanges(),
        );
        self::assertSame(1, (int) DB::table('events')->where('id', $eventId)->value('calendar_sequence'));

        foreach ([
            ['venue_accessibility' => ['dietary_requirements' => 'Private answer']],
            ['venue_accessibility' => ['step_free_access' => 'unknown']],
            ['venue_accessibility' => ['notes' => str_repeat('x', 4001)]],
        ] as $invalid) {
            $this->apiPut("/v2/events/{$eventId}", $invalid)->assertStatus(422);
        }

        $this->apiPut("/v2/events/{$eventId}", [
            'location' => null,
            'venue_accessibility' => ['step_free_access' => true],
        ])->assertStatus(422);

        $cleared = $this->apiPut("/v2/events/{$eventId}", [
            'venue_accessibility' => null,
        ])->assertOk();
        $cleared->assertJsonPath('data.location.accessibility.provided', false)
            ->assertJsonPath('data.location.accessibility.step_free_access', null)
            ->assertJsonPath('data.location.accessibility.notes', null);
        self::assertSame(2, (int) DB::table('events')->where('id', $eventId)->value('calendar_sequence'));
        self::assertSame(
            [1, 2],
            DB::table('event_domain_outbox')
                ->where('event_id', $eventId)
                ->where('action', 'event.updated')
                ->orderBy('aggregate_version')
                ->pluck('aggregate_version')
                ->map(static fn (mixed $version): int => (int) $version)
                ->all(),
        );
    }

    public function test_serialized_identical_update_retry_is_a_true_noop_after_locked_rebase(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Locked retry source',
        ]))->assertCreated();
        $eventId = (int) $created->json('data.id');
        DB::table('events')->where('id', $eventId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);

        $payload = ['title' => 'Locked retry applied once'];
        $this->apiPut("/v2/events/{$eventId}", $payload)->assertOk();
        $this->apiPut("/v2/events/{$eventId}", $payload)->assertOk();

        $row = DB::table('events')->where('id', $eventId)->first();
        self::assertNotNull($row);
        self::assertSame('Locked retry applied once', $row->title);
        self::assertSame(1, (int) $row->calendar_sequence);
        self::assertSame(2, (int) $row->federation_version);
        self::assertSame([], EventService::getLastMeaningfulUpdateChanges());
        self::assertSame(1, DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.updated')
            ->count());
    }

    public function test_create_is_a_private_draft_with_server_owned_identity_and_no_fanout(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        EventFacade::fake([CommunityEventCreated::class, CommunityEventUpdated::class]);

        $notifications = Mockery::mock(EventNotificationService::class);
        $notifications->shouldReceive('notifyEventCreated')->never();
        $notifications->shouldReceive('notifyEventUpdated')->never();
        $this->app->instance(EventNotificationService::class, $notifications);

        $response = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Private draft boundary',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'cancelled',
            'occurrence_key' => 'caller-controlled',
            'recurrence_engine' => 'caller-controlled',
            'recurrence_engine_version' => '999',
        ]));

        $response->assertCreated();
        $eventId = (int) $response->json('data.id');
        $event = DB::table('events')->where('id', $eventId)->first();

        $this->assertNotNull($event);
        $this->assertSame('draft', $event->status);
        $this->assertSame('draft', $event->publication_status);
        $this->assertSame('scheduled', $event->operational_status);
        $this->assertSame(0, (int) $event->lifecycle_version);
        $this->assertSame('Europe/Dublin', $event->timezone);
        $this->assertSame('event_input', $event->timezone_source);
        $this->assertSame(0, (int) $event->all_day);
        $this->assertSame('2027-07-15 08:00:00', $event->start_time);
        $this->assertSame('2027-07-15 09:30:00', $event->end_time);
        $this->assertSame("event:{$this->testTenantId}:{$eventId}", $event->occurrence_key);
        $this->assertNull($event->recurrence_engine);
        $this->assertNull($event->recurrence_engine_version);

        EventFacade::assertNotDispatched(CommunityEventCreated::class);
        EventFacade::assertNotDispatched(CommunityEventUpdated::class);
        $this->assertSame(0, DB::table('user_xp_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $organizer->id)
            ->where('action', 'create_event')
            ->count());
        $this->assertSame(0, DB::table('feed_activity')
            ->where('tenant_id', $this->testTenantId)
            ->where('source_type', 'event')
            ->where('source_id', $eventId)
            ->count());

        $this->apiPut("/v2/events/{$eventId}", [
            'title' => 'Still a private draft',
            'status' => 'active',
            'publication_status' => 'published',
            'occurrence_key' => 'caller-overwrite',
            'is_recurring_template' => true,
        ])
            ->assertOk();
        $this->assertSame([], EventService::getLastMeaningfulUpdateChanges());
        $afterUpdate = DB::table('events')->where('id', $eventId)->first();
        $this->assertSame('draft', $afterUpdate->status);
        $this->assertSame('draft', $afterUpdate->publication_status);
        $this->assertSame("event:{$this->testTenantId}:{$eventId}", $afterUpdate->occurrence_key);
        $this->assertSame(0, (int) $afterUpdate->is_recurring_template);
        EventFacade::assertNotDispatched(CommunityEventUpdated::class);
    }

    public function test_create_and_update_enforce_the_same_field_constraints(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);

        $invalidCases = [
            'title' => ['title' => 'ab'],
            'description' => ['description' => str_repeat('x', 10001)],
            'ordering' => [
                'start_time' => '2027-07-15 09:00:00',
                'end_time' => '2027-07-15 08:59:59',
            ],
            'timezone' => ['timezone' => 'Mars/Olympus'],
            'coordinate_pair' => ['latitude' => 53.3, 'longitude' => null],
            'coordinate_range' => ['latitude' => 91, 'longitude' => 0],
            'capacity' => ['max_attendees' => 0],
            'online_scheme' => ['online_link' => 'ftp://example.test/room'],
            'video_scheme' => ['video_url' => 'javascript:alert(1)'],
            'image_scheme' => ['image_url' => '/uploads/other-tenant/event.jpg'],
            'cover_scheme' => ['cover_image' => 'data:image/png;base64,AAAA'],
            'federation_enum' => ['federated_visibility' => 'private'],
        ];

        $attempt = 0;
        foreach ($invalidCases as $name => $invalid) {
            if ($attempt === 8) {
                $organizer = $this->activeUser();
                Sanctum::actingAs($organizer, ['*']);
            }
            $this->apiPost('/v2/events', $this->validPayload(array_merge(
                ['title' => "Invalid create {$name}"],
                $invalid,
            )))->assertStatus(422);
            $attempt++;
        }

        $create = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Update parity target',
        ]))->assertCreated();
        $eventId = (int) $create->json('data.id');

        foreach ($invalidCases as $invalid) {
            $this->apiPut("/v2/events/{$eventId}", $invalid)->assertStatus(422);
        }

        $this->assertSame('Update parity target', DB::table('events')->where('id', $eventId)->value('title'));
    }

    public function test_timezone_dst_and_all_day_semantics_persist_utc_without_losing_local_intent(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);

        $timed = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Summer local time',
            'start_time' => '2027-07-15 09:00:00',
            'end_time' => '2027-07-15 10:00:00',
        ]))->assertCreated();
        $timedId = (int) $timed->json('data.id');
        $this->assertSame('2027-07-15 08:00:00', DB::table('events')->where('id', $timedId)->value('start_time'));

        $allDay = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'DST all day event',
            'start_time' => '2027-03-28',
            'end_time' => '2027-03-29',
            'all_day' => true,
        ]))->assertCreated();
        $allDayRow = DB::table('events')->where('id', (int) $allDay->json('data.id'))->first();
        $this->assertSame('2027-03-28 00:00:00', $allDayRow->start_time);
        $this->assertSame('2027-03-28 23:00:00', $allDayRow->end_time);
        $this->assertSame(1, (int) $allDayRow->all_day);

        $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Nonexistent DST wall time',
            'start_time' => '2027-03-28 01:30:00',
            'end_time' => '2027-03-28 03:00:00',
        ]))->assertStatus(422);
        $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Ambiguous DST wall time',
            'start_time' => '2027-10-31 01:30:00',
            'end_time' => '2027-10-31 03:00:00',
        ]))->assertStatus(422);
        $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Misaligned all day time',
            'start_time' => '2027-07-15 09:00:00',
            'end_time' => '2027-07-16 09:00:00',
            'all_day' => true,
        ]))->assertStatus(422);

        $before = DB::table('events')->where('id', $timedId)->value('start_time');
        $this->apiPut("/v2/events/{$timedId}", ['timezone' => 'America/New_York'])->assertOk();
        $this->assertSame($before, DB::table('events')->where('id', $timedId)->value('start_time'));
        $this->assertSame('event_input', DB::table('events')->where('id', $timedId)->value('timezone_source'));
    }

    public function test_missing_timezone_uses_auditable_tenant_or_application_fallback(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'general.timezone'],
            ['setting_value' => 'America/New_York', 'setting_type' => 'string'],
        );
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);

        $payload = $this->validPayload([
            'title' => 'Tenant timezone default',
            'start_time' => '2027-07-15 09:00:00',
            'end_time' => '2027-07-15 10:00:00',
        ]);
        unset($payload['timezone']);
        $response = $this->apiPost('/v2/events', $payload)->assertCreated();
        $event = DB::table('events')->where('id', (int) $response->json('data.id'))->first();

        $this->assertSame('America/New_York', $event->timezone);
        $this->assertSame('tenant_setting', $event->timezone_source);
        $this->assertSame('2027-07-15 13:00:00', $event->start_time);

        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'general.timezone')
            ->update(['setting_value' => 'Mars/Olympus']);
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
        config()->set('app.timezone', 'UTC');
        $payload['title'] = 'Application timezone fallback';
        $fallback = $this->apiPost('/v2/events', $payload)->assertCreated();
        $fallbackRow = DB::table('events')->where('id', (int) $fallback->json('data.id'))->first();
        $this->assertSame('UTC', $fallbackRow->timezone);
        $this->assertSame('app_config_invalid_tenant_setting', $fallbackRow->timezone_source);
    }

    public function test_capacity_cannot_be_lowered_below_canonical_confirmations_and_live_offers(): void
    {
        $organizer = $this->activeUser();
        $first = $this->activeUser();
        $second = $this->activeUser();
        $offered = $this->activeUser();
        $staleLegacy = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        $created = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Capacity floor target',
            'max_attendees' => 10,
        ]))->assertCreated();
        $eventId = (int) $created->json('data.id');
        DB::table('events')->where('id', $eventId)->update([
            'status' => 'active',
            'publication_status' => 'published',
        ]);
        $now = now();
        DB::table('event_registrations')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $first->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'confirmed',
                'registration_version' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $first->id,
                'confirmed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $second->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'confirmed',
                'registration_version' => 1,
                'state_changed_at' => $now,
                'state_changed_by' => $second->id,
                'confirmed_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $staleLegacy->id,
                'capacity_pool_key' => 'event',
                'registration_state' => 'cancelled',
                'registration_version' => 2,
                'state_changed_at' => $now,
                'state_changed_by' => $staleLegacy->id,
                'cancelled_at' => $now,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        DB::table('event_rsvps')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $second->id,
                'status' => 'going',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $staleLegacy->id,
                'status' => 'going',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
        DB::table('event_waitlist_entries')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $offered->id,
            'capacity_pool_key' => 'event',
            'queue_state' => 'offered',
            'queue_version' => 2,
            'queue_sequence' => 1,
            'state_changed_at' => $now,
            'state_changed_by' => $organizer->id,
            'offered_at' => $now,
            'offer_expires_at' => $now->copy()->addHour(),
            'offer_token_hash' => hash('sha256', 'writer-capacity-offer'),
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->apiPut("/v2/events/{$eventId}", ['max_attendees' => 2])->assertStatus(422);
        $this->assertSame(10, (int) DB::table('events')->where('id', $eventId)->value('max_attendees'));
        $this->apiPut("/v2/events/{$eventId}", ['max_attendees' => 3])->assertStatus(422);
        $this->apiPut("/v2/events/{$eventId}", ['max_attendees' => 4])->assertOk();
        $this->assertSame(4, (int) DB::table('events')->where('id', $eventId)->value('max_attendees'));
    }

    public function test_associations_are_tenant_scoped_and_require_group_or_series_capability(): void
    {
        $organizer = $this->activeUser();
        $other = $this->activeUser();
        $foreign = $this->activeUser(999);
        Sanctum::actingAs($organizer, ['*']);

        $categoryId = (int) DB::table('categories')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'Writer category',
            'slug' => 'writer-category',
            'type' => 'event',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignCategoryId = (int) DB::table('categories')->insertGetId([
            'tenant_id' => 999,
            'name' => 'Foreign category',
            'slug' => 'foreign-category',
            'type' => 'event',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $seriesId = (int) DB::table('event_series')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Writer series',
            'created_by' => $organizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherSeriesId = (int) DB::table('event_series')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => 'Other series',
            'created_by' => $other->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignSeriesId = (int) DB::table('event_series')->insertGetId([
            'tenant_id' => 999,
            'title' => 'Foreign series',
            'created_by' => $foreign->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ownedGroup = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $organizer->id,
            'visibility' => 'public',
        ]);
        $otherGroup = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $other->id,
            'visibility' => 'public',
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $otherGroup->id,
            'user_id' => $organizer->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
        ]);
        $foreignGroup = Group::factory()->forTenant(999)->create([
            'owner_id' => $foreign->id,
            'visibility' => 'public',
        ]);

        $created = $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Owned associations',
            'category_id' => $categoryId,
            'series_id' => $seriesId,
            'group_id' => $ownedGroup->id,
        ]))->assertCreated();
        $event = DB::table('events')->where('id', (int) $created->json('data.id'))->first();
        $this->assertSame($categoryId, (int) $event->category_id);
        $this->assertSame($seriesId, (int) $event->series_id);
        $this->assertSame((int) $ownedGroup->id, (int) $event->group_id);

        $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Unowned series',
            'series_id' => $otherSeriesId,
        ]))->assertForbidden();
        $this->apiPost('/v2/events', $this->validPayload([
            'title' => 'Ordinary member group',
            'group_id' => $otherGroup->id,
        ]))->assertForbidden();

        foreach ([
            ['category_id' => $foreignCategoryId],
            ['series_id' => $foreignSeriesId],
            ['group_id' => $foreignGroup->id],
        ] as $foreignAssociation) {
            $this->apiPost('/v2/events', $this->validPayload(array_merge(
                ['title' => 'Cross tenant association'],
                $foreignAssociation,
            )))->assertStatus(422);
        }

        $eventId = (int) $event->id;
        $this->apiPut("/v2/events/{$eventId}", ['category_id' => $foreignCategoryId])
            ->assertStatus(422);
        $this->apiPut("/v2/events/{$eventId}", ['series_id' => $otherSeriesId])
            ->assertForbidden();
        $this->apiPut("/v2/events/{$eventId}", ['group_id' => $otherGroup->id])
            ->assertForbidden();
        $unchanged = DB::table('events')->where('id', $eventId)->first();
        $this->assertSame($categoryId, (int) $unchanged->category_id);
        $this->assertSame($seriesId, (int) $unchanged->series_id);
        $this->assertSame((int) $ownedGroup->id, (int) $unchanged->group_id);
    }

    public function test_recurring_templates_have_provenance_but_only_occurrences_are_concrete_targets(): void
    {
        $organizer = $this->activeUser();
        Sanctum::actingAs($organizer, ['*']);
        EventFacade::fake([CommunityEventCreated::class]);

        $response = $this->apiPost('/v2/events/recurring', $this->validPayload([
            'title' => 'Weekly draft series',
            'start_time' => '2027-06-15 09:00:00',
            'end_time' => '2027-06-15 10:30:00',
            'recurrence_frequency' => 'weekly',
            'recurrence_interval' => 1,
            'recurrence_ends_type' => 'after_count',
            'recurrence_ends_after_count' => 2,
        ]))->assertCreated();

        $templateId = (int) $response->json('data.template.id');
        $template = DB::table('events')->where('id', $templateId)->first();
        $occurrences = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('parent_event_id', $templateId)
            ->orderBy('id')
            ->get();

        $this->assertSame(1, (int) $template->is_recurring_template);
        $this->assertNull($template->occurrence_key);
        // v2 is the only engine now — the legacy generator was removed.
        $this->assertSame('sabre-vobject', $template->recurrence_engine);
        $this->assertSame('2', $template->recurrence_engine_version);
        $this->assertSame('draft', $template->status);
        $this->assertCount(2, $occurrences);
        foreach ($occurrences as $occurrence) {
            // Content-derived key, not one built from the row's own id: that is
            // what makes a repeat submission structurally unable to duplicate an
            // occurrence.
            $this->assertStringStartsWith('recurrence:', (string) $occurrence->occurrence_key);
            $this->assertSame('sabre-vobject', $occurrence->recurrence_engine);
            $this->assertSame('2', $occurrence->recurrence_engine_version);
            $this->assertSame('draft', $occurrence->status);
            $this->assertNotNull($occurrence->recurrence_id, 'A v2 occurrence carries a calendar identity.');
        }

        $this->apiPost("/v2/events/{$templateId}/rsvp", ['status' => 'going'])
            ->assertNotFound();
        $beforeInvalid = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Invalid recurrence')
            ->count();
        $this->apiPost('/v2/events/recurring', $this->validPayload([
            'title' => 'Invalid recurrence',
            'start_time' => '2027-06-15 09:00:00',
            'end_time' => '2027-06-15 10:30:00',
            'recurrence_frequency' => 'weekly',
            'recurrence_ends_type' => 'after_count',
            // 53 was rejected by the legacy generator, which capped a series at
            // 52. v2 allows up to events.recurrence.max_occurrences (366), so
            // the boundary that must still be enforced is that one.
            'recurrence_ends_after_count' => 400,
        ]))->assertStatus(422);
        $this->assertSame($beforeInvalid, DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Invalid recurrence')
            ->count());
        EventFacade::assertNotDispatched(CommunityEventCreated::class);
    }
}
