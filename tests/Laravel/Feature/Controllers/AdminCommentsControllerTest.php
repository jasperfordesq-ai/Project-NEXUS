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
 * Feature tests for AdminCommentsController.
 *
 * Covers listing, showing, hiding, and deleting comments.
 */
class AdminCommentsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function createComment(int $userId): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'target_type' => 'post',
            'target_id' => 1,
            'content' => 'Test comment content',
            'created_at' => now(),
        ]);
    }

    // ================================================================
    // INDEX — GET /v2/admin/comments
    // ================================================================

    public function test_index_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/comments');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data', 'meta']);
    }

    public function test_index_returns_correct_data_structure(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $this->createComment($admin->id);

        $response = $this->apiGet('/v2/admin/comments');

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => [
                '*' => ['id', 'user_id', 'tenant_id', 'user_name', 'target_type', 'target_id', 'content', 'created_at'],
            ],
            'meta',
        ]);
    }

    public function test_index_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/comments');

        $response->assertStatus(403);
    }

    public function test_index_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/comments');

        $response->assertStatus(401);
    }

    // ================================================================
    // SHOW — GET /v2/admin/comments/{id}
    // ================================================================

    public function test_show_returns_comment_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $commentId = $this->createComment($admin->id);

        $response = $this->apiGet("/v2/admin/comments/{$commentId}");

        $response->assertStatus(200);
        $response->assertJsonStructure([
            'data' => ['id', 'user_id', 'tenant_id', 'content', 'target_type', 'target_id', 'created_at'],
        ]);
    }

    public function test_show_returns_404_for_nonexistent_comment(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/comments/999999');

        $response->assertStatus(404);
    }

    // ================================================================
    // HIDE — POST /v2/admin/comments/{id}/hide
    // ================================================================

    public function test_hide_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $commentId = $this->createComment($admin->id);

        $response = $this->apiPost("/v2/admin/comments/{$commentId}/hide");

        $response->assertStatus(200);
        $response->assertJsonPath('data.success', true);
    }

    /**
     * F-220: hiding used to write a feed_hidden row keyed to the moderator's
     * own user_id, so the comment vanished for the moderator only and every
     * member could still read it.
     */
    public function test_hide_removes_comment_for_other_members(): void
    {
        $author = User::factory()->forTenant($this->testTenantId)->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'content' => 'F-220 target post ' . uniqid(),
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $marker = 'F-220 harmful comment ' . uniqid();
        $commentId = DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $author->id,
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => $marker,
            'created_at' => now(),
        ]);

        // Control: before the hide, an ordinary member can read the comment.
        Sanctum::actingAs($member);
        $this->apiGet("/v2/comments?target_type=post&target_id={$postId}")
            ->assertStatus(200)
            ->assertSee($marker);

        Sanctum::actingAs($admin);
        $this->apiPost("/v2/admin/comments/{$commentId}/hide")->assertStatus(200);

        Sanctum::actingAs($member);
        $this->apiGet("/v2/comments?target_type=post&target_id={$postId}")
            ->assertStatus(200)
            ->assertDontSee($marker);
    }

    public function test_hide_returns_404_for_nonexistent_comment(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/comments/999999/hide');

        $response->assertStatus(404);
    }

    public function test_hide_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/comments/1/hide');

        $response->assertStatus(403);
    }

    // ================================================================
    // DELETE — DELETE /v2/admin/comments/{id}
    // ================================================================

    public function test_destroy_deletes_comment_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $commentId = $this->createComment($admin->id);

        $response = $this->apiDelete("/v2/admin/comments/{$commentId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.success', true);
    }

    public function test_destroy_returns_404_for_nonexistent_comment(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiDelete('/v2/admin/comments/999999');

        $response->assertStatus(404);
    }

    public function test_destroy_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiDelete('/v2/admin/comments/1');

        $response->assertStatus(403);
    }
}
