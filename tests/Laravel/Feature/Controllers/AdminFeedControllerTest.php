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
 * Feature tests for AdminFeedController.
 *
 * Covers index (listing feed posts), show, hide, destroy, and stats.
 */
class AdminFeedControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function createFeedActivity(int $userId, int $tenantId): int
    {
        // Use a unique source_id to avoid uq_tenant_source constraint violations
        $sourceId = random_int(100000, 999999);
        return DB::table('feed_activity')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'source_type' => 'post',
            'source_id' => $sourceId,
            'title' => 'Test Feed Post',
            'content' => 'This is test feed content',
            'is_hidden' => 0,
            'is_visible' => 1,
            'created_at' => now(),
        ]);
    }

    // ================================================================
    // INDEX — GET /v2/admin/feed/posts
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/feed/posts');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'meta']);
    }

    public function test_index_returns_correct_data_structure_with_posts(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->createFeedActivity($admin->id, $this->testTenantId);

        $response = $this->apiGet('/v2/admin/feed/posts');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                '*' => [
                    'id', 'activity_id', 'user_id', 'tenant_id', 'user_name',
                    'type', 'content', 'is_hidden', 'created_at',
                ],
            ],
            'meta',
        ]);
    }

    /**
     * A poll or goal has a title but often no body. The moderation list must
     * carry the title, or those rows show an empty content cell and the
     * moderator cannot tell what they are hiding or deleting.
     */
    public function test_index_returns_the_title_so_untitled_bodies_are_not_blank(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $sourceId = random_int(100000, 999999);
        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId, 'user_id' => $admin->id,
            'source_type' => 'poll', 'source_id' => $sourceId,
            'title' => 'Which day suits the garden club?', 'content' => null,
            'is_hidden' => 0, 'is_visible' => 1, 'created_at' => now(),
        ]);

        $row = collect($this->apiGet('/v2/admin/feed/posts?type=poll')->assertStatus(200)->json('data'))
            ->firstWhere('id', $sourceId);

        $this->assertNotNull($row);
        $this->assertSame('Which day suits the garden club?', $row['title'] ?? null);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/feed/posts');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/feed/posts');

        $response->assertStatus(401);
    }

    // ================================================================
    // SHOW — GET /v2/admin/feed/posts/{id}
    // ================================================================

    public function test_show_returns_feed_post_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Create a feed_posts row to match the source_id in feed_activity. Use
        // the id just created: reading "the first post in the tenant" picked up
        // rows left in the shared test database and collided on uq_tenant_source.
        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'content' => 'Test feed post',
            'is_hidden' => 0,
            'created_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'source_type' => 'post',
            'source_id' => $postId,
            'content' => 'Test feed post',
            'is_hidden' => 0,
            'is_visible' => 1,
            'created_at' => now(),
        ]);

        $response = $this->apiGet("/v2/admin/feed/posts/{$postId}");

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['id', 'activity_id', 'user_id', 'tenant_id', 'content', 'type', 'created_at'],
        ]);
    }

    public function test_show_returns_404_for_nonexistent_post(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/feed/posts/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // HIDE — POST /v2/admin/feed/posts/{id}/hide
    // ================================================================

    public function test_hide_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/feed/posts/1/hide');

        $response->assertStatus(403);
    }

    public function test_hide_returns_404_for_nonexistent_post(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/feed/posts/999999/hide');

        $response->assertStatus(404);
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/feed/posts/{id}
    // ================================================================

    public function test_destroy_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/feed/posts/1');

        $response->assertStatus(403);
    }

    public function test_destroy_returns_404_for_nonexistent_post(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/feed/posts/999999');

        $response->assertStatus(404);
    }

    public function test_destroy_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiDelete('/v2/admin/feed/posts/1');

        $response->assertStatus(401);
    }

    /**
     * The success path had no coverage — this is the exact scenario the owner
     * reported failing (admin deleting another member's post). Asserts the
     * feed_activity row is gone and the moderation action is audit-logged.
     */
    public function test_destroy_successfully_deletes_another_members_post(): void
    {
        $admin  = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($admin);

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $member->id,
            'content'    => 'A member post an admin should be able to remove',
            'is_hidden'  => 0,
            'created_at' => now(),
        ]);

        DB::table('feed_activity')->insert([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $member->id,
            'source_type' => 'post',
            'source_id'   => $postId,
            'content'     => 'A member post an admin should be able to remove',
            'is_hidden'   => 0,
            'is_visible'  => 1,
            'created_at'  => now(),
        ]);

        $response = $this->apiDelete("/v2/admin/feed/posts/{$postId}?type=post");

        $response->assertStatus(200);

        $this->assertDatabaseMissing('feed_activity', [
            'tenant_id'   => $this->testTenantId,
            'source_type' => 'post',
            'source_id'   => $postId,
        ]);

        $this->assertTrue(
            DB::table('activity_log')->where('action', 'delete_feed_item')->exists(),
            'Expected a delete_feed_item audit-log row after a successful admin delete'
        );
    }

    // ================================================================
    // STATS — GET /v2/admin/feed/stats
    // ================================================================

    public function test_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/feed/stats');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['total', 'hidden', 'total_comments'],
        ]);
    }

    public function test_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/feed/stats');

        $response->assertStatus(403);
    }

    public function test_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/feed/stats');

        $response->assertStatus(401);
    }
}
