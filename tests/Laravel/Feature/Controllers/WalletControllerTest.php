<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for WalletController — balance, transactions, transfer.
 */
class WalletControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
            'balance' => 10.00,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  BALANCE
    // ------------------------------------------------------------------

    public function test_balance_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/balance');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_balance_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/wallet/balance');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TRANSACTIONS
    // ------------------------------------------------------------------

    public function test_transactions_returns_list(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);

        $response = $this->apiGet('/v2/wallet/transactions');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    /**
     * 🔴 The "Pending" filter could only ever answer "No matching transactions".
     *
     * `WalletService::getTransactions()` was unconditionally `->completed()`, while
     * `getBalance()` reports `pending_in` / `pending_out` and BOTH frontends offer a
     * Pending filter. Measured on a device 2026-08-23: the wallet tile read "PENDING 11h"
     * and tapping Pending showed nothing — the member was told hours were pending and then
     * shown none of them.
     *
     * The other half of the fix is that this stays ADDITIVE. Clients derive earned/spent
     * from the default list as a fallback, so a pending amount must never appear there and
     * be counted as settled.
     */
    public function test_transactions_returns_pending_rows_only_for_the_pending_filter(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $settled = Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);
        $pending = Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $other->id,
            'receiver_id' => $user->id,
            'status' => 'pending',
        ]);

        $pendingOnly = $this->apiGet('/v2/wallet/transactions?type=pending');
        $pendingOnly->assertStatus(200);
        $pendingIds = array_column($pendingOnly->json('data') ?? [], 'id');
        $this->assertContains($pending->id, $pendingIds, 'the pending filter must return pending rows');
        $this->assertNotContains($settled->id, $pendingIds, 'the pending filter must not return settled rows');

        foreach (['all', 'sent', 'received'] as $filter) {
            $response = $this->apiGet('/v2/wallet/transactions?type=' . $filter);
            $response->assertStatus(200);
            $ids = array_column($response->json('data') ?? [], 'id');
            $this->assertNotContains(
                $pending->id,
                $ids,
                "type={$filter} must stay completed-only — clients derive earned/spent from it",
            );
        }
    }

    public function test_transactions_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/wallet/transactions');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  SHOW TRANSACTION
    // ------------------------------------------------------------------

    public function test_show_transaction_returns_data(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $transaction = Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);

        $response = $this->apiGet("/v2/wallet/transactions/{$transaction->id}");

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_show_transaction_returns_404_for_nonexistent(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/transactions/999999');

        $response->assertStatus(404);
    }

    public function test_show_transaction_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/wallet/transactions/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TRANSFER
    // ------------------------------------------------------------------

    public function test_can_transfer_credits(): void
    {
        $user = $this->authenticatedUser(['balance' => 20.00]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => $recipient->id,
            'amount' => 1.0,
            'description' => 'Test transfer',
        ]);

        $this->assertContains($response->getStatusCode(), [200, 201]);
    }

    public function test_transfer_requires_authentication(): void
    {
        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => 1,
            'amount' => 1.0,
            'description' => 'Test',
        ]);

        $response->assertStatus(401);
    }

    public function test_transfer_fails_without_required_fields(): void
    {
        $this->authenticatedUser();

        $response = $this->apiPost('/v2/wallet/transfer', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    public function test_cannot_transfer_to_self(): void
    {
        $user = $this->authenticatedUser(['balance' => 20.00]);

        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => $user->id,
            'amount' => 1.0,
            'description' => 'Self transfer',
        ]);

        $response->assertStatus(400);
    }

    public function test_transfer_fails_with_insufficient_balance(): void
    {
        $user = $this->authenticatedUser(['balance' => 0.00]);
        $recipient = User::factory()->forTenant($this->testTenantId)->create();

        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => $recipient->id,
            'amount' => 100.0,
            'description' => 'Over budget',
        ]);

        $response->assertStatus(400);
    }

    public function test_transfer_to_nonexistent_user_returns_404(): void
    {
        $this->authenticatedUser(['balance' => 20.00]);

        $response = $this->apiPost('/v2/wallet/transfer', [
            'recipient' => 999999,
            'amount' => 1.0,
            'description' => 'No such user',
        ]);

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  DELETE TRANSACTION
    // ------------------------------------------------------------------

    public function test_can_hide_own_transaction(): void
    {
        $user = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();

        $transaction = Transaction::factory()->forTenant($this->testTenantId)->create([
            'sender_id' => $user->id,
            'receiver_id' => $other->id,
            'status' => 'completed',
        ]);

        $response = $this->apiDelete("/v2/wallet/transactions/{$transaction->id}");

        $this->assertContains($response->getStatusCode(), [200, 204]);
    }

    public function test_hide_transaction_requires_authentication(): void
    {
        $response = $this->apiDelete('/v2/wallet/transactions/1');

        $response->assertStatus(401);
    }

    public function test_hide_nonexistent_transaction_returns_404(): void
    {
        $this->authenticatedUser();

        $response = $this->apiDelete('/v2/wallet/transactions/999999');

        $response->assertStatus(404);
    }

    // ------------------------------------------------------------------
    //  USER SEARCH
    // ------------------------------------------------------------------

    public function test_user_search_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/user-search?q=test');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_user_search_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/wallet/user-search?q=test');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  PENDING COUNT
    // ------------------------------------------------------------------

    public function test_pending_count_returns_zero(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/wallet/pending-count');

        $response->assertStatus(200);
        $response->assertJsonPath('data.count', 0);
    }

    public function test_pending_count_requires_authentication(): void
    {
        $response = $this->apiGet('/v2/wallet/pending-count');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  TENANT ISOLATION
    // ------------------------------------------------------------------

    public function test_cannot_see_other_tenant_transaction(): void
    {
        $this->authenticatedUser();
        $otherTransaction = Transaction::factory()->forTenant(999)->create([
            'status' => 'completed',
        ]);

        $response = $this->apiGet("/v2/wallet/transactions/{$otherTransaction->id}");

        $response->assertStatus(404);
    }
}
