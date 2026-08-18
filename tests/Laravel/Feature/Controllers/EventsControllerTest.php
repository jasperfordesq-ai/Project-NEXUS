<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\EventRecurrenceService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Config;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for EventsController.
 *
 * Covers CRUD, RSVP, attendees, cancel, waitlist, nearby, series.
 */
class EventsControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        // This controller suite verifies the compatibility path's immediate
        // notification fan-out. The production default is intentionally
        // outbox-authoritative and is covered by the outbox-specific suites.
        Config::set('events.notification_delivery.mode', 'direct');
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.notification_delivery_mode')
            ->delete();
    }

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    protected function apiGet(string $uri, array $headers = []): \Illuminate\Testing\TestResponse
    {
        if (str_starts_with($uri, '/v2/events') && Auth::guard('sanctum')->guest()) {
            $this->authenticatedUser();
        }

        return parent::apiGet($uri, $headers);
    }

    private function unauthenticatedEventsGet(string $uri): \Illuminate\Testing\TestResponse
    {
        return parent::apiGet($uri);
    }

    private function seedCategory(): int
    {
        DB::table('categories')->insertOrIgnore([
            'id' => 10,
            'tenant_id' => $this->testTenantId,
            'name' => 'Community',
            'slug' => 'community',
            'type' => 'event',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        return 10;
    }

    /** @param array<string,mixed> $settings */
    private function setEventConfig(array $settings): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['events'] = array_merge($configuration['events'] ?? [], $settings);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration),
        ]);
    }

    /**
     * Create an event directly in the database for testing.
     */
    private function createEvent(int $userId, array $overrides = []): int
    {
        return DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Test Event',
            'description' => 'A community test event.',
            'location' => 'Dublin',
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(7)->addHours(2)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function createPoll(int $userId, array $overrides = []): int
    {
        return DB::table('polls')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'question' => 'Which activity should we choose?',
            'description' => 'Community planning poll.',
            'is_active' => 1,
            'poll_type' => 'standard',
            'category' => 'events',
            'created_at' => now(),
        ], $overrides));
    }

    private function setDailyNotificationPreference(int $userId): void
    {
        DB::table('notification_settings')->insert([
            'user_id' => $userId,
            'context_type' => 'global',
            'context_id' => 0,
            'frequency' => 'daily',
        ]);
    }

    // ================================================================
    // INDEX — Happy path
    // ================================================================

    public function test_index_returns_events_collection(): void
    {
        $user = $this->authenticatedUser();
        $this->createEvent($user->id);

        $response = $this->apiGet('/v2/events');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
            'meta' => ['per_page', 'has_more'],
        ]);
        $this->assertArrayNotHasKey('public_contract', $response->json('data.0'));
    }

    public function test_index_only_returns_publicly_visible_events(): void
    {
        $user = $this->authenticatedUser();
        $this->createEvent($user->id, ['title' => 'Visible active event', 'status' => 'active']);
        $this->createEvent($user->id, ['title' => 'Cancelled event', 'status' => 'cancelled']);
        $this->createEvent($user->id, ['title' => 'Completed event', 'status' => 'completed']);

        // The draft belongs to somebody else on purpose. Since 5373940c8 a
        // creator deliberately DOES see their own unpublished events in the
        // list (badged "Draft event"), because hiding them made a newly
        // created event look lost. Owning this draft with the authenticated
        // user would therefore assert the opposite of the intended behaviour.
        // What must stay true — and is what this test is about — is that a
        // draft is invisible to everyone else. Owner-side visibility and the
        // anonymous case are pinned by EventOwnDraftListingVisibilityTest.
        $otherMember = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->createEvent((int) $otherMember->id, ['title' => 'Draft event', 'status' => 'draft']);

        $response = $this->apiGet('/v2/events?per_page=20');

        $response->assertOk();
        $titles = array_column($response->json('data'), 'title');

        $this->assertContains('Visible active event', $titles);
        $this->assertNotContains('Cancelled event', $titles);
        $this->assertNotContains('Draft event', $titles);
        $this->assertNotContains('Completed event', $titles);
    }

    public function test_public_index_returns_full_next_public_event_contract_when_opted_in(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Event',
            'last_name' => 'Organiser',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->seedCategory();
        // Use a dynamic future window: the public index filters to
        // start_time >= now() (EventService::61), so hardcoded calendar dates
        // silently drop out of the listing once that date passes.
        $start = now()->addDays(7)->setTime(10, 0, 0);
        $end = $start->copy()->setTime(12, 0, 0);
        $startStr = $start->format('Y-m-d H:i:s');
        $endStr = $end->format('Y-m-d H:i:s');
        $eventId = $this->createEvent($user->id, [
            'category_id' => $categoryId,
            'title' => 'Community repair morning',
            'description' => 'A public community event for sharing repair skills.',
            'location' => 'Remote or local',
            'latitude' => null,
            'longitude' => null,
            'image_url' => '/uploads/tenants/hour-timebank/events/repair.jpg',
            'start_time' => $startStr,
            'end_time' => $endStr,
        ]);

        $response = $this->apiGet('/v2/events?per_page=1', [
            'X-Public-Contract' => '1',
        ]);

        $response->assertOk();
        $response->assertJsonStructure([
            'data' => [
                '*' => [
                    'id',
                    'title',
                    'description',
                    'public_contract' => [
                        'id',
                        'slug',
                        'title',
                        'description',
                        'excerpt',
                        'primary_image' => ['url', 'alt_text'],
                        'category' => ['id', 'name', 'slug'],
                        'location' => ['label', 'latitude', 'longitude'],
                        'organiser' => ['id', 'display_name'],
                        'start_at',
                        'end_at',
                        'created_at',
                        'updated_at',
                        'status',
                    ],
                ],
            ],
        ]);

        $contract = $response->json('data.0.public_contract');
        $this->assertSame($eventId, $contract['id']);
        $this->assertSame((string) $eventId, $contract['slug']);
        $this->assertSame('Community repair morning', $contract['title']);
        $this->assertSame('A public community event for sharing repair skills.', $contract['description']);
        $this->assertSame('/uploads/tenants/hour-timebank/events/repair.jpg', $contract['primary_image']['url']);
        $this->assertSame('Community', $contract['category']['name']);
        $this->assertSame('Remote or local', $contract['location']['label']);
        $this->assertNull($contract['location']['latitude']);
        $this->assertNull($contract['location']['longitude']);
        $this->assertSame('Event Organiser', $contract['organiser']['display_name']);
        $this->assertSame(\Illuminate\Support\Carbon::parse($startStr, 'UTC')->toIso8601String(), $contract['start_at']);
        $this->assertSame(\Illuminate\Support\Carbon::parse($endStr, 'UTC')->toIso8601String(), $contract['end_at']);
        $this->assertSame('active', $contract['status']);
    }

    // ================================================================
    // INDEX — Authentication required
    // ================================================================

    public function test_event_read_endpoints_require_authentication(): void
    {
        // Controller-level checks remain authoritative even if route middleware
        // is accidentally relaxed in a later routing change.
        foreach (['/v2/events', '/v2/events/1', '/v2/events/nearby?lat=53&lon=-6'] as $uri) {
            $this->unauthenticatedEventsGet($uri)->assertStatus(401);
        }
    }

    // ================================================================
    // SHOW — Happy path
    // ================================================================

    public function test_show_returns_event_data(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);

        $response = $this->apiGet("/v2/events/{$eventId}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
        $this->assertArrayNotHasKey('public_contract', $response->json('data'));
    }

    public function test_show_returns_counts_without_embedded_rsvp_users(): void
    {
        $organizer = $this->authenticatedUser();
        $attendee = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $eventId = $this->createEvent($organizer->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet("/v2/events/{$eventId}");

        $response->assertOk()->assertJsonPath('data.attendee_count', 1);
        $this->assertArrayNotHasKey('rsvps', $response->json('data'));
    }

    public function test_public_show_returns_full_next_public_event_contract_when_opted_in(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Detail',
            'last_name' => 'Organiser',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $categoryId = $this->seedCategory();
        $eventId = $this->createEvent($user->id, [
            'category_id' => $categoryId,
            'title' => 'Neighbourhood welcome session',
            'description' => 'A detailed public event description for newcomers.',
            'location' => 'Online',
            'image_url' => '/uploads/tenants/hour-timebank/events/welcome.jpg',
            'start_time' => '2026-08-01 18:30:00',
            'end_time' => '2026-08-01 20:00:00',
        ]);

        $response = $this->apiGet("/v2/events/{$eventId}", [
            'X-Public-Contract' => '1',
        ]);

        $response->assertOk();
        $contract = $response->json('data.public_contract');
        $this->assertSame($eventId, $contract['id']);
        $this->assertSame('Neighbourhood welcome session', $contract['title']);
        $this->assertSame('A detailed public event description for newcomers.', $contract['description']);
        $this->assertSame('/uploads/tenants/hour-timebank/events/welcome.jpg', $contract['primary_image']['url']);
        $this->assertSame('Online', $contract['location']['label']);
        $this->assertSame('Detail Organiser', $contract['organiser']['display_name']);
        $this->assertSame('2026-08-01T18:30:00+00:00', $contract['start_at']);
        $this->assertSame('2026-08-01T20:00:00+00:00', $contract['end_at']);
    }

    // ================================================================
    // SHOW — Not found
    // ================================================================

    public function test_show_returns_404_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/events/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // STORE — Happy path
    // ================================================================

    public function test_store_creates_event(): void
    {
        $this->authenticatedUser();
        $categoryId = $this->seedCategory();

        $response = $this->apiPost('/v2/events', [
            'title' => 'Community Gathering',
            'description' => 'A fun community gathering for all members.',
            'location' => 'Community Hall, Dublin',
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHours(3)->format('Y-m-d H:i:s'),
            'category_id' => $categoryId,
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_store_enforces_creation_role_and_applies_tenant_default_capacity(): void
    {
        $categoryId = $this->seedCategory();
        $this->setEventConfig(['creation_role' => 'admins', 'default_capacity' => 42]);
        $payload = [
            'title' => 'Configured Event',
            'description' => 'An Event governed by the tenant policy.',
            'location' => 'Community Hall',
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHours(2)->format('Y-m-d H:i:s'),
            'category_id' => $categoryId,
        ];

        $this->authenticatedUser();
        $this->apiPost('/v2/events', $payload)->assertForbidden();

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active']);
        Sanctum::actingAs($admin, ['*']);
        $response = $this->apiPost('/v2/events', $payload)->assertCreated();
        $eventId = (int) $response->json('data.id');
        self::assertSame(42, (int) DB::table('events')->where('id', $eventId)->value('max_attendees'));
    }

    public function test_waitlist_and_recurrence_tenant_kill_switches_fail_closed(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id, ['max_attendees' => 1]);
        $this->setEventConfig(['waitlist_enabled' => false, 'recurrence_enabled' => false]);

        $this->apiPost("/v2/events/{$eventId}/waitlist", [])->assertForbidden();
        $this->apiPost('/v2/events/recurring', [
            'title' => 'Blocked series',
            'description' => 'Recurring Events are disabled.',
            'location' => 'Community Hall',
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHour()->format('Y-m-d H:i:s'),
            'recurrence_frequency' => 'weekly',
        ])->assertForbidden();
    }

    // ================================================================
    // STORE — Authentication required
    // ================================================================

    public function test_store_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/events', [
            'title' => 'Unauthorized Event',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // STORE — Validation errors
    // ================================================================

    public function test_store_returns_validation_error_without_title(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/events', [
            'description' => 'No title provided.',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_store_cannot_link_poll_owned_by_another_member(): void
    {
        $user = $this->authenticatedUser();
        $otherUser = User::factory()->forTenant($this->testTenantId)->create();
        $otherPollId = $this->createPoll($otherUser->id);

        $response = $this->apiPost('/v2/events', [
            'title' => 'Community Gathering',
            'description' => 'A fun community gathering for all members.',
            'location' => 'Community Hall',
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHours(3)->format('Y-m-d H:i:s'),
            'poll_ids' => [$otherPollId],
        ]);

        $response->assertStatus(403);
        $this->assertNull(DB::table('polls')->where('id', $otherPollId)->value('event_id'));
        $this->assertSame(0, DB::table('events')->where('tenant_id', $this->testTenantId)->where('user_id', $user->id)->where('title', 'Community Gathering')->count());
    }

    // ================================================================
    // UPDATE — Happy path
    // ================================================================

    public function test_organizer_can_update_event(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);

        $response = $this->apiPut("/v2/events/{$eventId}", [
            'title' => 'Updated Event Title',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    // ================================================================
    // UPDATE — Authorization (403)
    // ================================================================

    public function test_non_organizer_cannot_update_event(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $eventId = $this->createEvent($organizer->id);

        $this->authenticatedUser();

        $response = $this->apiPut("/v2/events/{$eventId}", [
            'title' => 'Hijacked Title',
        ]);

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    // ================================================================
    // UPDATE — Not found (404)
    // ================================================================

    public function test_update_returns_404_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPut('/v2/events/999999', [
            'title' => 'Ghost Event',
        ]);

        $this->assertContains($response->getStatusCode(), [404, 422]);
    }

    public function test_update_cannot_link_poll_owned_by_another_member(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id, ['title' => 'Original Event Title']);
        $otherUser = User::factory()->forTenant($this->testTenantId)->create();
        $otherPollId = $this->createPoll($otherUser->id);

        $response = $this->apiPut("/v2/events/{$eventId}", [
            'title' => 'Hijack Poll Association',
            'poll_ids' => [$otherPollId],
        ]);

        $response->assertStatus(403);
        $this->assertNull(DB::table('polls')->where('id', $otherPollId)->value('event_id'));
        $this->assertSame('Original Event Title', DB::table('events')->where('id', $eventId)->value('title'));
    }

    // ================================================================
    // DELETE — Happy path
    // ================================================================

    public function test_organizer_can_delete_event(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);

        $this->apiDelete("/v2/events/{$eventId}")
            ->assertStatus(422)
            ->assertJsonPath('errors.0.field', 'reason');
        $response = $this->apiDelete("/v2/events/{$eventId}", [
            'reason' => 'Organizer archived this event',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    // ================================================================
    // DELETE — Archive-first lifecycle and evidence preservation
    // ================================================================

    public function test_series_delete_archives_future_series_preserves_evidence_and_replays_without_duplicate_fanout(): void
    {
        config()->set('events.notification_delivery.consumer_enabled', true);
        config()->set('events.notification_delivery.channels', ['in_app']);
        $organizer = $this->authenticatedUser();
        $attendee = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'series-archive-attendee-' . uniqid('', true) . '@example.test',
        ]);
        $waitlisted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'series-archive-waitlist-' . uniqid('', true) . '@example.test',
        ]);
        $templateId = $this->createEvent((int) $organizer->id, [
            'title' => 'Recurring Series',
            'is_recurring_template' => 1,
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        $futureOccurrence = $this->createEvent((int) $organizer->id, [
            'parent_event_id' => $templateId,
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHours(2)->format('Y-m-d H:i:s'),
        ]);
        $pastOccurrence = $this->createEvent((int) $organizer->id, [
            'parent_event_id' => $templateId,
            'start_time' => now()->subDays(7)->format('Y-m-d H:i:s'),
            'end_time' => now()->subDays(7)->addHours(2)->format('Y-m-d H:i:s'),
        ]);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'user_id' => $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_attendance')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'user_id' => $attendee->id,
            'checked_in_at' => now()->subHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->setDailyNotificationPreference((int) $attendee->id);
        $this->setDailyNotificationPreference((int) $waitlisted->id);

        $payload = ['reason' => 'Organizer archived this series'];
        $headers = ['X-Events-Contract' => '2', 'Idempotency-Key' => 'series-archive-1'];
        $first = $this->apiDelete("/v2/events/{$templateId}", $payload, $headers);

        $first->assertOk()
            ->assertJsonPath('data.action', 'archive')
            ->assertJsonPath('data.requested_action', 'delete')
            ->assertJsonPath('data.outcome', 'archived')
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.archived', true)
            ->assertJsonPath('data.cancelled', true)
            ->assertJsonPath('data.deleted', false)
            ->assertJsonPath('data.idempotency_key_supplied', true)
            ->assertJsonPath('data.cascade.registrations_cancelled', 1)
            ->assertJsonPath('data.cascade.waitlist_cancelled', 1)
            ->assertJsonPath('data.cascade.reminders_cancelled', 1)
            ->assertJsonPath('data.series.is_series', true)
            ->assertJsonPath('data.series.target_count', 2)
            ->assertJsonPath('data.series.changed_count', 2)
            ->assertJsonPath('data.series.outbox_count', 2);

        $this->assertDatabaseHas('events', [
            'id' => $templateId,
            'tenant_id' => $this->testTenantId,
            'publication_status' => 'archived',
            'operational_status' => 'cancelled',
            'status' => 'cancelled',
            'lifecycle_version' => 1,
        ]);
        $this->assertDatabaseHas('events', [
            'id' => $futureOccurrence,
            'parent_event_id' => $templateId,
            'publication_status' => 'archived',
            'operational_status' => 'cancelled',
        ]);
        $this->assertDatabaseHas('events', ['id' => $pastOccurrence, 'parent_event_id' => $templateId]);
        $this->assertDatabaseHas('event_attendance', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $templateId,
            'user_id' => $attendee->id,
        ]);
        $this->assertSame(1, DB::table('event_status_history')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $templateId)
            ->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $templateId)
            ->where('action', 'event.lifecycle.transitioned')
            ->count());
        app(\App\Services\EventNotificationOutboxProcessor::class)
            ->processBatch(20, $this->testTenantId);
        $this->assertSame(3, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('link', '/events')
            ->where('type', 'event_lifecycle')
            ->count());

        $replay = $this->apiDelete("/v2/events/{$templateId}", $payload, $headers);
        $replay->assertOk()
            ->assertJsonPath('data.outcome', 'already_archived')
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.replayed', true)
            ->assertJsonPath('data.already_archived', true)
            ->assertJsonPath('data.series.changed_count', 0)
            ->assertJsonPath('data.series.replayed_count', 2);
        $this->assertSame(1, DB::table('event_status_history')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $templateId)
            ->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $templateId)
            ->count());
        $this->assertSame(3, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('link', '/events')
            ->where('type', 'event_lifecycle')
            ->count());
    }



    public function test_legacy_delete_response_is_no_content_but_event_is_archived_not_deleted(): void
    {
        $organizer = $this->authenticatedUser();
        $eventId = $this->createEvent((int) $organizer->id, [
            'publication_status' => 'published',
            'operational_status' => 'completed',
            'lifecycle_version' => 3,
            'status' => 'completed',
        ]);

        $response = $this->apiDelete("/v2/events/{$eventId}", [
            'reason' => 'Completed event archived',
        ]);

        $response->assertNoContent();
        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'tenant_id' => $this->testTenantId,
            'publication_status' => 'archived',
            'operational_status' => 'completed',
            'status' => 'cancelled',
            'lifecycle_version' => 4,
        ]);
        $this->assertDatabaseHas('event_status_history', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'lifecycle_version' => 4,
            'to_publication_status' => 'archived',
            'to_operational_status' => 'completed',
        ]);
    }



    // ================================================================
    // DELETE — Authorization (403)
    // ================================================================

    public function test_non_organizer_cannot_delete_event(): void
    {
        $organizer = User::factory()->forTenant($this->testTenantId)->create();
        $eventId = $this->createEvent($organizer->id);

        $this->authenticatedUser();

        $response = $this->apiDelete("/v2/events/{$eventId}");

        $this->assertContains($response->getStatusCode(), [403, 404]);
    }

    // ================================================================
    // DELETE — Not found (404)
    // ================================================================

    public function test_delete_returns_404_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/events/999999');

        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    // ================================================================
    // RSVP — Happy path
    // ================================================================

    public function test_rsvp_requires_status_field(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);

        $response = $this->apiPost("/v2/events/{$eventId}/rsvp", []);

        $response->assertStatus(400);
    }

    public function test_rsvp_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/events/1/rsvp', [
            'status' => 'going',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // RSVP — Not found
    // ================================================================

    public function test_rsvp_returns_error_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/events/999999/rsvp', [
            'status' => 'going',
        ]);

        $this->assertContains($response->getStatusCode(), [404, 422]);
    }

    // ================================================================
    // ATTENDEES — Not found
    // ================================================================

    public function test_attendees_returns_404_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/events/999999/attendees');

        $response->assertStatus(404);
    }

    public function test_attendees_returns_collection_for_existing_event(): void
    {
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);

        $response = $this->apiGet("/v2/events/{$eventId}/attendees");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_attendee_roster_rejects_null_and_unrelated_viewers(): void
    {
        $organizer = $this->authenticatedUser();
        $attendee = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $unrelated = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $eventId = $this->createEvent($organizer->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        \App\Core\TenantContext::setById($this->testTenantId);
        $this->assertSame([], EventService::getAttendees($eventId, [], null)['items']);
        $this->assertNull(EventService::getAttendanceRecords($eventId, null));
        $organizerRoster = EventService::getAttendees($eventId, [], $organizer->id);
        $this->assertCount(1, $organizerRoster['items']);
        $this->assertSame([], EventService::getAttendees($eventId, [], $unrelated->id)['items']);
    }

    // ================================================================
    // CANCEL — Authentication required
    // ================================================================

    public function test_cancel_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/events/1/cancel');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // CANCEL — Not found
    // ================================================================

    public function test_cancel_returns_404_for_nonexistent_event(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/events/999999/cancel', [
            'reason' => 'No longer proceeding',
        ]);

        $this->assertContains($response->getStatusCode(), [400, 404]);
    }

    public function test_cancel_requires_nonblank_reason_before_any_lifecycle_write(): void
    {
        $organizer = $this->authenticatedUser();
        $eventId = $this->createEvent((int) $organizer->id, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);

        $response = $this->apiPost("/v2/events/{$eventId}/cancel", [
            'reason' => '   ',
        ]);

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_REQUIRED_FIELD')
            ->assertJsonPath('errors.0.field', 'reason');
        $this->assertDatabaseHas('events', [
            'id' => $eventId,
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);
        $this->assertDatabaseMissing('event_status_history', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
        ]);

        $invalidKey = $this->apiPost("/v2/events/{$eventId}/cancel", [
            'reason' => 'Capacity issue',
        ], ['Idempotency-Key' => str_repeat('x', 192)]);
        $invalidKey->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'VALIDATION_ERROR')
            ->assertJsonPath('errors.0.field', 'idempotency_key');
        $this->assertDatabaseMissing('event_status_history', [
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
        ]);
    }

    public function test_cancel_notifies_rsvp_and_waitlisted_users_after_statuses_change(): void
    {
        $organizer = $this->authenticatedUser();
        $attendee = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'event-cancel-attendee-' . uniqid('', true) . '@example.test',
        ]);
        $waitlisted = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'email' => 'event-cancel-waitlisted-' . uniqid('', true) . '@example.test',
        ]);
        $eventId = $this->createEvent((int) $organizer->id, [
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);

        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_waitlist')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $waitlisted->id,
            'position' => 1,
            'status' => 'waiting',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('event_reminders')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $attendee->id,
            'remind_before_minutes' => 60,
            'reminder_type' => 'both',
            'scheduled_for' => now()->addDay(),
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->setDailyNotificationPreference((int) $attendee->id);
        $this->setDailyNotificationPreference((int) $waitlisted->id);

        $response = $this->apiPost("/v2/events/{$eventId}/cancel", [
            'reason' => 'Weather',
            'idempotency_key' => str_repeat('b', 192),
        ], ['Idempotency-Key' => 'cancel-event-1']);

        $response->assertOk()
            ->assertJsonPath('data.action', 'cancel')
            ->assertJsonPath('data.outcome', 'cancelled')
            ->assertJsonPath('data.changed', true)
            ->assertJsonPath('data.replayed', false)
            ->assertJsonPath('data.cancelled', true)
            ->assertJsonPath('data.idempotency_key_supplied', true)
            ->assertJsonPath('data.lifecycle_version', 1)
            ->assertJsonPath('data.cascade.registrations_cancelled', 1)
            ->assertJsonPath('data.cascade.waitlist_cancelled', 1)
            ->assertJsonPath('data.cascade.reminders_cancelled', 1);
        $this->assertSame('cancelled', DB::table('event_rsvps')->where('event_id', $eventId)->where('user_id', $attendee->id)->value('status'));
        $this->assertSame('cancelled', DB::table('event_waitlist')->where('event_id', $eventId)->where('user_id', $waitlisted->id)->value('status'));
        $this->assertSame(3, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('type', 'event')->count());
        $this->assertSame(2, DB::table('notification_queue')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('activity_type', 'event_cancellation')->count());

        $replay = $this->apiPost("/v2/events/{$eventId}/cancel", [
            'reason' => 'Weather',
        ], ['Idempotency-Key' => 'cancel-event-1']);
        $replay->assertOk()
            ->assertJsonPath('data.outcome', 'already_cancelled')
            ->assertJsonPath('data.changed', false)
            ->assertJsonPath('data.replayed', true)
            ->assertJsonPath('data.already_cancelled', true);
        $this->assertSame(1, DB::table('event_status_history')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->count());
        $this->assertSame(1, DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->count());
        $this->assertSame(3, DB::table('notifications')->where('tenant_id', $this->testTenantId)->where('link', "/events/{$eventId}")->where('type', 'event')->count());
    }

    // ================================================================
    // NEARBY — Validation
    // ================================================================

    public function test_nearby_returns_400_without_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/events/nearby');

        $response->assertStatus(400);
    }

    public function test_nearby_returns_400_for_invalid_latitude(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/events/nearby?lat=999&lon=0');

        $response->assertStatus(400);
    }

    public function test_nearby_returns_data_with_valid_coordinates(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/events/nearby?lat=53.35&lon=-6.26');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_nearby_hides_private_group_events_until_viewer_is_a_member(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active']);
        $viewer = $this->authenticatedUser();
        $groupId = DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Private nearby event group',
            'slug' => 'private-nearby-' . uniqid(),
            'visibility' => 'private',
            'is_active' => 1,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $privateEventId = $this->createEvent($owner->id, [
            'title' => 'Private group nearby event',
            'group_id' => $groupId,
            'latitude' => 53.3498,
            'longitude' => -6.2603,
        ]);
        $publicEventId = $this->createEvent($owner->id, [
            'title' => 'Visible nearby event',
            'latitude' => 53.3499,
            'longitude' => -6.2604,
        ]);

        $first = $this->apiGet('/v2/events/nearby?lat=53.3498&lon=-6.2603&radius_km=5&per_page=100');
        $first->assertOk();
        $firstIds = array_map('intval', array_column($first->json('data'), 'id'));
        $this->assertContains($publicEventId, $firstIds);
        $this->assertNotContains($privateEventId, $firstIds);

        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $viewer->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $second = $this->apiGet('/v2/events/nearby?lat=53.3498&lon=-6.2603&radius_km=5&per_page=100');
        $second->assertOk();
        $this->assertContains(
            $privateEventId,
            array_map('intval', array_column($second->json('data'), 'id'))
        );
    }

    // ================================================================
    // NEARBY — Radius filter actually filters (regression guard)
    // ================================================================

    public function test_index_with_near_lat_excludes_distant_events(): void
    {
        // Dublin city centre ≈ 53.3498, -6.2603
        // Cork city centre ≈ 51.8985, -8.4756  (~258 km away)
        $user = $this->authenticatedUser();

        $nearId = $this->createEvent($user->id, [
            'title'     => 'Near Dublin event',
            'latitude'  => 53.3490,
            'longitude' => -6.2600,
        ]);

        $farId = $this->createEvent($user->id, [
            'title'     => 'Far Cork event',
            'latitude'  => 51.8985,
            'longitude' => -8.4756,
        ]);

        // 10 km radius centred on Dublin — Cork must be excluded
        $response = $this->apiGet('/v2/events?near_lat=53.3498&near_lng=-6.2603&radius_km=10');

        $response->assertStatus(200);
        $data = collect($response->json('data'));

        $ids = $data->pluck('id');
        $this->assertTrue($ids->contains($nearId), 'Nearby event should be included in results');
        $this->assertFalse($ids->contains($farId), 'Distant event (Cork) must be excluded by radius filter');
    }

    // ================================================================
    // TENANT ISOLATION
    // ================================================================

    public function test_cannot_access_event_from_different_tenant(): void
    {
        DB::table('tenants')->insertOrIgnore([
            'id' => 999, 'name' => 'Other', 'slug' => 'other',
            'is_active' => true, 'depth' => 0, 'allows_subtenants' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $otherUser = User::factory()->forTenant(999)->create();
        $otherEventId = DB::table('events')->insertGetId([
            'tenant_id' => 999,
            'user_id' => $otherUser->id,
            'title' => 'Other Tenant Event',
            'description' => 'Should not be visible.',
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->authenticatedUser();

        $response = $this->apiGet("/v2/events/{$otherEventId}");

        // Should return 404 because event belongs to different tenant
        $this->assertContains($response->getStatusCode(), [404, 403]);
    }

    // ================================================================
    // RECURRING — series collapse + image cascade
    // ================================================================

    public function test_get_all_collapses_recurring_series_to_next_occurrence(): void
    {
        $user = $this->authenticatedUser();

        // A standalone event must still pass through un-collapsed.
        $standalone = $this->createEvent($user->id, [
            'start_time' => now()->addDays(3)->format('Y-m-d H:i:s'),
        ]);

        // A recurring series: template (soonest) + two future occurrences.
        $templateId = $this->createEvent($user->id, [
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'is_recurring_template' => 1,
        ]);
        $occ1 = $this->createEvent($user->id, [
            'start_time' => now()->addDays(14)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(14)->addHours(2)->format('Y-m-d H:i:s'),
            'parent_event_id' => $templateId,
        ]);
        $occ2 = $this->createEvent($user->id, [
            'start_time' => now()->addDays(21)->format('Y-m-d H:i:s'),
            'end_time' => now()->addDays(21)->addHours(2)->format('Y-m-d H:i:s'),
            'parent_event_id' => $templateId,
        ]);

        // This is a direct service call rather than an HTTP request, so pin the
        // tenant explicitly instead of relying on request middleware state.
        \App\Core\TenantContext::setById($this->testTenantId);

        // Scope to this user so baseline fixtures in the test DB don't interfere.
        $result = EventService::getAll([
            'when' => 'upcoming',
            'limit' => 50,
            'user_id' => $user->id,
            'viewer_id' => $user->id,
        ]);
        $ids = array_column($result['items'], 'id');

        // Exactly one representative for the series (the soonest = the template),
        // plus the standalone event.
        $this->assertContains($standalone, $ids);
        $this->assertContains($templateId, $ids);
        $this->assertNotContains($occ1, $ids);
        $this->assertNotContains($occ2, $ids);
        $this->assertCount(2, $result['items']);

        $rep = collect($result['items'])->firstWhere('id', $templateId);
        $this->assertTrue($rep['is_series'] ?? false);
        $this->assertSame(3, $rep['series_count'] ?? null);
    }

    public function test_recurring_image_updates_require_scope_and_preserve_single_occurrence_override(): void
    {
        $user = $this->authenticatedUser();
        $occurrenceOneStart = now()->addDays(14)->startOfSecond();
        $occurrenceTwoStart = now()->addDays(21)->startOfSecond();

        $templateId = $this->createEvent($user->id, [
            'start_time' => now()->addDays(7)->format('Y-m-d H:i:s'),
            'is_recurring_template' => 1,
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
        ]);
        $occ1 = $this->createEvent($user->id, [
            'start_time' => $occurrenceOneStart->format('Y-m-d H:i:s'),
            'end_time' => $occurrenceOneStart->copy()->addHours(2)->format('Y-m-d H:i:s'),
            'parent_event_id' => $templateId,
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
            'recurrence_id' => $occurrenceOneStart->copy()->utc()->format('Ymd\THis\Z'),
        ]);
        $occ2 = $this->createEvent($user->id, [
            'start_time' => $occurrenceTwoStart->format('Y-m-d H:i:s'),
            'end_time' => $occurrenceTwoStart->copy()->addHours(2)->format('Y-m-d H:i:s'),
            'parent_event_id' => $templateId,
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
            'recurrence_id' => $occurrenceTwoStart->copy()->utc()->format('Ymd\THis\Z'),
        ]);

        \App\Core\TenantContext::setById($this->testTenantId);

        $this->apiPost("/v2/events/{$templateId}/image", [])
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_SCOPE_REQUIRED');
        $this->apiPost("/v2/events/{$templateId}/image", ['scope' => 'single'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.0.code', 'EVENT_RECURRENCE_TEMPLATE_ALL_SCOPE_REQUIRED');

        $this->assertFalse(EventService::updateImage($templateId, $user->id, 'https://cdn.example.test/no-scope.jpg'));
        $this->assertSame('EVENT_RECURRENCE_SCOPE_REQUIRED', EventService::getErrors()[0]['code'] ?? null);
        $this->assertFalse(EventService::updateImage($templateId, $user->id, 'https://cdn.example.test/single.jpg', 'single'));
        $this->assertSame(
            'EVENT_RECURRENCE_TEMPLATE_ALL_SCOPE_REQUIRED',
            EventService::getErrors()[0]['code'] ?? null,
        );

        $this->assertTrue(
            EventService::updateImage($occ1, $user->id, 'https://cdn.example.test/occurrence-cover.jpg', 'single'),
            json_encode(EventService::getErrors(), JSON_UNESCAPED_UNICODE),
        );

        // Uploading the cover to the template with explicit all-scope updates
        // non-exception rows while preserving the occurrence override.
        $this->assertTrue(
            EventService::updateImage($templateId, $user->id, 'https://cdn.example.test/cover.jpg', 'all'),
            json_encode(EventService::getErrors(), JSON_UNESCAPED_UNICODE)
        );

        $this->assertSame('https://cdn.example.test/cover.jpg', DB::table('events')->where('id', $templateId)->value('cover_image'));
        $this->assertSame('https://cdn.example.test/occurrence-cover.jpg', DB::table('events')->where('id', $occ1)->value('cover_image'));
        $this->assertSame('https://cdn.example.test/cover.jpg', DB::table('events')->where('id', $occ2)->value('cover_image'));
        $this->assertSame(['cover_image'], json_decode(
            (string) DB::table('events')->where('id', $occ1)->value('recurrence_override_fields'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        ));

        $rootOutbox = DB::table('event_domain_outbox')
            ->where('event_id', $templateId)
            ->where('action', 'event.updated')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($rootOutbox);
        $payload = json_decode((string) $rootOutbox->payload, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['cover_image'], $payload['changed_fields']);
        $this->assertTrue($payload['metadata']['notifications_suppressed']);
        $this->assertSame('cover_image_audit_only', $payload['metadata']['notification_policy']);
        $this->assertSame([$templateId, $occ2], $payload['metadata']['series']['affected_event_ids']);
        $this->assertSame([], $payload['affected_recipient_user_ids']);
    }

    public function test_standalone_image_update_has_versioned_suppressed_audit_fact(): void
    {
        config()->set('events.notification_delivery.consumer_enabled', true);
        config()->set('events.notification_delivery.channels', ['in_app']);
        $user = $this->authenticatedUser();
        $eventId = $this->createEvent($user->id);
        \App\Core\TenantContext::setById($this->testTenantId);

        $this->assertTrue(EventService::updateImage($eventId, $user->id, 'https://cdn.example.test/standalone.jpg'));
        $this->assertSame('https://cdn.example.test/standalone.jpg', DB::table('events')->where('id', $eventId)->value('cover_image'));
        $this->assertSame(1, (int) DB::table('events')->where('id', $eventId)->value('calendar_sequence'));

        $outbox = DB::table('event_domain_outbox')
            ->where('event_id', $eventId)
            ->where('action', 'event.updated')
            ->first();
        $this->assertNotNull($outbox);
        $payload = json_decode((string) $outbox->payload, true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame(['cover_image'], $payload['changed_fields']);
        $this->assertTrue($payload['metadata']['notifications_suppressed']);
        $this->assertSame('cover_image_audit_only', $payload['metadata']['notification_policy']);

        app(\App\Services\EventNotificationOutboxProcessor::class)->processBatch(10, $this->testTenantId);
        $this->assertSame('direct', DB::table('event_domain_outbox')->where('id', $outbox->id)->value('status'));
        $this->assertSame(0, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('type', 'event_update')
            ->count());
    }
}
