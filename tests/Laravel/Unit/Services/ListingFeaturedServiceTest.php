<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\ListingFeaturedService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class ListingFeaturedServiceTest extends TestCase
{
    private ListingFeaturedService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ListingFeaturedService();
    }

    public function test_featureListing_not_found_returns_error(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $this->service->featureListing(999);
        $this->assertFalse($result['success']);
        $this->assertSame("We can't find that offer or request. It may have been removed.", $result['error']);
    }

    public function test_featureListing_success_without_days(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn((object) ['id' => 1, 'status' => 'active']);
        DB::shouldReceive('update')->once()->andReturn(1);

        $result = $this->service->featureListing(1);
        $this->assertTrue($result['success']);
        $this->assertNull($result['featured_until']);
    }

    public function test_featureListing_with_days_sets_until(): void
    {
        DB::shouldReceive('selectOne')->andReturn(
            (object) ['id' => 1, 'status' => 'active'],
            (object) ['date' => '2026-04-01 00:00:00'],
        );
        DB::shouldReceive('update')->once()->andReturn(1);

        $result = $this->service->featureListing(1, 7);
        $this->assertTrue($result['success']);
        $this->assertNotNull($result['featured_until']);
    }

    public function test_unfeatureListing_not_found_returns_error(): void
    {
        DB::shouldReceive('selectOne')->once()->andReturn(null);

        $result = $this->service->unfeatureListing(999);
        $this->assertFalse($result['success']);
    }

    public function test_unfeatureListing_success(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['id' => 1]);
        DB::shouldReceive('update')->once()->andReturn(1);

        $result = $this->service->unfeatureListing(1);
        $this->assertTrue($result['success']);
    }

    public function test_processExpiredFeatured_returns_count(): void
    {
        DB::shouldReceive('update')->once()->andReturn(3);

        $result = $this->service->processExpiredFeatured();
        $this->assertSame(3, $result);
    }

    public function test_processExpiredFeatured_handles_error(): void
    {
        DB::shouldReceive('update')->andThrow(new \Exception('Error'));

        $result = $this->service->processExpiredFeatured();
        $this->assertSame(0, $result);
    }

    public function test_isFeatured_returns_false_when_not_featured(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['is_featured' => 0, 'featured_until' => null]);

        $this->assertFalse($this->service->isFeatured(1));
    }

    public function test_isFeatured_returns_true_when_featured_without_expiry(): void
    {
        DB::shouldReceive('selectOne')->andReturn((object) ['is_featured' => 1, 'featured_until' => null]);

        $this->assertTrue($this->service->isFeatured(1));
    }
}
