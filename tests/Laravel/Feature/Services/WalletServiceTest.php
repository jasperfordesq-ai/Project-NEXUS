<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Services;

use App\Core\TenantContext;
use App\Models\Transaction;
use App\Models\User;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Tests\Laravel\TestCase;

/**
 * Feature tests for WalletService — balance calculations, transfer logic,
 * tenant isolation, and validation.
 *
 * Financial operations are the highest-risk area in the platform.
 * These tests verify correctness of balance tracking, transfer authorization,
 * and cross-tenant isolation.
 */
class WalletServiceTest extends TestCase
{
    use DatabaseTransactions;

    private WalletService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = app(WalletService::class);
    }

    // ------------------------------------------------------------------
    //  BALANCE
    // ------------------------------------------------------------------

    public function test_get_balance_returns_correct_structure(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 15.50,
        ]);

        $balance = $this->service->getBalance($user->id);

        $this->assertArrayHasKey('balance', $balance);
        $this->assertArrayHasKey('total_earned', $balance);
        $this->assertArrayHasKey('total_spent', $balance);
        $this->assertArrayHasKey('transaction_count', $balance);
        $this->assertArrayHasKey('currency', $balance);
        $this->assertEquals('hours', $balance['currency']);
        $this->assertIsNumeric($balance['balance']);
    }

    public function test_get_balance_reflects_completed_transactions(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 5.00,
        ]);
        $other = User::factory()->forTenant($this->testTenantId)->create();

        // User received 3 hours
        Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $other->id,
            'receiver_id' => $user->id,
            'amount' => 3.00,
            'status' => 'completed',
        ]);

        // User sent 1 hour
        Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'amount' => 1.00,
            'status' => 'completed',
        ]);

        // Factory creates fire observers that drift TenantContext to tenant 1;
        // re-pin to the test tenant before the tenant-scoped service read.
        TenantContext::setById($this->testTenantId);
        $balance = $this->service->getBalance($user->id);

        $this->assertEquals(3.00, $balance['total_earned']);
        $this->assertEquals(1.00, $balance['total_spent']);
        $this->assertEquals(2, $balance['transaction_count']);
    }

    public function test_get_balance_excludes_pending_from_totals(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 10.00,
        ]);
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $other->id,
            'receiver_id' => $user->id,
            'amount' => 5.00,
            'status' => 'pending',
        ]);

        TenantContext::setById($this->testTenantId);
        $balance = $this->service->getBalance($user->id);

        // Pending transactions should not be in total_earned
        $this->assertEquals(0.0, $balance['total_earned']);
        // But should appear in pending_incoming
        $this->assertEquals(5.00, $balance['pending_incoming']);
    }

    // ------------------------------------------------------------------
    //  TRANSFER
    // ------------------------------------------------------------------

    public function test_transfer_succeeds_with_sufficient_balance(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 5.00,
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->transfer($sender->id, [
            'recipient' => $receiver->id,
            'amount' => 3.0,
            'description' => 'Service test transfer',
        ]);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('id', $result);

        // Verify balances updated
        $sender->refresh();
        $receiver->refresh();
        $this->assertEquals(17.00, (float) $sender->balance);
        $this->assertEquals(8.00, (float) $receiver->balance);
    }

    public function test_transfer_fails_with_insufficient_balance(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 1.00,
        ]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        TenantContext::setById($this->testTenantId);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Insufficient balance');

        $this->service->transfer($sender->id, [
            'recipient' => $receiver->id,
            'amount' => 100.0,
            'description' => 'Should fail',
        ]);
    }

    public function test_transfer_fails_for_self_transfer(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);

        TenantContext::setById($this->testTenantId);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("You can't send credits to yourself. Please choose another member.");

        $this->service->transfer($user->id, [
            'recipient' => $user->id,
            'amount' => 1.0,
            'description' => 'Self transfer',
        ]);
    }

    public function test_transfer_fails_with_zero_amount(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Amount must be greater than 0');

        $this->service->transfer($sender->id, [
            'recipient' => $receiver->id,
            'amount' => 0,
            'description' => 'Zero amount',
        ]);
    }

    public function test_transfer_fails_with_negative_amount(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $this->expectException(\InvalidArgumentException::class);

        $this->service->transfer($sender->id, [
            'recipient' => $receiver->id,
            'amount' => -5.0,
            'description' => 'Negative amount',
        ]);
    }

    public function test_transfer_fails_without_recipient(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);

        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessage('Please choose who to send this to.');

        $this->service->transfer($sender->id, [
            'amount' => 1.0,
            'description' => 'No recipient',
        ]);
    }

    public function test_transfer_fails_for_nonexistent_recipient(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("We can't find that member.");

        $this->service->transfer($sender->id, [
            'recipient' => 999999,
            'amount' => 1.0,
            'description' => 'Ghost recipient',
        ]);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_transfer_to_user_in_other_tenant(): void
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create([
            'balance' => 20.00,
        ]);

        // Create user in tenant 999 — should not be resolvable from tenant 2
        $otherTenantUser = User::factory()->forTenant(999)->create();

        TenantContext::setById($this->testTenantId);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage("We can't find that member.");

        $this->service->transfer($sender->id, [
            'recipient' => $otherTenantUser->id,
            'amount' => 1.0,
            'description' => 'Cross-tenant transfer',
        ]);
    }

    // ------------------------------------------------------------------
    //  TRANSACTIONS LIST
    // ------------------------------------------------------------------

    public function test_get_transactions_returns_paginated_structure(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Transaction::factory()->forTenant($this->testTenantId)->count(3)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->getTransactions($user->id, ['limit' => 10]);

        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('has_more', $result);
        $this->assertArrayHasKey('cursor', $result);
        $this->assertCount(3, $result['items']);
        $this->assertFalse($result['has_more']);
    }

    public function test_get_transactions_respects_limit(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Transaction::factory()->forTenant($this->testTenantId)->count(5)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);

        TenantContext::setById($this->testTenantId);
        $result = $this->service->getTransactions($user->id, ['limit' => 2]);

        $this->assertCount(2, $result['items']);
        $this->assertTrue($result['has_more']);
        $this->assertNotNull($result['cursor']);
    }
}
