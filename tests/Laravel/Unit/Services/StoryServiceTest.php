<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\StoryService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * Unit tests for StoryService — create, view, react, poll, highlight, cleanup.
 */
class StoryServiceTest extends TestCase
{
    private StoryService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new StoryService();
    }

    // ------------------------------------------------------------------
    //  create
    // ------------------------------------------------------------------

    public function test_create_throws_when_max_active_stories_reached(): void
    {
        // DB::transaction() executes the closure — mock it to pass through
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['cnt' => 30]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Maximum active stories limit reached');

        $this->service->create(1, ['media_type' => 'text', 'text_content' => 'Hello']);
    }

    public function test_create_text_story_inserts_record(): void
    {
        // DB::transaction() executes the closure
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        // selectOne is called three times, in order:
        //  1) active-count check (inside the transaction, FOR UPDATE)
        //  2) notifyConnections — story author name lookup
        //  3) getStoryById — the created story row (joined with user)
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['cnt' => 0]);

        // Insert
        DB::shouldReceive('insert')
            ->once()
            ->andReturn(true);

        // getPdo()->lastInsertId()
        $mockPdo = \Mockery::mock(\PDO::class);
        $mockPdo->shouldReceive('lastInsertId')->andReturn('42');
        DB::shouldReceive('getPdo')->once()->andReturn($mockPdo);

        // notifyConnections — author lookup, then accepted-connections list (none)
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['first_name' => 'Test', 'last_name' => 'User']);

        // getStoryById (inner query joined with the author)
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) [
                'id' => 42,
                'user_id' => 1,
                'media_type' => 'text',
                'media_url' => null,
                'thumbnail_url' => null,
                'text_content' => 'Hello world',
                'text_style' => null,
                'background_color' => '#FF0000',
                'background_gradient' => null,
                'duration' => 5,
                'view_count' => 0,
                'is_viewed' => 0,
                'expires_at' => '2026-03-24 10:00:00',
                'created_at' => '2026-03-23 10:00:00',
                'first_name' => 'Test',
                'last_name' => 'User',
                'avatar_url' => null,
                'poll_question' => null,
                'poll_options' => null,
            ]);

        // DB::select is called for: notifyConnections (connections list) and
        // getStickers (story stickers) — both empty here.
        DB::shouldReceive('select')->andReturn([]);

        $result = $this->service->create(1, [
            'media_type' => 'text',
            'text_content' => 'Hello world',
            'background_color' => '#FF0000',
        ]);

        $this->assertEquals(42, $result['id']);
        $this->assertEquals('text', $result['media_type']);
    }

    public function test_create_poll_story_requires_question(): void
    {
        // Poll validation happens before the transaction — no DB calls needed
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Poll question is required');

        $this->service->create(1, [
            'media_type' => 'poll',
            'poll_options' => ['A', 'B'],
        ]);
    }

    public function test_create_poll_story_requires_2_to_4_options(): void
    {

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Poll stories require 2 to 4 options');

        $this->service->create(1, [
            'media_type' => 'poll',
            'poll_question' => 'Test?',
            'poll_options' => ['Only one option'],
        ]);
    }

    public function test_create_clamps_duration(): void
    {
        // DB::transaction() executes the closure
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        // active-count check (inside transaction)
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['cnt' => 0]);

        // Capture the insert parameters to verify duration clamping
        DB::shouldReceive('insert')
            ->once()
            ->withArgs(function ($sql, $bindings) {
                // Duration is at index 9 in the bindings array
                // min(max(1, 3), 30) = 3 (clamped from 1 to 3)
                return $bindings[9] === 3;
            })
            ->andReturn(true);

        $mockPdo = \Mockery::mock(\PDO::class);
        $mockPdo->shouldReceive('lastInsertId')->andReturn('1');
        DB::shouldReceive('getPdo')->once()->andReturn($mockPdo);

        // notifyConnections author lookup
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['first_name' => 'Test', 'last_name' => 'User']);

        // getStoryById
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) [
                'id' => 1, 'user_id' => 1, 'media_type' => 'text', 'media_url' => null,
                'thumbnail_url' => null, 'text_content' => 'Test', 'text_style' => null,
                'background_color' => null, 'background_gradient' => null, 'duration' => 3,
                'view_count' => 0, 'is_viewed' => 0, 'expires_at' => '2026-03-24',
                'created_at' => '2026-03-23', 'first_name' => 'Test', 'last_name' => 'User',
                'avatar_url' => null, 'poll_question' => null, 'poll_options' => null,
            ]);

        // connections list + stickers — both empty
        DB::shouldReceive('select')->andReturn([]);

        $this->service->create(1, [
            'media_type' => 'text',
            'text_content' => 'Test',
            'duration' => 1, // Below minimum of 3
        ]);
    }

    // ------------------------------------------------------------------
    //  viewStory
    // ------------------------------------------------------------------

    public function test_viewStory_ignores_nonexistent_story(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        // Should not throw, just return silently
        $this->service->viewStory(999, 1);
        $this->assertTrue(true);
    }

    public function test_viewStory_skips_self_view(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'user_id' => 5]);

        // No view INSERT or count increment should happen on a self-view.
        DB::shouldNotReceive('affectingStatement');
        DB::shouldNotReceive('update');

        $this->service->viewStory(1, 5);
        $this->assertTrue(true);
    }

    public function test_viewStory_inserts_view_and_increments_count(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'user_id' => 10]);

        // INSERT IGNORE now goes through affectingStatement so the service can
        // tell whether a NEW view row was written (affected > 0) and only then
        // increment view_count.
        DB::shouldReceive('affectingStatement')
            ->once()
            ->andReturn(1);

        DB::shouldReceive('update')
            ->once()
            ->andReturn(1);

        $this->service->viewStory(1, 5);
        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  getViewers
    // ------------------------------------------------------------------

    public function test_getViewers_throws_for_nonexistent_story(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Story not found');

        $this->service->getViewers(999, 1);
    }

    public function test_getViewers_throws_for_non_owner(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'user_id' => 10]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Only the story owner can view the viewers list');

        $this->service->getViewers(1, 5); // User 5 is not owner (user 10)
    }

    public function test_getViewers_returns_viewer_list_for_owner(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'user_id' => 999999990]);

        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['id' => 5, 'first_name' => 'Alice', 'last_name' => 'Smith', 'avatar_url' => null, 'viewed_at' => '2026-03-23 12:00:00'],
            ]);

        // An owner id with no users row: an ordinary (non-admin) owner.
        $viewers = $this->service->getViewers(1, 999999990);

        $this->assertCount(1, $viewers);
        $this->assertEquals(5, $viewers[0]['id']);
        // F-084: the owner sees viewers by first name; surnames are for admins.
        $this->assertEquals('Alice', $viewers[0]['name']);
    }

    // ------------------------------------------------------------------
    //  reactToStory
    // ------------------------------------------------------------------

    public function test_reactToStory_throws_for_nonexistent_story(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Story not found');

        $this->service->reactToStory(999, 1, 'heart');
    }

    public function test_reactToStory_throws_for_invalid_reaction(): void
    {
        // Story row now carries user_id (canViewStory reads it). Reactor is the
        // owner here, so visibility passes and we reach the reaction-type guard.
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'user_id' => 1]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Invalid reaction type');

        $this->service->reactToStory(1, 1, 'invalid_type');
    }

    public function test_reactToStory_inserts_valid_reaction(): void
    {
        // Reactor (5) is the story owner → the reaction-broadcast block is skipped
        // (it only fires for non-owner reactors), keeping the DB sequence minimal.
        // 1) story lookup, 2) existing-reaction check (none).
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 1, 'user_id' => 5]);
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn(null);

        DB::shouldReceive('insert')
            ->once()
            ->andReturn(true);

        $this->service->reactToStory(1, 5, 'heart');
        $this->assertTrue(true);
    }

    public function test_reactToStory_accepts_all_valid_types(): void
    {
        $validTypes = ['heart', 'laugh', 'wow', 'fire', 'clap', 'sad'];

        foreach ($validTypes as $type) {
            // story lookup (owner == reactor), then existing-reaction check (none)
            DB::shouldReceive('selectOne')
                ->once()
                ->ordered()
                ->andReturn((object) ['id' => 1, 'user_id' => 5]);
            DB::shouldReceive('selectOne')
                ->once()
                ->ordered()
                ->andReturn(null);

            DB::shouldReceive('insert')
                ->once()
                ->andReturn(true);

            $this->service->reactToStory(1, 5, $type);
        }

        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  deleteStory
    // ------------------------------------------------------------------

    public function test_deleteStory_throws_for_non_owner(): void
    {
        DB::shouldReceive('update')
            ->once()
            ->andReturn(0);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Story not found or you are not the owner');

        $this->service->deleteStory(1, 999);
    }

    public function test_deleteStory_soft_deletes_for_owner(): void
    {
        DB::shouldReceive('update')
            ->once()
            ->andReturn(1);

        $this->service->deleteStory(1, 5);
        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  votePoll
    // ------------------------------------------------------------------

    public function test_votePoll_throws_for_nonexistent_story(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Story not found');

        $this->service->votePoll(999, 1, 0);
    }

    public function test_votePoll_throws_for_non_poll_story(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1, 'media_type' => 'text', 'poll_options' => null]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('This story is not a poll');

        $this->service->votePoll(1, 1, 0);
    }

    public function test_votePoll_throws_for_invalid_option_index(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) [
                'id' => 1,
                'user_id' => 1,
                'media_type' => 'poll',
                'poll_options' => json_encode(['Red', 'Blue']),
            ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Invalid option index');

        $this->service->votePoll(1, 1, 99);
    }

    public function test_votePoll_throws_for_duplicate_vote(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) [
                'id' => 1,
                'media_type' => 'poll',
                'poll_options' => json_encode(['Red', 'Blue']),
            ]);

        // The check-then-insert is now wrapped in a transaction to close a
        // double-vote race. Execute the closure directly so the body runs.
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        // Already voted (inside the transaction)
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 100]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('You have already voted on this poll');

        $this->service->votePoll(1, 1, 0);
    }

    public function test_votePoll_inserts_vote_and_returns_results(): void
    {
        // Story lookup
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) [
                'id' => 1,
                'user_id' => 1,
                'media_type' => 'poll',
                'poll_options' => json_encode(['Red', 'Blue', 'Green']),
            ]);

        // Vote write is wrapped in a transaction; run the closure inline.
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        // Existing vote check (none)
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        // Vote insert now goes through the query builder's insertOrIgnore.
        $voteTable = \Mockery::mock();
        $voteTable->shouldReceive('insertOrIgnore')->once()->andReturn(1);
        DB::shouldReceive('table')
            ->with('story_poll_votes')
            ->once()
            ->andReturn($voteTable);

        // getPollResults
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['option_index' => 0, 'vote_count' => 3],
                (object) ['option_index' => 1, 'vote_count' => 5],
            ]);

        $result = $this->service->votePoll(1, 1, 0);

        $this->assertArrayHasKey('votes', $result);
        $this->assertArrayHasKey('total_votes', $result);
        $this->assertEquals(8, $result['total_votes']);
        $this->assertEquals(3, $result['votes'][0]);
        $this->assertEquals(5, $result['votes'][1]);
    }

    // ------------------------------------------------------------------
    //  getPollResults
    // ------------------------------------------------------------------

    public function test_getPollResults_returns_votes_and_total(): void
    {
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['option_index' => 0, 'vote_count' => 10],
                (object) ['option_index' => 1, 'vote_count' => 7],
            ]);

        $result = $this->service->getPollResults(1);

        $this->assertEquals(17, $result['total_votes']);
        $this->assertEquals(10, $result['votes'][0]);
        $this->assertEquals(7, $result['votes'][1]);
    }

    public function test_getPollResults_returns_empty_for_no_votes(): void
    {
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $result = $this->service->getPollResults(1);

        $this->assertEquals(0, $result['total_votes']);
        $this->assertEmpty($result['votes']);
    }

    // ------------------------------------------------------------------
    //  createHighlight
    // ------------------------------------------------------------------

    public function test_createHighlight_inserts_and_returns_result(): void
    {
        // Get max display_order
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['max_order' => 2]);

        // Insert highlight
        DB::shouldReceive('insert')
            ->once()
            ->andReturn(true);

        $mockPdo = \Mockery::mock(\PDO::class);
        $mockPdo->shouldReceive('lastInsertId')->andReturn('10');
        DB::shouldReceive('getPdo')->once()->andReturn($mockPdo);

        // getHighlightById
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) [
                'id' => 10,
                'title' => 'My Highlight',
                'cover_url' => null,
                'story_count' => 0,
                'display_order' => 3,
                'created_at' => '2026-03-23',
            ]);

        $result = $this->service->createHighlight(1, 'My Highlight');

        $this->assertEquals(10, $result['id']);
        $this->assertEquals('My Highlight', $result['title']);
        $this->assertEquals(3, $result['display_order']);
    }

    // ------------------------------------------------------------------
    //  deleteHighlight
    // ------------------------------------------------------------------

    public function test_deleteHighlight_throws_for_non_owner(): void
    {
        DB::shouldReceive('delete')
            ->once()
            ->andReturn(0);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Highlight not found or you are not the owner');

        $this->service->deleteHighlight(1, 999);
    }

    public function test_deleteHighlight_deletes_for_owner(): void
    {
        DB::shouldReceive('delete')
            ->once()
            ->andReturn(1);

        $this->service->deleteHighlight(1, 5);
        $this->assertTrue(true);
    }

    // ------------------------------------------------------------------
    //  addToHighlight
    // ------------------------------------------------------------------

    public function test_addToHighlight_throws_for_non_owner(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn(null);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Highlight not found or you are not the owner');

        $this->service->addToHighlight(1, 10, 999);
    }

    public function test_addToHighlight_inserts_item(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1]);

        // F-067: the story must belong to the highlight owner.
        $this->expectStoryOwnership(true);

        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['max_order' => 3]);

        DB::shouldReceive('insert')
            ->once()
            ->andReturn(true);

        $this->service->addToHighlight(1, 10, 5);
        $this->assertTrue(true);
    }

    public function test_addToHighlight_refuses_a_story_the_owner_did_not_post(): void
    {
        DB::shouldReceive('selectOne')
            ->once()
            ->andReturn((object) ['id' => 1]);

        $this->expectStoryOwnership(false);

        DB::shouldReceive('insert')->never();

        $this->expectException(\RuntimeException::class);
        $this->service->addToHighlight(1, 10, 5);
    }

    private function expectStoryOwnership(bool $owns): void
    {
        $builder = \Mockery::mock(\Illuminate\Database\Query\Builder::class);
        $builder->shouldReceive('where')->andReturnSelf();
        $builder->shouldReceive('exists')->once()->andReturn($owns);
        DB::shouldReceive('table')->with('stories')->once()->andReturn($builder);
    }

    // ------------------------------------------------------------------
    //  getHighlights
    // ------------------------------------------------------------------

    public function test_getHighlights_returns_formatted_list(): void
    {
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) ['id' => 1, 'title' => 'Travel', 'cover_url' => '/img/1.jpg', 'story_count' => 5, 'display_order' => 1, 'created_at' => '2026-03-20'],
                (object) ['id' => 2, 'title' => 'Food', 'cover_url' => null, 'story_count' => 2, 'display_order' => 2, 'created_at' => '2026-03-21'],
            ]);

        $result = $this->service->getHighlights(1);

        $this->assertCount(2, $result);
        $this->assertEquals('Travel', $result[0]['title']);
        $this->assertEquals(5, $result[0]['story_count']);
        $this->assertEquals('Food', $result[1]['title']);
    }

    // ------------------------------------------------------------------
    //  cleanupExpired
    // ------------------------------------------------------------------

    public function test_cleanupExpired_deactivates_and_cleans_media(): void
    {
        // Archive step (INSERT IGNORE ... SELECT) runs first via affectingStatement.
        DB::shouldReceive('affectingStatement')
            ->once()
            ->andReturn(0);

        // Deactivate expired
        DB::shouldReceive('update')
            ->once()
            ->andReturn(3);

        Log::shouldReceive('info')
            ->once()
            ->with('StoryService: Deactivated 3 expired stories');

        // Old stories query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $this->service->cleanupExpired();
        $this->assertTrue(true);
    }

    public function test_cleanupExpired_skips_logging_when_nothing_to_deactivate(): void
    {
        // Nothing archived and nothing deactivated.
        DB::shouldReceive('affectingStatement')
            ->once()
            ->andReturn(0);

        DB::shouldReceive('update')
            ->once()
            ->andReturn(0);

        // Swap Log facade with a spy so we can assert calls afterward
        Log::spy();

        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $this->service->cleanupExpired();

        // info should NOT have been called for deactivation since count is 0
        Log::shouldNotHaveReceived('info', fn ($msg) => str_contains($msg, 'Deactivated'));
    }

    // ------------------------------------------------------------------
    //  getFeedStories
    // ------------------------------------------------------------------

    public function test_getFeedStories_returns_sorted_array(): void
    {
        // Active stories query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'user_id' => 1,
                    'first_name' => 'Alice',
                    'last_name' => 'Smith',
                    'avatar_url' => null,
                    'story_count' => 2,
                    'latest_story_at' => '2026-03-23 12:00:00',
                    'unseen_count' => 1,
                ],
            ]);

        // Connections query
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $result = $this->service->getFeedStories(1);

        $this->assertCount(1, $result);
        $this->assertEquals(1, $result[0]['user_id']);
        $this->assertTrue($result[0]['is_own']);
        $this->assertTrue($result[0]['has_unseen']);
    }

    public function test_getFeedStories_returns_empty_when_no_stories(): void
    {
        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        DB::shouldReceive('select')
            ->once()
            ->andReturn([]);

        $result = $this->service->getFeedStories(1);

        $this->assertEmpty($result);
    }

    // ------------------------------------------------------------------
    //  getUserStories
    // ------------------------------------------------------------------

    public function test_getUserStories_returns_formatted_stories(): void
    {
        DB::shouldReceive('select')
            ->once()
            ->andReturn([
                (object) [
                    'id' => 10,
                    'user_id' => 5,
                    'media_type' => 'text',
                    'media_url' => null,
                    'thumbnail_url' => null,
                    'text_content' => 'Hello',
                    'text_style' => null,
                    'background_color' => '#000',
                    'background_gradient' => null,
                    'duration' => 5,
                    'view_count' => 3,
                    'is_viewed' => 0,
                    'expires_at' => '2026-03-24',
                    'created_at' => '2026-03-23',
                    'first_name' => 'Bob',
                    'last_name' => 'Jones',
                    'avatar_url' => null,
                    'poll_question' => null,
                    'poll_options' => null,
                ],
            ]);

        // formatStory() now loads stickers per story via a second DB::select.
        DB::shouldReceive('select')
            ->andReturn([]);

        $result = $this->service->getUserStories(5, 1);

        $this->assertCount(1, $result);
        $this->assertEquals(10, $result[0]['id']);
        $this->assertEquals('text', $result[0]['media_type']);
        $this->assertFalse($result[0]['is_viewed']);
    }
}
