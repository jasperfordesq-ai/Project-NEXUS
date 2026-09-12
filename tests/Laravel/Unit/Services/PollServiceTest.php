<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\PollService;
use App\Models\Poll;
use Illuminate\Support\Facades\DB;
use Mockery;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class PollServiceTest extends TestCase
{
    private $pollAlias;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pollAlias = Mockery::mock('alias:' . Poll::class);
    }

    // ── getById ──

    public function test_getById_returns_null_when_not_found(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('with')->andReturnSelf();
        $mockQuery->shouldReceive('find')->with(0)->andReturn(null);
        $this->pollAlias->shouldReceive('query')->andReturn($mockQuery);

        $result = PollService::getById(0);
        $this->assertNull($result);
    }

    // ── vote ──

    public function test_vote_returns_false_if_already_voted(): void
    {
        // vote() is now wrapped in a transaction; run the closure inline.
        DB::shouldReceive('transaction')
            ->once()
            ->andReturnUsing(fn (callable $cb) => $cb());

        // 1) poll lookup (no end_date → not expired), 2) option validation (exists).
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 1, 'user_id' => 1, 'end_date' => null]);
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 10]);

        // INSERT IGNORE affected 0 rows → the user had already voted.
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 99]);

        DB::shouldReceive('affectingStatement')->never();

        $result = PollService::vote(1, 10, 1);
        $this->assertFalse($result);
    }

    public function test_vote_inserts_and_returns_true(): void
    {
        // Twice, not once: vote() wraps the whole cast, and the XP award inside it
        // opens its own transaction (GamificationService::awardXP), which against a
        // real connection nests as a savepoint.
        DB::shouldReceive('transaction')
            ->twice()
            ->andReturnUsing(fn (callable $cb) => $cb());

        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 1, 'user_id' => 1, 'end_date' => null]);
        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn((object) ['id' => 10]);

        DB::shouldReceive('selectOne')
            ->once()
            ->ordered()
            ->andReturn(null);

        // INSERT IGNORE wrote a new row → vote cast.
        DB::shouldReceive('affectingStatement')
            ->once()
            ->andReturn(1);

        // After awarding XP the vote re-reads user_xp_log to confirm the award
        // actually persisted before reporting success, so the facade must offer
        // table(). A partial DB mock has to cover every method the real chain
        // calls or Mockery raises BadMethodCallException.
        $xpLogQuery = Mockery::mock();
        $xpLogQuery->shouldReceive('where')->andReturnSelf();
        $xpLogQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('user_xp_log')->andReturn($xpLogQuery);

        $result = PollService::vote(1, 10, 1);
        $this->assertTrue($result);
    }

    // ── delete ──

    public function test_delete_returns_false_for_wrong_owner(): void
    {
        $poll = (object) ['user_id' => 5];

        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('find')->with(1)->andReturn($poll);
        $this->pollAlias->shouldReceive('query')->andReturn($mockQuery);

        $result = PollService::delete(1, 99);
        $this->assertFalse($result);
    }

    // ── getErrors ──

    public function test_getErrors_returns_empty_array(): void
    {
        $result = PollService::getErrors();
        $this->assertEquals([], $result);
    }

    // ── getCategories ──

    public function test_getCategories_returns_array(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('whereNotNull')->andReturnSelf();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('distinct')->andReturnSelf();
        $mockQuery->shouldReceive('pluck')->andReturn(collect(['general', 'tech']));
        $this->pollAlias->shouldReceive('query')->andReturn($mockQuery);

        $result = PollService::getCategories();
        $this->assertIsArray($result);
    }
}
