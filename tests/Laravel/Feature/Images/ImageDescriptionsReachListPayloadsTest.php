<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Images;

use App\Core\TenantContext;
use App\Models\Event;
use App\Models\User;
use App\Services\FeedActivityService;
use App\Services\GroupInviteService;
use App\Services\GroupMatchingService;
use App\Services\GroupRecommendationEngine;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Members can describe their photos for screen-reader users (listings.image_alt,
 * events.image_alt, groups.image_alt). The detail pages read those descriptions,
 * but several LIST payloads never carried them, so every card, widget and feed
 * item fell back to a generic label (AWID accessibility report, Nov 2026).
 *
 * Each test seeds a written description and asserts it reaches the list payload
 * the clients render from. Only the alt field is added — nothing else.
 */
class ImageDescriptionsReachListPayloadsTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->app['auth']->forgetGuards();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
    }

    private function signIn(): User
    {
        $user = $this->member();
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    /** @param array<string, mixed> $overrides */
    private function group(int $ownerId, array $overrides = []): int
    {
        return (int) DB::table('groups')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Allotment Friends ' . Str::random(6),
            'slug' => 'allotment-' . Str::lower(Str::random(10)),
            'description' => 'Growing food together.',
            'visibility' => 'public',
            'is_active' => 1,
            'status' => 'active',
            'image_url' => '/uploads/groups/avatar.jpg',
            'image_alt' => 'Three people planting leeks in a raised bed',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    /** Push a group up the "most members" rankings (the test database has none). */
    private function giveMembers(int $groupId, int $count): void
    {
        $rows = [];
        foreach (User::factory()->forTenant($this->testTenantId)->count($count)->create() as $user) {
            $rows[] = [
                'tenant_id' => $this->testTenantId,
                'group_id' => $groupId,
                'user_id' => $user->id,
                'role' => 'member',
                'status' => 'active',
                'created_at' => now(),
                'updated_at' => now(),
            ];
        }
        DB::table('group_members')->insert($rows);
    }

    /** @param array<string, mixed> $overrides */
    private function listing(int $userId, array $overrides = []): int
    {
        return (int) DB::table('listings')->insertGetId(array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Help with a vegetable patch',
            'description' => 'I can help you dig, plant and weed a vegetable patch this spring.',
            'type' => 'offer',
            'status' => 'active',
            'image_url' => '/uploads/listings/patch.jpg',
            'image_alt' => 'A freshly dug vegetable patch with a fork leaning on a wheelbarrow',
            'view_count' => 900000,
            'save_count' => 900000,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    private function event(int $organiserId, ?string $description): Event
    {
        $event = new Event([
            'user_id' => $organiserId,
            'title' => 'Seed swap',
            'description' => 'Bring seeds, take seeds.',
            'location' => 'Community hall',
            'start_time' => now()->addMinutes(5),
            'end_time' => now()->addHours(3),
            'cover_image' => '/uploads/events/seeds.jpg',
            'image_url' => '/uploads/events/seeds.jpg',
            'is_public_listing' => true,
        ]);
        $event->tenant_id = $this->testTenantId;
        $event->status = 'active';
        $event->image_alt = $description;
        $event->save();

        return $event;
    }

    // ── Feed ────────────────────────────────────────────────────────────

    public function test_feed_listing_and_event_items_carry_their_image_description(): void
    {
        $viewer = $this->signIn();
        $author = $this->member();

        $listingId = $this->listing((int) $author->id);
        $event = $this->event((int) $author->id, 'Paper envelopes of seeds spread on a trestle table');
        $quietEvent = $this->event((int) $author->id, null);

        $activity = app(FeedActivityService::class);
        $activity->recordActivity($this->testTenantId, (int) $author->id, 'listing', $listingId, [
            'title' => 'Help with a vegetable patch',
            'content' => 'I can help you dig.',
            'image_url' => '/uploads/listings/patch.jpg',
        ]);
        foreach ([$event, $quietEvent] as $row) {
            $activity->recordActivity($this->testTenantId, (int) $author->id, 'event', (int) $row->id, [
                'title' => 'Seed swap',
                'content' => 'Bring seeds, take seeds.',
                'image_url' => '/uploads/events/seeds.jpg',
                'metadata' => ['start_date' => (string) $row->start_time],
            ]);
        }

        $items = collect($this->apiGet('/v2/feed?per_page=50')->assertOk()->json('data'));

        $listingItem = $items->first(fn ($i) => $i['type'] === 'listing' && (int) $i['id'] === $listingId);
        $eventItem = $items->first(fn ($i) => $i['type'] === 'event' && (int) $i['id'] === (int) $event->id);
        $quietItem = $items->first(fn ($i) => $i['type'] === 'event' && (int) $i['id'] === (int) $quietEvent->id);

        $this->assertNotNull($listingItem, 'the seeded listing must be in the feed before its alt is trusted');
        $this->assertNotNull($eventItem);
        $this->assertNotNull($quietItem);
        $this->assertSame('A freshly dug vegetable patch with a fork leaning on a wheelbarrow', $listingItem['image_alt']);
        $this->assertSame('Paper envelopes of seeds spread on a trestle table', $eventItem['image_alt']);
        $this->assertArrayHasKey('image_alt', $quietItem);
        $this->assertNull($quietItem['image_alt'], 'no description means null, never the title or a file name');
        unset($viewer);
    }

    // ── Explore ─────────────────────────────────────────────────────────

    public function test_explore_cards_carry_listing_group_and_event_image_descriptions(): void
    {
        $viewer = $this->signIn();
        $listingId = $this->listing((int) $viewer->id);
        $groupId = $this->group((int) $viewer->id);
        $this->giveMembers($groupId, 5);
        $event = $this->event((int) $viewer->id, 'Paper envelopes of seeds spread on a trestle table');

        $data = $this->apiGet('/v2/explore')->assertOk()->json('data');

        $listing = collect($data['popular_listings'])->firstWhere('id', $listingId);
        $group = collect($data['active_groups'])->firstWhere('id', $groupId);
        $upcoming = collect($data['upcoming_events'])->firstWhere('id', (int) $event->id);

        $this->assertNotNull($listing, 'the seeded listing must rank as popular');
        $this->assertNotNull($group, 'the seeded group must rank as active');
        $this->assertNotNull($upcoming, 'the seeded event must be upcoming');
        $this->assertSame('A freshly dug vegetable patch with a fork leaning on a wheelbarrow', $listing['image_alt']);
        $this->assertSame('Three people planting leeks in a raised bed', $group['image_alt']);
        $this->assertSame('Paper envelopes of seeds spread on a trestle table', $upcoming['image_alt']);
    }

    // ── Groups ──────────────────────────────────────────────────────────

    public function test_sub_groups_on_a_group_page_carry_their_picture_description(): void
    {
        $viewer = $this->signIn();
        $parentId = $this->group((int) $viewer->id);
        $childId = $this->group((int) $viewer->id, [
            'parent_id' => $parentId,
            'name' => 'Leek growers',
            'image_alt' => 'A row of leeks in frost',
        ]);

        $subGroups = $this->apiGet("/v2/groups/{$parentId}")->assertOk()->json('data.sub_groups');
        $child = collect($subGroups)->firstWhere('id', $childId);

        $this->assertNotNull($child);
        $this->assertSame('A row of leeks in frost', $child['image_alt']);
    }

    public function test_feed_sidebar_popular_groups_carry_their_picture_description(): void
    {
        $viewer = $this->signIn();
        $groupId = $this->group((int) $viewer->id);
        $this->giveMembers($groupId, 5);

        $popular = $this->apiGet('/v2/feed/sidebar')->assertOk()->json('data.popular_groups');
        $group = collect($popular)->first(fn ($g) => (int) $g['id'] === $groupId);

        $this->assertNotNull($group, 'the seeded group must be the most popular');
        $this->assertSame('Three people planting leeks in a raised bed', $group['image_alt']);
    }

    public function test_group_invite_preview_carries_the_group_picture_description(): void
    {
        $owner = $this->member();
        $invitee = $this->member();
        $groupId = $this->group((int) $owner->id);
        $token = substr(hash('sha256', 'alt-invite-' . Str::random(12)), 0, 40);
        DB::table('group_invites')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'invited_by' => $owner->id,
            'invite_type' => 'link',
            'email' => null,
            'token' => $token,
            'status' => GroupInviteService::STATUS_PENDING,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $preview = app(GroupInviteService::class)->previewInvite($token, (int) $invitee->id);

        $this->assertIsArray($preview);
        $this->assertSame('Three people planting leeks in a raised bed', $preview['group']['image_alt']);
    }

    public function test_recommended_groups_carry_their_picture_description_on_both_paths(): void
    {
        $viewer = $this->member();
        $groupId = $this->group((int) $viewer->id);

        // Warm cache path: the row comes from group_match_cache joined to groups.
        DB::table('group_match_cache')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $viewer->id,
            'group_id' => $groupId,
            'match_score' => 88,
            'match_reasons' => json_encode(['Near you']),
            'status' => 'new',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
        ]);
        $engine = Mockery::mock(GroupRecommendationEngine::class);
        $cached = (new GroupMatchingService($engine))->getMatchesForUser((int) $viewer->id, 30, 10);
        $match = collect($cached)->firstWhere('group_id', $groupId);
        $this->assertNotNull($match, 'the cached match must be served');
        $this->assertSame('Three people planting leeks in a raised bed', $match['image_alt']);

        // Cold cache path: live recommendations return whole group rows.
        DB::table('group_match_cache')->where('tenant_id', $this->testTenantId)->where('user_id', $viewer->id)->delete();
        $live = Mockery::mock(GroupRecommendationEngine::class);
        $live->shouldReceive('getRecommendations')->andReturn([[
            'id' => $groupId,
            'name' => 'Allotment Friends',
            'description' => '',
            'image_url' => '/uploads/groups/avatar.jpg',
            'image_alt' => 'Three people planting leeks in a raised bed',
            'visibility' => 'public',
            'member_count' => 4,
            'recommendation_score' => 0.9,
            'recommendation_reason' => 'Near you',
        ]]);
        $computed = (new GroupMatchingService($live))->getMatchesForUser((int) $viewer->id, 30, 10);
        $this->assertSame('Three people planting leeks in a raised bed', $computed[0]['image_alt'] ?? null);
    }
}
