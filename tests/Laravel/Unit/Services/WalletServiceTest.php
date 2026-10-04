<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\WalletService;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Mockery;

class WalletServiceTest extends TestCase
{
    private WalletService $service;
    private $mockTransaction;
    private $mockUser;

    protected function setUp(): void
    {
        parent::setUp();
        $this->mockTransaction = Mockery::mock(Transaction::class);
        $this->mockUser = Mockery::mock(User::class);
        $this->service = new WalletService($this->mockTransaction, $this->mockUser);
    }

    public function test_getBalance_returns_expected_structure(): void
    {
        $mockBuilder = Mockery::mock(Builder::class);
        $mockBuilder->shouldReceive('find')->andReturn((object) ['balance' => 10.5]);

        $this->mockUser->shouldReceive('newQuery')->andReturn($mockBuilder);

        // getBalance() now computes all aggregates in a single selectRaw()->first()
        // query instead of separate sum()/count() calls.
        $txnBuilder = Mockery::mock(Builder::class);
        $txnBuilder->shouldReceive('where')->andReturnSelf();
        $txnBuilder->shouldReceive('completed')->andReturnSelf();
        $txnBuilder->shouldReceive('selectRaw')->andReturnSelf();
        $txnBuilder->shouldReceive('orWhere')->andReturnSelf();
        $txnBuilder->shouldReceive('first')->andReturn((object) [
            'total_earned' => 25.0,
            'total_spent' => 14.5,
            'pending_incoming' => 5.0,
            'pending_outgoing' => 2.0,
            'tx_count' => 10,
        ]);

        $this->mockTransaction->shouldReceive('newQuery')->andReturn($txnBuilder);

        $result = $this->service->getBalance(1);

        $this->assertArrayHasKey('balance', $result);
        $this->assertArrayHasKey('total_earned', $result);
        $this->assertArrayHasKey('total_spent', $result);
        $this->assertArrayHasKey('transaction_count', $result);
        $this->assertArrayHasKey('currency', $result);
        $this->assertEquals('hours', $result['currency']);
    }

    public function test_transfer_throws_when_no_recipient(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('api.wallet_transfer_recipient_required'));

        $this->service->transfer(1, ['amount' => 1]);
    }

    public function test_transfer_throws_when_amount_zero(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage(__('api.wallet_transfer_amount_positive'));

        $this->service->transfer(1, ['recipient' => 2, 'amount' => 0]);
    }

    public function test_transfer_throws_when_recipient_not_found(): void
    {
        $mockBuilder = Mockery::mock(Builder::class);
        $mockBuilder->shouldReceive('find')->andReturn(null);
        $mockBuilder->shouldReceive('where')->andReturnSelf();
        $mockBuilder->shouldReceive('first')->andReturn(null);

        $this->mockUser->shouldReceive('newQuery')->andReturn($mockBuilder);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage(__('api.wallet_transfer_recipient_not_found'));

        $this->service->transfer(1, ['recipient' => 999, 'amount' => 1]);
    }

    public function test_transfer_throws_for_self_transfer(): void
    {
        $mockBuilder = Mockery::mock(Builder::class);
        // Use a real (unsaved) User so reading ->id doesn't trigger Mockery's
        // setAttribute() expectation error; only ->id is read before the throw.
        $receiver = new User();
        $receiver->id = 1;
        $mockBuilder->shouldReceive('where')->andReturnSelf();
        $mockBuilder->shouldReceive('find')->andReturn($receiver);

        $this->mockUser->shouldReceive('newQuery')->andReturn($mockBuilder);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage(__('api.wallet_transfer_self_forbidden'));

        $this->service->transfer(1, ['recipient' => 1, 'amount' => 1]);
    }

    public function test_searchUsers_returns_empty_for_short_query(): void
    {
        $result = $this->service->searchUsers(1, '', 10);
        $this->assertEmpty($result);
    }

    public function test_getTransaction_returns_null_when_not_found(): void
    {
        $txnBuilder = Mockery::mock(Builder::class);
        $txnBuilder->shouldReceive('with')->andReturnSelf();
        $txnBuilder->shouldReceive('where')->andReturnSelf();
        $txnBuilder->shouldReceive('first')->andReturn(null);
        $txnBuilder->shouldReceive('orWhere')->andReturnSelf();

        $this->mockTransaction->shouldReceive('newQuery')->andReturn($txnBuilder);

        $this->assertNull($this->service->getTransaction(999, 1));
    }
}
