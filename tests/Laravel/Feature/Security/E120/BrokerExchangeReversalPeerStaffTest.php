<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E120;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * GHSA-v6rc-qcgh-gr38 (reported against 86adbf339, 27 Sep 2026): a broker or
 * coordinator could reverse a completed exchange between other staff, e.g.
 * an administrator paying a coordinator, via
 * POST /v2/admin/broker/exchanges/{id}/reverse.
 *
 * Fixed by b9db2e193 (F-254): ExchangeWorkflowService requires a non-admin
 * caller to strictly outrank (AdminTier::outranks) both balances it moves.
 * F254BrokerExchangeReversalRankTest covers broker-vs-admin-payee and
 * broker-vs-broker-payer. This pins the reporter's exact fixture (broker
 * reverses admin payer 8 -> coordinator payee 12) and the peer cases with a
 * coordinator on either side.
 */
class BrokerExchangeReversalPeerStaffTest extends TestCase
{
    use DatabaseTransactions;

    private function user(string $role, float $balance): User
    {
        $factory = User::factory()->forTenant($this->testTenantId);
        $attributes = ['status' => 'active', 'is_approved' => 1, 'balance' => $balance];
        if ($role === 'admin') {
            return $factory->admin()->create($attributes);
        }

        return $factory->create($attributes + ['role' => $role]);
    }

    private function completedExchange(int $payerId, int $payeeId, float $hours): int
    {
        $listing = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $payeeId,
            'title' => 'GHSA-v6rc fixture', 'description' => 'GHSA-v6rc fixture listing',
            'type' => 'offer', 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
        $txn = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $payerId, 'receiver_id' => $payeeId,
            'amount' => $hours, 'description' => 'GHSA-v6rc exchange', 'transaction_type' => 'exchange',
            'status' => 'completed', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $listing,
            'requester_id' => $payerId, 'provider_id' => $payeeId, 'proposed_hours' => $hours,
            'final_hours' => $hours, 'transaction_id' => $txn, 'status' => 'completed',
            'completed_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function bal(User $u): float
    {
        return (float) DB::table('users')->where('id', $u->id)->value('balance');
    }

    private function assertRefusedAndUntouched(
        int $exchangeId,
        User $payer,
        float $payerBal,
        User $payee,
        float $payeeBal,
        \Illuminate\Testing\TestResponse $response,
    ): void {
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');

        $row = DB::table('exchange_requests')->where('id', $exchangeId)->first();
        $this->assertNull($row->reversal_transaction_id);
        $this->assertSame('completed', $row->status);
        $this->assertSame(0, DB::table('transactions')
            ->where('tenant_id', $this->testTenantId)
            ->where('transaction_type', 'exchange_reversal')
            ->whereIn('sender_id', [$payer->id, $payee->id])
            ->count());
        $this->assertEquals($payerBal, $this->bal($payer));
        $this->assertEquals($payeeBal, $this->bal($payee));
    }

    public function test_reporter_fixture_broker_cannot_reverse_admin_to_coordinator_exchange(): void
    {
        $admin = $this->user('admin', 8);
        $coordinator = $this->user('coordinator', 12);
        $ex = $this->completedExchange((int) $admin->id, (int) $coordinator->id, 4.0);
        Sanctum::actingAs($this->user('broker', 5));

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'GHSA-v6rc reporter PoC']);

        $this->assertRefusedAndUntouched($ex, $admin, 8.0, $coordinator, 12.0, $response);
    }

    public function test_coordinator_cannot_reverse_exchange_paying_another_coordinator(): void
    {
        $member = $this->user('member', 8);
        $peer = $this->user('coordinator', 12);
        $ex = $this->completedExchange((int) $member->id, (int) $peer->id, 4.0);
        Sanctum::actingAs($this->user('coordinator', 5));

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'GHSA-v6rc peer coordinator']);

        $this->assertRefusedAndUntouched($ex, $member, 8.0, $peer, 12.0, $response);
    }

    public function test_broker_cannot_reverse_exchange_paying_a_coordinator(): void
    {
        $member = $this->user('member', 8);
        $coordinator = $this->user('coordinator', 12);
        $ex = $this->completedExchange((int) $member->id, (int) $coordinator->id, 4.0);
        Sanctum::actingAs($this->user('broker', 5));

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'GHSA-v6rc broker vs coordinator']);

        $this->assertRefusedAndUntouched($ex, $member, 8.0, $coordinator, 12.0, $response);
    }

    public function test_broker_cannot_reverse_exchange_paying_another_broker(): void
    {
        $member = $this->user('member', 8);
        $peer = $this->user('broker', 12);
        $ex = $this->completedExchange((int) $member->id, (int) $peer->id, 4.0);
        Sanctum::actingAs($this->user('broker', 5));

        $response = $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'GHSA-v6rc peer broker payee']);

        $this->assertRefusedAndUntouched($ex, $member, 8.0, $peer, 12.0, $response);
    }

    public function test_control_coordinator_reverses_member_to_member_exchange(): void
    {
        $payer = $this->user('member', 8);
        $payee = $this->user('member', 12);
        $ex = $this->completedExchange((int) $payer->id, (int) $payee->id, 4.0);
        Sanctum::actingAs($this->user('coordinator', 5));

        $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'GHSA-v6rc legit'])->assertStatus(200);

        $this->assertEquals(12.0, $this->bal($payer));
        $this->assertEquals(8.0, $this->bal($payee));
    }
}
