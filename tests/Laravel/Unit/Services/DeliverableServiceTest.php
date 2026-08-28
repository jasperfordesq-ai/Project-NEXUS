<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\DeliverableService;
use Illuminate\Support\Facades\DB;
use Mockery;

class DeliverableServiceTest extends TestCase
{
    private DeliverableService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new DeliverableService();
    }

    // =========================================================================
    // getAll()
    // =========================================================================

    public function test_getAll_returns_items_and_total(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->with('tenant_id', 2)->andReturnSelf();
        $mockQuery->shouldReceive('count')->andReturn(1);
        $mockQuery->shouldReceive('orderByDesc')->with('created_at')->andReturnSelf();
        $mockQuery->shouldReceive('offset')->with(0)->andReturnSelf();
        $mockQuery->shouldReceive('limit')->with(20)->andReturnSelf();
        $mockQuery->shouldReceive('get->map->all')->andReturn([['id' => 1, 'title' => 'Test']]);

        DB::shouldReceive('table')->with('deliverables')->andReturn($mockQuery);

        $result = $this->service->getAll(2);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('total', $result);
    }

    public function test_getAll_applies_status_filter(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->with('tenant_id', 2)->andReturnSelf();
        $mockQuery->shouldReceive('where')->with('status', 'active')->andReturnSelf();
        $mockQuery->shouldReceive('count')->andReturn(0);
        $mockQuery->shouldReceive('orderByDesc')->andReturnSelf();
        $mockQuery->shouldReceive('offset')->andReturnSelf();
        $mockQuery->shouldReceive('limit')->andReturnSelf();
        $mockQuery->shouldReceive('get->map->all')->andReturn([]);

        DB::shouldReceive('table')->with('deliverables')->andReturn($mockQuery);

        $result = $this->service->getAll(2, ['status' => 'active']);
        $this->assertEquals(0, $result['total']);
    }

    public function test_getAll_clamps_limit_to_100(): void
    {
        $mockQuery = Mockery::mock();
        $mockQuery->shouldReceive('where')->andReturnSelf();
        $mockQuery->shouldReceive('count')->andReturn(0);
        $mockQuery->shouldReceive('orderByDesc')->andReturnSelf();
        $mockQuery->shouldReceive('offset')->with(0)->andReturnSelf();
        $mockQuery->shouldReceive('limit')->with(100)->andReturnSelf();
        $mockQuery->shouldReceive('get->map->all')->andReturn([]);

        DB::shouldReceive('table')->with('deliverables')->andReturn($mockQuery);

        $result = $this->service->getAll(2, ['limit' => 500]);
        $this->assertArrayHasKey('items', $result);
    }

    // =========================================================================
    // getById()
    // =========================================================================

    public function test_getById_returns_array_when_found(): void
    {
        $row = (object) ['id' => 1, 'title' => 'Test', 'tenant_id' => 2];
        DB::shouldReceive('table->where->where->first')->andReturn($row);

        $result = $this->service->getById(1, 2);
        $this->assertIsArray($result);
        $this->assertEquals(1, $result['id']);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')->andReturn(null);

        $this->assertNull($this->service->getById(999, 2));
    }

    // =========================================================================
    // update()
    // =========================================================================

    public function test_update_returns_true_on_success(): void
    {
        DB::shouldReceive('table->where->where->update')->andReturn(1);

        $result = $this->service->update(1, 2, ['title' => 'Updated']);
        $this->assertTrue($result);
    }

    public function test_update_returns_false_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->update')->andReturn(0);

        $result = $this->service->update(999, 2, ['title' => 'Updated']);
        $this->assertFalse($result);
    }

    public function test_update_only_allows_whitelisted_fields(): void
    {
        DB::shouldReceive('table->where->where->update')
            ->withArgs(function ($data) {
                return !array_key_exists('evil_field', $data) && array_key_exists('title', $data);
            })
            ->andReturn(1);

        $result = $this->service->update(1, 2, ['title' => 'OK', 'evil_field' => 'bad']);
        $this->assertTrue($result);
    }
}
