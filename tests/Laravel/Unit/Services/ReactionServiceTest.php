<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\ReactionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Unit tests for ReactionService — toggle, get reactions, get reactors,
 * and batch post reactions.
 *
 * The read-path methods (getReactions / getReactors / getReactionsForPosts)
 * are isolated from the database with Mockery DB facade expectations.
 *
 * The toggleReaction tests use real seeded rows (DatabaseTransactions) because
 * toggleReaction now calls FeedItemTables::canView() — a real DB visibility
 * check added 2026-05-05 — before touching the reactions table. That guard
 * cannot be satisfied under a fully-mocked DB facade, so those tests exercise
 * the service against a genuine (rolled-back) post/comment row.
 */
class ReactionServiceTest extends TestCase
{
    use DatabaseTransactions;

    private ReactionService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ReactionService();
    }

    /**
     * Register the DB::raw() pass-through used by the read-path mocks.
     * Only called by the mock-based tests — NOT by the toggleReaction tests,
     * which run against the real (transaction-wrapped) database.
     */
    private function mockDbRaw(): void
    {
        DB::shouldReceive('raw')->andReturnUsing(
            fn ($v) => new \Illuminate\Database\Query\Expression($v)
        );
    }

    /**
     * Mock the first-name lookup reactor lists now make for non-admin viewers
     * (F-084: MemberProfileVisibility::publicNames()).
     *
     * @param array<int, string> $firstNames id => first name
     */
    private function mockPublicNames(array $firstNames): void
    {
        DB::shouldReceive('table->where->whereIn->get')
            ->andReturn(collect(array_map(
                static fn (int $id, string $first) => (object) [
                    'id' => $id,
                    'first_name' => $first,
                    'profile_type' => 'individual',
                    'organization_name' => null,
                ],
                array_keys($firstNames),
                array_values($firstNames),
            )));
    }

    /**
     * Create a real, active user under the test tenant and return its id.
     * The feed_posts / reactions FK constraints require a genuine users row.
     * Re-pins the tenant context afterwards in case a model observer reset it.
     */
    private function seedUser(): int
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status'      => 'active',
            'is_approved' => true,
        ]);
        TenantContext::setById($this->testTenantId);

        return (int) $user->id;
    }

    /**
     * Seed a public, viewable feed_posts row so FeedItemTables::canView('post', …)
     * returns true. Returns the new post id.
     */
    private function seedViewablePost(int $authorId): int
    {
        return DB::table('feed_posts')->insertGetId([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $authorId,
            'content'    => 'Reaction service unit-test post',
            'type'       => 'post',
            'visibility' => 'public',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Seed a comment on a viewable post so FeedItemTables::canView('comment', …)
     * resolves (it recurses into the parent post's visibility). Returns comment id.
     */
    private function seedViewableComment(int $postId, int $authorId): int
    {
        return DB::table('comments')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'target_type' => 'post',
            'target_id'   => $postId,
            'user_id'     => $authorId,
            'content'     => 'Reaction service unit-test comment',
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);
    }

    // ======================================================================
    //  VALID_TYPES constant
    // ======================================================================

    public function test_valid_types_contains_all_expected_types(): void
    {
        $expected = ['love', 'like', 'laugh', 'wow', 'sad', 'celebrate', 'clap', 'time_credit'];
        $this->assertEquals($expected, ReactionService::VALID_TYPES);
    }

    public function test_valid_types_has_eight_entries(): void
    {
        $this->assertCount(8, ReactionService::VALID_TYPES);
    }

    // ======================================================================
    //  toggleReaction — add new
    // ======================================================================

    public function test_toggleReaction_adds_new_reaction(): void
    {
        $userId = $this->seedUser();
        $postId = $this->seedViewablePost($userId);

        $result = $this->service->toggleReaction($postId, 'post', 'love', $userId);

        $this->assertEquals('added', $result['action']);
        $this->assertEquals('love', $result['reaction_type']);
        $this->assertArrayHasKey('reactions', $result);
        $this->assertSame(1, $result['reactions']['counts']['love'] ?? null);
        $this->assertEquals('love', $result['reactions']['user_reaction']);

        // Row persisted under the test tenant.
        $this->assertTrue(
            DB::table('reactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('target_type', 'post')
                ->where('target_id', $postId)
                ->where('user_id', $userId)
                ->where('emoji', 'love')
                ->exists()
        );
    }

    public function test_toggleReaction_removes_same_type(): void
    {
        $userId = $this->seedUser();
        $postId = $this->seedViewablePost($userId);

        // First toggle adds it, second toggle of the same type removes it.
        $this->service->toggleReaction($postId, 'post', 'love', $userId);
        $result = $this->service->toggleReaction($postId, 'post', 'love', $userId);

        $this->assertEquals('removed', $result['action']);
        $this->assertNull($result['reaction_type']);
        $this->assertFalse(
            DB::table('reactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('target_type', 'post')
                ->where('target_id', $postId)
                ->where('user_id', $userId)
                ->exists()
        );
    }

    public function test_toggleReaction_updates_different_type(): void
    {
        $userId = $this->seedUser();
        $postId = $this->seedViewablePost($userId);

        // Existing 'love' reaction, then toggle to 'laugh' updates in place.
        $this->service->toggleReaction($postId, 'post', 'love', $userId);
        $result = $this->service->toggleReaction($postId, 'post', 'laugh', $userId);

        $this->assertEquals('updated', $result['action']);
        $this->assertEquals('laugh', $result['reaction_type']);

        // Exactly one row remains, now carrying the new emoji.
        $rows = DB::table('reactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('target_type', 'post')
            ->where('target_id', $postId)
            ->where('user_id', $userId)
            ->pluck('emoji')
            ->all();
        $this->assertSame(['laugh'], $rows);
    }

    public function test_toggleReaction_throws_for_invalid_entity_type(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid entity type: invalid');

        $this->service->toggleReaction(1, 'invalid', 'love', 5);
    }

    public function test_toggleReaction_works_for_comment_entity(): void
    {
        $userId = $this->seedUser();
        $postId = $this->seedViewablePost($userId);
        $commentId = $this->seedViewableComment($postId, $userId);

        $result = $this->service->toggleReaction($commentId, 'comment', 'clap', $userId);

        $this->assertEquals('added', $result['action']);
        $this->assertEquals('clap', $result['reaction_type']);
        $this->assertTrue(
            DB::table('reactions')
                ->where('tenant_id', $this->testTenantId)
                ->where('target_type', 'comment')
                ->where('target_id', $commentId)
                ->where('user_id', $userId)
                ->where('emoji', 'clap')
                ->exists()
        );
    }

    // ======================================================================
    //  getReactions
    // ======================================================================

    public function test_getReactions_returns_counts_and_user_reaction(): void
    {
        $viewerId = $this->seedUser();
        $this->mockDbRaw();
        $this->mockPublicNames([1 => 'User', 2 => 'User']);
        DB::shouldReceive('table->where->where->where->select->groupBy->get')
            ->once()
            ->andReturn(collect([
                (object) ['emoji' => 'love', 'count' => 3],
                (object) ['emoji' => 'laugh', 'count' => 1],
            ]));

        DB::shouldReceive('table->where->where->where->where->first')
            ->once()
            ->andReturn((object) ['emoji' => 'love']);

        DB::shouldReceive('table->join->where->where->where->orderByDesc->limit->select->get->map->all')
            ->once()
            ->andReturn([
                ['id' => 1, 'name' => 'User One', 'avatar_url' => null],
                ['id' => 2, 'name' => 'User Two', 'avatar_url' => null],
            ]);

        $result = $this->service->getReactions(1, 'post', $viewerId);

        $this->assertEquals(['love' => 3, 'laugh' => 1], $result['counts']);
        $this->assertEquals(4, $result['total']);
        $this->assertEquals('love', $result['user_reaction']);
        $this->assertCount(2, $result['top_reactors']);
        $this->assertSame('User', $result['top_reactors'][0]['name'], 'Non-admin viewers see first names (F-084).');
    }

    public function test_getReactions_returns_null_user_reaction_when_no_user(): void
    {
        $this->mockDbRaw();
        DB::shouldReceive('table->where->where->where->select->groupBy->get')
            ->once()
            ->andReturn(collect([(object) ['emoji' => 'love', 'count' => 2]]));

        // No user query when userId is null
        DB::shouldReceive('table->join->where->where->where->orderByDesc->limit->select->get->map->all')
            ->once()
            ->andReturn([]);

        $result = $this->service->getReactions(1, 'post', null);

        $this->assertEquals(['love' => 2], $result['counts']);
        $this->assertEquals(2, $result['total']);
        $this->assertNull($result['user_reaction']);
    }

    public function test_getReactions_returns_empty_when_no_reactions(): void
    {
        $this->mockDbRaw();
        DB::shouldReceive('table->where->where->where->select->groupBy->get')
            ->once()
            ->andReturn(collect([]));

        DB::shouldReceive('table->where->where->where->where->first')
            ->once()
            ->andReturn(null);

        DB::shouldReceive('table->join->where->where->where->orderByDesc->limit->select->get->map->all')
            ->once()
            ->andReturn([]);

        $result = $this->service->getReactions(1, 'post', 5);

        $this->assertEquals([], $result['counts']);
        $this->assertEquals(0, $result['total']);
        $this->assertNull($result['user_reaction']);
        $this->assertEmpty($result['top_reactors']);
    }

    public function test_getReactions_throws_for_invalid_entity_type(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid entity type: message');

        $this->service->getReactions(1, 'message', 5);
    }

    // ======================================================================
    //  getReactors
    // ======================================================================

    public function test_getReactors_returns_paginated_users(): void
    {
        $this->mockDbRaw();
        $this->mockPublicNames([1 => 'User', 2 => 'User']);
        // count() — 5 where calls: join + 4 where
        DB::shouldReceive('table->join->where->where->where->where->count')
            ->once()
            ->andReturn(5);

        // paginated results — clone adds orderByDesc, offset, limit, select, get->map->all
        DB::shouldReceive('table->join->where->where->where->where->orderByDesc->offset->limit->select->get->map->all')
            ->once()
            ->andReturn([
                ['id' => 1, 'name' => 'User A', 'avatar_url' => null, 'reacted_at' => '2026-03-23 10:00:00'],
                ['id' => 2, 'name' => 'User B', 'avatar_url' => null, 'reacted_at' => '2026-03-23 09:00:00'],
            ]);

        $result = $this->service->getReactors(1, 'post', 'love', 1, 2);

        $this->assertCount(2, $result['users']);
        $this->assertEquals(5, $result['total']);
        $this->assertTrue($result['has_more']);
    }

    public function test_getReactors_returns_no_more_when_last_page(): void
    {
        $this->mockDbRaw();
        $this->mockPublicNames([1 => 'User', 2 => 'User']);
        DB::shouldReceive('table->join->where->where->where->where->count')
            ->once()
            ->andReturn(2);

        DB::shouldReceive('table->join->where->where->where->where->orderByDesc->offset->limit->select->get->map->all')
            ->once()
            ->andReturn([
                ['id' => 1, 'name' => 'User A', 'avatar_url' => null, 'reacted_at' => '2026-03-23 10:00:00'],
                ['id' => 2, 'name' => 'User B', 'avatar_url' => null, 'reacted_at' => '2026-03-23 09:00:00'],
            ]);

        $result = $this->service->getReactors(1, 'post', 'love', 1, 20);

        $this->assertFalse($result['has_more']);
        $this->assertEquals(2, $result['total']);
    }

    public function test_getReactors_returns_empty_for_no_reactions(): void
    {
        $this->mockDbRaw();
        DB::shouldReceive('table->join->where->where->where->where->count')
            ->once()
            ->andReturn(0);

        DB::shouldReceive('table->join->where->where->where->where->orderByDesc->offset->limit->select->get->map->all')
            ->once()
            ->andReturn([]);

        $result = $this->service->getReactors(1, 'post', 'love', 1, 20);

        $this->assertEmpty($result['users']);
        $this->assertEquals(0, $result['total']);
        $this->assertFalse($result['has_more']);
    }

    public function test_getReactors_throws_for_invalid_entity_type(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Invalid entity type: photo');

        $this->service->getReactors(1, 'photo', 'love');
    }

    // ======================================================================
    //  getReactionsForPosts (batch) — uses DB::select() with raw SQL
    // ======================================================================

    public function test_getReactionsForPosts_returns_empty_for_empty_input(): void
    {
        $result = $this->service->getReactionsForPosts([], 5);
        $this->assertEquals([], $result);
    }

    public function test_getReactionsForPosts_returns_grouped_counts(): void
    {
        $viewerId = $this->seedUser();
        $this->mockPublicNames([7 => 'Anna']);

        // Counts query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['target_id' => 1, 'emoji' => 'love', 'count' => 3],
                (object) ['target_id' => 1, 'emoji' => 'laugh', 'count' => 1],
                (object) ['target_id' => 2, 'emoji' => 'wow', 'count' => 2],
            ]);

        // User reactions query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['target_id' => 1, 'emoji' => 'love'],
            ]);

        // Top-reactors query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['target_id' => 1, 'user_id' => 7, 'name' => 'Anna Murphy', 'avatar_url' => null],
            ]);

        $result = $this->service->getReactionsForPosts([1, 2, 3], $viewerId);

        $this->assertEquals(['love' => 3, 'laugh' => 1], $result[1]['counts']);
        $this->assertEquals(4, $result[1]['total']);
        $this->assertEquals('love', $result[1]['user_reaction']);
        // F-084: a non-admin viewer sees the reactor's first name only.
        $this->assertEquals(
            [['id' => 7, 'name' => 'Anna', 'avatar_url' => null]],
            $result[1]['top_reactors']
        );

        $this->assertEquals(['wow' => 2], $result[2]['counts']);
        $this->assertEquals(2, $result[2]['total']);
        $this->assertNull($result[2]['user_reaction']);

        $this->assertEquals([], $result[3]['counts']);
        $this->assertEquals(0, $result[3]['total']);
        $this->assertNull($result[3]['user_reaction']);
    }

    public function test_getReactionsForPosts_without_user_id(): void
    {
        // Counts query (no user-reactions query without a user id)
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['target_id' => 10, 'emoji' => 'clap', 'count' => 5],
            ]);

        // Top-reactors query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $result = $this->service->getReactionsForPosts([10], null);

        $this->assertEquals(['clap' => 5], $result[10]['counts']);
        $this->assertEquals(5, $result[10]['total']);
        $this->assertNull($result[10]['user_reaction']);
    }

    public function test_getReactionsForPosts_initialises_all_post_ids(): void
    {
        // Counts + top-reactors queries (no user-reactions query without a user id)
        DB::shouldReceive('select')
            ->twice()
            ->andReturn([]);

        $result = $this->service->getReactionsForPosts([100, 200, 300], null);

        $this->assertArrayHasKey(100, $result);
        $this->assertArrayHasKey(200, $result);
        $this->assertArrayHasKey(300, $result);

        foreach ([100, 200, 300] as $pid) {
            $this->assertEquals([], $result[$pid]['counts']);
            $this->assertEquals(0, $result[$pid]['total']);
            $this->assertNull($result[$pid]['user_reaction']);
        }
    }
}
