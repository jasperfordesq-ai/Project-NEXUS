<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use Tests\Laravel\TestCase;
use App\Services\ExchangeRatingService;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Mockery;

class ExchangeRatingServiceTest extends TestCase
{
    private ExchangeRatingService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ExchangeRatingService();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')->zeroOrMoreTimes();
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);
    }

    /**
     * These tests mock the DB facade, so the F-279 block check
     * (BlockUserService::assertNoBlockBetween → user_blocks) needs a stubbed
     * "no block between the pair" answer on the paths that reach it.
     */
    private function stubNoBlockBetweenThePair(): void
    {
        $blocks = Mockery::mock();
        $blocks->shouldReceive('where')->andReturnSelf();
        $blocks->shouldReceive('exists')->andReturn(false);
        DB::shouldReceive('table')->with('user_blocks')->andReturn($blocks);
        // The schema builder resolves through the (now mocked) DB manager too,
        // so swap in a stub rather than resolving the real one.
        $schema = Mockery::mock(\Illuminate\Database\Schema\Builder::class);
        $schema->shouldReceive('hasColumn')->with('user_blocks', 'tenant_id')->andReturn(true);
        Schema::swap($schema);
    }

    // =========================================================================
    // submitRating()
    // =========================================================================

    public function test_submitRating_rejects_invalid_rating_below_1(): void
    {
        $result = $this->service->submitRating(1, 1, 0);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('between 1 and 5', $result['error']);
    }

    public function test_submitRating_rejects_invalid_rating_above_5(): void
    {
        $result = $this->service->submitRating(1, 1, 6);
        $this->assertFalse($result['success']);
    }

    public function test_submitRating_rejects_when_exchange_not_found(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $result = $this->service->submitRating(999, 1, 5);
        $this->assertFalse($result['success']);
        $this->assertEquals('Exchange not found', $result['error']);
    }

    public function test_submitRating_rejects_when_exchange_not_completed(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'pending_provider'];
        DB::shouldReceive('selectOne')->once()->andReturn($exchange);

        $result = $this->service->submitRating(1, 1, 5);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('completed', $result['error']);
    }

    public function test_submitRating_rejects_non_participant(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'completed'];
        DB::shouldReceive('selectOne')->once()->andReturn($exchange);

        $result = $this->service->submitRating(1, 99, 5); // user 99 is not a participant
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('not a participant', $result['error']);
    }

    public function test_submitRating_rejects_duplicate_rating(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'completed'];
        $existing = (object) ['id' => 5];
        $this->stubNoBlockBetweenThePair();

        DB::shouldReceive('selectOne')
            ->andReturn($exchange, $existing);

        $result = $this->service->submitRating(1, 1, 5);
        $this->assertFalse($result['success']);
        $this->assertStringContainsString('already rated', $result['error']);
    }

    public function test_submitRating_succeeds_for_requester(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'completed'];

        DB::shouldReceive('selectOne')
            ->andReturn($exchange, null); // exchange found, no existing rating
        $this->stubNoBlockBetweenThePair();

        DB::shouldReceive('insert')->once()->andReturn(true);

        $result = $this->service->submitRating(1, 1, 4, 'Good service');
        $this->assertTrue($result['success']);
    }

    public function test_submitRating_catches_db_exceptions(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'completed'];

        DB::shouldReceive('selectOne')
            ->andReturn($exchange, null);
        DB::shouldReceive('insert')->andThrow(new \Exception('DB error'));
        $this->stubNoBlockBetweenThePair();
        Log::shouldReceive('error')->once();

        $result = $this->service->submitRating(1, 1, 4);
        $this->assertFalse($result['success']);
    }

    public function test_submitRating_denial_writes_no_rating(): void
    {
        $exchange = (object) ['id' => 1, 'requester_id' => 1, 'provider_id' => 2, 'status' => 'completed'];
        DB::shouldReceive('selectOne')->once()->andReturn($exchange);
        DB::shouldReceive('insert')->never();
        $this->stubNoBlockBetweenThePair();

        $policy = Mockery::mock(SafeguardingInteractionPolicy::class);
        $policy->shouldReceive('assertLocalContactAllowed')
            ->once()
            ->with(1, 2, (int) TenantContext::getId(), 'exchange_rating')
            ->andThrow(new SafeguardingPolicyException('VETTING_REQUIRED', 'Vetting required'));
        $this->app->instance(SafeguardingInteractionPolicy::class, $policy);

        $this->expectException(SafeguardingPolicyException::class);
        $this->service->submitRating(1, 1, 5, 'Must not persist');
    }

    // =========================================================================
    // getRatingsForExchange()
    // =========================================================================

    public function test_getRatingsForExchange_returns_array(): void
    {
        $rows = [(object) ['id' => 1, 'rating' => 5]];
        DB::shouldReceive('select')->andReturn($rows);

        $result = $this->service->getRatingsForExchange(1);
        $this->assertCount(1, $result);
        $this->assertIsArray($result[0]);
    }

    // =========================================================================
    // hasRated()
    // =========================================================================

    public function test_hasRated_returns_true_when_rating_exists(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['id' => 1]);

        $this->assertTrue($this->service->hasRated(1, 1));
    }

    public function test_hasRated_returns_false_when_no_rating(): void
    {
        DB::shouldReceive('selectOne')->andReturn(null);

        $this->assertFalse($this->service->hasRated(1, 1));
    }

    // =========================================================================
    // getUserRating()
    // =========================================================================

    public function test_getUserRating_returns_average_and_count(): void
    {
        $row = (object) ['average' => '4.50', 'count' => 10];
        DB::shouldReceive('selectOne')->andReturn($row);

        $result = $this->service->getUserRating(1);
        $this->assertEquals(4.50, $result['average']);
        $this->assertEquals(10, $result['count']);
    }

    public function test_getUserRating_returns_zero_when_no_ratings(): void
    {
        $row = (object) ['average' => null, 'count' => 0];
        DB::shouldReceive('selectOne')->andReturn($row);

        $result = $this->service->getUserRating(1);
        $this->assertEquals(0.0, $result['average']);
        $this->assertEquals(0, $result['count']);
    }
}
