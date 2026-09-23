<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-081 (E-027) — "Profile visible to: my connections only"
 * (`users.privacy_profile = 'connections'`) was enforced on the profile page
 * alone. The member directory, nearby members, the member's listings
 * (/v2/users/{id}/listings) and their reviews (/v2/reviews/user/{id}) all
 * ignored it. Connected members, the owner and administrators keep access;
 * members who chose 'members' or 'public' are unaffected.
 */
class ProfileConnectionsOnlyTest extends TestCase
{
    use DatabaseTransactions;

    private float $lat;
    private float $lon;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
        // A point in open ocean, nudged per run so stale rows from a shared
        // database never sit in the same small radius.
        $this->lat = -47.0 + (mt_rand(0, 900) / 1000);
        $this->lon = -120.0 + (mt_rand(0, 900) / 1000);
    }

    // ------------------------------------------------------------------
    //  Directory
    // ------------------------------------------------------------------

    public function test_directory_hides_connections_only_member_from_unconnected_viewer(): void
    {
        [$private, $membersOnly] = [$this->member(['privacy_profile' => 'connections']), $this->member(['privacy_profile' => 'members'])];
        $stranger = $this->member();
        Sanctum::actingAs($stranger, ['*']);

        $ids = $this->directoryIds();

        $this->assertNotContains($private->id, $ids, 'A connections-only member must not be listed to a stranger.');
        $this->assertContains($membersOnly->id, $ids, "A 'members' profile is still listed to members.");
    }

    public function test_directory_still_lists_connections_only_member_to_connections_and_admins(): void
    {
        $private = $this->member(['privacy_profile' => 'connections']);
        $friend = $this->member();
        $this->connect($private, $friend);

        Sanctum::actingAs($friend, ['*']);
        $this->assertContains($private->id, $this->directoryIds());

        Sanctum::actingAs($this->member(['role' => 'admin']), ['*']);
        $this->assertContains($private->id, $this->directoryIds());
    }

    public function test_community_rank_directory_applies_the_same_rule(): void
    {
        $needle = 'Pco' . substr(md5(uniqid('', true)), 0, 8);
        $private = $this->member(['first_name' => $needle, 'privacy_profile' => 'connections']);
        $public = $this->member(['first_name' => $needle]);
        $friend = $this->member();
        $this->connect($private, $friend);
        $ranking = app(\App\Services\MemberRankingService::class);

        $strangerIds = array_column($ranking->rankMembers($this->testTenantId, 50, 0, $needle, $this->member()->id)['items'], 'user_id');
        $this->assertNotContains($private->id, array_map('intval', $strangerIds));
        $this->assertContains($public->id, array_map('intval', $strangerIds));

        $friendIds = array_column($ranking->rankMembers($this->testTenantId, 50, 0, $needle, $friend->id)['items'], 'user_id');
        $this->assertContains($private->id, array_map('intval', $friendIds));
    }

    // ------------------------------------------------------------------
    //  Nearby
    // ------------------------------------------------------------------

    public function test_nearby_hides_connections_only_member_from_unconnected_viewer(): void
    {
        $private = $this->member(['privacy_profile' => 'connections', 'latitude' => $this->lat, 'longitude' => $this->lon]);
        $public = $this->member(['latitude' => $this->lat, 'longitude' => $this->lon]);
        $friend = $this->member();
        $this->connect($private, $friend);

        Sanctum::actingAs($this->member(), ['*']);
        $ids = $this->nearbyIds();
        $this->assertNotContains($private->id, $ids);
        $this->assertContains($public->id, $ids);

        Sanctum::actingAs($friend, ['*']);
        $this->assertContains($private->id, $this->nearbyIds(), 'A connection still finds them nearby.');
    }

    // ------------------------------------------------------------------
    //  Listings by member
    // ------------------------------------------------------------------

    public function test_listings_by_connections_only_member_are_refused_to_unconnected_viewer(): void
    {
        $private = $this->member(['privacy_profile' => 'connections']);
        $listingId = $this->listing($private);

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet("/v2/users/{$private->id}/listings");

        $response->assertStatus(404);
        $this->assertStringNotContainsString('Private fixture listing', (string) $response->getContent());
        $this->assertNotContains($listingId, array_map('intval', array_column($response->json('data') ?? [], 'id')));
    }

    public function test_listings_by_connections_only_member_remain_visible_to_connection_owner_and_public_profiles(): void
    {
        $private = $this->member(['privacy_profile' => 'connections']);
        $listingId = $this->listing($private);
        $friend = $this->member();
        $this->connect($friend, $private);

        Sanctum::actingAs($friend, ['*']);
        $this->assertContains($listingId, $this->listingIds("/v2/users/{$private->id}/listings"));

        Sanctum::actingAs($private, ['*']);
        $this->assertContains($listingId, $this->listingIds('/v2/users/me/listings'));

        $public = $this->member();
        $publicListing = $this->listing($public);
        Sanctum::actingAs($this->member(), ['*']);
        $this->assertContains($publicListing, $this->listingIds("/v2/users/{$public->id}/listings"));
    }

    // ------------------------------------------------------------------
    //  Reviews of member
    // ------------------------------------------------------------------

    public function test_reviews_of_connections_only_member_are_refused_to_unconnected_viewer(): void
    {
        $private = $this->member(['privacy_profile' => 'connections']);
        $this->review($this->member(), $private, 'Private fixture review');

        Sanctum::actingAs($this->member(), ['*']);
        $response = $this->apiGet("/v2/reviews/user/{$private->id}");

        $response->assertStatus(404);
        $this->assertStringNotContainsString('Private fixture review', (string) $response->getContent());
    }

    public function test_reviews_of_connections_only_member_remain_visible_to_connection_and_owner(): void
    {
        $private = $this->member(['privacy_profile' => 'connections']);
        $friend = $this->member();
        $this->connect($private, $friend);
        $reviewId = $this->review($this->member(), $private, 'Visible fixture review');

        Sanctum::actingAs($friend, ['*']);
        $this->assertContains($reviewId, $this->reviewIds($private->id));

        Sanctum::actingAs($private, ['*']);
        $this->assertContains($reviewId, $this->reviewIds($private->id));

        $public = $this->member();
        $publicReview = $this->review($this->member(), $public, 'Public fixture review');
        Sanctum::actingAs($this->member(), ['*']);
        $this->assertContains($publicReview, $this->reviewIds($public->id));
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    /** @return list<int> */
    private function directoryIds(): array
    {
        $response = $this->apiGet('/v2/users?sort=joined&order=DESC&limit=100')->assertStatus(200);

        return array_map('intval', array_column($response->json('data') ?? [], 'id'));
    }

    /** @return list<int> */
    private function nearbyIds(): array
    {
        $response = $this->apiGet("/v2/members/nearby?lat={$this->lat}&lon={$this->lon}&radius_km=5&limit=100")->assertStatus(200);

        return array_map('intval', array_column($response->json('data') ?? [], 'id'));
    }

    /** @return list<int> */
    private function listingIds(string $uri): array
    {
        $response = $this->apiGet($uri)->assertStatus(200);

        return array_map('intval', array_column($response->json('data') ?? [], 'id'));
    }

    /** @return list<int> */
    private function reviewIds(int $userId): array
    {
        $response = $this->apiGet("/v2/reviews/user/{$userId}")->assertStatus(200);

        return array_map('intval', array_column($response->json('data') ?? [], 'id'));
    }

    private function listing(User $owner): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner->id,
            'title' => 'Private fixture listing ' . $owner->id,
            'description' => 'Fixture',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function review(User $reviewer, User $receiver, string $comment): int
    {
        return (int) DB::table('reviews')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'reviewer_id' => $reviewer->id,
            'receiver_id' => $receiver->id,
            'rating' => 5,
            'comment' => $comment,
            'status' => 'approved',
            'created_at' => now(),
        ]);
    }

    private function connect(User $a, User $b): void
    {
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $a->id,
            'receiver_id' => $b->id,
            'status' => 'accepted',
            'created_at' => now(),
        ]);
    }

    /** @param array<string, mixed> $overrides */
    private function member(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_active' => 1,
            'is_approved' => true,
            'privacy_search' => 1,
            'privacy_profile' => 'public',
            'onboarding_completed' => 1,
            'avatar_url' => '/uploads/test/connections-only-avatar.png',
            'bio' => 'Connections-only privacy fixture.',
            'created_at' => now(),
        ], $overrides));
        TenantContext::setById($this->testTenantId);

        return $user;
    }
}
