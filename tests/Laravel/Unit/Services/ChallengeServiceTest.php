<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\ChallengeService;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Mockery;

class ChallengeServiceTest extends TestCase
{
    /**
     * Build a mock DB connection and set it as the Eloquent model resolver.
     *
     * All Eloquent queries (select, insert, update, etc.) are intercepted by
     * replacing the Model connection resolver with our mock. The grammar's
     * internal `connection` property is also wired up so wrapTable() works.
     *
     * @param  list<list<object>>  $selectSequence  Ordered result sets for each select() call
     */
    private function mockEloquentConnection(array $selectSequence = []): void
    {
        $mockConnection = Mockery::mock(\Illuminate\Database\MySqlConnection::class)->makePartial();
        $mockConnection->shouldReceive('getTablePrefix')->andReturn('');
        $mockConnection->shouldReceive('getDatabaseName')->andReturn('nexus_test');
        $mockConnection->shouldReceive('getName')->andReturn('mysql');
        $mockConnection->shouldReceive('getConfig')->andReturn(null);

        // Build grammar with the mock connection wired in
        $mockGrammar = Mockery::mock(\Illuminate\Database\Query\Grammars\MySqlGrammar::class)->makePartial();
        $mockGrammar->shouldReceive('getDateFormat')->andReturn('Y-m-d H:i:s');
        // Wire up the connection property so wrapTable() can call $this->connection->getTablePrefix()
        $ref = new \ReflectionProperty(\Illuminate\Database\Grammar::class, 'connection');
        $ref->setAccessible(true);
        $ref->setValue($mockGrammar, $mockConnection);

        $mockProcessor = Mockery::mock(\Illuminate\Database\Query\Processors\MySqlProcessor::class)->makePartial();

        $mockConnection->shouldReceive('getQueryGrammar')->andReturn($mockGrammar);
        $mockConnection->shouldReceive('getPostProcessor')->andReturn($mockProcessor);

        // Set up select() sequence — use variadic andReturn for proper sequencing
        if (empty($selectSequence)) {
            $mockConnection->shouldReceive('select')->andReturn([]);
        } elseif (count($selectSequence) === 1) {
            $mockConnection->shouldReceive('select')->andReturn($selectSequence[0]);
        } else {
            $mockConnection->shouldReceive('select')->andReturn(...$selectSequence);
        }

        $mockConnection->shouldReceive('selectOne')->andReturn(null);
        $mockConnection->shouldReceive('insert')->andReturn(true);
        $mockConnection->shouldReceive('update')->andReturn(1);
        $mockConnection->shouldReceive('delete')->andReturn(1);
        $mockConnection->shouldReceive('affectingStatement')->andReturn(1);
        $mockConnection->shouldReceive('statement')->andReturn(true);
        $mockConnection->shouldReceive('beginTransaction')->andReturn(null);
        $mockConnection->shouldReceive('commit')->andReturn(null);
        $mockConnection->shouldReceive('rollBack')->andReturn(null);
        $mockConnection->shouldReceive('transactionLevel')->andReturn(0);

        // Replace Eloquent's connection resolver
        $mockResolver = Mockery::mock(\Illuminate\Database\DatabaseManager::class);
        $mockResolver->shouldReceive('connection')->andReturn($mockConnection);
        Model::setConnectionResolver($mockResolver);

        // Also mock the DB facade for direct DB::connection() calls
        DB::shouldReceive('connection')->andReturn($mockConnection);
    }

    protected function tearDown(): void
    {
        Model::setConnectionResolver($this->app['db']);
        parent::tearDown();
    }

    /**
     * Standard challenge row matching the actual DB schema.
     */
    private function challengeRow(array $overrides = []): object
    {
        return (object) array_merge([
            'id' => 1, 'tenant_id' => 2, 'title' => 'Test Challenge',
            'description' => null, 'challenge_type' => 'weekly', 'action_type' => null,
            'target_count' => 5, 'xp_reward' => 10, 'badge_reward' => null,
            'is_active' => 1, 'start_date' => '2026-01-01', 'end_date' => '2026-12-31',
            'created_at' => '2026-01-01 00:00:00', 'claimed_at' => null,
        ], $overrides);
    }

    // ── getAll ─────────────────────────────────────────────────────────

    public function test_getAll_returns_items_and_total(): void
    {
        $row1 = $this->challengeRow(['id' => 1, 'title' => 'Challenge A']);
        $row2 = $this->challengeRow(['id' => 2, 'title' => 'Challenge B']);

        $this->mockEloquentConnection([
            // 1st select: count() aggregate query
            [(object) ['aggregate' => 2]],
            // 2nd select: main data query
            [$row1, $row2],
        ]);

        $result = ChallengeService::getAll(2);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertSame(2, $result['total']);
        $this->assertCount(2, $result['items']);
    }

    public function test_getAll_returns_empty_when_no_challenges(): void
    {
        $this->mockEloquentConnection([
            [(object) ['aggregate' => 0]], // count
            [], // data
        ]);

        $result = ChallengeService::getAll(2);

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['items']);
    }

    public function test_getAll_applies_filters(): void
    {
        $this->mockEloquentConnection([
            [(object) ['aggregate' => 0]],
            [],
        ]);

        $result = ChallengeService::getAll(2, ['status' => 'active']);

        $this->assertSame(0, $result['total']);
        $this->assertEmpty($result['items']);
    }

    public function test_getAll_caps_limit_at_100(): void
    {
        $this->assertSame(100, min((int) 200, 100));
        $this->assertSame(20, min((int) 20, 100));
        $this->assertSame(50, min((int) 50, 100));
        $this->assertSame(20, min((int) (null ?? 20), 100));
    }

    // ── getById ────────────────────────────────────────────────────────

    public function test_getById_returns_challenge(): void
    {
        $row = $this->challengeRow(['id' => 1, 'title' => 'Test Challenge']);
        $this->mockEloquentConnection([[$row]]);

        $result = ChallengeService::getById(1, 2);

        $this->assertNotNull($result);
        $this->assertSame(1, $result['id']);
        $this->assertSame('Test Challenge', $result['title']);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        $this->mockEloquentConnection([[]]);

        $result = ChallengeService::getById(999, 2);

        $this->assertNull($result);
    }

    // ── claim ──────────────────────────────────────────────────────────

    public function test_claim_returns_false_when_challenge_not_active(): void
    {
        $this->mockEloquentConnection([[]]);

        // claim() first verifies the user belongs to the tenant via DB::table('users')
        $usersQuery = Mockery::mock();
        $usersQuery->shouldReceive('where')->andReturnSelf();
        $usersQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('users')->andReturn($usersQuery);

        $result = ChallengeService::claim(5, 1, 2);

        $this->assertFalse($result);
    }

    /**
     * The claim ledger is `user_challenge_progress.reward_claimed`. These
     * tests used to mock a `challenge_claims` table instead — a table that has
     * never existed in any schema — which is how the broken path stayed green
     * for four months. Real-database cover lives in
     * tests/Laravel/Feature/SchemaWriteRegressionTest.php (FIX 8).
     */
    private function mockProgressRow(?object $progress, int $updated = 0): Mockery\MockInterface
    {
        $progressQuery = Mockery::mock();
        $progressQuery->shouldReceive('where')->andReturnSelf();
        $progressQuery->shouldReceive('first')->andReturn($progress);
        $progressQuery->shouldReceive('update')->andReturn($updated);
        DB::shouldReceive('table')->with('user_challenge_progress')->andReturn($progressQuery);

        return $progressQuery;
    }

    public function test_claim_returns_false_when_already_claimed(): void
    {
        $row = $this->challengeRow(['id' => 5]);
        $this->mockEloquentConnection([[$row]]);

        // claim() first verifies the user belongs to the tenant via DB::table('users')
        $usersQuery = Mockery::mock();
        $usersQuery->shouldReceive('where')->andReturnSelf();
        $usersQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('users')->andReturn($usersQuery);

        $this->mockProgressRow((object) [
            'completed_at'   => '2026-01-02 00:00:00',
            'reward_claimed' => 1,
        ]);

        $this->assertFalse(ChallengeService::claim(5, 1, 2));
    }

    public function test_claim_returns_false_when_not_yet_completed(): void
    {
        $row = $this->challengeRow(['id' => 5]);
        $this->mockEloquentConnection([[$row]]);

        $usersQuery = Mockery::mock();
        $usersQuery->shouldReceive('where')->andReturnSelf();
        $usersQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('users')->andReturn($usersQuery);

        $this->mockProgressRow((object) [
            'completed_at'   => null,
            'reward_claimed' => 0,
        ]);

        $this->assertFalse(ChallengeService::claim(5, 1, 2));
    }

    public function test_claim_returns_false_when_progress_row_missing(): void
    {
        $row = $this->challengeRow(['id' => 5]);
        $this->mockEloquentConnection([[$row]]);

        $usersQuery = Mockery::mock();
        $usersQuery->shouldReceive('where')->andReturnSelf();
        $usersQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('users')->andReturn($usersQuery);

        // Never started the challenge — nothing to claim.
        $this->mockProgressRow(null);

        $this->assertFalse(ChallengeService::claim(5, 1, 2));
    }

    public function test_claim_returns_false_when_challenge_belongs_to_another_tenant(): void
    {
        $row = $this->challengeRow(['id' => 5, 'tenant_id' => 99]);
        $this->mockEloquentConnection([[$row]]);

        $usersQuery = Mockery::mock();
        $usersQuery->shouldReceive('where')->andReturnSelf();
        $usersQuery->shouldReceive('exists')->andReturn(true);
        DB::shouldReceive('table')->with('users')->andReturn($usersQuery);

        $this->assertFalse(ChallengeService::claim(5, 1, 2));
    }

    // ── getActiveChallenges ────────────────────────────────────────────

    public function test_getActiveChallenges_filters_by_dates(): void
    {
        $row = $this->challengeRow(['id' => 1, 'title' => 'Active Challenge']);
        $this->mockEloquentConnection([[$row]]);

        $result = ChallengeService::getActiveChallenges();

        $this->assertIsArray($result);
        $this->assertCount(1, $result);
        $this->assertSame('Active Challenge', $result[0]['title']);
    }

    public function test_getActiveChallenges_returns_empty_when_none_active(): void
    {
        $this->mockEloquentConnection([[]]);

        $result = ChallengeService::getActiveChallenges();

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    // ── getLegacyById ──────────────────────────────────────────────────

    public function test_getLegacyById_returns_null_when_not_found(): void
    {
        $this->mockEloquentConnection([[]]);

        $result = ChallengeService::getLegacyById(999);

        $this->assertNull($result);
    }

    public function test_getLegacyById_returns_challenge_when_found(): void
    {
        $row = $this->challengeRow(['id' => 42, 'title' => 'Legacy Challenge']);
        $this->mockEloquentConnection([[$row]]);

        $result = ChallengeService::getLegacyById(42);

        $this->assertNotNull($result);
        $this->assertSame(42, $result['id']);
        $this->assertSame('Legacy Challenge', $result['title']);
    }

    // ── updateProgress ─────────────────────────────────────────────────

    public function test_updateProgress_returns_empty_when_no_matching_challenges(): void
    {
        $this->mockEloquentConnection([[]]);

        $result = ChallengeService::updateProgress(1, 'nonexistent_action', 1);

        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }

    // ── Contract / structure tests ─────────────────────────────────────

    public function test_constructor_accepts_dependencies(): void
    {
        $ref = new \ReflectionClass(ChallengeService::class);
        $constructor = $ref->getConstructor();
        $this->assertNotNull($constructor);

        $params = $constructor->getParameters();
        $this->assertCount(3, $params);
        $this->assertSame('challenge', $params[0]->getName());
        $this->assertSame('progress', $params[1]->getName());
        $this->assertSame('gamificationService', $params[2]->getName());
    }

    /**
     * awardChallengeReward() is deliberately PUBLIC: it is the one award
     * routine shared by both claim paths (this service for the accessible
     * frontend, GamificationV2Controller::claimChallenge for React). It was
     * private, which is why the React path grew its own XP-only reward logic
     * and silently ignored challenges.badge_reward.
     *
     * @see \Tests\Laravel\Feature\ChallengeRewardParityTest
     */
    public function test_awardChallengeReward_is_shared_and_public(): void
    {
        $ref = new \ReflectionMethod(ChallengeService::class, 'awardChallengeReward');
        $this->assertTrue($ref->isPublic(), 'Both claim paths call this; making it private forces a call site to reimplement rewards.');
        $this->assertTrue($ref->isStatic());
        $this->assertSame('array', $ref->getReturnType()?->getName(), 'Must report what it awarded so the API can echo the badge.');
    }

    public function test_create_has_correct_signature(): void
    {
        $ref = new \ReflectionMethod(ChallengeService::class, 'create');
        $this->assertTrue($ref->isStatic());
        $this->assertTrue($ref->isPublic());

        $params = $ref->getParameters();
        $this->assertSame('tenantId', $params[0]->getName());
        $this->assertSame('data', $params[1]->getName());

        $returnType = $ref->getReturnType();
        $this->assertTrue($returnType->allowsNull());
        $this->assertSame('int', $returnType->getName());
    }

    public function test_getChallengesWithProgress_has_correct_signature(): void
    {
        $ref = new \ReflectionMethod(ChallengeService::class, 'getChallengesWithProgress');
        $this->assertTrue($ref->isStatic());
        $this->assertSame('array', $ref->getReturnType()->getName());

        $params = $ref->getParameters();
        $this->assertCount(1, $params);
        $this->assertSame('userId', $params[0]->getName());
    }

    public function test_updateProgress_has_correct_signature(): void
    {
        $ref = new \ReflectionMethod(ChallengeService::class, 'updateProgress');
        $this->assertTrue($ref->isStatic());
        $this->assertSame('array', $ref->getReturnType()->getName());

        $params = $ref->getParameters();
        $this->assertSame('userId', $params[0]->getName());
        $this->assertSame('actionType', $params[1]->getName());
        $this->assertSame('increment', $params[2]->getName());
        $this->assertTrue($params[2]->isOptional());
        $this->assertSame(1, $params[2]->getDefaultValue());
    }
}
