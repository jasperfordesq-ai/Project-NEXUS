<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\FeedService;
use App\Models\FeedActivity;
use App\Models\FeedPost;
use App\Core\TenantContext;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery;

class FeedServiceTest extends TestCase
{
    /** @var \Illuminate\Database\DatabaseManager|null Original DB resolver saved before mock swap */
    private $originalDbResolver = null;

    /**
     * Build a mock DB connection, swap both the Model resolver AND
     * the app container's 'db' binding so Eloquent queries and
     * DB facade calls both route through the same mock.
     *
     * @param  list<list<object>>  $selectSequence  Ordered arrays of result rows
     * @return FeedService  A fresh service instance using the mocked connection
     */
    private function mockEloquentConnectionAndBuildService(
        array $selectSequence = [],
        ?int $groupOwnerId = null,
        int $groupId = 5,
    ): FeedService
    {
        $mockGrammar = Mockery::mock(\Illuminate\Database\Query\Grammars\MySqlGrammar::class)->makePartial();
        $mockGrammar->shouldReceive('getDateFormat')->andReturn('Y-m-d H:i:s');
        $mockGrammar->shouldReceive('compileSelect')->andReturn('SELECT 1');
        $mockGrammar->shouldReceive('compileInsert')->andReturn('INSERT INTO t VALUES ()');
        $mockGrammar->shouldReceive('compileInsertOrIgnore')->andReturn('INSERT IGNORE INTO t VALUES ()');
        $mockGrammar->shouldReceive('compileUpdate')->andReturn('UPDATE t SET x=1');
        $mockGrammar->shouldReceive('compileDelete')->andReturn('DELETE FROM t');

        $mockProcessor = Mockery::mock(\Illuminate\Database\Query\Processors\MySqlProcessor::class)->makePartial();

        $mockConnection = Mockery::mock(\Illuminate\Database\MySqlConnection::class)->makePartial();
        $mockConnection->shouldReceive('getQueryGrammar')->andReturn($mockGrammar);
        $mockConnection->shouldReceive('getPostProcessor')->andReturn($mockProcessor);
        $mockConnection->shouldReceive('getTablePrefix')->andReturn('');
        $mockConnection->shouldReceive('getDatabaseName')->andReturn('nexus_test');
        $mockConnection->shouldReceive('getName')->andReturn('mysql');
        $mockConnection->shouldReceive('getConfig')->andReturn(null);

        // Group-filtered feeds now authorize through GroupAccessService before
        // running the feed query. Model that Eloquent sequence explicitly:
        // active group lookup, same-tenant user existence, then role lookup.
        $groupAccessReturns = $groupOwnerId === null ? [] : [
            [(object) [
                'id' => $groupId,
                'tenant_id' => (int) TenantContext::getId(),
                'owner_id' => $groupOwnerId,
                'visibility' => 'public',
                'status' => 'active',
            ]],
            [(object) ['exists' => 1]],
            [(object) [
                'id' => $groupOwnerId,
                'tenant_id' => (int) TenantContext::getId(),
                'role' => 'member',
                'is_super_admin' => false,
                'is_tenant_super_admin' => false,
            ]],
        ];

        // Build the full return sequence: optional access rows, user-provided
        // feed rows, then trailing empties for enrichment queries.
        $allReturns = array_merge(
            $groupAccessReturns,
            $selectSequence ?: [[]],
            [[], [], [], [], [], [], [], [], [], []],
        );
        $mockConnection->shouldReceive('select')->andReturnValues($allReturns);

        $mockConnection->shouldReceive('selectOne')
            ->andReturnUsing(function () {
                return (object) ['aggregate' => 0];
            });

        $mockConnection->shouldReceive('insert')->andReturn(true);
        $mockConnection->shouldReceive('update')->andReturn(1);
        $mockConnection->shouldReceive('delete')->andReturn(1);
        $mockConnection->shouldReceive('affectingStatement')->andReturn(1);
        $mockConnection->shouldReceive('statement')->andReturn(true);
        $mockConnection->shouldReceive('beginTransaction')->andReturn(null);
        $mockConnection->shouldReceive('commit')->andReturn(null);
        $mockConnection->shouldReceive('rollBack')->andReturn(null);
        $mockConnection->shouldReceive('transactionLevel')->andReturn(0);

        // A permissive query-builder mock used for ALL DB::table(...) calls made
        // during getFeed enrichment (likes/comments counts, groups visibility,
        // orphan filtering, etc.). Every fluent method returns the builder itself;
        // terminal methods return empty/zero so enrichment is a no-op.
        $makeBuilder = function (?string $table = null) {
            $builder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
            $builder->shouldReceive(
                'select', 'selectRaw', 'where', 'whereIn', 'whereNotIn', 'whereNull',
                'whereNotNull', 'whereColumn', 'whereRaw', 'whereExists', 'whereNotExists',
                'orWhere', 'orWhereExists', 'join', 'leftJoin', 'groupBy', 'orderBy',
                'orderByDesc', 'limit', 'tap', 'from', 'distinct', 'having'
            )->andReturnSelf();
            $builder->shouldReceive('get')->andReturn(collect([]));
            $builder->shouldReceive('pluck')->andReturn(collect([]));
            // FeedItemTables::canViewGroup()/canPostInGroup() look up `groups` and
            // expect a public, active group for the visibility pre-checks to pass.
            // Returning a public group keeps group-scoped feed items visible.
            if ($table === 'groups') {
                $builder->shouldReceive('first')->andReturn(
                    (object) ['id' => 5, 'owner_id' => 0, 'visibility' => 'public', 'status' => 'active']
                );
            } elseif ($table === 'users') {
                // FeedItemTables::canViewProfile() looks up the profile owner and
                // expects a public profile for the user-scoped feed pre-check to pass.
                $builder->shouldReceive('first')->andReturn(
                    (object) ['id' => 42, 'privacy_profile' => 'public']
                );
            } else {
                $builder->shouldReceive('first')->andReturn(null);
            }
            $builder->shouldReceive('exists')->andReturn(false);
            $builder->shouldReceive('count')->andReturn(0);
            $builder->shouldReceive('value')->andReturn(null);
            $builder->shouldReceive('insert')->andReturn(true);
            $builder->shouldReceive('insertOrIgnore')->andReturn(true);
            $builder->shouldReceive('update')->andReturn(1);
            $builder->shouldReceive('delete')->andReturn(1);
            return $builder;
        };

        // Create a single mock resolver for BOTH Model and DB facade.
        // It also proxies table()/select()/selectOne()/raw() so DB::table(...) and
        // raw DB::select(...) calls resolve through the mock connection.
        $mockResolver = Mockery::mock(\Illuminate\Database\DatabaseManager::class);
        $mockResolver->shouldReceive('connection')->andReturn($mockConnection);
        $mockResolver->shouldReceive('table')->andReturnUsing(fn ($table = null) => $makeBuilder(is_string($table) ? $table : null));
        $mockResolver->shouldReceive('select')->andReturn([]);
        $mockResolver->shouldReceive('selectOne')->andReturn(null);
        $mockResolver->shouldReceive('raw')->andReturnUsing(
            fn ($v) => new \Illuminate\Database\Query\Expression($v)
        );

        // Schema::hasColumn() is consulted by FeedService::getFeed/getItem and
        // FeedItemTables before the mock connection can answer schema lookups
        // (the mocked MySqlProcessor can't process a real column listing). Stub it
        // so the service takes the deleted_at-aware branch deterministically.
        Schema::shouldReceive('hasColumn')->andReturn(true);
        Schema::shouldReceive('hasTable')->andReturn(true);

        // Save original resolver before swapping
        $this->originalDbResolver = Model::getConnectionResolver();

        // Swap the Model's connection resolver
        Model::setConnectionResolver($mockResolver);

        // Swap the app container's 'db' binding so DB facade uses the same resolver.
        // DB::swap() also clears the facade's resolved-instance cache, so subsequent
        // DB::table()/DB::select() calls route through the mock (not the real test DB).
        $this->app->instance('db', $mockResolver);
        DB::swap($mockResolver);

        // Create service AFTER mocking so the models resolve the mock connection
        return new FeedService(new FeedActivity(), new FeedPost());
    }

    protected function tearDown(): void
    {
        // Restore the real connection resolver if it was swapped
        if ($this->originalDbResolver !== null) {
            Model::setConnectionResolver($this->originalDbResolver);
            $this->app->instance('db', $this->originalDbResolver);
            DB::swap($this->originalDbResolver);
            $this->originalDbResolver = null;
        }
        parent::tearDown();
    }

    /**
     * Make FeedItemTables visibility pre-checks (canView/canViewPost/canViewGroup)
     * pass for a public post owned by $authorId, without a live DB.
     *
     * getItem()/createPost() gate on these helpers before running their real
     * queries; the tests mock the real queries separately via DB::select etc.
     * This only needs to cover the polymorphic existence/visibility lookups.
     */
    private function stubFeedItemTablesPermissive(int $authorId = 10): void
    {
        Schema::shouldReceive('hasColumn')->andReturn(true);
        Schema::shouldReceive('hasTable')->andReturn(true);

        DB::shouldReceive('table')->andReturnUsing(function ($table) use ($authorId) {
            $builder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
            $builder->shouldReceive(
                'where', 'whereIn', 'whereNull', 'whereNotNull', 'whereColumn',
                'select', 'selectRaw', 'orWhere', 'join', 'leftJoin', 'groupBy',
                'orderBy', 'orderByDesc', 'limit'
            )->andReturnSelf();
            $builder->shouldReceive('exists')->andReturn(true);
            $builder->shouldReceive('count')->andReturn(0);
            $builder->shouldReceive('get')->andReturn(collect([]));
            $builder->shouldReceive('pluck')->andReturn(collect([]));
            // feed_posts / groups visibility lookups resolve to a public, viewable
            // row. Reaction (and any other) lookups resolve to "no row".
            if ($table === 'feed_posts' || $table === 'groups') {
                $builder->shouldReceive('first')->andReturn(
                    (object) [
                        'id' => 100, 'user_id' => $authorId, 'owner_id' => $authorId,
                        'group_id' => null, 'visibility' => 'public', 'status' => 'active',
                    ]
                );
            } else {
                $builder->shouldReceive('first')->andReturn(null);
            }
            return $builder;
        });
        // ReactionService::getReactions() (invoked for valid feed types) uses DB::raw().
        DB::shouldReceive('raw')->andReturnUsing(
            fn ($v) => new \Illuminate\Database\Query\Expression($v)
        );
    }

    /**
     * Mock the DB facade for createPost(): a table-aware builder that lets the
     * municipality-announcer role check, group-membership check, spam-queue and
     * feed_activity sync run without a live DB. Captures the feed_activity
     * insertOrIgnore payload into $capturedActivityData.
     */
    private function mockCreatePostDb(&$capturedActivityData, int $userId = 10): void
    {
        $this->mockGroupOwnerAccessThroughEloquent(5, $userId);

        Schema::shouldReceive('hasColumn')->andReturn(true);
        Schema::shouldReceive('hasTable')->andReturn(true);

        DB::shouldReceive('statement')->andReturn(true);

        DB::shouldReceive('table')->andReturnUsing(function ($table) use (&$capturedActivityData, $userId) {
            $builder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
            $builder->shouldReceive(
                'join', 'leftJoin', 'where', 'whereIn', 'whereNull', 'whereNotNull',
                'whereColumn', 'orWhere', 'select', 'selectRaw', 'groupBy'
            )->andReturnSelf();
            // user_roles → municipality_announcer check resolves to "not an announcer".
            $builder->shouldReceive('exists')->andReturn(false);
            $builder->shouldReceive('count')->andReturn(0);
            $builder->shouldReceive('update')->andReturn(1);
            $builder->shouldReceive('delete')->andReturn(1);
            $builder->shouldReceive('get')->andReturn(collect([]));
            $builder->shouldReceive('pluck')->andReturn(collect([]));
            // groups → caller is the owner so canPostInGroup() passes.
            if ($table === 'groups') {
                $builder->shouldReceive('first')->andReturn(
                    (object) ['id' => 5, 'owner_id' => $userId, 'visibility' => 'public', 'status' => 'active']
                );
            } else {
                $builder->shouldReceive('first')->andReturn(null);
            }
            if ($table === 'feed_activity') {
                $builder->shouldReceive('insertOrIgnore')->andReturnUsing(
                    function ($data) use (&$capturedActivityData) {
                        $capturedActivityData = $data;
                        return true;
                    }
                );
            } else {
                $builder->shouldReceive('insertOrIgnore')->andReturn(true);
            }
            return $builder;
        });
    }

    /**
     * Provide the Eloquent lookups used by GroupAccessService while keeping the
     * table-aware DB facade mock above available for createPost() side effects.
     */
    private function mockGroupOwnerAccessThroughEloquent(int $groupId, int $userId): void
    {
        $mockGrammar = Mockery::mock(\Illuminate\Database\Query\Grammars\MySqlGrammar::class)->makePartial();
        $mockGrammar->shouldReceive('getDateFormat')->andReturn('Y-m-d H:i:s');
        $mockGrammar->shouldReceive('compileSelect')->andReturn('SELECT 1');

        $mockProcessor = Mockery::mock(\Illuminate\Database\Query\Processors\MySqlProcessor::class)->makePartial();

        $mockConnection = Mockery::mock(\Illuminate\Database\MySqlConnection::class)->makePartial();
        $mockConnection->shouldReceive('getQueryGrammar')->andReturn($mockGrammar);
        $mockConnection->shouldReceive('getPostProcessor')->andReturn($mockProcessor);
        $mockConnection->shouldReceive('getTablePrefix')->andReturn('');
        $mockConnection->shouldReceive('getDatabaseName')->andReturn('nexus_test');
        $mockConnection->shouldReceive('getName')->andReturn('mysql');
        $mockConnection->shouldReceive('getConfig')->andReturn(null);
        $mockConnection->shouldReceive('select')->andReturnValues([
            [(object) [
                'id' => $groupId,
                'tenant_id' => (int) TenantContext::getId(),
                'owner_id' => $userId,
                'visibility' => 'public',
                'status' => 'active',
            ]],
            [(object) ['exists' => 1]],
            [(object) [
                'id' => $userId,
                'tenant_id' => (int) TenantContext::getId(),
                'role' => 'member',
                'is_super_admin' => false,
                'is_tenant_super_admin' => false,
            ]],
        ]);

        $mockResolver = Mockery::mock(\Illuminate\Database\DatabaseManager::class);
        $mockResolver->shouldReceive('connection')->andReturn($mockConnection);

        $this->originalDbResolver ??= Model::getConnectionResolver();
        Model::setConnectionResolver($mockResolver);
    }

    // ── Helper: build a feed_activity row object ──────────────────────

    private function makeFeedRow(array $overrides = []): object
    {
        return (object) array_merge([
            'activity_id' => 1,
            'source_type' => 'post',
            'source_id' => 100,
            'user_id' => 10,
            'title' => 'Test Post',
            'content' => 'Hello world',
            'image_url' => null,
            'metadata' => null,
            'group_id' => null,
            'created_at' => '2026-03-01 12:00:00',
            'author_name' => 'Test User',
            'author_avatar' => '/avatars/test.png',
            'user_location' => 'Dublin',
        ], $overrides);
    }

    // ── 1. getFeed() returns items for current tenant only ────────────

    public function test_getFeed_returns_items_for_current_tenant(): void
    {
        $row1 = $this->makeFeedRow(['activity_id' => 1, 'source_id' => 100]);
        $row2 = $this->makeFeedRow(['activity_id' => 2, 'source_id' => 101]);

        $service = $this->mockEloquentConnectionAndBuildService([
            [$row1, $row2],
        ]);

        $result = $service->getFeed(10, []);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertCount(2, $result['items']);
    }

    public function test_getFeed_returns_empty_when_no_items(): void
    {
        $service = $this->mockEloquentConnectionAndBuildService([[]]);

        $result = $service->getFeed(10, []);

        $this->assertEmpty($result['items']);
        $this->assertNull($result['cursor']);
        $this->assertFalse($result['has_more']);
    }

    // ── 2. getFeed() respects type filter ─────────────────────────────

    public function test_getFeed_respects_type_filter(): void
    {
        $postRow = $this->makeFeedRow(['source_type' => 'post', 'source_id' => 100]);

        $service = $this->mockEloquentConnectionAndBuildService([
            [$postRow],
        ]);

        $result = $service->getFeed(10, ['type' => 'posts']);

        $this->assertCount(1, $result['items']);
        $this->assertSame('post', $result['items'][0]['type']);
    }

    public function test_getFeed_type_map_converts_plural_to_singular(): void
    {
        $typeMap = [
            'posts' => 'post',
            'listings' => 'listing',
            'events' => 'event',
            'polls' => 'poll',
            'goals' => 'goal',
            'jobs' => 'job',
            'challenges' => 'challenge',
            'volunteering' => 'volunteer',
            'blogs' => 'blog',
            'discussions' => 'discussion',
        ];

        $reflection = new \ReflectionClass(FeedService::class);
        $constant = $reflection->getConstant('TYPE_MAP');

        $this->assertSame($typeMap, $constant);
    }

    // ── 3. getFeed() pagination ───────────────────────────────────────

    public function test_getFeed_pagination_returns_cursor_when_has_more(): void
    {
        // Create limit+1 rows (default limit=20, so 21 rows triggers has_more)
        $rows = [];
        for ($i = 21; $i >= 1; $i--) {
            $rows[] = $this->makeFeedRow([
                'activity_id' => $i,
                'source_id' => 100 + $i,
                'created_at' => sprintf('2026-03-01 12:%02d:00', $i),
            ]);
        }

        $service = $this->mockEloquentConnectionAndBuildService([$rows]);

        $result = $service->getFeed(10, ['limit' => 20]);

        $this->assertTrue($result['has_more']);
        $this->assertNotNull($result['cursor']);
        $this->assertCount(20, $result['items']);

        // Cursor is now an HMAC-signed token: base64("sha256_sig.json_payload")
        // where the payload is {"ts":<created_at>,"id":<activity_id>}.
        $decoded = base64_decode($result['cursor'], true);
        $this->assertStringContainsString('.', $decoded);
        [$sig, $payload] = explode('.', $decoded, 2);
        $this->assertSame(64, strlen($sig)); // sha256 hex digest
        $data = json_decode($payload, true);
        $this->assertArrayHasKey('ts', $data);
        $this->assertArrayHasKey('id', $data);
    }

    public function test_getFeed_pagination_no_cursor_when_no_more(): void
    {
        $rows = [
            $this->makeFeedRow(['activity_id' => 1, 'source_id' => 100]),
            $this->makeFeedRow(['activity_id' => 2, 'source_id' => 101]),
        ];

        $service = $this->mockEloquentConnectionAndBuildService([$rows]);

        // Chronological mode: cursor is only emitted when there are more pages.
        // (Ranked mode, the default, always emits a resume cursor — covered elsewhere.)
        $result = $service->getFeed(10, ['limit' => 20, 'mode' => 'chronological']);

        $this->assertFalse($result['has_more']);
        $this->assertNull($result['cursor']);
        $this->assertCount(2, $result['items']);
    }

    public function test_getFeed_cursor_decoding(): void
    {
        $row = $this->makeFeedRow(['activity_id' => 5, 'source_id' => 105]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $cursor = base64_encode('2026-03-01 12:00:00|10');
        $result = $service->getFeed(10, ['cursor' => $cursor]);

        $this->assertCount(1, $result['items']);
    }

    public function test_getFeed_limits_capped_at_100(): void
    {
        $this->assertSame(100, min((int) 200, 100));
        $this->assertSame(50, min((int) 50, 100));
        $this->assertSame(20, min((int) (null ?? 20), 100));
    }

    // ── 4. getFeed() excludes invisible items ─────────────────────────

    public function test_getFeed_excludes_invisible_items(): void
    {
        // The query includes WHERE is_visible = true AND is_hidden = false.
        // Only visible/non-hidden rows are returned by the DB.
        $visibleRow = $this->makeFeedRow(['activity_id' => 1, 'source_id' => 100]);

        $service = $this->mockEloquentConnectionAndBuildService([[$visibleRow]]);

        $result = $service->getFeed(10, []);

        $this->assertCount(1, $result['items']);
        $this->assertSame(100, $result['items'][0]['id']);
    }

    public function test_getFeed_excludes_hidden_items(): void
    {
        $normalRow = $this->makeFeedRow(['activity_id' => 1, 'source_id' => 100]);

        $service = $this->mockEloquentConnectionAndBuildService([[$normalRow]]);

        $result = $service->getFeed(10, []);

        $this->assertCount(1, $result['items']);
    }

    // ── 5. createPost() creates both feed_posts and feed_activity ─────

    public function test_createPost_creates_post_and_activity(): void
    {
        $mockPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockPost->id = 42;
        $mockPost->created_at = '2026-03-01 12:00:00';
        $mockPost->shouldReceive('save')->once()->andReturn(true);
        $mockPost->shouldReceive('fresh')->once()->andReturn($mockPost);

        $mockFeedPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockFeedPost->shouldReceive('newInstance')
            ->once()
            ->andReturn($mockPost);

        // mockPost->fresh() returns mockPost; the service then reads ->quotedPost.
        $mockPost->setRelation('quotedPost', null);

        $service = new FeedService(new FeedActivity(), $mockFeedPost);

        $capturedActivityData = null;
        $this->mockCreatePostDb($capturedActivityData);

        $result = $service->createPost(10, [
            'content' => 'Hello world',
        ]);

        $this->assertSame(42, $result->id);
    }

    public function test_createPost_sets_correct_fields(): void
    {
        $capturedAttributes = null;

        $mockPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockPost->id = 55;
        $mockPost->created_at = '2026-03-01 12:00:00';
        $mockPost->shouldReceive('save')->once()->andReturn(true);
        $mockPost->shouldReceive('fresh')->once()->andReturn($mockPost);

        $mockFeedPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockFeedPost->shouldReceive('newInstance')
            ->once()
            ->withArgs(function ($attrs) use (&$capturedAttributes) {
                $capturedAttributes = $attrs;
                return true;
            })
            ->andReturn($mockPost);

        $mockPost->setRelation('quotedPost', null);

        $service = new FeedService(new FeedActivity(), $mockFeedPost);

        $capturedActivityData = null;
        $this->mockCreatePostDb($capturedActivityData);

        $service->createPost(10, [
            'content' => 'My post content',
            'image_url' => '/images/photo.jpg',
            'visibility' => 'private',
        ]);

        $this->assertNotNull($capturedAttributes, 'newInstance should have been called');
        $this->assertSame(10, $capturedAttributes['user_id']);
        $this->assertSame('My post content', $capturedAttributes['content']);
        $this->assertSame('private', $capturedAttributes['visibility']);
        $this->assertSame('post', $capturedAttributes['type']);
        // createPost() maps the image input to the 'image' attribute key
        $imageValue = $capturedAttributes['image'] ?? $capturedAttributes['image_url'] ?? null;
        $this->assertSame('/images/photo.jpg', $imageValue);
    }

    // ── 6. createPost() rejects empty content without image ───────────

    public function test_createPostLegacy_rejects_empty_content_without_image(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $result = $service->createPostLegacy(10, [
            'content' => '',
            'image_url' => null,
        ]);

        $this->assertNull($result);

        $errors = $service->getErrors();
        $this->assertNotEmpty($errors);
        $this->assertSame('VALIDATION_ERROR', $errors[0]['code']);
        $this->assertSame('content', $errors[0]['field']);
    }

    public function test_createPostLegacy_rejects_whitespace_only_content(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $result = $service->createPostLegacy(10, [
            'content' => '   ',
            'image_url' => null,
        ]);

        $this->assertNull($result);
        $this->assertNotEmpty($service->getErrors());
    }

    // ── 7. createPost() with group_id ─────────────────────────────────

    public function test_createPost_with_group_id(): void
    {
        $capturedAttributes = null;
        $capturedActivityData = null;

        $mockPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockPost->id = 77;
        $mockPost->created_at = '2026-03-01 12:00:00';
        $mockPost->shouldReceive('save')->once()->andReturn(true);
        $mockPost->shouldReceive('fresh')->once()->andReturn($mockPost);

        $mockFeedPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockFeedPost->shouldReceive('newInstance')
            ->once()
            ->withArgs(function ($attrs) use (&$capturedAttributes) {
                $capturedAttributes = $attrs;
                return true;
            })
            ->andReturn($mockPost);

        $mockPost->setRelation('quotedPost', null);

        $service = new FeedService(new FeedActivity(), $mockFeedPost);

        $capturedActivityData = null;
        $this->mockCreatePostDb($capturedActivityData);

        $service->createPost(10, [
            'content' => 'Group post',
            'group_id' => 5,
        ]);

        $this->assertSame(5, $capturedAttributes['group_id']);
        $this->assertSame(5, $capturedActivityData['group_id']);
    }

    public function test_createPost_without_group_id(): void
    {
        $capturedAttributes = null;

        $mockPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockPost->id = 78;
        $mockPost->created_at = '2026-03-01 12:00:00';
        $mockPost->shouldReceive('save')->once()->andReturn(true);
        $mockPost->shouldReceive('fresh')->once()->andReturn($mockPost);

        $mockFeedPost = Mockery::mock(FeedPost::class)->makePartial();
        $mockFeedPost->shouldReceive('newInstance')
            ->once()
            ->withArgs(function ($attrs) use (&$capturedAttributes) {
                $capturedAttributes = $attrs;
                return true;
            })
            ->andReturn($mockPost);

        $mockPost->setRelation('quotedPost', null);

        $service = new FeedService(new FeedActivity(), $mockFeedPost);

        $capturedActivityData = null;
        $this->mockCreatePostDb($capturedActivityData);

        $service->createPost(10, ['content' => 'No group']);

        $this->assertNull($capturedAttributes['group_id']);
    }

    // ── 8. like() toggle behavior ─────────────────────────────────────

    public function test_like_creates_like_when_not_exists(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        // like() first verifies the target post exists in the tenant (feed_posts),
        // then toggles the like. New like uses an atomic INSERT IGNORE via DB::statement.
        $feedPostsBuilder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $feedPostsBuilder->shouldReceive('where')->andReturnSelf();
        $feedPostsBuilder->shouldReceive('exists')->once()->andReturn(true);

        $likesBuilder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $likesBuilder->shouldReceive('where')->andReturnSelf();
        $likesBuilder->shouldReceive('first')->once()->andReturn(null);
        $likesBuilder->shouldReceive('count')->once()->andReturn(1);

        DB::shouldReceive('table')->with('feed_posts')->once()->andReturn($feedPostsBuilder);
        DB::shouldReceive('table')->with('likes')->andReturn($likesBuilder);
        DB::shouldReceive('statement')->once()->andReturn(true);

        $result = $service->like(100, 10);

        $this->assertTrue($result['liked']);
        $this->assertSame(1, $result['likes_count']);
    }

    public function test_like_removes_like_when_exists(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $existingLike = (object) ['id' => 1, 'target_type' => 'post', 'target_id' => 100, 'user_id' => 10];

        $feedPostsBuilder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $feedPostsBuilder->shouldReceive('where')->andReturnSelf();
        $feedPostsBuilder->shouldReceive('exists')->once()->andReturn(true);

        $likesBuilder = Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $likesBuilder->shouldReceive('where')->andReturnSelf();
        $likesBuilder->shouldReceive('first')->once()->andReturn($existingLike);
        $likesBuilder->shouldReceive('delete')->once()->andReturn(1);
        $likesBuilder->shouldReceive('count')->once()->andReturn(0);

        DB::shouldReceive('table')->with('feed_posts')->once()->andReturn($feedPostsBuilder);
        DB::shouldReceive('table')->with('likes')->andReturn($likesBuilder);

        $result = $service->like(100, 10);

        $this->assertFalse($result['liked']);
        $this->assertSame(0, $result['likes_count']);
    }

    // ── 9. getItem() returns single item with enrichment ──────────────

    public function test_getItem_returns_enriched_post(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $postRow = (object) [
            'id' => 100,
            'content' => 'Hello world',
            'image_url' => null,
            'created_at' => '2026-03-01 12:00:00',
            'likes_count' => 5,
            'user_id' => 10,
            'type' => 'post',
            'author_name' => 'Test User',
            'author_avatar' => '/avatars/test.png',
            'comments_count' => 3,
        ];

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$postRow]);
        DB::shouldReceive('selectOne')->once()->andReturn(
            (object) ['1' => 1]
        );

        $result = $service->getItem('post', 100, 10);

        $this->assertNotNull($result);
        $this->assertSame(100, $result['id']);
        $this->assertSame('post', $result['type']);
        $this->assertSame('Hello world', $result['content']);
        $this->assertFalse($result['content_truncated']);
        $this->assertArrayHasKey('author', $result);
        $this->assertSame(10, $result['author']['id']);
        $this->assertSame('Test User', $result['author']['name']);
        $this->assertArrayHasKey('likes_count', $result);
        $this->assertArrayHasKey('comments_count', $result);
        $this->assertArrayHasKey('is_liked', $result);
    }

    public function test_getItem_returns_null_when_not_found(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([]);

        $result = $service->getItem('post', 999, 10);

        $this->assertNull($result);
    }

    /**
     * 🔴 This test asserted the OPPOSITE until 2026-08-24: that getItem() truncates at
     * 500 characters. That was the defect, not the contract. getItem() is a DETAIL
     * lookup - every caller shows one item on its own screen - so a member reported
     * that the full text of any post over 500 characters was unreachable, and the
     * "Read more" control opened a screen with no more to show. getItem() now defaults
     * $fullContent to TRUE. Do not "fix" this test by restoring the old assertion.
     */
    public function test_getItem_returns_full_content_by_default(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $longContent = str_repeat('A', 600);
        $postRow = (object) [
            'id' => 100,
            'content' => $longContent,
            'image_url' => null,
            'created_at' => '2026-03-01 12:00:00',
            'likes_count' => 0,
            'user_id' => 10,
            'type' => 'post',
            'author_name' => 'Test User',
            'author_avatar' => null,
            'comments_count' => 0,
        ];

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$postRow]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $service->getItem('post', 100, 10);

        $this->assertFalse($result['content_truncated']);
        $this->assertSame(600, mb_strlen($result['content']));
        $this->assertSame($longContent, $result['content']);
    }

    /**
     * The other half. Truncation is still reachable on request, so that fixing the
     * detail view cannot silently remove the list's 500-character preview - twenty
     * items a page, where the payload does matter.
     */
    public function test_getItem_truncates_when_full_content_is_disabled(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $longContent = str_repeat('A', 600);
        $postRow = (object) [
            'id' => 100,
            'content' => $longContent,
            'image_url' => null,
            'created_at' => '2026-03-01 12:00:00',
            'likes_count' => 0,
            'user_id' => 10,
            'type' => 'post',
            'author_name' => 'Test User',
            'author_avatar' => null,
            'comments_count' => 0,
        ];

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$postRow]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $service->getItem('post', 100, 10, false);

        $this->assertTrue($result['content_truncated']);
        $this->assertSame(503, mb_strlen($result['content']));
    }

    public function test_getItem_without_user_skips_like_check(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $postRow = (object) [
            'id' => 100,
            'content' => 'Test',
            'image_url' => null,
            'created_at' => '2026-03-01 12:00:00',
            'likes_count' => 0,
            'user_id' => 10,
            'type' => 'post',
            'author_name' => 'Test User',
            'author_avatar' => null,
            'comments_count' => 0,
        ];

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$postRow]);

        $result = $service->getItem('post', 100, null);

        $this->assertNotNull($result);
        $this->assertFalse($result['is_liked']);
    }

    // ── 10. getFeed() batch loads likes and comments ──────────────────

    public function test_getFeed_items_have_like_and_comment_counts(): void
    {
        $row = $this->makeFeedRow([
            'activity_id' => 1,
            'source_type' => 'post',
            'source_id' => 100,
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([
            [$row],
        ]);

        $result = $service->getFeed(10, []);

        $this->assertCount(1, $result['items']);
        $item = $result['items'][0];

        $this->assertArrayHasKey('likes_count', $item);
        $this->assertArrayHasKey('comments_count', $item);
        $this->assertArrayHasKey('is_liked', $item);
        $this->assertSame(0, $item['likes_count']);
        $this->assertSame(0, $item['comments_count']);
        $this->assertFalse($item['is_liked']);
    }

    public function test_getFeed_item_has_correct_shape(): void
    {
        $row = $this->makeFeedRow([
            'activity_id' => 1,
            'source_type' => 'post',
            'source_id' => 100,
            'user_id' => 10,
            'title' => 'My Post',
            'content' => 'Some content',
            'image_url' => '/img/photo.jpg',
            'metadata' => null,
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $result = $service->getFeed(10, []);

        $this->assertNotEmpty($result['items'], 'Feed items should not be empty');
        $item = $result['items'][0];

        $this->assertSame(100, $item['id']);
        $this->assertSame('post', $item['type']);
        $this->assertSame('My Post', $item['title']);
        $this->assertSame('Some content', $item['content']);
        $this->assertFalse($item['content_truncated']);
        $this->assertSame('/img/photo.jpg', $item['image_url']);
        $this->assertIsArray($item['author']);
        $this->assertSame(10, $item['author']['id']);
        $this->assertSame('Test User', $item['author']['name']);
        $this->assertSame('/avatars/test.png', $item['author']['avatar_url']);
        $this->assertIsInt($item['likes_count']);
        $this->assertIsInt($item['comments_count']);
        $this->assertIsBool($item['is_liked']);
        $this->assertArrayHasKey('created_at', $item);
        $this->assertArrayHasKey('_activity_id', $item);
        $this->assertArrayHasKey('_activity_created_at', $item);
    }

    public function test_getFeed_suppresses_historical_remote_podcast_artwork(): void
    {
        $row = $this->makeFeedRow([
            'source_type' => 'podcast_episode',
            'source_id' => 701,
            'image_url' => 'https://tracking.example.test/listener-pixel.png',
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $result = $service->getFeed(10, []);

        $this->assertCount(1, $result['items']);
        $this->assertNull($result['items'][0]['image_url']);
    }

    public function test_getFeed_default_avatar_when_null(): void
    {
        $row = $this->makeFeedRow([
            'author_avatar' => null,
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $result = $service->getFeed(10, []);

        $this->assertNotEmpty($result['items'], 'Feed items should not be empty');
        $item = $result['items'][0];

        $this->assertSame('/assets/img/defaults/default_avatar.png', $item['author']['avatar_url']);
    }

    // ── Additional edge cases ─────────────────────────────────────────

    public function test_getFeed_with_group_filter(): void
    {
        $row = $this->makeFeedRow([
            'activity_id' => 1,
            'group_id' => 5,
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]], groupOwnerId: 10);

        $result = $service->getFeed(10, ['group_id' => 5]);

        $this->assertCount(1, $result['items']);
    }

    public function test_getFeed_with_user_filter(): void
    {
        $row = $this->makeFeedRow([
            'activity_id' => 1,
            'user_id' => 42,
        ]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $result = $service->getFeed(10, ['user_id' => 42]);

        $this->assertCount(1, $result['items']);
        $this->assertSame(42, $result['items'][0]['author']['id']);
    }

    public function test_getFeed_without_current_user(): void
    {
        $row = $this->makeFeedRow();

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $result = $service->getFeed(null, []);

        $this->assertCount(1, $result['items']);
        $this->assertFalse($result['items'][0]['is_liked']);
    }

    public function test_getErrors_returns_empty_initially(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());
        $this->assertEmpty($service->getErrors());
    }

    public function test_getFeed_legacy_cursor_format(): void
    {
        $row = $this->makeFeedRow(['activity_id' => 3, 'source_id' => 103]);

        $service = $this->mockEloquentConnectionAndBuildService([[$row]]);

        $legacyCursor = base64_encode('10');
        $result = $service->getFeed(10, ['cursor' => $legacyCursor]);

        $this->assertCount(1, $result['items']);
    }

    /**
     * The composer's opening markup, verbatim. 64 characters before the member's first word.
     */
    private const COMPOSER_OPEN = '<p class="mb-1 leading-relaxed text-[var(--text-primary)]"><span>';

    private const COMPOSER_CLOSE = '</span></p>';

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function composerPostRow(string $content): object
    {
        return (object) [
            'id' => 100,
            'content' => $content,
            'image_url' => null,
            'created_at' => '2026-03-01 12:00:00',
            'likes_count' => 0,
            'user_id' => 10,
            'type' => 'post',
            'author_name' => 'Test User',
            'author_avatar' => null,
            'comments_count' => 0,
        ];
    }

    /**
     * 🔴 A SHORT post must not be given a "Read more".
     *
     * The preview budget counted raw characters until 2026-08-28. A post written in the web
     * composer is stored as HTML, so six short paragraphs carry ~450 characters of tag before
     * a single word is counted — enough to cross the 500 limit on its own. The member saw a
     * "Read more" on a post that was three sentences long.
     */
    public function test_getItem_does_not_truncate_a_short_post_wrapped_in_composer_markup(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $content = str_repeat(
            self::COMPOSER_OPEN . 'A short line a reader takes in at a glance.' . self::COMPOSER_CLOSE,
            6
        );

        // The premise of the test, asserted rather than assumed.
        $this->assertGreaterThan(500, mb_strlen($content), 'fixture must cross the raw limit');
        $this->assertLessThan(500, mb_strlen(strip_tags($content)), 'its words must not');

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$this->composerPostRow($content)]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $service->getItem('post', 100, 10, false);

        $this->assertFalse($result['content_truncated']);
        $this->assertSame($content, $result['content']);
    }

    /**
     * 🔴 When a cut IS needed it must not land inside a tag.
     *
     * The old cut was a blind `mb_substr`, so it routinely sliced markup in half and left
     * `<p class="mb-1 lead` in the payload. A half-written tag has no closing `>`, so a
     * tag-stripper cannot match it and the fragment reaches the member's screen — which is
     * exactly what the phone showed.
     */
    public function test_getItem_never_leaves_a_half_written_tag_in_a_truncated_preview(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        // Positioned deliberately: `<p>` is 3 characters, then 490 of text, so the 500th RAW
        // character lands INSIDE the `<span class="highlight">` that follows. A fixture whose
        // 500th character happens to fall in open text cannot show this fault at all.
        $content = '<p>' . str_repeat('x', 490) . '<span class="highlight">more words here</span></p>';

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$this->composerPostRow($content)]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $service->getItem('post', 100, 10, false);
        $preview = $result['content'];

        $this->assertTrue($result['content_truncated']);
        $this->assertSame(0, preg_match('/<[^>]*$/', $preview), 'preview ends mid-tag');
        $this->assertStringNotContainsString('class=', strip_tags($preview));
    }

    /**
     * The cut closes what it opened, so the preview is still whole markup.
     *
     * The ellipsis belongs INSIDE the last element: appended after `</p>` it becomes a
     * paragraph of its own, which is why a stray "..." appeared on its own line in the app.
     */
    public function test_getItem_closes_open_tags_and_keeps_the_ellipsis_inside_the_paragraph(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        $content = self::COMPOSER_OPEN . str_repeat('word ', 300) . self::COMPOSER_CLOSE;

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$this->composerPostRow($content)]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $preview = $service->getItem('post', 100, 10, false)['content'];

        $this->assertStringEndsWith('...' . self::COMPOSER_CLOSE, $preview);
        $this->assertSame(
            substr_count($preview, '<span'),
            substr_count($preview, '</span>'),
            'every opened span is closed again'
        );
    }

    /**
     * The preview is trimmed on a word boundary, so the last word is whole.
     */
    public function test_getItem_cuts_a_preview_on_a_word_boundary(): void
    {
        $service = new FeedService(new FeedActivity(), new FeedPost());

        // 21 characters per repeat, so the 500th character falls 17 letters into a word. A
        // blind cut ends on 'supercalifragili'; a word-boundary cut ends on a whole word.
        $content = str_repeat('supercalifragilistic ', 40);

        $this->stubFeedItemTablesPermissive();
        DB::shouldReceive('select')->once()->andReturn([$this->composerPostRow($content)]);
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $preview = $service->getItem('post', 100, 10, false)['content'];
        $words = preg_split('/\s+/', trim(str_replace('...', '', $preview)));
        $lastWord = is_array($words) ? (string) end($words) : '';

        $this->assertSame('supercalifragilistic', $lastWord, 'preview ends on half a word');
    }
}
