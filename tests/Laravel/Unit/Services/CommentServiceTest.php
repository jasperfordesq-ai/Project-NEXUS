<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\CommentService;
use App\Models\Comment;
use Illuminate\Support\Facades\DB;
use Mockery;

class CommentServiceTest extends TestCase
{
    public function test_countAll_counts_nested_comments(): void
    {
        $comments = [
            ['replies' => [
                ['replies' => []],
                ['replies' => [
                    ['replies' => []],
                ]],
            ]],
            ['replies' => []],
        ];

        $this->assertSame(5, CommentService::countAll($comments));
    }

    public function test_countAll_returns_zero_for_empty_array(): void
    {
        $this->assertSame(0, CommentService::countAll([]));
    }

    public function test_getAvailableReactions_returns_array(): void
    {
        $reactions = CommentService::getAvailableReactions();
        $this->assertIsArray($reactions);
        $this->assertNotEmpty($reactions);
    }

    public function test_getErrors_returns_empty_array(): void
    {
        $this->assertSame([], CommentService::getErrors());
    }

    public function test_create_creates_comment(): void
    {
        $this->markTestIncomplete('Requires integration test — Eloquent models cannot use shouldReceive()');
    }

    public function test_update_returns_false_when_not_owner(): void
    {
        $this->markTestIncomplete('Requires integration test — Eloquent models cannot use shouldReceive()');
    }

    public function test_delete_returns_false_when_not_owner(): void
    {
        $this->markTestIncomplete('Requires integration test — Eloquent models cannot use shouldReceive()');
    }

    public function test_addComment_returns_error_when_content_empty(): void
    {
        $result = CommentService::addComment(1, 2, 'post', 1, '   ');
        $this->assertFalse($result['success']);
        $this->assertSame('Comment cannot be empty', $result['error']);
    }

    public function test_addComment_returns_error_when_parent_not_found(): void
    {
        // addComment now runs a targetIsCommentableAndVisible() guard before the
        // parent-existence check, so a real viewable target must exist for the
        // parent branch to be reached. Seed a public feed_post in the test tenant.
        \App\Core\TenantContext::setById(2);

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Comment Author',
            'email' => 'comment-author-' . uniqid() . '@example.com',
            'password' => bcrypt('secret'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $userId,
            'content' => 'A public post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            // parentId 999999 does not exist → parent-not-found branch
            $result = CommentService::addComment($userId, 2, 'post', $postId, 'Reply', 999999);
            $this->assertFalse($result['success']);
            $this->assertSame('Parent comment not found', $result['error']);
        } finally {
            DB::table('feed_posts')->where('id', $postId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }

    public function test_deleteComment_returns_error_when_not_found(): void
    {
        DB::shouldReceive('table')->with('comments')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturnNull();

        $result = CommentService::deleteComment(999, 1);
        $this->assertFalse($result['success']);
    }

    public function test_deleteComment_returns_error_when_unauthorized(): void
    {
        DB::shouldReceive('table')->with('comments')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['id' => 1, 'user_id' => 5]);

        $result = CommentService::deleteComment(1, 999);
        $this->assertFalse($result['success']);
        $this->assertSame('Unauthorized', $result['error']);
    }

    public function test_editComment_returns_error_when_content_empty(): void
    {
        $result = CommentService::editComment(1, 1, '  ');
        $this->assertFalse($result['success']);
    }

    public function test_toggleReaction_adds_reaction(): void
    {
        // toggleReaction now runs a FeedItemTables::canView('comment', ...) guard
        // before mutating the unified 'reactions' table, so a real comment whose
        // target post is viewable must exist. Seed user + public post + comment.
        \App\Core\TenantContext::setById(2);

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => 2,
            'name' => 'Reactor',
            'email' => 'reactor-' . uniqid() . '@example.com',
            'password' => bcrypt('secret'),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $postId = DB::table('feed_posts')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $userId,
            'content' => 'A public post',
            'visibility' => 'public',
            'publish_status' => 'published',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $commentId = DB::table('comments')->insertGetId([
            'tenant_id' => 2,
            'user_id' => $userId,
            'target_type' => 'post',
            'target_id' => $postId,
            'content' => 'A comment',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        try {
            $result = CommentService::toggleReaction($userId, 2, $commentId, 'like');
            $this->assertSame('added', $result['action']);
        } finally {
            DB::table('reactions')->where('target_type', 'comment')->where('target_id', $commentId)->delete();
            DB::table('comments')->where('id', $commentId)->delete();
            DB::table('feed_posts')->where('id', $postId)->delete();
            DB::table('users')->where('id', $userId)->delete();
        }
    }

    public function test_searchUsersForMention_returns_array(): void
    {
        // Runs against the real query builder: the search now applies
        // MemberDirectoryVisibility (F-080), which needs a real Builder.
        $result = CommentService::searchUsersForMention('zz-no-such-member-' . uniqid(), 2);
        $this->assertIsArray($result);
        $this->assertSame([], $result);
    }
}
