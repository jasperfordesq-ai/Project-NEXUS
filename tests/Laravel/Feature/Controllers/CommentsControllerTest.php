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
 * Feature tests for CommentsController — CRUD and reactions on comments.
 */
class CommentsControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function createPost(int $userId): int
    {
        return DB::table('feed_posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'content' => 'Comment target post ' . uniqid(),
            'type' => 'post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createListing(int $userId): int
    {
        return DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Comment target listing ' . uniqid(),
            'description' => 'A listing with social comments.',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createBlogPost(int $userId): int
    {
        return DB::table('posts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'author_id' => $userId,
            'title' => 'Comment target blog post ' . uniqid(),
            'slug' => 'comment-target-blog-post-' . uniqid(),
            'content' => 'A blog article with social comments.',
            'status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createResource(int $userId): int
    {
        return DB::table('resources')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'title' => 'Comment target resource ' . uniqid(),
            'description' => 'A resource with social comments.',
            'file_path' => '/tmp/comment-target-resource.pdf',
            'created_at' => now(),
        ]);
    }

    private function createComment(int $postId, int $userId): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $userId,
            'content' => 'Parent comment',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createReply(int $postId, int $userId, int $parentId, string $content = 'Child comment'): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $userId,
            'parent_id' => $parentId,
            'content' => $content,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createTargetComment(string $targetType, int $targetId, int $userId, string $content = 'Parent comment'): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'user_id' => $userId,
            'content' => $content,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ------------------------------------------------------------------
    //  GET /v2/comments
    // ------------------------------------------------------------------

    public function test_index_requires_auth(): void
    {
        $response = $this->apiGet('/v2/comments');

        $response->assertStatus(401);
    }

    public function test_index_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiGet("/v2/comments?commentable_type=feed_post&commentable_id={$postId}");

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/comments
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/comments', [
            'commentable_type' => 'feed_post',
            'commentable_id' => 1,
            'body' => 'Great post!',
        ]);

        $response->assertStatus(401);
    }

    public function test_store_rejects_missing_target(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => 999999999,
            'content' => 'This should not attach to an arbitrary target.',
        ]);

        $response->assertStatus(404);
    }

    public function test_store_rejects_parent_comment_from_different_target(): void
    {
        $user = $this->authenticatedUser();
        $firstPostId = $this->createPost($user->id);
        $secondPostId = $this->createPost($user->id);
        $parentCommentId = $this->createComment($firstPostId, $user->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $secondPostId,
            'parent_id' => $parentCommentId,
            'content' => 'Reply should not cross targets.',
        ]);

        $response->assertStatus(422);
        $this->assertDatabaseMissing('comments', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $secondPostId,
            'parent_id' => $parentCommentId,
        ]);
    }

    public function test_store_creates_comment_for_visible_target(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'A useful reply',
        ]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.content', 'A useful reply');
        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'post',
            'target_id' => $postId,
            'user_id' => $user->id,
            'content' => 'A useful reply',
        ]);
    }

    public function test_store_accepts_blog_post_alias_as_unified_blog_target(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createBlogPost($user->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'blog_post',
            'target_id' => $postId,
            'content' => 'A useful blog comment',
        ]);

        $response->assertStatus(201);
        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'blog',
            'target_id' => $postId,
            'user_id' => $user->id,
            'content' => 'A useful blog comment',
        ]);
    }

    public function test_store_reply_notifies_parent_comment_author_and_content_owner(): void
    {
        $postOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $parentAuthor = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $postId = $this->createPost($postOwner->id);
        $parentCommentId = $this->createComment($postId, $parentAuthor->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'parent_id' => $parentCommentId,
            'content' => 'A direct reply',
        ]);

        $response->assertStatus(201);
        $replyId = (int) $response->json('data.id');

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $parentAuthor->id,
            'type' => 'comment_reply',
            'link' => "/feed/posts/{$postId}#comment-{$replyId}",
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $postOwner->id,
            'type' => 'comment',
            'link' => "/feed/posts/{$postId}#comment-{$replyId}",
        ]);
    }

    public function test_store_listing_reply_notifies_parent_comment_author_and_content_owner(): void
    {
        $listingOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $parentAuthor = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $listingId = $this->createListing($listingOwner->id);
        $parentCommentId = $this->createTargetComment('listing', $listingId, $parentAuthor->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'listing',
            'target_id' => $listingId,
            'parent_id' => $parentCommentId,
            'content' => 'A direct listing reply',
        ]);

        $response->assertStatus(201);
        $replyId = (int) $response->json('data.id');

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $parentAuthor->id,
            'type' => 'comment_reply',
            'link' => "/listings/{$listingId}#comment-{$replyId}",
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $listingOwner->id,
            'type' => 'comment',
            'link' => "/listings/{$listingId}#comment-{$replyId}",
        ]);
    }

    public function test_store_blog_reply_uses_slugged_comment_deep_link(): void
    {
        $blogOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $parentAuthor = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $postId = $this->createBlogPost($blogOwner->id);
        $slug = (string) DB::table('posts')->where('id', $postId)->value('slug');
        $parentCommentId = $this->createTargetComment('blog', $postId, $parentAuthor->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'blog_post',
            'target_id' => $postId,
            'parent_id' => $parentCommentId,
            'content' => 'A direct blog reply',
        ]);

        $response->assertStatus(201);
        $replyId = (int) $response->json('data.id');

        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $parentAuthor->id,
            'type' => 'comment_reply',
            'link' => "/blog/{$slug}#comment-{$replyId}",
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $blogOwner->id,
            'type' => 'comment',
            'link' => "/blog/{$slug}#comment-{$replyId}",
        ]);
    }

    public function test_store_resource_comment_notifies_content_owner(): void
    {
        $resourceOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $commenter = $this->authenticatedUser();
        $resourceId = $this->createResource($resourceOwner->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'resource',
            'target_id' => $resourceId,
            'content' => 'This resource is useful',
        ]);

        $response->assertStatus(201);
        $commentId = (int) $response->json('data.id');

        $this->assertDatabaseHas('comments', [
            'tenant_id' => $this->testTenantId,
            'target_type' => 'resource',
            'target_id' => $resourceId,
            'user_id' => $commenter->id,
        ]);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $resourceOwner->id,
            'type' => 'comment',
            'link' => "/resources/{$resourceId}#comment-{$commentId}",
        ]);
    }

    public function test_store_reply_does_not_duplicate_notification_when_parent_author_owns_post(): void
    {
        $postOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->authenticatedUser();
        $postId = $this->createPost($postOwner->id);
        $parentCommentId = $this->createComment($postId, $postOwner->id);

        $response = $this->apiPost('/v2/comments', [
            'target_type' => 'post',
            'target_id' => $postId,
            'parent_id' => $parentCommentId,
            'content' => 'A direct reply',
        ]);

        $response->assertStatus(201);

        $this->assertSame(1, DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $postOwner->id)
            ->whereIn('type', ['comment', 'comment_reply'])
            ->count());
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $postOwner->id,
            'type' => 'comment_reply',
        ]);
    }

    // ------------------------------------------------------------------
    //  PUT /v2/comments/{id}
    // ------------------------------------------------------------------

    public function test_update_requires_auth(): void
    {
        $response = $this->apiPut('/v2/comments/1', ['body' => 'Updated']);

        $response->assertStatus(401);
    }

    public function test_update_allows_owner_and_rejects_non_owner(): void
    {
        $owner = $this->authenticatedUser();
        $postId = $this->createPost($owner->id);
        $commentId = $this->createComment($postId, $owner->id);

        $this->apiPut("/v2/comments/{$commentId}", [
            'content' => 'Updated comment',
        ])->assertStatus(200);

        $this->assertDatabaseHas('comments', [
            'id' => $commentId,
            'tenant_id' => $this->testTenantId,
            'content' => 'Updated comment',
        ]);

        $other = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($other, ['*']);

        $this->apiPut("/v2/comments/{$commentId}", [
            'content' => 'Hijacked comment',
        ])->assertStatus(403);

        $this->assertDatabaseMissing('comments', [
            'id' => $commentId,
            'tenant_id' => $this->testTenantId,
            'content' => 'Hijacked comment',
        ]);
    }

    public function test_update_does_not_cross_tenant_even_when_user_id_matches(): void
    {
        $owner = $this->authenticatedUser();
        $foreignCommentId = DB::table('comments')->insertGetId([
            'tenant_id' => 999,
            'target_type' => 'post',
            'target_id' => 1,
            'user_id' => $owner->id,
            'content' => 'Foreign tenant comment',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->apiPut("/v2/comments/{$foreignCommentId}", [
            'content' => 'Cross-tenant edit attempt',
        ])->assertStatus(403);

        $this->assertDatabaseHas('comments', [
            'id' => $foreignCommentId,
            'tenant_id' => 999,
            'content' => 'Foreign tenant comment',
        ]);
    }

    public function test_update_returns_sanitized_stored_content(): void
    {
        $owner = $this->authenticatedUser();
        $postId = $this->createPost($owner->id);
        $commentId = $this->createComment($postId, $owner->id);

        $response = $this->apiPut("/v2/comments/{$commentId}", [
            'content' => '<strong>Edited</strong><script>alert("xss")</script>',
        ]);

        $response->assertStatus(200);

        $storedContent = (string) DB::table('comments')
            ->where('id', $commentId)
            ->where('tenant_id', $this->testTenantId)
            ->value('content');

        $this->assertSame($storedContent, $response->json('data.content'));
        $this->assertStringNotContainsString('<script', $storedContent);
        $this->assertStringNotContainsString('alert("xss")', $storedContent);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/comments/{id}
    // ------------------------------------------------------------------

    public function test_destroy_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/comments/1');

        $response->assertStatus(401);
    }

    public function test_destroy_soft_deletes_comment_thread_and_returns_deleted_count(): void
    {
        $user = $this->authenticatedUser();
        $postId = $this->createPost($user->id);
        $commentId = $this->createComment($postId, $user->id);
        $replyId = $this->createReply($postId, $user->id, $commentId);
        $nestedReplyId = $this->createReply($postId, $user->id, $replyId, 'Nested child comment');

        $response = $this->apiDelete("/v2/comments/{$commentId}");

        $response->assertStatus(200);
        $response->assertJsonPath('data.deleted', true);
        $response->assertJsonPath('data.deleted_count', 3);

        foreach ([$commentId, $replyId, $nestedReplyId] as $id) {
            $this->assertSoftDeleted('comments', [
                'id' => $id,
                'tenant_id' => $this->testTenantId,
            ]);
        }
    }

    // ------------------------------------------------------------------
    //  POST /v2/comments/{id}/reactions
    // ------------------------------------------------------------------

    public function test_reactions_requires_auth(): void
    {
        $response = $this->apiPost('/v2/comments/1/reactions', ['type' => 'like']);

        $response->assertStatus(401);
    }

    public function test_comment_reaction_notification_deep_links_to_comment(): void
    {
        $commentOwner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $reactor = $this->authenticatedUser();
        $postId = $this->createPost($reactor->id);
        $commentId = $this->createComment($postId, $commentOwner->id);

        $response = $this->apiPost("/v2/comments/{$commentId}/reactions", [
            'reaction_type' => 'love',
        ]);

        $response->assertStatus(200);
        $this->assertDatabaseHas('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $commentOwner->id,
            'type' => 'like',
            'link' => "/feed/posts/{$postId}#comment-{$commentId}",
        ]);
    }
}
