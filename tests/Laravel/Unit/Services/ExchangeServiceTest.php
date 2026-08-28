<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\ExchangeService;
use Illuminate\Support\Facades\DB;

class ExchangeServiceTest extends TestCase
{
    private ExchangeService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new ExchangeService();
    }

    // =========================================================================
    // Constants
    // =========================================================================

    public function test_status_constants_are_defined(): void
    {
        $this->assertEquals('pending_provider', ExchangeService::STATUS_PENDING);
        $this->assertEquals('accepted', ExchangeService::STATUS_ACCEPTED);
        $this->assertEquals('completed', ExchangeService::STATUS_COMPLETED);
        $this->assertEquals('declined', ExchangeService::STATUS_DECLINED);
        $this->assertEquals('cancelled', ExchangeService::STATUS_CANCELLED);
    }

    // =========================================================================
    // getById()
    // =========================================================================

    public function test_getById_returns_array_when_found(): void
    {
        $row = (object) ['id' => 1, 'status' => 'pending_provider'];
        DB::shouldReceive('table->where->where->first')->andReturn($row);

        $result = $this->service->getById(1);
        $this->assertIsArray($result);
        $this->assertEquals(1, $result['id']);
    }

    public function test_getById_returns_null_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')->andReturn(null);

        $this->assertNull($this->service->getById(999));
    }

    // =========================================================================
    // create()
    // =========================================================================

    public function test_create_returns_null_when_listing_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')->andReturn(null);

        $result = $this->service->create(1, 999);
        $this->assertNull($result);
    }

    public function test_create_returns_null_when_requesting_own_listing(): void
    {
        $listing = (object) ['id' => 1, 'user_id' => 5];
        DB::shouldReceive('table->where->where->first')->andReturn($listing);

        $result = $this->service->create(5, 1); // user 5 is the listing owner
        $this->assertNull($result);
    }

    public function test_create_returns_id_on_success(): void
    {
        $listing = (object) ['id' => 1, 'user_id' => 10];
        DB::shouldReceive('table->where->where->first')->andReturn($listing);
        DB::shouldReceive('table->insertGetId')->andReturn(42);

        $result = $this->service->create(5, 1, ['proposed_hours' => 2]);
        $this->assertEquals(42, $result);
    }

    public function test_create_clamps_proposed_hours(): void
    {
        $listing = (object) ['id' => 1, 'user_id' => 10];
        DB::shouldReceive('table->where->where->first')->andReturn($listing);
        DB::shouldReceive('table->insertGetId')
            ->withArgs(function ($data) {
                return $data['proposed_hours'] <= 24 && $data['proposed_hours'] >= 0.25;
            })
            ->andReturn(1);

        // The withArgs() callback above asserts the clamp (0.25 <= hours <= 24);
        // assert the returned id explicitly so PHPUnit doesn't flag this risky.
        $result = $this->service->create(5, 1, ['proposed_hours' => 100]);
        $this->assertEquals(1, $result);
    }

    // =========================================================================
    // accept()
    // =========================================================================

    public function test_accept_returns_true_on_success(): void
    {
        DB::shouldReceive('table->where->where->where->where->update')->andReturn(1);

        $this->assertTrue($this->service->accept(1, 10));
    }

    public function test_accept_returns_false_when_not_found_or_wrong_status(): void
    {
        DB::shouldReceive('table->where->where->where->where->update')->andReturn(0);

        $this->assertFalse($this->service->accept(999, 10));
    }

    // =========================================================================
    // complete()
    // =========================================================================

    public function test_complete_returns_false_when_exchange_not_found(): void
    {
        DB::shouldReceive('table->where->where->first')->andReturn(null);

        $this->assertFalse($this->service->complete(999, 1));
    }

    public function test_complete_returns_false_when_status_not_accepted(): void
    {
        $exchange = (object) ['id' => 1, 'status' => 'pending_provider', 'requester_id' => 1, 'provider_id' => 2];
        DB::shouldReceive('table->where->where->first')->andReturn($exchange);

        $this->assertFalse($this->service->complete(1, 1));
    }

    public function test_complete_returns_false_when_user_not_participant(): void
    {
        $exchange = (object) ['id' => 1, 'status' => 'accepted', 'requester_id' => 1, 'provider_id' => 2];
        DB::shouldReceive('table->where->where->first')->andReturn($exchange);

        $this->assertFalse($this->service->complete(1, 99)); // user 99 is not a participant
    }

    public function test_complete_succeeds_for_requester(): void
    {
        $exchange = (object) ['id' => 1, 'status' => 'accepted', 'requester_id' => 1, 'provider_id' => 2];
        DB::shouldReceive('table->where->where->first')->andReturn($exchange);
        DB::shouldReceive('table->where->where->update')->andReturn(1);

        $this->assertTrue($this->service->complete(1, 1));
    }
}
