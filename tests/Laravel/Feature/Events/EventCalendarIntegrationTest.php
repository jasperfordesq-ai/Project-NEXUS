<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventStaffRole;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Services\EventCalendarService;
use App\Services\EventRoleService;
use App\Services\EventService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Reader;
use Tests\Laravel\TestCase;

final class EventCalendarIntegrationTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow('2032-04-10 12:00:00 UTC');
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        TenantContext::reset();
        parent::tearDown();
    }

    public function test_collection_uses_event_policy_and_emits_only_the_identity_free_projection(): void
    {
        $owner = $this->user(['first_name' => 'Owner']);
        $member = $this->user(['first_name' => 'Member']);
        $delegate = $this->user(['first_name' => 'Delegate']);
        $outsider = $this->user(['first_name' => 'Outsider']);
        $publicId = $this->event((int) $owner->id, ['title' => 'Public calendar event']);
        $privateGroup = $this->group((int) $owner->id, 'private');
        $privateId = $this->event((int) $owner->id, [
            'title' => 'Private group calendar event',
            'group_id' => $privateGroup,
        ]);
        $inactiveGroup = $this->group((int) $owner->id, 'private', 'archived');
        $inactiveId = $this->event((int) $owner->id, [
            'title' => 'Inactive group event',
            'group_id' => $inactiveGroup,
        ]);
        $this->joinGroup($privateGroup, $member);
        app(EventRoleService::class)->grant(
            $privateId,
            (int) $delegate->id,
            EventStaffRole::CommunicationsManager,
            $owner,
        );

        $from = new \DateTimeImmutable('2032-04-01T00:00:00Z');
        $until = new \DateTimeImmutable('2032-05-01T00:00:00Z');
        $service = app(EventCalendarService::class);
        $policy = app(EventPolicy::class);

        foreach ([
            [$member, [$publicId, $privateId]],
            // Event staff delegation never outranks the parent Group audience
            // boundary. This delegate has no active Group membership.
            [$delegate, [$publicId]],
            [$outsider, [$publicId]],
        ] as [$viewer, $expectedIds]) {
            TenantContext::setById($this->testTenantId);
            $events = Event::withoutGlobalScopes()
                ->whereIn('id', [$publicId, $privateId, $inactiveId])
                ->orderBy('id')
                ->get();
            $policyIds = collect($policy->abilitiesForEvents($viewer, $events))
                ->filter(static fn (array $abilities): bool => $abilities['view'])
                ->keys()
                ->sort()
                ->values()
                ->all();
            $serviceIds = collect($service->projectionsForRange($viewer, $from, $until))
                ->pluck('id')
                ->sort()
                ->values()
                ->all();

            sort($expectedIds);
            self::assertSame($expectedIds, $policyIds);
            self::assertSame($expectedIds, $serviceIds);
        }

        $missingGroupEvent = new Event();
        $missingGroupEvent->forceFill([
            'id' => 999999,
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'group_id' => 999999,
            'status' => 'active',
            'publication_status' => 'published',
        ]);
        self::assertFalse($policy->view($outsider, $missingGroupEvent));

        Sanctum::actingAs($member, ['*']);
        $response = $this->apiGet('/v2/events/calendar?from=2032-04-01&to=2032-05-01');
        $response->assertOk()
            ->assertJsonPath('meta.identity_free', true)
            ->assertJsonPath('meta.restricted_access_redacted', true);
        $encoded = (string) $response->getContent();
        self::assertStringNotContainsString('Restricted shelter room', $encoded);
        self::assertStringNotContainsString('meet.example.test', $encoded);
        self::assertStringNotContainsString('raw-private-description', $encoded);
        foreach (['location', 'online_link', 'organizer', 'user_id', 'uid_seed'] as $forbidden) {
            self::assertArrayNotHasKey($forbidden, $response->json('data.0'));
        }
    }

    public function test_collection_carries_the_category_id_only_for_the_tenants_own_categories(): void
    {
        $owner = $this->user();
        $ownCategory = $this->category($this->testTenantId);
        $foreignCategory = $this->category(999);
        $categorised = $this->event((int) $owner->id, [
            'title' => 'Categorised',
            'category_id' => $ownCategory,
            'start_time' => '2032-04-15 09:00:00',
        ]);
        $uncategorised = $this->event((int) $owner->id, [
            'title' => 'Uncategorised',
            'start_time' => '2032-04-16 09:00:00',
            'end_time' => '2032-04-16 10:00:00',
        ]);
        // A row pointing at another community's category must not reveal it.
        $crossed = $this->event((int) $owner->id, [
            'title' => 'Crossed',
            'category_id' => $foreignCategory,
            'start_time' => '2032-04-17 09:00:00',
            'end_time' => '2032-04-17 10:00:00',
        ]);
        // Another community's event never reaches this calendar at all.
        $foreignEvent = $this->event((int) $owner->id, [
            'tenant_id' => 999,
            'title' => 'Foreign community event',
            'category_id' => $foreignCategory,
        ]);

        Sanctum::actingAs($owner, ['*']);
        $response = $this->apiGet('/v2/events/calendar?from=2032-04-01&to=2032-05-01');
        $response->assertOk();
        $byId = collect($response->json('data'))->keyBy('id');

        self::assertSame([$categorised, $uncategorised, $crossed], $byId->keys()->all());
        self::assertFalse($byId->has($foreignEvent));
        self::assertSame($ownCategory, $byId[$categorised]['category_id']);
        self::assertArrayHasKey('category_id', $byId[$uncategorised]);
        self::assertNull($byId[$uncategorised]['category_id']);
        self::assertNull($byId[$crossed]['category_id']);
        self::assertStringNotContainsString(
            '"category_id":' . $foreignCategory,
            (string) $response->getContent(),
        );

        // The ICS feed is built from the same projection and is unchanged by it.
        $feed = (string) $this->apiGet('/v2/events/calendar/feed.ics')->getContent();
        self::assertStringNotContainsString('CATEGORIES:', strtoupper($feed));
    }

    public function test_ics_uid_sequence_cancellation_and_vendor_actions_reconcile_from_one_projection(): void
    {
        $owner = $this->user();
        $eventId = $this->event((int) $owner->id, ['title' => 'Canonical calendar title']);
        Sanctum::actingAs($owner, ['*']);

        $first = $this->calendarResponse($eventId);
        $firstEvent = $first->VEVENT;
        $uid = (string) $firstEvent->UID;
        self::assertSame('0', (string) $firstEvent->SEQUENCE);
        self::assertSame('CONFIRMED', (string) $firstEvent->STATUS);
        self::assertFalse(isset($firstEvent->LOCATION));
        self::assertStringNotContainsString('meet.example.test', $first->serialize());
        self::assertStringNotContainsString('raw-private-description', $first->serialize());
        self::assertSame([], $first->validate());

        TenantContext::setById($this->testTenantId);
        self::assertTrue(EventService::update($eventId, (int) $owner->id, [
            'title' => 'Updated canonical title',
        ]));
        $updated = $this->calendarResponse($eventId);
        self::assertSame($uid, (string) $updated->VEVENT->UID);
        self::assertSame('1', (string) $updated->VEVENT->SEQUENCE);
        self::assertSame('Updated canonical title', (string) $updated->VEVENT->SUMMARY);

        TenantContext::setById($this->testTenantId);
        self::assertTrue(EventService::cancelEvent(
            $eventId,
            (int) $owner->id,
            'Safety closure',
            'calendar-cancel-1',
        ));
        $cancelled = $this->calendarResponse($eventId);
        self::assertSame($uid, (string) $cancelled->VEVENT->UID);
        self::assertSame('2', (string) $cancelled->VEVENT->SEQUENCE);
        self::assertSame('CANCELLED', (string) $cancelled->VEVENT->STATUS);
        self::assertSame([], $cancelled->validate());

        $actions = $this->apiGet("/v2/events/{$eventId}/calendar-actions")
            ->assertOk()
            ->json('data');
        parse_str((string) parse_url($actions['google_url'], PHP_URL_QUERY), $google);
        parse_str((string) parse_url($actions['outlook_url'], PHP_URL_QUERY), $outlook);
        self::assertSame((string) $cancelled->VEVENT->SUMMARY, $google['text']);
        self::assertSame($google['text'], $outlook['subject']);
        self::assertSame($google['details'], $outlook['body']);
        self::assertArrayNotHasKey('location', $google);
        self::assertArrayNotHasKey('location', $outlook);
        self::assertSame('Europe/Dublin', $google['stz']);
        self::assertSame('Europe/Dublin', $google['etz']);
    }

    public function test_personal_feed_secret_is_one_time_hashed_revocable_and_range_is_bounded(): void
    {
        Config::set('events.calendar.max_active_feed_tokens', 1);
        $member = $this->user(['preferred_language' => 'de']);
        $owner = $this->user();
        $eventId = $this->event((int) $owner->id);
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'user_id' => $member->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $canonicalEventId = $this->event((int) $owner->id, ['title' => 'Canonical registered event']);
        $cancelledEventId = $this->event((int) $owner->id, ['title' => 'Cancelled canonical registration']);
        foreach ([
            [$canonicalEventId, 'confirmed'],
            [$cancelledEventId, 'cancelled'],
        ] as [$registeredEventId, $state]) {
            DB::table('event_registrations')->insert([
                'tenant_id' => $this->testTenantId,
                'event_id' => $registeredEventId,
                'user_id' => $member->id,
                'capacity_pool_key' => 'event',
                'registration_state' => $state,
                'registration_version' => 1,
                'state_changed_at' => now(),
                'confirmed_at' => $state === 'confirmed' ? now() : null,
                'cancelled_at' => $state === 'cancelled' ? now() : null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
        DB::table('event_rsvps')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $cancelledEventId,
            'user_id' => $member->id,
            'status' => 'going',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        Sanctum::actingAs($member, ['*']);

        $created = $this->apiPost('/v2/events/calendar/feed-tokens', ['label' => 'Laptop'])
            ->assertCreated()
            ->assertHeader('Referrer-Policy', 'no-referrer');
        $this->assertPrivateNoStore($created);
        $secret = (string) $created->json('data.secret');
        $feedUrl = (string) $created->json('data.feed_url');
        $tokenId = (int) $created->json('data.id');
        self::assertStringStartsWith('nxc_', $secret);
        self::assertStringContainsString($secret, $feedUrl);

        $stored = DB::table('event_calendar_feed_tokens')->where('id', $tokenId)->first();
        self::assertNotNull($stored);
        self::assertSame(hash('sha256', $secret), $stored->token_hash);
        self::assertStringNotContainsString($secret, json_encode($stored, JSON_THROW_ON_ERROR));

        $listed = $this->apiGet('/v2/events/calendar/feed-tokens')
            ->assertOk();
        $this->assertPrivateNoStore($listed);
        self::assertStringNotContainsString($secret, (string) $listed->getContent());
        self::assertNull($listed->json('data.0.secret'));
        self::assertNull($listed->json('data.0.feed_url'));

        $this->apiPost('/v2/events/calendar/feed-tokens', ['label' => 'Second'])
            ->assertStatus(409);
        $this->apiGet('/v2/events/calendar/feed.ics?from=2020-01-01&to=2032-01-01')
            ->assertStatus(422);
        $this->apiGet('/v2/events/calendar?from=2020-01-01&to=2032-01-01')
            ->assertStatus(422);

        $path = (string) parse_url($feedUrl, PHP_URL_PATH);
        $feed = $this->get($path)
            ->assertOk()
            ->assertHeader('Referrer-Policy', 'no-referrer');
        $this->assertPrivateNoStore($feed);
        $calendar = $this->calendar((string) $feed->getContent());
        self::assertCount(2, $calendar->select('VEVENT'));
        self::assertStringContainsString('Canonical registered event', $calendar->serialize());
        self::assertStringNotContainsString('Cancelled canonical registration', $calendar->serialize());
        self::assertStringNotContainsString($secret, $calendar->serialize());
        self::assertStringNotContainsString('Restricted shelter room', $calendar->serialize());
        self::assertStringNotContainsString('meet.example.test', $calendar->serialize());

        Sanctum::actingAs($member, ['*']);
        $this->apiDelete("/v2/events/calendar/feed-tokens/{$tokenId}")
            ->assertOk()
            ->assertHeader('Referrer-Policy', 'no-referrer');
        $this->get($path)->assertNotFound();
    }

    public function test_tenant_calendar_policy_stops_feeds_but_preserves_token_revocation(): void
    {
        $member = $this->user();
        Sanctum::actingAs($member, ['*']);
        $created = $this->apiPost('/v2/events/calendar/feed-tokens', ['label' => 'Policy test'])
            ->assertCreated();
        $tokenId = (int) $created->json('data.id');
        $path = (string) parse_url((string) $created->json('data.feed_url'), PHP_URL_PATH);

        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode(['events' => ['calendar_feeds_enabled' => false]]),
        ]);

        $this->apiGet('/v2/events/calendar')->assertForbidden();
        $this->get($path)->assertNotFound();
        $this->apiGet('/v2/events/calendar/feed-tokens')->assertOk();
        $this->apiDelete("/v2/events/calendar/feed-tokens/{$tokenId}")->assertOk();
        self::assertNotNull(DB::table('event_calendar_feed_tokens')->where('id', $tokenId)->value('revoked_at'));
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ], $overrides));
    }

    private function event(int $ownerId, array $overrides = []): int
    {
        $id = (int) DB::table('events')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Calendar integration event',
            'description' => 'raw-private-description https://meet.example.test/inside-description',
            'location' => 'Restricted shelter room',
            'start_time' => '2032-04-15 09:00:00',
            'end_time' => '2032-04-15 10:00:00',
            'timezone' => 'Europe/Dublin',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'calendar_sequence' => 0,
            'is_recurring_template' => 0,
            'is_online' => 1,
            'online_link' => 'https://meet.example.test/restricted',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
        DB::table('events')->where('id', $id)->update([
            'occurrence_key' => "calendar:{$this->testTenantId}:{$id}",
        ]);

        return $id;
    }

    private function category(int $tenantId): int
    {
        $name = 'Calendar category ' . uniqid();

        return (int) DB::table('categories')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $name,
            'slug' => str_replace(' ', '-', strtolower($name)),
            'type' => 'event',
            'color' => 'blue',
        ]);
    }

    private function group(int $ownerId, string $visibility, string $status = 'active'): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Calendar group ' . uniqid(),
            'slug' => 'calendar-group-' . uniqid(),
            'description' => 'Calendar policy group',
            'visibility' => $visibility,
            'status' => $status,
            'is_active' => $status === 'active' ? 1 : 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function joinGroup(int $groupId, User $member): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $member->id,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function calendarResponse(int $eventId): VCalendar
    {
        $response = $this->apiGet("/v2/events/{$eventId}/calendar.ics")->assertOk();
        return $this->calendar((string) $response->getContent());
    }

    private function assertPrivateNoStore(TestResponse $response): void
    {
        $cacheControl = (string) $response->headers->get('Cache-Control');
        self::assertStringContainsString('private', $cacheControl);
        self::assertStringContainsString('no-store', $cacheControl);
        self::assertStringContainsString('max-age=0', $cacheControl);
    }

    private function calendar(string $body): VCalendar
    {
        $calendar = Reader::read($body);
        self::assertInstanceOf(VCalendar::class, $calendar);

        return $calendar;
    }
}
