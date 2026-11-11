<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Http\Resources\EventSeriesResource;
use App\Http\Resources\EventRegistrationResource;
use App\Http\Resources\EventRosterResource;
use App\Models\User;
use App\Services\EventService;
use App\Services\TenantSettingsService;
use App\Support\Events\EventContractMapper;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventCanonicalContractTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.contract.canonical_version', 2);
        config()->set('events.online_access.reveal_before_minutes', 30);
        config()->set('events.online_access.grace_after_minutes', 120);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'first_name' => 'Alex',
            'last_name' => 'Morgan',
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function category(array $overrides = []): int
    {
        return (int) DB::table('categories')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'name' => 'Workshops',
            'slug' => 'workshops-' . uniqid(),
            'type' => 'event',
            'color' => '#2563eb',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function series(int $creatorId, array $overrides = []): int
    {
        return (int) DB::table('event_series')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'title' => 'Repair Together',
            'description' => 'Monthly repair sessions.',
            'created_by' => $creatorId,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function event(int $organizerId, array $overrides = []): int
    {
        return (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizerId,
            'title' => 'Community repair morning',
            'description' => 'Bring an item and learn how to repair it.',
            'location' => 'Community Hall',
            'latitude' => 53.3498,
            'longitude' => -6.2603,
            'start_time' => now()->addHours(2)->format('Y-m-d H:i:s'),
            'end_time' => now()->addHours(4)->format('Y-m-d H:i:s'),
            'max_attendees' => 20,
            'is_online' => 1,
            'allow_remote_attendance' => 1,
            'online_link' => 'https://meet.example.test/repair',
            'video_url' => 'https://video.example.test/repair',
            'cover_image' => '/uploads/events/repair.jpg',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function group(int $ownerId, array $overrides = []): int
    {
        return (int) DB::table('groups')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Event group ' . uniqid(),
            'slug' => 'event-group-' . uniqid(),
            'description' => 'Group used by the canonical Events contract tests.',
            'visibility' => 'public',
            'is_active' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    public function test_absent_v1_and_unknown_headers_keep_the_legacy_shape_with_redacted_links(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $organizer = $this->user();
        $viewer = $this->user(['first_name' => 'Unauthorised']);
        $eventId = $this->event($organizer->id);
        Sanctum::actingAs($viewer, ['*']);

        foreach ([[], ['X-Events-Contract' => '1'], ['X-Events-Contract' => '99']] as $headers) {
            $response = $this->apiGet("/v2/events/{$eventId}", $headers);

            $response->assertOk()->assertHeader('X-Events-Contract', '1');
            $this->assertSame('Community Hall', $response->json('data.location'));
            $this->assertNull($response->json('data.online_link'));
            $this->assertNull($response->json('data.video_url'));
            $this->assertArrayHasKey('user', $response->json('data'));
            $this->assertArrayNotHasKey('organizer', $response->json('data'));
            $this->assertArrayNotHasKey('online_access', $response->json('data'));
            $this->assertStringContainsString(
                'X-Events-Contract',
                (string) $response->headers->get('Vary')
            );
        }
    }

    public function test_v2_hydrates_actual_organizer_category_series_and_independent_durable_axes(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        app(TenantSettingsService::class)->set(
            $this->testTenantId,
            'general.timezone',
            'Europe/Dublin'
        );
        $organizer = $this->user([
            'first_name' => 'Actual',
            'last_name' => 'Organizer',
            'avatar_url' => '/uploads/avatars/organizer.jpg',
        ]);
        $viewer = $this->user(['first_name' => 'Taylor', 'last_name' => 'Member']);
        $categoryId = $this->category(['slug' => 'repair-workshops']);
        $seriesId = $this->series($organizer->id);
        $eventId = $this->event($organizer->id, [
            'category_id' => $categoryId,
            'series_id' => $seriesId,
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $viewer->id,
            'status' => 'interested',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $viewer->id,
            'position' => 3,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $viewer->id,
            'checked_in_at' => now()->subMinutes(5),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2']);

        $response->assertOk()->assertHeader('X-Events-Contract', '2');
        $response->assertJsonPath('data.contract_version', 2);
        $response->assertJsonPath('data.organizer.id', $organizer->id);
        $response->assertJsonPath('data.organizer.display_name', 'Actual');  // first name only: surnames are admin-only (E-122)
        $response->assertJsonPath('data.category.id', $categoryId);
        $response->assertJsonPath('data.category.slug', 'repair-workshops');
        $response->assertJsonPath('data.location.mode', 'hybrid');
        $response->assertJsonPath('data.schedule.timezone', 'Europe/Dublin');
        $response->assertJsonPath('data.relationship.engagement.state', 'interested');
        $response->assertJsonPath('data.relationship.registration.state', 'waitlisted');
        $response->assertJsonPath('data.relationship.registration.waitlist_position', 3);
        $response->assertJsonPath('data.relationship.attendance.state', 'checked_in');
        $response->assertJsonPath('data.series.named.id', $seriesId);
        $response->assertJsonPath('data.series.named.title', 'Repair Together');
        $response->assertJsonPath('data.permissions.edit', false);
        $response->assertJsonPath('data.permissions.manage_agenda', false);
        $response->assertJsonPath('data.online_access.reveal_state', 'restricted');
        $response->assertJsonPath('data.online_access.join_url', null);

        $fixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-detail.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        $this->assertSameShape($fixture, $response->json('data'));
    }

    public function test_v2_recurrence_projection_exposes_only_allowlisted_concrete_identity(): void
    {
        $base = [
            'id' => 99,
            'parent_event_id' => 42,
            'recurrence_id' => '20300506T090000Z',
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
            'is_recurring_template' => false,
        ];
        $facts = ['recurrence' => [
            'event_id' => 42,
            'frequency' => 'weekly',
            'interval_value' => 1,
            'rrule' => 'FREQ=WEEKLY',
            'internal_rule_secret' => 'must-not-leak',
        ]];

        $projection = EventContractMapper::event($base, $facts);
        $recurrence = $projection['series']['recurrence'];
        self::assertIsArray($recurrence);
        $fixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-recurrence-projection.json')),
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertSame($fixture, $recurrence);
        self::assertArrayNotHasKey('internal_rule_secret', $recurrence);

        foreach ([
            array_replace($base, ['is_recurring_template' => true]),
            array_replace($base, [
                'recurrence_engine' => 'legacy-rrule',
                'recurrence_engine_version' => '1',
            ]),
            array_replace($base, ['recurrence_id' => 'not-an-identity']),
        ] as $ineligible) {
            $ineligibleRecurrence = EventContractMapper::event($ineligible, $facts)['series']['recurrence'];
            self::assertIsArray($ineligibleRecurrence);
            self::assertNull($ineligibleRecurrence['recurrence_id']);
            self::assertNull($ineligibleRecurrence['engine']);
            self::assertNull($ineligibleRecurrence['engine_version']);
        }

        self::assertNull(EventContractMapper::event(['id' => 7])['series']['recurrence']);
    }

    public function test_persisted_recurrence_identity_is_only_exposed_inside_the_v2_projection(): void
    {
        $organizer = $this->user();
        $templateId = $this->event($organizer->id, [
            'is_recurring_template' => 1,
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
        ]);
        $recurrenceId = now()->addWeek()->utc()->format('Ymd\THis\Z');
        $occurrenceId = $this->event($organizer->id, [
            'parent_event_id' => $templateId,
            'recurrence_id' => $recurrenceId,
            'recurrence_engine' => 'sabre-vobject',
            'recurrence_engine_version' => '2',
        ]);
        Sanctum::actingAs($organizer, ['*']);

        $serviceRow = EventService::getById($occurrenceId, (int) $organizer->id);
        self::assertIsArray($serviceRow);
        self::assertArrayNotHasKey('recurrence_id', $serviceRow);

        $legacy = $this->apiGet("/v2/events/{$occurrenceId}");
        $legacy->assertOk()->assertHeader('X-Events-Contract', '1');
        self::assertArrayNotHasKey('recurrence_id', $legacy->json('data'));

        $canonical = $this->apiGet("/v2/events/{$occurrenceId}", ['X-Events-Contract' => '2']);
        $canonical->assertOk()
            ->assertHeader('X-Events-Contract', '2')
            ->assertJsonPath('data.series.recurrence.recurrence_id', $recurrenceId)
            ->assertJsonPath('data.series.recurrence.engine', 'sabre-vobject')
            ->assertJsonPath('data.series.recurrence.engine_version', '2');
        self::assertArrayNotHasKey('recurrence_id', $canonical->json('data'));
        self::assertArrayNotHasKey('recurrence_engine', $canonical->json('data'));
        self::assertArrayNotHasKey('recurrence_engine_version', $canonical->json('data'));
    }

    public function test_v2_relationship_and_capacity_are_canonical_first_during_legacy_dual_read(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Canonical', 'last_name' => 'Organizer']);
        $viewer = $this->user(['first_name' => 'Canonical', 'last_name' => 'Viewer']);
        $other = $this->user(['first_name' => 'Capacity', 'last_name' => 'Holder']);

        $pendingEventId = $this->event($organizer->id, ['max_attendees' => 1]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $pendingEventId,
            'user_id' => $viewer->id,
            'status' => 'interested',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $pendingEventId,
            'user_id' => $viewer->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'pending',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $viewer->id,
            'pending_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $cancelledEventId = $this->event($organizer->id, ['max_attendees' => 1]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $cancelledEventId,
            'user_id' => $viewer->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $cancelledEventId,
            'user_id' => $viewer->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'cancelled',
            'registration_version' => 2,
            'state_changed_at' => now(),
            'state_changed_by' => $viewer->id,
            'cancelled_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $offeredEventId = $this->event($organizer->id, ['max_attendees' => 2]);
        DB::table('event_registrations')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $offeredEventId,
            'user_id' => $other->id,
            'capacity_pool_key' => 'event',
            'registration_state' => 'confirmed',
            'registration_version' => 1,
            'state_changed_at' => now(),
            'state_changed_by' => $other->id,
            'confirmed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $firstWaiter = $this->user(['first_name' => 'First', 'last_name' => 'Waiter']);
        DB::table('event_waitlist_entries')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $offeredEventId,
                'user_id' => $firstWaiter->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'waiting',
                'queue_version' => 1,
                'queue_sequence' => 10,
                'state_changed_at' => now(),
                'state_changed_by' => $firstWaiter->id,
                'offered_at' => null,
                'offer_expires_at' => null,
                'offer_token_hash' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => $this->testTenantId,
                'event_id' => $offeredEventId,
                'user_id' => $viewer->id,
                'capacity_pool_key' => 'event',
                'queue_state' => 'offered',
                'queue_version' => 2,
                'queue_sequence' => 20,
                'state_changed_at' => now(),
                'state_changed_by' => $organizer->id,
                'offered_at' => now(),
                'offer_expires_at' => now()->addHour(),
                'offer_token_hash' => hash('sha256', 'canonical-contract-offer'),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $offeredEventId,
            'user_id' => $viewer->id,
            'position' => 99,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $headers = ['X-Events-Contract' => '2'];
        $this->apiGet("/v2/events/{$pendingEventId}", $headers)
            ->assertOk()
            ->assertJsonPath('data.relationship.engagement.state', 'interested')
            ->assertJsonPath('data.relationship.registration.state', 'pending')
            ->assertJsonPath('data.relationship.capacity.confirmed', 0)
            ->assertJsonPath('data.relationship.capacity.remaining', 1);
        $this->apiGet("/v2/events/{$cancelledEventId}", $headers)
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'cancelled')
            ->assertJsonPath('data.relationship.capacity.confirmed', 0)
            ->assertJsonPath('data.relationship.capacity.remaining', 1)
            ->assertJsonPath('data.metrics.confirmed_count', 0);
        $this->apiGet("/v2/events/{$offeredEventId}", $headers)
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'offered')
            ->assertJsonPath('data.relationship.registration.waitlist_position', 2)
            ->assertJsonPath('data.relationship.capacity.confirmed', 1)
            ->assertJsonPath('data.relationship.capacity.remaining', 0)
            ->assertJsonPath('data.relationship.capacity.is_full', true)
            ->assertJsonPath('data.relationship.capacity.waitlist_count', 2);
    }

    public function test_going_rsvp_without_a_registration_is_not_reported_as_registered(): void
    {
        // An old RSVP row saying "going", with no event_registrations row,
        // used to project as a confirmed registration. The page then offered
        // a check-in code the server refuses to make (it needs a real
        // confirmed registration), so the member saw "We could not check
        // whether you already have a code." The registration record is the
        // only source for the registration state.
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Orphan', 'last_name' => 'Organizer']);
        $viewer = $this->user(['first_name' => 'Orphan', 'last_name' => 'Viewer']);
        $eventId = $this->event($organizer->id, ['max_attendees' => 5]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $viewer->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($viewer, ['*']);
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.relationship.registration.state', 'none')
            ->assertJsonPath('data.relationship.registration.can_withdraw', false);
    }

    public function test_v2_collection_matches_shared_list_envelope_with_nullable_category_and_image(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $organizer = $this->user(['first_name' => 'Jordan', 'last_name' => 'Patel']);
        $viewer = $this->user(['first_name' => 'List', 'last_name' => 'Viewer']);
        $uniqueTitle = 'Neighbourhood walk ' . uniqid();
        $this->event($organizer->id, [
            'title' => $uniqueTitle,
            'description' => 'A relaxed walk around the neighbourhood.',
            'location' => 'Town square',
            'latitude' => null,
            'longitude' => null,
            'start_time' => '2030-06-01 10:00:00',
            'end_time' => null,
            'category_id' => null,
            'cover_image' => null,
            'image_url' => null,
            'is_online' => 0,
            'allow_remote_attendance' => 0,
            'online_link' => null,
            'video_url' => null,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet(
            '/v2/events?q=' . rawurlencode($uniqueTitle) . '&per_page=20',
            ['X-Events-Contract' => '2']
        );
        $response->assertOk()->assertHeader('X-Events-Contract', '2');

        $fixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-list-response.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        $this->assertSameShape($fixture, $response->json());
        $response->assertJsonPath('data.0.category', null);
        $response->assertJsonPath('data.0.primary_image', null);
    }

    public function test_public_cancellation_reason_is_exposed_without_falling_back_to_internal_notes(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $projected = EventContractMapper::event([
            'id' => 500,
            'user_id' => 7,
            'title' => 'Cancelled event',
            'description' => 'Description',
            'status' => 'cancelled',
            'cancellation_reason' => '<strong>Venue unavailable</strong>',
            'moderation_notes' => 'Private moderation assessment',
            'notes' => 'Private operational note',
            'start_time' => '2030-05-02 10:00:00',
            'end_time' => '2030-05-02 11:00:00',
        ], ['timezone' => 'UTC']);

        $this->assertSame('Venue unavailable', $projected['schedule']['cancellation_reason']);
        $this->assertSame('Venue unavailable', $projected['cancellation_reason']);
        $encoded = json_encode($projected, JSON_THROW_ON_ERROR);
        $this->assertStringNotContainsString('Private moderation assessment', $encoded);
        $this->assertStringNotContainsString('Private operational note', $encoded);

        $withoutPublicReason = EventContractMapper::event([
            'id' => 501,
            'user_id' => 7,
            'title' => 'Cancelled without public reason',
            'status' => 'cancelled',
            'moderation_notes' => 'Must remain private',
            'start_time' => '2030-05-02 10:00:00',
        ], ['timezone' => 'UTC']);
        $this->assertNull($withoutPublicReason['schedule']['cancellation_reason']);
    }

    public function test_schedule_projects_both_lifecycle_axes_and_distinct_enterprise_states(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $base = [
            'id' => 600,
            'user_id' => 7,
            'title' => 'Lifecycle projection',
            'start_time' => '2030-05-02 10:00:00',
            'end_time' => '2030-05-02 11:00:00',
        ];

        $pending = EventContractMapper::event($base + [
            'status' => 'draft',
            'publication_status' => 'pending_review',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 3,
        ]);
        $this->assertSame('pending_review', $pending['schedule']['state']);
        $this->assertSame('pending_review', $pending['schedule']['publication_state']);
        $this->assertSame('scheduled', $pending['schedule']['operational_state']);
        $this->assertSame(3, $pending['schedule']['lifecycle_version']);

        $postponed = EventContractMapper::event($base + [
            'status' => 'cancelled',
            'publication_status' => 'published',
            'operational_status' => 'postponed',
            'lifecycle_version' => 4,
            'cancellation_reason' => 'Must not be presented as cancellation',
        ]);
        $this->assertSame('postponed', $postponed['schedule']['state']);
        $this->assertNull($postponed['schedule']['cancellation_reason']);

        $archived = EventContractMapper::event($base + [
            'status' => 'cancelled',
            'publication_status' => 'archived',
            'operational_status' => 'completed',
            'lifecycle_version' => 5,
        ]);
        $this->assertSame('archived', $archived['schedule']['state']);
        $this->assertSame('archived', $archived['schedule']['publication_state']);
        $this->assertSame('completed', $archived['schedule']['operational_state']);
    }

    public function test_member_publication_permissions_and_routes_follow_tenant_moderation(): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'moderation.enabled'],
            ['setting_value' => '1', 'updated_at' => now()],
        );
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'moderation.require_event'],
            ['setting_value' => '1', 'updated_at' => now()],
        );
        $organizer = $this->user();
        $eventId = $this->event((int) $organizer->id, [
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        Sanctum::actingAs($organizer, ['*']);

        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.permissions.submit_for_review', true)
            ->assertJsonPath('data.permissions.publish', false);
        $this->apiPost("/v2/events/{$eventId}/publish", [], ['X-Events-Contract' => '2'])
            ->assertStatus(409)
            ->assertJsonPath('errors.0.code', 'EVENT_REVIEW_REQUIRED');
        $this->apiPost("/v2/events/{$eventId}/submit", [], ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.schedule.publication_state', 'pending_review')
            ->assertJsonPath('data.permissions.submit_for_review', false)
            ->assertJsonPath('data.permissions.publish', false)
            ->assertJsonMissingPath('data.publication_transition');
        $this->assertSame(1, DB::table('event_status_history')->where('event_id', $eventId)->count());
    }

    public function test_series_resource_shared_fixture_includes_occurrences(): void
    {
        $actual = EventSeriesResource::fromArray([
            'id' => 12,
            'title' => 'Repair Together',
            'description' => 'Monthly repair sessions.',
            'event_count' => 6,
            'next_event' => '2030-05-01 10:15:00',
            'creator' => 'Alex Morgan',
            'created_at' => '2030-01-01 08:00:00',
        ], [[
            'id' => 101,
            'title' => 'Community repair morning',
            'start_time' => '2030-05-01 10:15:00',
            'end_time' => '2030-05-01 12:00:00',
            'status' => 'active',
            'location' => 'Community Hall',
        ]]);
        $fixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-series.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        $this->assertSame($fixture, $actual);
        $this->assertCount(1, $actual['occurrences']);
    }

    public function test_registration_and_roster_shared_fixtures_are_frozen(): void
    {
        $registration = EventRegistrationResource::fromArray([
            'id' => 101,
            'max_attendees' => 20,
            'attendee_count' => 19,
            'interested_count' => 8,
        ], [
            'legacy_status' => 'going',
            'waitlist_count' => 4,
            'allowed_actions' => [
                'set_interest' => true,
                'register' => false,
                'withdraw' => true,
                'join_waitlist' => false,
                'leave_waitlist' => false,
            ],
        ], ['status' => 'going']);
        $registrationFixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-registration.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        $this->assertSame($registrationFixture, $registration);

        $roster = EventRosterResource::fromArray([
            'id' => 44,
            'name' => 'Sam Lee',
            'avatar_url' => '/uploads/avatars/sam.jpg',
            'rsvp_status' => 'going',
            'rsvp_at' => '2030-04-10 09:00:00',
            'checked_in_at' => '2030-05-01 10:05:00',
            'checked_out_at' => null,
        ]);
        $rosterFixture = json_decode(
            (string) file_get_contents(base_path('contracts/events/v2/event-roster-item.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
        $this->assertSame($rosterFixture, $roster);
    }

    public function test_manager_and_confirmed_window_access_are_revealed_but_expired_access_is_redacted(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user();
        $attendee = $this->user(['first_name' => 'Confirmed']);
        $eventId = $this->event($organizer->id, [
            'start_time' => '2030-05-01 10:15:00',
            'end_time' => '2030-05-01 11:00:00',
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($organizer, ['*']);
        $this->apiGet("/v2/events/{$eventId}")
            ->assertOk()
            ->assertJsonPath('data.online_link', 'https://meet.example.test/repair')
            ->assertJsonPath('data.video_url', 'https://video.example.test/repair');

        Sanctum::actingAs($attendee, ['*']);
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.online_access.reveal_state', 'available')
            ->assertJsonPath('data.online_access.join_url', 'https://meet.example.test/repair')
            ->assertJsonPath('data.online_link', 'https://meet.example.test/repair');

        Carbon::setTestNow('2030-05-01 13:01:00 UTC');
        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.online_access.reveal_state', 'expired')
            ->assertJsonPath('data.online_access.join_url', null)
            ->assertJsonPath('data.online_link', null)
            ->assertJsonPath('data.video_url', null);
    }

    public function test_start_without_end_is_ongoing_and_nullable_category_and_image_are_safe(): void
    {
        Carbon::setTestNow('2030-05-01 10:00:00 UTC');
        $organizer = $this->user();
        $eventId = $this->event($organizer->id, [
            'start_time' => '2030-05-01 09:00:00',
            'end_time' => null,
            'category_id' => null,
            'cover_image' => null,
            'image_url' => null,
            'is_online' => 0,
            'allow_remote_attendance' => 0,
            'online_link' => null,
            'video_url' => null,
        ]);
        Sanctum::actingAs($organizer, ['*']);

        $this->apiGet("/v2/events/{$eventId}", ['X-Events-Contract' => '2'])
            ->assertOk()
            ->assertJsonPath('data.schedule.state', 'ongoing')
            ->assertJsonPath('data.category', null)
            ->assertJsonPath('data.primary_image', null)
            ->assertJsonPath('data.online_access.reveal_state', 'not_applicable');
    }

    public function test_create_round_trips_contract_fields_and_rejects_invalid_or_unauthorized_associations(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $organizer = $this->user();
        $otherOrganizer = $this->user(['first_name' => 'Other']);
        $categoryId = $this->category();
        $ownedSeriesId = $this->series($organizer->id);
        $otherSeriesId = $this->series($otherOrganizer->id, ['title' => 'Other series']);
        $foreignOrganizer = User::factory()->forTenant(999)->create(['status' => 'active']);
        $foreignCategoryId = (int) DB::table('categories')->insertGetId([
            'tenant_id' => 999,
            'name' => 'Foreign category',
            'slug' => 'foreign-category-' . uniqid(),
            'type' => 'event',
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $foreignSeriesId = (int) DB::table('event_series')->insertGetId([
            'tenant_id' => 999,
            'title' => 'Foreign series',
            'description' => null,
            'created_by' => $foreignOrganizer->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($organizer, ['*']);

        $payload = [
            'title' => 'Hybrid skills exchange',
            'description' => 'A complete field round trip.',
            'location' => 'Library',
            'latitude' => 51.5074,
            'longitude' => -0.1278,
            'start_time' => '2030-05-10 10:00:00',
            'end_time' => '2030-05-10 12:00:00',
            'category_id' => $categoryId,
            'series_id' => $ownedSeriesId,
            'max_attendees' => 30,
            'is_online' => true,
            'allow_remote_attendance' => true,
            'online_link' => 'https://meet.example.test/hybrid',
            'video_url' => 'https://video.example.test/hybrid',
            'cover_image' => '/uploads/events/hybrid.jpg',
        ];

        $response = $this->apiPost('/v2/events', $payload, ['X-Events-Contract' => '2']);
        $response->assertCreated()
            ->assertJsonPath('data.category.id', $categoryId)
            ->assertJsonPath('data.series.named.id', $ownedSeriesId)
            ->assertJsonPath('data.location.latitude', 51.5074)
            ->assertJsonPath('data.location.longitude', -0.1278)
            ->assertJsonPath('data.online_access.join_url', 'https://meet.example.test/hybrid')
            ->assertJsonPath('data.online_access.video_url', 'https://video.example.test/hybrid')
            ->assertJsonPath('data.primary_image.url', '/uploads/events/hybrid.jpg');

        $eventId = (int) $response->json('data.id');
        $stored = DB::table('events')->where('id', $eventId)->first();
        $this->assertSame($categoryId, (int) $stored->category_id);
        $this->assertSame($ownedSeriesId, (int) $stored->series_id);
        $this->assertSame(1, (int) $stored->allow_remote_attendance);
        $this->assertSame('https://video.example.test/hybrid', $stored->video_url);
        $this->assertSame('/uploads/events/hybrid.jpg', $stored->cover_image);
        $baselineCount = DB::table('events')
            ->where('tenant_id', $this->testTenantId)
            ->where('title', 'Hybrid skills exchange')
            ->count();

        $this->apiPost('/v2/events', array_merge($payload, ['series_id' => 999999999]))
            ->assertStatus(422);
        $this->apiPost('/v2/events', array_merge($payload, ['category_id' => 999999999]))
            ->assertStatus(422);
        $this->apiPost('/v2/events', array_merge($payload, ['category_id' => $foreignCategoryId]))
            ->assertStatus(422);
        $this->apiPost('/v2/events', array_merge($payload, ['series_id' => $foreignSeriesId]))
            ->assertStatus(422);
        $this->apiPost('/v2/events', array_merge($payload, ['series_id' => $otherSeriesId]))
            ->assertStatus(403);
        $this->assertSame(
            $baselineCount,
            DB::table('events')
                ->where('tenant_id', $this->testTenantId)
                ->where('title', 'Hybrid skills exchange')
                ->count()
        );
    }

    public function test_group_association_requires_active_tenant_group_management_without_partial_mutation(): void
    {
        Carbon::setTestNow('2030-05-01 08:00:00 UTC');
        $groupOwner = $this->user(['first_name' => 'Group', 'last_name' => 'Owner']);
        $actor = $this->user(['first_name' => 'Ordinary', 'last_name' => 'Member']);
        $activeGroupId = $this->group($groupOwner->id);
        $inactiveGroupId = $this->group($groupOwner->id, [
            'name' => 'Inactive event group',
            'slug' => 'inactive-event-group-' . uniqid(),
            'status' => 'archived',
            'is_active' => 0,
        ]);
        $foreignOwner = User::factory()->forTenant(999)->create(['status' => 'active']);
        $foreignGroupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => 999,
            'owner_id' => $foreignOwner->id,
            'name' => 'Foreign group',
            'slug' => 'foreign-group-' . uniqid(),
            'description' => null,
            'visibility' => 'public',
            'is_active' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $payload = [
            'title' => 'Guarded group event',
            'description' => 'Must not cross a group boundary.',
            'start_time' => '2030-05-10 10:00:00',
            'end_time' => '2030-05-10 11:00:00',
        ];
        Sanctum::actingAs($actor, ['*']);

        $this->apiPost('/v2/events', array_merge($payload, ['group_id' => $activeGroupId]))
            ->assertStatus(403);
        $this->apiPost('/v2/events', array_merge($payload, ['group_id' => $inactiveGroupId]))
            ->assertStatus(422);
        $this->apiPost('/v2/events', array_merge($payload, ['group_id' => $foreignGroupId]))
            ->assertStatus(422);
        $this->assertSame(
            0,
            DB::table('events')
                ->where('tenant_id', $this->testTenantId)
                ->where('title', 'Guarded group event')
                ->count()
        );

        $eventId = $this->event($actor->id, ['title' => 'Original title', 'group_id' => null]);
        $this->apiPut("/v2/events/{$eventId}", [
            'title' => 'Must not persist',
            'group_id' => $activeGroupId,
        ])->assertStatus(403);
        $stored = DB::table('events')->where('id', $eventId)->first();
        $this->assertSame('Original title', $stored->title);
        $this->assertNull($stored->group_id);

        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $activeGroupId,
            'user_id' => $actor->id,
            'role' => 'admin',
            'status' => 'active',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->apiPut("/v2/events/{$eventId}", ['group_id' => $activeGroupId])
            ->assertOk();
        $this->assertSame(
            $activeGroupId,
            (int) DB::table('events')->where('id', $eventId)->value('group_id')
        );

        Sanctum::actingAs($groupOwner, ['*']);
        $ownerResponse = $this->apiPost(
            '/v2/events',
            array_merge($payload, ['title' => 'Group owner event', 'group_id' => $activeGroupId])
        );
        $ownerResponse->assertCreated();
        $this->assertSame(
            $activeGroupId,
            (int) DB::table('events')->where('id', (int) $ownerResponse->json('data.id'))->value('group_id')
        );
    }

    public function test_tenant_admin_and_flag_based_admin_can_update_and_archive_events(): void
    {
        $organizer = $this->user(['first_name' => 'Event', 'last_name' => 'Owner']);
        $tenantAdmin = $this->user(['role' => 'tenant_admin']);
        $flagAdmin = $this->user([
            'role' => 'member',
            'is_tenant_super_admin' => true,
        ]);

        $tenantAdminUpdateId = $this->event($organizer->id, ['title' => 'Tenant admin update']);
        $tenantAdminDeleteId = $this->event($organizer->id, ['title' => 'Tenant admin delete']);
        Sanctum::actingAs($tenantAdmin, ['*']);
        $this->apiPut("/v2/events/{$tenantAdminUpdateId}", ['title' => 'Updated by tenant admin'])
            ->assertOk();
        $this->apiDelete(
            "/v2/events/{$tenantAdminDeleteId}",
            ['reason' => 'Tenant admin archive contract test'],
        )->assertNoContent();
        $this->assertSame(
            'Updated by tenant admin',
            DB::table('events')->where('id', $tenantAdminUpdateId)->value('title')
        );
        $this->assertSame(
            'archived',
            DB::table('events')->where('id', $tenantAdminDeleteId)->value('publication_status'),
        );

        $flagAdminUpdateId = $this->event($organizer->id, ['title' => 'Flag admin update']);
        $flagAdminDeleteId = $this->event($organizer->id, ['title' => 'Flag admin delete']);
        Sanctum::actingAs($flagAdmin, ['*']);
        $this->apiPut("/v2/events/{$flagAdminUpdateId}", ['title' => 'Updated by flag admin'])
            ->assertOk();
        $this->apiDelete(
            "/v2/events/{$flagAdminDeleteId}",
            ['reason' => 'Flag admin archive contract test'],
        )->assertNoContent();
        $this->assertSame(
            'Updated by flag admin',
            DB::table('events')->where('id', $flagAdminUpdateId)->value('title')
        );
        $this->assertSame(
            'archived',
            DB::table('events')->where('id', $flagAdminDeleteId)->value('publication_status'),
        );
    }

    public function test_status_all_roster_retains_legacy_attended_and_durable_checked_in_people(): void
    {
        $organizer = $this->user();
        $legacyAttended = $this->user(['first_name' => 'Legacy']);
        $checkedIn = $this->user(['first_name' => 'Checked']);
        $eventId = $this->event($organizer->id);
        foreach ([
            [$legacyAttended->id, 'attended'],
            [$checkedIn->id, 'not_going'],
        ] as [$userId, $status]) {
            DB::table('event_rsvps')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $eventId,
                'user_id' => $userId,
                'status' => $status,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $checkedIn->id,
            'checked_in_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($organizer, ['*']);

        $response = $this->apiGet(
            "/v2/events/{$eventId}/attendees?status=all",
            ['X-Events-Contract' => '2']
        );
        $response->assertOk();
        $ids = array_column($response->json('data'), 'id');
        $this->assertContains($legacyAttended->id, $ids);
        $this->assertContains($checkedIn->id, $ids);

        $checkedInRow = collect($response->json('data'))->firstWhere('id', $checkedIn->id);
        $this->assertSame('checked_in', $checkedInRow['attendance']['state']);
    }

    private function assertSameShape(mixed $expected, mixed $actual, string $path = 'data'): void
    {
        if (!is_array($expected)) {
            if ($expected !== null) {
                $this->assertSame(get_debug_type($expected), get_debug_type($actual), $path);
            }
            return;
        }

        $this->assertIsArray($actual, $path);
        $this->assertSame(array_keys($expected), array_keys($actual), $path);
        foreach ($expected as $key => $value) {
            $this->assertSameShape($value, $actual[$key], $path . '.' . $key);
        }
    }
}
