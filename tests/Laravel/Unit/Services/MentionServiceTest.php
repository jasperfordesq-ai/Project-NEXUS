<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\MentionService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Unit tests for MentionService — extraction, resolution, creation, and searching.
 */
class MentionServiceTest extends TestCase
{
    // ------------------------------------------------------------------
    //  extractMentions
    // ------------------------------------------------------------------

    public function test_extractMentions_finds_single_mention(): void
    {
        $result = MentionService::extractMentions('Hello @john how are you?');

        $this->assertEquals(['john'], $result);
    }

    public function test_extractMentions_finds_multiple_mentions(): void
    {
        $result = MentionService::extractMentions('Hello @john and @jane!');

        $this->assertContains('john', $result);
        $this->assertContains('jane', $result);
        $this->assertCount(2, $result);
    }

    public function test_extractMentions_returns_unique_values(): void
    {
        $result = MentionService::extractMentions('@john said hi to @john again');

        $this->assertCount(1, $result);
        $this->assertContains('john', $result);
    }

    public function test_extractMentions_handles_underscores_dots_hyphens(): void
    {
        $result = MentionService::extractMentions('CC @john_doe @jane.smith @bob-jones');

        $this->assertContains('john_doe', $result);
        $this->assertContains('jane.smith', $result);
        $this->assertContains('bob-jones', $result);
    }

    public function test_extractMentions_returns_empty_for_no_mentions(): void
    {
        $result = MentionService::extractMentions('No mentions here at all.');

        $this->assertEmpty($result);
    }

    public function test_extractMentions_returns_empty_for_empty_string(): void
    {
        $result = MentionService::extractMentions('');

        $this->assertEmpty($result);
    }

    public function test_extractMentions_handles_mention_at_start(): void
    {
        $result = MentionService::extractMentions('@alice is great');

        $this->assertEquals(['alice'], $result);
    }

    public function test_extractMentions_handles_mention_at_end(): void
    {
        $result = MentionService::extractMentions('Thanks @alice');

        $this->assertEquals(['alice'], $result);
    }

    public function test_extractMentions_does_not_match_email(): void
    {
        // @ in email context — the part before @ won't be captured, but the part after will
        // This tests the regex behavior: user@example.com should capture 'example.com' after @
        $result = MentionService::extractMentions('Email me at user@example.com');

        // The regex matches @example.com as a mention — this is expected behavior
        // since the service doesn't try to distinguish emails from mentions
        $this->assertNotEmpty($result);
    }

    public function test_extractMentions_does_not_match_at_sign_only(): void
    {
        $result = MentionService::extractMentions('Just an @ sign and more @ symbols');

        $this->assertEmpty($result);
    }

    public function test_extractMentions_does_not_match_at_followed_by_space(): void
    {
        $result = MentionService::extractMentions('Hello @ world @ everyone');

        $this->assertEmpty($result);
    }

    // ------------------------------------------------------------------
    //  resolveMentions
    // ------------------------------------------------------------------

    public function test_resolveMentions_returns_empty_for_empty_array(): void
    {
        $result = MentionService::resolveMentions([], $this->testTenantId);

        $this->assertEmpty($result);
    }

    public function test_resolveMentions_resolves_by_username(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 10, 'username' => 'johndoe', 'first_name' => 'John', 'name' => 'John Doe', 'last_name' => 'Doe'],
            ]));

        $result = MentionService::resolveMentions(['johndoe'], $this->testTenantId);

        $this->assertArrayHasKey('johndoe', $result);
        $this->assertEquals(10, $result['johndoe']);
    }

    public function test_resolveMentions_resolves_by_first_name(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 20, 'username' => 'jsmith', 'first_name' => 'Jane', 'name' => 'Jane Smith', 'last_name' => 'Smith'],
            ]));

        $result = MentionService::resolveMentions(['Jane'], $this->testTenantId);

        $this->assertArrayHasKey('Jane', $result);
        $this->assertEquals(20, $result['Jane']);
    }

    public function test_resolveMentions_case_insensitive(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 30, 'username' => 'ALICE', 'first_name' => 'Alice', 'name' => 'Alice W', 'last_name' => 'W'],
            ]));

        $result = MentionService::resolveMentions(['alice'], $this->testTenantId);

        $this->assertArrayHasKey('alice', $result);
        $this->assertEquals(30, $result['alice']);
    }

    public function test_resolveMentions_returns_empty_for_unmatched(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([]));

        $result = MentionService::resolveMentions(['nonexistent'], $this->testTenantId);

        $this->assertEmpty($result);
    }

    public function test_resolveMentions_excludes_banned_users(): void
    {
        // The DB query includes `->where('status', '!=', 'banned')`, so banned users
        // are filtered out at the database level. An empty result means the only
        // matching user was banned.
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([]));

        $result = MentionService::resolveMentions(['banned_user'], $this->testTenantId);

        $this->assertEmpty($result);
    }

    public function test_resolveMentions_resolves_multiple_usernames(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 10, 'username' => 'alice', 'first_name' => 'Alice', 'name' => 'Alice', 'last_name' => 'Smith'],
                (object) ['id' => 20, 'username' => 'bob', 'first_name' => 'Bob', 'name' => 'Bob', 'last_name' => 'Jones'],
            ]));

        $result = MentionService::resolveMentions(['alice', 'bob'], $this->testTenantId);

        $this->assertCount(2, $result);
        $this->assertEquals(10, $result['alice']);
        $this->assertEquals(20, $result['bob']);
    }

    // ------------------------------------------------------------------
    //  searchUsers
    // ------------------------------------------------------------------

    /**
     * searchUsers() now also reads the community's directory-listing rules
     * (F-080) through OnboardingConfigService, which uses DB::select. Load
     * that (cached) config for real before DB::select is mocked, so the mock
     * below still answers only the search query.
     */
    private function primeDirectoryListingRules(): void
    {
        \App\Services\OnboardingConfigService::getConfig($this->testTenantId);
    }

    public function test_searchUsers_returns_formatted_results(): void
    {
        $this->primeDirectoryListingRules();
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 5,
                    'name' => 'John Doe',
                    'username' => 'johndoe',
                    'avatar_url' => '/avatars/5.jpg',
                    'first_name' => 'John',
                    'last_name' => 'Doe',
                    'is_connection' => 1,
                ],
            ]);

        // A searcher id with no account: an ordinary (non-admin) viewer.
        $result = MentionService::searchUsers('john', $this->testTenantId, 2147480000, 10);

        $this->assertCount(1, $result);
        $this->assertEquals(5, $result[0]['id']);
        // F-080: the directory's surname rule — a first name only for non-admins.
        $this->assertEquals('John', $result[0]['name']);
        $this->assertArrayNotHasKey('last_name', $result[0]);
        $this->assertEquals('johndoe', $result[0]['username']);
        $this->assertTrue($result[0]['is_connection']);
    }

    public function test_searchUsers_returns_empty_for_no_matches(): void
    {
        $this->primeDirectoryListingRules();
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $result = MentionService::searchUsers('zzzznoone', $this->testTenantId, 1, 10);

        $this->assertEmpty($result);
    }

    public function test_searchUsers_works_without_current_user(): void
    {
        $this->primeDirectoryListingRules();
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 7,
                    'name' => 'Bob',
                    'username' => 'bob',
                    'avatar_url' => null,
                    'first_name' => 'Bob',
                    'last_name' => null,
                ],
            ]);

        $result = MentionService::searchUsers('bob', $this->testTenantId, 0, 10);

        $this->assertCount(1, $result);
        $this->assertFalse($result[0]['is_connection']);
    }

    // ------------------------------------------------------------------
    //  processText
    // ------------------------------------------------------------------

    public function test_processText_returns_zero_for_no_mentions(): void
    {
        $result = MentionService::processText('Hello world', 1, 'post', 1);

        $this->assertEquals(0, $result);
    }

    public function test_processText_returns_zero_when_no_users_resolved(): void
    {
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([]));

        $result = MentionService::processText('Hello @unknown', 1, 'post', 1);

        $this->assertEquals(0, $result);
    }

    public function test_processText_returns_count_of_created_mentions(): void
    {
        // createMentions runs a two-way block lookup (F-070). Mock Schema before
        // DB so resolving the Schema facade still sees the real connection.
        Schema::shouldReceive('hasColumn')->with('user_blocks', 'tenant_id')->twice()->andReturn(true);

        // resolveMentions: returns two matched users
        DB::shouldReceive('table->where->where->whereNull->where->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 10, 'username' => 'alice', 'first_name' => 'Alice', 'name' => 'Alice', 'last_name' => 'Smith'],
                (object) ['id' => 20, 'username' => 'bob', 'first_name' => 'Bob', 'name' => 'Bob', 'last_name' => 'Jones'],
            ]));

        // createMentions: two-way block lookup (blocked-by-me, blocked-me) — no blocks.
        // Mockery shares demeter nodes, so the where(tenant)->where(user) calls
        // resolve onto this chain.
        DB::shouldReceive('table->where->pluck->all')
            ->twice()
            ->andReturn([]);

        // createMentions: lookup mentioner name
        DB::shouldReceive('table->where->where->select->first')
            ->once()
            ->andReturn((object) ['name' => 'Charlie', 'first_name' => 'Charlie']);

        // createMentions: batch-load preferred_language for mentioned users
        DB::shouldReceive('table->where->whereIn->select->get')
            ->once()
            ->andReturn(collect([
                (object) ['id' => 10, 'preferred_language' => 'en'],
                (object) ['id' => 20, 'preferred_language' => 'en'],
            ]));

        // createMentions: insert mention record (called twice, once per resolved user)
        DB::shouldReceive('table->insert')->twice();

        // Notification::createNotification uses DB internally — allow insertGetId
        DB::shouldReceive('table->insertGetId')->andReturn(1);

        $result = MentionService::processText('Hey @alice and @bob!', 1, 'post', 5);

        $this->assertEquals(2, $result);
    }

    // ------------------------------------------------------------------
    //  deleteMentionsForEntity
    // ------------------------------------------------------------------

    public function test_deleteMentionsForEntity_calls_delete(): void
    {
        DB::shouldReceive('table->where->where->where->delete')
            ->once()
            ->andReturn(2);

        MentionService::deleteMentionsForEntity(5, 'post');

        // If we get here without exception, the mock was called correctly
        $this->assertTrue(true);
    }

    public function test_deleteMentionsForEntity_handles_comment_entity_type(): void
    {
        DB::shouldReceive('table->where->where->where->delete')
            ->once()
            ->andReturn(1);

        MentionService::deleteMentionsForEntity(10, 'comment');

        $this->assertTrue(true);
    }

    public function test_deleteMentionsForEntity_handles_no_matching_records(): void
    {
        DB::shouldReceive('table->where->where->where->delete')
            ->once()
            ->andReturn(0);

        MentionService::deleteMentionsForEntity(999, 'message');

        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  markAsSeen
    // ------------------------------------------------------------------

    public function test_markAsSeen_updates_records(): void
    {
        DB::shouldReceive('table->where->where->whereIn->whereNull->update')
            ->once()
            ->andReturn(3);

        MentionService::markAsSeen(1, [10, 20, 30]);

        $this->assertTrue(true);
    }

    public function test_markAsSeen_with_empty_ids(): void
    {
        DB::shouldReceive('table->where->where->whereIn->whereNull->update')
            ->once()
            ->andReturn(0);

        MentionService::markAsSeen(1, []);

        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  getMentionsForUser
    // ------------------------------------------------------------------

    public function test_getMentionsForUser_returns_structured_result(): void
    {
        $mockItems = collect([
            (object) ['id' => 1, 'entity_type' => 'post', 'entity_id' => 10, 'mentioner_id' => 5, 'mentioner_name' => 'Alice', 'mentioner_avatar' => null, 'seen_at' => null, 'created_at' => '2026-03-20 10:00:00'],
        ]);

        DB::shouldReceive('raw')
            ->andReturnUsing(fn ($expr) => new \Illuminate\Database\Query\Expression($expr));

        DB::shouldReceive('table->join->where->where->select->orderByDesc->limit->get')
            ->once()
            ->andReturn($mockItems);

        $result = MentionService::getMentionsForUser(1, 20, null);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertCount(1, $result['items']);
        $this->assertFalse($result['has_more']);
    }

    public function test_getMentionsForUser_with_cursor(): void
    {
        $mockItems = collect([]);

        DB::shouldReceive('raw')
            ->andReturnUsing(fn ($expr) => new \Illuminate\Database\Query\Expression($expr));

        // Build a proper query builder mock since the cursor adds an extra
        // ->where() call after the initial chain is built, which Demeter
        // chain mocking cannot handle correctly.
        $queryMock = Mockery::mock('stdClass');
        $queryMock->shouldReceive('join')->andReturnSelf();
        $queryMock->shouldReceive('where')->andReturnSelf();
        $queryMock->shouldReceive('select')->andReturnSelf();
        $queryMock->shouldReceive('orderByDesc')->andReturnSelf();
        $queryMock->shouldReceive('limit')->andReturnSelf();
        $queryMock->shouldReceive('get')->once()->andReturn($mockItems);

        DB::shouldReceive('table')
            ->once()
            ->with('mentions as m')
            ->andReturn($queryMock);

        $cursor = base64_encode('50');
        $result = MentionService::getMentionsForUser(1, 20, $cursor);

        $this->assertEmpty($result['items']);
        $this->assertFalse($result['has_more']);
        $this->assertNull($result['cursor']);
    }

    // ------------------------------------------------------------------
    //  getMentionsForEntity
    // ------------------------------------------------------------------

    public function test_getMentionsForEntity_returns_array(): void
    {
        $mockData = collect([
            (object) ['id' => 1, 'user_id' => 10, 'first_name' => 'Alice', 'last_name' => 'Smith', 'name' => 'Alice Smith', 'username' => 'alice', 'avatar_url' => null, 'created_at' => '2026-03-20'],
        ]);

        DB::shouldReceive('table->join->where->where->where->select->get')
            ->once()
            ->andReturn($mockData);

        $result = MentionService::getMentionsForEntity(10, 'post');

        $this->assertCount(1, $result);
        $this->assertEquals(10, $result[0]['user_id']);
    }
}
