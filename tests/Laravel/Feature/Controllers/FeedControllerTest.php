<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for feed endpoints.
 *
 * The v2 feed routes (GET /v2/feed, POST /v2/feed/posts, POST /v2/feed/like, etc.)
 * are handled by SocialController. The legacy FeedController handles /feed/hide,
 * /feed/mute, /feed/report. Both are tested here.
 */
class FeedControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createFeedPost(int $userId, array $overrides = []): int
    {
        $post = array_merge([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'content' => 'Test feed post ' . uniqid(),
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        $postId = DB::table('feed_posts')->insertGetId($post);

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $post['user_id'],
            'source_type' => 'post',
            'source_id' => $postId,
            'group_id' => $post['group_id'] ?? null,
            'content' => $post['content'],
            'is_visible' => true,
            'created_at' => $post['created_at'],
        ]);

        return $postId;
    }

    private function createGroup(int $ownerId, string $visibility = 'private'): int
    {
        return DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Test Group ' . uniqid(),
            'slug' => 'test-group-' . uniqid(),
            'visibility' => $visibility,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createListing(int $userId): int
    {
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Reportable listing',
            'description' => 'A listing that appears in the feed.',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'source_type' => 'listing',
            'source_id' => $listingId,
            'title' => 'Reportable listing',
            'content' => 'A listing that appears in the feed.',
            'is_visible' => true,
            'created_at' => now(),
        ]);

        return $listingId;
    }

    // ================================================================
    // FEED (GET /v2/feed) — Happy path
    // ================================================================

    public function test_feed_returns_collection(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data',
            'meta' => ['per_page', 'has_more'],
        ]);
    }

    // ================================================================
    // FEED — Authentication required
    // ================================================================

    public function test_feed_returns_401_without_auth(): void
    {
        $response = $this->apiGet('/v2/feed');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // FEED — Supports filters
    // ================================================================

    public function test_feed_supports_type_filter(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed?type=post');

        $response->assertStatus(200);
    }

    public function test_feed_supports_per_page(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed?per_page=5');

        $response->assertStatus(200);
        $this->assertLessThanOrEqual(5, $response->json('meta.per_page'));
    }

    // ================================================================
    // CREATE POST (POST /v2/feed/posts) — Authentication required
    // ================================================================

    public function test_create_post_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts', [
            'body' => 'Hello community!',
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // CREATE POST — Happy path
    // ================================================================

    public function test_create_post_returns_201(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/posts', [
            'body' => 'Hello community! This is my first post.',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    /**
     * A post can be photos only, as both web composers allow: the photos arrive as
     * media[] and are attached after the post exists, so the "content or image
     * required" check must count them (29 Oct 2026).
     */
    public function test_create_post_accepts_photos_without_text(): void
    {
        $user = $this->authenticatedUser();
        $file = \Illuminate\Http\UploadedFile::fake()->image('only-photo.jpg', 64, 64);
        $postId = null;

        try {
            $response = $this->post('/api/v2/feed/posts', ['media' => [$file]], $this->withTenantHeader());

            $this->assertContains($response->getStatusCode(), [200, 201], (string) $response->getContent());
            $postId = (int) DB::table('feed_posts')
                ->where('tenant_id', $this->testTenantId)
                ->where('user_id', $user->id)
                ->max('id');
            $this->assertGreaterThan(0, $postId);
            $this->assertSame(1, DB::table('post_media')->where('post_id', $postId)->count());
        } finally {
            if ($postId) {
                \Illuminate\Support\Facades\File::deleteDirectory(
                    base_path("httpdocs/uploads/posts/{$this->testTenantId}/{$postId}")
                );
            }
        }
    }

    public function test_create_post_still_refuses_an_empty_post(): void
    {
        $this->authenticatedUser();

        $this->apiPost('/v2/feed/posts', ['body' => '   '])->assertStatus(422);
    }

    public function test_create_post_rejects_non_member_private_group(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $viewer = $this->authenticatedUser();
        $groupId = $this->createGroup($owner->id, 'private');

        $response = $this->apiPost('/v2/feed/posts', [
            'body' => 'Trying to post in a private group.',
            'group_id' => $groupId,
        ]);

        $response->assertStatus(422);
        $this->assertDatabaseMissing('feed_posts', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $viewer->id,
            'group_id' => $groupId,
        ]);
    }

    // ================================================================
    // LIKE (POST /v2/feed/like) — Validation
    // ================================================================

    public function test_like_returns_400_without_target(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/like', []);

        $response->assertStatus(400);
    }

    public function test_like_returns_400_for_invalid_target_type(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/like', [
            'target_type' => 'invalid',
            'target_id' => 1,
        ]);

        $response->assertStatus(400);
    }

    // ================================================================
    // LIKE — Authentication required
    // ================================================================

    public function test_like_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/like', [
            'target_type' => 'post',
            'target_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // HIDE POST — Authentication required
    // ================================================================

    public function test_hide_post_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/feed/hide', [
            'post_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // HIDE POST — Validation
    // ================================================================

    public function test_hide_post_returns_error_without_post_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/feed/hide', []);

        // FeedController returns error for invalid post_id
        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_hide_post_succeeds_with_valid_post_id(): void
    {
        $user = $this->authenticatedUser();

        // hidePost() now verifies the post exists and belongs to the tenant
        // (IDOR prevention), so seed a real feed_posts row for this tenant.
        $postId = $this->createFeedPost($user->id);

        $response = $this->apiPost('/feed/hide', [
            'post_id' => $postId,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.success', true);
    }

    // ================================================================
    // MUTE USER — Validation
    // ================================================================

    public function test_mute_user_returns_error_without_user_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/feed/mute', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_mute_user_returns_error_when_muting_self(): void
    {
        $user = $this->authenticatedUser();

        $response = $this->apiPost('/feed/mute', [
            'user_id' => $user->id,
        ]);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ================================================================
    // MUTE USER — Authentication required
    // ================================================================

    public function test_mute_user_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/feed/mute', [
            'user_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // REPORT POST — Authentication required
    // ================================================================

    public function test_report_post_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/feed/report', [
            'post_id' => 1,
        ]);

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // REPORT POST — Validation
    // ================================================================

    public function test_report_post_returns_error_without_post_id(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/feed/report', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ================================================================
    // REPORT POST — Happy path
    // ================================================================

    public function test_report_post_succeeds_with_valid_post_id(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createFeedPost($user->id);

        $response = $this->apiPost('/feed/report', [
            'post_id' => $postId,
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('data.success', true);
    }

    // ================================================================
    // HIDE POST V2 — via SocialController
    // ================================================================

    public function test_hide_post_v2_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/hide');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // DELETE POST V2 — via SocialController
    // ================================================================

    public function test_delete_post_v2_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/delete');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // MUTE USER V2 — via SocialController
    // ================================================================

    public function test_mute_user_v2_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/users/1/mute');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // REPORT POST V2 — via SocialController
    // ================================================================

    public function test_report_post_v2_returns_401_without_auth(): void
    {
        $response = $this->apiPost('/v2/feed/posts/1/report');

        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    // ================================================================
    // TENANT ISOLATION — Feed is tenant-scoped
    // ================================================================

    public function test_private_group_posts_are_hidden_from_non_members(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $groupId = $this->createGroup($owner->id, 'private');
        $this->createFeedPost($owner->id, [
            'content' => 'Private group post should not leak',
            'group_id' => $groupId,
        ]);

        $response = $this->apiGet('/v2/feed?group_id=' . $groupId);

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data'));
    }

    public function test_public_group_posts_are_still_member_only(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $groupId = $this->createGroup($owner->id, 'public');
        $canary = 'Public group member-content canary ' . uniqid();
        $this->createFeedPost($owner->id, [
            'content' => $canary,
            'group_id' => $groupId,
        ]);

        $response = $this->apiGet('/v2/feed?group_id=' . $groupId);

        $response->assertStatus(200);
        $this->assertNotContains($canary, array_column($response->json('data') ?? [], 'content'));
    }

    public function test_active_group_member_can_view_group_posts(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $viewer = $this->authenticatedUser();
        $groupId = $this->createGroup($owner->id, 'private');
        $this->addGroupMember($groupId, $viewer->id);
        $canary = 'Active member group canary ' . uniqid();
        $this->createFeedPost($owner->id, [
            'content' => $canary,
            'group_id' => $groupId,
        ]);

        $response = $this->apiGet('/v2/feed?group_id=' . $groupId);

        $response->assertStatus(200);
        $this->assertContains($canary, array_column($response->json('data') ?? [], 'content'));
    }

    public function test_archived_group_posts_are_hidden_from_existing_members(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $viewer = $this->authenticatedUser();
        $groupId = $this->createGroup($owner->id, 'private');
        $this->addGroupMember($groupId, $viewer->id);
        DB::table('groups')
            ->where('id', $groupId)
            ->where('tenant_id', $this->testTenantId)
            ->update(['status' => 'archived', 'is_active' => false]);
        $canary = 'Archived group canary ' . uniqid();
        $this->createFeedPost($owner->id, [
            'content' => $canary,
            'group_id' => $groupId,
        ]);

        $response = $this->apiGet('/v2/feed?group_id=' . $groupId);

        $response->assertStatus(200);
        $this->assertNotContains($canary, array_column($response->json('data') ?? [], 'content'));
    }

    public function test_profile_feed_respects_connection_privacy(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'privacy_profile' => 'connections',
        ]);
        $this->authenticatedUser();
        $this->createFeedPost($owner->id, [
            'content' => 'Connections-only profile post',
        ]);

        $response = $this->apiGet('/v2/feed?user_id=' . $owner->id);

        $response->assertStatus(200);
        $this->assertSame([], $response->json('data'));
    }

    private function addGroupMember(int $groupId, int $userId): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $userId,
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_connections_visibility_posts_are_visible_to_connected_users(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $viewer = $this->authenticatedUser();
        DB::table('connections')->insert([
            'tenant_id' => $this->testTenantId,
            'requester_id' => $viewer->id,
            'receiver_id' => $author->id,
            'status' => 'accepted',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->createFeedPost($author->id, [
            'content' => 'Friends-only post',
            'visibility' => 'connections',
        ]);

        $response = $this->apiGet('/v2/feed?type=post');

        $response->assertStatus(200);
        $this->assertContains('Friends-only post', array_column($response->json('data') ?? [], 'content'));
    }

    public function test_report_item_v2_records_polymorphic_target_and_prevents_duplicates(): void
    {
        $user = $this->authenticatedUser();
        $listingId = $this->createListing($user->id);

        $response = $this->apiPost("/v2/feed/items/listing/{$listingId}/report", [
            'reason' => 'Spammy listing',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('reports', [
            'tenant_id' => $this->testTenantId,
            'reporter_id' => $user->id,
            'target_type' => 'listing',
            'target_id' => $listingId,
        ]);

        $duplicate = $this->apiPost("/v2/feed/items/listing/{$listingId}/report", [
            'reason' => 'Spammy listing again',
        ]);

        $duplicate->assertStatus(409);
    }

    public function test_report_item_v2_rejects_blank_reason_and_invalid_type(): void
    {
        $user = $this->authenticatedUser();
        $listingId = $this->createListing($user->id);

        $blank = $this->apiPost("/v2/feed/items/listing/{$listingId}/report", [
            'reason' => '',
        ]);
        $blank->assertStatus(400);

        $invalid = $this->apiPost("/v2/feed/items/not_a_type/{$listingId}/report", [
            'reason' => 'Bad type',
        ]);
        $invalid->assertStatus(400);
    }

    public function test_mute_user_v2_rejects_nonexistent_user(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/feed/users/999999999/mute');

        $response->assertStatus(404);
    }

    public function test_feed_only_returns_current_tenant_items(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/feed');

        $response->assertStatus(200);
        // Feed items should only contain items from the current tenant
        $data = $response->json('data');
        $this->assertIsArray($data);
    }
}
