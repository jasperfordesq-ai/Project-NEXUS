<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\IdeationChallengeService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class IdeationChallengeServiceTest extends TestCase
{
    private IdeationChallengeService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new IdeationChallengeService();
    }

    public function test_getErrors_initially_empty(): void
    {
        $this->assertSame([], $this->service->getErrors());
    }

    public function test_getAll_returns_paginated_structure(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([
            (object) ['id' => 1, 'title' => 'Challenge 1'],
        ]));

        $result = $this->service->getAll();

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertCount(1, $result['items']);
        $this->assertFalse($result['has_more']);
    }

    public function test_getAllChallenges_returns_items_directly(): void
    {
        DB::shouldReceive('table')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('limit')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getAllChallenges();
        $this->assertIsArray($result);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table')->with('ideation_challenges as c')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertNull($this->service->getById(999));
    }

    public function test_getById_returns_array_with_ideas_count(): void
    {
        DB::shouldReceive('table')->with('ideation_challenges as c')->andReturnSelf();
        DB::shouldReceive('leftJoin')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) [
            'id' => 1,
            'user_id' => 10,
            'title' => 'Challenge',
            'status' => 'open',
        ]);

        DB::shouldReceive('table')->with('challenge_ideas')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereNotIn')->andReturnSelf();
        DB::shouldReceive('count')->andReturn(5);

        $result = $this->service->getById(1);
        $this->assertSame(1, $result['id']);
        $this->assertSame(5, $result['ideas_count']);
    }
}
