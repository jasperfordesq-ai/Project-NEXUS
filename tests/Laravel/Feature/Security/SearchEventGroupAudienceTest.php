<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\SearchService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use ReflectionProperty;
use Tests\Laravel\TestCase;

/**
 * F-078 (E-027): unified search and group audiences.
 *
 * EventSearchVisibility checked tenant, template and lifecycle but not the
 * event's group, so every search surface returned events that belong to a
 * private or secret group to members who are not in it. Each result was the
 * raw Event row, so it carried `online_link` / `video_url` — the join link of
 * the private meeting, and of every public online event without registering.
 *
 * With Meilisearch unavailable the SQL fallback also listed private and secret
 * groups (name, description, location) and listings still awaiting moderation,
 * which the Meilisearch path already filters out.
 *
 * The SQL path is forced by pinning SearchService::$available to false (as
 * EventSearchVisibilityTest does). The Meilisearch path's database
 * revalidation is exercised directly on the hydration helpers with synthetic
 * hits, because the engine client cannot be faked in-process.
 */
final class SearchEventGroupAudienceTest extends TestCase
{
    use DatabaseTransactions;

    private ReflectionProperty $availability;

    private mixed $originalAvailability;

    private string $term;

    private User $owner;

    private User $member;

    private User $outsider;

    private User $admin;

    private int $privateGroupId;

    private int $secretGroupId;

    private int $publicGroupId;

    private int $privateGroupEventId;

    private int $secretGroupEventId;

    private int $publicGroupEventId;

    private int $openEventId;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->availability = new ReflectionProperty(SearchService::class, 'available');
        $this->availability->setAccessible(true);
        $this->originalAvailability = $this->availability->getValue();
        $this->availability->setValue(null, false);

        $this->term = 'AudienceSearch' . bin2hex(random_bytes(4));

        $this->owner = $this->user();
        $this->member = $this->user();
        $this->outsider = $this->user();
        $this->admin = $this->user(['role' => 'admin']);

        $this->privateGroupId = $this->group('private');
        $this->secretGroupId = $this->group('secret');
        $this->publicGroupId = $this->group('public');
        $this->addMember($this->privateGroupId, $this->member);

        $this->privateGroupEventId = $this->event('private circle meeting', $this->privateGroupId);
        $this->secretGroupEventId = $this->event('secret circle meeting', $this->secretGroupId);
        $this->publicGroupEventId = $this->event('public group meeting', $this->publicGroupId);
        $this->openEventId = $this->event('community meeting', null);
    }

    protected function tearDown(): void
    {
        $this->availability->setValue(null, $this->originalAvailability);
        parent::tearDown();
    }

    public function test_unified_search_hides_private_group_events_from_non_members_and_never_returns_join_links(): void
    {
        Sanctum::actingAs($this->outsider, ['*']);

        $response = $this->apiGet('/v2/search?q=' . urlencode($this->term) . '&type=events&per_page=50');

        $response->assertStatus(200);
        $this->assertEqualsCanonicalizing(
            [$this->publicGroupEventId, $this->openEventId],
            $this->ids($response->json('data') ?? []),
        );
        $this->assertNoJoinLinks($response->getContent());
        foreach ($response->json('data') as $item) {
            $this->assertNull($item['online_link'] ?? null);
            $this->assertNull($item['video_url'] ?? null);
        }
    }

    public function test_group_member_owner_and_tenant_admin_still_find_their_group_events(): void
    {
        $cases = [
            'member' => [$this->member, [$this->privateGroupEventId, $this->publicGroupEventId, $this->openEventId]],
            'owner' => [$this->owner, [
                $this->privateGroupEventId,
                $this->secretGroupEventId,
                $this->publicGroupEventId,
                $this->openEventId,
            ]],
            'admin' => [$this->admin, [
                $this->privateGroupEventId,
                $this->secretGroupEventId,
                $this->publicGroupEventId,
                $this->openEventId,
            ]],
        ];

        foreach ($cases as $label => [$viewer, $expected]) {
            Sanctum::actingAs($viewer, ['*']);
            $response = $this->apiGet('/v2/search?q=' . urlencode($this->term) . '&type=events&per_page=50');
            $response->assertStatus(200);
            $this->assertEqualsCanonicalizing($expected, $this->ids($response->json('data') ?? []), $label);
            // Search is a discovery surface: even an eligible viewer gets the
            // link from the event page, never from a search result.
            $this->assertNoJoinLinks($response->getContent());
        }
    }

    public function test_classic_search_and_suggestions_apply_the_same_event_audience(): void
    {
        $service = app(SearchService::class);

        $outsider = $service->search($this->term, 'events', 50, (int) $this->outsider->id);
        $this->assertEqualsCanonicalizing(
            [$this->publicGroupEventId, $this->openEventId],
            $this->ids($outsider['events'] ?? []),
        );
        $this->assertNoJoinLinks((string) json_encode($outsider));

        $member = $service->search($this->term, 'events', 50, (int) $this->member->id);
        $this->assertContains($this->privateGroupEventId, $this->ids($member['events'] ?? []));
        $this->assertNoJoinLinks((string) json_encode($member));

        Sanctum::actingAs($this->outsider, ['*']);
        $response = $this->apiGet('/v2/search/suggestions?q=' . urlencode($this->term) . '&limit=10');
        $response->assertStatus(200);
        $this->assertEqualsCanonicalizing(
            [$this->publicGroupEventId, $this->openEventId],
            $this->ids($response->json('data.events') ?? []),
        );

        Sanctum::actingAs($this->member, ['*']);
        $response = $this->apiGet('/v2/search/suggestions?q=' . urlencode($this->term) . '&limit=10');
        $response->assertStatus(200);
        $this->assertContains($this->privateGroupEventId, $this->ids($response->json('data.events') ?? []));
    }

    public function test_sql_group_search_hides_private_and_secret_groups_from_non_members(): void
    {
        Sanctum::actingAs($this->outsider, ['*']);
        $response = $this->apiGet('/v2/search?q=' . urlencode($this->term) . '&type=groups&per_page=50');
        $response->assertStatus(200);
        $this->assertSame([$this->publicGroupId], $this->ids($response->json('data') ?? []));
        $this->assertStringNotContainsString('Private circle for ' . $this->term, $response->getContent());

        $response = $this->apiGet('/v2/search/suggestions?q=' . urlencode($this->term) . '&limit=10');
        $response->assertStatus(200);
        $this->assertSame([$this->publicGroupId], $this->ids($response->json('data.groups') ?? []));

        $service = app(SearchService::class);
        $classic = $service->search($this->term, 'groups', 50, (int) $this->outsider->id);
        $this->assertSame([$this->publicGroupId], $this->ids($classic['groups'] ?? []));

        // Controls: the member still finds the private group they belong to,
        // and the tenant admin can audit every group.
        Sanctum::actingAs($this->member, ['*']);
        $response = $this->apiGet('/v2/search?q=' . urlencode($this->term) . '&type=groups&per_page=50');
        $this->assertEqualsCanonicalizing(
            [$this->privateGroupId, $this->publicGroupId],
            $this->ids($response->json('data') ?? []),
        );

        $adminView = $service->search($this->term, 'groups', 50, (int) $this->admin->id);
        $this->assertEqualsCanonicalizing(
            [$this->privateGroupId, $this->secretGroupId, $this->publicGroupId],
            $this->ids($adminView['groups'] ?? []),
        );
    }

    public function test_sql_listing_search_excludes_listings_awaiting_or_failing_moderation(): void
    {
        $approved = $this->listing('approved');
        $legacy = $this->listing(null);
        $this->listing('pending_review');
        $this->listing('rejected');

        Sanctum::actingAs($this->outsider, ['*']);
        $response = $this->apiGet('/v2/search?q=' . urlencode($this->term) . '&type=listings&per_page=50');
        $response->assertStatus(200);
        $this->assertEqualsCanonicalizing([$approved, $legacy], $this->ids($response->json('data') ?? []));

        $response = $this->apiGet('/v2/search/suggestions?q=' . urlencode($this->term) . '&limit=10');
        $this->assertEqualsCanonicalizing([$approved, $legacy], $this->ids($response->json('data.listings') ?? []));

        $classic = app(SearchService::class)->search($this->term, 'listings', 50, (int) $this->outsider->id);
        $this->assertEqualsCanonicalizing([$approved, $legacy], $this->ids($classic['listings'] ?? []));
    }

    public function test_meilisearch_hits_are_revalidated_for_group_audience_and_redacted(): void
    {
        $service = app(SearchService::class);
        $eventHits = array_map(static fn (int $id): array => ['id' => $id], [
            $this->privateGroupEventId,
            $this->secretGroupEventId,
            $this->publicGroupEventId,
            $this->openEventId,
        ]);

        $hydrateEvents = new ReflectionMethod(SearchService::class, 'hydrateEventHits');
        $hydrateEvents->setAccessible(true);

        $outsider = $hydrateEvents->invoke($service, $eventHits, $this->testTenantId, (int) $this->outsider->id);
        $this->assertSame([$this->publicGroupEventId, $this->openEventId], $this->ids($outsider));
        $this->assertNoJoinLinks((string) json_encode($outsider));

        $member = $hydrateEvents->invoke($service, $eventHits, $this->testTenantId, (int) $this->member->id);
        $this->assertSame(
            [$this->privateGroupEventId, $this->publicGroupEventId, $this->openEventId],
            $this->ids($member),
        );
        $this->assertNoJoinLinks((string) json_encode($member));

        // Stale index document claims the secret group is public.
        $groupHits = array_map(static fn (int $id): array => ['id' => $id], [
            $this->secretGroupId,
            $this->privateGroupId,
            $this->publicGroupId,
        ]);
        $hydrateGroups = new ReflectionMethod(SearchService::class, 'hydrateGroupHits');
        $hydrateGroups->setAccessible(true);

        $this->assertSame(
            [$this->publicGroupId],
            $this->ids($hydrateGroups->invoke($service, $groupHits, (int) $this->outsider->id)),
        );
        $this->assertSame(
            [$this->privateGroupId, $this->publicGroupId],
            $this->ids($hydrateGroups->invoke($service, $groupHits, (int) $this->member->id)),
        );
    }

    private function assertNoJoinLinks(string $payload): void
    {
        $this->assertStringNotContainsString('meet.example.test', $payload);
        $this->assertStringNotContainsString('video.example.test', $payload);
    }

    /** @param list<array<string,mixed>> $rows @return list<int> */
    private function ids(array $rows): array
    {
        return array_values(array_map(
            static fn (array $row): int => (int) ($row['id'] ?? 0),
            $rows,
        ));
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ], $overrides));
    }

    private function group(string $visibility): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => ucfirst($visibility) . ' circle for ' . $this->term,
            'description' => 'Meets at 12 Private Lane. ' . $this->term,
            'location' => '12 Private Lane',
            'visibility' => $visibility,
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $this->addMember($groupId, $this->owner, 'owner');

        return $groupId;
    }

    private function addMember(int $groupId, User $user, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
        ]);
    }

    private function event(string $title, ?int $groupId): int
    {
        $slug = str_replace(' ', '-', $title);

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->owner->id,
            'group_id' => $groupId,
            'title' => $this->term . ' ' . $title,
            'description' => $this->term . ' ' . $title . ' description',
            'location' => 'Online',
            'is_online' => 1,
            'online_link' => 'https://meet.example.test/' . $slug,
            'video_url' => 'https://video.example.test/' . $slug,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'is_recurring_template' => 0,
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function listing(?string $moderationStatus): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->owner->id,
            'title' => $this->term . ' listing ' . ($moderationStatus ?? 'legacy'),
            'description' => 'Garden help',
            'type' => 'offer',
            'status' => 'active',
            'moderation_status' => $moderationStatus,
            'created_at' => now(),
        ]);
    }
}
