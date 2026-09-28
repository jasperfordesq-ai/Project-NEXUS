<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E055;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-254 (E-055 C-6, residual of F-219): F-219 stopped a broker/coordinator
 * adjusting the balance of anyone at or above their own tier, but reversing a
 * completed exchange and arbitrating a disputed one move the same credits and
 * only refused a broker who was a party. Both now apply the F-219 rule
 * (AdminTier::outranks for non-admin callers) to every account whose balance
 * the action changes, and refuse with the same 403 F-219 uses.
 */
class F254BrokerExchangeReversalRankTest extends TestCase
{
    use DatabaseTransactions;

    private function broker(float $balance = 5): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'broker', 'status' => 'active', 'is_approved' => 1, 'balance' => $balance,
        ]);
    }

    private function member(float $balance): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'balance' => $balance]);
    }

    private function admin(float $balance): User
    {
        return User::factory()->forTenant($this->testTenantId)->admin()->create(['status' => 'active', 'balance' => $balance]);
    }

    private function listing(int $ownerId): int
    {
        return (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId, 'user_id' => $ownerId,
            'title' => 'F254 fixture', 'description' => 'F254 fixture listing',
            'type' => 'offer', 'status' => 'active', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function completedExchange(int $payerId, int $payeeId, float $hours): int
    {
        $txn = (int) DB::table('transactions')->insertGetId([
            'tenant_id' => $this->testTenantId, 'sender_id' => $payerId, 'receiver_id' => $payeeId,
            'amount' => $hours, 'description' => 'F254 exchange', 'transaction_type' => 'exchange',
            'status' => 'completed', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $this->listing($payeeId),
            'requester_id' => $payerId, 'provider_id' => $payeeId, 'proposed_hours' => $hours,
            'final_hours' => $hours, 'transaction_id' => $txn, 'status' => 'completed',
            'completed_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function disputedExchange(int $requesterId, int $providerId): int
    {
        return (int) DB::table('exchange_requests')->insertGetId([
            'tenant_id' => $this->testTenantId, 'listing_id' => $this->listing($providerId),
            'requester_id' => $requesterId, 'provider_id' => $providerId, 'proposed_hours' => 2.0,
            'requester_confirmed_hours' => 1.5, 'provider_confirmed_hours' => 2.5,
            'requester_confirmed_at' => now(), 'provider_confirmed_at' => now(),
            'status' => 'disputed', 'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    private function bal(int $id): float
    {
        return (float) DB::table('users')->where('id', $id)->value('balance');
    }

    private function assertRankRefusal($response): void
    {
        // Same refusal F-219 returns from adjust-balance.
        $response->assertStatus(403);
        $response->assertJsonPath('errors.0.code', 'AUTH_INSUFFICIENT_PERMISSIONS');
        $response->assertJsonPath('errors.0.message', __('api.insufficient_permissions'));
    }

    private function assertNotReversed(int $exchangeId): void
    {
        $this->assertNull(DB::table('exchange_requests')->where('id', $exchangeId)->value('reversal_transaction_id'));
        $this->assertSame(0, DB::table('transactions')
            ->where('transaction_type', 'exchange_reversal')
            ->where('description', 'like', '[Exchange Reversal] #' . $exchangeId . ':%')
            ->count());
    }

    public function test_broker_cannot_reverse_exchange_that_debits_an_admin(): void
    {
        $member = $this->member(8);
        $admin = $this->admin(10);
        $ex = $this->completedExchange((int) $member->id, (int) $admin->id, 3.0);
        Sanctum::actingAs($this->broker());

        $this->assertRankRefusal($this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'F254 attack']));

        $this->assertEquals(10.0, $this->bal((int) $admin->id));
        $this->assertEquals(8.0, $this->bal((int) $member->id));
        $this->assertNotReversed($ex);
    }

    public function test_broker_cannot_reverse_exchange_that_credits_a_fellow_broker(): void
    {
        $fellow = $this->broker(5);
        $member = $this->member(10);
        $ex = $this->completedExchange((int) $fellow->id, (int) $member->id, 4.0);
        Sanctum::actingAs($this->broker());

        $this->assertRankRefusal($this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'F254 attack 2']));

        $this->assertEquals(5.0, $this->bal((int) $fellow->id));
        $this->assertEquals(10.0, $this->bal((int) $member->id));
        $this->assertNotReversed($ex);
    }

    public function test_broker_cannot_resolve_dispute_involving_an_admin(): void
    {
        $member = $this->member(10);
        $admin = $this->admin(10);
        $ex = $this->disputedExchange((int) $member->id, (int) $admin->id);
        Sanctum::actingAs($this->broker());

        $this->assertRankRefusal($this->apiPost("/v2/admin/broker/exchanges/{$ex}/resolve-dispute", [
            'final_hours' => 1.5, 'notes' => 'F254 broker decides admin credits',
        ]));

        $row = DB::table('exchange_requests')->where('id', $ex)->first();
        $this->assertSame('disputed', $row->status);
        $this->assertNull($row->final_hours);
        $this->assertNull($row->transaction_id);
        $this->assertEquals(10.0, $this->bal((int) $admin->id));
        $this->assertEquals(10.0, $this->bal((int) $member->id));
        $this->assertSame(0, DB::table('exchange_history')->where('exchange_id', $ex)->where('action', 'dispute_resolved')->count());
    }

    public function test_broker_cannot_resolve_dispute_involving_a_fellow_broker(): void
    {
        $member = $this->member(10);
        $fellow = $this->broker(5);
        $ex = $this->disputedExchange((int) $member->id, (int) $fellow->id);
        Sanctum::actingAs($this->broker());

        $this->assertRankRefusal($this->apiPost("/v2/admin/broker/exchanges/{$ex}/resolve-dispute", [
            'final_hours' => 2.0, 'notes' => 'F254 broker decides fellow broker credits',
        ]));
        $this->assertSame('disputed', DB::table('exchange_requests')->where('id', $ex)->value('status'));
        $this->assertEquals(5.0, $this->bal((int) $fellow->id));
    }

    public function test_control_broker_reverses_member_to_member_exchange(): void
    {
        $payer = $this->member(8);
        $payee = $this->member(12);
        $ex = $this->completedExchange((int) $payer->id, (int) $payee->id, 3.0);
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'F254 legit'])->assertStatus(200);

        $this->assertEquals(9.0, $this->bal((int) $payee->id));
        $this->assertEquals(11.0, $this->bal((int) $payer->id));
        $this->assertNotNull(DB::table('exchange_requests')->where('id', $ex)->value('reversal_transaction_id'));
    }

    public function test_control_broker_resolves_member_to_member_dispute(): void
    {
        $requester = $this->member(10);
        $provider = $this->member(10);
        $ex = $this->disputedExchange((int) $requester->id, (int) $provider->id);
        Sanctum::actingAs($this->broker());

        $this->apiPost("/v2/admin/broker/exchanges/{$ex}/resolve-dispute", [
            'final_hours' => 2.0, 'notes' => 'F254 legit arbitration',
        ])->assertStatus(200);

        $this->assertSame('completed', DB::table('exchange_requests')->where('id', $ex)->value('status'));
    }

    public function test_control_admin_can_reverse_exchange_with_an_admin_party(): void
    {
        $member = $this->member(8);
        $partyAdmin = $this->admin(10);
        $ex = $this->completedExchange((int) $member->id, (int) $partyAdmin->id, 3.0);
        Sanctum::actingAs($this->admin(0));

        $this->apiPost("/v2/admin/broker/exchanges/{$ex}/reverse", ['reason' => 'F254 admin correction'])->assertStatus(200);

        $this->assertEquals(7.0, $this->bal((int) $partyAdmin->id));
        $this->assertEquals(11.0, $this->bal((int) $member->id));
    }
}
