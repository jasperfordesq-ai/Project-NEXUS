<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E089;

use App\Models\Transaction;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-564 (E-089, Cyphere pen test 4 Oct 2026): a member could call
 * DELETE /v2/wallet/transactions/{id} and hide a transfer from their own
 * transaction history. The balance was untouched and no screen offered it,
 * but a member must not be able to edit their view of the time-credit ledger.
 * The route is gone; the transfer stays in the member's history.
 */
final class F564WalletTransactionHideRouteRemovedTest extends TestCase
{
    use DatabaseTransactions;

    public function test_member_cannot_hide_a_transaction_from_their_history(): void
    {
        $tenantId = $this->testTenantId;
        $sender = User::factory()->forTenant($tenantId)->create();
        $receiver = User::factory()->forTenant($tenantId)->create();
        $transaction = Transaction::factory()->forTenant($tenantId)->create([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'status' => 'completed',
        ]);

        Sanctum::actingAs($sender);

        $response = $this->deleteJson('/api/v2/wallet/transactions/' . $transaction->id, [], $this->withTenantHeader([]));

        // 405: the URI still exists for GET; there is no DELETE handler any more.
        $this->assertContains($response->getStatusCode(), [404, 405], 'the hide route must not exist');

        $transaction->refresh();
        $this->assertFalse((bool) $transaction->deleted_for_sender);
        $this->assertFalse((bool) $transaction->deleted_for_receiver);

        $history = $this->getJson('/api/v2/wallet/transactions', $this->withTenantHeader([]));
        $history->assertOk();
        $this->assertStringContainsString('"id":' . $transaction->id, $history->getContent());
    }
}
